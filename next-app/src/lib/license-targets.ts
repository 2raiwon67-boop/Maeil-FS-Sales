// 인허가 방문 대상 타겟팅 (공용) — send-license-alert(이메일)와 /api/notifications(인앱 벨)가 공유.
// 규칙: 1·2순위 사업장 기준
//  · 신규(new):    인허가 후 14일 경과 + 상태 '인허가'
//  · 재확인(revisit): 공사중 28일 경과 + 오픈 미감지
//  · 오픈(open):    공사중 + 오픈 감지됨(open_detected_at)

export interface LicenseRow {
  id: string;
  business_name: string | null;
  business_unit: string | null;
  permit_date: string | null;
  trade_status: string | null;
  area: string | null;
  road_address: string | null;
  priority: string | null;
  manager: string | null;
  open_detected_at: string | null;
}

export type VisitTargetKind = 'new' | 'revisit' | 'open';

export interface VisitTarget {
  kind: VisitTargetKind;
  dedupeKey: string;
  licenseId: string;
  name: string;
  area: string;
  permitDate: string;
  address: string;
  manager: string;
  businessUnit: string;
  days: number;
}

export function computeVisitTargets(
  licenses: LicenseRow[],
  opts: { today?: Date } = {},
): VisitTarget[] {
  const today = opts.today ? new Date(opts.today) : new Date();
  today.setHours(0, 0, 0, 0);
  const DAY = 1000 * 60 * 60 * 24;

  const out: VisitTarget[] = [];
  for (const row of licenses) {
    const rank = String(row.priority || '').replace(/[^0-9]/g, '');
    if (rank !== '1' && rank !== '2') continue;

    const status = (row.trade_status || '').trim();
    if (!row.permit_date) continue;
    const pd = new Date(row.permit_date);
    if (isNaN(pd.getTime())) continue;
    pd.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - pd.getTime()) / DAY);

    let kind: VisitTargetKind | null = null;
    if (days >= 14 && status === '인허가') kind = 'new';
    else if (days >= 28 && status === '공사중' && !row.open_detected_at) kind = 'revisit';
    else if (status === '공사중' && row.open_detected_at) kind = 'open';
    if (!kind) continue;

    out.push({
      kind,
      dedupeKey: `${kind}:${row.id}`,
      licenseId: row.id,
      name: row.business_name || '(상호 미상)',
      area: row.area || '',
      permitDate: row.permit_date,
      address: row.road_address || '',
      manager: row.manager || '',
      businessUnit: row.business_unit || '',
      days,
    });
  }
  return out;
}
