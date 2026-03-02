/**
 * scripts/fetch-public-licenses.js
 * ─────────────────────────────────────────────────────────────
 * 공공데이터포털(data.go.kr) 음식점 인허가 데이터 수집
 * → Supabase licenses 테이블에 신규 업체만 INSERT
 *
 * 실행 방법:
 *   node scripts/fetch-public-licenses.js
 *
 * 필수 환경변수:
 *   SUPABASE_URL              — Supabase 프로젝트 URL
 *   SUPABASE_SERVICE_ROLE_KEY — Supabase 서비스 롤 키
 *   PUBLIC_DATA_API_KEY       — data.go.kr API 인증키
 *                               (https://www.data.go.kr 회원가입 → 활용신청 → 인증키 발급)
 *
 * 선택 환경변수:
 *   BUSINESS_UNIT   — licenses 테이블에 기록할 business_unit (기본: '경기북부')
 *   TARGET_REGIONS  — 쉼표 구분 지역명 (기본: 경기북부 주요 도시)
 *                     예) "경기도 의정부시,경기도 양주시"
 *   LOOKBACK_DAYS   — 최근 몇 일치 수정 데이터를 가져올지 (기본: 7)
 *   LICENSE_API_URL — API 주소 변경 시 덮어쓰기
 *                     (localdata.go.kr → 2025년 4월 이후 data.go.kr로 통합됨)
 * ─────────────────────────────────────────────────────────────
 */

// ── 설정 ──────────────────────────────────────────────────────
const SUPABASE_URL  = process.env.SUPABASE_URL;
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_ROLE_KEY;
const API_KEY       = process.env.PUBLIC_DATA_API_KEY;
const BUSINESS_UNIT = process.env.BUSINESS_UNIT   || '경기북부';
const LOOKBACK_DAYS = parseInt(process.env.LOOKBACK_DAYS || '7', 10);

// API 주소 — 주소 변경 시 환경변수로 코드 수정 없이 교체 가능
const API_BASE_URL = process.env.LICENSE_API_URL
    || 'https://api.data.go.kr/openapi/tn_pubr_public_rstr_info_api';

// 수집 대상 업태 (카페·음료·디저트 관련)
const BUSINESS_TYPES = ['휴게음식점', '일반음식점', '제과점영업'];

// 대상 지역 (경기북부 주요 도시)
const DEFAULT_REGIONS = [
    '경기도 의정부시', '경기도 양주시',   '경기도 동두천시',
    '경기도 포천시',   '경기도 연천군',   '경기도 파주시',
    '경기도 고양시',   '경기도 남양주시', '경기도 구리시',
    '경기도 가평군'
];
const TARGET_REGIONS = process.env.TARGET_REGIONS
    ? process.env.TARGET_REGIONS.split(',').map(r => r.trim())
    : DEFAULT_REGIONS;

// ── 유틸리티 ──────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * 오늘로부터 daysAgo일 전 날짜를 API 형식으로 반환
 * @param {number} daysAgo - 며칠 전
 * @param {boolean} isStart - true면 000000, false면 235959
 * @returns {string} 'YYYYMMDDHHmmss'
 */
function getDateStr(daysAgo, isStart) {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    const y  = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    return `${y}${mo}${da}${isStart ? '000000' : '235959'}`;
}

/**
 * 'YYYYMMDD' 형식 날짜 → 'YYYY-MM-DD' (잘못된 형식이면 null)
 */
function toIsoDate(str) {
    if (!str) return null;
    const s = String(str).replace(/\D/g, '');
    if (s.length < 8) return null;
    const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
    // 범위 검증
    if (parseInt(m) < 1 || parseInt(m) > 12) return null;
    if (parseInt(d) < 1 || parseInt(d) > 31) return null;
    return `${y}-${m}-${d}`;
}

/**
 * 주소가 대상 지역 목록에 포함되는지 확인
 */
function isTargetRegion(addr) {
    if (!addr) return false;
    return TARGET_REGIONS.some(r => addr.includes(r));
}

// ── data.go.kr API 호출 ───────────────────────────────────────

/**
 * 특정 업태·페이지의 인허가 데이터를 가져옴
 * @returns {{ items: object[], totalCount: number }}
 */
