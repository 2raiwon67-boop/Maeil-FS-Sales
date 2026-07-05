// 행정구역 개편 대응 공유 모듈
//
// 문제: 공공데이터(인허가·시장) API는 개편 즉시 "새 구명"으로 데이터를 내려주는데,
// 우리 경계 geojson(2013 통계청 코드체계)과 과거 월 데이터는 "옛 구명"으로 남는다.
// 이 모듈이 신↔구 매핑의 단일 소스다. 다음 개편이 오면 여기 두 표만 고치면 된다.
//
// ── 2026-07-01 인천광역시 구 개편 ──
//   중구+동구 원도심 → 제물포구 신설
//   중구 영종도 지역 → 영종구 신설
//   서구 북부(검단)  → 검단구 분리, 잔여 서구 → 서해구로 개칭
//
// 주의: 제물포구는 옛 중구·동구에 걸치지만 이중 합산을 피하기 위해
// 경계(폴리곤) 매핑은 중구 하나로 근사한다(옛 동구 폴리곤엔 과거 '동구' 데이터만 칠해짐).

/** 데이터의 새 구명 → 옛 경계 geojson 폴리곤명 ("시도|새구명" 키) */
export const SIGUNGU_TO_LEGACY: Record<string, string> = {
  '인천|검단구': '서구',
  '인천|서해구': '서구',
  '인천|영종구': '중구',
  '인천|제물포구': '중구',
};

/** 옛 폴리곤명 → 그 경계에 합산할 데이터 구명 목록(과거명 포함, "시도|옛구명" 키) */
export const LEGACY_TO_CURRENT: Record<string, string[]> = {
  '인천|서구': ['서구', '검단구', '서해구'],
  '인천|중구': ['중구', '영종구', '제물포구'],
};

/** 레코드의 구명을 옛 경계 기준으로 정규화 (매핑 없으면 그대로) */
export function legacySigungu(sido: string, sigungu: string): string {
  return SIGUNGU_TO_LEGACY[`${sido}|${sigungu}`] || sigungu;
}

/** target(폴리곤/드릴다운 지역명)과 레코드 구명이 같은 지역인지 — 신구명 어느 쪽이든 매칭 */
export function sigunguMatches(sido: string, recordSigungu: string, target: string): boolean {
  if (recordSigungu === target) return true;
  return legacySigungu(sido, recordSigungu) === target;
}
