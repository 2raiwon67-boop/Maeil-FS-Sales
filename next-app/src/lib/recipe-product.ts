// 레시피(recipes.main_products)의 뭉뚝한 제품명을 견적 제품 DB(구글시트 품명)의
// 정식 SKU명으로 해석하는 유틸. 상담 모드(consult)의 "담기 → 견적" 다리 역할.
//
// 레시피 쪽: "매일 휘핑크림", "연유", "테너 과육플러스" 처럼 용량 없는 통칭.
// 제품 DB 쪽: "매일 휘핑크림 유지방 35% 1L" 처럼 용량 붙은 정식 품명.
// 띄어쓰기도 어긋남(레시피 "어메이징 오트 바리스타" ↔ DB "어메이징오트 바리스타 950ml")
// → 공백 제거 정규화 후 비교가 기본.

export interface ResolvedRecipeProduct {
  /** 레시피 원문 제품명 */
  raw: string;
  /** 해석된 제품 DB 품명. null이면 미해석(원문 그대로 표시하는 fallback 대상) */
  sku: string | null;
  method: 'dict' | 'exact' | 'prefix' | 'contains' | 'flavor-hint' | 'dedupe' | 'none';
}

/** 공백 제거 + 소문자화(OM10, M8 등 라틴 대소문자 흡수) */
function norm(s: string): string {
  return s.normalize('NFC').replace(/\s+/g, '').toLowerCase();
}

// SKU가 여러 개라 통칭만으로 특정 불가한 이름 → 대표 SKU 지정.
// 값은 정식 품명이지만, 시트에서 개명되어도 같은 매처로 재해석되므로 완전 일치가 아니어도 동작.
const REPRESENTATIVE_SKU: Record<string, string> = {
  '매일 우유': '매일 우유 오리지널 1L',
  '연유': '매일 연유 500g',
  '매일 휘핑크림': '매일 휘핑크림 유지방 35% 1L', // 레시피 표기(w.매일휘핑35%) 기준 대표
  '소프트믹스': '매일 소프트믹스 프레쉬 1L', // 통칭 소프트믹스 = 기본 화이트 베이스
  '테너 소스': '테너 초콜렛 소스 1.35kg', // 카라멜은 항상 "테너 소스 카라멜"로 명시됨
  '상하목장': '상하목장 유기농우유 900ml',
  '상하목장 소프트믹스': '상하목장 소프트믹스 OM10 1L',
  '아몬드 브리즈': '아몬드 브리즈 오리지널 950ml',
  '매일 바이오': '매일 바이오 플레인 900g',
};

// "테너 과육플러스"처럼 구체 맛이 빠진 패밀리 통칭 — 같은 레시피의 구체 SKU와 중복이면
// 제거하고, 아니면 레시피명의 맛으로 좁힌다.
const FAMILY_PREFIX: Record<string, string> = {
  '테너 과육플러스': '테너 베이스 과육플러스',
  '테너 베이스': '테너 베이스',
};

/** 맛 필터·flavor-hint 공용 키워드. key=표준 flavor, value=이름에서 찾을 별칭들 */
export const FLAVOR_KEYWORDS: Record<string, string[]> = {
  '딸기': ['딸기', '스트로베리'],
  '복숭아': ['복숭아', '피치'],
  '레몬': ['레몬'],
  '자몽': ['자몽'],
  '청포도': ['청포도', '머스켓', '머스캣'],
  '애플망고': ['애플망고', '망고'],
  '블루베리': ['블루베리'],
  '라임': ['라임'],
  '체리': ['체리'],
  '자두': ['자두', '플럼'],
  '멜론': ['멜론'],
  '오렌지': ['오렌지'],
  '클레멘타인': ['클레멘타인', '탠저린'],
  '배': ['배&엘더플라워', '엘더플라워'],
  '홍차': ['홍차', '얼그레이', '밀크티'],
  '초코': ['초코', '초콜릿', '초콜렛', '쇼콜라', '누텔라'],
  '카라멜': ['카라멜', '달고나', '버터스카치', '토피넛'],
  '말차': ['말차'],
  '오트': ['오트'],
  '유자': ['유자'],
  '흑임자': ['흑임자'],
  '밤': ['밤라떼', '밤 라떼', '마론'], // '밤' 단독은 한 글자라 오탐 위험 → 조합형만
  '고구마': ['고구마'],
  '바닐라': ['바닐라'],
  '땅콩': ['땅콩', '피넛'],
  '옥수수': ['옥수수'],
  '쑥': ['쑥'],
};