async function fetchPage(uptaeNm, pageNo, dateStart, dateEnd) {
    const url = new URL(API_BASE_URL);
    url.searchParams.set('ServiceKey',   API_KEY);
    url.searchParams.set('pageNo',       String(pageNo));
    url.searchParams.set('numOfRows',    '100');
    url.searchParams.set('type',         'json');
    url.searchParams.set('uptaeNm',      uptaeNm);
    url.searchParams.set('stateGbn',     '01');       // 01 = 영업 중
    url.searchParams.set('lastModTsBgn', dateStart);
    url.searchParams.set('lastModTsEnd', dateEnd);

    const res = await fetch(url.toString());
    if (!res.ok) {
        const body = await res.text();
        throw new Error(`HTTP ${res.status} — ${body.slice(0, 200)}`);
    }

    const json = await res.json();

    // 응답 구조: json.response.body 또는 json.body
    const responseBody = json?.response?.body ?? json?.body ?? {};

    // 결과 코드 검사
    const resultCode = json?.response?.header?.resultCode ?? json?.header?.resultCode;
    if (resultCode && resultCode !== '00' && resultCode !== '0000') {
        const msg = json?.response?.header?.resultMsg ?? '';
        throw new Error(`API 오류 코드 ${resultCode}: ${msg}`);
    }

    // items.item 이 단일 객체일 수 있어 배열로 통일
    const rawItems = responseBody?.items?.item ?? responseBody?.items ?? [];
    const items = Array.isArray(rawItems) ? rawItems
                : (rawItems && typeof rawItems === 'object') ? [rawItems]
                : [];

    const totalCount = parseInt(responseBody?.totalCount ?? '0', 10);
    return { items, totalCount };
}

/**
 * 특정 업태의 전체 데이터를 페이지네이션으로 수집
 */
async function fetchAllByType(uptaeNm, dateStart, dateEnd) {
    const all = [];
    let page = 1;

    while (true) {
        const { items, totalCount } = await fetchPage(uptaeNm, page, dateStart, dateEnd);
        all.push(...items);

        const fetched = page * 100;
        if (items.length === 0 || fetched >= totalCount) break;

        page++;
        await sleep(300); // API 서버 부하 방지
    }

    return all;
}

// ── Supabase 연동 ─────────────────────────────────────────────

const SB_HEADERS = {
    'apikey':        SERVICE_KEY,
    'Authorization': `Bearer ${SERVICE_KEY}`,
    'Content-Type':  'application/json'
};

/**
 * 현재 DB에서 해당 business_unit의 (업소명, 도로명주소) 세트를 가져옴
 * 중복 삽입 방지에 사용
 */
async function fetchExistingKeys() {
    // select=business_name,road_address 로 가볍게 조회
    const url = `${SUPABASE_URL}/rest/v1/licenses`
        + `?select=business_name,road_address`
        + `&business_unit=eq.${encodeURIComponent(BUSINESS_UNIT)}`;

    const res = await fetch(url, { headers: SB_HEADERS });
    if (!res.ok) throw new Error(`기존 데이터 조회 실패 (${res.status}): ${await res.text()}`);

    const rows = await res.json();
    return new Set(
        (rows || []).map(r =>
            `${(r.business_name || '').trim()}||${(r.road_address || '').trim()}`
        )
    );
}

/**
 * records 배열을 Supabase licenses 테이블에 INSERT
 */
