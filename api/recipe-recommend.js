export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { storeName = '', tags = [], signatureMenus = [], productNames = [] } = req.body || {};

    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
        return res.status(500).json({ error: '환경변수 미설정' });
    }

    try {
        // 계절 계산
        const m = new Date().getMonth() + 1;
        const season = m >= 3 && m <= 5 ? '봄' : m >= 6 && m <= 8 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울';

        // 임베딩 텍스트: 업종태그 + 시그니처 재료 + 추천제품명 + 계절
        const embedParts = [
            ...tags,
            ...signatureMenus.map(sm => sm.ingredients).filter(Boolean),
            ...productNames,
            season,
            storeName
        ].filter(Boolean);
        const embedText = embedParts.join(' ');

        // 1. Gemini 임베딩
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
        if (!embedRes.ok) return res.status(500).json({ error: '임베딩 생성 실패' });

        const embedData = await embedRes.json();
        const vector = embedData.embedding?.values;
        if (!Array.isArray(vector) || vector.length !== 768) {
            return res.status(500).json({ error: '임베딩 벡터 오류' });
        }

        // 2. search_recipes RPC (2개)
        const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_recipes`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'apikey': SERVICE_KEY,
                'Authorization': `Bearer ${SERVICE_KEY}`
            },
            body: JSON.stringify({
                query_embedding: `[${vector.join(',')}]`,
                match_count: 2
            })
        });
        if (!rpcRes.ok) return res.status(500).json({ error: '레시피 검색 실패' });

        const matched = await rpcRes.json();
        if (!Array.isArray(matched) || matched.length === 0) {
            return res.status(200).json({ recipes: [] });
        }

        // 3. Gemini flash-lite로 reason 생성
        const recipeLines = matched.map(r =>
            `- ${r.name} (${r.category || '음료'}) / 자사제품: ${(r.main_products || []).join(', ')}`
        ).join('\n');

        const reasonRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [{
                            text: `매장 특성: ${tags.join(', ')} / 시그니처 재료: ${signatureMenus.map(sm => sm.ingredients).filter(Boolean).join(', ')} / 시즌: ${season}\n\n아래 레시피 각각이 이 매장에 왜 적합한지 25자 이내로 설명하라.\n${recipeLines}\n\nJSON 배열만 응답.`
                        }]
                    }],
                    generationConfig: {
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'ARRAY',
                            items: {
                                type: 'OBJECT',
                                properties: {
                                    name: { type: 'STRING' },
                                    reason: { type: 'STRING' }
                                },
                                required: ['name', 'reason']
                            }
                        }
                    }
                })
            }
        );

        let reasons = [];
        if (reasonRes.ok) {
            const reasonData = await reasonRes.json();
            const parts = reasonData.candidates?.[0]?.content?.parts || [];
            const rawText = (parts.find(p => !p.thought) || parts[0])?.text?.trim() || '[]';
            try { reasons = JSON.parse(rawText); } catch (_) {}
        }

        // 4. reason 병합
        const recipes = matched.map(r => ({
            name: r.name,
            category: r.category,
            pdf_url: r.pdf_url,
            main_products: r.main_products || [],
            reason: reasons.find(x => x.name === r.name)?.reason || ''
        }));

        return res.status(200).json({ recipes });

    } catch (err) {
        console.error('recipe-recommend error:', err);
        return res.status(500).json({ error: err.message });
    }
}
