import { CONVENIENCE_RE, SHARED_EXCLUDE_KEYWORDS, isNonTargetName } from '@/lib/store-exclusions';
// 공공데이터포털 지방행정 인허가 데이터 API 프록시 (원본 api/public-license.js 포팅)
// GET /api/public-license?types=general_restaurants,rest_cafes,bakeries&startDate=20260401&endDate=20260408&regions=의정부,양주
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;

const ENDPOINTS: Record<string, string> = {
  general_restaurants: 'https://apis.data.go.kr/1741000/general_restaurants/info',
  bakeries: 'https://apis.data.go.kr/1741000/bakeries/info',
  rest_cafes: 'https://apis.data.go.kr/1741000/rest_cafes/info',
};

const TYPE_LABELS: Record<string, string> = {
  general_restaurants: '일반음식점',
  bakeries: '제과점영업',
  rest_cafes: '휴게음식점',
};

// ── upload.html processRawData 로직과 동일 ──
// 업태 화이트리스트. 공공API의 BZSTAT_SE_NM은 세분류라 '커피숍'과 '까페'가 별개 값으로 온다
// — 카페/제과/레스토랑 계열 세분류가 빠져 있어 타겟 매장이 조회·업로드 양쪽에서 통째로 누락됐다(2026-07-27 보강).
const TARGET_CATEGORIES = [
  '한식', '기타 휴게음식점', '기타', '레스토랑', '키즈카페', '경양식',
  '커피숍', '까페', '다방', '전통찻집', '떡카페',   // 카페 계열
  '제과점영업', '과자점',                          // 제과 계열
  '패밀리레스트랑',                                // 레스토랑 계열
];
const CATEGORY_RENAME: Record<string, string> = {
  커피숍: '카페', 까페: '카페', 다방: '카페', 전통찻집: '카페', 떡카페: '카페',
  제과점영업: '베이커리', 과자점: '베이커리',
  경양식: '레스토랑', 패밀리레스트랑: '레스토랑',
  '기타 휴게음식점': 'FS기타', 기타: 'FS기타',
};

// 편의점 브랜드 표기 변형 — 대소문자·띄어쓰기 무시. 'cu'는 영문 단어 일부(Cuba·cupid·Curd)를 피하려고 앞뒤 영문자 없는 경우만.

const EXCLUDE_KEYWORDS = [...SHARED_EXCLUDE_KEYWORDS, '생선회', '회센타', '회센터', '물회'];

const FC_KEYWORDS = [
  '스타벅스', '메가커피', '메가엠지씨', '컴포즈', '빽다방', '이디야', '메가', '메가MGC', '우지커피',
  '투썸플레이스', '투썸', '할리스', '파스쿠찌', '폴바셋', '풀바셋', '엔제리너스', '카페베네', '탐앤탐스',
  '설빙', '공차', '아마스빈', '더벤티', '쥬씨', '감성커피', '백억커피', '김준호의', '만랩',
  '파리바게뜨', '뚜레쥬르', '던킨', '베스킨라빈스', '매머드커피', '브레댄코', '카페일리터', '하삼동', '텐퍼센트',
];

const SIDO_SHORT: Record<string, string> = {
  서울특별시: '서울', 서울시: '서울', 서울: '서울',
  부산광역시: '부산', 부산시: '부산', 부산: '부산',
  대구광역시: '대구', 대구시: '대구', 대구: '대구',
  인천광역시: '인천', 인천시: '인천', 인천: '인천',
  광주광역시: '광주', 광주시: '광주', 광주: '광주',
  대전광역시: '대전', 대전시: '대전', 대전: '대전',
  울산광역시: '울산', 울산시: '울산', 울산: '울산',
  세종특별자치시: '세종', 세종시: '세종', 세종: '세종',
  제주특별자치도: '제주', 제주도: '제주', 제주: '제주',
  // 특별자치도 개명 시도 — 주소는 '강원특별자치도…'인데 managers 지역은 '강원도'일 수 있어 variants로 흡수
  강원특별자치도: '강원도', 강원도: '강원도', 강원: '강원도',
  전북특별자치도: '전라북도', 전라북도: '전라북도', 전북: '전라북도',
};

