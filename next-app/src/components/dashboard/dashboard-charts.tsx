'use client';

// Phase 4 — 대시보드 차트 3종 (지역별 분포 / 거래상태 / 사용우유) + 크로스 필터
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  type Chart as ChartType,
  type ChartOptions,
} from 'chart.js';
import type { License } from '@/types';

Chart.register(
  BarController,
  BarElement,
  LineController,
  LineElement,
  PointElement,
  DoughnutController,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
);

const COLOR_PALETTE = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#8E8E93'];
const MILK_PALETTE = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#5856D6', '#8E8E93', '#AF52DE', '#30B0C7'];

interface CrossData {
  matrix: Record<string, Record<string, number>>;
  regionCount: Record<string, number>;
  statusCount: Record<string, number>;
  regionLabels: string[];
  statusLabels: string[];
  statusColorMap: Record<string, string>;
  milkCount: Record<string, number>;
  successRate: number;
}

const donutLabelPlugin = {
  id: 'donutSegmentLabels',
  afterDatasetsDraw(chart: ChartType) {
    const { ctx, data } = chart;
    const meta = chart.getDatasetMeta(0);
    if (!meta?.data) return;
    const total = ((data.datasets[0].data as number[]) || []).reduce((a, b) => a + (b || 0), 0);
    if (!total) return;
    meta.data.forEach((arc, i) => {
      const value = (data.datasets[0].data[i] as number) || 0;
      const pct = Math.round((value / total) * 100);
      if (pct < 4) return;
      // @ts-expect-error chart.js arc geometry props
      const { startAngle, endAngle, innerRadius, outerRadius, x, y } = arc;
      const midAngle = startAngle + (endAngle - startAngle) / 2;
      const r = (innerRadius + outerRadius) / 2;
      ctx.save();
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 11px Pretendard, sans-serif';
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 3;
      ctx.fillText(pct + '%', x + Math.cos(midAngle) * r, y + Math.sin(midAngle) * r);
      ctx.restore();
    });
  },
};

function computeCross(licenses: License[]): CrossData {
  const statusCount: Record<string, number> = {
    거래: 0, 미거래: 0, 인허가: 0, 공사중: 0, DROP: 0, 기타: 0,
  };
  const regionCount: Record<string, number> = {};
  const milkCount: Record<string, number> = {};
  const matrix: Record<string, Record<string, number>> = {};

  licenses.forEach((d) => {
    const name = (d.business_name || '').trim();
    if (!name) return;
    const status = (d.trade_status || '').trim() || '미기입';
    const region = (d.address2 || '').trim() || '기타';
    statusCount[status] = (statusCount[status] || 0) + 1;
    regionCount[region] = (regionCount[region] || 0) + 1;
    if (!matrix[region]) matrix[region] = {};
    matrix[region][status] = (matrix[region][status] || 0) + 1;
  });

  licenses.forEach((d) => {
    const milk = (d.milk_type || '').trim();
    if (milk) milkCount[milk] = (milkCount[milk] || 0) + 1;
  });

  const statusLabels = Object.keys(statusCount)
    .filter((k) => statusCount[k] > 0)
    .sort((a, b) => statusCount[b] - statusCount[a]);
  const statusColorMap: Record<string, string> = {};
  statusLabels.forEach((s, i) => {
    statusColorMap[s] = COLOR_PALETTE[i % COLOR_PALETTE.length];
  });
  const regionLabels = Object.keys(regionCount)
    .filter((k) => k !== '기타' && regionCount[k] > 0)
    .sort((a, b) => regionCount[b] - regionCount[a]);

  const deal = statusCount['거래'] || 0;
  const nonDeal = statusCount['미거래'] || 0;
  const successRate = deal + nonDeal > 0 ? Math.round((deal / (deal + nonDeal)) * 100) : 0;

  return { matrix, regionCount, statusCount, regionLabels, statusLabels, statusColorMap, milkCount, successRate };
}

