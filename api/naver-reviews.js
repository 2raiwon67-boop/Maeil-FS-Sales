const ALLOWED_ORIGINS = [
    'https://2raiwon67-boop.github.io',
    'http://localhost:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:8080'
];

export default async function handler(req, res) {
    const origin = req.headers.origin;
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin || ALLOWED_ORIGINS[0]);
    }
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { storeName, productDB, previousReviewLinks, storeHistory } = req.body || {};
    if (!storeName?.trim()) {
        return res.status(400).json({ success: false, error: '매장명을 입력해주세요.' });
    }

    const isIncrementalUpdate = previousReviewLinks && previousReviewLinks.length > 0;
    const hasVisitHistory = storeHistory && storeHistory.length > 0;

    const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
    const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET || !GEMINI_API_KEY) {
        return res.status(500).json({ success: false, error: 'API 키가 설정되지 않았습니다. 관리자에게 문의하세요.' });
    }

    try {
        // ── 공통: Supabase 환경변수 ──
        const SUPABASE_URL = process.env.SUPABASE_URL;
        const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

        // ── 0. Supabase 네이버 API 캐시 조회 (24h) ──
        let localData = { items: [] };
        let blogData = { items: [] };
        let naverCacheHit = false;

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            try {
                const cacheRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/naver_cache?store_name=eq.${encodeURIComponent(storeName.trim())}&select=local_data,blog_data,cached_at`,
                    {
                        headers: {
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                        }
                    }
                );
                if (cacheRes.ok) {
                    const rows = await cacheRes.json();
                    if (Array.isArray(rows) && rows.length > 0) {
                        const row = rows[0];
                        const ageMs = Date.now() - new Date(row.cached_at).getTime();
                        if (ageMs < 240 * 60 * 60 * 1000) {
                            localData = row.local_data || { items: [] };
                            blogData = row.blog_data || { items: [] };
                            naverCacheHit = true;
                            console.log(`[Naver Cache HIT] ${storeName.trim()}`);
                        } else {
                            console.log(`[Naver Cache MISS] 만료 (${Math.floor(ageMs / 3600000)}h 경과)`);
                        }
                    }
                }
            } catch (cacheErr) {
                console.warn('[Naver Cache] 조회 실패 (무시):', cacheErr.message);
            }
        }

        if (!naverCacheHit) {
            // ── 1. 네이버 검색 API 병렬 호출 ──
            const naverHeaders = {
                'X-Naver-Client-Id': NAVER_CLIENT_ID,
                'X-Naver-Client-Secret': NAVER_CLIENT_SECRET
            };

            const [localResult, blogResult] = await Promise.allSettled([
                fetch(
                    `https://openapi.naver.com/v1/search/local.json?query=${encodeURIComponent(storeName)}&display=5`,
                    { headers: naverHeaders }
                ).then(async r => {
                    if (!r.ok) {
                        const text = await r.text();
                        throw new Error(`Local Search Error (${r.status}): ${text}`);
                    }
                    return r.json();
                }),
                fetch(
                    `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(storeName + ' 리뷰')}&display=10&sort=date`,
                    { headers: naverHeaders }
                ).then(async r => {
                    if (!r.ok) {
                        const text = await r.text();
                        throw new Error(`Blog Search Error (${r.status}): ${text}`);
                    }
                    return r.json();
                })
            ]);

            // 에러 로깅
            if (localResult.status === 'rejected') console.error('Naver Local API Error:', localResult.reason);
            if (blogResult.status === 'rejected') console.error('Naver Blog API Error:', blogResult.reason);

            localData = localResult.status === 'fulfilled' ? localResult.value : { items: [] };
            blogData = blogResult.status === 'fulfilled' ? blogResult.value : { items: [] };

            // ── 캐시 저장 ──
            if (SUPABASE_URL && SUPABASE_ANON_KEY) {
                try {
                    await fetch(`${SUPABASE_URL}/rest/v1/naver_cache`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'apikey': SUPABASE_ANON_KEY,
                            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                            'Prefer': 'resolution=merge-duplicates'
                        },
                        body: JSON.stringify({
                            store_name: storeName.trim(),
                            local_data: localData,
                            blog_data: blogData,
                            cached_at: new Date().toISOString()
                        })
                    });
                    console.log(`[Naver Cache SAVE] ${storeName.trim()}`);
                } catch (saveErr) {
                    console.warn('[Naver Cache] 저장 실패 (무시):', saveErr.message);
                }
            }
        }

        // ── 증분 업데이트: 중복 리뷰 필터링 ──
        let filteredBlogItems = blogData.items || [];
        if (isIncrementalUpdate) {
            const previousLinks = new Set(previousReviewLinks);
            filteredBlogItems = filteredBlogItems.filter(item => !previousLinks.has(item.link));

            // 새 리뷰가 없으면 캐시된 데이터 사용 권장
            if (filteredBlogItems.length === 0) {
                return res.status(200).json({
                    success: true,
                    cached: true,
                    message: '최신 리뷰가 없습니다. 기존 분석 결과를 사용하세요.'
                });
            }
        }

        // ── Gemini 분석 결과 캐시 확인 (7일, 새 리뷰 2건 미만 조건) ──
        // store_analysis_cache 테이블 생성 SQL (최초 1회):
        // CREATE TABLE store_analysis_cache (
        //   id BIGSERIAL PRIMARY KEY,
        //   store_name TEXT NOT NULL UNIQUE,
        //   analysis JSONB NOT NULL,
        //   review_count INT DEFAULT 0,
        //   cached_at TIMESTAMPTZ DEFAULT NOW()
        // );
        let analysisCacheHit = false;
        let cachedAnalysis = null;
        const newReviewCount = isIncrementalUpdate ? filteredBlogItems.length : (blogData.items || []).length;

        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            try {
                const acRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/store_analysis_cache?store_name=eq.${encodeURIComponent(storeName.trim())}&select=analysis,review_count,cached_at&limit=1`,
                    { headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` } }
                );
                if (acRes.ok) {
                    const rows = await acRes.json();
                    if (Array.isArray(rows) && rows.length > 0) {
                        const row = rows[0];
                        const ageMs = Date.now() - new Date(row.cached_at).getTime();
                        const daysSince = ageMs / 86400000;
                        const reviewDiff = newReviewCount - (row.review_count || 0);
                        // 7일 이내 AND 새 리뷰 2건 미만이면 캐시 반환
                        if (daysSince < 7 && reviewDiff < 2) {
                            cachedAnalysis = row.analysis;
                            analysisCacheHit = true;
                        }
                    }
                }
            } catch (_e) {}
        }

        if (analysisCacheHit && cachedAnalysis) {
            const products = (productDB || []);
            const recommendedItems = (cachedAnalysis.recommendedIndices || [])
                .filter(i => i >= 0 && i < products.length)
                .map(i => products[i]);
            return res.status(200).json({
                success: true,
                cached: true,
                tags: cachedAnalysis.tags || [],
                description: cachedAnalysis.description || '',
                items: recommendedItems,
                signatureMenus: cachedAnalysis.signatureMenus || [],
                reviewLinks: (blogData.items || []).map(i => i.link),
                isUpdate: isIncrementalUpdate,
                recipeMatched: 0,
                naverInfo: { localResults: localSummary?.length || 0, blogResults: newReviewCount, newReviews: newReviewCount }
            });
        }

        // ── 2. HTML 태그 제거 및 데이터 정리 ──
        const stripHtml = (str) => str ? str.replace(/<[^>]*>/g, '') : '';

        // 카페·베이커리·브런치 카테고리를 앞으로 정렬 (매장 특정 정확도 개선)
        const CAFE_KEYWORDS = ['카페', '커피', '베이커리', '제과', '브런치', '디저트', '케이크', '티'];
        const FOOD_KEYWORDS = ['음식점', '레스토랑', '식당', '주점', '패스트푸드'];
        const categorySortScore = (cat) => {
            if (!cat) return 9;
            if (CAFE_KEYWORDS.some(k => cat.includes(k))) return 0;
            if (FOOD_KEYWORDS.some(k => cat.includes(k))) return 1;
            return 5;
        };

        const localSummary = (localData.items || [])
            .map(item => ({
                name: stripHtml(item.title),
                category: item.category,
                address: item.roadAddress || item.address
            }))
            .sort((a, b) => categorySortScore(a.category) - categorySortScore(b.category));

        const blogSummary = filteredBlogItems.map(item => ({
            title: stripHtml(item.title),
            description: stripHtml(item.description).substring(0, 100), // 토큰 절감
            link: item.link
        }));

        // 현재 리뷰 링크 목록 (캐싱용)
        const currentReviewLinks = filteredBlogItems.map(item => item.link);

        // ── 2.5. Recipe RAG — 레시피 DB 유사도 검색 ──
        let recipeSection = '';
        let recipeMatchCount = 0;
        if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
            console.log('Recipe RAG 스킵: SUPABASE_URL 또는 SUPABASE_ANON_KEY 환경변수 미설정');
        } else if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            try {
                // 임베딩 쿼리: 매장명 + 블로그 제목 상위 5개 (메뉴·음료 키워드 포함)
                const embedText = [storeName, ...filteredBlogItems.slice(0, 5).map(b => stripHtml(b.title))].join(' ');

                const embedRes = await fetch(
                    `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            model: 'models/gemini-embedding-001',
                            content: { parts: [{ text: embedText }] },
                            outputDimensionality: 768
                        })
                    }
                );

                if (embedRes.ok) {
                    const embedData = await embedRes.json();
                    const vector = embedData.embedding?.values;

                    if (Array.isArray(vector) && vector.length === 768) {
                        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_recipes`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                'apikey': SUPABASE_ANON_KEY,
                                'Authorization': `Bearer ${SUPABASE_ANON_KEY}`
                            },
                            body: JSON.stringify({
                                query_embedding: `[${vector.join(',')}]`,
                                match_count: 5
                            })
                        });

                        if (rpcRes.ok) {
                            const matched = await rpcRes.json();
                            console.log(`Recipe RAG: ${Array.isArray(matched) ? matched.length : 0}건 매칭`);
                            if (Array.isArray(matched) && matched.length > 0) {
                                recipeMatchCount = matched.length;
                                const recipeLines = matched.map(r =>
                                    `- [${r.category || '음료'}] ${r.name}: 자사제품=[${(r.main_products || []).join(', ')}] 태그=[${(r.tags || []).slice(0, 4).join(', ')}]`
                                ).join('\n');
                                recipeSection = `\n## 자사 레시피 DB — 유사 메뉴 활용 사례\n${recipeLines}\n\n⚠️ 위 레시피는 실제 매일유업 제품이 사용된 유사 메뉴 사례입니다. 제품 추천·시그니처 메뉴 대응 시 반드시 참고하세요.\n`;
                            }
                        } else {
                            const rpcErr = await rpcRes.text().catch(() => '');
                            console.warn(`Recipe RPC error: ${rpcRes.status} — ${rpcErr.slice(0, 200)}`);
                            // 403: GRANT EXECUTE ON FUNCTION search_recipes TO anon; 실행 필요
                            // 404: search_recipes 함수명 확인 필요
                            // 500: 벡터 차원(768) 또는 함수 시그니처 확인 필요
                        }
                    }
                }
            } catch (recipeErr) {
                console.warn('Recipe RAG 검색 실패 (무시):', recipeErr.message);
            }
        }

        // ── 3. Gemini 프롬프트 구성 ──
        const products = productDB || [];
        // 제품 목록: 인덱스·품명·규격·사용용도 (가격 등은 매핑 시 활용) — 토큰 절감
        const productList = products.map((p, i) =>
            `[${i}] ${p.name} / ${p.spec}${p.usage ? ` / 용도: ${p.usage}` : ''}`
        ).join('\n');

        const updateNote = isIncrementalUpdate ? '\n⚠️ 이번 분석은 **증분 업데이트**입니다. 아래는 최근 추가된 리뷰만 포함되어 있습니다.\n' : '';

        // 방문일지 데이터 정리 (실제 필드명 기반)
        let visitHistorySection = '';
        if (hasVisitHistory) {
            const historyItems = storeHistory.slice(0, 5).map(log => ({
                방문일: log['작성일'] || log['일정기간'] || '',
                담당자: log['작성자'] || '',
                거래상태: log['거래상태'] || '',
                방문내용: (log['내용'] || '').substring(0, 150),
                주요이슈: log['주요이슈'] || ''
            }));

            visitHistorySection = `\n## ✨ 우리 팀 방문 기록 (${storeHistory.length}건, 최근 5건 표시)
${historyItems.map(h =>
    `[${h.방문일}|${h.담당자}|${h.거래상태}] ${h.방문내용}${h.주요이슈 ? ` (이슈:${h.주요이슈})` : ''}`
).join('\n')}

⚠️ **중요**: 이 매장은 우리 팀이 이미 방문한 적이 있습니다!
과거 방문 결과를 바탕으로 **전략을 조정**하세요:
- 거래 성공 → 어떤 제품이 효과적이었는지 파악
- 미거래 → 방문 내용에서 거절 사유를 파악하고 다른 접근법 제안
- 방문 내용에서 매장 특성이나 오너 성향 파악
`;
        }

        const prompt = `당신은 매일유업 FS(Food Service) 영업사원을 위한 매장 분석 AI입니다.
아래 네이버 검색 결과를 분석하여 매장 특성을 파악하고, 매일유업 제품을 추천해주세요.
${updateNote}
## 검색 매장: "${storeName}"

## 📌 분석 대상 특정 지침
지역 검색 결과에 같은 이름의 여러 매장이 있거나 카테고리가 불명확한 경우:
- 카페·베이커리·브런치·디저트·음식점 카테고리를 최우선으로 분석 대상을 특정하세요.
- 매장명만으로 업종 판단이 어렵더라도(예: 한식당처럼 보이는 이름이지만 실제 베이커리 카페인 경우) 블로그 리뷰의 메뉴 키워드를 기반으로 실제 업종을 판단하세요.
- 분석은 반드시 특정된 1개 매장 기준으로만 수행하세요.

## 네이버 지역 검색 결과
${JSON.stringify(localSummary, null, 2)}

## 네이버 블로그 리뷰 요약
${JSON.stringify(blogSummary, null, 2)}${visitHistorySection}${recipeSection}
## 매일유업 제품 목록
${productList}

## 분석 요청
1. 매장의 **핵심 키워드 태그** 3~5개 추출 (예: 가성비, 학생층, 프리미엄, 건강, 디저트카페)
2. **영업 공략 포인트** 3~4문장으로 작성. 아래 두 가지를 반드시 포함하세요:
   - 블로그 리뷰에서 파악한 **시그니처 메뉴의 원료 분석** → 매일유업 제품으로 대응 가능한 구체적 방안
   - ${hasVisitHistory ? '**과거 방문 실패/거절 사유를 극복**할 수 있는 접근법 (방문 기록 기반)' : '이 매장 업종/규모에서 자주 발생하는 거절 사유와 극복 전략'}
   중요한 부분은 <strong> 태그로, 매일유업 제품명은 <span style="color:#0071e3; font-weight:700;"> 태그로 감싸주세요.
3. 위 두 가지 관점(시그니처 메뉴 대응 + ${hasVisitHistory ? '과거 실패 극복' : '거절 극복'})에서 **가장 효과적인 제품 정확히 3개**를 인덱스 번호로 추천하세요.
   - 레시피 DB에 유사 메뉴 사례가 있다면 해당 레시피의 자사제품을 **최우선** 고려하세요.
   - 매장이 일반 카페·음식점인 경우: 음료용 제품(우유, 크림, 베이스류 등)을 **최우선** 추천하세요. 베이커리 전문점·제과점이 아닌 한 치즈·버터 등 베이킹 원료는 추천에서 제외하세요.
   - 베이커리 카페, 제과점, 브런치 카페임이 리뷰·업종에서 명확히 확인된 경우에만 베이킹 원료를 포함하세요.
   - 제품 목록의 '용도' 항목을 반드시 참고하여 매장 유형과 맞는 제품을 선택하세요.
4. 블로그 리뷰 또는 업종 특성 기반으로 **시그니처 메뉴 1~2개** 파악:
   - 추정 원료
   - 매일유업 제품으로 대응하는 구체적 방안

## 응답 형식
아래 JSON 형식으로만 응답하세요. 다른 설명이나 텍스트 없이 순수 JSON만 출력하세요.

{"tags": ["키워드1", "키워드2"], "description": "HTML이 포함된 영업 공략 포인트", "recommendedIndices": [0, 2, 5], "signatureMenus": [{"menu": "시그니처 라떼", "ingredients": "우유, 에스프레소", "maeilSolution": "매일 바리스타 우유로 풍미 차별화 제안"}]}

중요 사항:
- 반드시 유효한 JSON 객체만 출력 (JSON 이외 텍스트 절대 금지)
- 코드 블록 마커 사용 금지
- description은 3~4문장, HTML 태그는 핵심 강조에만 사용
- recommendedIndices는 정확히 3개
- signatureMenus는 최대 2개, ingredients·maeilSolution은 각 40자 이내
- 검색 결과가 부족하면 매장명/업종 기반으로 추론하여 응답`;

        // ── 4. Gemini API 호출 ──
        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        maxOutputTokens: 1500,
                        topP: 0.95,
                        topK: 40,
                        thinkingConfig: {
                            thinkingBudget: 0  // JSON 반환 작업은 thinking 불필요 → 비활성화
                        }
                    }
                })
            }
        );

        if (!geminiRes.ok) {
            const errBody = await geminiRes.text();
            console.error('Gemini API error:', geminiRes.status, errBody);
            throw new Error('Gemini API 호출 실패');
        }

        const geminiData = await geminiRes.json();
        const candidate = geminiData.candidates?.[0];

        // 토큰 한도 초과로 응답이 잘린 경우 조기 감지
        if (candidate?.finishReason === 'MAX_TOKENS') {
            throw new Error('응답이 너무 길어 잘렸습니다. 매장명을 더 구체적으로 입력하거나 다시 시도해주세요.');
        }

        // thinking 모델은 parts 배열에 thought:true 파트가 먼저 올 수 있으므로 실제 응답 파트를 찾음
        const rawText = candidate?.content?.parts?.find(p => !p.thought)?.text
            ?? candidate?.content?.parts?.[0]?.text;

        if (!rawText) {
            throw new Error('Gemini 응답이 비어있습니다.');
        }

        // ── 5. JSON 파싱 (개선된 버전) ──
        let jsonStr = rawText.trim();

        // 마크다운 코드 블록 제거 (```json ... ``` 또는 ``` ... ```)
        // 정규식 개선: 시작과 끝의 코드블록을 더 확실하게 제거하고, 앞뒤 공백 제거
        jsonStr = jsonStr.replace(/^```json/i, '').replace(/^```/, '').replace(/```$/, '').trim();

        // JSON 객체만 추출 (텍스트 설명이 있을 경우 대비)
        const braceStart = jsonStr.indexOf('{');
        const braceEnd = jsonStr.lastIndexOf('}');

        if (braceStart !== -1 && braceEnd !== -1) {
            jsonStr = jsonStr.substring(braceStart, braceEnd + 1);
        }

        let analysis;
        try {
            analysis = JSON.parse(jsonStr);
        } catch (parseError) {
            console.error('JSON 파싱 실패. 원본 텍스트:', rawText);

            // 일반적인 Gemini 오류 패턴 처리 (JSON이 잘린 경우 등)
            if (parseError.message.includes('Unterminated string') || parseError.message.includes('End of data')) {
                throw new Error('Gemini 응답이 너무 길어 중간에 잘렸습니다. 다시 시도해주세요. (Unterminated JSON)');
            }

            throw new Error(`Gemini 응답을 JSON으로 변환할 수 없습니다: ${parseError.message}`);
        }

        // ── 6. 제품 인덱스 → 실제 제품 객체 매핑 ──
        const recommendedItems = (analysis.recommendedIndices || [])
            .filter(i => i >= 0 && i < products.length)
            .map(i => products[i]);

        // ── Gemini 분석 결과 캐시 저장 ──
        if (SUPABASE_URL && SUPABASE_ANON_KEY) {
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/store_analysis_cache`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'apikey': SUPABASE_ANON_KEY,
                        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
                        'Prefer': 'resolution=merge-duplicates'
                    },
                    body: JSON.stringify({
                        store_name: storeName.trim(),
                        analysis,
                        review_count: newReviewCount,
                        cached_at: new Date().toISOString()
                    })
                });
            } catch (_e) {}
        }

        return res.status(200).json({
            success: true,
            tags: analysis.tags || [],
            description: analysis.description || '',
            items: recommendedItems,
            signatureMenus: analysis.signatureMenus || [],
            reviewLinks: currentReviewLinks,
            isUpdate: isIncrementalUpdate,
            recipeMatched: recipeMatchCount,
            naverInfo: {
                localResults: localSummary.length,
                blogResults: blogSummary.length,
                newReviews: isIncrementalUpdate ? filteredBlogItems.length : blogSummary.length
            }
        });

    } catch (error) {
        console.error('Analysis error:', error);
        // 클라이언트에게 상세 에러 메시지 전달
        return res.status(500).json({
            success: false,
            error: error.message || '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
            details: error.stack
        });
    }
}
