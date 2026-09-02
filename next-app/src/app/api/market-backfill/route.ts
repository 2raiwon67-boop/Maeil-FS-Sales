// api/market-backfill — 상권 스냅샷 일회성 백필
// GET /api/market-backfill  (Authorization: Bearer ${CRON_SECRET})
// 2025-01부터 현재월까지 market_snapshots 테이블을 채운다.
// 경기도 / 서울 / 인천 순차 처리. 재실행해도 안전 (upsert).
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

// 전국 17개 시도 — ?sidos=세종,제주 로 부분 실행 가능(쉼표 구분). 2026-09 전국 확장
const ALL_SIDOS = ['경기도', '서울', '인천', '강원도', '부산', '대구', '광주', '대전', '울산', '세종', '충청북도', '충청남도', '전라북도', '전라남도', '경상북도', '경상남도', '제주'];

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // req host 금지 — 배포 전용 URL로 재호출 시 Deployment Protection에 막힘 (refresh-market 주석 참고)
  const reqHost = req.headers.get('host') || '';
  const base = reqHost.includes('localhost')
    ? `http://${reqHost}`
    : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'maeilfs-sales.vercel.app'}`;

  const now = new Date();
  const startYM = new Date(2025, 0, 1);
  const months =
    (now.getFullYear() - startYM.getFullYear()) * 12 +
    (now.getMonth() - startYM.getMonth()) + 1;

  const results: Record<string, unknown> = {};

  // ?sidos=A,B (부분) · ?start=YYYYMM&end=YYYYMM (명시 창, 없으면 months) — maxDuration 60s라 대량은 창을 좁혀 여러 번 호출
  const sp = req.nextUrl.searchParams;
  const reqSidos = (sp.get('sidos') || '').split(',').map((s) => s.trim()).filter((s) => ALL_SIDOS.includes(s));
  const sidos = reqSidos.length ? reqSidos : ALL_SIDOS;
  const win = sp.get('start') && sp.get('end') ? `start=${sp.get('start')}&end=${sp.get('end')}` : `months=${months}`;

  for (const sido of sidos) {
    try {
      const url = `${base}/api/market-stats?sido=${encodeURIComponent(sido)}&${win}&save=true`;
      const r = await fetch(url, { headers: { Authorization: auth || '' } });
      const json = await r.json();
      results[sido] = json.saved ?? { error: json.error };
    } catch (e) {
      results[sido] = { error: (e as Error).message };
    }
    // 시도 간 1초 대기 (공공 API 부하 방지)
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return NextResponse.json({
    success: true,
    period: `2025-01 ~ ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    months,
    results,
  });
}
