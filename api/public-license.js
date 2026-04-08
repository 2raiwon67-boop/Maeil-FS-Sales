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
    '구내식당', '급식', '장례', '매점', '휴게소', '반점', '고로케', '초밥', '써브웨이', '홍콩반점', '삼겹', '갈비', '찜', '밥상', '롯데리아', '맥도날드', '버거킹', '맘스터치'
];

const FC_KEYWORDS = [
    '스타벅스', '메가커피', '메가엠지씨', '컴포즈', '빽다방', '이디야', '메가', '메가MGC', '우지커피',
    '투썸플레이스', '투썸', '할리스', '파스쿠찌', '폴바셋', '풀바셋', '엔제리너스', '카페베네', '탐앤탐스',
    '설빙', '공차', '아마스빈', '더벤티', '쥬씨', '감성커피', '백억커피', '김준호의', '만랩',
    '파리바게뜨', '뚜레쥬르', '던킨', '베스킨라빈스', '매머드커피', '브레댄코', '카페일리터', '하삼동', '텐퍼센트'
];

// regions 파라미터가 비어있을 때 fallback (시도 단위)
const DEFAULT_REGIONS = ['경기도 의정부시', '경기도 양주시', '경기도 동두천시', '경기도 포천시', '경기도 연천군',
    '경기도 파주시', '경기도 고양시', '경기도 남양주시', '경기도 구리시', '경기도 가평군', '경기도 김포시',
    '인천광역시 부평구', '인천광역시 계양구', '인천광역시 중구'];

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

// ── 업종 × 시도 단위 전체 페이지 조회 ───────────────────
// regions = ['경기도 의정부시', '경기도 양주시', '인천광역시 중구', ...]
// → 시도별로 묶어서 요청 수 최소화 (기존 지역별 69개 → 시도별 6~9개)
async function fetchAllForType(typeCode, apiKey, startDate, endDate, regions) {
    // 시도(첫 번째 단어) 기준으로 중복 제거
    const sidoSet = new Set(regions.map(r => r.split(' ')[0]).filter(Boolean));
    const sidoList = [...sidoSet];

    // 1단계: 시도별 1페이지씩 병렬 조회
    const firstPages = await Promise.all(
        sidoList.map(sido => fetchPage(typeCode, apiKey, startDate, endDate, sido, 1))
    );

    const all = [];
    const followUps = [];
    const failedSido = [];

    firstPages.forEach((page, idx) => {
        if (page.failed) { failedSido.push(sidoList[idx]); return; }
        all.push(...page.items);
        // 남은 페이지 큐잉 (최대 20페이지/시도 = 2000건 안전망)
        const totalPages = Math.min(Math.ceil((page.totalCount || 0) / 100), 20);
        for (let p = 2; p <= totalPages; p++) {
            followUps.push(fetchPage(typeCode, apiKey, startDate, endDate, sidoList[idx], p));
        }
    });

    if (followUps.length) {
        const more = await Promise.all(followUps);
        more.forEach(({ items }) => all.push(...items));
    }

    return { items: all, failedRegions: failedSido };
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

    // 주소 1/2/3 분리 (upload.html processRawData와 동일 로직)
    const tokens = jibunAddr.split(' ').filter(Boolean);
    let addr1 = '', addr2 = '', addr3 = '';
    if (tokens.length >= 2) {
        addr1 = tokens[0];
        addr2 = tokens[1];
        if (addr2.startsWith('고양시') && tokens.length > 2) {
            addr2 = `${tokens[1]} ${tokens[2]}`;
            addr3 = tokens[3] || '';
        } else {
            addr3 = tokens[2] || '';
        }
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
    return items.filter(it => {
        // 1. 업태 타겟 카테고리만 (rename 전 원본 기준)
        if (!TARGET_CATEGORIES.includes(it._rawCategory)) return false;
        // 2. 블랙리스트 키워드 제외
        if (EXCLUDE_KEYWORDS.some(kw => it.business_name.includes(kw))) return false;
        // 3. 한식 100평 미만 제외
        if (it._rawCategory === '한식' && it._pyeong < 100) return false;
        // 4. 지역 필터 (서버 LIKE 힌트 보조 — 정확 매칭)
        const addrStr = (it.road_address || '') + (it.address1 || '') + (it.address2 || '');
        if (!regionList.some(r => addrStr.includes(r))) return false;
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

    const typeList   = types.split(',').map(t => t.trim()).filter(t => ENDPOINTS[t]);
    const regionList = regions ? regions.split(',').map(r => r.trim()).filter(Boolean) : DEFAULT_REGIONS;

    if (!typeList.length) {
        return res.status(400).json({ success: false, error: '유효한 업종 코드가 없습니다.' });
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

        results.forEach(({ items, failedRegions }, i) => {
            if (failedRegions?.length) allFailedRegions.push(...failedRegions);
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
            ...(uniqueFailed.length > 0 && { failedRegions: uniqueFailed })
        });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
