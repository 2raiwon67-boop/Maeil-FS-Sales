import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

export async function POST(req: NextRequest) {
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: '환경변수 미설정' }, { status: 500 });
  }

  const { storeName = '', tags = [], signatureMenus = [], productNames = [] } = await req.json();

  try {
    const m = new Date().getMonth() + 1;
    const season = m >= 3 && m <= 5 ? '봄' : m >= 6 && m <= 8 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울';

    const embedParts = [
      ...tags,
      ...signatureMenus.map((sm: any) => sm.ingredients).filter(Boolean),
      ...productNames,
      season,
      storeName,
    ].filter(Boolean);
    const embedText = embedParts.join(' ');

    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'models/gemini-embedding-001',
          content: { parts: [{ text: embedText }] },
          outputDimensionality: 768,
        }),
      },
    );
    if (!embedRes.ok) return NextResponse.json({ error: '임베딩 생성 실패' }, { status: 500 });

    const embedData = await embedRes.json();
    const vector = embedData.embedding?.values;
    if (!Array.isArray(vector) || vector.length !== 768) {
      return NextResponse.json({ error: '임베딩 벡터 오류' }, { status: 500 });
    }

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ query_embedding: `[${vector.join(',')}]`, match_count: 2 }),
    });
    if (!rpcRes.ok) return NextResponse.json({ error: '레시피 검색 실패' }, { status: 500 });

    const matched = await rpcRes.json();
    if (!Array.isArray(matched) || matched.length === 0) {
      return NextResponse.json({ recipes: [] });
    }

    const recipeLines = matched
      .map((r: any) => `- ${r.name} (${r.category || '음료'}) / 자사제품: ${(r.main_products || []).join(', ')}`)
      .join('\n');

    const reasonRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: `매장 특성: ${tags.join(', ')} / 시그니처 재료: ${signatureMenus.map((sm: any) => sm.ingredients).filter(Boolean).join(', ')} / 시즌: ${season}\n\n아래 레시피 각각이 이 매장에 왜 적합한지 25자 이내로 설명하라.\n${recipeLines}\n\nJSON 배열만 응답.`,
                },
              ],
            },
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'ARRAY',
              items: {
                type: 'OBJECT',
                properties: { name: { type: 'STRING' }, reason: { type: 'STRING' } },
                required: ['name', 'reason'],
              },
            },
          },
        }),
      },
    );

    let reasons: any[] = [];
    if (reasonRes.ok) {
      const reasonData = await reasonRes.json();
      const parts = reasonData.candidates?.[0]?.content?.parts || [];
      const rawText = (parts.find((p: any) => !p.thought) || parts[0])?.text?.trim() || '[]';
      try {
        reasons = JSON.parse(rawText);
      } catch {}
    }

    const recipes = matched.map((r: any) => ({
      name: r.name,
      category: r.category,
      pdf_url: r.pdf_url,
      main_products: r.main_products || [],
      reason: reasons.find((x: any) => x.name === r.name)?.reason || '',
    }));

    return NextResponse.json({ recipes });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
