import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 120;
import proj4 from 'proj4';

const EPSG5174 =
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

const ENDPOINTS: Record<string, string> = {
  general_restaurants: 'https://apis.data.go.kr/1741000/general_restaurants/info',
  rest_cafes: 'https://apis.data.go.kr/1741000/rest_cafes/info',
  bakeries: 'https://apis.data.go.kr/1741000/bakeries/info',
};

const EXCLUDE_KEYWORDS = [
  '편의점', 'GS25', 'CU', '세븐일레븐', '이마트24', '찐빵', '육회', '고기', '홍어', '참치', '씨유', '포차', '한끼',
  'PC', '피시', '게임', '당구', '만화', '노래', '제육', '곰탕', '설렁탕', '설농탕', '칼국수', '숯불', '베트남', '동남아', '쌀국수', '조건부', '펍',
  '무인', '자판기', '아이스크림', '밀키트', '한시적', '피씨', '핫도그', '분식', '떡볶이', '치킨', '튀김', '어묵', '오뎅', '브뤼셀프라이', '피자', '7080라이브',
  '구내식당', '급식', '장례', '매점', '휴게소', '반점', '고로케', '초밥', '써브웨이', '홍콩반점', '삼겹', '갈비', '찜', '밥상', '롯데리아', '맥도날드', '버거킹', '맘스터치',
  '곱창', '닭', '이자카야', '라멘', '라면', '우동', '스시', '카츠', '돈까스', '야끼',
  '만두', '면옥', '김밥', // 인허가추출 블랙리스트와 동기화(2026-08-13) — 업종이 분식·기타로 잡혀 업종 차단을 새던 비타겟. '국수'는 오탐 예외가 필요해 isTarget에서 별도 처리
  // 2026-08-13 정밀화 2차(사용자 확정): 한식·탕반/술안주/중식·해물/소매. 골프·사우나·헬스는 유지 결정.
  // '탕후루·식당·꽈배기·오리'는 넣지 말 것 — 오리('크로플덕 오리아가씨'·'레오네 오리진'), 식당('청평설빙식당') 오탐 실측, 탕후루·꽈배기는 유지 결정.
  '국밥', '해장', '감자탕', '삼계탕', '찌개', '백반', '비빔밥', '덮밥', '순대',
  '족발', '보쌈', '막창', '양꼬치', '막걸리', '주막', '전집',
  '마라', '샤브', '수산', '쭈꾸미', '낙지', '횟', '돈가스',
  '도시락', '반찬', '정육', '떡집', '떡방', '방앗간',
  '야시장', // 행사형 야시장 + 뉴욕야시장(요리주점 체인) — 2026-08-17 사용자 확정
  '맥주', '호프', '포장마차', '칵테일', '술집', // 술집 누수 차단(category='기타'에 다수). '소주/단란'은 '…주식회사'·정상카페 오탐, '주점/마트/슈퍼/와인'은 지점명(여주점·남양주점)·입점매장(이마트 던킨)·양식당 오탐 커서 제외
  '팝업', // 한시적·일시적 운영 매장(상권 모수 왜곡). '라운지'는 일반 카페명 오탐 심해 제외
  // 2026-08-27 정밀화 3차(인허가추출과 동기화, 사용자 확정) — 취미·유흥 공간 + 한시적 행사 부스.
  // 홀덤이 '기타' 업태로 182곳 통과하던 누수 실측. '포커/클럽/라운지/파티/꽃/짐'은 정상 카페 오탐(템포커피·커피로스팅클럽·파티세리·지짐이)으로 제외 유지.
  // 복합어만 쓴 것들의 단독형은 오탐 실측: 타로(산타로사·바리스타로스팅), 스터디(바나프레소 메가스터디타워점·디저트 스터디),
  // 부스(베이크부스·부스트카페·버거부스), 네일(카페베네일산호수공원점)은 아예 제외.
  '홀덤', '보드카페', '타로카페', '사주', '낚시', '볼링', '다트', '오락', '카지노', '슬롯',
  '멀티방', '방탈출', '클라이밍', '사진관', '전자담배', '빨래방', '코인워시', '필라테스', '세차', '브이알',
  '스터디카페', '스터디룸', '스터디센터', '스터디하우스',
  '축제', '단오제', '페스티벌', '박람회', '먹거리부스', '먹거리 부스', '음식부스', '홍보부스', '체험부스', '번부스', // 행사 부스(강릉단오제 먹거리존 등, DB 소급 삭제 완료) — '엑스포'는 지점명(이디야커피엑스포점) 오탐으로 제외
  // 2026-08-27 정밀화 3차 추가분(사용자 확정) — 상호=법인명 그대로 수십~수백 주소에 반복 등록되는 행사·팝업 운영사(리은푸드 743행/163주소 등, 개폐업 반복으로 지표 왜곡).
  '리은푸드', '제이와이에스유통', '주바른', '금덕푸드', '행복생활에프앤비', '감동푸드', '미르에프엔비',
  '대신에프앤', '서울키친', '어랑사랑', '우진유통', '참살이유통', '지오에프앤씨', '에이치에스마켓',
  // 술 잔존(혼술바·위스키바) + 행사·단체(야행·장터·새마을부녀회류) + 시설 구내(푸드코트·수영장 카페테리아).
  // '온천/보훈/대회/페스타/연수원/스키'는 지점명·인명·라페스타·위스키 오탐으로 제외.
  '혼술', '위스키', '야행', '장터', '새마을', '부녀회', '협의회', '마을회', '주민자치', '생활개선',
  '사업단', '번영회', '경로당', '푸드코트', '수영장', '파티룸', '경륜',
  '프랭크버거', '노브랜드버거', // 대형 버거 체인 확장(롯데리아·맥도날드·버거킹·맘스터치에 이어) — 그 외 수제버거는 유지
  // 백화점·아울렛 입점 매장(상호 기준 700곳) — 시설 이벤트(개점·리뉴얼·계약종료)가 동 단위 개업·폐업 신호를 왜곡.
  // 업태 '백화점' 차단(EXCLUDE_CATEGORIES)과 같은 논리의 상호 레벨 보완. ⚠️시장분석 전용 — 인허가 추출(public-license)은 관대한 그물이라 일부러 미적용(사용자 확정).
  '백화점', '아울렛',
  // 행사 잔존(프리·플리마켓) + 골프장 코스 시설(그늘집·컨트리클럽 — '골프 유지' 결정은 스크린골프 카페 한정). ⚠️시장분석 전용(사용자 확정).
  '프리마켓', '플리마켓', '그늘집', '컨트리클럽',
  // 오리집 복합어(2026-08-27 사용자 확정) — '오리' 단독은 오리지널·오리진·오리엔탈·오리역 오탐 48곳+라 금지, 복합어만.
  '오리바베큐', '오리바비큐', '오리집', '오리고기', '오리탕', '오리백숙', '오리로스', '오리구이', '오리주물럭', '오리훈제', '유황오리', '토종오리', '오리명가',
  // 위탁급식·리테일 법인 직영(구내식당·사내카페·편의점·슈퍼 — 본사 직납이라 개척 대상 아님). 기존 편의점·구내식당 차단과 같은 계열.
  '아워홈', '웰스토리', '현대그린푸드', '프레시웨이', '신세계푸드', '풀무원푸드', '동원홈푸드',
  '비지에프리테일', '지에스리테일', '코리아세븐', '미니스톱',
  '빵굽는마을', '빵페스타', // 강릉 빵 축제(죽헌동 149·임영관) — 참가 베이커리가 행사장 주소로 일괄 인허가
  '보해명가', // 떡·한과 다지점 납품업체(법인명 그대로 5개 지점 등록) — 비타겟
];

