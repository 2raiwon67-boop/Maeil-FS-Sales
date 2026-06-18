import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // PWA 자산(sw.js, manifest)은 인증 없이 접근 가능해야 하므로 프록시에서 제외
  matcher: ['/((?!_next/static|_next/image|favicon.ico|assets|icons|geojson|sw.js|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
