export default async function handler(req, res) {
    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

    const { storeName, productDB } = req.body || {};
    if (!storeName?.trim()) {
        return res.status(400).json({ success: false, error: '매장명을 입력해주세요.' });
    }

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
            ).then(r => r.json()),
            fetch(
                `https://openapi.naver.com/v1/search/blog.json?query=${encodeURIComponent(storeName + ' 리뷰')}&display=10&sort=sim`,
                { headers: naverHeaders }
            ).then(r => r.json())
        ]);

        const localData = localResult.status === 'fulfilled' ? localResult.value : { items: [] };
        const blogData = blogResult.status === 'fulfilled' ? blogResult.value : { items: [] };

        // ── 2. HTML 태그 제거 및 데이터 정리 ──
        const stripHtml = (str) => str ? str.replace(/<[^>]*>/g, '') : '';

        const localSummary = (localData.items || []).map(item => ({
            name: stripHtml(item.title),
            category: item.category,
            address: item.roadAddress || item.address
        }));

        const blogSummary = (blogData.items || []).map(item => ({
            title: stripHtml(item.title),
            description: stripHtml(item.description)
        }));

        // ── 3. Gemini 프롬프트 구성 ──
        const products = productDB || [];
        const productList = products.map((p, i) =>
            `[${i}] ${p.name} (${p.spec}, ${p.price}원, ${p.taxFree ? '면세' : '과세'}, 이미지:${p.image || '📦'}, 최대DC:${p.maxDc || 0}%)`
        ).join('\n');

        const prompt = `당신은 매일유업 FS(Food Service) 영업사원을 위한 매장 분석 AI입니다.
아래 네이버 검색 결과를 분석하여 매장 특성을 파악하고, 매일유업 제품을 추천해주세요.

## 검색 매장: "${storeName}"

## 네이버 지역 검색 결과 (매장 정보)
${JSON.stringify(localSummary, null, 2)}

## 네이버 블로그 리뷰 요약
${JSON.stringify(blogSummary, null, 2)}

## 매일유업 제품 목록 (추천 대상)
${productList}

## 분석 요청
1. 리뷰와 매장 정보를 바탕으로 이 매장의 **핵심 키워드 태그** 3~5개를 추출하세요 (예: 가성비, 학생층, 프리미엄, 건강, 디저트카페 등)
2. 매장 특성에 대한 **영업 공략 포인트** 설명을 2~3문장으로 작성하세요. 중요한 부분은 <strong> 태그로, 매일유업 제품명은 <span style="color:#0071e3; font-weight:700;"> 태그로 감싸주세요.
3. 위 제품 목록에서 이 매장에 가장 적합한 **제품 2~3개**를 인덱스 번호로 추천하세요.

## 응답 형식 (반드시 아래 JSON 형식만 출력, 다른 텍스트 없이)
\`\`\`json
{
    "tags": ["키워드1", "키워드2", "키워드3"],
    "description": "HTML이 포함된 영업 공략 포인트 설명",
    "recommendedIndices": [0, 2]
}
\`\`\`

중요: 반드시 유효한 JSON만 출력하세요. 코드블록 마커는 포함해도 됩니다.
만약 검색 결과가 없거나 부족하면, 매장명에서 유추할 수 있는 정보를 바탕으로 최선의 추천을 해주세요.`;

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
                        maxOutputTokens: 1024,
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

        // ── 5. JSON 파싱 ──
        let jsonStr = rawText;
        const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
        if (jsonMatch) {
            jsonStr = jsonMatch[1];
        } else {
            const braceMatch = rawText.match(/\{[\s\S]*\}/);
            if (braceMatch) {
                jsonStr = braceMatch[0];
            }
        }

        const analysis = JSON.parse(jsonStr);

        // ── 6. 제품 인덱스 → 실제 제품 객체 매핑 ──
        const recommendedItems = (analysis.recommendedIndices || [])
            .filter(i => i >= 0 && i < products.length)
            .map(i => products[i]);

        return res.status(200).json({
            success: true,
            tags: analysis.tags || [],
            description: analysis.description || '',
            items: recommendedItems,
            naverInfo: {
                localResults: localSummary.length,
                blogResults: blogSummary.length
            }
        });

    } catch (error) {
        console.error('Analysis error:', error);
        return res.status(500).json({
            success: false,
            error: '분석 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
        });
    }
}