// 시설 주소 차단(2026-08-27, 사용자 확정) — 백화점·몰 지하 식품관 '행사 매대'는 자기 브랜드명으로 1~3주짜리
// 인허가를 반복해서 받는다(신세계 강남 B1 한 주소에 상호 188개, '미당'은 24개월간 신규 24회). 상호 키워드로는
// 못 잡아서 주소의 시설 건물명으로 차단. 상설 입점 매장도 함께 빠지지만 '시설 상권은 모수 제외' 결정과 일관.
// ⚠️시장분석 전용 — 인허가 추출은 미적용. '킨텍스'는 도로명(킨텍스로) 오탐이라 넣지 말 것.
const EXCLUDE_ADDR_KEYWORDS = [
  '백화점', '아울렛', '더현대', '갤러리아 광교', '갤러리아백화점', 'AK플라자', '타임스퀘어',
  '롯데월드몰', '롯데월드타워', '아이파크몰', '스타필드', 'IFC몰', '파크원', '하이페리온',
  '컨벤션센터', '코엑스', '엔터식스', '현대시티', '용산역', '킴스클럽', '사우스시티',
  // 대형마트도 동일 구조(이마트 주소에 상호 349개 — 행사매대 churn + 인스토어 입점).
  '이마트', '홈플러스', '롯데마트', '트레이더스', '코스트코', '하나로마트', '메가마트', '세이브존', '뉴코아',
  // 2차 꼬리(주소 churn 재스캔) — ①건물명 없이 번지로만 등록된 백화점(소공로 63=신세계본점 등)
  // ②놓친 몰·전시장 ③상설 행사장. '엘리시안'은 동명 아파트 상가 오탐 우려로 '엘리시안 강촌'만.
  '소공로 63', '남대문로 81', '신반포로 176', '을지로 281', '롯데몰', '타임빌라스', '디큐브시티',
  '엘리시안 강촌', '상상플랫폼', '수원메쎄', '스피드스케이팅경기장', '문화예술회관', '국민관광지',
  '올림픽공원', '화랑대철도공원', '체험센터', ' 일대',
  '원적로775번길 17-1', '모가면 공원로 48', '쌀광길 54', // 이천 산수유 가을한마당·쌀문화축제장, 의정부 푸드홀(르 봉 마르셰 1~18호점)
  // market_quality_audit 1차 실행 발견분 — 공원·문화시설·둔치 행사장. ' 일원'은 일원동 오탐이라 금지.
  '국립극장', '문화비축기지', '오목공원', '중화체육공원', '둔치', '푸드존', '고척리 594-4', '임영로131번길 6',
  // 2차 실행 발견분 — 건물명 생략 주소 변형(제방안길=동강둔치, 목동서로=오목공원) + 행사장·공공시설.
  // '청계천로 40'은 뒤 구분자까지 포함(청계천로 400 오탐 방지) — 한국관광공사 서울센터(행사 부스).
  '제방안길 45', '귀백리 168-3', '수변공원', '목동서로 159-2', '생활SOC', '성북로8가길 1', '청계천로 40,', '청계천로 40 (',
];

