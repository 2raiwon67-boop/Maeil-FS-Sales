'use client';

// Phase 4 — 대시보드 차트 3종 (지역별 분포 / 거래상태 / 사용우유) + 크로스 필터
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Chart,
  BarController,
  BarElement,
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

export function DashboardCharts({ licenses }: { licenses: License[] }) {
  const cross = useMemo(() => computeCross(licenses), [licenses]);

  const regionCanvas = useRef<HTMLCanvasElement>(null);
  const statusCanvas = useRef<HTMLCanvasElement>(null);
  const milkCanvas = useRef<HTMLCanvasElement>(null);
  const regionChart = useRef<ChartType | null>(null);
  const statusChart = useRef<ChartType | null>(null);
  const milkChart = useRef<ChartType | null>(null);

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
  const total = Object.values(sc).reduce((a, b) => a + b, 0);
  const kpis: { label: string; value: string; cls: string; title?: string }[] = [
    { label: '총 거래처', value: total.toLocaleString(), cls: 'text-slate-900' },
    { label: '거래', value: (sc['거래'] || 0).toLocaleString(), cls: 'text-blue-600' },
    { label: '인허가', value: (sc['인허가'] || 0).toLocaleString(), cls: 'text-green-600' },
    { label: '공사중', value: (sc['공사중'] || 0).toLocaleString(), cls: 'text-amber-600' },
    { label: '거래율', value: `${cross.successRate}%`, cls: 'text-violet-600', title: '거래 / (거래 + 미거래) 비율' },
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
            <div className={`mt-0.5 text-2xl font-extrabold tabular-nums tracking-tight ${k.cls}`}>{k.value}</div>
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
