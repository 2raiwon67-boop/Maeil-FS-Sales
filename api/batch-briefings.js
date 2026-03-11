// api/batch-briefings.js
// 야간 배치: 전날 새 방문일지가 생긴 거래처 브리핑 갱신
// Vercel Cron: 매일 새벽 3시 KST = 18:00 UTC
//
// 처리 대상: 어제 이후 방문일지가 업로드된 거래처 중
//            ai_briefings 캐시의 last_visit_date보다 최신 데이터가 있는 거래처만
// 요금: Gemini 2.5 Flash 무료 (일 500건 한도, 10 RPM)
//       신규 사업부 온보딩 시 최근 6개월 이내만 처리 → 일 분산 전략 권장

export default async function handler(req, res) {
    // Vercel Cron 인증
    const authHeader = req.headers['authorization'];
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
    }

    const SUPABASE_URL    = process.env.SUPABASE_URL;
    const SERVICE_KEY     = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const GEMINI_API_KEY  = process.env.GEMINI_API_KEY;

    if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
        return res.status(500).json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY' });
    }

    const sbHeaders = {
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json'
    };

    // ── 1. 어제 이후 방문일지 조회 ──
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const cutoff = yesterday.toISOString().split('T')[0];

    const logsRes = await fetch(
        `${SUPABASE_URL}/rest/v1/visit_logs?visit_date=gte.${cutoff}&select=business_name,business_unit,visit_date,content,manager&order=visit_date.desc`,
        { headers: sbHeaders }
    );
    const recentLogs = await logsRes.json();
    if (!Array.isArray(recentLogs) || recentLogs.length === 0) {
        return res.status(200).json({ message: '처리할 새 방문일지 없음', total: 0 });
    }

    // ── 2. 영향받은 거래처 목록 추출 (중복 제거) ──
    const affectedKeys = new Set(
        recentLogs
            .filter(l => l.business_name)
            .map(l => `${l.business_name}__${l.business_unit || ''}`)
    );

    // ── 3. 기존 캐시 확인 ──
    const cacheRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ai_briefings?select=account_name,business_unit,last_visit_date,visit_count,generated_at`,
        { headers: sbHeaders }
    );
    const cacheData = await cacheRes.json();
    const cacheMap = new Map(
        (Array.isArray(cacheData) ? cacheData : [])
            .map(c => [`${c.account_name}__${c.business_unit || ''}`, {
                last_visit_date: c.last_visit_date,
                visit_count: c.visit_count || 0,
                generated_at: c.generated_at
            }])
    );

    // ── 4. 각 거래처의 전체 방문 기록 조회 & 갱신 필요 여부 판단 ──
    // 최근 6개월 데이터만 사용 (온보딩 대용량 방지)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthCutoff = sixMonthsAgo.toISOString().split('T')[0];

    const toProcess = [];

    for (const key of affectedKeys) {
        const [accountName, businessUnit] = key.split('__');
        if (!accountName) continue;

        const buFilter = businessUnit ? `&business_unit=eq.${encodeURIComponent(businessUnit)}` : '&business_unit=is.null';
        const allLogsRes = await fetch(
            `${SUPABASE_URL}/rest/v1/visit_logs?business_name=eq.${encodeURIComponent(accountName)}${buFilter}&visit_date=gte.${sixMonthCutoff}&select=visit_date,content,manager&order=visit_date.desc&limit=10`,
            { headers: sbHeaders }
        );
        if (!allLogsRes.ok) { results.failed++; continue; }
        const allLogs = await allLogsRes.json();
        if (!Array.isArray(allLogs) || allLogs.length === 0) continue;

        const lastVisitDate = allLogs[0].visit_date;
        const cache = cacheMap.get(key);

        // 캐시 없음 → 처리
        if (!cache) {
            toProcess.push({ accountName, businessUnit: businessUnit || null, visits: allLogs, lastVisitDate });
            continue;
        }

        // 새 방문일지 있음 OR 마지막 생성 7일 이상 경과 → 재생성
        // (allLogs가 limit=10이므로 visit_count 숫자 비교는 신뢰 불가 → 날짜 비교)
        const hasNewVisit = lastVisitDate !== cache.last_visit_date;
        const daysSince = (Date.now() - new Date(cache.generated_at).getTime()) / 86400000;
        if (hasNewVisit || daysSince >= 7) {
            toProcess.push({ accountName, businessUnit: businessUnit || null, visits: allLogs, lastVisitDate });
        }
    }

    if (toProcess.length === 0) {
        return res.status(200).json({ message: '모든 캐시 최신 상태', total: 0 });
    }

    // ── 5. 순차 처리 (10 RPM → 6초 간격) ──
    const results = { success: 0, failed: 0, total: toProcess.length };

    for (const acc of toProcess) {
        const visitText = acc.visits.map((v, i) =>
            `[${i + 1}차 · ${v.visit_date}] 담당: ${v.manager || '-'}\n${v.content || '(내용 없음)'}`
        ).join('\n\n');

        const prompt = `당신은 식품 FS 영업 전략 어시스턴트입니다.
