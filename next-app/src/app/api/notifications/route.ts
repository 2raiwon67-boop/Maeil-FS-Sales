import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { computeVisitTargets, type LicenseRow, type VisitTarget } from '@/lib/license-targets';

const TYPE_MAP: Record<VisitTarget['kind'], string> = {
  new: 'license_new',
  revisit: 'license_revisit',
  open: 'license_open',
};
const TITLE_MAP: Record<VisitTarget['kind'], string> = {
  new: '신규 방문 대상',
  revisit: '공사중 재확인',
  open: '오픈 추정',
};

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const meta = { ...(user.app_metadata || {}), ...(user.user_metadata || {}) } as {
    business_unit?: string;
    full_name?: string;
  };
  const businessUnit = (meta.business_unit || '').trim();
  const fullName = (meta.full_name || '').trim();

  let targets: VisitTarget[] = [];
  let computed = false;

  if (businessUnit) {
    const { data: lics, error } = await supabase
      .from('licenses')
      .select('id,business_name,business_unit,permit_date,trade_status,area,road_address,priority,manager,open_detected_at')
      .eq('business_unit', businessUnit)
      .limit(10000);

    if (!error) {
      computed = true;
      let rows = (lics || []) as LicenseRow[];
      // 본인 담당으로 좁히되, 매칭이 없으면(지점장·관리자 등) 지점 전체
      if (fullName) {
        const mine = rows.filter((r) => (r.manager || '').trim() === fullName);
        if (mine.length) rows = mine;
      }
      targets = computeVisitTargets(rows);
    }
  } else {
    computed = true; // 소속 없으면 대상도 없음 → 정리 대상
  }

  const currentKeys = new Set(targets.map((t) => t.dedupeKey));

  if (targets.length) {
    const payload = targets.map((t) => ({
      user_id: user.id,
      dedupe_key: t.dedupeKey,
      type: TYPE_MAP[t.kind],
      title: TITLE_MAP[t.kind],
      body: t.area ? `${t.name} · ${t.area}평` : t.name,
      link: `/?focus=${t.licenseId}`,
      business_unit: t.businessUnit,
    }));
    await supabase
      .from('notifications')
      .upsert(payload, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  }

  // 더 이상 방문 대상이 아닌 인허가 알림 정리 (조회 성공 시에만)
  if (computed) {
    const { data: existing } = await supabase
      .from('notifications')
      .select('id,dedupe_key')
      .eq('user_id', user.id)
      .like('type', 'license_%');
    const staleIds = (existing || [])
      .filter((n) => !currentKeys.has(n.dedupe_key))
      .map((n) => n.id);
    if (staleIds.length) {
      await supabase.from('notifications').delete().in('id', staleIds);
    }
  }

  const { data: items } = await supabase
    .from('notifications')
    .select('id,type,title,body,link,read_at,created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(100);

  const list = items || [];
  const unread = list.filter((n) => !n.read_at).length;
  return NextResponse.json({ items: list, unread });
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids: string[] | undefined = Array.isArray(body.ids) ? body.ids : undefined;

  let q = supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('read_at', null);
  if (ids && ids.length) q = q.in('id', ids);
  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
