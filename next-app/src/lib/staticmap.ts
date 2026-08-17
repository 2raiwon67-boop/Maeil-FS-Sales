// 이메일 임베드 정적 지도(/api/staticmap) 좌표 서명 — 생성(send-license-alert)과 검증(staticmap)이 공유
import crypto from 'crypto';

export function staticMapSig(lat: number, lng: number, secret: string): string {
  return crypto.createHmac('sha256', secret).update(`${lat.toFixed(6)},${lng.toFixed(6)}`).digest('hex').slice(0, 20);
}
