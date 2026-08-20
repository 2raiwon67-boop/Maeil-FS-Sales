import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createServiceClient } from '@supabase/supabase-js';

// 보고작성 AI 분석 — 클라가 계산한 시군구 지표를 받아 Gemini가 해석 서술을 생성.
// 환각 방지: 원시 데이터가 아닌 계산된 지표만 전달 + "주어진 수치만 인용" 제약.
// 캐시: naver_cache 특수 행(__report_brief_{키}) — 같은 범위·같은 월은 재생성하지 않음(비용·속도).

export const maxDuration = 30;

interface UnitMetric {
  name: string;
  label: string;       // 선점|공략|방어|관찰
  popChg: number;      // 인구 증감 % (4년)
  pop: number;         // 최신 인구
  new12m: number;      // 12개월 신규 개업
  operating: number;   // 운영 중(개업 후 미폐업)
  perCapita: number;   // 인구 1만명당 신규(12개월)
  dongNotes: string;   // 동별 주석 요약 (규칙 기반 생성)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { scopeKey?: string; month?: string; units?: UnitMetric[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const { scopeKey, month, units } = body;
  if (!scopeKey || !month || !Array.isArray(units) || units.length === 0 || units.length > 40) {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
    return NextResponse.json({ error: '환경변수 누락' }, { status: 500 });
  }

  // 캐시 키 — 범위+월 (한글 스코프는 hex로 안전 인코딩, 컬럼 길이 보호를 위해 64자 캡)
  const cacheKey = `__report_brief_${Buffer.from(`${scopeKey}|${month}`).toString('hex').slice(0, 64)}`;
  const sb = createServiceClient(SUPABASE_URL, SERVICE_KEY);
  const { data: cached } = await sb.from('naver_cache').select('local_data').eq('store_name', cacheKey).maybeSingle();
  if (cached?.local_data?.text) {
    return NextResponse.json({ text: cached.local_data.text, cached: true });
  }

  const lines = units.map((u) =>
    `- ${u.name} [판정 ${u.label}] 인구 ${u.pop.toLocaleString()}명(4년 ${u.popChg > 0 ? '+' : ''}${u.popChg}%) · 12개월 신규 ${u.new12m}곳 · 운영 중 ${u.operating}곳 · 1만명당 신규 ${u.perCapita}곳${u.dongNotes ? ` · 주요 동: ${u.dongNotes}` : ''}`,
  ).join('\n');

  const prompt = `당신은 식자재 B2B 영업(카페·베이커리 대상 유제품 납품) 조직의 상권 분석가다.
아래는 관할 시군구별 지표다 (기준: 최근 4년 주민등록 인구 변화 + 최근 12개월 타겟업종 개업).

${lines}

판정 의미: 선점=인구 증가 대비 공급 얇음(개척 우선), 공략=인구·공급 모두 활발(신규 오픈 잡기), 방어=인구 감소 속 공급 지속(기존 거래처 이탈 방어), 관찰=뚜렷한 신호 없음.

지침:
1. 위에 주어진 수치와 동 이름만 인용하라. 없는 숫자·지명·시설(지하철, 개발계획 등)을 지어내지 마라.
2. 영업 조직이 회의에서 그대로 읽을 수 있는 자연스러운 한국어 문단 2~3개로 작성 (전체 500자 이내).
3. 어디에 힘을 실을지(선점·공략)와 어디를 지킬지(방어)가 분명히 드러나게.`;

  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
        signal: AbortSignal.timeout(25000),
      },
    );
    if (!r.ok) throw new Error(`Gemini ${r.status}`);
    const d = await r.json();
    const parts = d.candidates?.[0]?.content?.parts || [];
    const raw = (parts.find((p: { thought?: boolean }) => !p.thought) || parts[0])?.text || '';
    const text = String(JSON.parse(raw)?.text || '').trim();
    if (!text) throw new Error('빈 응답');

    await sb.from('naver_cache').upsert(
      { store_name: cacheKey, local_data: { text }, cached_at: new Date().toISOString() },
      { onConflict: 'store_name' },
    );
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: 'AI 분석 생성 실패: ' + (e as Error).message }, { status: 502 });
  }
}
