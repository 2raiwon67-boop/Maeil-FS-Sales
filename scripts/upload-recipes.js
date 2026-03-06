/**
 * recipe-data.json → Gemini 임베딩 생성 → Supabase recipes 테이블 업로드
 *
 * 사전 조건:
 *   1. Supabase SQL Editor에서 dev/supabase_setup.sql 전체 실행 (recipes 테이블 + 벡터 함수 생성)
 *   2. 환경변수 설정
 *
 * 실행 방법:
 *   GEMINI_API_KEY=... SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/upload-recipes.js
 *
 *   전체 재업로드 (main_products 등 변경 후):
 *     node scripts/upload-recipes.js --force
 *
 * 특징:
 *   - 이미 업로드된 filename은 건너뜀 (중단 후 재개 가능)
 *   - --force 플래그 시 전체 upsert (기존 데이터 덮어쓰기)
 *   - upsert 방식으로 중복 실행 안전
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INPUT_FILE = path.resolve(__dirname, 'recipe-data.json');

// Gemini gemini-embedding-001: 768차원
const EMBED_DELAY_MS = 50;

const { GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!GEMINI_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('❌ 환경변수가 없습니다.');
    console.error('   필요: GEMINI_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

if (!fs.existsSync(INPUT_FILE)) {
    console.error(`❌ ${INPUT_FILE} 없음 — 먼저 process-recipes.js를 실행하세요.`);
    process.exit(1);
}

const recipes = JSON.parse(fs.readFileSync(INPUT_FILE, 'utf-8'));
console.log(`📂 ${recipes.length}개 레시피 로드`);

const supabaseBase = {
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
};

// ── 이미 업로드된 filename 조회 ──
async function getExistingFilenames() {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/recipes?select=filename`,
        { headers: { ...supabaseBase, 'Prefer': 'return=representation' } }
    );
    if (!res.ok) {
        console.warn('⚠️  기존 레시피 조회 실패, 전체 업로드 진행');
        return new Set();
    }
    const data = await res.json();
    return new Set(data.map(r => r.filename));
}

// ── Gemini text-embedding-004 호출 ──
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
    if (!values?.length) throw new Error('임베딩 값이 비어있습니다.');
    return values;
}

// ── Supabase upsert (filename 충돌 시 업데이트) ──
async function upsertRecipe(row) {
    const res = await fetch(
        `${SUPABASE_URL}/rest/v1/recipes`,
        {
            method: 'POST',
            headers: {
                ...supabaseBase,
                'Prefer': 'resolution=merge-duplicates,return=minimal'
            },
            body: JSON.stringify(row)
        }
    );
    if (!res.ok) {
        const err = await res.text();
        throw new Error(`Supabase ${res.status}: ${err.substring(0, 120)}`);
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
    const isForce = process.argv.includes('--force');

    let pending;
    if (isForce) {
        console.log('⚡ --force 모드: 전체 레시피 재업로드 (기존 데이터 덮어쓰기)');
        pending = recipes;
    } else {
        const existing = await getExistingFilenames();
        console.log(`📌 이미 업로드된 레시피: ${existing.size}개`);
        pending = recipes.filter(r => !existing.has(r.filename));
    }

    console.log(`📋 업로드 예정: ${pending.length}개\n`);

    if (pending.length === 0) {
        console.log('✅ 모두 이미 업로드되어 있습니다.');
        return;
    }

    let success = 0;
    let errors = 0;
    const failedList = [];

    for (let i = 0; i < pending.length; i++) {
        const r = pending[i];

        // 검색에 활용할 임베딩 텍스트 조합
        const embedText = [
            r.name,
            r.nameEn || '',
            r.description || '',
            (r.tags || []).join(' '),
            (r.mainProducts || []).join(' '),
            (r.ingredients || []).map(ing => ing.name).join(' ')
        ].filter(Boolean).join(' ');

        process.stdout.write(`[${i + 1}/${pending.length}] ${r.name} ... `);

        try {
            const embedding = await getEmbedding(embedText);

            await upsertRecipe({
                filename:      r.filename,
                name:          r.name,
                name_en:       r.nameEn   || null,
                description:   r.description || null,
                main_products: r.mainProducts || [],
                ingredients:   r.ingredients  || [],
                steps:         r.steps        || [],
                category:      r.category     || null,
                tags:          r.tags         || [],
                is_vegan:      r.isVegan      || false,
                // pgvector는 '[0.1, 0.2, ...]' 리터럴 문자열로 전달
                embedding: `[${embedding.join(',')}]`
            });

            console.log('✅');
            success++;
        } catch (e) {
            console.log(`❌ ${e.message.substring(0, 80)}`);
            errors++;
            failedList.push({ filename: r.filename, error: e.message });
        }

        if (i < pending.length - 1) await sleep(EMBED_DELAY_MS);
    }

    console.log('\n========================================');
    console.log(`✅ 완료: ${success}개 성공, ${errors}개 실패`);
    if (failedList.length > 0) {
        const errFile = path.resolve(__dirname, 'upload-errors.json');
        fs.writeFileSync(errFile, JSON.stringify(failedList, null, 2));
        console.log(`⚠️  오류 목록: ${errFile}`);
    }
    console.log('========================================');
    console.log('Supabase Table Editor에서 recipes 테이블을 확인하세요.');
}

main().catch(console.error);