async function insertBatch(records) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/licenses`, {
        method:  'POST',
        headers: { ...SB_HEADERS, 'Prefer': 'return=minimal' },
        body:    JSON.stringify(records)
    });
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`INSERT 실패 (${res.status}): ${err}`);
    }
}

// ── API 응답 → licenses 레코드 변환 ──────────────────────────

/**
 * data.go.kr API 응답 아이템을 licenses 테이블 행으로 변환
 * 컬럼: upload.html UPLOAD_TYPES.licenses.columnMap 기준
 */
function toLicenseRecord(item, bizType) {
    // 좌표: API에 따라 x/y 또는 lon/lat 사용
    const lat = item.y   ? parseFloat(item.y)
              : item.lat ? parseFloat(item.lat)
              : null;
    const lng = item.x   ? parseFloat(item.x)
              : item.lon ? parseFloat(item.lon)
              : null;

    return {
        business_name: (item.bplcNm     || '').trim(),
        business_type: (item.uptaeNm    || bizType).trim(),
        permit_date:   toIsoDate(item.apvPermYmd),
        trade_status:  '인허가',              // 신규 수집 기본 상태
        road_address:  (item.rdnWhlAddr || item.rdnWhlAddr || '').trim(),
        address:       (item.siteWhlAddr || '').trim(),
        lat:           isNaN(lat) ? null : lat,
        lng:           isNaN(lng) ? null : lng,
        priority:      '1',                   // 알림 대상 (send-license-alert.js 기준)
        manager:       '',                    // 담당자는 이후 수동 배정
        area:          '',
        milk_type:     '',
        business_unit: BUSINESS_UNIT
    };
}

// ── 메인 ──────────────────────────────────────────────────────

async function main() {
    // 환경변수 검증
    const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PUBLIC_DATA_API_KEY']
        .filter(k => !process.env[k]);
    if (missing.length > 0) {
        console.error(`[오류] 환경변수 누락: ${missing.join(', ')}`);
        process.exit(1);
    }

    const dateStart = getDateStr(LOOKBACK_DAYS, true);
    const dateEnd   = getDateStr(0, false);

    console.log('');
    console.log('📋 공공인허가 데이터 수집 시작');
    console.log(`  기간     : ${dateStart} ~ ${dateEnd} (최근 ${LOOKBACK_DAYS}일)`);
    console.log(`  업종     : ${BUSINESS_TYPES.join(', ')}`);
    console.log(`  지역     : ${TARGET_REGIONS.join(', ')}`);
    console.log(`  대상팀   : ${BUSINESS_UNIT}`);
    console.log(`  API URL  : ${API_BASE_URL}`);

    // ① 기존 데이터 키 세트 로드 (중복 방지)
    console.log('\n🔍 기존 DB 조회 중...');
    const existingKeys = await fetchExistingKeys();
    console.log(`  기존 ${existingKeys.size.toLocaleString()}건 확인`);

    let totalNew     = 0;
    let totalSkipped = 0;
    let totalError   = 0;

    // ② 업태별 수집
    for (const bizType of BUSINESS_TYPES) {
        console.log(`\n[${bizType}] API 호출 중...`);

        let rawItems;
        try {
            rawItems = await fetchAllByType(bizType, dateStart, dateEnd);
        } catch (e) {
            console.error(`  ⚠️  API 오류 (스킵): ${e.message}`);
            totalError++;
            continue;
        }
        console.log(`  수신: ${rawItems.length}건`);

        // ③ 지역 필터
        const inRegion = rawItems.filter(it =>
            isTargetRegion(it.rdnWhlAddr || it.siteWhlAddr || '')
        );
        console.log(`  지역 필터 후: ${inRegion.length}건`);

        // ④ 변환 + 중복 제거
        const toInsert = [];
        for (const it of inRegion) {
            const record = toLicenseRecord(it, bizType);

            // 업소명이 비어있거나 인허가일 없으면 스킵
            if (!record.business_name || !record.permit_date) {
                totalSkipped++;
                continue;
            }

            const key = `${record.business_name}||${record.road_address}`;
            if (existingKeys.has(key)) {
                totalSkipped++;
                continue;
            }

            toInsert.push(record);
            existingKeys.add(key); // 같은 실행 내 중복도 방지
        }

        if (toInsert.length === 0) {
            console.log('  → 신규 데이터 없음');
            continue;
        }

        // ⑤ 100건씩 배치 INSERT
        const BATCH_SIZE = 100;
        let inserted = 0;
        for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
            const batch = toInsert.slice(i, i + BATCH_SIZE);
            try {
                await insertBatch(batch);
                inserted += batch.length;
                await sleep(300);
            } catch (e) {
                console.error(`  ⚠️  배치 INSERT 오류 (${i}~${i + batch.length}): ${e.message}`);
                totalError++;
            }
        }
        console.log(`  ✅ ${inserted}건 업로드 완료`);
        totalNew += inserted;
    }

    // ── 결과 요약 ──
    console.log('');
    console.log('═══════════════════════════════════');
    console.log(`✅ 신규 업로드 : ${totalNew}건`);
    console.log(`⏭️  중복 스킵   : ${totalSkipped}건`);
    if (totalError > 0) {
        console.log(`⚠️  오류 발생   : ${totalError}건 (로그 확인 필요)`);
    }
    console.log('═══════════════════════════════════');

    if (totalNew > 0) {
        console.log('');
        console.log('💡 다음 단계:');
        console.log('   upload.html 인허가 탭 → 신규 데이터 확인 후 담당자 배정');
        console.log('   담당자 배정 후 send-license-alert.js 가 D+14 알림 자동 발송');
    }
}

main().catch(e => {
    console.error('\n[치명적 오류]', e.message);
    process.exit(1);
});
