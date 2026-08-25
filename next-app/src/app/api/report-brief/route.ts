import { createHash } from 'node:crypto';
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
  newPrior12?: number; // 직전 12개월 신규 (모멘텀 비교)
  momentum?: string;   // 가속|감속|보합
  churnPct?: number;   // 연 폐업률 (인허가 폐업 기준 하한선)
  operating: number;   // 운영 중(개업 후 미폐업)
  perCapita: number;   // 인구 1만명당 신규(12개월)
  dongNotes: string;   // 동별 주석 요약 (규칙 기반 생성)
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { scopeKey?: string; month?: string; mode?: string; units?: UnitMetric[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const { scopeKey, month, units } = body;
  const mode = body.mode === '전체' ? '전체' : '적격'; // 구버전 클라(mode 미전송)는 적격으로 간주
  if (!scopeKey || !month || !Array.isArray(units) || units.length === 0 || units.length > 40) {
    return NextResponse.json({ error: '잘못된 요청' }, { status: 400 });
  }
  // 입력 캡 — 자유 텍스트가 프롬프트로 직결되므로 길이 제한 (주입 여지 축소)
  for (const u of units) {
    if (typeof u.name !== 'string' || u.name.length > 40 || String(u.label).length > 8
      || typeof u.dongNotes !== 'string' || u.dongNotes.length > 250
      || ![u.popChg, u.pop, u.new12m, u.operating, u.perCapita].every(Number.isFinite)
      || (u.momentum !== undefined && String(u.momentum).length > 4)
      || (u.newPrior12 !== undefined && !Number.isFinite(u.newPrior12))
      || (u.churnPct !== undefined && !Number.isFinite(u.churnPct))) {
      return NextResponse.json({ error: '잘못된 지표 형식' }, { status: 400 });
    }
  }

  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !GEMINI_API_KEY) {
    return NextResponse.json({ error: '환경변수 누락' }, { status: 500 });
  }

  // 캐시 키 — sha256(지점|정렬된 스코프|월) 전체 해시(64자 고정).
  // ⚠️이전 hex 절단 방식은 한글 3개 시군구만 넘어도 월이 잘려 "영원히 캐시 적중" + 지점 간 충돌 가능(치명) — 해시로 교체.
  // 스코프는 정렬 후 조인: 클라가 popChg 순으로 보내와 월마다 순서가 바뀌어도 같은 범위면 같은 키.
  const bu = String(user.user_metadata?.business_unit || '');
  const scopeSorted = String(scopeKey).split(',').map((s) => s.trim()).sort().join(',');
  // v2: 모멘텀·폐업률 추가 + 업종 모드 분리 — 구 캐시(v1 키)와 자연 분리
  const cacheKey = `__report_brief_${createHash('sha256').update(`${bu}|${scopeSorted}|${month}|${mode}|v2`).digest('hex')}`;
  const sb = createServiceClient(SUPABASE_URL, SERVICE_KEY);
  const { data: cached } = await sb.from('naver_cache').select('local_data').eq('store_name', cacheKey).maybeSingle();
  if (cached?.local_data?.text) {
    return NextResponse.json({ text: cached.local_data.text, cached: true });
  }

  const lines = units.map((u) => {
    const mom = ['가속', '감속', '보합'].includes(String(u.momentum)) && Number.isFinite(u.newPrior12)
      ? ` · 신규 모멘텀 ${u.momentum}(직전12개월 ${u.newPrior12}곳→최근 ${u.new12m}곳)` : '';
    const churn = Number.isFinite(u.churnPct) ? ` · 연 폐업률 ${u.churnPct}%` : '';
    return `- ${u.name} [판정 ${u.label}] 인구 ${u.pop.toLocaleString()}명(4년 ${u.popChg > 0 ? '+' : ''}${u.popChg}%) · 12개월 신규 ${u.new12m}곳${mom} · 운영 중 ${u.operating}곳${churn} · 1만명당 신규 ${u.perCapita}곳${u.dongNotes ? ` · 주요 동: ${u.dongNotes}` : ''}`;
  }).join('\n');

  const modeLine = mode === '적격'
    ? '업종 범위: FS-적격 13업종(커피숍·제과점 등 유제품 소화 업태만 — 무인점포·기타 휴게음식점 제외).'
    : '업종 범위: 전체 수집 업종(무인점포 등 포함 — 상권 규모 관점).';

  const prompt = `당신은 식자재 B2B 영업(카페·베이커리 대상 유제품 납품) 조직의 상권 분석가다.
아래는 관할 시군구별 지표다 (기준: 최근 4년 주민등록 인구 변화 + 최근 12개월 개업).
${modeLine}

${lines}

판정 의미: 선점=인구 증가 대비 공급 얇음(개척 우선), 공략=인구·공급 모두 활발(신규 오픈 잡기), 방어=인구 감소 속 공급 지속(기존 거래처 이탈 방어), 관찰=뚜렷한 신호 없음.
모멘텀 의미: 가속=신규 개업이 직전 12개월보다 늘어나는 중(개척 타이밍), 감속=식는 중(선별 접근). 폐업률이 높은 곳은 신규 개척보다 기존 거래처 수성이 먼저다.

지침:
1. 위에 주어진 수치와 동 이름만 인용하라. 없는 숫자·지명·시설(지하철, 개발계획 등)을 지어내지 마라.
2. 영업 조직이 회의에서 그대로 읽을 수 있는 자연스러운 한국어 문단 2~3개로 작성 (전체 500자 이내).
3. 어디에 힘을 실을지(선점·공략, 특히 모멘텀 가속 지역)와 어디를 지킬지(방어·고폐업률)가 분명히 드러나게.`;

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
