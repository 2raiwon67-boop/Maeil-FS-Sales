// api/admin-upload — 사업부(관리자) 전용: 지점 선택 후 인허가 데이터 중앙 업로드
// SERVICE_ROLE_KEY로 RLS 우회. x-admin-key 헤더로 인증. licenses만 허용.
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 60;

// 서버 측 business_unit 화이트리스트 (클라이언트 값 신뢰 안 함)
const VALID_BUSINESS_UNITS = [
  '수도권지역사업부',
  '경기북부FS/특수지점',
  '서울FS/특수지점',
  '경기남부FS/특수지점',
  '강원지점',
];

// licenses 허용 컬럼 (임의 컬럼 주입 차단)
const LICENSE_COLUMNS = [
  'permit_date', 'business_name', 'trade_status', 'business_type', 'area',
  'road_address', 'address1', 'address2', 'address3', 'priority', 'manager',
  'appsheet_date', 'lat', 'lng', 'milk_type', 'ai_tags',
];

const ALLOWED_MODES = ['add_new_only', 'replace'];
const VALID_STATUSES = new Set(['거래', '미거래', '인허가', '공사중', 'DROP']);

type Row = Record<string, unknown>;

export async function POST(req: NextRequest) {
  // 관리자 인증
  const adminKey = req.headers.get('x-admin-key');
  if (!process.env.ADMIN_CODE || adminKey !== process.env.ADMIN_CODE) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { table?: string; business_unit?: string; mode?: string; rows?: Row[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청 본문' }, { status: 400 });
  }
  const { table, business_unit, mode = 'add_new_only', rows } = body;

  if (table !== 'licenses') {
    return NextResponse.json({ error: '인허가(licenses)만 중앙 업로드를 지원합니다. 거래처·담당자는 지점에서 관리합니다.' }, { status: 400 });
  }
  if (!business_unit || !VALID_BUSINESS_UNITS.includes(business_unit)) {
    return NextResponse.json({ error: '유효하지 않은 지점입니다.' }, { status: 400 });
  }
  if (!ALLOWED_MODES.includes(mode)) {
    return NextResponse.json({ error: '유효하지 않은 업로드 모드입니다.' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: '업로드할 데이터가 없습니다.' }, { status: 400 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  const now = new Date().toISOString();

  // 행 정제: 허용 컬럼만 + business_unit 강제 주입 (클라 값 무시)
  const sanitize = (row: Row): Row => {
    const clean: Row = { business_unit, uploaded_at: now };
    for (const col of LICENSE_COLUMNS) {
      if (row[col] !== undefined) clean[col] = row[col];
    }
    return clean;
  };

  try {
    // 거래여부 값 검증
    const bad = rows.find((r) => r.trade_status && !VALID_STATUSES.has(r.trade_status as string));
    if (bad) {
      return NextResponse.json({ error: `유효하지 않은 거래여부 값: "${bad.trade_status}" (허용: 거래/미거래/인허가/공사중/DROP)` }, { status: 400 });
    }

    let payload = rows.map(sanitize);
    let skipped = 0;

    if (mode === 'add_new_only') {
      const { data: existRows, error: existErr } = await supabase
        .from('licenses').select('business_name').eq('business_unit', business_unit).limit(50000);
      if (existErr) throw new Error('기존 데이터 확인 실패: ' + existErr.message);
      const existing = new Set((existRows ?? []).map((r) => r.business_name).filter(Boolean));

      const before = payload.length;
      const internal = new Set<unknown>();
      payload = payload.filter((r) => {
        const name = r.business_name;
        if (!name || existing.has(name) || internal.has(name)) return false;
        internal.add(name);
        return true;
      });
      skipped = before - payload.length;

      if (payload.length === 0) {
        return NextResponse.json({ inserted: 0, skipped, message: '모두 이미 존재하는 데이터입니다.' });
      }
    } else if (mode === 'replace') {
      const { error: delErr } = await supabase.from('licenses').delete().eq('business_unit', business_unit);
      if (delErr) throw new Error('기존 데이터 삭제 실패: ' + delErr.message);
    }

    const BATCH = 500;
    let inserted = 0;
    for (let i = 0; i < payload.length; i += BATCH) {
      const batch = payload.slice(i, i + BATCH);
      const { error: insErr } = await supabase.from('licenses').insert(batch);
      if (insErr) throw new Error(`업로드 실패 (${i + 1}~${i + batch.length}번째): ${insErr.message}`);
      inserted += batch.length;
    }

    return NextResponse.json({ inserted, skipped, business_unit, mode });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
