export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
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

        const localData = localResult.status === 'fulfilled' ? localResult.value : { items: [] };
        const blogData = blogResult.status === 'fulfilled' ? blogResult.value : { items: [] };

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

        // ── 2. HTML 태그 제거 및 데이터 정리 ──
        const stripHtml = (str) => str ? str.replace(/<[^>]*>/g, '') : '';

        const localSummary = (localData.items || []).map(item => ({
            name: stripHtml(item.title),
            category: item.category,
            address: item.roadAddress || item.address
        }));

        const blogSummary = filteredBlogItems.map(item => ({
            title: stripHtml(item.title),
            description: stripHtml(item.description),
            link: item.link
        }));

        // 현재 리뷰 링크 목록 (캐싱용)
        const currentReviewLinks = filteredBlogItems.map(item => item.link);

        // ── 3. Gemini 프롬프트 구성 ──
        const products = productDB || [];
        const productList = products.map((p, i) =>
            `[${i}] ${p.name} (${p.spec}, ${p.price}원, ${p.taxFree ? '면세' : '과세'}, 이미지:${p.image || '📦'}, 최대DC:${p.maxDc || 0}%)`
        ).join('\n');

        const updateNote = isIncrementalUpdate ? '\n⚠️ 이번 분석은 **증분 업데이트**입니다. 아래는 최근 추가된 리뷰만 포함되어 있습니다.\n' : '';

        // 🆕 방문일지 데이터 정리
        let visitHistorySection = '';
        if (hasVisitHistory) {
            const historyItems = storeHistory.slice(0, 5).map(log => ({
                방문일: log['등록일'] || log['방문일'],
                담당자: log['담당자'],
                거래여부: log['거래여부(기입예정)'],
                순위: log['순위'],
                특이사항: log['특이사항'] || log['비고'],
                제안제품: log['제안제품'] || '',
                매출: log['매출'] || ''
            }));

            visitHistorySection = `\n## ✨ 우리 팀 방문 기록 (${storeHistory.length}건, 최근 5건 표시)
${JSON.stringify(historyItems, null, 2)}

⚠️ **중요**: 이 매장은 우리 팀이 이미 방문한 적이 있습니다!
과거 방문 결과를 바탕으로 **전략을 조정**하세요:
- 거래 성공 → 어떤 제품이 효과적이었는지 파악
- 미거래/DROP → 실패 이유를 추론하고 다른 접근법 제안
- 특이사항 확인 → 매장 특성, 거절 사유 등 반영
`;
        }

        const prompt = `당신은 매일유업 FS(Food Service) 영업사원을 위한 매장 분석 AI입니다.
아래 네이버 검색 결과를 분석하여 매장 특성을 파악하고, 매일유업 제품을 추천해주세요.
${updateNote}
## 검색 매장: "${storeName}"

## 네이버 지역 검색 결과 (매장 정보)
${JSON.stringify(localSummary, null, 2)}

## 네이버 블로그 리뷰 요약
${JSON.stringify(blogSummary, null, 2)}${visitHistorySection}

## 매일유업 제품 목록 (추천 대상)
${productList}

## 분석 요청
1. 리뷰와 매장 정보를 바탕으로 이 매장의 **핵심 키워드 태그** 3~5개를 추출하세요 (예: 가성비, 학생층, 프리미엄, 건강, 디저트카페 등)
2. 매장 특성에 대한 **영업 공략 포인트** 설명을 2~3문장으로 작성하세요.${hasVisitHistory ? ' **방문 기록이 있다면 반드시 언급**하고, 과거 결과를 반영한 전략을 제시하세요.' : ''} 중요한 부분은 <strong> 태그로, 매일유업 제품명은 <span style="color:#0071e3; font-weight:700;"> 태그로 감싸주세요.
3. 위 제품 목록에서 이 매장에 가장 적합한 **제품 2~3개**를 인덱스 번호로 추천하세요.${hasVisitHistory ? ' 과거 제안 제품과 다른 제품을 추천할 경우 이유를 설명에 포함하세요.' : ''}

## 응답 형식
아래 JSON 형식으로만 응답하세요. 다른 설명이나 텍스트 없이 순수 JSON만 출력하세요.

예시:
{"tags": ["키워드1", "키워드2", "키워드3"], "description": "HTML이 포함된 영업 공략 포인트 설명", "recommendedIndices": [0, 2]}

중요 사항:
- 반드시 유효한 JSON 객체만 출력
- 코드 블록 마커 사용 금지
- 검색 결과가 부족하면 매장명 기반으로 추론하여 응답`;

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
                        maxOutputTokens: 3000,
                        topP: 0.95,
                        topK: 40
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
        const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text;

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

        return res.status(200).json({
            success: true,
            tags: analysis.tags || [],
            description: analysis.description || '',
            items: recommendedItems,
            reviewLinks: currentReviewLinks,
            isUpdate: isIncrementalUpdate,
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
