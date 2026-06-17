// api/market-backfill — 상권 스냅샷 일회성 백필
// GET /api/market-backfill  (Authorization: Bearer ${CRON_SECRET})
// 2025-01부터 현재월까지 market_snapshots 테이블을 채운다.
// 경기도 / 서울 / 인천 순차 처리. 재실행해도 안전 (upsert).
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const ALLOWED_SIDOS = ['경기도', '서울', '인천'];

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers.get('authorization');
  if (cronSecret && auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const host = req.headers.get('host') || 'maeilfs-sales.vercel.app';
  const protocol = host.includes('localhost') ? 'http' : 'https';
  const base = `${protocol}://${host}`;

  const now = new Date();
  const startYM = new Date(2025, 0, 1);
  const months =
    (now.getFullYear() - startYM.getFullYear()) * 12 +
    (now.getMonth() - startYM.getMonth()) + 1;

  const results: Record<string, unknown> = {};

  for (const sido of ALLOWED_SIDOS) {
    try {
      const url = `${base}/api/market-stats?sido=${encodeURIComponent(sido)}&months=${months}&save=true`;
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