// 공공 API LOTNO_ADDR::LIKE용 — 특별자치도 개명 시도는 짧은 substring으로 검색
const SIDO_LIKE: Record<string, string> = { 강원도: '강원', 전라북도: '전북', 광주: '전남광주통합특별시' };

const SIDO_FULLNAME_VARIANTS: Record<string, string[]> = {
  서울: ['서울특별시', '서울시', '서울'],
  부산: ['부산광역시', '부산시', '부산'],
  대구: ['대구광역시', '대구시', '대구'],
  인천: ['인천광역시', '인천시', '인천'],
  광주: ['전남광주통합특별시', '광주광역시', '광주시', '광주'], // 2026-07 광주+전남 통합 — 주소가 통합시 명칭으로 소급 변경
  대전: ['대전광역시', '대전시', '대전'],
  울산: ['울산광역시', '울산시', '울산'],
  세종: ['세종특별자치시', '세종시', '세종'],
  제주: ['제주특별자치도', '제주도', '제주'],
  강원도: ['강원특별자치도', '강원도'],
  전라북도: ['전북특별자치도', '전라북도'],
};

const METRO_GU_SIDO: Record<string, string> = {
  강남구: '서울', 강동구: '서울', 강북구: '서울', 강서구: '서울',
  관악구: '서울', 광진구: '서울', 구로구: '서울', 금천구: '서울',
  노원구: '서울', 도봉구: '서울', 동대문구: '서울', 동작구: '서울',
  마포구: '서울', 서대문구: '서울', 서초구: '서울', 성동구: '서울',
  성북구: '서울', 송파구: '서울', 양천구: '서울', 영등포구: '서울',
  용산구: '서울', 은평구: '서울', 종로구: '서울', 중랑구: '서울',
  금정구: '부산', 동래구: '부산', 부산진구: '부산', 사상구: '부산',
  사하구: '부산', 수영구: '부산', 연제구: '부산', 영도구: '부산', 해운대구: '부산',
  계양구: '인천', 남동구: '인천', 미추홀구: '인천', 부평구: '인천', 연수구: '인천',
  // 2026-07 인천 구 개편 신설구 — 전국에 동명 구가 없어 안전하게 등재
  검단구: '인천', 서해구: '인천', 제물포구: '인천', 영종구: '인천',
  달서구: '대구', 달성군: '대구', 수성구: '대구',
  울주군: '울산',
  광산구: '광주',
};

interface RawItem {
  [key: string]: string | number | undefined;
}
interface NormItem {
  id: string;
  business_name: string;
  business_type: string;
  _rawCategory: string;
  permit_date: string;
  road_address: string;
  address1: string;
  address2: string;
  address3: string;
  area: string;
  _pyeong: number;
  lat: null;
  lng: null;
}

function buildQS(params: Record<string, string | undefined>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    // 키도 반드시 인코딩 — 2026-08 초 공공데이터 게이트웨이 개편 후 cond[...] 대괄호를
    // 원문으로 보내면 에러 없이 totalCount=0이 온다(같은 조회 %5B 인코딩 시 1,067건 실측).
    // HTTP 200·정상 JSON이라 실패 감지에 안 걸려 조회·크론이 6일간 조용히 빈손이었다.
    parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
  }
  return parts.join('&');
}

