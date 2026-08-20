import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;

// 시장 분석(상권) 데이터 야간 갱신 Cron — 매일 03:00 KST(vercel.json `0 18 * * *`).
// 경기도·서울·인천·강원도의 market-stats를 최근 2개월치 save=true로 호출해
// market_snapshots(집계)·market_store_records(개별 매장)를 새로고침한다.
// + 인구 월 편승: 전월 주민등록 인구(population_stats)가 비어 있으면 1회 수집(멱등 —
//   행안부 공표가 매월 2일 09시 이후라 월초 며칠은 빈 응답 → 다음날 자동 재시도).

const MOIS_BASE = 'https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus';
const SIDO_CODES = ['1100000000', '2800000000', '4100000000', '5100000000']; // 서울·인천·경기·강원

interface MoisRow {
  stdgCd: string; stdgNm: string; sggNm: string; ctpvNm: string;
  statsYm: string; totNmprCnt: string; hhCnt: string;
}

async function moisCall(key: string, params: Record<string, string>): Promise<MoisRow[]> {
  const qs = new URLSearchParams({ serviceKey: key, type: 'JSON', regSeCd: '1', numOfRows: '1000', pageNo: '1', ...params });
  const r = await fetch(`${MOIS_BASE}?${qs}`, { signal: AbortSignal.timeout(25000) });
  const d = await r.json();
  if (d?.Response?.head?.resultCode !== '0') throw new Error(d?.Response?.head?.resultMsg || 'MOIS API 오류');
  const items = d.Response.items?.item || [];
  return Array.isArray(items) ? items : [items];
}

async function refreshPopulation(supabaseUrl: string, serviceKey: string) {
  const apiKey = process.env.PUBLIC_DATA_API_KEY;
  if (!apiKey) return { error: 'PUBLIC_DATA_API_KEY 미설정' };

  // 대상 = 전월 (KST)
  const kst = new Date(Date.now() + 9 * 3600 * 1000);
  kst.setUTCDate(1);
  kst.setUTCMonth(kst.getUTCMonth() - 1);
  const month = `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, '0')}`;
  const ym = month.replace('-', '');

  const sb = createClient(supabaseUrl, serviceKey);
  const { count } = await sb.from('population_stats').select('id', { count: 'exact', head: true }).eq('month', month);
  if (count && count > 0) return { month, skipped: '이미 수집됨' };

  // 시군구 leaf 목록 (구가 있는 시는 본청 제외) — DB 의존 없이 매회 API에서 재수집
  const sggs: { cd: string; name: string }[] = [];
  for (const sido of SIDO_CODES) {
    const items = await moisCall(apiKey, { lv: '2', stdgCd: sido, srchFrYm: ym, srchToYm: ym });
    const names = items.map((i) => i.sggNm);
    for (const i of items) {
      if (!names.some((n) => n !== i.sggNm && n.startsWith(i.sggNm + ' '))) sggs.push({ cd: i.stdgCd, name: i.sggNm });
    }
  }
  if (sggs.length === 0) return { month, saved: 0, note: '미공표(빈 응답) — 익일 재시도' };

  let saved = 0;
  const errors: string[] = [];
  for (let i = 0; i < sggs.length; i += 8) {
    await Promise.all(sggs.slice(i, i + 8).map(async (sgg) => {
      try {
        const rows = await moisCall(apiKey, { lv: '3', stdgCd: sgg.cd, srchFrYm: ym, srchToYm: ym });
        const recs = rows.filter((r) => r.stdgNm && r.totNmprCnt).map((r) => ({
          stdg_cd: r.stdgCd, sido: r.ctpvNm, sigungu: r.sggNm, dong: r.stdgNm,
          month, population: Number(r.totNmprCnt), households: Number(r.hhCnt) || null,
        }));
        if (recs.length) {
          const { error } = await sb.from('population_stats').upsert(recs, { onConflict: 'stdg_cd,month' });
          if (error) throw new Error(error.message);
          saved += recs.length;
        }
      } catch (e) {
        errors.push(`${sgg.name}: ${(e as Error).message}`);
      }
    }));
  }
  return { month, sigungu: sggs.length, saved, errors: errors.length ? errors.slice(0, 5) : undefined };
}
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 실제 저장은 내부 호출되는 market-stats가 수행 — 여기서는 필수 env만 조기 검증
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SERVICE_KEY) {
    return NextResponse.json({ error: '환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY' }, { status: 500 });
  }

  const marketResult: Record<string, unknown> = {};
  try {
    // ⚠️ req host 사용 금지: Vercel cron은 "배포 전용 URL"로 들어오는데, 그 호스트로 내부 재호출하면
    // Deployment Protection(SSO)에 막혀 조용히 실패함(2026-07 크론 장기 불발의 원인).
    // 항상 공개 프로덕션 도메인 기준으로 호출한다. (로컬 개발은 host가 localhost일 때만 예외)
    const reqHost = req.headers.get('host') || '';
    const base = reqHost.includes('localhost')
      ? `http://${reqHost}`
      : `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL || 'maeilfs-sales.vercel.app'}`;

    await Promise.all(
      ['경기도', '서울', '인천', '강원도'].map(async (sido) => {
        try {
          const url = `${base}/api/market-stats?sido=${encodeURIComponent(sido)}&months=2&save=true`;
          const r = await fetch(url, { headers: { Authorization: authHeader || '' } });
          const j = await r.json();
          marketResult[sido] = j.saved ?? { error: j.error };
        } catch (e) {
          marketResult[sido] = { error: (e as Error).message };
        }
      }),
    );
  } catch {}

  // 인구 월 편승 — 실패해도 시장 갱신 결과는 그대로 반환
  let population: unknown;
  try {
    population = await refreshPopulation(SUPABASE_URL, SERVICE_KEY);
  } catch (e) {
    population = { error: (e as Error).message };
  }

  return NextResponse.json({ market: marketResult, population });
}