// 월별 신규 인허가 유입 + 그중 현재 '거래' 전환 수 (최근 12개월, permit_date 기준)
function computeMonthlyIntake(licenses: License[]) {
  const months: string[] = [];
  const now = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const intake = new Map(months.map(m => [m, { total: 0, deal: 0 }]));
  licenses.forEach((d) => {
    const mo = (d.permit_date || '').slice(0, 7);
    const o = intake.get(mo);
    if (!o) return;
    o.total++;
    if ((d.trade_status || '').trim() === '거래') o.deal++;
  });
  return { months, rows: months.map(m => intake.get(m)!) };
}

// 담당자별 상태 분포 + 거래율 (담당 물량 많은 순)
const MANAGER_STATUS_ORDER = ['거래', '공사중', '인허가', '미거래', 'DROP'];
function computeByManager(licenses: License[]) {
  const m = new Map<string, Record<string, number>>();
  licenses.forEach((d) => {
    const mgr = (d.manager || '').trim() || '미지정';
    const status = (d.trade_status || '').trim() || '기타';
    let o = m.get(mgr);
    if (!o) { o = {}; m.set(mgr, o); }
    o[status] = (o[status] || 0) + 1;
  });
  return [...m.entries()]
    .map(([mgr, counts]) => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      const deal = counts['거래'] || 0;
      const nonDeal = counts['미거래'] || 0;
      return { mgr, counts, total, rate: deal + nonDeal > 0 ? Math.round((deal / (deal + nonDeal)) * 100) : 0 };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 10);
}

