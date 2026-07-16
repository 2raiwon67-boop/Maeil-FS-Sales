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
// 주의: 제물포구는 옛 중구 원도심+동구 전체에 걸친다. 폴리곤별 분할 데이터가 없으므로
// 옛 중구 폴리곤(영종구·제물포구 합산)과 옛 동구 폴리곤(제물포구)에 각각 근사해 칠한다 —
// 제물포구 수치가 두 폴리곤에 중복 '표시'되지만, UI 어디서도 폴리곤 간 합산은 하지 않는다.

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
  '인천|동구': ['동구', '제물포구'],
};

/** 옛 폴리곤명 → 데이터 매칭 버킷. 옛 동구 영역 레코드는 전부 제물포구→중구로 정규화되므로
 *  동구 폴리곤(읍면동 경계 sgg 포함)은 중구 버킷에서 데이터를 찾아야 한다. */
const GEO_BUCKET: Record<string, string> = { '인천|동구': '중구' };
export function geoBucket(sido: string, name: string): string {
  return GEO_BUCKET[`${sido}|${name}`] || name;
}

/** 레코드의 구명을 옛 경계 기준으로 정규화 (매핑 없으면 그대로) */
export function legacySigungu(sido: string, sigungu: string): string {
  return SIGUNGU_TO_LEGACY[`${sido}|${sigungu}`] || sigungu;
}

/** target(폴리곤/드릴다운 지역명)과 레코드 구명이 같은 지역인지 — 신구명 어느 쪽이든 매칭.
 *  개편 폴리곤 클릭 시 target이 '검단구·서해구' 같은 합성 표기로 들어올 수 있어 ·로 분해해 본다. */
export function sigunguMatches(sido: string, recordSigungu: string, target: string): boolean {
  if (recordSigungu === target) return true;
  const lg = legacySigungu(sido, recordSigungu);
  return target.split('·').some(t => recordSigungu === t || lg === geoBucket(sido, t));
}
