// 공공데이터포털 지방행정 인허가 데이터 API 프록시
// 2026-03-23 신규 스키마 대응 (cond[] 쿼리 문법 + 신규 컬럼명)
// GET /api/public-license?types=general_restaurants,rest_cafes,bakeries&startDate=20260401&endDate=20260408&regions=의정부,양주

const ENDPOINTS = {
    general_restaurants: 'https://apis.data.go.kr/1741000/general_restaurants/info',
    bakeries:            'https://apis.data.go.kr/1741000/bakeries/info',
    rest_cafes:          'https://apis.data.go.kr/1741000/rest_cafes/info'
};

const TYPE_LABELS = {
    general_restaurants: '일반음식점',
    bakeries:            '제과점영업',
    rest_cafes:          '휴게음식점'
};

// ── upload.html processRawData 로직과 동일 ──────────────
const TARGET_CATEGORIES = ['한식', '기타 휴게음식점', '기타', '커피숍', '제과점영업', '레스토랑', '키즈카페', '경양식'];
const CATEGORY_RENAME   = { '커피숍':'카페', '제과점영업':'베이커리', '기타 휴게음식점':'FS기타', '기타':'FS기타', '경양식':'레스토랑' };

const EXCLUDE_KEYWORDS = [
    '편의점', 'GS25', 'CU', '세븐일레븐', '이마트24', '찐빵', '육회', '고기', '홍어', '회', '씨유', '포차', '한끼',
    'PC', '피시', '게임', '당구', '만화', '노래', '제육', '곰탕', '숯불', '베트남', '동남아', '쌀국수', '조건부', '펍',
    '무인', '자판기', '아이스크림', '밀키트', '한시적', '피씨', '핫도그', '분식', '떡볶이', '치킨', '튀김', '어묵', '오뎅', '브뤼셀프라이', '피자', '7080라이브',
    '구내식당', '급식', '장례', '매점', '휴게소', '반점', '고로케', '초밥', '써브웨이', '홍콩반점', '삼겹', '갈비', '찜', '밥상', '롯데리아', '맥도날드', '버거킹', '맘스터치',
    // 2026-04-20 추가
    '곱창', '닭', '이자카야', '라멘', '라면', '우동', '스시', '카츠', '돈까스', '야끼',
    // 2026-04-27 추가
    '만두', '면옥', '김밥',
];

const FC_KEYWORDS = [
    '스타벅스', '메가커피', '메가엠지씨', '컴포즈', '빽다방', '이디야', '메가', '메가MGC', '우지커피',
    '투썸플레이스', '투썸', '할리스', '파스쿠찌', '폴바셋', '풀바셋', '엔제리너스', '카페베네', '탐앤탐스',
    '설빙', '공차', '아마스빈', '더벤티', '쥬씨', '감성커피', '백억커피', '김준호의', '만랩',
    '파리바게뜨', '뚜레쥬르', '던킨', '베스킨라빈스', '매머드커피', '브레댄코', '카페일리터', '하삼동', '텐퍼센트'
];


const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8000',
    'http://localhost:8080'
];

// ── 쿼리스트링 수동 조립 (키의 [ :: ] 를 보존) ───────────
function buildQS(params) {
    const parts = [];
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null || v === '') continue;
        parts.push(`${k}=${encodeURIComponent(v)}`);
    }
    return parts.join('&');
}

