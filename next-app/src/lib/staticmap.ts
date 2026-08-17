// 이메일 임베드 정적 지도(/api/staticmap) 좌표 서명 — 생성(send-license-alert)과 검증(staticmap)이 공유
// nb = 이웃 마커 좌표 문자열("lng,lat|lng,lat"). 서명에 포함해 마커 조작·프록시 악용을 차단.
import crypto from 'crypto';

export function staticMapSig(lat: number, lng: number, secret: string, nb = ''): string {
  return crypto.createHmac('sha256', secret).update(`${lat.toFixed(6)},${lng.toFixed(6)}|${nb}`).digest('hex').slice(0, 20);
}
