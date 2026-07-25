// 거래처 대시보드 공통 상수 — 원본 index.html 포팅

// 인허가 마커 거래여부별 색상 (일반 / 색맹모드)
export const STATUS_COLORS: Record<string, string> = {
  거래: '#007AFF',
  미거래: '#FF3B30',
  인허가: '#34C759',
  공사중: '#FF9500',
};

export const STATUS_COLORS_CB: Record<string, string> = {
  거래: '#007AFF',
  미거래: '#CC0099',
  인허가: '#0099CC',
  공사중: '#FF9500',
};

// 주요거래처 마커 색상 (거래상태별)
export const ACCOUNT_COLORS: Record<string, string> = {
  거래: '#FFB300',
  미거래: '#8E8E93',
};

// 장바구니 담김 마커 색상
export const CART_COLOR = '#5856d6';

// 우유사 분류 — 매장 상세의 선택지(store-detail MILKS)와 반드시 같은 목록을 유지할 것.
// 여기 없는 브랜드를 매장 상세에서 고르면 필터·차트에서 조용히 '기타'로 뭉친다.
export const MILK_BRANDS = ['매일', '서울', '남양', '연세', '동원', '빙그레'] as const;

// 우유사 차트 색상
export const MILK_COLORS: Record<string, string> = {
  매일: '#007AFF',
  서울: '#FF3B30',
  남양: '#FF9500',
  연세: '#34C759',
  동원: '#5856D6',
  빙그레: '#FF2D95',
  기타: '#8E8E93',
};

// 거래여부 유효값
export const VALID_STATUSES = ['거래', '미거래', '인허가', '공사중', 'DROP'] as const;

// 지도 기본 중심 (경기북부 의정부 인근)
export const DEFAULT_CENTER = { lat: 37.738, lng: 127.034 };
export const DEFAULT_ZOOM = 11;

// 인허가 신규 표시 기준 (영업허가일 14일 이내 glow)
export const NEW_PERMIT_DAYS = 14;

// localStorage 캐시 TTL (12시간)
export const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

export function statusColor(status: string, colorblind = false): string | null {
  const map = colorblind ? STATUS_COLORS_CB : STATUS_COLORS;
  return map[status] ?? null;
}
