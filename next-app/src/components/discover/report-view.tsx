'use client';

// 보고작성 뷰 — 시군구 중심 기회 보고서 (사용자 공동 설계 2026-08-20 확정안)
// 구성: 요약 카드 → 시군구 사분면(버블) → 시군구별 판정 리스트(동 주석 접기) → 선택 시군구 인구 추이(선) → AI 분석
// 판정 A안: 선점(인구↑·공급 얇음) / 공략(인구↑·공급 활발) / 방어(인구↓·공급 지속) / 관찰(그 외)
// 데이터: 인구 = population_stats (법정동·월, RLS read) · 시장 = 부모(discover)가 가진 cachedStores 메모리
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Sparkles, MapPin, RefreshCw, Target } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { sigunguMatches, LEGACY_TO_CURRENT } from '@/lib/regions';

export interface ReportStore {
  name: string;
  sido: string;
  sigungu: string;
  month: string;
  status: 'new' | 'closed';
  category: string | null;
  pyeong: number | null;
  lat: number | null;
  lng: number | null;
  dong: string;
  addrKey: string;
}

interface Props {
  scope: Record<string, string[]>; // discover 시도(서울·인천·경기도·강원도) → 시군구 목록 (managers 관할)
  stores: ReportStore[];
}

// discover 시도 표기 → population_stats(행안부 ctpvNm) 표기
const POP_SIDO: Record<string, string> = {
  서울: '서울특별시', 인천: '인천광역시', 경기도: '경기도', 강원도: '강원특별자치도',
};

type Verdict = '선점' | '공략' | '방어' | '관찰';
const VERDICT_STYLE: Record<Verdict, { badge: string; dot: string }> = {
  선점: { badge: 'bg-green-50 text-green-700', dot: '#16a34a' },
  공략: { badge: 'bg-blue-50 text-blue-700', dot: '#2563eb' },
  방어: { badge: 'bg-red-50 text-red-600', dot: '#dc2626' },
  관찰: { badge: 'bg-slate-100 text-slate-500', dot: '#94a3b8' },
};

interface PopRow { sigungu: string; dong: string; month: string; population: number }

interface UnitMetric {
  name: string;
  sido: string;
  verdict: Verdict;
  pop: number;
  popChg: number; // % (첫 관측월 대비)
  new12m: number;
  operating: number;
  perCapita: number; // 1만명당 신규(12개월)
  popSeries: { month: string; pop: number }[];
  dongNotes: string;
  dongDetail: { dong: string; chg: number | null; pop: number; newCnt: number }[];
}

function matchUnit(sido: string, sgg: string, unit: string): boolean {
  return sgg === unit || sgg.startsWith(unit + ' ') || sigunguMatches(sido, sgg, unit);
}

