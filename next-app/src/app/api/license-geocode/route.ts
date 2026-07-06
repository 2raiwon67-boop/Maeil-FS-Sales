import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// 홈 지도 클라 지오코딩 백필 영속화 (market-geocode의 licenses판).
// 브라우저 Naver 지오코더가 채운 좌표를 licenses에 저장해
// 다음 사용자·다음 기기부터 재지오코딩이 필요 없게 한다.
// 인증: 로그인 세션 필수. 쓰기도 세션 클라이언트 — licenses는 business_unit 스코프 테이블이라
// licenses_update_same_unit RLS 정책이 사용자 소속 격리를 DB에서 강제한다 (Service Role 미사용).
// 결측 행(lat 또는 lng IS NULL)만 채우고 좌표는 한국 범위로 검증 — 기존(엑셀 업로드) 좌표는 절대 덮지 않음.
// NULL 덮어쓰기 방어 트리거는 두지 않음: licenses 쓰기 경로가 전부 INSERT(add_new_only 업로드,
// 편집 저장의 insert-first 교체)라 UPDATE로 좌표가 NULL이 될 경로가 없다.

export const maxDuration = 60;

const MAX_UPDATES = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let updates: { id: string; lat: number; lng: number }[];
  try {
    updates = (await req.json()).updates;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!Array.isArray(updates) || updates.length === 0) return NextResponse.json({ saved: 0 });
  if (updates.length > MAX_UPDATES) updates = updates.slice(0, MAX_UPDATES);

  const valid = updates.filter(
    (u) => u && typeof u.id === 'string' && UUID_RE.test(u.id)
      && Number.isFinite(u.lat) && Number.isFinite(u.lng)
      && u.lat > 33 && u.lat < 39 && u.lng > 124 && u.lng < 132,
  );

  let saved = 0;
  for (let i = 0; i < valid.length; i += 20) {
    const res = await Promise.all(
      valid.slice(i, i + 20).map(async (u) => {
        // 결측 행만 채움 — 이미 좌표가 있는 행(엑셀 업로드 정식 좌표)은 건드리지 않음
        const { error } = await supabase
          .from('licenses')
          .update({ lat: u.lat, lng: u.lng })
          .eq('id', u.id)
          .or('lat.is.null,lng.is.null');
        return !error;
      }),
    );
    saved += res.filter(Boolean).length;
  }
  return NextResponse.json({ saved });
}
