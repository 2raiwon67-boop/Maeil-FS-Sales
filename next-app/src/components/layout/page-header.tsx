import type { ReactNode } from 'react';

// 전 페이지 공통 작업 헤더 — 제목 + 한 줄 목적 + 우측 액션
export function PageHeader({
  title,
  subtitle,
  actions,
  className = '',
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}) {
  const hasText = !!title || !!subtitle;
  // 제목·부제목·액션이 모두 없으면 빈 바를 그리지 않는다 (예: 비관리자 데이터관리 → 콘텐츠가 위로)
  if (!hasText && !actions) return null;

  return (
    <div
      className={`flex flex-wrap items-center gap-3 border-b border-[#e8ebf0] bg-white px-4 py-3.5 md:px-6 ${hasText ? 'justify-between' : 'justify-end'} ${className}`}
    >
      {hasText && (
        <div>
          {title && <h1 className="text-base font-semibold text-[#0f172a]">{title}</h1>}
          {subtitle && <p className="mt-0.5 text-xs text-[#94a3b8]">{subtitle}</p>}
        </div>
      )}
      {/* 모바일: 액션이 줄바꿈으로 흩어지지 않게 2열 그리드 정렬 */}
      {actions && <div className="flex flex-wrap items-center gap-2 max-md:grid max-md:w-full max-md:grid-cols-2 max-md:[&>*]:justify-center">{actions}</div>}
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