// 업태별 규모 + 거래율 (상위 8개)
function computeByType(licenses: License[]) {
  const m = new Map<string, { total: number; deal: number; nonDeal: number }>();
  licenses.forEach((d) => {
    const t = (d.business_type || '').trim() || '미분류';
    let o = m.get(t);
    if (!o) { o = { total: 0, deal: 0, nonDeal: 0 }; m.set(t, o); }
    o.total++;
    const s = (d.trade_status || '').trim();
    if (s === '거래') o.deal++;
    else if (s === '미거래') o.nonDeal++;
  });
  return [...m.entries()]
    .map(([type, o]) => ({ type, ...o, rate: o.deal + o.nonDeal > 0 ? Math.round((o.deal / (o.deal + o.nonDeal)) * 100) : 0 }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8);
}

export function DashboardCharts({ licenses }: { licenses: License[] }) {
  const cross = useMemo(() => computeCross(licenses), [licenses]);
  const monthly = useMemo(() => computeMonthlyIntake(licenses), [licenses]);
  const byManager = useMemo(() => computeByManager(licenses), [licenses]);
  const byType = useMemo(() => computeByType(licenses), [licenses]);

  const regionCanvas = useRef<HTMLCanvasElement>(null);
  const statusCanvas = useRef<HTMLCanvasElement>(null);
  const milkCanvas = useRef<HTMLCanvasElement>(null);
  const monthlyCanvas = useRef<HTMLCanvasElement>(null);
  const managerCanvas = useRef<HTMLCanvasElement>(null);
  const typeCanvas = useRef<HTMLCanvasElement>(null);
  const regionChart = useRef<ChartType | null>(null);
  const statusChart = useRef<ChartType | null>(null);
  const milkChart = useRef<ChartType | null>(null);
  const monthlyChart = useRef<ChartType | null>(null);
  const managerChart = useRef<ChartType | null>(null);
  const typeChart = useRef<ChartType | null>(null);

  // 크로스 필터: 지역 막대 클릭 → 거래상태 차트 필터 / 상태 막대 클릭 → 지역 차트 필터
  const [activeRegion, setActiveRegion] = useState<string | null>(null);
  const [activeStatus, setActiveStatus] = useState<string | null>(null);

  // 지역별 분포 차트
  useEffect(() => {
    if (!regionCanvas.current) return;
    const { matrix, regionCount, regionLabels, statusColorMap } = cross;
    let labels: string[];
    let data: number[];
    let bg: string;
    if (activeStatus) {
      labels = regionLabels.filter((r) => matrix[r]?.[activeStatus] > 0);
      labels.sort((a, b) => (matrix[b][activeStatus] || 0) - (matrix[a][activeStatus] || 0));
      data = labels.map((r) => matrix[r][activeStatus] || 0);
      bg = statusColorMap[activeStatus] || '#0071e3';
    } else {
      labels = regionLabels;
      data = labels.map((k) => regionCount[k]);
      bg = '#0071e3';
    }
    regionChart.current?.destroy();
    regionChart.current = new Chart(regionCanvas.current.getContext('2d')!, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['데이터 없음'],
        datasets: [{ label: '업장 수', data: data.length ? data : [0], backgroundColor: bg, borderRadius: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick(_evt, els) {
          if (!els.length) return;
          const clicked = labels[els[0].index];
          setActiveRegion((prev) => (prev === clicked ? null : clicked));
          setActiveStatus(null);
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.raw}개소` } },
        },
        scales: { y: { beginAtZero: true, grid: { color: '#f5f5f7' } }, x: { grid: { display: false } } },
      },
    });
    return () => regionChart.current?.destroy();
  }, [cross, activeStatus]);

  // 거래상태 차트
  useEffect(() => {
    if (!statusCanvas.current) return;
    const { matrix, statusCount, statusLabels, statusColorMap } = cross;
    let labels: string[];
    let data: number[];
    if (activeRegion) {
      const rd = matrix[activeRegion] || {};
      labels = statusLabels.filter((s) => (rd[s] || 0) > 0);
      labels.sort((a, b) => (rd[b] || 0) - (rd[a] || 0));
      data = labels.map((s) => rd[s] || 0);
    } else {
      labels = statusLabels;
      data = labels.map((k) => statusCount[k]);
    }
    const colors = labels.map((s) => statusColorMap[s] || '#8e8e93');
    statusChart.current?.destroy();
    statusChart.current = new Chart(statusCanvas.current.getContext('2d')!, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['데이터 없음'],
        datasets: [{ label: '업장 수', data: data.length ? data : [0], backgroundColor: colors, borderRadius: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onClick(_evt, els) {
          if (!els.length) return;
          const clicked = labels[els[0].index];
          setActiveStatus((prev) => (prev === clicked ? null : clicked));
          setActiveRegion(null);
        },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => ` ${c.raw}개소` } },
        },
        scales: { y: { beginAtZero: true, grid: { color: '#f5f5f7' } }, x: { grid: { display: false } } },
      },
    });
    return () => statusChart.current?.destroy();
  }, [cross, activeRegion]);

  // 월별 인허가 유입·거래 전환 추이 (막대=신규 인허가, 선=그중 거래 전환)
  useEffect(() => {
    if (!monthlyCanvas.current) return;
    const labels = monthly.months.map(m => m.slice(2).replace('-', '.'));
    monthlyChart.current?.destroy();
    monthlyChart.current = new Chart(monthlyCanvas.current.getContext('2d')!, {
      data: {
        labels,
        datasets: [
          { type: 'bar', label: '신규 인허가', data: monthly.rows.map(r => r.total), backgroundColor: '#93c5fd', borderRadius: 5, order: 2 },
          { type: 'line', label: '거래 전환', data: monthly.rows.map(r => r.deal), borderColor: '#16a34a', backgroundColor: '#16a34a', tension: 0.35, pointRadius: 3, order: 1 },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { font: { family: 'Pretendard', size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${c.raw}개소`,
              footer: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                const r = monthly.rows[idx];
                return r && r.total > 0 ? `전환율 ${Math.round((r.deal / r.total) * 100)}%` : '';
              },
            },
          },
        },
        scales: { y: { beginAtZero: true, grid: { color: '#f5f5f7' }, ticks: { precision: 0 } }, x: { grid: { display: false } } },
      },
    });
    return () => monthlyChart.current?.destroy();
  }, [monthly]);

  // 담당자별 거래 현황 (상태별 누적 가로 막대 — 거래상태 차트와 동일 색)
  useEffect(() => {
    if (!managerCanvas.current) return;
    const { statusColorMap } = cross;
    const labels = byManager.map(r => r.mgr);
    const datasets = MANAGER_STATUS_ORDER
      .filter(s => byManager.some(r => (r.counts[s] || 0) > 0))
      .map(s => ({
        label: s,
        data: byManager.map(r => r.counts[s] || 0),
        backgroundColor: statusColorMap[s] || '#8e8e93',
        borderRadius: 3,
      }));
    managerChart.current?.destroy();
    managerChart.current = new Chart(managerCanvas.current.getContext('2d')!, {
      type: 'bar',
      data: { labels: labels.length ? labels : ['데이터 없음'], datasets: datasets.length ? datasets : [{ label: '-', data: [0], backgroundColor: '#e5e5ea' }] },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', align: 'end', labels: { font: { family: 'Pretendard', size: 11 }, boxWidth: 12, padding: 10 } },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.dataset.label}: ${c.raw}개소`,
              footer: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                const r = byManager[idx];
                return r ? `담당 ${r.total}개소 · 거래율 ${r.rate}%` : '';
              },
            },
          },
        },
        scales: {
          x: { stacked: true, beginAtZero: true, grid: { color: '#f5f5f7' }, ticks: { precision: 0 } },
          y: { stacked: true, grid: { display: false }, ticks: { font: { family: 'Pretendard', size: 11 } } },
        },
      },
    });
    return () => managerChart.current?.destroy();
  }, [cross, byManager]);

  // 업태별 TOP 8 (규모 + 거래율)
  useEffect(() => {
    if (!typeCanvas.current) return;
    const labels = byType.map(r => r.type);
    typeChart.current?.destroy();
    typeChart.current = new Chart(typeCanvas.current.getContext('2d')!, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['데이터 없음'],
        datasets: [{ label: '업장 수', data: byType.length ? byType.map(r => r.total) : [0], backgroundColor: '#5856D6', borderRadius: 5 }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (c) => ` ${c.raw}개소`,
              footer: (items) => {
                const idx = items[0]?.dataIndex ?? 0;
                const r = byType[idx];
                return r ? `거래 ${r.deal} · 미거래 ${r.nonDeal} · 거래율 ${r.rate}%` : '';
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grid: { color: '#f5f5f7' }, ticks: { precision: 0 } },
          y: { grid: { display: false }, ticks: { font: { family: 'Pretendard', size: 11 } } },
        },
      },
    });
    return () => typeChart.current?.destroy();
  }, [byType]);

  // 사용우유 도넛
  useEffect(() => {
    if (!milkCanvas.current) return;
    const { milkCount } = cross;
    const labels = Object.keys(milkCount).sort((a, b) => milkCount[b] - milkCount[a]);
    const data = labels.map((k) => milkCount[k]);
    const colors = labels.length ? labels.map((_, i) => MILK_PALETTE[i % MILK_PALETTE.length]) : ['#e5e5ea'];
    milkChart.current?.destroy();
    milkChart.current = new Chart(milkCanvas.current.getContext('2d')!, {
      type: 'doughnut',
      data: {
        labels: labels.length ? labels : ['데이터 없음'],
        datasets: [{ data: data.length ? data : [1], backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'right', labels: { font: { family: 'Pretendard', size: 11 }, padding: 8, boxWidth: 12 } } },
        cutout: '55%',
      } as ChartOptions<'doughnut'>,
      plugins: [donutLabelPlugin],
    });
    return () => milkChart.current?.destroy();
  }, [cross]);

  const sc = cross.statusCount;
  const cm = cross.statusColorMap; // 거래상태 차트와 동일 색
  const total = Object.values(sc).reduce((a, b) => a + b, 0);
  const kpis: { label: string; value: string; color: string; title?: string }[] = [
    { label: '총 거래처', value: total.toLocaleString(), color: '#111827' },
    { label: '거래', value: (sc['거래'] || 0).toLocaleString(), color: cm['거래'] || '#8E8E93' },
    { label: '인허가', value: (sc['인허가'] || 0).toLocaleString(), color: cm['인허가'] || '#8E8E93' },
    { label: '공사중', value: (sc['공사중'] || 0).toLocaleString(), color: cm['공사중'] || '#8E8E93' },
    { label: '거래율', value: `${cross.successRate}%`, color: cm['거래'] || '#007AFF', title: '거래 / (거래 + 미거래) 비율' },
  ];

  return (
    <div className="h-full w-full overflow-y-auto bg-gray-50 p-4 pt-16">
      {/* KPI 요약 스트립 */}
      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div
            key={k.label}
            title={k.title}
            className="rounded-2xl bg-white px-4 py-3 shadow-sm ring-1 ring-black/5 transition-shadow hover:shadow-md"
          >
            <div className="text-[11px] font-medium text-gray-400">{k.label}</div>
            <div className="mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight" style={{ color: k.color }}>{k.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="text-sm font-semibold text-gray-800">
            지역별 분포 <span className="text-[11px] font-normal text-gray-400">(주소2 기준)</span>
          </div>
          <button
            onClick={() => { setActiveRegion(null); setActiveStatus(null); }}
            className="mb-1.5 min-h-[14px] text-left text-[11px] text-blue-600"
          >
            {activeStatus ? `「${activeStatus}」 기준 필터 적용 중 · 클릭으로 해제` : '막대를 클릭하면 해당 지역의 거래상태 분포를 확인합니다'}
          </button>
          <div className="relative h-[270px] w-full">
            <canvas ref={regionCanvas} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="text-sm font-semibold text-gray-800">
            현재 거래 상태 <span className="text-[11px] font-normal text-gray-400">(거래여부 기준)</span>
          </div>
          <button
            onClick={() => { setActiveRegion(null); setActiveStatus(null); }}
            className="mb-1.5 min-h-[14px] text-left text-[11px] text-blue-600"
          >
            {activeRegion ? `「${activeRegion}」 기준 필터 적용 중 · 클릭으로 해제` : '막대를 클릭하면 해당 상태의 지역별 분포를 확인합니다'}
          </button>
          <div className="relative h-[270px] w-full">
            <canvas ref={statusCanvas} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 lg:col-span-2">
          <div className="text-sm font-semibold text-gray-800">
            월별 인허가 유입 · 거래 전환 <span className="text-[11px] font-normal text-gray-400">(최근 12개월 · 영업 허가일 기준)</span>
          </div>
          <div className="mb-1.5 text-[11px] text-gray-400">막대=신규 인허가 유입 · 선=그중 현재 거래 전환된 업장 (막대에 마우스를 올리면 전환율)</div>
          <div className="relative h-[240px] w-full">
            <canvas ref={monthlyCanvas} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="text-sm font-semibold text-gray-800">
            담당자별 거래 현황 <span className="text-[11px] font-normal text-gray-400">(담당 물량 상위 10명)</span>
          </div>
          <div className="mb-1.5 text-[11px] text-gray-400">막대에 마우스를 올리면 담당 규모·거래율</div>
          <div className="relative h-[270px] w-full">
            <canvas ref={managerCanvas} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5">
          <div className="text-sm font-semibold text-gray-800">
            업태별 분포 <span className="text-[11px] font-normal text-gray-400">(상위 8개 업태)</span>
          </div>
          <div className="mb-1.5 text-[11px] text-gray-400">막대에 마우스를 올리면 거래·미거래·거래율</div>
          <div className="relative h-[270px] w-full">
            <canvas ref={typeCanvas} />
          </div>
        </div>

        <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 lg:col-span-2">
          <div className="mb-2 text-sm font-semibold text-gray-800">
            사용 우유 현황 <span className="text-[11px] font-normal text-gray-400">(사용우유 기준)</span>
          </div>
          <div className="relative mx-auto h-[260px] w-full max-w-xl">
            <canvas ref={milkCanvas} />
          </div>
        </div>
      </div>
    </div>
  );
}
