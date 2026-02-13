import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 環境変数から取得
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const CONCEPT2_CLIENT_ID = Deno.env.get("CONCEPT2_CLIENT_ID") ?? "";
const CONCEPT2_CLIENT_SECRET = Deno.env.get("CONCEPT2_CLIENT_SECRET") ?? "";

// Supabaseクライアント初期化（Service Role Keyを使用）
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// トークンリフレッシュ関数
async function refreshAccessToken(refreshToken: string) {
    const tokenUrl = "https://log.concept2.com/oauth/access_token";
    const body = new URLSearchParams({
        client_id: CONCEPT2_CLIENT_ID,
        client_secret: CONCEPT2_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
    });

    const response = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
    });

    if (!response.ok) {
        throw new Error(`Failed to refresh token: ${await response.text()}`);
    }

    return await response.json();
}

serve(async (req) => {
    // CORSプリフライト
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { user_id, access_token: initialAccessToken, from_date, to_date } = await req.json();

        // 必須パラメータチェック
        if (!user_id) {
            return new Response(
                JSON.stringify({ error: "User ID required" }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        // アクセストークンがない場合、DBから取得を試みる（またはリフレッシュ）
        let accessToken = initialAccessToken;
        let refreshToken = null;

        if (!accessToken) {
            const { data: connection, error: connError } = await supabase
                .from("concept2_connections")
                .select("access_token, refresh_token")
                .eq("user_id", user_id)
                .single();

            if (connError || !connection) {
                return new Response(
                    JSON.stringify({ error: "No connection found or access token provided" }),
                    { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
            accessToken = connection.access_token;
            refreshToken = connection.refresh_token;
        }

        // Concept2 APIからデータ取得
        let apiUrl = "https://log.concept2.com/api/users/me/results?type=rower";
        if (from_date) apiUrl += `&from=${from_date}`;
        if (to_date) apiUrl += `&to=${to_date}`;

        console.log("Fetching from Concept2:", apiUrl);

        let response = await fetch(apiUrl, {
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${accessToken}`,
                "Accept": "application/vnd.c2logbook.v1+json",
            },
        });

        // 401エラー（トークン切れ）の場合、リフレッシュを試みる
        if (response.status === 401) {
            console.log("Access token expired, attempting refresh...");

            // リフレッシュトークンがない場合はDBから取得
            if (!refreshToken) {
                const { data: connection } = await supabase
                    .from("concept2_connections")
                    .select("refresh_token")
                    .eq("user_id", user_id)
                    .single();
                refreshToken = connection?.refresh_token;
            }

            if (refreshToken) {
                try {
                    const newTokens = await refreshAccessToken(refreshToken);
                    accessToken = newTokens.access_token;
                    refreshToken = newTokens.refresh_token; // 新しいリフレッシュトークン

                    // DB更新
                    await supabase
                        .from("concept2_connections")
                        .update({
                            access_token: accessToken,
                            refresh_token: refreshToken,
                            token_expires_at: new Date(Date.now() + newTokens.expires_in * 1000).toISOString(),
                            updated_at: new Date().toISOString(),
                        })
                        .eq("user_id", user_id);

                    console.log("Token refreshed and DB updated.");

                    // リクエスト再試行
                    response = await fetch(apiUrl, {
                        headers: {
                            "Content-Type": "application/json",
                            "Authorization": `Bearer ${accessToken}`,
                            "Accept": "application/vnd.c2logbook.v1+json",
                        },
                    });

                } catch (refreshError) {
                    console.error("Token refresh failed:", refreshError);
                    return new Response(
                        JSON.stringify({ error: "Token expired and refresh failed", details: refreshError.message }),
                        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                    );
                }
            } else {
                return new Response(
                    JSON.stringify({ error: "Token expired and no refresh token available" }),
                    { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
                );
            }
        }

        if (!response.ok) {
            const errorText = await response.text();
            return new Response(
                JSON.stringify({ error: "Failed to fetch data from Concept2", details: errorText }),
                { status: response.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const data = await response.json();
        const results = data.data || [];
        console.log(`Fetched ${results.length} results from Concept2`);

        // DBへの保存処理 (ergo_raw)
        let insertedCount = 0;
        let updatedCount = 0;

        for (const result of results) {
            const concept2Id = result.id.toString();

            // 既存データの確認
            const { data: existing } = await supabase
                .from("ergo_raw")
                .select("id")
                .eq("user_id", user_id)
                .eq("concept2_id", concept2Id)
                .single();

            const recordData = {
                user_id: user_id,
                concept2_id: concept2Id,
                workout_date: result.date, // ISO string expected
                distance: result.distance,
                time_seconds: Math.round(result.time / 10), // 1/10秒 -> 秒
                stroke_rate: result.stroke_rate,
                heart_rate: result.heart_rate?.average || null,
                raw_data: result, // 全データをJSONBとして保存
                synced_at: new Date().toISOString(),
            };

            if (existing) {
                // 更新（必要であれば）
                await supabase
                    .from("ergo_raw")
                    .update(recordData)
                    .eq("id", existing.id);
                updatedCount++;
            } else {
                // 新規挿入
                await supabase
                    .from("ergo_raw")
                    .insert(recordData);
                insertedCount++;
            }
        }

        // 最終同期日時の更新
        await supabase
            .from("concept2_connections")
            .update({ last_sync_at: new Date().toISOString() })
            .eq("user_id", user_id);

        return new Response(
            JSON.stringify({
                success: true,
                count: results.length,
                inserted: insertedCount,
                updated: updatedCount,
                results: results.slice(0, 5) // レスポンスサイズ削減のため一部のみ返す
            }),
            { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error("Error:", error);
        return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }
});