/** 이름(레시피명·제품명)에 포함된 표준 flavor 목록 */
export function deriveFlavors(recipeName: string, mainProducts: string[]): string[] {
  const haystack = norm(recipeName + ' ' + mainProducts.join(' '));
  const found: string[] = [];
  for (const [flavor, aliases] of Object.entries(FLAVOR_KEYWORDS)) {
    if (aliases.some((a) => haystack.includes(norm(a)))) found.push(flavor);
  }
  return found;
}

/** skuNames에서 query와 매칭되는 후보들 (정규화 equal → prefix → contains 순, 첫 단계에서 확정) */
function findCandidates(query: string, skuNames: string[]): { list: string[]; method: 'exact' | 'prefix' | 'contains' } {
  const q = norm(query);
  const exact = skuNames.filter((s) => norm(s) === q);
  if (exact.length) return { list: exact, method: 'exact' };
  const prefix = skuNames.filter((s) => norm(s).startsWith(q));
  if (prefix.length) return { list: prefix, method: 'prefix' };
  const contains = skuNames.filter((s) => norm(s).includes(q));
  return { list: contains, method: 'contains' };
}

/**
 * 레시피 한 건의 main_products를 제품 DB 품명으로 해석.
 * skuNames는 proposal이 로드하는 productDB의 품명 배열을 그대로 전달.
 */
export function resolveRecipeProducts(
  recipeName: string,
  mainProducts: string[],
  skuNames: string[],
): ResolvedRecipeProduct[] {
  const results: ResolvedRecipeProduct[] = [];

  for (const raw of mainProducts) {
    const trimmed = raw.trim();
    if (!trimmed) continue;

    // 1) 대표 SKU 사전 — 사전 값도 매처로 재해석(시트 개명에 견고)
    const rep = REPRESENTATIVE_SKU[trimmed];
    if (rep) {
      const { list } = findCandidates(rep, skuNames);
      results.push({ raw: trimmed, sku: list[0] ?? null, method: list.length ? 'dict' : 'none' });
      continue;
    }

    // 2) 패밀리 통칭 — 중복 제거 또는 flavor-hint로 좁히기
    const familyPrefix = FAMILY_PREFIX[trimmed];
    if (familyPrefix) {
      const family = norm(familyPrefix);
      // 같은 레시피의 다른 제품이 이미 이 패밀리의 구체 SKU로 해석될 예정이면 중복 → 제거
      const specificSibling = mainProducts.some(
        (p) => p !== raw && norm(p).startsWith(family) && norm(p) !== norm(trimmed),
      );
      if (specificSibling) {
        results.push({ raw: trimmed, sku: null, method: 'dedupe' });
        continue;
      }
      // 레시피명의 flavor로 후보 좁히기 (예: "딸기 오트 라떼" + 테너 과육플러스 → 과육플러스 딸기)
      // 검색어는 원문("테너 과육플러스")이 아니라 정식 패밀리명 — 원문은 DB 품명의 substring도 아님.
      const flavors = deriveFlavors(recipeName, []);
      const { list } = findCandidates(familyPrefix, skuNames);
      let byFlavor = list.filter((s) => flavors.some((f) => norm(s).includes(norm(f))));
      if (byFlavor.length > 1) {
        // 같은 맛에 베이스/과육플러스 둘 다 걸리면 레시피명의 서브패밀리 표기를 따른다
        const wantsPlus = norm(recipeName).includes(norm('과육플러스'));
        byFlavor = byFlavor.filter((s) => norm(s).includes(norm('과육플러스')) === wantsPlus);
      }
      if (byFlavor.length === 1) {
        results.push({ raw: trimmed, sku: byFlavor[0], method: 'flavor-hint' });
      } else {
        results.push({ raw: trimmed, sku: null, method: 'none' });
      }
      continue;
    }

    // 3) 일반 매칭 — 단일 후보만 신뢰, 다중이면 flavor-hint 시도 후 포기
    const { list, method } = findCandidates(trimmed, skuNames);
    if (list.length === 1) {
      results.push({ raw: trimmed, sku: list[0], method });
    } else if (list.length > 1) {
      const flavors = deriveFlavors(recipeName, []);
      const byFlavor = list.filter((s) => flavors.some((f) => norm(s).includes(norm(f))));
      results.push(
        byFlavor.length === 1
          ? { raw: trimmed, sku: byFlavor[0], method: 'flavor-hint' }
          : { raw: trimmed, sku: null, method: 'none' },
      );
    } else {
      results.push({ raw: trimmed, sku: null, method: 'none' });
    }
  }

  return results;
}
