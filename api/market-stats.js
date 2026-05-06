// api/market-stats.js — 상권 인텔리전스 API (discover.html 전용)
// GET /api/market-stats?sido=경기도&months=12[&save=true]
//
// 공공인허가 API에서 카페/베이커리/일반음식점 신규·폐업 건수를 집계하여 반환
// ─ 신규: LCPMT_YMD(인허가일) + SALS_STTS_CD=01(영업중)
// ─ 폐업: CLSBIZ_YMD(폐업일)
// ─ 블랙리스트·업태 필터: public-license.js의 applyBusinessLogic과 동일 기준
// ─ save=true: 집계 결과를 market_snapshots 테이블에 upsert

const ENDPOINTS = {
    general_restaurants: 'https://apis.data.go.kr/1741000/general_restaurants/info',
    rest_cafes:          'https://apis.data.go.kr/1741000/rest_cafes/info',
    bakeries:            'https://apis.data.go.kr/1741000/bakeries/info',
};

const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8000',
    'http://localhost:8080',
];

// ── 블랙리스트 (public-license.js와 동일) ───────────────────
const EXCLUDE_KEYWORDS = [
    '편의점', 'GS25', 'CU', '세븐일레븐', '이마트24', '찐빵', '육회', '고기', '홍어', '회', '씨유', '포차', '한끼',
    'PC', '피시', '게임', '당구', '만화', '노래', '제육', '곰탕', '숯불', '베트남', '동남아', '쌀국수', '조건부', '펍',
    '무인', '자판기', '아이스크림', '밀키트', '한시적', '피씨', '핫도그', '분식', '떡볶이', '치킨', '튀김', '어묵', '오뎅', '브뤼셀프라이', '피자', '7080라이브',
    '구내식당', '급식', '장례', '매점', '휴게소', '반점', '고로케', '초밥', '써브웨이', '홍콩반점', '삼겹', '갈비', '찜', '밥상', '롯데리아', '맥도날드', '버거킹', '맘스터치',
    '곱창', '닭', '이자카야', '라멘', '라면', '우동', '스시', '카츠', '돈까스', '야끼',
];

// FS 타겟 업태 카테고리 (general_restaurants 필터링용)
const TARGET_CATEGORIES = [
    '한식', '기타 휴게음식점', '기타', '커피숍', '제과점영업', '레스토랑', '키즈카페', '경양식'
];

// ── 시도명 정규화 ──────────────────────────────────────────
const SIDO_SHORT = {
    '서울특별시': '서울', '서울시': '서울', '서울': '서울',
    '부산광역시': '부산', '부산시': '부산', '부산': '부산',
    '대구광역시': '대구', '대구시': '대구', '대구': '대구',
    '인천광역시': '인천', '인천시': '인천', '인천': '인천',
    '광주광역시': '광주', '광주시': '광주', '광주': '광주',
    '대전광역시': '대전', '대전시': '대전', '대전': '대전',
    '울산광역시': '울산', '울산시': '울산', '울산': '울산',
    '세종특별자치시': '세종', '세종시': '세종', '세종': '세종',
    '제주특별자치도': '제주', '제주도': '제주', '제주': '제주',
    '경기도': '경기도', '경기': '경기도',
    '강원도': '강원도', '강원특별자치도': '강원도',
    '충청북도': '충청북도', '충북': '충청북도',
    '충청남도': '충청남도', '충남': '충청남도',
    '전라북도': '전라북도', '전북': '전라북도', '전북특별자치도': '전라북도',
    '전라남도': '전라남도', '전남': '전라남도',
    '경상북도': '경상북도', '경북': '경상북도',
    '경상남도': '경상남도', '경남': '경상남도',
};

function toShort(sido) { return SIDO_SHORT[sido?.trim()] || sido?.trim() || ''; }

function buildQS(params) {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
}

