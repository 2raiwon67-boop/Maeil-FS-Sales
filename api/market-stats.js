// api/market-stats.js — 상권 인텔리전스 API (discover.html 전용)
// GET /api/market-stats?sido=경기도&months=12
//
// 공공인허가 API에서 카페/베이커리 신규 오픈·폐업 건수를 집계하여 반환
// ─ 신규: LCPMT_YMD(인허가일) 기준
// ─ 폐업: CLSBIZ_YMD(폐업일) 기준 (column_mapping_260323 확인)
// upload.html의 FS 타겟 필터 미적용 — 시장 전체 규모 파악 목적

const ENDPOINTS = {
    rest_cafes: 'https://apis.data.go.kr/1741000/rest_cafes/info',
    bakeries:   'https://apis.data.go.kr/1741000/bakeries/info',
};

const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8000',
    'http://localhost:8080',
];

// 시도명 정규화 (managers 테이블 다양한 표기 → API 약칭)
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
function extract(item, mode) {
    const addr   = (item.LOTNO_ADDR || '').toString().trim();
    const tokens = addr.split(' ').filter(Boolean);
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
    if (!API_KEY) return res.status(500).json({ success: false, error: 'API key missing' });

    const { sido, months = '12' } = req.query;
    if (!sido) return res.status(400).json({ success: false, error: 'sido 파라미터 필요' });

    const sidoShort  = toShort(sido);
    const monthCount = Math.min(Math.max(parseInt(months) || 12, 1), 24);

    // 날짜 범위 (최근 N개월)
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
        const monthly = {};
        const regions = {};

        function tally(results, mode) {
            results.forEach(({ items }) => {
                items.forEach(item => {
                    const { sigungu, month } = extract(item, mode);
                    if (!month || !sigungu) return;

                    if (!monthly[month]) monthly[month] = { new: 0, closed: 0 };
                    monthly[month][mode === 'new' ? 'new' : 'closed']++;

                    if (!regions[sigungu]) regions[sigungu] = { new: 0, closed: 0 };
                    regions[sigungu][mode === 'new' ? 'new' : 'closed']++;
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

        return res.json({
            success:  true,
            sido:     sidoShort,
            period:   { start: startStr.slice(0, 6), end: endStr.slice(0, 6), months: monthCount },
            summary:  { totalNew, totalClosed, net: totalNew - totalClosed },
            monthly:  monthlyArr,
            regions:  regionsArr,
        });

    } catch (e) {
        return res.status(500).json({ success: false, error: e.message });
    }
}
