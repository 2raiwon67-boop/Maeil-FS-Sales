import { isEligible } from './report-model';
import { sigunguMatches } from './regions';
type CommercialStore = { sido: string; sigungu: string; month: string; status: 'new' | 'closed'; category: string | null };

export interface CommercialRow {
  sido: string; sigungu: string; total: number;
  cafe: number; bakery: number; icecream: number; restaurant: number; pub: number;
  retail: number; service: number; office: number; education: number; medical: number; leisure: number;
  pop: number; adongs: number;
}
export interface CommercialScore extends CommercialRow {
  stock: number;     // FS 재고 = 카페+제과+빙수 (소진공 영업 중 기준)
  new12: number;     // 최근 12개월 FS 적격 개업
  closed12: number;  // 〃 폐업
  openRate: number;  // new12/stock ×100
  netRate: number;   // (new12-closed12)/stock ×100
  density: number;   // 카페 / 인구 1만명
  pScale: number; pDensity: number; pOpen: number; pNet: number; // 백분위 0~1
  score: number;     // 0~100
  rank: number;      // 1 = 최고
}
export interface AdongTop { adong_nm: string; total: number; cafe: number; restaurant: number; office: number; education: number }
export const COMM_W = { scale: 0.35, density: 0.15, open: 0.25, net: 0.25 } as const;
export const COMM_COLORS = { scale: '#2a78d6', density: '#1baf7a', open: '#eb6834', net: '#4a3aa7' } as const;
export const COMM_LABEL = { scale: '규모', density: '밀도', open: '개업률', net: '순증률' } as const;
function percentiles(vals: number[]): number[] {
  const n = vals.length;
  if (n <= 1) return vals.map(() => 1);
  return vals.map(v => vals.filter(x => x < v).length / (n - 1));
}
export function computeCommercialScores(rows: CommercialRow[], stores: CommercialStore[]): CommercialScore[] {
  if (!rows.length || !stores.length) return [];
  // 스코프 = 현재 로드된 매장 데이터의 (시도|시군구) — 상권 행 중 스코프에 속한 것만 채점
  const byKey = new Map(rows.map(r => [`${r.sido}|${r.sigungu}`, r]));
  const resolve = new Map<string, CommercialRow | null>();
  const flow = new Map<CommercialRow, { n: number; c: number }>();
  const months = [...new Set(stores.map(s => s.month))].sort();
  const from = months[Math.max(0, months.length - 12)];
  for (const s of stores) {
    const key = `${s.sido}|${s.sigungu}`;
    let r = resolve.get(key);
    if (r === undefined) {
      r = byKey.get(key) ?? rows.find(x => x.sido === s.sido && sigunguMatches(s.sido, s.sigungu, x.sigungu)) ?? null;
      resolve.set(key, r);
    }
    if (!r) continue;
    let f = flow.get(r);
    if (!f) { f = { n: 0, c: 0 }; flow.set(r, f); }
    if (s.month < from || !isEligible(s.category)) continue;
    if (s.status === 'new') f.n++; else f.c++;
  }
  const scoped = rows.filter(r => flow.has(r));
  if (!scoped.length) return [];
  const base = scoped.map(r => {
    const f = flow.get(r)!;
    const stock = r.cafe + r.bakery + r.icecream;
    return {
      ...r, stock, new12: f.n, closed12: f.c,
      openRate: stock ? f.n / stock * 100 : 0,
      netRate: stock ? (f.n - f.c) / stock * 100 : 0,
      density: r.pop > 0 ? r.cafe / r.pop * 10000 : 0,
    };
  });
  const pScale = percentiles(base.map(b => b.stock));
  const pDensity = percentiles(base.map(b => b.density));
  const pOpen = percentiles(base.map(b => b.openRate));
  const pNet = percentiles(base.map(b => b.netRate));
  const scored = base.map((b, i) => {
    const damp = Math.min(1, b.stock / 300); // 소규모(재고<300) 지역은 비율 지표를 감쇠 — 분모 작아 튀는 것 방지
    const p = { pScale: pScale[i], pDensity: pDensity[i], pOpen: pOpen[i] * damp, pNet: pNet[i] * damp };
    const score = Math.round(100 * (COMM_W.scale * p.pScale + COMM_W.density * p.pDensity + COMM_W.open * p.pOpen + COMM_W.net * p.pNet));
    return { ...b, ...p, score, rank: 0 };
  }).sort((a, b) => b.score - a.score || b.stock - a.stock);
  scored.forEach((s, i) => { s.rank = i + 1; });
  return scored;
}