// ── FS 타겟 여부 판별 ────────────────────────────────────
// ※ 엔드포인트(rest_cafes / bakeries / general_restaurants)가 이미 업종 필터 역할을 하므로
//    카테고리 체크는 생략하고 블랙리스트 키워드 제외만 적용
function isTarget(item) {
    const bizName = (item.BPLCNM || item.BIZPLC_NM || item.BIZ_PLCE_NM || '').toString().trim();
    if (EXCLUDE_KEYWORDS.some(kw => bizName.includes(kw))) return false;
    return true;
}

// ── 단일 페이지 조회 ──────────────────────────────────────
async function fetchPage(type, apiKey, sido, pageNo, mode, start, end) {
    const isNew = mode === 'new';
    const qs = buildQS({
        serviceKey:  apiKey,
        pageNo:      String(pageNo),
        numOfRows:   '100',
        returnType:  'json',
        ...(isNew
            ? { 'cond[LCPMT_YMD::GTE]': start, 'cond[LCPMT_YMD::LTE]': end, 'cond[SALS_STTS_CD::EQ]': '01' }
            : { 'cond[CLSBIZ_YMD::GTE]': start, 'cond[CLSBIZ_YMD::LTE]': end }
        ),
        'cond[LOTNO_ADDR::LIKE]': sido,
    });

    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 9000);
    try {
        const res = await fetch(`${ENDPOINTS[type]}?${qs}`, { signal: ctrl.signal });
        clearTimeout(timer);
        if (!res.ok) return { items: [], totalCount: 0 };

        const json = await res.json();
        const body = json?.response?.body ?? json?.body ?? json ?? {};
        const raw  = body?.items?.item ?? body?.items ?? body?.data ?? [];
        const items = Array.isArray(raw) ? raw : (raw ? [raw] : []);
        const totalCount = parseInt(body?.totalCount ?? items.length, 10) || 0;
        return { items, totalCount };
    } catch {
        clearTimeout(timer);
        return { items: [], totalCount: 0 };
    }
}

// ── 전체 페이지 조회 (최대 2000건) ───────────────────────
async function fetchAll(type, apiKey, sido, mode, start, end) {
    const first = await fetchPage(type, apiKey, sido, 1, mode, start, end);
    const items = [...first.items];
    const pages = Math.min(Math.ceil((first.totalCount || 0) / 100), 20);

    if (pages > 1) {
        const rest = await Promise.all(
            Array.from({ length: pages - 1 }, (_, i) =>
                fetchPage(type, apiKey, sido, i + 2, mode, start, end)
            )
        );
        rest.forEach(r => items.push(...r.items));
    }

    return { items, totalCount: first.totalCount };
}

// ── 아이템에서 시군구 + 월 추출 ──────────────────────────
// expectedSido: 쿼리에 사용한 sido (예: '경기도', '인천')
// 주소 첫 토큰이 expectedSido와 다르면 오염 데이터로 간주해 빈 값 반환
// (예: '강원도 횡성군 인천리...' → LIKE '인천' 에 걸렸지만 경기도 주소 아님)
function extract(item, mode, expectedSido) {
    const addr    = (item.LOTNO_ADDR || '').toString().trim();
    const tokens  = addr.split(' ').filter(Boolean);

    // 시도 검증: 주소 첫 토큰을 정규화 후 expectedSido와 비교
    if (expectedSido) {
        const addrSido = toShort(tokens[0] || '');
        if (addrSido && addrSido !== expectedSido) return { sigungu: '', month: '' };
    }

    const sigungu = tokens[1] || '';

    const raw = (mode === 'new'
        ? item.LCPMT_YMD
        : item.CLSBIZ_YMD || item.DCB_YMD
    )?.toString().replace(/\D/g, '') || '';

    const month = raw.length >= 6
        ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}`
        : '';

    return { sigungu, month };
}

// ── Supabase upsert ─────────────────────────────────────
async function saveToSupabase(sidoShort, detail, storeRecords = []) {
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) return { saved: 0, error: 'env 누락' };

    const commonHeaders = {
        'apikey':        SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'resolution=merge-duplicates,return=minimal',
    };

    // 1) market_snapshots 집계 upsert
    const snapRows = [];
    for (const [sigungu, months] of Object.entries(detail)) {
        for (const [month, counts] of Object.entries(months)) {
            snapRows.push({
                sido:         sidoShort,
                sigungu,
                month,
                new_count:    counts.new    || 0,
                closed_count: counts.closed || 0,
                updated_at:   new Date().toISOString(),
            });
        }
    }

    let saved = 0;
    let lastError = null;

    for (let i = 0; i < snapRows.length; i += 100) {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/market_snapshots?on_conflict=sido,sigungu,month`, {
            method: 'POST', headers: commonHeaders,
            body: JSON.stringify(snapRows.slice(i, i + 100)),
        });
        if (res.ok) saved += Math.min(100, snapRows.length - i);
        else {
            const t = await res.text().catch(() => String(res.status));
            lastError = `snapshots HTTP ${res.status}: ${t.slice(0, 200)}`;
        }
    }

    // 2) market_store_records 개별 매장 upsert
    let storesSaved = 0;
    for (let i = 0; i < storeRecords.length; i += 100) {
        const res = await fetch(
            `${SUPABASE_URL}/rest/v1/market_store_records?on_conflict=sido,sigungu,month,name,status`,
            { method: 'POST', headers: commonHeaders, body: JSON.stringify(storeRecords.slice(i, i + 100)) }
        );
        if (res.ok) storesSaved += Math.min(100, storeRecords.length - i);
        else {
            const t = await res.text().catch(() => String(res.status));
            lastError = `stores HTTP ${res.status}: ${t.slice(0, 200)}`;
        }
    }

    return { saved, storesSaved, ...(lastError ? { error: lastError } : {}) };
}

