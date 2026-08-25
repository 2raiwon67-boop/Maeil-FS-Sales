// 보고서 데이터 계약 — 적격 업종·분석 창·산식의 단일 소스 (2026-08 경인특판 보고서에서 확정한 정의)
// 보고작성 뷰(components/discover/report-view)와 향후 지역 보고서가 전부 이 정의를 공유한다.
// 정의를 바꿀 일이 생기면 이 파일만 수정 — 화면·AI 분석·보고서 숫자가 함께 움직여야 반박당하지 않는다.

// FS-적격 업태 13종 — 유제품 SKU(우유·휘핑·연유·치즈)를 상시 소화해 대리점 개척 대상이 되는 업태만.
// ⚠️ discover의 TARGET_CATS(인허가 추출 화이트리스트)와 다른 목록이다:
//   그쪽은 실제 카페가 '기타'·'기타 휴게음식점'으로 등록되는 추출 누락을 막는 관대한 목록.
//   여기는 무인점포·자판기 부풀림(인천 3구 실측: 제외 3업태가 전체의 59%)을 걷어낸 보수적 분모 —
//   시장 규모·모멘텀·이탈률 산정용. 관대한 필터로 시장을 재면 무인점포 붐이 '개척할 동네'로 오판된다.
export const ELIGIBLE_CATS = new Set([
  // 카페·디저트 축 — 음료·베이커리에 유제품 직접 사용
  '커피숍', '다방', '떡카페', '키즈카페', '전통찻집', '제과점영업', '아이스크림',
  // 외식 축 — 조리에 유제품·가공유 소비
  '경양식', '한식', '패밀리레스트랑', '뷔페식', '패스트푸드', '분식',
]);

export function isEligible(category: string | null | undefined): boolean {
  return ELIGIBLE_CATS.has((category || '').trim());
}

// 분석 창 — 모멘텀은 최근 12개월 vs 직전 12개월. 시장 창은 롤링 36개월(비교 24 + 검증 12)로 고정.
// 4년 확장 금지: 2022년은 거리두기 해제 리바운드 창업 붐(다른 시장 체제)이라 기준선을 오염시킨다.
export const MOMENTUM_WINDOW = 12;

/** 'YYYY-MM'에서 delta개월 이동한 'YYYY-MM' (delta 음수 = 과거) */
export function monthShift(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + delta;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}

export type Momentum = '가속' | '감속' | '보합';

// 판정 폭 ±10% + 절대 차이 2곳 이상 — 소표본 동네에서 1~2곳 차이가 '가속'으로 읽히는 노이즈 방지.
// 직전 창이 0이면 3곳 이상 등장해야 가속으로 본다.
export function classifyMomentum(recent: number, prior: number): Momentum {
  if (prior === 0) return recent >= 3 ? '가속' : '보합';
  const diff = recent - prior;
  const pct = diff / prior;
  if (pct >= 0.1 && diff >= 2) return '가속';
  if (pct <= -0.1 && diff <= -2) return '감속';
  return '보합';
}

// 12개월 폐업률(연) — 분모는 기초 재고 근사(현재 운영 + 12개월 폐업).
// ⚠️ 이 값은 '인허가 폐업' 기준 하한선이다: 폐업 없이 거래만 끊는 이탈은 포함되지 않으므로
//    실제 거래처 이탈률은 이보다 높다. 보고서에 인용할 때 반드시 하한선임을 명시할 것.
export function annualChurnPct(closed12: number, operatingNow: number): number {
  const base = operatingNow + closed12;
  return base > 0 ? +((closed12 / base) * 100).toFixed(1) : 0;
}

// 개척 요건 — 거래처 수(ERP 실측, 수기 입력)와 적격시장 실측으로 월 개척 하한 두 줄을 계산:
//   이탈 상쇄선(월) = 거래처 × 폐업률 / 12          — 거래처 수 현상 유지에 필요한 최소 개척
//   점유율 유지선(월) = 상쇄선 + 시장 순증 × 침투율 / 12 — 시장이 커지는 만큼 따라가는 개척
export function pioneerRequirement(accounts: number, churnPct: number, net12: number, operating: number) {
  const share = operating > 0 ? accounts / operating : 0;
  const offsetMonthly = +((accounts * (churnPct / 100)) / 12).toFixed(1);
  const keepMonthly = +((accounts * (churnPct / 100) + Math.max(0, net12) * share) / 12).toFixed(1);
  return { offsetMonthly, keepMonthly, sharePct: +(share * 100).toFixed(1) };
}
