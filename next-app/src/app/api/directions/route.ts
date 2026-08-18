import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

// 영업동선 실도로 경로 프록시 — NCP Directions 15 (실시간 교통 반영).
// 왜 프록시인가: Directions API는 헤더 시크릿(x-ncp-apigw-api-key) 인증이라 클라에서 직접 못 씀.
// 인증: 로그인 세션 필수(열린 프록시 방지). NCP_MAPS_KEY 미등록 시 503 → 클라가 OSRM 폴백.
// 요청: GET ?coords=lng,lat;lng,lat;... (출발+경유+도착, 2~17개 — 경유지 15개 한도)

export const maxDuration = 15;

const inKorea = (la: number, ln: number) =>
  Number.isFinite(la) && Number.isFinite(ln) && la >= 33 && la <= 39 && ln >= 124 && ln <= 132;

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const ncpKey = process.env.NCP_MAPS_KEY;
  if (!ncpKey) return NextResponse.json({ error: 'Directions 미설정' }, { status: 503 });

  const raw = new URL(req.url).searchParams.get('coords') || '';
  const pts = raw.split(';').map((p) => p.split(',').map(Number) as [number, number]);
  if (pts.length < 2 || pts.length > 17 || pts.some(([ln, la]) => !inKorea(la, ln))) {
    return NextResponse.json({ error: '잘못된 좌표' }, { status: 400 });
  }

  const fmt = ([ln, la]: [number, number]) => `${ln},${la}`;
  const qs = new URLSearchParams({
    start: fmt(pts[0]),
    goal: fmt(pts[pts.length - 1]),
    option: 'trafast', // 실시간 빠른 길
  });
  const way = pts.slice(1, -1).map(fmt).join('|');
  if (way) qs.set('waypoints', way);

  try {
    const r = await fetch(`https://maps.apigw.ntruss.com/map-direction-15/v1/driving?${qs}`, {
      headers: {
        'x-ncp-apigw-api-key-id': process.env.NCP_MAPS_KEY_ID || 'uipaxmujrl',
        'x-ncp-apigw-api-key': ncpKey,
      },
    });
    const data = await r.json();
    const route = data?.route?.trafast?.[0];
    if (!r.ok || data?.code !== 0 || !route?.path?.length) {
      return NextResponse.json({ error: data?.message || '경로 탐색 실패' }, { status: 502 });
    }
    return NextResponse.json({
      path: route.path, // [[lng,lat], ...]
      distance: route.summary.distance, // m
      duration: route.summary.duration, // ms
    });
  } catch {
    return NextResponse.json({ error: '경로 탐색 실패' }, { status: 502 });
  }
}
