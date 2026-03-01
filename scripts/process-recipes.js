/**
 * 레시피 PDF → 규칙 기반 파싱 → recipe-data.json 저장
 * API 키 불필요. pdfjs-dist로 텍스트 추출 후 규칙으로 구조화.
 *
 * 실행 방법:
 *   node scripts/process-recipes.js
 *
 * 결과: scripts/recipe-data.json (이후 upload-recipes.js로 Supabase 업로드)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RECIPE_DIR  = path.resolve(__dirname, '../assets/recipe');
const OUTPUT_FILE = path.resolve(__dirname, 'recipe-data.json');
const ERROR_FILE  = path.resolve(__dirname, 'recipe-errors.json');

// ── 자사 브랜드/제품 키워드 (mainProducts 추출용) ──────────────────
// 공백 있는 정규 표기만 유지. 공백 없는 변형('매일우유' 등)은 extractMainProducts에서 처리.
// '매일' 단독 키워드 제거 (너무 범용적 — 일반 문장에서 오인식)
const PRODUCT_KEYWORDS = [
    '어메이징 오트 바리스타',
    '어메이징 오트',
    '상하목장 소프트믹스',
    '상하목장 초콜릿믹스',
    '상하목장 요거트',
    '상하목장',
    '소프트믹스',
    '테너 베이스',
    '테너 과육플러스',
    '매일 바이오',
    '매일 두유',
    '매일 우유',
    '후레쉬 쉐프크림', '쉐프크림',
    '매일 크림',
    '알라 크림',
    '라크림 스프레이', '라크림',
    '사워크림',
    '연유',
    '아몬드브리즈',
];

// ── 카테고리 키워드 매핑 ───────────────────────────────────────────
const CATEGORY_MAP = [
    { keywords: ['라떼', 'latte', 'latte'],    category: '라떼' },
    { keywords: ['에이드', 'ade'],              category: '에이드' },
    { keywords: ['블렌디드', 'blended'],        category: '블렌디드' },
    { keywords: ['슬러시', 'slush'],            category: '슬러시' },
    { keywords: ['밀크티', 'milk tea'],         category: '밀크티' },
    { keywords: ['스무디', 'smoothie'],         category: '스무디' },
    { keywords: ['요거트', 'yogurt', 'yoghurt'],category: '요거트' },
];

// ── 태그 키워드 목록 ───────────────────────────────────────────────
const TAG_KEYWORDS = [
    '딸기', '바닐라', '초코', '초콜릿', '말차', '녹차', '쑥', '흑임자',
    '유자', '레몬', '라임', '복숭아', '피치', '망고', '패션후르츠',
    '청포도', '포도', '사과', '배', '홍시', '밤', '호박', '고구마',
    '아몬드', '피넛', '헤이즐넛', '카라멜', '시나몬', '얼그레이',
    '아쌈', '우롱', '히비스커스', '라벤더', '엘더플라워',
    '오트', '두유', '식물성', '비건', 'vegan',
    'ICE', 'HOT', '아이스', '핫',
    '크림', '폼', '라떼', '에이드', '블렌디드', '슬러시',
];

// ── PDF 텍스트 추출 ────────────────────────────────────────────────
async function extractText(pdfPath) {
    const buf = fs.readFileSync(pdfPath);
    const doc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;
    let text = '';
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text += content.items.map(item => item.str).join(' ') + ' ';
    }
    return text.replace(/\s+/g, ' ').trim();
}

// ── 영문명 추출 (연속된 영문 대문자 단어) ─────────────────────────
function extractEnglishName(text) {
    // 2단어 이상 연속된 영문 단어 (첫 글자 대문자)
    const match = text.match(/([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,5})/);
    return match ? match[1].trim() : null;
}

// ── 자사 제품 추출 ─────────────────────────────────────────────────
function extractMainProducts(text) {
    const found = [];
    const lower = text.toLowerCase();
    // PDF에서 공백이 생략된 경우도 인식 (예: '매일우유' → 정규표기 '매일 우유'로 저장)
    const noSpace = lower.replace(/\s/g, '');

    for (const kw of PRODUCT_KEYWORDS) {
        const kwLower  = kw.toLowerCase();
        const kwNoSpace = kwLower.replace(/\s/g, '');

        // 공백 포함 원문 또는 공백 제거 버전 중 하나라도 매칭되면 인식
        if (!lower.includes(kwLower) && !noSpace.includes(kwNoSpace)) continue;

        // 이미 추가된 더 구체적인 키워드가 현재 kw를 포함하면 스킵 (공백 정규화 비교)
        const alreadyCovered = found.some(f =>
            f.toLowerCase().replace(/\s/g, '').includes(kwNoSpace)
        );
        if (!alreadyCovered) found.push(kw);
    }
    return found;
}

// ── 카테고리 추출 ──────────────────────────────────────────────────
function extractCategory(text, filename) {
    const lower = (text + ' ' + filename).toLowerCase();
    for (const { keywords, category } of CATEGORY_MAP) {
        if (keywords.some(k => lower.includes(k.toLowerCase()))) return category;
    }
    return '기타';
}

// ── 태그 추출 ──────────────────────────────────────────────────────
function extractTags(text, filename) {
    const source = (text + ' ' + filename).toLowerCase();
    return TAG_KEYWORDS.filter(k => source.includes(k.toLowerCase())).slice(0, 8);
}

// ── 설명 추출 (마케팅 문구 패턴) ──────────────────────────────────
function extractDescription(text) {
    // 느낌표나 마침표 앞의 한글 문장 중 10자 이상인 것
    const matches = text.match(/[가-힣a-zA-Z0-9\s,!\.]{10,60}[!\.]/g);
    if (matches) {
        const candidate = matches.find(m => m.length >= 10 && /[가-힣]/.test(m));
        if (candidate) return candidate.trim();
    }
    return null;
}

// ── 메인 파싱 함수 ─────────────────────────────────────────────────
async function parseRecipe(pdfPath) {
    const filename = path.basename(pdfPath, '.pdf');
    const text = await extractText(pdfPath);

    const name        = filename;
    const nameEn      = extractEnglishName(text);
    const mainProducts = extractMainProducts(text);
    const category    = extractCategory(text, filename);
    const tags        = extractTags(text, filename);
    const description = extractDescription(text);
    const isVegan     = /비건|vegan/i.test(text);

    return {
        filename,
        name,
        nameEn,
        description,
        mainProducts,
        ingredients: [],
        steps: [],
        category,
        tags,
        isVegan,
    };
}

// ── 메인 ──────────────────────────────────────────────────────────
async function main() {
    const allFiles = fs.readdirSync(RECIPE_DIR)
        .filter(f => f.endsWith('.pdf'))
        .sort();

    // 이미 처리된 결과 이어받기
    let results = [];
    if (fs.existsSync(OUTPUT_FILE)) {
        try {
            results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
            console.log(`📂 기존 결과 ${results.length}개 로드 (이어서 처리)`);
        } catch (e) { results = []; }
    }
    const processed = new Set(results.map(r => r.filename));
    const pending   = allFiles.filter(f => !processed.has(path.basename(f, '.pdf')));

    console.log(`📋 전체 ${allFiles.length}개 중 ${pending.length}개 처리 예정\n`);

    const errors = [];

    for (let i = 0; i < pending.length; i++) {
        const file    = pending[i];
        const pdfPath = path.join(RECIPE_DIR, file);
        const name    = path.basename(file, '.pdf');

        process.stdout.write(`[${i + 1}/${pending.length}] ${name} ... `);

        try {
            const recipe = await parseRecipe(pdfPath);
            results.push(recipe);

            if ((i + 1) % 50 === 0) {
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
            }

            console.log(`✅ [${recipe.category}] 제품: ${recipe.mainProducts.join(', ') || '없음'}`);
        } catch (e) {
            console.log(`❌ ${e.message.substring(0, 80)}`);
            errors.push({ file, error: e.message });
        }
    }

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    if (errors.length > 0) fs.writeFileSync(ERROR_FILE, JSON.stringify(errors, null, 2));

    console.log('\n========================================');
    console.log(`✅ 완료: ${results.length}개 성공, ${errors.length}개 실패`);
    console.log(`📄 결과: ${OUTPUT_FILE}`);
    console.log('========================================');
    console.log('다음 단계: GEMINI_API_KEY=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/upload-recipes.js');
}

main().catch(console.error);
