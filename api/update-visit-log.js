// api/update-visit-log.js
// 방문일지 인라인 수정 API (Service Role Key — RLS 우회, business_unit 검증)
const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080'
];

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { id, content, manager, trade_status, business_unit } = req.body || {};
    if (!id || !business_unit) {
        return res.status(400).json({ error: 'id와 business_unit이 필요합니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({ error: '환경변수 누락' });
    }

    const sbHeaders = {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };

    // ── 1. business_unit 검증 (다른 사업부 레코드 수정 방지) ──
    const checkRes = await fetch(
        `${SUPABASE_URL}/rest/v1/visit_logs?id=eq.${id}&business_unit=eq.${encodeURIComponent(business_unit)}&select=id`,
        { headers: sbHeaders }
    );
    const checkData = await checkRes.json();
    if (!Array.isArray(checkData) || checkData.length === 0) {
        return res.status(403).json({ error: '해당 레코드에 대한 접근 권한이 없습니다.' });
    }

    // ── 2. PATCH ──
    const updateBody = {};
    if (content  !== undefined && content  !== null) updateBody.content      = content;
    if (manager  !== undefined && manager  !== null) updateBody.manager      = manager;
    if (trade_status !== undefined && trade_status !== null) updateBody.trade_status = trade_status;

    const patchRes = await fetch(
        `${SUPABASE_URL}/rest/v1/visit_logs?id=eq.${id}`,
        {
            method: 'PATCH',
            headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify(updateBody)
        }
    );

    if (!patchRes.ok) {
        const err = await patchRes.text();
        return res.status(patchRes.status).json({ error: `수정 실패: ${err}` });
    }

    return res.status(200).json({ success: true });
}
