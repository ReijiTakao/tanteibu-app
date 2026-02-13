import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
    // CORSプリフライト
    if (req.method === "OPTIONS") {
        return new Response("ok", { headers: corsHeaders });
    }

    try {
        const { code, redirect_uri, user_id, refresh_token, grant_type } = await req.json();

        // 環境変数からClient ID/Secretを取得
        const clientId = Deno.env.get("CONCEPT2_CLIENT_ID");
        const clientSecret = Deno.env.get("CONCEPT2_CLIENT_SECRET");
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

        if (!clientId || !clientSecret) {
            return new Response(
                JSON.stringify({ error: "Concept2 credentials not configured" }),
                { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const targetGrantType = grant_type || "authorization_code";
        const params: Record<string, string> = {
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: targetGrantType,
        };

        if (targetGrantType === "refresh_token") {
            if (!refresh_token) throw new Error("Refresh token required");
            params.refresh_token = refresh_token;
        } else {
            if (!code) throw new Error("Authorization code required");
            params.redirect_uri = redirect_uri;
            params.code = code;
            params.scope = "user:read,results:read";
        }

        // Concept2 APIでトークン交換
        const tokenResponse = await fetch("https://log.concept2.com/oauth/access_token", {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams(params),
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error("Token exchange failed:", errorData);
            return new Response(
                JSON.stringify({ error: "Token exchange failed", details: errorData }),
                { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
        }

        const tokenData = await tokenResponse.json();
        console.log("Token exchange successful");

        // Supabaseクライアントでユーザー情報を更新
        if (supabaseUrl && supabaseKey && user_id) {
            const supabase = createClient(supabaseUrl, supabaseKey);

            const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

            const { error: updateError } = await supabase
                .from("users")
                .update({
                    concept2_access_token: tokenData.access_token,
                    concept2_refresh_token: tokenData.refresh_token,
                    concept2_token_expires_at: expiresAt,
                    concept2_connected: true,
                })
                .eq("id", user_id);

            if (updateError) {
                console.error("Failed to update user:", updateError);
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in,
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