// ── data.go.kr 단일 페이지 조회 ──────────────────────────
async function fetchPage(typeCode, apiKey, startDate, endDate, regionHint, pageNo) {
    const qs = buildQS({
        serviceKey: apiKey,
        pageNo: String(pageNo),
        numOfRows: '100',                        // 신규 API 최대치
        returnType: 'json',
        'cond[LCPMT_YMD::GTE]': startDate,        // 인허가일자 ≥ startDate
        'cond[LCPMT_YMD::LTE]': endDate,          // 인허가일자 ≤ endDate
        'cond[SALS_STTS_CD::EQ]': '01',           // 영업 중
        ...(regionHint ? { 'cond[LOTNO_ADDR::LIKE]': regionHint } : {})
    });

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 7000);
    try {
        const res = await fetch(`${ENDPOINTS[typeCode]}?${qs}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return { items: [], totalCount: 0, failed: true, status: res.status };

        const json = await res.json();
        const body = json?.response?.body ?? json?.body ?? json ?? {};
        const raw  = body?.items?.item ?? body?.items ?? body?.data ?? [];
        const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const totalCount = parseInt(
            body?.totalCount ?? body?.total_count ?? body?.total ?? items.length,
            10
        );
        return { items, totalCount };
    } catch (e) {
        clearTimeout(timer);
        return { items: [], totalCount: 0, failed: true, error: e.message };
    }
}

// ── 공공API 주소는 광역시·특별시를 약칭으로 저장 (서울특별시→서울, 인천광역시→인천 등)
// managers 테이블의 정식명과 다르므로 LIKE 쿼리·필터 양쪽에서 약칭을 사용해야 함
// 정식명·약식명 모두 → API 약칭으로 정규화
// (managers 테이블에 '서울시', '서울특별시', '서울' 등 다양하게 입력될 수 있음)
const SIDO_SHORT = {
    // 서울
    '서울특별시': '서울', '서울시': '서울', '서울': '서울',
    // 부산
    '부산광역시': '부산', '부산시': '부산', '부산': '부산',
    // 대구
    '대구광역시': '대구', '대구시': '대구', '대구': '대구',
    // 인천
    '인천광역시': '인천', '인천시': '인천', '인천': '인천',
    // 광주
    '광주광역시': '광주', '광주시': '광주', '광주': '광주',
    // 대전
    '대전광역시': '대전', '대전시': '대전', '대전': '대전',
    // 울산
    '울산광역시': '울산', '울산시': '울산', '울산': '울산',
    // 세종
    '세종특별자치시': '세종', '세종시': '세종', '세종': '세종',
    // 제주
    '제주특별자치도': '제주', '제주도': '제주', '제주': '제주',
};
// 경기도·강원도 등 도 단위는 API에서도 정식명 그대로 사용 → 변환 불필요

// 약칭 → 주소 매칭에 사용할 모든 시도명 변형 (풀네임 + 약칭)
// 공공데이터 API 응답은 LOTNO_ADDR='서울특별시 강남구 ...' 형태로 풀네임이라
// 사용자가 '서울시 강남구'를 입력해도 '서울특별시 강남구'와 매칭돼야 함
const SIDO_FULLNAME_VARIANTS = {
    '서울': ['서울특별시', '서울시', '서울'],
    '부산': ['부산광역시', '부산시', '부산'],
    '대구': ['대구광역시', '대구시', '대구'],
    '인천': ['인천광역시', '인천시', '인천'],
    '광주': ['광주광역시', '광주시', '광주'],
    '대전': ['대전광역시', '대전시', '대전'],
    '울산': ['울산광역시', '울산시', '울산'],
    '세종': ['세종특별자치시', '세종시', '세종'],
    '제주': ['제주특별자치도', '제주도', '제주'],
};

// ── 광역시·특별시 '구' → 시도 약칭 역매핑 ─────────────────
// managers 테이블에 region1(시도)이 없이 region2(구)만 입력된 경우 대응
// 여러 도시에 겹치는 구명(서구·동구·남구·북구·중구)은 의도적으로 제외
const METRO_GU_SIDO = {
    // 서울 (25구 중 타 도시와 이름 안 겹치는 21구)
    '강남구':'서울','강동구':'서울','강북구':'서울','강서구':'서울',
    '관악구':'서울','광진구':'서울','구로구':'서울','금천구':'서울',
    '노원구':'서울','도봉구':'서울','동대문구':'서울','동작구':'서울',
    '마포구':'서울','서대문구':'서울','서초구':'서울','성동구':'서울',
    '성북구':'서울','송파구':'서울','양천구':'서울','영등포구':'서울',
    '용산구':'서울','은평구':'서울','종로구':'서울','중랑구':'서울',
    // 부산 고유 구
    '금정구':'부산','동래구':'부산','부산진구':'부산','사상구':'부산',
    '사하구':'부산','수영구':'부산','연제구':'부산','영도구':'부산','해운대구':'부산',
    // 인천 고유 구
    '계양구':'인천','남동구':'인천','미추홀구':'인천','부평구':'인천','연수구':'인천',
    // 대구 고유 구
    '달서구':'대구','달성군':'대구','수성구':'대구',
    // 울산 고유 구
    '울주군':'울산',
    // 광주 고유 구
    '광산구':'광주',
};

// region 문자열에서 API용 시도 약칭 추출
// '서울특별시 강남구' → '서울', '강남구' → '서울', '경기도 의정부시' → '경기도'
function getEffectiveSido(regionStr) {
    const first = regionStr.split(' ')[0];
    const mapped = SIDO_SHORT[first];
    if (mapped) return mapped;                          // 정식·약식 시도명
    return METRO_GU_SIDO[first] || first;              // 구이름이면 부모 시도, 나머지는 그대로
}

// ── 업종 × 시도 단위 전체 페이지 조회 ───────────────────
// regions = ['경기도 의정부시', '경기도 양주시', '서울특별시 강남구', ...]
// → 시도별로 묶어서 요청 수 최소화 (기존 지역별 69개 → 시도별 6~9개)
async function fetchAllForType(typeCode, apiKey, startDate, endDate, regions) {
    // 시도(첫 번째 단어) 기준으로 중복 제거 + API 약칭 변환
    // getEffectiveSido: region1 없이 '구'만 입력된 경우도 올바른 시도로 그룹핑
    const sidoSet = new Set(regions.map(r => getEffectiveSido(r)).filter(Boolean));
    const sidoList = [...sidoSet];

    // 1단계: 시도별 1페이지씩 병렬 조회
    const firstPages = await Promise.all(
        sidoList.map(sido => fetchPage(typeCode, apiKey, startDate, endDate, sido, 1))
    );

    const all = [];
    const followUps = [];
    const failedSido = [];
    const truncatedSido = [];

    firstPages.forEach((page, idx) => {
        if (page.failed) { failedSido.push(sidoList[idx]); return; }
        all.push(...page.items);
        const realPages = Math.ceil((page.totalCount || 0) / 100);
        const cappedPages = Math.min(realPages, 20);
        // 20페이지(2000건) 상한에 걸린 경우 → 누락 가능성 기록
        if (realPages > 20) truncatedSido.push({ sido: sidoList[idx], total: page.totalCount });
        for (let p = 2; p <= cappedPages; p++) {
            followUps.push(fetchPage(typeCode, apiKey, startDate, endDate, sidoList[idx], p));
        }
    });

    if (followUps.length) {
        const more = await Promise.all(followUps);
        more.forEach(({ items }) => all.push(...items));
    }

    return { items: all, failedRegions: failedSido, truncatedSido };
}

// ── 한 건을 upload.html 포맷으로 정규화 ──────────────────
function normalize(item, typeCode) {
    const name        = (item.BPLC_NM || '').toString().trim();
    const rawCategory = (item.BZSTAT_SE_NM || item.UPTAE_NM || TYPE_LABELS[typeCode] || '').toString().trim();
    const permitRaw   = (item.LCPMT_YMD || '').toString().replace(/\D/g, '');
    const permitDate  = permitRaw.length >= 8
        ? `${permitRaw.slice(0,4)}-${permitRaw.slice(4,6)}-${permitRaw.slice(6,8)}`
        : '';

    const roadAddr = (item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').toString().trim();
    const jibunAddr = (item.LOTNO_ADDR || '').toString().trim();

    // 주소 1/2/3 분리: 시도 / 시군구 / 구·읍면동
    const tokens = jibunAddr.split(' ').filter(Boolean);
    let addr1 = '', addr2 = '', addr3 = '';
    if (tokens.length >= 2) {
        addr1 = tokens[0];
        addr2 = tokens[1];
        addr3 = tokens[2] || '';
    } else {
        addr1 = '확인필요'; addr2 = '확인필요'; addr3 = '확인필요';
    }

    // 평형 계산 (소재지면적 우선 → 시설총규모 폴백)
    const areaM2 = parseFloat(
        (item.LCTN_AREA || item.FCLT_TOTAL_SCL || '0').toString().replace(/,/g, '')
    ) || 0;
    const pyeong = areaM2 > 0 ? +(areaM2 / 3.3).toFixed(1) : 0;

    // 업태 리네이밍
    let category = CATEGORY_RENAME[rawCategory] || rawCategory;

    // F/C 태깅
    if (FC_KEYWORDS.some(kw => name.includes(kw))) category = 'F/C';
    // 인천공항 태깅
    if (roadAddr.includes('인천공항') || name.includes('인천공항')) category = '인천공항';

    return {
        id:            item.MNG_NO || `${name}_${jibunAddr}`,
        business_name: name,
        business_type: category,
        _rawCategory:  rawCategory,   // 필터링용 (rename 전 원본)
        permit_date:   permitDate,
        road_address:  roadAddr,
        address1:      addr1,
        address2:      addr2,
        address3:      addr3,
        area:          pyeong > 0 ? pyeong.toString() : '',
        _pyeong:       pyeong,
        lat:           null,
        lng:           null
    };
}

// ── upload.html processRawData 필터 로직 ─────────────────
function applyBusinessLogic(items, regionList) {
    // regionList의 각 항목에 대해 광역시·특별시는 모든 풀네임/약칭 변형 생성
    // 예: '서울시 강남구' → ['서울특별시 강남구', '서울시 강남구', '서울 강남구']
    // (API 응답이 '서울특별시'로 풀네임이므로 사용자가 어떤 형태로 입력하든 매칭돼야 함)
    const regionVariants = regionList.map(r => {
        const parts = r.split(' ');
        const short = SIDO_SHORT[parts[0]];
        if (!short) return [r];                 // 도 단위(경기도 등): 변형 없음
        const rest = parts.slice(1).join(' ');
        const variants = SIDO_FULLNAME_VARIANTS[short] || [short];
        return variants.map(v => rest ? `${v} ${rest}` : v);
    });

    return items.filter(it => {
        // 1. 업태 타겟 카테고리만 (rename 전 원본 기준)
        if (!TARGET_CATEGORIES.includes(it._rawCategory)) return false;
        // 2. 블랙리스트 키워드 제외
        if (EXCLUDE_KEYWORDS.some(kw => it.business_name.includes(kw))) return false;
        // 3. 한식 100평 미만 제외
        if (it._rawCategory === '한식' && it._pyeong < 100) return false;
        // 4. 지역 필터 — 정식명·약칭 양쪽으로 매칭 (광역시 약칭 불일치 대응)
        const addrStr = (it.road_address || '') + ' ' + (it.address1 || '') + ' ' + (it.address2 || '');
        if (!regionVariants.some(variants => variants.some(v => addrStr.includes(v)))) return false;
        return true;
    });
}

// ── Vercel 핸들러 ─────────────────────────────────────────
export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || '*');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const API_KEY = process.env.PUBLIC_DATA_API_KEY;
    if (!API_KEY) {
        return res.status(500).json({ success: false, error: 'PUBLIC_DATA_API_KEY 환경변수가 설정되지 않았습니다.' });
    }

    const {
        types      = 'general_restaurants,bakeries,rest_cafes',
        regions    = '',
        startDate,
        endDate
    } = req.query;

    if (!startDate || !endDate) {
        return res.status(400).json({ success: false, error: 'startDate, endDate는 필수입니다. (YYYYMMDD)' });
    }

    if (!regions) {
        return res.status(400).json({ success: false, error: '지역(regions)을 하나 이상 선택해주세요.' });
    }

    const typeList   = types.split(',').map(t => t.trim()).filter(t => ENDPOINTS[t]);
    const regionList = regions.split(',').map(r => r.trim()).filter(Boolean);

    if (!typeList.length) {
        return res.status(400).json({ success: false, error: '유효한 업종 코드가 없습니다.' });
    }
    if (!regionList.length) {
        return res.status(400).json({ success: false, error: '유효한 지역이 없습니다.' });
    }

    // 날짜 범위 유효성 (YYYY-MM-DD로 들어올 경우 대비 정리)
    const cleanStart = startDate.replace(/-/g, '');
    const cleanEnd   = endDate.replace(/-/g, '');
    const startISO   = `${cleanStart.slice(0,4)}-${cleanStart.slice(4,6)}-${cleanStart.slice(6,8)}`;
    const endISO     = `${cleanEnd.slice(0,4)}-${cleanEnd.slice(4,6)}-${cleanEnd.slice(6,8)}`;

    try {
        const results = await Promise.all(
            typeList.map(t => fetchAllForType(t, API_KEY, cleanStart, cleanEnd, regionList))
        );

        // 취합 + ID 중복 제거 + 날짜 이중 필터 (서버 cond 무시될 경우 대비)
        const seen = new Set();
        let merged = [];
        const allFailedRegions = [];
        const allTruncated = [];

        results.forEach(({ items, failedRegions, truncatedSido }, i) => {
            if (failedRegions?.length) allFailedRegions.push(...failedRegions);
            if (truncatedSido?.length) allTruncated.push(...truncatedSido);
            items.forEach(raw => {
                const norm = normalize(raw, typeList[i]);
                if (!norm.id || seen.has(norm.id)) return;
                seen.add(norm.id);
                // 인허가일 범위 이중 확인
                if (norm.permit_date && (norm.permit_date < startISO || norm.permit_date > endISO)) return;
                merged.push(norm);
            });
        });

        // 사용자 로직 적용 (업태 필터 + 블랙리스트 + 한식 100평 미만 + 지역 매칭)
        merged = applyBusinessLogic(merged, regionList);

        // 정렬: 평형 내림차순, F/C·인천공항은 맨 뒤
        merged.sort((a, b) => {
            const aSp = a.business_type === 'F/C' || a.business_type === '인천공항';
            const bSp = b.business_type === 'F/C' || b.business_type === '인천공항';
            if (aSp !== bSp) return aSp ? 1 : -1;
            return (b._pyeong || 0) - (a._pyeong || 0);
        });

        // 내부 필드 제거
        const items = merged.map(({ _rawCategory, _pyeong, ...rest }) => rest);

        const uniqueFailed = [...new Set(allFailedRegions)];
        return res.json({
            success: true,
            totalCount: items.length,
            items,
            ...(uniqueFailed.length > 0 && { failedRegions: uniqueFailed }),
            ...(allTruncated.length > 0 && { truncated: allTruncated })
        });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
