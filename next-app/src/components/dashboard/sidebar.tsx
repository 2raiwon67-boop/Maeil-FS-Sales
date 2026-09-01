'use client';

import { useState } from 'react';
import {
  STATUS_ITEMS,
  MILK_ITEMS,
  type FilterState,
  type SidebarCounts,
} from '@/lib/dashboard/filters';

interface SidebarProps {
  filters: FilterState;
  counts: SidebarCounts;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onStatus: (key: string) => void;
  onMilk: (key: string) => void;
  onRegion: (key: string) => void;
  onManager: (key: string) => void;
  onReset: () => void;
  colorblind: boolean;
  onToggleColorblind: () => void;
}

function Dot({ color }: { color: string }) {
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ background: color }}
    />
  );
}

function DropdownCard({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
      >
        <h4 className="text-[13px] font-semibold text-gray-800">{title}</h4>
        <span className={`text-[10px] text-gray-400 transition-transform ${open ? '' : '-rotate-90'}`}>
          ▼
        </span>
      </button>
      {open && <div className="px-2 pb-2">{children}</div>}
    </div>
  );
}

function FilterRow({
  active,
  color,
  label,
  count,
  onClick,
}: {
  active: boolean;
  color?: string;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-[13px] transition-colors ${
        active ? 'bg-blue-50 font-semibold text-blue-700' : 'text-gray-700 hover:bg-gray-50'
      }`}
    >
      <span className="flex items-center gap-2">
        {color && <Dot color={color} />}
        {label}
      </span>
      <span className={`text-xs ${active ? 'text-blue-600' : 'text-gray-400'}`}>{count}</span>
    </button>
  );
}

export function DashboardSidebar({
  filters,
  counts,
  collapsed,
  onToggleCollapse,
  onStatus,
  onMilk,
  onRegion,
  onManager,
  onReset,
  colorblind,
  onToggleColorblind,
}: SidebarProps) {
  return (
    <>
      {/* 지도 위 오버레이 — 접어도 지도는 리사이즈되지 않는다 (시장분석 패널과 동일 패턴) */}
      <aside
        className={`absolute inset-y-0 left-0 z-30 flex flex-col border-r border-gray-200 bg-gray-50 shadow-xl transition-all duration-200 ${
          collapsed ? 'w-0 overflow-hidden shadow-none' : 'w-[300px]'
        }`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-3 flex flex-col gap-3">
          {/* 주요거래처 기능 미사용 결정(2026-09-01)으로 탭·주요거래처 현황 제거 — 인허가만 표시 */}
          {/* 인허가 현황 */}
          <DropdownCard title="인허가 현황">
            {STATUS_ITEMS.map((it) => (
              <FilterRow
                key={it.key}
                active={filters.status.has(it.key)}
                color={it.color}
                label={it.label}
                count={counts.status[it.key] ?? 0}
                onClick={() => onStatus(it.key)}
              />
            ))}
          </DropdownCard>

          {/* 사용우유 */}
          <DropdownCard title="사용우유 (인허가)">
            {MILK_ITEMS.map((it) => (
              <FilterRow
                key={it.key}
                active={filters.milk.has(it.key)}
                color={it.color}
                label={it.key}
                count={counts.milk[it.key] ?? 0}
                onClick={() => onMilk(it.key)}
              />
            ))}
          </DropdownCard>

          {/* 담당자 · 지역 */}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="flex items-center justify-between border-b border-gray-100 px-3.5 py-2.5">
              <span className="text-[13px] font-semibold text-gray-800">담당자 · 지역</span>
              <button onClick={onReset} className="text-xs text-blue-600 hover:underline">
                초기화
              </button>
            </div>
            <div className="grid grid-cols-2 gap-1 p-2">
              <div className="flex flex-col">
                <div className="px-1 pb-1 text-[11px] font-medium text-gray-400">담당자</div>
                <div className="max-h-56 overflow-y-auto">
                  {counts.managers.map(([m, c]) => (
                    <FilterRow
                      key={m}
                      active={filters.manager.has(m)}
                      label={m}
                      count={c}
                      onClick={() => onManager(m)}
                    />
                  ))}
                  {counts.managers.length === 0 && (
                    <div className="px-2 py-3 text-center text-xs text-gray-300">없음</div>
                  )}
                </div>
              </div>
              <div className="flex flex-col">
                <div className="px-1 pb-1 text-[11px] font-medium text-gray-400">지역</div>
                <div className="max-h-56 overflow-y-auto">
                  {counts.regions.map(([r, c]) => (
                    <FilterRow
                      key={r}
                      active={filters.region.has(r)}
                      label={r}
                      count={c}
                      onClick={() => onRegion(r)}
                    />
                  ))}
                  {counts.regions.length === 0 && (
                    <div className="px-2 py-3 text-center text-xs text-gray-300">없음</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* 색각 보정 모드 */}
          <button
            onClick={onToggleColorblind}
            className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-3.5 py-2.5"
          >
            <span className="text-[13px] font-semibold text-gray-800">색각 보정 모드</span>
            <span
              className={`relative h-5 w-9 rounded-full transition-colors ${
                colorblind ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
                  colorblind ? 'translate-x-4' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      </aside>

      {/* 접기/펼치기 버튼 */}
      <button
        onClick={onToggleCollapse}
        title="사이드바 접기/펼치기"
        // 모바일은 손잡이를 넓힌다 — px-1(폭 14px)로는 엄지로 집기 어렵다
        className="absolute top-1/2 z-40 -translate-y-1/2 rounded-r-lg border border-l-0 border-gray-200 bg-white px-1 py-4 text-gray-500 shadow transition-all hover:bg-gray-50 max-md:px-2.5 max-md:py-6"
        style={{ left: collapsed ? 0 : 300 }}
      >
        {collapsed ? '›' : '‹'}
      </button>
    </>
  );
}
