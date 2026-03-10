// api/send-todo-alert.js
// Power Automate에서 매일 08:00 KST에 호출
// 이번달 방문일지 → Gemini TO-DO 추출 → 담당자별 구조화 응답
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const SUPABASE_URL   = process.env.SUPABASE_URL;
    const SERVICE_KEY    = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
        return res.status(500).json({ error: '환경변수 누락' });
    }

    const sbHeaders = {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };

    try {
        // ── 1. 이번달 방문일지 조회 ──
        const now = new Date();
        const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

        const logsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/visit_logs?visit_date=gte.${monthStart}&select=business_name,visit_date,manager,content,business_unit&order=visit_date.desc`,
            { headers: sbHeaders }
        );
        const logs = await logsRes.json();

        if (!Array.isArray(logs) || logs.length === 0) {
            return res.status(200).json({ items: [], message: '이번달 방문일지 없음' });
        }

        // ── 2. 담당자 이메일 조회 ──
        const mgrRes = await fetch(
            `${SUPABASE_URL}/rest/v1/managers?select=manager_name,email,region`,
            { headers: sbHeaders }
        );
        const managers = await mgrRes.json();
        const emailMap = {};
        (Array.isArray(managers) ? managers : []).forEach(m => {
            if (m.manager_name && m.email) emailMap[m.manager_name.trim()] = m.email.trim();
        });

        // ── 3. 내용 있는 방문일지만 필터 (15자 이상, 최대 50건) ──
        const validLogs = logs.filter(l => l.content && l.content.trim().length > 15 && l.manager).slice(0, 50);

        if (validLogs.length === 0) {
            return res.status(200).json({ items: [], message: '후속 조치 분석 대상 없음' });
        }

        // ── 4. Gemini TO-DO 추출 ──
        const visitLines = validLogs.map((v, i) =>
            `[${i + 1}] ${v.business_name || '-'} (${v.manager}, ${v.visit_date}) - ${v.content}`
        ).join('\n');

        const prompt = `영업 방문일지를 분석해서 후속 조치가 필요한 항목만 추출하라. 단순 방문 완료·특이사항 없는 기록은 제외.
n은 일지 번호, todo는 할일 한 문장, next는 다음방문일 또는 "미정".
일지:
${visitLines}`;

        const gemRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0,
                        maxOutputTokens: 1024,
                        responseMimeType: 'application/json',
                        responseSchema: {
                            type: 'object',
                            properties: {
                                items: {
                                    type: 'array',
                                    items: {
                                        type: 'object',
                                        properties: {
                                            n: { type: 'integer' },
                                            todo: { type: 'string' },
                                            next: { type: 'string' }
                                        },
                                        required: ['n', 'todo', 'next']
                                    }
                                }
                            },
                            required: ['items']
                        }
                    }
                })
            }
        );
        if (!gemRes.ok) return res.status(500).json({ error: 'Gemini API 오류' });

        const gemData = await gemRes.json();
        const rawText = gemData.candidates?.[0]?.content?.parts?.[0]?.text || '';
        let parsed;
        try { parsed = JSON.parse(rawText); }
        catch { return res.status(500).json({ error: 'JSON 파싱 실패' }); }

        const aiResults = parsed.items || [];

        // ── 5. AI 결과 → 담당자별 그룹화 ──
        const managerMap = {};

        aiResults.forEach(r => {
            const idx = ((r.n || 1) - 1);
            const visit = validLogs[idx];
            if (!visit) return;
            const summary = (r.todo || '').trim();
            if (!summary) return;

            const name = visit.manager;
            if (!managerMap[name]) managerMap[name] = [];
            managerMap[name].push({
                accountName: visit.business_name || '-',
                summary,
                nextVisit: (r.next || '미정').trim(),
                visitDate: visit.visit_date || ''
            });
        });

        // ── 6. 담당자별 응답 구성 ──
        const today = now.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' });

        const items = Object.entries(managerMap).map(([manager, todos]) => {
            const email = emailMap[manager] || null;
            const lines = todos.map(t =>
                `🏪 ${t.accountName}\n   └ ${t.summary}\n   📅 다음방문: ${t.nextVisit}`
            ).join('\n\n');

            const message = `📋 오늘의 방문 TO-DO (${today})\n${'─'.repeat(28)}\n\n${lines}\n\n총 ${todos.length}건의 후속 조치가 있습니다.`;

            return { manager, email, todos, message };
        });

        return res.status(200).json({ items, date: today, total: items.reduce((s, i) => s + i.todos.length, 0) });

    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
}
