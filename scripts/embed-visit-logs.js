/**
 * Mother Brain: visit_logs 방문 내용 임베딩 → Supabase 저장
 *
 * 사전 조건:
 *   1. Supabase SQL Editor에서 db/supabase_setup.sql 하단 Mother Brain 섹션 실행
 *      (embedding 컬럼 추가 + search_success_visits 함수 생성)
 *
 * 실행 방법:
 *   GEMINI_API_KEY=... SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/embed-visit-logs.js
 *
 * 특징:
 *   - 이미 embedding이 있는 행은 건너뜀 (중단 후 재개 가능)
 *   - RPD 보호: 하루 최대 MAX_PER_RUN건만 처리 (기본 500)
 *   - content가 없는 행은 건너뜀
 *   - 50ms 딜레이로 RPM 안전하게 유지
 */

const EMBED_DELAY_MS = 50;
const MAX_PER_RUN = 500; // 하루 RPD 1000 중 절반만 사용

const { GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ 환경변수가 없습니다.');
    console.error('   필요: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const sbHeaders = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getEmbedding(text) {
    const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: 'models/gemini-embedding-001',
                content: { parts: [{ text }] },
                outputDimensionality: 768
            })
        }
    );
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Embedding API ${res.status}: ${err.substring(0, 120)}`);
    }
    const data = await res.json();
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length !== 768) throw new Error('임베딩 차원 오류');
    return values;
}

async function main() {
    // 개척완료 기록 중 embedding 없는 것만 조회 (Mother Brain 검색 대상)
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/visit_logs?select=id,business_name,visit_date,manager,content,trade_status&embedding=is.null&content=ilike.*개척완료*&order=visit_date.desc&limit=${MAX_PER_RUN}`,
        { headers: sbHeaders }
    );
    if (!res.ok) throw new Error(`Supabase 조회 실패: ${res.status}`);
    const rows = await res.json();

    console.log(`📋 임베딩 대상: ${rows.length}건 (최대 ${MAX_PER_RUN}건)`);
    if (rows.length === 0) {
        console.log('✅ 모든 방문일지 임베딩 완료 상태입니다.');
        return;
    }

    let success = 0, skipped = 0, failed = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const content = (row.content || '').trim();

        if (!content) { skipped++; continue; }

        // 임베딩 텍스트: 거래처명 + 상태 + 방문 내용
        const embedText = [
            row.business_name || '',
            row.trade_status || '',
            content.substring(0, 300) // 토큰 절감
        ].filter(Boolean).join(' | ');

        try {
            const embedding = await getEmbedding(embedText);

            // Supabase 업데이트
            const updateRes = await fetch(
                `${SUPABASE_URL}/rest/v1/visit_logs?id=eq.${row.id}`,
                {
                    method: 'PATCH',
                    headers: sbHeaders,
                    body: JSON.stringify({ embedding: `[${embedding.join(',')}]` })
                }
            );
            if (!updateRes.ok) throw new Error(`업데이트 실패: ${updateRes.status}`);

            success++;
            if ((i + 1) % 50 === 0) {
                console.log(`  ✓ ${i + 1}/${rows.length} 처리 중...`);
            }
        } catch (e) {
            console.error(`  ✗ [${row.business_name}] 실패: ${e.message}`);
            failed++;
        }

        if (i < rows.length - 1) await sleep(EMBED_DELAY_MS);
    }

    console.log(`\n✅ 완료: 성공 ${success}건 / 스킵 ${skipped}건 / 실패 ${failed}건`);
    if (rows.length === MAX_PER_RUN) {
        console.log(`⚠️  아직 미처리 항목이 있을 수 있습니다. 내일 다시 실행하세요. (RPD 보호)`);
    }
}

main().catch(e => {
    console.error('❌ 오류:', e.message);
    process.exit(1);
});
