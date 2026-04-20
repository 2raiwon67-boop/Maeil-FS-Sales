// api/market-backfill.js — 상권 스냅샷 일회성 백필
// GET /api/market-backfill
// Authorization: Bearer ${CRON_SECRET}
//
// 2025-01부터 현재월까지 market_snapshots 테이블을 채운다.
// 경기도 / 서울 / 인천 순차 처리 (공공 API 부하 분산)
// 완료 후 재실행해도 안전 (upsert, 중복 없음)

const ALLOWED_SIDOS = ['경기도', '서울', '인천'];

export default async function handler(req, res) {
    // 인증
    const cronSecret = process.env.CRON_SECRET;
    const auth = req.headers['authorization'];
    if (cronSecret && auth !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const host     = req.headers.host || 'maeilfs-sales.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const base     = `${protocol}://${host}`;

    // 2025-01부터 현재월까지 몇 달인지 계산
    const now     = new Date();
    const startYM = new Date(2025, 0, 1);   // 2025-01
    const months  = (now.getFullYear() - startYM.getFullYear()) * 12
                  + (now.getMonth() - startYM.getMonth()) + 1;

    const results = {};

    for (const sido of ALLOWED_SIDOS) {
        try {
            const url = `${base}/api/market-stats?sido=${encodeURIComponent(sido)}&months=${months}&save=true`;
            const r   = await fetch(url, {
                headers: { 'Authorization': auth || '' }
            });
            const json = await r.json();
            results[sido] = json.saved ?? { error: json.error };
        } catch (e) {
            results[sido] = { error: e.message };
        }

        // 시도 간 1초 대기 (공공 API 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    return res.status(200).json({
        success: true,
        period:  `2025-01 ~ ${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,
        months,
        results,
    });
}