// ── Vercel 핸들러 ─────────────────────────────────────────
export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.status(200).end();

    const API_KEY      = process.env.PUBLIC_DATA_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const ANON_KEY     = process.env.SUPABASE_ANON_KEY;

    // ── detail 모드: Supabase에서 개별 매장 목록 반환 ──────────────────
    const { sido, months = '12', save = '', detail = '', sigungu = '', month = '' } = req.query;

    if (detail === 'true') {
        if (!sido || !sigungu) {
            return res.status(400).json({ success: false, error: 'sido, sigungu 파라미터 필요' });
        }
        if (!SUPABASE_URL || !ANON_KEY) {
            return res.status(500).json({ success: false, error: 'Supabase env 누락' });
        }
        try {
            let url = `${SUPABASE_URL}/rest/v1/market_store_records`
                + `?sido=eq.${encodeURIComponent(toShort(sido))}`
                + `&sigungu=eq.${encodeURIComponent(sigungu)}`
                + `&select=name,category,area_m2,pyeong,address,status,license_date`
                + `&order=license_date.desc`;
            if (month) url += `&month=eq.${encodeURIComponent(month)}`;

            const r = await fetch(url, {
                headers: { 'apikey': ANON_KEY, 'Authorization': `Bearer ${ANON_KEY}` },
            });
            if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
            const stores = await r.json();
            const summary = stores.reduce((a, s) => {
                if (s.status === 'new') a.new++; else a.closed++;
                return a;
            }, { new:0, closed:0 });
            return res.json({ success:true, sido:toShort(sido), sigungu, month:month||null, summary, stores });
        } catch(e) {
            return res.status(500).json({ success:false, error: e.message });
        }
    }

    if (!API_KEY) return res.status(500).json({ success: false, error: 'API key missing' });
    if (!sido) return res.status(400).json({ success: false, error: 'sido 파라미터 필요' });

    const sidoShort  = toShort(sido);
    const monthCount = Math.min(Math.max(parseInt(months) || 12, 1), 24);
    const doSave     = save === 'true';

    // 날짜 범위
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - monthCount, 1);
    const fmt   = d => `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
    const startStr = fmt(start);
    const endStr   = fmt(now);

    try {
        const types = Object.keys(ENDPOINTS);

        // 신규 + 폐업 병렬 조회
        const [newRes, closedRes] = await Promise.all([
            Promise.all(types.map(t => fetchAll(t, API_KEY, sidoShort, 'new',    startStr, endStr))),
            Promise.all(types.map(t => fetchAll(t, API_KEY, sidoShort, 'closed', startStr, endStr))),
        ]);

        // 집계
        const monthly      = {};
        const regions      = {};
        const detail       = {};  // detail[sigungu][month] = {new, closed} — 집계 저장용
        const storeRecords = [];  // 개별 매장 레코드 — 드릴다운용

        function tally(results, mode) {
            results.forEach(({ items }) => {
                items.forEach(item => {
                    if (!isTarget(item)) return;
                    const { sigungu, month } = extract(item, mode, sidoShort);
                    if (!month || !sigungu) return;

                    const key = mode === 'new' ? 'new' : 'closed';

                    if (!monthly[month]) monthly[month] = { new: 0, closed: 0 };
                    monthly[month][key]++;

                    if (!regions[sigungu]) regions[sigungu] = { new: 0, closed: 0 };
                    regions[sigungu][key]++;

                    if (!detail[sigungu]) detail[sigungu] = {};
                    if (!detail[sigungu][month]) detail[sigungu][month] = { new: 0, closed: 0 };
                    detail[sigungu][month][key]++;

                    // 개별 매장 수집 (드릴다운용)
                    const name = (item.BPLCNM || item.BIZPLC_NM || item.BIZ_PLCE_NM || '').trim();
                    if (!name) return;
                    const areaM2 = parseFloat(
                        (item.LCTN_AREA || item.FCLT_TOTAL_SCL || '0').toString().replace(/,/g, '')
                    ) || 0;
                    const dateRaw = (mode === 'new'
                        ? item.LCPMT_YMD
                        : item.CLSBIZ_YMD || item.DCB_YMD
                    )?.toString().replace(/\D/g, '') || '';
                    storeRecords.push({
                        sido:         sidoShort,
                        sigungu,
                        month,
                        name,
                        category:     (item.UPTAE_NM || item.BZSTAT_SE_NM || '').trim(),
                        area_m2:      areaM2 > 0 ? areaM2 : null,
                        pyeong:       areaM2 > 0 ? Math.round(areaM2 / 3.3 * 10) / 10 : null,
                        address:      (item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').trim(),
                        status:       key,
                        license_date: dateRaw.length >= 8
                            ? `${dateRaw.slice(0,4)}-${dateRaw.slice(4,6)}-${dateRaw.slice(6,8)}`
                            : null,
                        updated_at:   new Date().toISOString(),
                    });
                });
            });
        }

        tally(newRes,    'new');
        tally(closedRes, 'closed');

        // 월 목록 생성 (오래된 순)
        const monthList = Array.from({ length: monthCount }, (_, i) => {
            const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - i), 1);
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
        });

        const monthlyArr = monthList.map(m => ({
            month:  m,
            new:    monthly[m]?.new    || 0,
            closed: monthly[m]?.closed || 0,
            net:    (monthly[m]?.new || 0) - (monthly[m]?.closed || 0),
        }));

        const regionsArr = Object.entries(regions)
            .map(([region, { new: n, closed: c }]) => ({
                region,
                new:     n,
                closed:  c,
                net:     n - c,
                netRate: n > 0 ? Math.round(((n - c) / n) * 100) : 0,
            }))
            .filter(r => r.region && r.new + r.closed > 0)
            .sort((a, b) => b.new - a.new);

        const totalNew    = monthlyArr.reduce((s, m) => s + m.new,    0);
        const totalClosed = monthlyArr.reduce((s, m) => s + m.closed, 0);

        // Supabase 저장 (옵션)
        let saveResult = null;
        if (doSave) {
            saveResult = await saveToSupabase(sidoShort, detail, storeRecords);
        }

        return res.json({
            success:  true,
            sido:     sidoShort,
            period:   { start: startStr.slice(0, 6), end: endStr.slice(0, 6), months: monthCount },
            summary:  { totalNew, totalClosed, net: totalNew - totalClosed },
            monthly:  monthlyArr,
            regions:  regionsArr,
            ...(doSave ? { saved: saveResult } : {}),
        });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