"${acc.accountName}" 거래처 방문 기록 (최신순):

${visitText}

4줄 이내로 분석: 키맨 성향 / 반복 허들 / 다음 방문 추천 접근법`;

        try {
            const gemRes = await fetch(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-001:generateContent?key=${GEMINI_API_KEY}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: { temperature: 0.4, maxOutputTokens: 1024, topP: 0.9 }
                    })
                }
            );

            if (!gemRes.ok) { results.failed++; continue; }

            const data = await gemRes.json();
            const briefing = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
            if (!briefing) { results.failed++; continue; }

            const buFilter = acc.businessUnit ? `&business_unit=eq.${encodeURIComponent(acc.businessUnit)}` : '&business_unit=is.null';
            await fetch(`${SUPABASE_URL}/rest/v1/ai_briefings`, {
                method: 'POST',
                headers: { ...sbHeaders, 'Prefer': 'resolution=merge-duplicates' },
                body: JSON.stringify({
                    account_name: acc.accountName,
                    business_unit: acc.businessUnit,
                    briefing,
                    last_visit_date: acc.lastVisitDate,
                    visit_count: acc.visits.length,
                    generated_at: new Date().toISOString()
                })
            });
            results.success++;

        } catch (e) {
            results.failed++;
        }

        // Rate limit: 6초 대기 (10 RPM 준수)
        await new Promise(r => setTimeout(r, 6000));
    }

    // ── 6. Mother Brain 임베딩 배치 ──
    // embedding=null 이면서 개척완료/개척 완료/연결완료 포함 레코드 자동 처리
    const embedResults = { success: 0, failed: 0 };
    try {
        const orFilter = encodeURIComponent('(content.ilike.*개척완료*,content.ilike.*개척 완료*,content.ilike.*연결완료*)');
        const embedTargetRes = await fetch(
            `${SUPABASE_URL}/rest/v1/visit_logs?embedding=is.null&or=${orFilter}&select=id,business_name,trade_status,content&order=visit_date.desc&limit=50`,
            { headers: sbHeaders }
        );
        const embedTargets = embedTargetRes.ok ? await embedTargetRes.json() : [];

        for (const row of (Array.isArray(embedTargets) ? embedTargets : [])) {
            const text = [
                row.business_name || '',
                row.trade_status || '',
                (row.content || '').substring(0, 300)
            ].filter(Boolean).join(' | ');

            try {
                const embedRes = await fetch(
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
                if (!embedRes.ok) throw new Error(`embed ${embedRes.status}`);
                const embedData = await embedRes.json();
                const vector = embedData.embedding?.values;
                if (!Array.isArray(vector) || vector.length !== 768) throw new Error('차원 오류');

                const patchRes = await fetch(
                    `${SUPABASE_URL}/rest/v1/visit_logs?id=eq.${row.id}`,
                    {
                        method: 'PATCH',
                        headers: { ...sbHeaders, 'Prefer': 'return=minimal' },
                        body: JSON.stringify({ embedding: `[${vector.join(',')}]` })
                    }
                );
                if (!patchRes.ok) throw new Error(`patch ${patchRes.status}`);
                embedResults.success++;
            } catch (_e) {
                embedResults.failed++;
            }

            await new Promise(r => setTimeout(r, 50));
        }
    } catch (_e) {
        // 임베딩 배치 실패해도 브리핑 결과는 정상 반환
    }

    return res.status(200).json({ ...results, embed: embedResults });
}
