// api/generate-briefing.js
// 거래처 AI 브리핑 생성 (캐시 우선)
// POST { accountName, businessUnit, visits: [{date, content, manager, status}] }
//
// ── Supabase 테이블 생성 SQL (최초 1회 실행) ──
// CREATE TABLE ai_briefings (
//   id BIGSERIAL PRIMARY KEY,
//   account_name TEXT NOT NULL,
//   business_unit TEXT,
//   briefing TEXT NOT NULL,
//   last_visit_date TEXT,
//   visit_count INT,
//   generated_at TIMESTAMPTZ DEFAULT NOW(),
//   UNIQUE (account_name, business_unit)
// );

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
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { accountName, businessUnit, visits } = req.body || {};
    if (!accountName || !Array.isArray(visits) || visits.length === 0) {
        return res.status(400).json({ error: '거래처명과 방문 기록이 필요합니다.' });
    }

    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
        return res.status(500).json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY' });
    }

    const sbHeaders = {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };

    // ── 1. 캐시 확인 ──
    const lastVisitDate = visits[0]?.date || '';
    const buFilter = businessUnit ? `&business_unit=eq.${encodeURIComponent(businessUnit)}` : '&business_unit=is.null';

    try {
        const cacheRes = await fetch(
            `${SUPABASE_URL}/rest/v1/ai_briefings?account_name=eq.${encodeURIComponent(accountName)}${buFilter}&select=briefing,last_visit_date,visit_count,generated_at&limit=1`,
            { headers: sbHeaders }
        );
        const cacheData = await cacheRes.json();
        const cached = Array.isArray(cacheData) ? cacheData[0] : null;

        if (cached) {
            const newVisits = visits.length - (cached.visit_count || 0);
            const daysSince = (Date.now() - new Date(cached.generated_at).getTime()) / 86400000;
            // 새 방문 2건 미만이고 7일 이내면 캐시 반환
            if (newVisits < 2 && daysSince < 7) {
                return res.status(200).json({ briefing: cached.briefing, cached: true });
            }
        }

        // ── 2. Gemini 호출 (최근 10회) ──
        const recentVisits = visits.slice(0, 10);
        const visitText = recentVisits.map((v, i) =>
            `[${i + 1}차 방문 · ${v.date}] 담당: ${v.manager || '-'} / 상태: ${v.status || '-'}\n${v.content || '(내용 없음)'}`
        ).join('\n\n');

        // ── 개척완료 방문 추출 (성공 패턴 학습) ──
        const successVisits = visits.filter(v => v.content && /개척완료|개척 완료/.test(v.content));
        const successSection = successVisits.length > 0
            ? `\n[개척 성공 방문 기록]\n${successVisits.map(v =>
                `[${v.date}] 담당: ${v.manager || '-'}\n${v.content}`
              ).join('\n\n')}\n위 성공 패턴을 참고하여 오늘 방문 접근법을 추천하세요.\n`
            : '';

        // ── Mother Brain: 유사 거래처 성공 사례 검색 ──
        let motherBrainSection = '';
        try {
            // 현재 거래처 최근 방문 내용으로 임베딩 생성
            const queryText = [accountName, recentVisits[0]?.content || ''].join(' | ').substring(0, 300);
            const embedRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: 'models/gemini-embedding-001',
                        content: { parts: [{ text: queryText }] },
                        outputDimensionality: 768
                    })
                }
            );
            if (embedRes.ok) {
                const embedData = await embedRes.json();
                const vector = embedData.embedding?.values;
                if (Array.isArray(vector) && vector.length === 768) {
                    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_success_visits`, {
                        method: 'POST',
                        headers: { ...sbHeaders },
                        body: JSON.stringify({
                            query_embedding: `[${vector.join(',')}]`,
                            p_business_unit: businessUnit ?? null,
                            match_count: 2
                        })
                    });
                    if (rpcRes.ok) {
                        const similar = await rpcRes.json();
                        const filtered = (similar || []).filter(r => r.business_name !== accountName);
                        if (filtered.length > 0) {
                            const cases = filtered.map(r =>
                                `- ${r.business_name} (${r.visit_date}): ${(r.content || '').substring(0, 80)}`
                            ).join('\n');
                            motherBrainSection = `\n[유사 거래처 개척 성공 사례]\n${cases}\n`;
                        }
                    }
                }
            }
        } catch (_e) {
            // Mother Brain 실패해도 브리핑은 정상 생성
        }

        const prompt = `당신은 매일유업 FS 영업 전략 어시스턴트입니다.
아래는 "${accountName}" 거래처의 방문 기록입니다 (최신순):

${visitText}
${successSection}${motherBrainSection}
아래 3가지 항목을 각각 1~2문장으로 자연스럽게 작성하세요. 문장을 끊지 말고 완성된 문장으로 써주세요.

① 키맨/결정권자 정보 및 성향
② 반복되는 허들이나 장벽
③ 오늘 방문 시 추천 접근법 (유사 성공 사례가 있다면 구체적으로 참고)`;

        const geminiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 1024,
                        topP: 0.9,
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'object',
                            properties: { briefing: { type: 'string' } },
                            required: ['briefing']
                        }
                    }
                })
            }
        );

        if (!geminiRes.ok) {
            const err = await geminiRes.json();
            return res.status(geminiRes.status).json({ error: err.error?.message || 'Gemini API 오류' });
        }

        const geminiData = await geminiRes.json();
        const rawText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
        const briefing = rawText ? (JSON.parse(rawText).briefing || '') : '';
        if (!briefing) return res.status(500).json({ error: '브리핑 생성 실패' });

        // ── 3. 캐시 저장 (upsert) ──
        await fetch(`${SUPABASE_URL}/rest/v1/ai_briefings`, {
            method: 'POST',
            headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
            body: JSON.stringify({
                account_name: accountName,
                business_unit: businessUnit || null,
                briefing,
                last_visit_date: lastVisitDate,
                visit_count: visits.length,
                generated_at: new Date().toISOString()
            })
        });

        return res.status(200).json({ briefing, cached: false });

    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
}
