// 관리자 전용 사용자 관리 API
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_CODE

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
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Code');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // 관리자 코드 인증
    const adminCode = req.headers['x-admin-code'] || req.body?.adminCode;
    const ADMIN_CODE = process.env.ADMIN_CODE;
    if (!ADMIN_CODE || adminCode !== ADMIN_CODE) {
        return res.status(403).json({ error: '관리자 인증 실패' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({ error: '서버 환경변수가 설정되지 않았습니다.' });
    }

    const supabaseHeaders = {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };

    // ── GET: 전체 사용자 목록 ──────────────────────────────────
    if (req.method === 'GET') {
        try {
            const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
                headers: supabaseHeaders
            });
            const data = await response.json();
            if (!response.ok) return res.status(response.status).json(data);

            const users = (data.users || []).map(u => ({
                id: u.id,
                email: u.email,
                full_name: u.user_metadata?.full_name || '',
                phone: u.user_metadata?.phone || '',
                approved: u.user_metadata?.approved,  // false=대기, true=승인, undefined=기존
                created_at: u.created_at,
                last_sign_in_at: u.last_sign_in_at
            }));

            // 승인 대기 먼저, 그다음 최신 가입순 정렬
            users.sort((a, b) => {
                if (a.approved === false && b.approved !== false) return -1;
                if (a.approved !== false && b.approved === false) return 1;
                return new Date(b.created_at) - new Date(a.created_at);
            });

            return res.status(200).json({ users });
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
    }

    // ── POST: 승인 / 거절 ────────────────────────────────────
    if (req.method === 'POST') {
        const { action, userId, existingMetadata } = req.body || {};

        if (!userId || !action) {
            return res.status(400).json({ error: 'userId와 action이 필요합니다.' });
        }

        if (action === 'approve') {
            // 기존 메타데이터는 유지하고 approved만 true로 변경
            const updatedMeta = { ...(existingMetadata || {}), approved: true };
            const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
                method: 'PUT',
                headers: supabaseHeaders,
                body: JSON.stringify({ user_metadata: updatedMeta })
            });
            const data = await response.json();
            if (!response.ok) return res.status(response.status).json(data);
            return res.status(200).json({ success: true, message: '승인 완료' });
        }

        if (action === 'reject' || action === 'delete') {
            // 계정 삭제 (거절 또는 퇴사 처리)
            const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
                method: 'DELETE',
                headers: supabaseHeaders
            });
            if (!response.ok) {
                const data = await response.json();
                return res.status(response.status).json(data);
            }
            const message = action === 'delete' ? '계정 삭제 완료' : '거절 및 계정 삭제 완료';
            return res.status(200).json({ success: true, message });
        }

        return res.status(400).json({ error: '알 수 없는 action입니다.' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
