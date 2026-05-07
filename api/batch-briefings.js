// api/batch-briefings.js
// 야간 배치: market_snapshots 갱신 + Mother Brain 임베딩 처리
// Vercel Cron: 매일 새벽 3시 KST = 18:00 UTC

export default async function handler(req, res) {
    // Vercel Cron 인증
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const SUPABASE_URL    = process.env.SUPABASE_URL;
    const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
        return res.status(500).json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY' });
    }

    // ── 1. market_snapshots 갱신 (현재월 + 전월) ──────────
    // 브리핑보다 먼저 실행 — 병렬 조회라 빠름 (~30초)
    const marketResult = {};
    try {
        const host     = req.headers.host || 'maeilfs-sales.vercel.app';
        const protocol = host.includes('localhost') ? 'http' : 'https';
        const base     = `${protocol}://${host}`;

        await Promise.all(['경기도', '서울', '인천'].map(async sido => {
            try {
                const url = `${base}/api/market-stats?sido=${encodeURIComponent(sido)}&months=2&save=true`;
                const r   = await fetch(url, { headers: { Authorization: authHeader || '' } });
                const j   = await r.json();
                marketResult[sido] = j.saved ?? { error: j.error };
            } catch (e) {
                marketResult[sido] = { error: e.message };
            }
        }));
    } catch (_e) {
        // market snapshot 실패해도 브리핑 계속 진행
    }

    return res.status(200).json({ market: marketResult });
}