async function fetchPage(
  typeCode: string,
  apiKey: string,
  startDate: string,
  endDate: string,
  regionHint: string,
  pageNo: number,
  attempt = 0,
): Promise<{ items: RawItem[]; totalCount: number; failed?: boolean; status?: number; error?: string }> {
  const qs = buildQS({
    serviceKey: apiKey,
    pageNo: String(pageNo),
    numOfRows: '100',
    returnType: 'json',
    'cond[LCPMT_YMD::GTE]': startDate,
    'cond[LCPMT_YMD::LTE]': endDate,
    'cond[SALS_STTS_CD::EQ]': '01',
    // 특별자치도 개명(강원 2023-06, 전북 2024-01): 주소가 '강원특별자치도…'라 '강원도' LIKE는 0건
    // → 개명 전후를 모두 잡는 짧은 형태로 변환. 타 시도 오탐은 이후 주소 기반 지역 매칭이 걸러냄.
    ...(regionHint ? { 'cond[LOTNO_ADDR::LIKE]': SIDO_LIKE[regionHint] || regionHint } : {}),
  });

  // 재시도 2회 — 공공API가 간헐적으로 페이지를 실패시킨다(같은 조회를 3회 반복하니 251/233/233건).
  // 페이지 하나가 날아가면 그 조회 결과에서 최대 100건이 조용히 빠지고, 이 결과가 그대로
  // licenses에 업로드된다. 시장분석 수집(market-stats)에 이미 있던 것을 옮겨온 것.
  // 성공 시에는 추가 지연이 없다(실패했을 때만 0.8s·1.6s 백오프).
  const retry = async (e?: Partial<{ status: number; error: string }>) => {
    if (attempt >= 2) return { items: [], totalCount: 0, failed: true, ...e };
    await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
    return fetchPage(typeCode, apiKey, startDate, endDate, regionHint, pageNo, attempt + 1);
  };

  const ctrl = new AbortController();
  // 20s — 개편 후 게이트웨이가 느려져 페이지당 2~5초(부하 시 그 이상). 7s로는 정상 응답도 잘랐다.
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`${ENDPOINTS[typeCode]}?${qs}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return retry({ status: res.status });

    const json = await res.json();
    const body = json?.response?.body ?? json?.body ?? json ?? {};
    const raw = body?.items?.item ?? body?.items ?? body?.data ?? [];
    const items: RawItem[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const totalCount = parseInt(
      String(body?.totalCount ?? body?.total_count ?? body?.total ?? items.length),
      10,
    );
    return { items, totalCount };
  } catch (e) {
    clearTimeout(timer);
    return retry({ error: (e as Error).message });
  }
}

function getEffectiveSido(regionStr: string): string {
  const first = regionStr.split(' ')[0];
  const mapped = SIDO_SHORT[first];
  if (mapped) return mapped;
  return METRO_GU_SIDO[first] || first;
}

async function fetchAllForType(
  typeCode: string,
  apiKey: string,
  startDate: string,
  endDate: string,
  regions: string[],
): Promise<{ items: RawItem[]; failedRegions: string[]; truncatedSido: { sido: string; total: number }[] }> {
  const sidoSet = new Set(regions.map((r) => getEffectiveSido(r)).filter(Boolean));
  const sidoList = [...sidoSet];

  const firstPages = await Promise.all(
    sidoList.map((sido) => fetchPage(typeCode, apiKey, startDate, endDate, sido, 1)),
  );

  const all: RawItem[] = [];
  const failedSido: string[] = [];
  const truncatedSido: { sido: string; total: number }[] = [];

  const pageTasks: { sido: string; page: number }[] = [];
  firstPages.forEach((page, idx) => {
    if (page.failed) {
      failedSido.push(sidoList[idx]);
      return;
    }
    all.push(...page.items);
    const realPages = Math.ceil((page.totalCount || 0) / 100);
    const cappedPages = Math.min(realPages, 20);
    if (realPages > 20) truncatedSido.push({ sido: sidoList[idx], total: page.totalCount });
    for (let p = 2; p <= cappedPages; p++) pageTasks.push({ sido: sidoList[idx], page: p });
  });

  if (pageTasks.length) {
    // 후속 페이지는 동시 2개로 제한 — 2026-08 개편 후 게이트웨이가 같은 키의 동시 호출을
    // 줄 세워 처리해서(순차 2~5초, 동시 8개면 12~14초 실측) 전부 병렬로 쏘면 타임아웃이
    // 무더기로 난다. 업종 3개가 이 함수를 병렬로 타므로 전체 동시성은 최대 ~6.
    // 실패는 시도 단위로 failedRegions에 집계 — 1페이지만 추적하던 탓에 건수가
    // 57~82처럼 출렁여도 화면엔 아무 경고가 없었다(2026-08-11 실측).
    const queue = [...pageTasks];
    const worker = async () => {
      for (let t = queue.shift(); t; t = queue.shift()) {
        const r = await fetchPage(typeCode, apiKey, startDate, endDate, t.sido, t.page);
        all.push(...r.items);
        if (r.failed && !failedSido.includes(t.sido)) failedSido.push(t.sido);
      }
    };
    await Promise.all(Array.from({ length: Math.min(2, queue.length) }, worker));
  }

  return { items: all, failedRegions: failedSido, truncatedSido };
}

function normalize(item: RawItem, typeCode: string): NormItem {
  const name = String(item.BPLC_NM || '').trim();
  const rawCategory = String(item.BZSTAT_SE_NM || item.UPTAE_NM || TYPE_LABELS[typeCode] || '').trim();
  const permitRaw = String(item.LCPMT_YMD || '').replace(/\D/g, '');
  const permitDate =
    permitRaw.length >= 8
      ? `${permitRaw.slice(0, 4)}-${permitRaw.slice(4, 6)}-${permitRaw.slice(6, 8)}`
      : '';

  const roadAddr = String(item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').trim();
  const jibunAddr = String(item.LOTNO_ADDR || '').trim();

  const tokens = jibunAddr.split(' ').filter(Boolean);
  let addr1 = '';
  let addr2 = '';
  let addr3 = '';
  if (tokens.length >= 2) {
    addr1 = tokens[0];
    addr2 = tokens[1];
    addr3 = tokens[2] || '';
  } else {
    addr1 = '확인필요';
    addr2 = '확인필요';
    addr3 = '확인필요';
  }

  const areaM2 = parseFloat(String(item.LCTN_AREA || item.FCLT_TOTAL_SCL || '0').replace(/,/g, '')) || 0;
  const pyeong = areaM2 > 0 ? +(areaM2 / 3.3).toFixed(1) : 0;

  let category = CATEGORY_RENAME[rawCategory] || rawCategory;
  if (FC_KEYWORDS.some((kw) => name.includes(kw))) category = 'F/C';
  if (roadAddr.includes('인천공항') || name.includes('인천공항')) category = '인천공항';

  return {
    id: String(item.MNG_NO || `${name}_${jibunAddr}`),
    business_name: name,
    business_type: category,
    _rawCategory: rawCategory,
    permit_date: permitDate,
    road_address: roadAddr,
    address1: addr1,
    address2: addr2,
    address3: addr3,
    area: pyeong > 0 ? pyeong.toString() : '',
    _pyeong: pyeong,
    lat: null,
    lng: null,
  };
}

// ─── 상호로 거르는 비타겟 음식점 (2026-09-04 전국 점검, 사용자 확정) ────────────────
// 업태가 '기타'·'경양식'으로 등록돼 업태 차단을 통과한 음식점들. 한 줄이 한 유형이고, 대소문자는 무시한다.
// · 한식·탕·고기는 100평(330㎡) 이상이면 대량 납품 여지가 있어 남긴다 — 업태 '한식' 규칙과 같은 기준.
// · 대형 버거·피자 체인, 주점, 연회·행사, 푸드트럭은 입점 접점이 있어 일부러 넣지 않았다.
// · 오탐 방지: '한우리'(고유명사), '베이커리' 안의 '커리', '에스프레소바' 안의 '소바', '타코야끼'(이미 차단)는 제외.


function applyBusinessLogic(items: NormItem[], regionList: string[]): NormItem[] {
  const regionVariants = regionList.map((r) => {
    const parts = r.split(' ');
    const short = SIDO_SHORT[parts[0]];
    if (!short) return [r];
    const rest = parts.slice(1).join(' ');
    const variants = SIDO_FULLNAME_VARIANTS[short] || [short];
    return variants.map((v) => (rest ? `${v} ${rest}` : v));
  });

  return items.filter((it) => {
    if (!TARGET_CATEGORIES.includes(it._rawCategory)) return false;
    if (EXCLUDE_KEYWORDS.some((kw) => it.business_name.includes(kw))) return false;
    if (CONVENIENCE_RE.test(it.business_name)) return false; // 편의점 표기 변형(gs25·cu○○점·지에스 25) — market-stats와 동기화(2026-09-04)
    if (isNonTargetName(it.business_name, it._pyeong * 3.3)) return false; // 치킨 브랜드·한식(100평 미만)·중식·일식·아시아 — market-stats와 동기화(2026-09-04)
    // '국수'는 '한국수출입은행/한국수력…' 기관명 구내카페 오탐이 있어 예외를 두고 차단 (시장분석과 동일)
    if (it.business_name.includes('국수') && !it.business_name.includes('한국수')) return false;
    // '한우'도 동일 패턴 — '한우리'(별개 고유명사: 한우리카페·한우리단팥빵·파리바게뜨 옥정한우리점)는 통과 (2026-08-28)
    if (it.business_name.includes('한우') && !it.business_name.includes('한우리')) return false;
    if (it._rawCategory === '한식' && it._pyeong < 100) return false;
    const addrStr = (it.road_address || '') + ' ' + (it.address1 || '') + ' ' + (it.address2 || '');
    if (!regionVariants.some((variants) => variants.some((v) => addrStr.includes(v)))) return false;
    return true;
  });
}

export async function GET(req: NextRequest) {
  const API_KEY = process.env.PUBLIC_DATA_API_KEY;
  if (!API_KEY) {
    return NextResponse.json(
      { success: false, error: 'PUBLIC_DATA_API_KEY 환경변수가 설정되지 않았습니다.' },
      { status: 500 },
    );
  }

  const { searchParams } = new URL(req.url);
  const types = searchParams.get('types') || 'general_restaurants,bakeries,rest_cafes';
  const regions = searchParams.get('regions') || '';
  const startDate = searchParams.get('startDate') || '';
  const endDate = searchParams.get('endDate') || '';

  if (!startDate || !endDate) {
    return NextResponse.json({ success: false, error: 'startDate, endDate는 필수입니다. (YYYYMMDD)' }, { status: 400 });
  }
  if (!regions) {
    return NextResponse.json({ success: false, error: '지역(regions)을 하나 이상 선택해주세요.' }, { status: 400 });
  }

  const typeList = types.split(',').map((t) => t.trim()).filter((t) => ENDPOINTS[t]);
  const regionList = regions.split(',').map((r) => r.trim()).filter(Boolean);

  if (!typeList.length) {
    return NextResponse.json({ success: false, error: '유효한 업종 코드가 없습니다.' }, { status: 400 });
  }
  if (!regionList.length) {
    return NextResponse.json({ success: false, error: '유효한 지역이 없습니다.' }, { status: 400 });
  }

  const cleanStart = startDate.replace(/-/g, '');
  const cleanEnd = endDate.replace(/-/g, '');
  const startISO = `${cleanStart.slice(0, 4)}-${cleanStart.slice(4, 6)}-${cleanStart.slice(6, 8)}`;
  const endISO = `${cleanEnd.slice(0, 4)}-${cleanEnd.slice(4, 6)}-${cleanEnd.slice(6, 8)}`;

  try {
    const results = await Promise.all(
      typeList.map((t) => fetchAllForType(t, API_KEY, cleanStart, cleanEnd, regionList)),
    );

    const seen = new Set<string>();
    let merged: NormItem[] = [];
    const allFailedRegions: string[] = [];
    const allTruncated: { sido: string; total: number }[] = [];

    results.forEach(({ items, failedRegions, truncatedSido }, i) => {
      if (failedRegions?.length) allFailedRegions.push(...failedRegions);
      if (truncatedSido?.length) allTruncated.push(...truncatedSido);
      items.forEach((raw) => {
        const norm = normalize(raw, typeList[i]);
        if (!norm.id || seen.has(norm.id)) return;
        seen.add(norm.id);
        if (norm.permit_date && (norm.permit_date < startISO || norm.permit_date > endISO)) return;
        merged.push(norm);
      });
    });

    merged = applyBusinessLogic(merged, regionList);

    merged.sort((a, b) => {
      const aSp = a.business_type === 'F/C' || a.business_type === '인천공항';
      const bSp = b.business_type === 'F/C' || b.business_type === '인천공항';
      if (aSp !== bSp) return aSp ? 1 : -1;
      return (b._pyeong || 0) - (a._pyeong || 0);
    });

    const items = merged.map((m) => {
      const { _rawCategory, _pyeong, ...rest } = m;
      void _rawCategory;
      void _pyeong;
      return rest;
    });

    const uniqueFailed = [...new Set(allFailedRegions)];
    return NextResponse.json({
      success: true,
      totalCount: items.length,
      items,
      ...(uniqueFailed.length > 0 && { failedRegions: uniqueFailed }),
      ...(allTruncated.length > 0 && { truncated: allTruncated }),
    });
  } catch (e) {
    return NextResponse.json({ success: false, error: (e as Error).message }, { status: 500 });
  }
}
