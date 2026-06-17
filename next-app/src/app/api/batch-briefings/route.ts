import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
    return NextResponse.json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY' }, { status: 500 });
  }

  const marketResult: Record<string, any> = {};
  try {
    const host = req.headers.get('host') || 'maeilfs-sales.vercel.app';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const base = `${protocol}://${host}`;

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
