// api/staticmap — 이메일 임베드용 정적 지도 프록시
//
// 왜 프록시인가: Naver Static Map API는 헤더 인증(x-ncp-apigw-api-key)이라 이메일 <img src>로
// 직접 못 쓴다. 이 라우트가 서버에서 키를 붙여 대신 받아와 이미지를 그대로 흘려보낸다.
// 공개 엔드포인트이므로 좌표별 HMAC 서명(sig)을 요구해 열린 프록시 악용을 차단한다
// (서명은 send-license-alert가 CRON_SECRET으로 생성 — 메일에 박힌 URL만 유효).
//
// 지도 소스 우선순위:
//   1) Naver Static Map raster-cors — 공개 키ID + 도메인 Referer 검증(시크릿 불필요, 기본 경로)
//   2) Naver Static Map 헤더 인증 — NCP_MAPS_KEY 시크릿 등록 시 보조 경로
//   3) MapTiler Static — 폴백(현재 키 도메인 제한으로 403, 형식만 유지)
import { NextRequest, NextResponse } from 'next/server';
import { staticMapSig } from '@/lib/staticmap';

export const maxDuration = 15;

const W = 640;
const H = 400;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const lat = parseFloat(searchParams.get('lat') || '');
  const lng = parseFloat(searchParams.get('lng') || '');
  const sig = searchParams.get('sig') || '';
  const nb = searchParams.get('nb') || ''; // 이웃 마커 "lng,lat|lng,lat" (최대 3, 서명에 포함)

  const inKorea = (la: number, ln: number) => Number.isFinite(la) && Number.isFinite(ln) && la >= 33 && la <= 39 && ln >= 124 && ln <= 132;

  // 한국 범위 밖·비정상 좌표 거부 (지오코딩 파이프라인과 동일 검증 범위)
  if (!inKorea(lat, lng)) {
    return NextResponse.json({ error: '잘못된 좌표' }, { status: 400 });
  }
  const nbPairs = nb
    ? nb.split('|').slice(0, 3).map((p) => p.split(',').map(Number) as [number, number])
    : [];
  if (nbPairs.some(([ln, la]) => !inKorea(la, ln))) {
    return NextResponse.json({ error: '잘못된 이웃 좌표' }, { status: 400 });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || sig !== staticMapSig(lat, lng, secret, nb)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const imgHeaders = (contentType: string) => ({
    'Content-Type': contentType,
    // 좌표별 고정 이미지 — 수신자가 메일을 다시 열어도 재호출 없이 CDN/브라우저 캐시로 처리
    'Cache-Control': 'public, max-age=604800, immutable',
  });

  const ncpKeyId = process.env.NCP_MAPS_KEY_ID || 'uipaxmujrl';
  // 이웃 마커가 있으면 반경 2km가 다 보이도록 한 단계 줌아웃. 이웃은 파란 숫자 라벨(메일 본문 번호와 대응)
  const level = nbPairs.length ? 14 : 15;
  const nbMarkers = nbPairs
    .map(([ln, la], i) => `&markers=${encodeURIComponent(`type:n|size:small|color:blue|pos:${ln} ${la}|label:${i + 1}`)}`)
    .join('');
  const mapsQS =
    `w=${W}&h=${H}&scale=2&center=${lng},${lat}&level=${level}` +
    `&markers=${encodeURIComponent(`type:d|size:mid|pos:${lng} ${lat}`)}` +
    nbMarkers;

  // 1) Naver Static Map raster-cors — 시크릿 불필요: 공개 키ID + 화이트리스트 도메인 Referer 검증.
  //    Referer는 트레일링 슬래시까지 정확해야 통과함(실측: 슬래시 없으면 401). NCP 콘솔에서
  //    Application(uipaxmujrl)에 Static Map 사용 체크 필요(2026-08-17 활성화 확인).
  try {
    const referer = `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'maeilfs-sales.vercel.app'}/`;
    const r = await fetch(
      `https://maps.apigw.ntruss.com/map-static/v2/raster-cors?${mapsQS}&X-NCP-APIGW-API-KEY-ID=${ncpKeyId}`,
      { headers: { Referer: referer } },
    );
    if (r.ok) {
      const buf = await r.arrayBuffer();
      return new NextResponse(buf, { headers: imgHeaders(r.headers.get('content-type') || 'image/jpeg') });
    }
  } catch {
    /* 폴백으로 진행 */
  }

  // 2) Naver Static Map 헤더 인증 (NCP_MAPS_KEY 시크릿 등록 시 — raster-cors 정책 변경 대비 보조 경로)
  const ncpKey = process.env.NCP_MAPS_KEY;
  if (ncpKey) {
    try {
      const r = await fetch(`https://maps.apigw.ntruss.com/map-static/v2/raster?${mapsQS}`, {
        headers: { 'x-ncp-apigw-api-key-id': ncpKeyId, 'x-ncp-apigw-api-key': ncpKey },
      });
      if (r.ok) {
        const buf = await r.arrayBuffer();
        return new NextResponse(buf, { headers: imgHeaders(r.headers.get('content-type') || 'image/png') });
      }
    } catch {
      /* 폴백으로 진행 */
    }
  }

  // 2) MapTiler Static (폴백)
  const mtKey = process.env.NEXT_PUBLIC_MAPTILER_KEY;
  if (mtKey) {
    try {
      const url =
        `https://api.maptiler.com/maps/streets-v2/static/${lng},${lat},14.5/${W}x${H}@2x.png` +
        `?key=${mtKey}&markers=${lng},${lat},red&attribution=bottomright`;
      const r = await fetch(url);
      if (r.ok) {
        const buf = await r.arrayBuffer();
        return new NextResponse(buf, { headers: imgHeaders('image/png') });
      }
    } catch {
      /* 아래 404 */
    }
  }

  return NextResponse.json({ error: '지도 소스 사용 불가' }, { status: 404 });
}
