import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

// 시장 분석(상권) 데이터 야간 갱신 Cron — 매일 03:00 KST(vercel.json `0 18 * * *`).
// 경기도·서울·인천의 market-stats를 최근 2개월치 save=true로 호출해
// market_snapshots(집계)·market_store_records(개별 매장)를 새로고침한다.
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 실제 저장은 내부 호출되는 market-stats가 수행 — 여기서는 필수 env만 조기 검증
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const marketResult: Record<string, any> = {};
  try {
    // ⚠️ req host 사용 금지: Vercel cron은 "배포 전용 URL"로 들어오는데, 그 호스트로 내부 재호출하면
    // Deployment Protection(SSO)에 막혀 조용히 실패함(2026-07 크론 장기 불발의 원인).
    // 항상 공개 프로덕션 도메인 기준으로 호출한다. (로컬 개발은 host가 localhost일 때만 예외)
    const reqHost = req.headers.get('host') || '';
    const base = reqHost.includes('localhost')
      ? `http://${reqHost}`
      : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'maeilfs-sales.vercel.app'}`;

    await Promise.all(
      ['경기도', '서울', '인천'].map(async (sido) => {
        try {
          const url = `${base}/api/market-stats?sido=${encodeURIComponent(sido)}&months=2&save=true`;
          const r = await fetch(url, { headers: { Authorization: authHeader || '' } });
          const j = await r.json();
          marketResult[sido] = j.saved ?? { error: j.error };
        } catch (e: any) {
          marketResult[sido] = { error: e.message };
        }
      }),
    );
  } catch {}

  return NextResponse.json({ market: marketResult });
}
