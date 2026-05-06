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
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Code');

    // 🔥 중요: 관리자 페이지 데이터는 절대 캐시하지 않도록 강제 방지 (승인 상태 실시간 갱신용)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // 관리자 코드 인증
    const adminCode = req.headers['x-admin-code'] || req.body?.adminCode;
    const ADMIN_CODE = process.env.ADMIN_CODE;
    if (!ADMIN_CODE || adminCode !== ADMIN_CODE) {
        return res.status(403).json({ error: '관리자 인증 실패' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
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
                business_unit: u.user_metadata?.business_unit || '',
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
        const { action, userId, existingMetadata, businessUnit } = req.body || {};

        if (!userId || !action) {
            return res.status(400).json({ error: 'userId와 action이 필요합니다.' });
        }

        if (action === 'approve') {
            // 기존 메타데이터는 유지하고 approved + business_unit 설정 (phone 필드는 제거)
            const { phone: _removed, ...cleanMeta } = existingMetadata || {};
            const updatedMeta = {
                ...cleanMeta,
                approved: true,
                ...(businessUnit ? { business_unit: businessUnit } : {})
            };
            const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
                method: 'PUT',
                headers: supabaseHeaders,
                body: JSON.stringify({ user_metadata: updatedMeta })
            });
            const data = await response.json();
            if (!response.ok) return res.status(response.status).json(data);

            // 승인 이메일 발송
            const BREVO_KEY   = process.env.BREVO_API_KEY;
            const FROM_EMAIL  = process.env.BREVO_FROM_EMAIL || '2raiwon67@gmail.com';
            const { userEmail, existingMetadata: meta } = req.body || {};
            const userName = meta?.full_name || userEmail || '담당자';

            if (BREVO_KEY && userEmail) {
                const loginUrl = 'https://2raiwon67-boop.github.io/Maeil-FS-Sales/login.html';
                const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:'Malgun Gothic','맑은 고딕',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa">
<tr><td align="center" style="padding:30px 10px;">
<table width="520" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #dee2e6;border-radius:12px;overflow:hidden;">
<tr><td bgcolor="#2c3e50" style="background:#2c3e50;padding:28px 32px;">
  <p style="margin:0;font-size:20px;font-weight:bold;color:#fff;">✅ 가입 승인 완료</p>
  <p style="margin:6px 0 0;font-size:13px;color:#bdc3c7;">FS MISO 경기북부 인허가 대시보드</p>
</td></tr>
<tr><td style="padding:32px;">
  <p style="font-size:15px;color:#2c3e50;margin:0 0 16px;">${userName}님, 안녕하세요.</p>
  <p style="font-size:14px;color:#495057;margin:0 0 8px;">가입 신청이 <strong>승인</strong>되었습니다.</p>
  <p style="font-size:14px;color:#495057;margin:0 0 24px;">소속: <strong>${businessUnit || '-'}</strong></p>
  <table cellpadding="0" cellspacing="0" border="0">
  <tr><td bgcolor="#2c3e50" style="background:#2c3e50;border-radius:8px;padding:12px 28px;">
    <a href="${loginUrl}" style="color:#fff;font-size:14px;font-weight:bold;text-decoration:none;">로그인하러 가기</a>
  </td></tr>
  </table>
</td></tr>
<tr><td style="padding:16px 32px;border-top:1px solid #dee2e6;text-align:center;">
  <p style="margin:0;font-size:11px;color:#adb5bd;">본 메일은 FS MISO 시스템에서 자동 발송되었습니다.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

                await fetch('https://api.brevo.com/v3/smtp/email', {
                    method: 'POST',
                    headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sender:      { name: 'FS MISO', email: FROM_EMAIL },
                        to:          [{ email: userEmail, name: userName }],
                        subject:     '[FS MISO] 가입이 승인되었습니다',
                        htmlContent: html
                    })
                }).catch(e => console.error('승인 이메일 발송 실패:', e.message));
            }

            return res.status(200).json({ success: true, message: '승인 완료' });
        }

        if (action === 'transfer') {
            // 소속 지점 변경 (인사발령)
            if (!businessUnit) return res.status(400).json({ error: 'businessUnit이 필요합니다.' });
            const getRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: supabaseHeaders });
            const getUser = await getRes.json();
            if (!getRes.ok) return res.status(getRes.status).json(getUser);
            const updatedMeta = { ...getUser.user_metadata, business_unit: businessUnit };
            const putRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
                method: 'PUT',
                headers: supabaseHeaders,
                body: JSON.stringify({ user_metadata: updatedMeta })
            });
            const putData = await putRes.json();
            if (!putRes.ok) return res.status(putRes.status).json(putData);
            return res.status(200).json({ success: true, message: '소속 변경 완료' });
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
