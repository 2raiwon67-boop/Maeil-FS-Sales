// api/staticmap — 이메일 임베드용 정적 지도 프록시
//
// 왜 프록시인가: Naver Static Map API는 헤더 인증(x-ncp-apigw-api-key)이라 이메일 <img src>로
// 직접 못 쓴다. 이 라우트가 서버에서 키를 붙여 대신 받아와 이미지를 그대로 흘려보낸다.
// 공개 엔드포인트이므로 좌표별 HMAC 서명(sig)을 요구해 열린 프록시 악용을 차단한다
// (서명은 send-license-alert가 CRON_SECRET으로 생성 — 메일에 박힌 URL만 유효).
//
// 지도 소스 우선순위:
//   1) Naver Static Map — NCP_MAPS_KEY(시크릿) 등록 시. 키 ID는 지도 JS와 동일 애플리케이션
//      (기본 uipaxmujrl). NCP 콘솔에서 Static Map 활성화 + Secret 확인 후 env 등록하면 켜짐.
//   2) MapTiler Static — 폴백(이미 보유한 NEXT_PUBLIC_MAPTILER_KEY).
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

  // 한국 범위 밖·비정상 좌표 거부 (지오코딩 파이프라인과 동일 검증 범위)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 33 || lat > 39 || lng < 124 || lng > 132) {
    return NextResponse.json({ error: '잘못된 좌표' }, { status: 400 });
  }
  const secret = process.env.CRON_SECRET;
  if (!secret || sig !== staticMapSig(lat, lng, secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const imgHeaders = (contentType: string) => ({
    'Content-Type': contentType,
    // 좌표별 고정 이미지 — 수신자가 메일을 다시 열어도 재호출 없이 CDN/브라우저 캐시로 처리
    'Cache-Control': 'public, max-age=604800, immutable',
  });

  // 1) Naver Static Map (시크릿 키 등록 시)
  const ncpKeyId = process.env.NCP_MAPS_KEY_ID || 'uipaxmujrl';
  const ncpKey = process.env.NCP_MAPS_KEY;
  if (ncpKey) {
    try {
      const url =
        `https://maps.apigw.ntruss.com/map-static/v2/raster?w=${W}&h=${H}&scale=2` +
        `&center=${lng},${lat}&level=15` +
        `&markers=${encodeURIComponent(`type:d|size:mid|pos:${lng} ${lat}`)}`;
      const r = await fetch(url, {
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
