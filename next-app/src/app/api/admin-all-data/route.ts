import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// 원본 api/admin-all-data.js와 동일: licenses/accounts/managers만 허용
const ALLOWED_TABLES = ['licenses', 'accounts', 'managers'];
// 테이블별 반환 컬럼 제한 (managers는 email 노출 금지 — 지역/담당자명만)
const TABLE_SELECT: Record<string, string> = {
  managers: 'id,business_unit,manager_name,region1,region2,region3,is_branch_manager',
};

export async function GET(req: NextRequest) {
  const adminCode = req.headers.get('x-admin-key');
  if (!process.env.ADMIN_CODE || adminCode !== process.env.ADMIN_CODE) {
    return NextResponse.json({ error: '관리자 인증 실패' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const table = searchParams.get('table') || '';
  const businessUnit = searchParams.get('business_unit') || '';

  if (!ALLOWED_TABLES.includes(table)) {
    return NextResponse.json({ error: '허용되지 않은 테이블' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  let query = supabase.from(table).select(TABLE_SELECT[table] || '*');
  if (businessUnit) {
    query = query.eq('business_unit', businessUnit);
  }

  const { data, error } = await query.limit(20000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
