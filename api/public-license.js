// 공공데이터포털 지방행정 인허가 데이터 API 프록시
// GET /api/public-license?types=general_restaurants,rest_cafes,bakeries&startDate=20260224&endDate=20260302&regions=의정부,양주

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

// 경기북부 기본 조회 지역
const DEFAULT_REGIONS = [
    '의정부', '양주', '동두천', '포천', '연천',
    '파주', '고양', '남양주', '구리', '가평', '김포', '부천', '인천'
];

const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8000',
    'http://localhost:8080'
];

// ── data.go.kr 단일 페이지 조회 ──────────────────────────
async function fetchPage(typeCode, apiKey, startDate, endDate, regionHint, pageNo) {
    const params = new URLSearchParams({
        serviceKey: apiKey,
        pageNo:     String(pageNo),
        numOfRows:  '1000',
        returnType: 'json',
        SALS_STTS_CD: '01'   // 영업 중만
    });
    if (startDate)   params.set('startDate', startDate);
    if (endDate)     params.set('endDate',   endDate);
    if (regionHint)  params.set('LOTNO_ADDR', regionHint);

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
        const res = await fetch(`${ENDPOINTS[typeCode]}?${params}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return { items: [], totalCount: 0 };

        const json = await res.json();
        const body = json?.response?.body ?? json?.body ?? {};
        const raw  = body?.items?.item ?? body?.items ?? [];
        const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        return { items, totalCount: parseInt(body?.totalCount ?? '0', 10) };
    } catch {
        clearTimeout(timer);
        return { items: [], totalCount: 0 };
    }
}

// ── 업종 × 지역 병렬 전체 조회 ───────────────────────────
async function fetchAllForType(typeCode, apiKey, startDate, endDate, regions) {
    // 지역별 1페이지 병렬 조회
    const firstPages = await Promise.all(
        regions.map(r => fetchPage(typeCode, apiKey, startDate, endDate, r, 1))
    );

    const all = [];
    const followUps = [];

    firstPages.forEach(({ items, totalCount }, idx) => {
        all.push(...items);
        const totalPages = Math.ceil(totalCount / 1000);
        for (let p = 2; p <= totalPages; p++) {
            followUps.push(fetchPage(typeCode, apiKey, startDate, endDate, regions[idx], p));
        }
    });

    if (followUps.length) {
        const more = await Promise.all(followUps);
        more.forEach(({ items }) => all.push(...items));
    }

    return all;
}

// ── API 응답 → 정제 객체 변환 ─────────────────────────────
function normalize(item, typeCode) {
    const roadAddr = (item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').trim();
    const lotAddr  = (item.LOTNO_ADDR   || '').trim();

    // 주소1/2/3 분리 (시도 / 시군구 / 읍면동)
    const parts   = lotAddr.split(' ').filter(Boolean);
    const address1 = parts[0] || '';
    const address2 = parts[1] || '';
    const address3 = parts.slice(2).join(' ') || '';

    return {
        id:           item.MNG_NO || `${item.BPLC_NM}_${lotAddr}`,
        business_name: (item.BPLC_NM || '').trim(),
        business_type: (item.UPTAE_NM || item.BZSTAT_SE_NM || TYPE_LABELS[typeCode] || '').trim(),
        permit_date:   item.LCPMT_YMD || '',    // YYYY-MM-DD
        road_address:  roadAddr,
        address1,
        address2,
        address3,
        area:          item.FCLT_TOTAL_SCL ? String(item.FCLT_TOTAL_SCL) : '',
        lat:           null,
        lng:           null,
    };
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
    if (!API_KEY) return res.status(500).json({ success: false, error: 'PUBLIC_DATA_API_KEY 환경변수가 설정되지 않았습니다.' });

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
        return res.status(400).json({ success: false, error: '유효한 업종 코드가 없습니다. (general_restaurants / bakeries / rest_cafes)' });
    }

    try {
        // 업종별 병렬 조회
        const results = await Promise.all(
            typeList.map(t => fetchAllForType(t, API_KEY, startDate, endDate, regionList))
        );

        // 취합 + 중복 제거 + 지역 필터
        const seen  = new Set();
        const items = [];

        results.forEach((raw, i) => {
            raw.forEach(item => {
                const norm = normalize(item, typeList[i]);
                if (seen.has(norm.id)) return;
                seen.add(norm.id);

                // JS 정밀 지역 필터 (서버 힌트가 완벽하지 않으므로)
                const addrStr = norm.road_address + norm.address1 + norm.address2;
                if (!regionList.some(r => addrStr.includes(r))) return;

                items.push(norm);
            });
        });

        // 인허가일 내림차순 정렬
        items.sort((a, b) => (b.permit_date || '').localeCompare(a.permit_date || ''));

        return res.json({ success: true, totalCount: items.length, items });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
