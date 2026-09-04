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

/** 동 단위 시계열 행을 개편 후 구명으로 재배정 — 인구 통계처럼 "과거 월 = 옛 구명"인
 *  데이터의 시계열을 잇는다 (예: 옛 중구 원도심 동들 → 제물포구로 붙여 관측 1개월 문제 해소).
 *
 *  원리: 법정동 이름은 구 개편 후에도 유지되므로, 최신 월 데이터에서 각 동이 어느 새 구에
 *  속하는지가 그대로 정답지다. 동 목록을 하드코딩하지 않아 다음 개편·전국 확장 시에도
 *  LEGACY_TO_CURRENT에 신↔구 표만 추가하면 자동 작동한다.
 *  한계: 개편과 함께 동 이름 자체가 바뀐 경우는 매핑 불가 → 옛 구명 그대로 남는다(제외 처리).
 *  동명이 같은 다른 구로 오배정되는 것은 후보를 그 옛 구의 승계 구 목록으로 제한해 차단. */
export function remapLegacyDongRows<T extends { sigungu: string; dong: string; month: string }>(
  rows: T[], sido: string,
): T[] {
  const legacyKeys = Object.entries(LEGACY_TO_CURRENT).filter(([k]) => k.startsWith(`${sido}|`));
  if (!legacyKeys.length) return rows;
  // 승계 후보(새 구명) = 매핑 값에서 옛 구명 자신을 뺀 것
  const successors = new Map<string, string[]>(); // 옛 구명 → 새 구명들
  const currentNames = new Set<string>();
  for (const [k, curs] of legacyKeys) {
    const legacyName = k.split('|')[1];
    const news = curs.filter((c) => c !== legacyName);
    successors.set(legacyName, news);
    news.forEach((n) => currentNames.add(n));
  }
  // 정답지: (새 구명|동)별 최신 관측월. 동 이름만으로 만들면 서로 다른 옛 구의 동명이
  // 충돌한다(실측: 옛 서구 금곡동 vs 옛 동구 금곡동→제물포구) — 구까지 키에 포함.
  const homeKey = new Map<string, string>(); // `새구|동` → 최신 month
  for (const r of rows) {
    if (!currentNames.has(r.sigungu)) continue;
    const k = `${r.sigungu}|${r.dong}`;
    const m = homeKey.get(k);
    if (!m || r.month > m) homeKey.set(k, r.month);
  }
  if (!homeKey.size) return rows; // 새 구명 데이터가 아직 없으면 재배정 불가 — 그대로
  return rows.map((r) => {
    const cands = successors.get(r.sigungu);
    if (!cands) return r;
    // 이 옛 구의 승계 구들 중에서만 동을 찾는다 — 타 구의 동명 동일 법정동에 오배정 차단
    let best: string | null = null;
    let bestM = '';
    for (const c of cands) {
      const m = homeKey.get(`${c}|${r.dong}`);
      if (m && m > bestM) { best = c; bestM = m; }
    }
    return best ? { ...r, sigungu: best } : r;
  });
}

// ─── 부천시·고양시 일반구 분해 (연간 트렌드 표시용) ─────────────────────────
// 두 시는 sigungu가 시 단위로 수집되지만 실제 구 체계(부천 2024 재설치, 고양 3구)가 있어
// 연간 트렌드에서 구 단위로 나눠 보여준다(2026-08-28 사용자 요청). 법정동→구 매핑은
// market_store_records 주소 원문에서 도출 — 전 행에 구가 박혀 있어 동↔구 모호 0건·dong 결측 0건 검증됨.
// KPI/지도 채색은 시군구 geojson 단위라 그대로 시 단위 유지 — 이 매핑은 표시·집계 파생 전용.
const GU_BY_DONG: Record<string, Record<string, string>> = {
  부천시: {
    도당동: '원미구', 상동: '원미구', 소사동: '원미구', 심곡동: '원미구', 약대동: '원미구',
    역곡동: '원미구', 원미동: '원미구', 중동: '원미구', 춘의동: '원미구',
    계수동: '소사구', 괴안동: '소사구', 범박동: '소사구', 소사본동: '소사구', 송내동: '소사구',
    심곡본동: '소사구', 옥길동: '소사구',
    고강동: '오정구', 내동: '오정구', 대장동: '오정구', 삼정동: '오정구', 여월동: '오정구',
    오정동: '오정구', 원종동: '오정구', 작동: '오정구',
  },
  고양시: {
    강매동: '덕양구', 고양동: '덕양구', 관산동: '덕양구', 내유동: '덕양구', 대자동: '덕양구',
    대장동: '덕양구', 덕은동: '덕양구', 도내동: '덕양구', 동산동: '덕양구', 벽제동: '덕양구',
    삼송동: '덕양구', 선유동: '덕양구', 성사동: '덕양구', 신원동: '덕양구', 오금동: '덕양구',
    용두동: '덕양구', 원당동: '덕양구', 원흥동: '덕양구', 주교동: '덕양구', 지축동: '덕양구',
    토당동: '덕양구', 행신동: '덕양구', 행주내동: '덕양구', 행주외동: '덕양구', 향동동: '덕양구',
    현천동: '덕양구', 화전동: '덕양구', 화정동: '덕양구', 효자동: '덕양구',
    마두동: '일산동구', 문봉동: '일산동구', 백석동: '일산동구', 사리현동: '일산동구', 산황동: '일산동구',
    설문동: '일산동구', 성석동: '일산동구', 식사동: '일산동구', 장항동: '일산동구', 정발산동: '일산동구',
    중산동: '일산동구', 지영동: '일산동구', 풍동: '일산동구',
    가좌동: '일산서구', 구산동: '일산서구', 대화동: '일산서구', 덕이동: '일산서구', 법곳동: '일산서구',
    일산동: '일산서구', 주엽동: '일산서구', 탄현동: '일산서구',
  },
};

/** 일반시 아래 행정구를 붙여 '수원시 영통구' 형태로. 1순위 DB 파생 컬럼 gu(주소 파싱, 전국 공통 — 2026-09-04),
 *  2순위 부천·고양 법정동 표(gu 없는 옛 캐시/결측 주소 보완). 둘 다 없으면 원래 시군구 그대로. */
export function refineSigungu(sigungu: string, dong: string | null | undefined, gu?: string | null): string {
  if (gu && sigungu.endsWith('시')) return `${sigungu} ${gu}`;
  const g = dong ? GU_BY_DONG[sigungu]?.[dong] : undefined;
  return g ? `${sigungu} ${g}` : sigungu;
}
