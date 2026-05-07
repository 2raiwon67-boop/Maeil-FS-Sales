// api/admin-all-data.js
// 관리자 전용: 전체 지점 데이터 조회 (RLS 우회, SERVICE_ROLE_KEY 사용)
// x-admin-key 헤더로 인증

const ALLOWED_TABLES = ['licenses', 'accounts'];

export default async function handler(req, res) {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // 관리자 인증
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.ADMIN_CODE;
    if (!expectedKey || adminKey !== expectedKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { table, business_unit } = req.query;
    if (!ALLOWED_TABLES.includes(table)) {
        return res.status(400).json({ error: 'Invalid table' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({ error: 'Server config error' });
    }

    try {
        const buFilter = business_unit ? `&business_unit=eq.${encodeURIComponent(business_unit)}` : '';
        const url = `${SUPABASE_URL}/rest/v1/${table}?select=*${buFilter}&limit=20000`;
        const resp = await fetch(url, {
            headers: {
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json'
            }
        });
        if (!resp.ok) {
            const err = await resp.text();
            return res.status(resp.status).json({ error: err });
        }
        const data = await resp.json();
        res.status(200).json({ data });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
}
