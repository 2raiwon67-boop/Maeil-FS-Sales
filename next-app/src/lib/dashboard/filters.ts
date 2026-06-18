// 거래처 대시보드 필터 — 원본 filterMarkers / updateDashboard 로직 포팅
import type { NaverMarker } from '@/lib/naver/loader';
import type { License, Account } from '@/types';
import { MILK_BRANDS } from './constants';

export type SidebarTab = 'all' | 'license' | 'account';

export interface FilterState {
  tab: SidebarTab;
  rank: 'all' | '1' | '2';
  status: Set<string>; // 거래여부 (거래/미거래/인허가/공사중/DROP)
  milk: Set<string>; // 사용우유 (매일/서울/남양/연세/기타)
  region: Set<string>; // 지역 (인허가 주소2 / 거래처 주소 2번째 토큰)
  manager: Set<string>; // 담당자
  account: Set<string>; // 거래처 거래상태 (거래/미거래)
}

export function emptyFilters(): FilterState {
  return {
    tab: 'all',
    rank: 'all',
    status: new Set(),
    milk: new Set(),
    region: new Set(),
    manager: new Set(),
    account: new Set(),
  };
}

// 사이드바 드롭다운 정의
export const STATUS_ITEMS = [
  { key: '거래', label: '거래', color: '#0050FF' },
  { key: '미거래', label: '미거래', color: '#FF1A1A' },
  { key: '인허가', label: '인허가', color: '#00B33C' },
  { key: '공사중', label: '공사중', color: '#FF7700' },
  { key: 'DROP', label: 'DROP', color: '#8e8e93' },
] as const;

export const MILK_ITEMS = [
  { key: '매일', color: '#0071e3' },
  { key: '서울', color: '#ff3b30' },
  { key: '남양', color: '#ff9500' },
  { key: '연세', color: '#34c759' },
  { key: '기타', color: '#8e8e93' },
] as const;

export const ACCOUNT_ITEMS = [
  { key: '거래', label: '주요 기거래처', color: '#c8a000' },
  { key: '미거래', label: '주요 미거래처', color: '#8e8e93' },
] as const;

function isOtherMilk(milk: string): boolean {
  return !milk || !MILK_BRANDS.includes(milk as (typeof MILK_BRANDS)[number]);
}

/** 인허가 마커가 현재 필터에서 보여야 하는지 */
export function licenseMarkerVisible(m: NaverMarker, f: FilterState): boolean {
  if (f.tab === 'account') return false;
  const status = m._status || '';
  if (f.rank !== 'all' && m._rank !== f.rank) return false;
  if (f.status.size > 0 && !f.status.has(status)) return false;
  if (f.region.size > 0 && !f.region.has(m._region || '기타')) return false;
  if (f.manager.size > 0 && !f.manager.has(m._manager || '미지정')) return false;
  if (f.milk.size > 0) {
    const milk = m._milk || '';
    const matched = f.milk.has(milk) || (f.milk.has('기타') && isOtherMilk(milk));
    if (!matched) return false;
  }
  return true;
}

/** 거래처 마커가 현재 필터에서 보여야 하는지 */
export function accountMarkerVisible(m: NaverMarker, f: FilterState): boolean {
  if (f.tab === 'license') return false;
  const ds = (m._dealStatus || '').trim();
  if (f.account.size > 0 && !f.account.has(ds)) return false;
  if (f.region.size > 0 && ![...f.region].some((r) => (m._address || '').includes(r))) return false;
  if (f.manager.size > 0 && !f.manager.has((m._managerName || '').trim())) return false;
  return true;
}

// ── 사이드바 카운트 집계 ──────────────────────────────────────────

/** 순위/지역/담당자 필터를 적용한 인허가 데이터 (드롭다운 카운트용) */
function preFilterLicenses(licenses: License[], f: FilterState): License[] {
  return licenses.filter((d) => {
    if (f.rank !== 'all' && (d.priority || '') !== f.rank) return false;
    if (f.region.size > 0 && !f.region.has((d.address2 || '기타').trim())) return false;
    if (f.manager.size > 0 && !f.manager.has((d.manager || '미지정').trim())) return false;
    return true;
  });
}

export interface SidebarCounts {
  status: Record<string, number>;
  milk: Record<string, number>;
  account: Record<string, number>;
  regions: [string, number][];
  managers: [string, number][];
  successRate: number;
}

export function computeCounts(
  licenses: License[],
  accounts: Account[],
  f: FilterState,
): SidebarCounts {
  const fl = preFilterLicenses(licenses, f);

  // 거래여부 카운트
  const status: Record<string, number> = {};
  for (const it of STATUS_ITEMS) {
    status[it.key] = fl.filter((d) => (d.trade_status || '').trim() === it.key).length;
  }

  // 우유 카운트
  const milk: Record<string, number> = {};
  for (const d of fl) {
    const m = (d.milk_type || '').trim();
    if (!m) continue;
    const key = isOtherMilk(m) ? '기타' : m;
    milk[key] = (milk[key] || 0) + 1;
  }

  // 거래처 거래상태 카운트
  let fa = accounts;
  if (f.manager.size > 0) fa = fa.filter((a) => f.manager.has((a.manager_name || '').trim()));
  if (f.region.size > 0) fa = fa.filter((a) => [...f.region].some((r) => (a.address || '').includes(r)));
  const account: Record<string, number> = {};
  for (const it of ACCOUNT_ITEMS) {
    account[it.key] = fa.filter((a) => (a.trade_status || '').trim() === it.key).length;
  }

  // 지역 / 담당자 집계 (탭에 따라 소스 분기)
  const regionCounts: Record<string, number> = {};
  const managerCounts: Record<string, number> = {};

  if (f.tab !== 'account') {
    for (const d of fl) {
      const region = (d.address2 || '기타').trim();
      regionCounts[region] = (regionCounts[region] || 0) + 1;
      const m = (d.manager || '미지정').trim();
      managerCounts[m] = (managerCounts[m] || 0) + 1;
    }
  }
  if (f.tab !== 'license') {
    for (const a of fa) {
      const region = (a.address || '').split(' ')[1] || '기타';
      regionCounts[region] = (regionCounts[region] || 0) + 1;
      const m = (a.manager_name || '').trim() || '미지정';
      managerCounts[m] = (managerCounts[m] || 0) + 1;
    }
  }

  const regions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]);
  const managers = Object.entries(managerCounts).sort((a, b) => b[1] - a[1]);

  // 거래율 = 거래 / (거래 + 미거래)
  const deal = status['거래'] || 0;
  const nonDeal = status['미거래'] || 0;
  const successRate = deal + nonDeal > 0 ? Math.round((deal / (deal + nonDeal)) * 100) : 0;

  return { status, milk, account, regions, managers, successRate };
}

/** Set 토글 헬퍼 (불변 새 Set 반환) */
export function toggleInSet(set: Set<string>, key: string): Set<string> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}
