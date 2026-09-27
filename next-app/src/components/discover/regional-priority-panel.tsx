'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { createRequestLimiter } from '@/lib/async-limit';
import { sigunguMatches } from '@/lib/regions';
import { monthShift } from '@/lib/report-model';
import { lastCompleteMonth, rankRegions, regionalIndicators, type PriorityStore } from '@/lib/regional-priority';

export interface PriorityPopulation { sido: string; sigungu: string; dong: string; month: string; population: number }
interface Snapshot { sido: string; sigungu: string; month: string }
interface Props {
  units: { sido: string; unit: string }[];
  population: PriorityPopulation[];
  stores: PriorityStore[];
  complete: boolean;
}
const matches = (sido: string, record: { sido: string; sigungu: string }, unit: string) =>
  record.sido === sido && (record.sigungu.startsWith(unit + ' ') || sigunguMatches(sido, record.sigungu, unit));
const pct = (n: number | null) => n === null ? '산출 보류' : `${n > 0 ? '+' : ''}${n.toFixed(1)}%`;

export function RegionalPriorityPanel({ units, population, stores, complete }: Props) {
  const [snapshots, setSnapshots] = useState<{ key: string; rows: Snapshot[] } | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const sidoKey = JSON.stringify([...new Set(units.map(u => u.sido))].sort());
  const asOf = lastCompleteMonth();
  useEffect(() => {
    let cancelled = false;
    const db = createClient(), limit = createRequestLimiter(4);
    const sidos: string[] = JSON.parse(sidoKey);
    if (!sidos.length) return;
    void (async () => {
      const from = monthShift(asOf, -35);
      const query = () => db.from('market_snapshots').select('sido,sigungu,month').in('sido', sidos).gte('month', from).lte('month', asOf);
      const { count, error: countError } = await db.from('market_snapshots').select('id', { count: 'exact', head: true }).in('sido', sidos).gte('month', from).lte('month', asOf);
      if (countError || count === null) throw new Error('수집 이력을 불러오지 못했습니다.');
      const pages = await Promise.all(Array.from({ length: Math.ceil(count / 1000) }, (_, i) => limit(async () => {
        const { data, error } = await query().order('id').range(i * 1000, i * 1000 + 999);
        if (error) throw error;
        return data ?? [];
      })));
      if (!cancelled) { setSnapshots({ key: sidoKey, rows: pages.flat() }); setError(''); }
    })().catch(() => { if (!cancelled) setError('수집 이력 확인 실패 — 순위를 산출하지 않습니다.'); });
    return () => { cancelled = true; };
  }, [sidoKey, asOf, retry]);

  const results = useMemo(() => rankRegions(units.map(({ sido, unit }) => {
    const popRows = population.filter(p => matches(sido, p, unit));
    const byMonth = new Map<string, number>();
    for (const p of popRows) byMonth.set(p.month, (byMonth.get(p.month) ?? 0) + p.population);
    const currentDongs = new Set(popRows.filter(p => p.month === asOf).map(p => p.dong));
    const priorDongs = new Set(popRows.filter(p => p.month === monthShift(asOf, -12)).map(p => p.dong));
    const sameDongs = currentDongs.size > 0 && currentDongs.size === priorDongs.size && [...currentDongs].every(d => priorDongs.has(d));
    const rows = snapshots?.key === sidoKey ? snapshots.rows.filter(r => matches(sido, r, unit)) : [];
    // For a city made up of districts, every observed district must have that month.
    const districts = [...new Set(rows.map(r => r.sigungu))];
    const collectedMonths = [...new Set(rows.map(r => r.month))].filter(m => districts.every(d => rows.some(r => r.sigungu === d && r.month === m)));
    const result = regionalIndicators({ key: `${sido}|${unit}`, label: `${sido} ${unit}`, asOf,
      population: sameDongs ? [...byMonth].map(([month, pop]) => ({ month, pop })) : [],
      stores: stores.filter(s => matches(sido, s, unit)), collectedMonths,
      complete: complete && snapshots?.key === sidoKey && !error });
    if (!sameDongs && currentDongs.size) result.issues.push('인구 동 구성 변경·누락 확인 필요');
    return result;
  })), [units, population, stores, complete, snapshots, sidoKey, asOf, error]);

  return <section className="mb-5 rounded-xl border border-slate-200 bg-white p-4" aria-label="지역 영업 우선순위">
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-sm font-bold text-slate-900">지역 영업 우선순위</h2>
      <span className="text-xs text-slate-500">완료월 {asOf} 기준 · 현재 조회 범위 내 비교</span>
    </div>
    <p className="mt-2 text-xs leading-5 text-slate-500">인구 전년 동월 대비 · 최근 3개월 신규는 전년 같은 3개월 대비 · 2년 생존은 24개월 관측을 마친 개업 매장 기준입니다. 진행 중인 달은 제외합니다.</p>
    {error && <p role="status" className="mt-2 text-xs text-amber-700">{error} <button className="underline" onClick={() => setRetry(n => n + 1)}>재시도</button></p>}
    {!complete && <p role="status" className="mt-2 text-xs text-blue-600">과거 매장 데이터 로딩 중이거나 일부 조회가 실패했습니다. 전체 조회 완료 후 순위를 산출합니다.</p>}
    <p className="mt-2 text-[11px] text-slate-400 md:hidden">표를 좌우로 밀면 생존 추정·신뢰도를 확인할 수 있습니다.</p>
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[690px] text-left text-xs">
        <thead className="bg-slate-50 text-slate-500"><tr>{['지역 / 참고점수', '인구증가율', '신규 증가 추세', '2년 생존 추정', '데이터 신뢰도 점검'].map(h => <th key={h} className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{results.map(r => <tr key={r.key} className="border-t border-slate-100 align-top">
          <td className="px-3 py-3 font-semibold text-slate-800">{r.label}<span className="mt-1 block text-blue-600">{r.score === null ? '순위 보류' : `${r.score}점`}</span></td>
          <td className="px-3 py-3">{pct(r.popGrowth)}</td>
          <td className="px-3 py-3">{pct(r.newGrowth)}<span className="mt-1 block text-slate-400">{r.prior} → {r.recent}건</span></td>
          <td className="px-3 py-3">{r.survival === null ? '산출 보류' : `${r.survival.toFixed(1)}%`}<span className="mt-1 block text-slate-400">표본 {r.cohort}곳</span></td>
          <td className="max-w-[240px] px-3 py-3"><span className={r.comparable ? 'text-blue-700' : 'text-amber-700'}>{r.comparable ? '비교 가능 · 추정치' : '보완 필요'}</span><span className="mt-1 block leading-5 text-slate-500">수집 기록 {r.coverage}/36개월{r.issues.length ? ` · ${r.issues.join(' · ')}` : ' · 기본 요건 충족'}</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    <details className="mt-3 text-xs leading-5 text-slate-500"><summary className="cursor-pointer">산출 기준과 신뢰도 한계</summary>
      <p className="mt-2">참고점수는 비교 가능한 지역 2곳 이상일 때 세 지표의 범위 내 백분위를 동일 비중으로 합산합니다. 영업 성과로 검증한 예측 점수가 아니며, 경쟁매장 밀도는 사용하지 않습니다. 데이터 신뢰도는 점수에 가산하지 않고 산출 가능 여부와 사유로 표시합니다.</p>
      <p>생존 표본: {monthShift(asOf, -35)}~{monthShift(asOf, -24)} 개업. 월 단위로 대조해 개업 후 24개월 안에 동일 상호·주소의 폐업이 없으면 생존으로 추정합니다. 반복 인허가는 표본에서 제외하고 30곳 미만은 산출하지 않습니다. 상호 변경·폐업 신고 누락은 실제 생존과 차이를 만들 수 있습니다.</p>
      <p>신규 비교는 전년 표본 10건 이상일 때 산출합니다. 수집 기록은 월별 스냅샷의 존재 여부로, 원천 데이터 누락이 없다는 보증은 아닙니다. 인구 동 구성이 다르면 증가율을 보류합니다. 아래 기존 기획보고서의 누적 인구 증감·12개월 신규와는 비교 기간이 다릅니다.</p>
    </details>
  </section>;
}
