import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const ALLOWED_TABLES = ['licenses', 'accounts', 'visit_logs'];

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

  let query = supabase.from(table).select('*');
  if (businessUnit) {
    query = query.eq('business_unit', businessUnit);
  }

  const { data, error } = await query.limit(1000);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ data });
}
