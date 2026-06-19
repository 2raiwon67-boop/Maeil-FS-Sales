import type { ReactNode } from 'react';

// 전 페이지 공통 작업 헤더 — 제목 + 한 줄 목적 + 우측 액션
export function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-[#e8ebf0] bg-white px-4 py-3.5 md:px-6 ${className}`}
    >
      <div>
        <h1 className="text-base font-semibold text-[#0f172a]">{title}</h1>
        {subtitle && <p className="mt-0.5 text-xs text-[#94a3b8]">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

// 공통 버튼 스타일 (헤더·툴바용)
export const headerBtn = {
  outline:
    'inline-flex items-center gap-1.5 rounded-lg border border-[#d6dbe3] bg-white px-3 py-1.5 text-xs font-medium text-[#334155] transition-colors hover:bg-gray-50 disabled:opacity-60',
  primary:
    'inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#1d4fd0] disabled:opacity-60',
};