export function ReportView({ scope, stores }: Props) {
  const [popRows, setPopRows] = useState<PopRow[] | null>(null);
  const [popError, setPopError] = useState('');
  const [selectedUnit, setSelectedUnit] = useState<string | null>(null);
  const [openDong, setOpenDong] = useState<string | null>(null);
  const [brief, setBrief] = useState('');
  const [briefLoading, setBriefLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const quadRef = useRef<HTMLCanvasElement>(null);
  const lineRef = useRef<HTMLCanvasElement>(null);

  const units = useMemo(() => {
    const all = Object.entries(scope).flatMap(([sido, list]) => list.map((u) => ({ sido, unit: u })));
    // 인천 행정구역 개편: managers에 옛 구명(중·동·서구)과 새 구명이 함께 있으면 옛 구명 제외.
    // sigunguMatches가 양쪽 모두에 같은 매장을 매칭시켜 이중 카운트되는 것 방지 (실측: 옛 서구 283 = 검단 117 + 서해 166).
    return all.filter(({ sido, unit }) => {
      const cur = LEGACY_TO_CURRENT[`${sido}|${unit}`];
      if (!cur) return true;
      return !all.some((o) => o.unit !== unit && cur.includes(o.unit));
    });
  }, [scope]);

  // ── 인구 로드 (관할 시군구 prefix, 페이지네이션) ──────────────────────────
  useEffect(() => {
    if (!units.length) return;
    let dead = false;
    (async () => {
      try {
        const supabase = createClient();
        const all: PopRow[] = [];
        for (const [sido, list] of Object.entries(scope)) {
          const popSido = POP_SIDO[sido];
          if (!popSido || !list.length) continue;
          // 옛 구명만 관할에 있는 경우에도 새 구명 인구 행을 가져오게 현재명 패턴 추가 (인천 개편)
          const patterns = new Set<string>();
          for (const u of list) {
            patterns.add(u);
            for (const cur of LEGACY_TO_CURRENT[`${sido}|${u}`] || []) patterns.add(cur);
          }
          const orExpr = [...patterns].map((u) => `sigungu.like.${u}%`).join(',');
          for (let from = 0; ; from += 1000) {
            const { data, error } = await supabase
              .from('population_stats')
              .select('sigungu,dong,month,population')
              .eq('sido', popSido)
              .or(orExpr)
              .order('id')
              .range(from, from + 999);
            if (error) throw new Error(error.message);
            all.push(...(data || []));
            if (!data || data.length < 1000) break;
          }
        }
        if (!dead) setPopRows(all);
      } catch (e) {
        if (!dead) setPopError((e as Error).message);
      }
    })();
    return () => { dead = true; };
  }, [scope, units.length]);

  // ── 지표 계산 ─────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    if (!popRows || !popRows.length || !stores.length) return null;
    const allMonths = [...new Set(popRows.map((r) => r.month))].sort();
    const firstM = allMonths[0];
    const lastM = allMonths[allMonths.length - 1];
    // 시장 최신 이벤트 월 기준 12개월 컷 (인구 월과 별개)
    const storeMonths = [...new Set(stores.map((s) => s.month))].sort();
    const lastStoreM = storeMonths[storeMonths.length - 1] || lastM;
    const cut = new Date(`${lastStoreM}-01`);
    cut.setMonth(cut.getMonth() - 11);
    const cut12 = `${cut.getFullYear()}-${String(cut.getMonth() + 1).padStart(2, '0')}`;

    const out: UnitMetric[] = [];
    for (const { sido, unit } of units) {
      const uPop = popRows.filter((r) => matchUnit(sido, r.sigungu, unit));
      if (!uPop.length) continue;
      const byMonth = new Map<string, number>();
      for (const r of uPop) byMonth.set(r.month, (byMonth.get(r.month) || 0) + r.population);
      const popSeries = allMonths.filter((m) => byMonth.has(m)).map((m) => ({ month: m, pop: byMonth.get(m)! }));
      // 동 증감 기준월 = 이 시군구의 첫 관측월 (전역 firstM을 쓰면 관측이 늦게 시작된 시군구의 모든 동이 '신설' 처리됨)
      const unitFirstM = popSeries[0]?.month || firstM;
      const dongFirst = new Map<string, number>();
      const dongLast = new Map<string, number>();
      for (const r of uPop) {
        if (r.month === unitFirstM) dongFirst.set(r.dong, r.population);
        if (r.month === lastM) dongLast.set(r.dong, r.population);
      }
      const popFirst = popSeries[0]?.pop || 0;
      const pop = popSeries[popSeries.length - 1]?.pop || 0;
      if (!popFirst || !pop) continue;
      const popChg = +(((pop - popFirst) / popFirst) * 100).toFixed(1);

      const uStores = stores.filter((s) => matchUnit(s.sido, s.sigungu, unit) || s.sigungu === unit);
      // 운영 중 판정: 마지막 이벤트 기준 — 폐업 후 재개업(closed월 < new월)은 운영 중으로 본다
      const byKey = new Map<string, { hasNew: boolean; newMonth: string; closedMonth: string; dong: string }>();
      for (const s of uStores) {
        const k = `${s.name}|${s.addrKey}`;
        const e = byKey.get(k) || { hasNew: false, newMonth: '', closedMonth: '', dong: s.dong };
        if (s.status === 'new') { e.hasNew = true; if (s.month > e.newMonth) e.newMonth = s.month; }
        if (s.status === 'closed' && s.month > e.closedMonth) e.closedMonth = s.month;
        byKey.set(k, e);
      }
      let new12m = 0, operating = 0;
      const dongNew = new Map<string, number>();
      for (const e of byKey.values()) {
        if (e.hasNew && e.newMonth >= cut12) {
          new12m++;
          dongNew.set(e.dong, (dongNew.get(e.dong) || 0) + 1);
        }
        if (e.hasNew && e.newMonth >= e.closedMonth) operating++;
      }
      const perCapita = +((new12m / pop) * 10000).toFixed(1);

      // 동 주석 — 인구 3천+ 동의 증감 상·하위. 분모(첫 관측월)가 1천 미만이면 %가 폭발(편입·분동 왜곡)하므로 '신설' 처리
      const dongDetail = [...dongLast.entries()]
        .filter(([, p]) => p >= 3000)
        .map(([d, p]) => {
          const f = dongFirst.get(d);
          return { dong: d, pop: p, chg: f && f >= 1000 ? +(((p - f) / f) * 100).toFixed(1) : null, newCnt: dongNew.get(d) || 0 };
        })
        .sort((a, b) => (b.chg ?? 999) - (a.chg ?? 999));
      const ups = dongDetail.filter((d) => d.chg === null || d.chg >= 5).slice(0, 3);
      const downs = dongDetail.filter((d) => d.chg !== null && d.chg <= -5).slice(-2);
      const fmt = (d: { dong: string; chg: number | null }) => (d.chg === null ? `${d.dong} 신설` : `${d.dong} ${d.chg > 0 ? '+' : ''}${d.chg}%`);
      const dongNotes = [...ups.map(fmt), ...downs.map(fmt)].join(' · ');

      out.push({ name: unit, sido, verdict: '관찰', pop, popChg, new12m, operating, perCapita, popSeries, dongNotes, dongDetail });
    }
    if (!out.length) return null;

    // 판정 — perCapita 중앙값 기준
    const sortedPC = out.map((u) => u.perCapita).sort((a, b) => a - b);
    const median = sortedPC[Math.floor(sortedPC.length / 2)];
    for (const u of out) {
      if (u.popChg >= 2) u.verdict = u.perCapita < median ? '선점' : '공략';
      else if (u.popChg <= -2) u.verdict = '방어';
      else u.verdict = '관찰';
    }
    out.sort((a, b) => b.popChg - a.popChg);
    return { units: out, firstM, lastM, cut12, median };
  }, [popRows, stores, units]);

  // 선택이 없으면 첫 시군구로 — 렌더 시 파생 (effect 내 동기 setState 금지 규칙)
  const effectiveUnit = selectedUnit ?? metrics?.units[0]?.name ?? null;

  // ── 차트 (chart.js 지연 로드) ─────────────────────────────────────────────
  useEffect(() => {
    if (!metrics || !quadRef.current) return;
    let chart: { destroy: () => void } | null = null;
    let dead = false;
    (async () => {
      const { Chart } = await import('chart.js/auto');
      if (dead || !quadRef.current) return;
      const us = metrics.units;
      const guides = {
        id: 'guides',
        afterDraw(ch: { ctx: CanvasRenderingContext2D; chartArea: { left: number; right: number; top: number; bottom: number }; scales: { x: { getPixelForValue: (v: number) => number }; y: { getPixelForValue: (v: number) => number } } }) {
          const { ctx, chartArea: a, scales: { x, y } } = ch;
          ctx.save();
          ctx.strokeStyle = 'rgba(100,116,139,0.4)';
          ctx.setLineDash([4, 4]);
          const y0 = y.getPixelForValue(0);
          ctx.beginPath(); ctx.moveTo(a.left, y0); ctx.lineTo(a.right, y0); ctx.stroke();
          const xm = x.getPixelForValue(metrics.median);
          ctx.beginPath(); ctx.moveTo(xm, a.top); ctx.lineTo(xm, a.bottom); ctx.stroke();
          ctx.restore();
        },
      };
      const labels = {
        id: 'labels',
        afterDatasetsDraw(ch: { ctx: CanvasRenderingContext2D; getDatasetMeta: (i: number) => { data: { x: number; y: number; options: { radius: number } }[] } }) {
          const { ctx } = ch;
          ctx.save();
          ctx.font = '11px sans-serif';
          ctx.fillStyle = '#64748b';
          ch.getDatasetMeta(0).data.forEach((el, i) => {
            ctx.fillText(us[i].name, el.x + el.options.radius + 3, el.y + 3);
          });
          ctx.restore();
        },
      };
      chart = new Chart(quadRef.current, {
        type: 'bubble',
        data: {
          datasets: [{
            data: us.map((u) => ({ x: u.perCapita, y: u.popChg, r: Math.max(6, Math.sqrt(u.operating) / 2.6) })),
            backgroundColor: us.map((u) => VERDICT_STYLE[u.verdict].dot + 'b3'),
            borderColor: us.map((u) => VERDICT_STYLE[u.verdict].dot),
            borderWidth: 1,
          }],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          onClick: (_e, els) => { if (els.length) setSelectedUnit(us[els[0].index].name); },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: (t) => `${us[t.dataIndex].name}: 인구 ${us[t.dataIndex].popChg > 0 ? '+' : ''}${us[t.dataIndex].popChg}% · 1만명당 신규 ${us[t.dataIndex].perCapita}곳 · 운영 ${us[t.dataIndex].operating}곳` } },
          },
          scales: {
            x: { title: { display: true, text: '인구 1만명당 신규 개업 (12개월)', font: { size: 11 }, color: '#94a3b8' }, ticks: { color: '#94a3b8', font: { size: 11 } }, grid: { color: 'rgba(148,163,184,0.15)' } },
            y: { title: { display: true, text: `인구 증감 % (${metrics.firstM} 대비)`, font: { size: 11 }, color: '#94a3b8' }, ticks: { color: '#94a3b8', font: { size: 11 }, callback: (v) => v + '%' }, grid: { color: 'rgba(148,163,184,0.15)' } },
          },
        },
        plugins: [guides as never, labels as never],
      });
    })();
    return () => { dead = true; chart?.destroy(); };
  }, [metrics]);

  useEffect(() => {
    if (!metrics || !effectiveUnit || !lineRef.current) return;
    const u = metrics.units.find((x) => x.name === effectiveUnit);
    if (!u) return;
    let chart: { destroy: () => void } | null = null;
    let dead = false;
    (async () => {
      const { Chart } = await import('chart.js/auto');
      if (dead || !lineRef.current) return;
      const lbls = u.popSeries.map((p, i) => (p.month.endsWith('-01') || i === 0 ? p.month.slice(2).replace('-', '.') : ''));
      chart = new Chart(lineRef.current, {
        type: 'line',
        data: { labels: lbls, datasets: [{ data: u.popSeries.map((p) => p.pop), borderColor: VERDICT_STYLE[u.verdict].dot, borderWidth: 2, pointRadius: 0, tension: 0.3 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { title: (t) => u.popSeries[t[0].dataIndex].month, label: (t) => (t.parsed.y ?? 0).toLocaleString() + '명' } } },
          scales: {
            x: { ticks: { color: '#94a3b8', font: { size: 11 }, autoSkip: false, maxRotation: 0, callback: (_v, i) => lbls[i] || null }, grid: { display: false } },
            y: { ticks: { color: '#94a3b8', font: { size: 11 }, callback: (v) => (Number(v) / 10000).toFixed(0) + '만' }, grid: { color: 'rgba(148,163,184,0.15)' } },
          },
        },
      });
    })();
    return () => { dead = true; chart?.destroy(); };
  }, [metrics, effectiveUnit]);

  // ── AI 분석 (서버 캐시 — 같은 범위·월은 재생성 없음) ──────────────────────
  useEffect(() => {
    if (!metrics || brief || briefLoading) return;
    let dead = false;
    (async () => {
      setBriefLoading(true);
      try {
        const r = await fetch('/api/report-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            scopeKey: metrics.units.map((u) => u.name).join(','),
            month: metrics.lastM,
            units: metrics.units.map((u) => ({
              name: u.name, label: u.verdict, popChg: u.popChg, pop: u.pop,
              new12m: u.new12m, operating: u.operating, perCapita: u.perCapita, dongNotes: u.dongNotes,
            })),
          }),
        });
        const j = await r.json();
        if (!dead) setBrief(r.ok ? j.text : `(${j.error || 'AI 분석 실패'})`);
      } catch {
        if (!dead) setBrief('(AI 분석 요청 실패 — 새로고침 시 재시도)');
      } finally {
        if (!dead) setBriefLoading(false);
      }
    })();
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metrics]);

  // ── 개척 활동 생성 — 현재 운영 중(개업 후 미폐업) 신규 매장만 타겟 (사용자 확정) ──
  async function createCampaign(u: UnitMetric) {
    if (creating) return;
    setCreating(u.name);
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      const bu = user?.user_metadata?.business_unit;
      if (!user || !bu) throw new Error('로그인 정보를 확인할 수 없습니다');

      // 타겟: 12개월 신규 & 운영 중(마지막 이벤트가 개업 — 재개업 포함, metrics와 동일 규칙) & 좌표 보유, 최대 60곳
      const byKey = new Map<string, { store: ReportStore; newMonth: string; closedMonth: string }>();
      for (const s of stores) {
        if (!(matchUnit(s.sido, s.sigungu, u.name) || s.sigungu === u.name)) continue;
        const k = `${s.name}|${s.addrKey}`;
        const e = byKey.get(k) || { store: s, newMonth: '', closedMonth: '' };
        if (s.status === 'new' && s.month > e.newMonth) { e.newMonth = s.month; e.store = s; }
        if (s.status === 'closed' && s.month > e.closedMonth) e.closedMonth = s.month;
        byKey.set(k, e);
      }
      const targets = [...byKey.values()]
        .filter((e) => e.newMonth && e.newMonth >= e.closedMonth && e.newMonth >= (metrics?.cut12 || '') && e.store.lat != null && e.store.lng != null)
        .sort((a, b) => b.newMonth.localeCompare(a.newMonth))
        .slice(0, 60)
        .map((e) => e.store);
      if (!targets.length) { toast.error('등록할 운영 중 신규 매장이 없습니다.'); return; }

      // 주소는 지연 로드 컬럼 — 타겟분만 조회해 채움
      const addrMap = new Map<string, string>();
      for (let i = 0; i < targets.length; i += 100) {
        const { data } = await supabase.from('market_store_records')
          .select('name,addr_key,address')
          .in('addr_key', targets.slice(i, i + 100).map((t) => t.addrKey))
          .eq('status', 'new');
        for (const r of data || []) if (r.address) addrMap.set(`${r.name}|${r.addr_key}`, r.address);
      }

      const today = new Date();
      const end = new Date(today); end.setDate(end.getDate() + 30);
      const iso = (d: Date) => d.toISOString().split('T')[0];
      const { data: camp, error: campErr } = await supabase.from('prospect_campaigns')
        .insert({ business_unit: bu, title: `${u.name} ${u.verdict} 개척 (${metrics?.lastM})`, start_date: iso(today), end_date: iso(end), created_by: user.id })
        .select('id').single();
      if (campErr || !camp) throw new Error(campErr?.message || '활동 생성 실패');

      // 이메일 폴백 금지 — prospects는 유닛 구성원 전체가 보므로 이메일 노출 안 함 (개척 모드 '미지정' 관행 준수)
      const managerName = user.user_metadata?.full_name || '미지정';
      const rows = targets.map((t) => ({
        business_unit: bu, campaign_id: camp.id, name: t.name,
        address: addrMap.get(`${t.name}|${t.addrKey}`) || null,
        manager_name: managerName,
        lat: t.lat, lng: t.lng, stage: '타겟', potential: '중',
        memo: `보고작성 자동 등록 · ${t.category || '-'} · ${t.pyeong ? Math.round(t.pyeong) + '평' : '평수 미상'} · 개업 ${t.month}`,
        created_by: user.id,
      }));
      try {
        for (let i = 0; i < rows.length; i += 100) {
          const { error } = await supabase.from('prospects').insert(rows.slice(i, i + 100));
          if (error) throw new Error(error.message);
        }
      } catch (e) {
        // 타겟 등록 실패 시 빈 캠페인이 남지 않게 롤백 (campaign 삭제는 prospects CASCADE)
        await supabase.from('prospect_campaigns').delete().eq('id', camp.id);
        throw e;
      }
      toast.success(`'${u.name} ${u.verdict} 개척' 활동에 타겟 ${rows.length}곳을 등록했습니다. 거래처 홈 → 개척 모드에서 확인하세요.`);
    } catch (e) {
      toast.error('개척 활동 생성 실패: ' + (e as Error).message);
    } finally {
      setCreating(null);
    }
  }

  // ── 렌더 ─────────────────────────────────────────────────────────────────
  if (popError) return <div className="p-8 text-center text-sm text-red-500">인구 데이터 로드 실패: {popError}</div>;
  if (!metrics) {
    // popRows 로드가 끝났는데 지표가 없으면 관할 매칭 실패 — 스피너를 영원히 돌리지 않고 안내
    if (popRows !== null && stores.length > 0) {
      return (
        <div className="p-10 text-center text-sm text-slate-400">
          관할 시군구의 인구 데이터가 없습니다.<br />
          <span className="text-xs">담당자관리의 지역명과 인구 통계 지역명이 일치하는지 확인해 주세요.</span>
        </div>
      );
    }
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-400">
        <RefreshCw size={15} className="animate-spin" />
        {popRows === null ? '인구 데이터 불러오는 중…' : '시장 데이터 대기 중…'}
      </div>
    );
  }

  const totalPop = metrics.units.reduce((s, u) => s + u.pop, 0);
  const totalNew = metrics.units.reduce((s, u) => s + u.new12m, 0);
  const cnt = (v: Verdict) => metrics.units.filter((u) => u.verdict === v).length;
  const sel = metrics.units.find((x) => x.name === effectiveUnit);

  return (
    <div className="mx-auto max-w-[980px] px-5 pb-16 pt-4 max-sm:pt-[52px]">
      <div className="mb-3 flex items-baseline justify-between gap-3 flex-wrap">
        <div className="text-[13px] font-semibold text-slate-600">
          관할 시군구 기회 보고서 <span className="font-normal text-slate-400">· 인구 {metrics.firstM}~{metrics.lastM} · 신규 개업 최근 12개월</span>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-3 gap-3 max-sm:grid-cols-1">
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold text-slate-400">관할 인구 ({metrics.units.length}개 시군구)</div>
          <div className="mt-1 text-xl font-bold text-slate-800 tabular-nums">{(totalPop / 10000).toFixed(1)}만</div>
        </div>
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold text-slate-400">신규 개업 (12개월)</div>
          <div className="mt-1 text-xl font-bold text-slate-800 tabular-nums">{totalNew.toLocaleString()}곳</div>
        </div>
        <div className="rounded-xl bg-white p-4 ring-1 ring-slate-100">
          <div className="text-[11px] font-semibold text-slate-400">판정</div>
          <div className="mt-1 text-xl font-bold text-slate-800">선점 {cnt('선점')} · 공략 {cnt('공략')} · 방어 {cnt('방어')}</div>
        </div>
      </div>

      <div className="mb-1 text-[13px] font-semibold text-slate-700">
        시군구 기회 사분면 <span className="font-normal text-slate-400">— 가로: 1만명당 신규 · 세로: 인구 증감 · 크기: 운영 매장 · 점 클릭 시 아래 추이 전환</span>
      </div>
      <div className="mb-2 flex flex-wrap gap-3 text-[12px] text-slate-500">
        {(['선점', '공략', '방어', '관찰'] as Verdict[]).map((v) => (
          <span key={v} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: VERDICT_STYLE[v].dot }} />{v}
          </span>
        ))}
      </div>
      <div className="relative mb-5 h-[320px] rounded-xl bg-white p-3 ring-1 ring-slate-100">
        <canvas ref={quadRef} />
      </div>

      <div className="mb-1 text-[13px] font-semibold text-slate-700">시군구별 판정 <span className="font-normal text-slate-400">— 행 클릭: 동 상세</span></div>
      <div className="mb-5 flex flex-col gap-1.5">
        {metrics.units.map((u) => (
          <div key={u.name} className="rounded-xl bg-white ring-1 ring-slate-100">
            <div className="flex cursor-pointer items-center gap-2.5 px-3.5 py-2.5" onClick={() => { setOpenDong(openDong === u.name ? null : u.name); setSelectedUnit(u.name); }}>
              <span className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-bold ${VERDICT_STYLE[u.verdict].badge}`}>{u.verdict}</span>
              <span className="text-sm font-semibold text-slate-800">{u.name}</span>
              <span className="min-w-0 flex-1 truncate text-[12px] text-slate-500">
                인구 {u.popChg > 0 ? '+' : ''}{u.popChg}%{u.popSeries.length < 40 ? ` (관측 ${u.popSeries.length}개월)` : ''} · 신규 {u.new12m}곳 · 운영 {u.operating}곳 · 1만명당 {u.perCapita}곳
              </span>
              {(u.verdict === '선점' || u.verdict === '공략') && (
                <button
                  disabled={creating !== null}
                  onClick={(e) => { e.stopPropagation(); void createCampaign(u); }}
                  className="shrink-0 rounded-lg bg-[#5856d6] px-2.5 py-1.5 text-[11px] font-semibold text-white disabled:opacity-40"
                >
                  <Target size={11} className="mr-1 inline" />{creating === u.name ? '생성 중…' : '개척 활동 만들기'}
                </button>
              )}
            </div>
            {openDong === u.name && (
              <div className="border-t border-slate-50 px-3.5 py-2.5">
                {u.dongNotes && (
                  <div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[12px] text-slate-600">
                    <MapPin size={12} className="mr-1 inline text-slate-400" />주도 지역: {u.dongNotes}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 md:grid-cols-3">
                  {u.dongDetail.slice(0, 12).map((d) => (
                    <div key={d.dong} className="flex items-baseline justify-between text-[12px]">
                      <span className="text-slate-600">{d.dong}</span>
                      <span className="tabular-nums text-slate-400">
                        <span className={d.chg === null ? 'text-blue-500' : d.chg >= 5 ? 'text-green-600' : d.chg <= -5 ? 'text-red-500' : ''}>
                          {d.chg === null ? '신설' : `${d.chg > 0 ? '+' : ''}${d.chg}%`}
                        </span>
                        {' '}· 신규 {d.newCnt}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      {sel && (
        <>
          <div className="mb-1 text-[13px] font-semibold text-slate-700">
            인구 추이 <span className="font-normal text-slate-400">— {sel.name} ({sel.popChg > 0 ? '+' : ''}{sel.popChg}%)</span>
          </div>
          <div className="relative mb-5 h-[200px] rounded-xl bg-white p-3 ring-1 ring-slate-100">
            <canvas ref={lineRef} />
          </div>
        </>
      )}

      <div className="rounded-r-xl border-l-[3px] border-[#5856d6] bg-white px-4 py-3.5 ring-1 ring-slate-100">
        <div className="mb-1.5 text-[13px] font-semibold text-slate-700">
          <Sparkles size={13} className="mr-1 inline text-[#5856d6]" />AI 분석
        </div>
        {briefLoading ? (
          <div className="text-[13px] text-slate-400">분석 생성 중…</div>
        ) : (
          <div className="whitespace-pre-wrap text-[13px] leading-relaxed text-slate-600">{brief}</div>
        )}
      </div>
    </div>
  );
}
