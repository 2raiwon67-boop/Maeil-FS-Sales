import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// 시장분석(discover) 클라 지오코딩 백필 영속화.
// 브라우저 Naver 지오코더가 채운 좌표를 market_store_records에 저장해
// 다음 사용자·다음 날부터 재지오코딩이 필요 없게 한다.
// 인증: 로그인 세션 필수. 쓰기는 Service Role이지만 결측 행(lat IS NULL)만 채우고
// 좌표는 한국 범위로 검증 — 기존(공공 API 제공) 좌표는 절대 덮지 않음.

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const MAX_UPDATES = 500;

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let updates: { id: number; lat: number; lng: number }[];
  try {
    updates = (await req.json()).updates;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!Array.isArray(updates) || updates.length === 0) return NextResponse.json({ saved: 0 });
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
  return NextResponse.json({ saved });
}
