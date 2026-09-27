import { monthShift } from './report-model';

export interface PriorityStore {
  name: string; addrKey: string; month: string; status: 'new' | 'closed';
  sido: string; sigungu: string;
}
export interface PopulationPoint { month: string; pop: number }
export interface PriorityInput {
  key: string; label: string; population: PopulationPoint[]; stores: PriorityStore[];
  collectedMonths: string[]; complete: boolean; asOf: string;
}

/** Completed calendar months only, in Korean business time. */
export function lastCompleteMonth(now = new Date()) {
  const current = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit' }).format(now);
  return monthShift(current, -1);
}

function months(from: string, to: string) {
  const result: string[] = [];
  for (let m = from; m <= to; m = monthShift(m, 1)) result.push(m);
  return result;
}

export function regionalIndicators(input: PriorityInput) {
  const { asOf, stores } = input;
  const cohortStart = monthShift(asOf, -35), cohortEnd = monthShift(asOf, -24);
  const recentStart = monthShift(asOf, -2), priorStart = monthShift(asOf, -14), priorEnd = monthShift(asOf, -12);
  const available = new Set(input.collectedMonths);
  const covered = (from: string, to: string) => months(from, to).every(m => available.has(m));
  const currentPop = input.population.find(p => p.month === asOf)?.pop;
  const priorPop = input.population.find(p => p.month === monthShift(asOf, -12))?.pop;
  const popGrowth = currentPop != null && priorPop != null && priorPop > 0 ? (currentPop / priorPop - 1) * 100 : null;
  // A database row id identifies an event, not an establishment. Never claim exact survival.
  const events = new Map<string, { opens: Set<string>; closes: Set<string> }>();
  let missingIdentity = 0;
  for (const s of stores) {
    if (s.month > asOf || s.month < cohortStart) continue;
    if (!s.name.trim() || !s.addrKey.trim()) { missingIdentity++; continue; }
    const key = JSON.stringify([s.sido, s.sigungu, s.name.trim(), s.addrKey.trim()]);
    const entry = events.get(key) ?? { opens: new Set<string>(), closes: new Set<string>() };
    (s.status === 'new' ? entry.opens : entry.closes).add(s.month);
    events.set(key, entry);
  }
  let recent = 0, prior = 0, cohort = 0, closed24 = 0, ambiguous = 0;
  for (const e of events.values()) {
    const opens = [...e.opens].sort();
    // Count opening events once per establishment/month, including genuine reopenings.
    recent += opens.filter(m => m >= recentStart).length;
    prior += opens.filter(m => m >= priorStart && m <= priorEnd).length;
    const opened = opens.find(m => m >= cohortStart && m <= cohortEnd);
    if (!opened) continue;
    // Repeated licenses under one name/address are not independent stores.
    if (opens.length > 1) { ambiguous++; continue; }
    cohort++;
    if ([...e.closes].some(m => m >= opened && m <= monthShift(opened, 24))) closed24++;
  }
  const trendCovered = input.complete && covered(priorStart, priorEnd) && covered(recentStart, asOf);
  const survivalCovered = input.complete && covered(cohortStart, asOf);
  const newGrowth = trendCovered && prior >= 10 ? (recent / prior - 1) * 100 : null;
  const survival = survivalCovered && cohort >= 30 ? (cohort - closed24) / cohort * 100 : null;
  const issues: string[] = [];
  if (!input.complete) issues.push('원본 로딩 미완료');
  if (popGrowth === null) issues.push('동일 기준월 인구 비교 불가');
  if (!trendCovered) issues.push('신규 비교월 수집 기록 부족');
  if (prior < 10) issues.push('전년 신규 표본 10건 미만');
  if (!survivalCovered) issues.push('36개월 수집 기록 부족');
  if (cohort < 30) issues.push('생존 표본 30곳 미만');
  if (missingIdentity) issues.push(`상호·주소 누락 ${missingIdentity}건`);
  if (ambiguous) issues.push(`반복 인허가 ${ambiguous}곳 생존표본 제외`);
  const coverage = months(cohortStart, asOf).filter(m => available.has(m)).length;
  return { ...input, popGrowth, newGrowth, survival, recent, prior, cohort, closed24, ambiguous, missingIdentity,
    coverage, cohortStart, cohortEnd, recentStart, priorStart, priorEnd, issues,
    // Quality is a disclosed eligibility gate, not a made-up probability of correctness.
    comparable: popGrowth !== null && newGrowth !== null && survival !== null && missingIdentity === 0,
  };
}

export type RegionalIndicators = ReturnType<typeof regionalIndicators>;

/** Equal weights are a provisional business rule; ranks are only within the displayed scope. */
export function rankRegions(rows: RegionalIndicators[]) {
  const pool = rows.filter(r => r.comparable);
  const percentile = (value: number, values: number[]) => values.length < 2 ? 50
    : 100 * (values.filter(v => v < value).length + (values.filter(v => v === value).length - 1) / 2) / (values.length - 1);
  const scored = rows.map(row => ({ ...row, score: row.comparable && pool.length >= 2
    ? Math.round((percentile(row.popGrowth!, pool.map(r => r.popGrowth!))
      + percentile(row.newGrowth!, pool.map(r => r.newGrowth!))
      + percentile(row.survival!, pool.map(r => r.survival!))) / 3) : null }));
  return scored.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.label.localeCompare(b.label, 'ko'));
}
