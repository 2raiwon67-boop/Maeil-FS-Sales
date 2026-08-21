import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_CODE = process.env.ADMIN_CODE!;

const headers = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
};

const supabaseHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

function maskEmail(email: string): string {
  if (!email) return '';
  const [local, domain] = email.split('@');
  return local.slice(0, 2) + '***@' + domain;
}

// Supabase auth admin API는 실패 형태가 제각각(error / error_description / msg / message) — 실제 사유를 그대로 노출한다
function authErrorMessage(data: any): string {
  return data?.error_description || data?.msg || data?.message || data?.error || '처리 실패';
}

function verifyAdmin(req: NextRequest): boolean {
  const code = req.headers.get('x-admin-code');
  return !!ADMIN_CODE && code === ADMIN_CODE;
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '관리자 인증 실패' }, { status: 403, headers });
  }

  try {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
      headers: supabaseHeaders,
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status, headers });

    const users = (data.users || [])
      .map((u: any) => ({
        id: u.id,
        email: maskEmail(u.email),
        full_name: u.user_metadata?.full_name || '',
        business_unit: u.user_metadata?.business_unit || '',
        approved: u.user_metadata?.approved,
        is_admin: u.app_metadata?.is_admin === true,
        created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at,
      }))
      .sort((a: any, b: any) => {
        if (a.approved === false && b.approved !== false) return -1;
        if (a.approved !== false && b.approved === false) return 1;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      });

    return NextResponse.json({ users }, { headers });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500, headers });
  }
}

export async function POST(req: NextRequest) {
  if (!verifyAdmin(req)) {
    return NextResponse.json({ error: '관리자 인증 실패' }, { status: 403, headers });
  }

  const body = await req.json();
  const { action, userId, existingMetadata, businessUnit } = body;

  if (!userId || !action) {
    return NextResponse.json({ error: 'userId와 action이 필요합니다.' }, { status: 400, headers });
  }

  if (action === 'approve') {
    const { phone: _removed, ...cleanMeta } = existingMetadata || {};
    const finalBusinessUnit = businessUnit || cleanMeta.business_unit;
    const updatedMeta = {
      ...cleanMeta,
      approved: true,
      ...(finalBusinessUnit ? { business_unit: finalBusinessUnit } : {}),
    };

    // app_metadata는 통째 교체될 수 있어 기존 값(is_admin 등)을 읽어 보존한다
    const curRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: supabaseHeaders,
    });
    const curUser = curRes.ok ? await curRes.json() : null;

    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: supabaseHeaders,
      body: JSON.stringify({
        user_metadata: updatedMeta,
        app_metadata: { ...(curUser?.app_metadata || {}), business_unit: finalBusinessUnit },
      }),
    });
    const data = await response.json();
    if (!response.ok) return NextResponse.json(data, { status: response.status, headers });

    const BREVO_KEY = process.env.BREVO_API_KEY;
    const FROM_EMAIL = process.env.BREVO_FROM_EMAIL || '2raiwon67@gmail.com';
    const userName = existingMetadata?.full_name || '담당자';

    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: supabaseHeaders,
    });
    const userReal = userRes.ok ? await userRes.json() : null;
    const userEmail = userReal?.email || '';

    if (BREVO_KEY && userEmail) {
      const loginUrl = 'https://maeilfs-sales.vercel.app/login';
      const html = `<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8f9fa;font-family:'Malgun Gothic',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#f8f9fa">
<tr><td align="center" style="padding:30px 10px;">
<table width="520" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border:1px solid #dee2e6;border-radius:12px;overflow:hidden;">
<tr><td bgcolor="#2c3e50" style="padding:28px 32px;">
  <p style="margin:0;font-size:20px;font-weight:bold;color:#fff;">가입 승인 완료</p>
  <p style="margin:6px 0 0;font-size:13px;color:#bdc3c7;">FS MISO 인허가 대시보드</p>
</td></tr>
<tr><td style="padding:32px;">
  <p style="font-size:15px;color:#2c3e50;margin:0 0 16px;">${userName}님, 안녕하세요.</p>
  <p style="font-size:14px;color:#495057;margin:0 0 8px;">가입 신청이 <strong>승인</strong>되었습니다.</p>
  <p style="font-size:14px;color:#495057;margin:0 0 24px;">소속: <strong>${finalBusinessUnit || '-'}</strong></p>
  <table cellpadding="0" cellspacing="0" border="0">
  <tr><td bgcolor="#2c3e50" style="border-radius:8px;padding:12px 28px;">
    <a href="${loginUrl}" style="color:#fff;font-size:14px;font-weight:bold;text-decoration:none;">로그인하러 가기</a>
  </td></tr>
  </table>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

      fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': BREVO_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sender: { name: 'FS MISO', email: FROM_EMAIL },
          to: [{ email: userEmail, name: userName }],
          subject: '[FS MISO] 가입이 승인되었습니다',
          htmlContent: html,
        }),
      }).catch((e) => console.error('승인 이메일 발송 실패:', e.message));
    }

    return NextResponse.json({ success: true, message: '승인 완료' }, { headers });
  }

  if (action === 'transfer') {
    if (!businessUnit) {
      return NextResponse.json({ error: 'businessUnit이 필요합니다.' }, { status: 400, headers });
    }
    const getRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: supabaseHeaders,
    });
    const getUser = await getRes.json();
    if (!getRes.ok) return NextResponse.json(getUser, { status: getRes.status, headers });

    const updatedMeta = { ...getUser.user_metadata, business_unit: businessUnit };
    const putRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: supabaseHeaders,
      body: JSON.stringify({
        user_metadata: updatedMeta,
        app_metadata: { ...(getUser.app_metadata || {}), business_unit: businessUnit },
      }),
    });
    const putData = await putRes.json();
    if (!putRes.ok) return NextResponse.json(putData, { status: putRes.status, headers });
    return NextResponse.json({ success: true, message: '소속 변경 완료' }, { headers });
  }

  // 관리자 지정/해제 — is_admin이면 지점 소속을 유지한 채 전 지점 '조회'가 열린다(쓰기는 자기 지점만)
  if (action === 'set_admin') {
    const getRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      headers: supabaseHeaders,
    });
    const getUser = await getRes.json();
    if (!getRes.ok) return NextResponse.json(getUser, { status: getRes.status, headers });

    const putRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: supabaseHeaders,
      body: JSON.stringify({
        app_metadata: { ...(getUser.app_metadata || {}), is_admin: body.isAdmin === true },
      }),
    });
    const putData = await putRes.json();
    if (!putRes.ok) return NextResponse.json(putData, { status: putRes.status, headers });
    return NextResponse.json({ success: true, message: body.isAdmin ? '관리자로 지정했습니다' : '관리자 지정을 해제했습니다' }, { headers });
  }

  if (action === 'reject' || action === 'delete') {
    const response = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
      method: 'DELETE',
      headers: supabaseHeaders,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      return NextResponse.json({ error: authErrorMessage(data) }, { status: response.status, headers });
    }
    const message = action === 'delete' ? '계정 삭제 완료' : '거절 및 계정 삭제 완료';
    return NextResponse.json({ success: true, message }, { headers });
  }

  return NextResponse.json({ error: '알 수 없는 action입니다.' }, { status: 400, headers });
}