// 업종(UPTAE_NM) 기반 제외 — 이름과 무관하게 비대상 업종을 차단(이름키워드만으론 새던 것 보완)
const EXCLUDE_CATEGORIES = [
  '호프/통닭', '정종/대포집/소주방', '감성주점', '라이브카페', // 술집류
  '식육(숯불구이)', '횟집', '탕류(보신용)', '복어취급',         // 고기·회
  '편의점',                                                    // 소매
  '일식', '중국식', '냉면집', '김밥(도시락)', '통닭(치킨)',     // 유제품 비타겟 일반식당(영업 대상 아님)
  '외국음식전문점(인도,태국등)',                                // 태국·동남아 등 — 비타겟(2026-07-27 사용자 확인)
  // 비매장형·시설 입점·이동/출장 — 상권 매장이 아니라 모수에서 제외(팝업·라운지 多)
  '백화점', '철도역구내', '고속도로', '공항', '관광호텔', '극장', '유원지', // 시설 입점/구내
  '출장조리', '이동조리', '푸드트럭',                                       // 이동·출장(한시적)
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
  경기도: '경기도', 경기: '경기도',
  강원도: '강원도', 강원특별자치도: '강원도',
  충청북도: '충청북도', 충북: '충청북도',
  충청남도: '충청남도', 충남: '충청남도',
  전라북도: '전라북도', 전북: '전라북도', 전북특별자치도: '전라북도',
  전라남도: '전라남도', 전남: '전라남도',
  경상북도: '경상북도', 경북: '경상북도',
  경상남도: '경상남도', 경남: '경상남도',
};

function toShort(sido: string | null | undefined): string {
  return SIDO_SHORT[sido?.trim() ?? ''] || sido?.trim() || '';
}

// 공공 API LOTNO_ADDR::LIKE용 검색어 — 특별자치도 개명(강원 2023-06, 전북 2024-01)으로
// 주소가 '강원특별자치도…'라 '강원도' LIKE는 0건. 개명 전후 주소를 모두 substring으로 잡는
// 짧은 형태를 쓴다. 타 시도 주소에 우연히 포함돼도 extract()의 expectedSido 검증이 걸러냄.
const SIDO_LIKE: Record<string, string> = { 강원도: '강원', 전라북도: '전북' };
function toLike(sidoShort: string): string {
  return SIDO_LIKE[sidoShort] || sidoShort;
}

