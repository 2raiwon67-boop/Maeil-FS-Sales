import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// 시장분석(discover) 클라 지오코딩 백필 영속화.
// 브라우저 Naver 지오코더가 채운 좌표를 market_store_records에 저장해
// 다음 사용자·다음 날부터 재지오코딩이 필요 없게 한다.
// 인증: 로그인 세션 필수. 쓰기는 Service Role이지만 결측 행(lat IS NULL)만 채우고
// 좌표는 한국 범위로 검증 — 기존(공공 API 제공) 좌표는 절대 덮지 않음.
//
// + 공유 무매칭 목록(GET / POST.noMatch): 지오코더가 "매칭 주소 없음"을 확정한 주소를
//   naver_cache의 특수 행에 영구 기록 — 브라우저별 3일 로컬 캐시와 달리 전 사용자가 공유해
//   영원히 실패할 주소의 재시도 쿼터 낭비를 차단한다. 홈 지도(licenses)도 이 목록을 같이 쓴다.

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MAX_UPDATES = 500;
const NOMATCH_STORE = '__geocode_nomatch__'; // naver_cache.store_name 특수 키 (DDL 없이 기존 테이블 재활용)
const NOMATCH_REPORT_CAP = 300;   // 요청당 신고 상한
const NOMATCH_TOTAL_CAP = 20000;  // 목록 총량 상한 (jsonb 비대 방지)

const sbHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

async function readNoMatchRow(): Promise<{ id: string; addrs: string[] } | null> {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/naver_cache?store_name=eq.${encodeURIComponent(NOMATCH_STORE)}&select=id,local_data&limit=1`,
    { headers: sbHeaders, cache: 'no-store' },
  );
  if (!r.ok) return null;
  const rows = await r.json();
  if (!rows.length) return null;
  const addrs = rows[0].local_data?.addrs;
  return { id: rows[0].id, addrs: Array.isArray(addrs) ? addrs : [] };
}

// 공유 무매칭 목록 조회 — discover·홈 지도가 로드 시 1회 받아 해당 주소는 시도 자체를 생략
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const row = await readNoMatchRow();
  return NextResponse.json({ noMatch: row?.addrs ?? [] });
}

async function mergeNoMatch(reported: string[]): Promise<number> {
  const clean = [...new Set(
    reported.filter((a) => typeof a === 'string' && a.trim().length >= 5 && a.length <= 200).map((a) => a.trim()),
  )].slice(0, NOMATCH_REPORT_CAP);
  if (!clean.length) return 0;
  const row = await readNoMatchRow();
  const merged = [...new Set([...(row?.addrs ?? []), ...clean])].slice(0, NOMATCH_TOTAL_CAP);
  if (row && merged.length === row.addrs.length) return 0; // 신규 없음
  const payload = { local_data: { addrs: merged }, cached_at: new Date().toISOString() };
  const res = row
    ? await fetch(`${SUPABASE_URL}/rest/v1/naver_cache?id=eq.${row.id}`, {
        method: 'PATCH', headers: { ...sbHeaders, Prefer: 'return=minimal' }, body: JSON.stringify(payload),
      })
    : await fetch(`${SUPABASE_URL}/rest/v1/naver_cache`, {
        method: 'POST', headers: { ...sbHeaders, Prefer: 'return=minimal' },
        body: JSON.stringify({ store_name: NOMATCH_STORE, ...payload }),
      });
  return res.ok ? merged.length - (row?.addrs.length ?? 0) : 0;
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let updates: { id: number; lat: number; lng: number }[];
  let noMatchReported: string[];
  try {
    const body = await req.json();
    updates = body.updates;
    noMatchReported = Array.isArray(body.noMatch) ? body.noMatch : [];
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }

  // 무매칭 신고 병합 (좌표 저장과 독립 — updates 없이 noMatch만 보내도 됨)
  let noMatchAdded = 0;
  if (noMatchReported.length) {
    try { noMatchAdded = await mergeNoMatch(noMatchReported); } catch { /* 목록 병합 실패는 무시 */ }
  }

  if (!Array.isArray(updates) || updates.length === 0) return NextResponse.json({ saved: 0, noMatchAdded });
  if (updates.length > MAX_UPDATES) updates = updates.slice(0, MAX_UPDATES);

  const valid = updates.filter(
    (u) => u && Number.isInteger(u.id) && Number.isFinite(u.lat) && Number.isFinite(u.lng)
      && u.lat > 33 && u.lat < 39 && u.lng > 124 && u.lng < 132,
  );

  const sb = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'return=minimal',
  };
  let saved = 0;
  for (let i = 0; i < valid.length; i += 20) {
    const res = await Promise.all(
      valid.slice(i, i + 20).map((u) =>
        // 결측 행만 채움 — 이미 좌표가 있는 행(공공 API 정식 좌표)은 건드리지 않음
        fetch(`${SUPABASE_URL}/rest/v1/market_store_records?id=eq.${u.id}&or=(lat.is.null,lng.is.null)`, {
          method: 'PATCH',
          headers: sb,
          body: JSON.stringify({ lat: u.lat, lng: u.lng }),
        }).then((r) => r.ok),
      ),
    );
    saved += res.filter(Boolean).length;
  }
  return NextResponse.json({ saved, noMatchAdded });
}
