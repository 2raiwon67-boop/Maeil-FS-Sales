/**
 * 레시피 PDF → Gemini 추출 → recipe-data.json 저장
 *
 * 실행 방법:
 *   GEMINI_API_KEY=your_key node scripts/process-recipes.js
 *
 * 결과: scripts/recipe-data.json (이후 Supabase 업로드에 사용)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const RECIPE_DIR  = path.resolve(__dirname, '../assets/recipe');
const OUTPUT_FILE = path.resolve(__dirname, 'recipe-data.json');
const ERROR_FILE  = path.resolve(__dirname, 'recipe-errors.json');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DELAY_MS = 30000; // 2 req/min 초안전 간격 (일일 할당량 절약)

if (!GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY 환경변수가 없습니다.');
    console.error('   실행 예시: GEMINI_API_KEY=your_key node scripts/process-recipes.js');
    process.exit(1);
}

// 이미 처리된 결과가 있으면 이어서 진행 (중단 후 재개 가능)
let existingResults = [];
if (fs.existsSync(OUTPUT_FILE)) {
    try {
        existingResults = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
        console.log(`📂 기존 결과 ${existingResults.length}개 로드 (이어서 처리)`);
    } catch (e) {
        existingResults = [];
    }
}
const processedFilenames = new Set(existingResults.map(r => r.filename));

async function extractRecipe(pdfPath, retryCount = 0) {
    const pdfBuffer = fs.readFileSync(pdfPath);
    const base64 = pdfBuffer.toString('base64');

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        {
                            inlineData: {
                                mimeType: 'application/pdf',
                                data: base64
                            }
                        },
                        {
                            text: `이 레시피 카드에서 정보를 추출하여 아래 JSON 형식으로만 반환하세요. 코드블록 없이 순수 JSON만 출력하세요.

{
  "name": "레시피명 (한글)",
  "nameEn": "레시피명 (영문, 없으면 null)",
  "description": "레시피 설명 한 줄 (없으면 null)",
  "mainProducts": ["사용된 자사 브랜드 제품명 배열 (매일/어메이징오트/테너/상하목장/알라 등 브랜드 제품만, 에스프레소·얼음 등 제외)"],
  "ingredients": [{"name": "재료명", "amount": "분량 (없으면 null)"}],
  "steps": ["제조 순서 1", "제조 순서 2"],
  "category": "라떼|에이드|블렌디드|슬러시|밀크티|스무디|요거트|기타 중 하나",
  "tags": ["관련 키워드 3~5개 (예: 딸기, 오트, 비건, 여름, 과육)"],
  "isVegan": true또는false
}`
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.1,
                    maxOutputTokens: 1000
                }
            })
        }
    );

    // 429 Rate Limit: 최대 3회 재시도, 대기 시간 점진적 증가
    if (response.status === 429) {
        if (retryCount >= 3) throw new Error('Rate limit 재시도 3회 초과');
        const waitSec = (retryCount + 1) * 60;
        console.warn(`\n⏳ Rate limit (429) — ${waitSec}초 대기 후 재시도 (${retryCount + 1}/3)...`);
        await sleep(waitSec * 1000);
        return extractRecipe(pdfPath, retryCount + 1);
    }

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Gemini API ${response.status}: ${errText.substring(0, 200)}`);
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // 마크다운 코드블록 제거
    const jsonStr = text
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/,     '')
        .replace(/\s*```$/,     '')
        .trim();

    const braceStart = jsonStr.indexOf('{');
    const braceEnd   = jsonStr.lastIndexOf('}');
    const cleaned = braceStart !== -1 && braceEnd !== -1
        ? jsonStr.substring(braceStart, braceEnd + 1)
        : jsonStr;

    return JSON.parse(cleaned);
}

async function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

async function main() {
    const allFiles = fs.readdirSync(RECIPE_DIR)
        .filter(f => f.endsWith('.pdf'))
        .sort();

    const pending = allFiles.filter(f => !processedFilenames.has(path.basename(f, '.pdf')));
    console.log(`📋 전체 ${allFiles.length}개 중 ${pending.length}개 처리 예정`);
    console.log(`⏱  예상 소요 시간: 약 ${Math.ceil(pending.length * DELAY_MS / 60000)}분\n`);

    const results = [...existingResults];
    const errors  = [];

    for (let i = 0; i < pending.length; i++) {
        const file    = pending[i];
        const pdfPath = path.join(RECIPE_DIR, file);
        const name    = path.basename(file, '.pdf');

        process.stdout.write(`[${i + 1}/${pending.length}] ${name} ... `);

        try {
            const recipe = await extractRecipe(pdfPath);
            recipe.filename = name;
            results.push(recipe);

            // 중간 저장 (10개마다)
            if ((i + 1) % 10 === 0) {
                fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
            }

            console.log(`✅ ${recipe.name} [${recipe.category}] 제품: ${recipe.mainProducts?.join(', ') || '-'}`);
        } catch (e) {
            console.log(`❌ ${e.message.substring(0, 80)}`);
            errors.push({ file, error: e.message });
        }

        if (i < pending.length - 1) await sleep(DELAY_MS);
    }

    // 최종 저장
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
    if (errors.length > 0) {
        fs.writeFileSync(ERROR_FILE, JSON.stringify(errors, null, 2));
    }

    console.log('\n========================================');
    console.log(`✅ 완료: ${results.length}개 성공, ${errors.length}개 실패`);
    console.log(`📄 결과 파일: ${OUTPUT_FILE}`);
    if (errors.length > 0) console.log(`⚠️  오류 파일: ${ERROR_FILE}`);
    console.log('========================================');
    console.log('다음 단계: node scripts/upload-recipes.js 로 Supabase에 업로드');
}

main().catch(console.error);
