// api/admin-upload.js
// 사업부(관리자) 전용: 지점 선택 후 인허가 데이터 중앙 업로드 (RLS 우회, SERVICE_ROLE_KEY 사용)
// x-admin-key 헤더로 인증. 거래처·담당자는 지점에서 직접 관리하므로 licenses만 허용.

const ALLOWED_ORIGINS = [
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080'
];

// 서버 측 business_unit 화이트리스트 (클라이언트 값 신뢰 안 함)
const VALID_BUSINESS_UNITS = [
    '수도권지역사업부',
    '경기북부FS/특수지점',
    '서울FS/특수지점',
    '경기남부FS/특수지점'
];

// licenses 허용 컬럼 (임의 컬럼 주입 차단)
const LICENSE_COLUMNS = [
    'permit_date', 'business_name', 'trade_status', 'business_type', 'area',
    'road_address', 'address1', 'address2', 'address3', 'priority', 'manager',
    'appsheet_date', 'lat', 'lng', 'milk_type', 'ai_tags'
];

const ALLOWED_MODES = ['add_new_only', 'replace'];

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // 관리자 인증
    const adminKey = req.headers['x-admin-key'];
    const expectedKey = process.env.ADMIN_CODE;
    if (!expectedKey || adminKey !== expectedKey) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const { table, business_unit, mode = 'add_new_only', rows } = req.body || {};

    // 검증: 테이블은 licenses만 (거래처·담당자는 지점 관리)
    if (table !== 'licenses') {
        return res.status(400).json({ error: '인허가(licenses)만 중앙 업로드를 지원합니다. 거래처·담당자는 지점에서 관리합니다.' });
    }
    if (!VALID_BUSINESS_UNITS.includes(business_unit)) {
        return res.status(400).json({ error: '유효하지 않은 지점입니다.' });
    }
    if (!ALLOWED_MODES.includes(mode)) {
        return res.status(400).json({ error: '유효하지 않은 업로드 모드입니다.' });
    }
    if (!Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ error: '업로드할 데이터가 없습니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({ error: 'Server config error' });
    }
    const sbHeaders = {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };

    // 거래여부 유효성 (인허가 전용)
    const VALID_STATUSES = new Set(['거래', '미거래', '인허가', '공사중', 'DROP']);
    const now = new Date().toISOString();

    // 행 정제: 허용 컬럼만 추출 + business_unit 강제 주입 (클라 값 무시)
    const sanitize = (row) => {
        const clean = { business_unit, uploaded_at: now };
        for (const col of LICENSE_COLUMNS) {
            if (row[col] !== undefined) clean[col] = row[col];
        }
        return clean;
    };

    try {
        // 거래여부 값 검증
        const badStatus = rows.find(r => r.trade_status && !VALID_STATUSES.has(r.trade_status));
        if (badStatus) {
            return res.status(400).json({ error: `유효하지 않은 거래여부 값: "${badStatus.trade_status}" (허용: 거래/미거래/인허가/공사중/DROP)` });
        }

        let payload = rows.map(sanitize);
        let skipped = 0;

        if (mode === 'add_new_only') {
            // 기존 business_name 조회 → 중복 제외 (해당 지점 범위)
            const existRes = await fetch(
                `${SUPABASE_URL}/rest/v1/licenses?select=business_name&business_unit=eq.${encodeURIComponent(business_unit)}&limit=50000`,
                { headers: sbHeaders }
            );
            if (!existRes.ok) throw new Error('기존 데이터 확인 실패: ' + (await existRes.text()));
            const existing = new Set((await existRes.json()).map(r => r.business_name).filter(Boolean));

            const before = payload.length;
            // DB 중복 제외 + 파일 내부 중복 제외
            const internal = new Set();
            payload = payload.filter(r => {
                const name = r.business_name;
                if (!name || existing.has(name) || internal.has(name)) return false;
                internal.add(name);
                return true;
            });
            skipped = before - payload.length;

            if (payload.length === 0) {
                return res.status(200).json({ inserted: 0, skipped, message: '모두 이미 존재하는 데이터입니다.' });
            }
        } else if (mode === 'replace') {
            // 해당 지점 전체 삭제 후 교체
            const delRes = await fetch(
                `${SUPABASE_URL}/rest/v1/licenses?business_unit=eq.${encodeURIComponent(business_unit)}`,
                { method: 'DELETE', headers: { ...sbHeaders, 'Prefer': 'return=minimal' } }
            );
            if (!delRes.ok) throw new Error('기존 데이터 삭제 실패: ' + (await delRes.text()));
        }

        // 배치 삽입
        const BATCH = 500;
        let inserted = 0;
        for (let i = 0; i < payload.length; i += BATCH) {
            const batch = payload.slice(i, i + BATCH);
            const insRes = await fetch(`${SUPABASE_URL}/rest/v1/licenses`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                body: JSON.stringify(batch)
            });
            if (!insRes.ok) throw new Error(`업로드 실패 (${i + 1}~${i + batch.length}번째): ` + (await insRes.text()));
            inserted += batch.length;
        }

        return res.status(200).json({ inserted, skipped, business_unit, mode });
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
