// 방문 전 액션 코칭 — 매장 업종/거래상태/최근 방문이력 + recipes RAG 근거로
// '바로 실행할' 다음 액션 / 추천 제품 / 예상 거절·반박을 생성.
import { NextRequest, NextResponse } from 'next/server';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY!;

interface RecentVisit { visit_date?: string; outcome?: string; reject_reason?: string; content?: string }

export async function POST(req: NextRequest) {
  if (!GEMINI_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: '환경변수 미설정' }, { status: 500 });
  }

  const {
    businessName = '',
    businessType = '',
    tradeStatus = '',
    recentVisits = [],
  }: { businessName?: string; businessType?: string; tradeStatus?: string; recentVisits?: RecentVisit[] } = await req.json();

  try {
    const m = new Date().getMonth() + 1;
    const season = m >= 3 && m <= 5 ? '봄' : m >= 6 && m <= 8 ? '여름' : m >= 9 && m <= 11 ? '가을' : '겨울';
    const lastReject = recentVisits.find((v) => v.reject_reason)?.reject_reason || '';

    // 1) 매장 맥락으로 임베딩 → recipes RAG (제품/레시피 근거)
    const embedText = [businessType, businessName, lastReject, season].filter(Boolean).join(' ') || 'FS 음료 디저트';
    const embedRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'models/gemini-embedding-001', content: { parts: [{ text: embedText }] }, outputDimensionality: 768 }),
      },
    );
    if (!embedRes.ok) return NextResponse.json({ error: '임베딩 생성 실패' }, { status: 500 });
    const embedData = await embedRes.json();
    const vector = embedData.embedding?.values;
    if (!Array.isArray(vector) || vector.length !== 768) return NextResponse.json({ error: '임베딩 벡터 오류' }, { status: 500 });

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/search_recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ query_embedding: `[${vector.join(',')}]`, match_count: 4 }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matched: any[] = rpcRes.ok ? await rpcRes.json() : [];
    const recipeLines = (Array.isArray(matched) ? matched : [])
      .map((r) => `- ${r.name} (${r.category || '음료'}) / 자사제품: ${(r.main_products || []).join(', ')}`)
      .join('\n') || '(추천 후보 없음)';

    const historyText = recentVisits.length
      ? recentVisits.slice(0, 5).map((v) =>
          `[${v.visit_date || '-'}] 결과:${v.outcome || '-'}${v.reject_reason ? ` 거절사유:${v.reject_reason}` : ''}${v.content ? ` / ${v.content.slice(0, 60)}` : ''}`,
        ).join('\n')
      : '없음 (첫 방문 또는 이력 없음)';

    const prompt = `당신은 매일유업 FS(푸드서비스) 영업 코치입니다. 아래 매장을 방문하기 직전의 영업사원에게 '바로 실행할 수 있는' 코칭을 주세요.

[매장]
- 이름: ${businessName || '미상'}
- 업종/업태: ${businessType || '미상'}
- 현재 거래상태: ${tradeStatus || '미상'}

[최근 방문 이력(최신순)]
${historyText}

[이 매장에 어울릴 만한 자사 레시피/제품 후보(유사도 상위)]
${recipeLines}

규칙: 위 레시피·제품과 매장 특성·이력에 근거할 것. 근거 없는 일반론·과장 금지. 거절사유가 있으면 그걸 정조준할 것.
JSON으로만 답하세요.`;

    const genRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: {
              type: 'OBJECT',
              properties: {
                actions: { type: 'ARRAY', items: { type: 'STRING' }, description: '다음 방문에서 바로 할 구체 행동 1~2개, 각 40자 이내' },
                products: {
                  type: 'ARRAY',
                  items: {
                    type: 'OBJECT',
                    properties: { name: { type: 'STRING' }, why: { type: 'STRING', description: '이 매장에 맞는 이유 25자 이내' } },
                    required: ['name', 'why'],
                  },
                  description: '추천 제품/샘플 1~3개',
                },
                objection: {
                  type: 'OBJECT',
                  properties: { expected: { type: 'STRING' }, rebuttal: { type: 'STRING' } },
                  required: ['expected', 'rebuttal'],
                },
              },
              required: ['actions', 'products', 'objection'],
            },
          },
        }),
      },
    );
    if (!genRes.ok) return NextResponse.json({ error: '코칭 생성 실패' }, { status: 500 });
    const genData = await genRes.json();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts = genData.candidates?.[0]?.content?.parts || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawText = (parts.find((p: any) => !p.thought) || parts[0])?.text?.trim() || '{}';
    let coaching;
    try { coaching = JSON.parse(rawText); } catch { return NextResponse.json({ error: '코칭 파싱 실패' }, { status: 500 }); }

    return NextResponse.json({ coaching, sources: (Array.isArray(matched) ? matched : []).map((r) => r.name) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
