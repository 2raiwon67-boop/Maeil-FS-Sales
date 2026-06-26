import { NextRequest, NextResponse } from 'next/server';

// 시장데이터 좌표 결측 보정용 일회성 도구 백엔드.
// GET: 좌표 결측 행(id,address) 페이지네이션 조회. POST: 클라가 지오코딩한 {id,lat,lng} 저장.
// 관리자 코드(x-admin-code) 검증 + Service Role Key로만 쓰기.

export const maxDuration = 60;

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ADMIN_CODE = process.env.ADMIN_CODE!;

const sb = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  'Content-Type': 'application/json',
};

const isAdmin = (req: NextRequest) => !!ADMIN_CODE && req.headers.get('x-admin-code') === ADMIN_CODE;

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: '관리자 인증 실패' }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const offset = Math.max(0, parseInt(searchParams.get('offset') || '0', 10) || 0);
  const limit = 1000;

  const url =
    `${SUPABASE_URL}/rest/v1/market_store_records` +
    `?or=(lat.is.null,lng.is.null)&address=neq.&select=id,address&order=id&limit=${limit}&offset=${offset}`;
  const r = await fetch(url, { headers: { ...sb, Prefer: 'count=exact' } });
  const rows = await r.json();
  const total = parseInt((r.headers.get('content-range') || '0-0/0').split('/')[1] || '0', 10);
  return NextResponse.json({ rows: Array.isArray(rows) ? rows : [], limit, total }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) return NextResponse.json({ error: '관리자 인증 실패' }, { status: 403 });

  let updates: { id: number; lat: number; lng: number }[];
  try {
    updates = (await req.json()).updates;
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  if (!Array.isArray(updates) || updates.length === 0) return NextResponse.json({ saved: 0 });

  let saved = 0;
  // 동시성 제한(20)으로 PATCH
  for (let i = 0; i < updates.length; i += 20) {
    const chunk = updates.slice(i, i + 20).filter(
      (u) => u && typeof u.id === 'number' && Number.isFinite(u.lat) && Number.isFinite(u.lng)
        && u.lat > 33 && u.lat < 39 && u.lng > 124 && u.lng < 132,
    );
    const res = await Promise.all(
      chunk.map((u) =>
        fetch(`${SUPABASE_URL}/rest/v1/market_store_records?id=eq.${u.id}`, {
          method: 'PATCH',
          headers: { ...sb, Prefer: 'return=minimal' },
          body: JSON.stringify({ lat: u.lat, lng: u.lng }),
        }).then((r) => r.ok),
      ),
    );
    saved += res.filter(Boolean).length;
  }
  return NextResponse.json({ saved });
}
