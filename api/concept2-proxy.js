// Vercel Serverless Function: Concept2 APIプロキシ
// ブラウザからのCORS制限を回避してConcept2 APIを呼び出す

export default async function handler(req, res) {
    // CORS ヘッダー
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { action, access_token, from_date, to_date } = req.body;

        if (!access_token) {
            return res.status(400).json({ error: 'Access token required' });
        }

        const headers = {
            'Authorization': `Bearer ${access_token}`,
            'Accept': 'application/vnd.c2logbook.v1+json',
            'Content-Type': 'application/json',
        };

        // アクション別の処理
        if (action === 'verify') {
            // トークン検証 + ユーザー情報取得
            const response = await fetch('https://log.concept2.com/api/users/me', { headers });

            if (!response.ok) {
                const errorText = await response.text();
                return res.status(response.status).json({
                    error: 'Concept2 API error',
                    status: response.status,
                    details: errorText
                });
            }

            const userData = await response.json();
            return res.status(200).json({
                success: true,
                user: userData.data
            });

        } else if (action === 'sync') {
            // エルゴデータ取得
            let apiUrl = 'https://log.concept2.com/api/users/me/results?type=rower';
            if (from_date) apiUrl += `&from=${from_date}`;
            if (to_date) apiUrl += `&to=${to_date}`;

            const response = await fetch(apiUrl, { headers });

            if (!response.ok) {
                const errorText = await response.text();
                return res.status(response.status).json({
                    error: 'Concept2 API error',
                    status: response.status,
                    details: errorText
                });
            }

            const data = await response.json();
            const results = data.data || [];

            return res.status(200).json({
                success: true,
                count: results.length,
                results: results
            });

        } else {
            return res.status(400).json({ error: 'Unknown action. Use "verify" or "sync".' });
        }

    } catch (error) {
        console.error('Concept2 proxy error:', error);
        return res.status(500).json({ error: error.message });
    }
}