function buildQS(params: Record<string, string | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    // 키도 인코딩(public-license와 동일 사유) — 게이트웨이 개편 후 원문 대괄호는 조용히 0건
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join('&');
}

function getBizName(item: any): string {
  return (item.BPLC_NM || item.BPLCNM || item.BIZPLC_NM || item.BIZ_PLCE_NM || '').toString().trim();
}

function isTarget(item: any): boolean {
  const cat = (item.UPTAE_NM || item.BZSTAT_SE_NM || '').trim();
  if (EXCLUDE_CATEGORIES.includes(cat)) return false; // 업종 우선 차단
  const bizName = getBizName(item);
  if (EXCLUDE_KEYWORDS.some((kw) => bizName.includes(kw))) return false;
  const addr = (item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').toString();
  if (EXCLUDE_ADDR_KEYWORDS.some((kw) => addr.includes(kw))) return false;
  // '국수'는 '한국수출입은행/한국수력…' 같은 기관명 구내카페 오탐이 있어 예외를 두고 차단
  if (bizName.includes('국수') && !bizName.includes('한국수')) return false;
  // 한식은 대량납품 가능한 대형(100평↑=330㎡↑)만 타겟 — 인허가추출 기준과 통일. 면적 결측도 제외.
  if (cat === '한식') {
    const areaM2 = parseFloat((item.LCTN_AREA || item.FCLT_TOTAL_SCL || '0').toString().replace(/,/g, '')) || 0;
    if (areaM2 < 330) return false;
  }
  return true;
}

// YYYYMMDD → YYYY-MM-DD (이미 대시 있으면 그대로). 폐업일자 필터 전용.
function dashYmd(s: string): string {
  const d = s.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : s;
}

// 페이지 요청 실패(타임아웃 포함) 시 최대 2회 재시도 — 실패가 조용히 빈 페이지로 넘어가면
// 월별 수집이 티 안 나게 결손됨(폐업 186건 유실 사례). 재시도 후에도 실패면 빈 배열.
async function fetchPage(type: string, apiKey: string, sido: string, pageNo: number, mode: string, start: string, end: string, attempt = 0): Promise<{ items: any[]; totalCount: number }> {
  const isNew = mode === 'new';
  const qs = buildQS({
    serviceKey: apiKey,
    pageNo: String(pageNo),
    numOfRows: '100',
    returnType: 'json',
    // 공공API 함정: 신규(LCPMT_YMD)는 무대시(YYYYMMDD)만, 폐업(CLSBIZ_YMD)은 대시(YYYY-MM-DD)만 필터가 먹힘.
    // 폐업에 무대시로 보내면 totalCount=0 → 과거 폐업이 안 들어오던 원인.
    // new_closed: 개업일 기준 + 현재 폐업(03) — 생존편향 교정. 상태 01만 수집하면
    // 과거 월의 개업 중 이후 폐업한 매장이 '개업' 통계에서 통째로 빠짐(2024-12 경기 음식점 기준 26% 과소).
    ...(isNew
      ? { 'cond[LCPMT_YMD::GTE]': start, 'cond[LCPMT_YMD::LTE]': end, 'cond[SALS_STTS_CD::EQ]': '01' }
      : mode === 'new_closed'
        ? { 'cond[LCPMT_YMD::GTE]': start, 'cond[LCPMT_YMD::LTE]': end, 'cond[SALS_STTS_CD::EQ]': '03' }
        : { 'cond[CLSBIZ_YMD::GTE]': dashYmd(start), 'cond[CLSBIZ_YMD::LTE]': dashYmd(end), 'cond[SALS_STTS_CD::EQ]': '03' }),
    'cond[LOTNO_ADDR::LIKE]': toLike(sido),
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${ENDPOINTS[type]}?${qs}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = await res.json();
    const body = json?.response?.body ?? json?.body ?? json ?? {};
    const raw = body?.items?.item ?? body?.items ?? body?.data ?? [];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const totalCount = parseInt(body?.totalCount ?? items.length, 10) || 0;
    return { items, totalCount };
  } catch {
    clearTimeout(timer);
    if (attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      return fetchPage(type, apiKey, sido, pageNo, mode, start, end, attempt + 1);
    }
    return { items: [] as any[], totalCount: 0 };
  }
}

async function fetchAll(type: string, apiKey: string, sido: string, mode: string, start: string, end: string) {
  const first = await fetchPage(type, apiKey, sido, 1, mode, start, end);
  const items = [...first.items];
  // 40페이지(4,000행) — 20페이지(2,000행)로는 12월 폐업(경기 음식점 2,063~2,467건)이 조용히 잘렸음.
  // 페이지는 10개씩 끊어 요청(동시 39건 폭주 방지).
  const pages = Math.min(Math.ceil((first.totalCount || 0) / 100), 40);
  for (let p = 2; p <= pages; p += 10) {
    const batch = await Promise.all(
      Array.from({ length: Math.min(10, pages - p + 1) }, (_, i) => fetchPage(type, apiKey, sido, p + i, mode, start, end)),
    );
    batch.forEach((r) => items.push(...r.items));
  }

  return { items, totalCount: first.totalCount };
}

function extract(item: any, mode: string, expectedSido: string) {
  const addr = (item.LOTNO_ADDR || '').toString().trim();
  const tokens = addr.split(' ').filter(Boolean);

  if (expectedSido) {
    const addrSido = toShort(tokens[0] || '');
    if (addrSido && addrSido !== expectedSido) return { sigungu: '', month: '' };
  }

  const sigungu = tokens[1] || '';
  const raw = (mode === 'new' ? item.LCPMT_YMD : item.CLSBIZ_YMD || item.DCB_YMD)?.toString().replace(/\D/g, '') || '';
  const month = raw.length >= 6 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}` : '';

  return { sigungu, month };
}

function extractCoords(item: any): { lat: number | null; lng: number | null } {
  let lat = parseFloat(item.LAT_EPSG4326 ?? item.WGS84_LAT);
  let lng = parseFloat(item.LOT_EPSG4326 ?? item.LOT_EPST4326 ?? item.WGS84_LOT);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const x = parseFloat(item.CRD_INFO_X);
    const y = parseFloat(item.CRD_INFO_Y);
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0) {
      try {
        [lng, lat] = proj4(EPSG5174, 'EPSG:4326', [x, y]);
      } catch {
        return { lat: null, lng: null };
      }
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return { lat: null, lng: null };
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

async function saveToSupabase(sidoShort: string, detail: Record<string, Record<string, { new: number; closed: number }>>, storeRecords: any[]) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return { saved: 0, error: 'env 누락' };

  const commonHeaders: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  const snapRows: any[] = [];
  for (const [sigungu, months] of Object.entries(detail)) {
    for (const [month, counts] of Object.entries(months)) {
      snapRows.push({
        sido: sidoShort,
        sigungu,
        month,
        new_count: counts.new || 0,
        closed_count: counts.closed || 0,
        updated_at: new Date().toISOString(),
      });
    }
  }

  let saved = 0;
  let lastError: string | null = null;

  for (let i = 0; i < snapRows.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/market_snapshots?on_conflict=sido,sigungu,month`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(snapRows.slice(i, i + 100)),
    });
    if (res.ok) saved += Math.min(100, snapRows.length - i);
    else {
      const t = await res.text().catch(() => String(res.status));
      lastError = `snapshots HTTP ${res.status}: ${t.slice(0, 200)}`;
    }
  }

  const storeMap = new Map<string, any>();
  for (const s of storeRecords) {
    // 주소 포함 — 같은 달 같은 시군구의 동명 매장(지점명 없는 프랜차이즈 등)이 병합 유실되지 않게.
    // DB 유니크 키는 addr_key(주소 md5 지문)라 주소 원문이 같으면 같은 행으로 정확히 대응된다.
    const k = `${s.sido}|${s.sigungu}|${s.month}|${s.name}|${s.address}|${s.status}`;
    const prev = storeMap.get(k);
    if (!prev || (s.lat != null && prev.lat == null)) storeMap.set(k, s);
  }
  const uniqueStores = [...storeMap.values()];

  let storesSaved = 0;
  for (let i = 0; i < uniqueStores.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/market_store_records?on_conflict=sido,sigungu,month,name,addr_key,status`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(uniqueStores.slice(i, i + 100)),
    });
    if (res.ok) storesSaved += Math.min(100, uniqueStores.length - i);
    else {
      const t = await res.text().catch(() => String(res.status));
      lastError = `stores HTTP ${res.status}: ${t.slice(0, 200)}`;
    }
  }

  return { saved, storesSaved, ...(lastError ? { error: lastError } : {}) };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const API_KEY = process.env.PUBLIC_DATA_API_KEY;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const sido = searchParams.get('sido');
  const months = searchParams.get('months') || '12';
  const startYM = searchParams.get('start') || ''; // YYYYMM — 명시 윈도우(과거월 백필, 24개월 캡 우회)
  const endYM = searchParams.get('end') || '';      // YYYYMM
  const save = searchParams.get('save') || '';
  const detailMode = searchParams.get('detail') || '';
  const sigungu = searchParams.get('sigungu') || '';
  const month = searchParams.get('month') || '';

  if (detailMode === 'true') {
    if (!sido || !sigungu) {
      return NextResponse.json({ success: false, error: 'sido, sigungu 파라미터 필요' }, { status: 400 });
    }
    if (!SUPABASE_URL || !ANON_KEY) {
      return NextResponse.json({ success: false, error: 'Supabase env 누락' }, { status: 500 });
    }
    try {
      let url =
        `${SUPABASE_URL}/rest/v1/market_store_records` +
        `?sido=eq.${encodeURIComponent(toShort(sido))}` +
        `&sigungu=eq.${encodeURIComponent(sigungu)}` +
        `&select=name,category,area_m2,pyeong,address,status,license_date,lat,lng` +
        `&order=license_date.desc`;
      if (month) url += `&month=eq.${encodeURIComponent(month)}`;

      const r = await fetch(url, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      });
      if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
      const stores = await r.json();
      const summary = stores.reduce(
        (a: any, s: any) => {
          if (s.status === 'new') a.new++;
          else a.closed++;
          return a;
        },
        { new: 0, closed: 0 },
      );
      return NextResponse.json({ success: true, sido: toShort(sido), sigungu, month: month || null, summary, stores });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }

  if (!API_KEY) return NextResponse.json({ success: false, error: 'API key missing' }, { status: 500 });
  if (!sido) return NextResponse.json({ success: false, error: 'sido 파라미터 필요' }, { status: 400 });

  const sidoShort = toShort(sido);
  const doSave = save === 'true';

  // save=true는 DB 쓰기 경로 — 크론·백필 전용(CRON_SECRET 필요). 조회는 기존대로 공개.
  if (doSave) {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  const now = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // 윈도우 결정: start/end(YYYYMM) 명시 시 그 구간(과거 포함), 아니면 "오늘 기준 N개월"
  const ymRe = /^\d{6}$/;
  let startStr: string, endStr: string, monthList: string[];
  if (ymRe.test(startYM) && ymRe.test(endYM)) {
    const ey = parseInt(endYM.slice(0, 4)), em = parseInt(endYM.slice(4, 6));
    const lastDay = new Date(ey, em, 0).getDate(); // 해당 월의 실제 말일 (잘못된 31일 방지)
    startStr = `${startYM}01`;
    endStr = `${endYM}${String(lastDay).padStart(2, '0')}`;
    monthList = [];
    let y = parseInt(startYM.slice(0, 4)), m = parseInt(startYM.slice(4, 6));
    while (y < ey || (y === ey && m <= em)) {
      monthList.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
      if (monthList.length > 60) break; // 안전장치
    }
  } else {
    const monthCount = Math.min(Math.max(parseInt(months) || 12, 1), 24);
    startStr = fmt(new Date(now.getFullYear(), now.getMonth() - monthCount, 1));
    endStr = fmt(now);
    monthList = Array.from({ length: monthCount }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }

  try {
    const types = Object.keys(ENDPOINTS);

    // 월 단위로 쪼개 수집 — 전체 윈도우를 한 번에 받으면 타입당 2,000행(20p) 캡에 잘림
    // (경기 음식점 2개월≈2,100 > 2,000 → 최근분 누락). 월별이면 단일월 ~1,200건이라 캡 아래.
    const ymdRange = (m: string): [string, string] => {
      const [yy, mm] = m.split('-').map(Number);
      const last = new Date(yy, mm, 0).getDate();
      const p = `${yy}${String(mm).padStart(2, '0')}`;
      return [`${p}01`, `${p}${String(last).padStart(2, '0')}`];
    };
    const newRes: { items: any[] }[] = [];
    const closedRes: { items: any[] }[] = [];
    // 수집 완전성 추적 — got(실수신) < want(API totalCount, 캡 반영) 이면 그 달은 결손
    const coverage: { month: string; got: number; want: number }[] = [];
    for (const m of monthList) {
      const [ms, me] = ymdRange(m);
      // new(현재 영업중) + new_closed(개업 후 폐업) 둘 다 '개업'으로 집계 — 생존편향 교정
      const [nr, ncr, cr] = await Promise.all([
        Promise.all(types.map((t) => fetchAll(t, API_KEY, sidoShort, 'new', ms, me))),
        Promise.all(types.map((t) => fetchAll(t, API_KEY, sidoShort, 'new_closed', ms, me))),
        Promise.all(types.map((t) => fetchAll(t, API_KEY, sidoShort, 'closed', ms, me))),
      ]);
      newRes.push(...nr, ...ncr);
      closedRes.push(...cr);
      const all = [...nr, ...ncr, ...cr];
      coverage.push({
        month: m,
        got: all.reduce((s, r) => s + r.items.length, 0),
        want: all.reduce((s, r) => s + Math.min(r.totalCount || 0, 4000), 0),
      });
    }

    const monthly: Record<string, { new: number; closed: number }> = {};
    const regions: Record<string, { new: number; closed: number }> = {};
    const detailData: Record<string, Record<string, { new: number; closed: number }>> = {};
    const storeRecords: any[] = [];

    function tally(results: { items: any[] }[], mode: string) {
      results.forEach(({ items }) => {
        items.forEach((item) => {
          if (!isTarget(item)) return;
          const { sigungu: sg, month: mo } = extract(item, mode, sidoShort);
          if (!mo || !sg) return;

          const key = mode === 'new' ? 'new' : 'closed';

          if (!monthly[mo]) monthly[mo] = { new: 0, closed: 0 };
          (monthly[mo] as any)[key]++;

          if (!regions[sg]) regions[sg] = { new: 0, closed: 0 };
          (regions[sg] as any)[key]++;

          if (!detailData[sg]) detailData[sg] = {};
          if (!detailData[sg][mo]) detailData[sg][mo] = { new: 0, closed: 0 };
          (detailData[sg][mo] as any)[key]++;

          const name = getBizName(item);
          if (!name) return;
          const areaM2 = parseFloat((item.LCTN_AREA || item.FCLT_TOTAL_SCL || '0').toString().replace(/,/g, '')) || 0;
          const dateRaw = (mode === 'new' ? item.LCPMT_YMD : item.CLSBIZ_YMD || item.DCB_YMD)?.toString().replace(/\D/g, '') || '';
          const { lat, lng } = extractCoords(item);
          storeRecords.push({
            sido: sidoShort,
            sigungu: sg,
            month: mo,
            name,
            category: (item.UPTAE_NM || item.BZSTAT_SE_NM || '').trim(),
            area_m2: areaM2 > 0 ? areaM2 : null,
            pyeong: areaM2 > 0 ? Math.round((areaM2 / 3.3) * 10) / 10 : null,
            address: (item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').trim(),
            status: key,
            license_date: dateRaw.length >= 8 ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}` : null,
            lat,
            lng,
            updated_at: new Date().toISOString(),
          });
        });
      });
    }

    tally(newRes, 'new');
    tally(closedRes, 'closed');

    const monthlyArr = monthList.map((m) => ({
      month: m,
      new: monthly[m]?.new || 0,
      closed: monthly[m]?.closed || 0,
      net: (monthly[m]?.new || 0) - (monthly[m]?.closed || 0),
    }));

    const regionsArr = Object.entries(regions)
      .map(([region, { new: n, closed: c }]) => ({
        region,
        new: n,
        closed: c,
        net: n - c,
        netRate: n > 0 ? Math.round(((n - c) / n) * 100) : 0,
      }))
      .filter((r) => r.region && r.new + r.closed > 0)
      .sort((a, b) => b.new - a.new);

    const totalNew = monthlyArr.reduce((s, m) => s + m.new, 0);
    const totalClosed = monthlyArr.reduce((s, m) => s + m.closed, 0);

    let saveResult = null;
    if (doSave) {
      saveResult = await saveToSupabase(sidoShort, detailData, storeRecords);
    }

    return NextResponse.json({
      success: true,
      sido: sidoShort,
      period: { start: startStr.slice(0, 6), end: endStr.slice(0, 6), months: monthList.length },
      summary: { totalNew, totalClosed, net: totalNew - totalClosed },
      coverage,
      monthly: monthlyArr,
      regions: regionsArr,
      ...(doSave ? { saved: saveResult } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
