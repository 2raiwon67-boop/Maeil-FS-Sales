import { createClient } from '@/lib/supabase/server';
import { validatePerformance } from '@/lib/performance-diagnostics';

export async function POST(request: Request) {
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) return new Response(null, { status: 403 });
  if (Number(request.headers.get('content-length') || 0) > 4096) return new Response(null, { status: 413 });
  const db = await createClient();
  const { data: { user } } = await db.auth.getUser();
  if (!user) return new Response(null, { status: 401 });
  let sample;
  try {
    const raw = await request.text();
    if (raw.length > 4096) return new Response(null, { status: 413 });
    sample = validatePerformance(JSON.parse(raw));
  } catch { return new Response(null, { status: 400 }); }
  if (!sample) return new Response(null, { status: 400 });
  // Search Vercel runtime logs for this prefix. Retention follows the deployment plan.
  console.info('[miso-performance]', JSON.stringify(sample));
  return new Response(null, { status: 204 });
}
