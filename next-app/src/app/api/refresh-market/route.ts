import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const maxDuration = 300;

// 시장 분석(상권) 데이터 야간 갱신 Cron — 매일 03:00 KST(vercel.json `0 18 * * *`).
// 경기도·서울·인천·강원도의 market-stats를 최근 2개월치 save=true로 호출해
// market_snapshots(집계)·market_store_records(개별 매장)를 새로고침한다.
// + 인구 월 편승: 전월 주민등록 인구(population_stats)가 비어 있으면 1회 수집(멱등 —
//   행안부 공표가 매월 2일 09시 이후라 월초 며칠은 빈 응답 → 다음날 자동 재시도).

const MOIS_BASE = 'https://apis.data.go.kr/1741000/stdgPpltnHhStus/selectStdgPpltnHhStus';
// 전국 17개 시도 (행안부 법정동 코드 앞 2자리 — 강원 51·전북 52는 특별자치도 출범 후 코드)
const SIDO_CODES = [
  '1100000000', '2600000000', '2700000000', '2800000000', '2900000000', '3000000000', '3100000000', '3600000000',
  '4100000000', '4300000000', '4400000000', '4600000000', '4700000000', '4800000000', '5000000000', '5100000000', '5200000000',
  '1200000000', // 전남광주통합특별시(2026-07 통합) — 구 코드(29·46)가 빈 응답이면 이 코드로 수집됨
]; // 서울·부산·대구·인천·광주·대전·울산·세종·경기·충북·충남·전남·경북·경남·제주·강원·전북(+통합시)

// 시장 데이터 야간 갱신 대상 — market-stats의 sido 표기(SIDO_SHORT 기준). 2026-09 전국 확장.
const MARKET_SIDOS = ['서울', '경기도', '인천', '강원도', '부산', '대구', '광주', '대전', '울산', '세종', '충청북도', '충청남도', '전라북도', '전라남도', '경상북도', '경상남도', '제주'];

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
  // ⚠️전체 스킵 가드 금지: 일부 시군구만 성공한 날이 있으면 count>0으로 영구 스킵되어
  // 실패분이 영원히 결손됨(체커 지적) — 시군구 단위로 존재 여부를 검사해 빠진 곳만 수집.

  // 시군구 leaf 목록 (구가 있는 시는 본청 제외) — DB 의존 없이 매회 API에서 재수집
  const sggs: { cd: string; name: string }[] = [];
  for (const sido of SIDO_CODES) {
    // 시도 하나가 NODATA(광주 29·전남 46은 통합 후 빈 응답)여도 나머지는 계속 — 예전엔 여기서 throw 돼 전체가 실패했음(2026-09-04)
    let items: MoisRow[] = [];
    try {
      items = await moisCall(apiKey, { lv: '2', stdgCd: sido, srchFrYm: ym, srchToYm: ym });
    } catch (e) {
      if (!String((e as Error).message).includes('NODATA')) throw e;
      continue;
    }
    const names = items.map((i) => i.sggNm);
    for (const i of items) {
      if (!names.some((n) => n !== i.sggNm && n.startsWith(i.sggNm + ' '))) sggs.push({ cd: i.stdgCd, name: i.sggNm || i.ctpvNm });
    }
  }
  if (sggs.length === 0) return { month, saved: 0, note: '미공표(빈 응답) — 익일 재시도' };

  let saved = 0;
  let skipped = 0;
  const errors: string[] = [];
  for (let i = 0; i < sggs.length; i += 8) {
    await Promise.all(sggs.slice(i, i + 8).map(async (sgg) => {
      try {
        // 이 시군구의 해당 월 데이터가 이미 있으면 스킵 (멱등 — 시군구 단위)
        const { count } = await sb.from('population_stats')
          .select('id', { count: 'exact', head: true })
          .eq('month', month).eq('sigungu', sgg.name);
        if (count && count > 0) { skipped++; return; }
        const rows = await moisCall(apiKey, { lv: '3', stdgCd: sgg.cd, srchFrYm: ym, srchToYm: ym });
        const recs = rows.filter((r) => r.stdgNm && r.totNmprCnt).map((r) => ({
          // 세종은 시군구 단계가 없어 sggNm이 비어 온다 → 시도명을 넣어 not-null 제약을 지킨다(뷰에서 '세종시'로 표기)
          stdg_cd: r.stdgCd, sido: r.ctpvNm, sigungu: r.sggNm || r.ctpvNm, dong: r.stdgNm,
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
  return { month, sigungu: sggs.length, skipped, saved, errors: errors.length ? errors.slice(0, 5) : undefined };
}
// ── 월간 데이터 품질 점검(매월 1일 KST) ─────────────────────────────────────
// 블랙리스트를 통과해 새로 쌓이는 허수 패턴(한 주소 다상호=행사장, 한 상호 다주소=순회 팝업 법인)을
// RPC market_quality_audit(최근 6개월 창)로 감지해 관리자 계정 헤더 벨에 통지한다.
// 수동 스캔 요청 없이도 신종 허수가 한 달 안에 눈에 띄게 하는 장치(2026-08-27 대청소 후속).
async function runQualityAudit(supabaseUrl: string, serviceKey: string, force = false) {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  if (!force && kstNow.getUTCDate() !== 1) return { skipped: '매월 1일에만 실행' };
  const sb = createClient(supabaseUrl, serviceKey);
  const from = new Date(kstNow);
  from.setUTCMonth(from.getUTCMonth() - 6);
  const fromMonth = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}`;
  const { data, error } = await sb.rpc('market_quality_audit', { p_from_month: fromMonth });
  if (error) return { error: error.message };
  const addrs = (data?.addrs ?? []) as { address: string; sigungu: string; names: number }[];
  const names = (data?.names ?? []) as { name: string; addrs: number }[];
  if (!addrs.length && !names.length) return { clean: true };

  const { data: users, error: uErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (uErr) return { error: uErr.message };
  const admins = users.users.filter((u) => (u.app_metadata as Record<string, unknown>)?.is_admin === true);
  if (!admins.length) return { admins: 0, addrs: addrs.length, names: names.length };

  const month = `${kstNow.getUTCFullYear()}-${String(kstNow.getUTCMonth() + 1).padStart(2, '0')}`;
  const top = addrs[0]
    ? `${addrs[0].sigungu} ${addrs[0].address.slice(0, 22)}…(상호 ${addrs[0].names}개)`
    : `${names[0].name}(주소 ${names[0].addrs}곳)`;
  const payload = admins.map((u) => ({
    user_id: u.id,
    dedupe_key: `quality_audit_${month}`,
    type: 'quality_audit',
    title: '시장 데이터 품질 점검',
    body: `허수 의심 주소 ${addrs.length}곳·상호 ${names.length}건. 예: ${top} — Claude에 '허수 재점검' 요청 권장`,
    link: '/discover',
    business_unit: ((u.app_metadata as Record<string, unknown>)?.business_unit as string) ?? null,
  }));
  await sb.from('notifications').upsert(payload, { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
  return { admins: admins.length, addrs: addrs.length, names: names.length };
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

  // audit_only=1: 품질 점검만 실행(테스트·수동 트리거용) — 무거운 시장 갱신·인구 수집은 건너뜀
  const auditOnly = req.nextUrl.searchParams.get('audit_only') === '1';
  const auditForce = auditOnly || req.nextUrl.searchParams.get('audit') === '1';
  if (auditOnly) {
    let quality: unknown;
    try {
      quality = await runQualityAudit(SUPABASE_URL, SERVICE_KEY, true);
    } catch (e) {
      quality = { error: (e as Error).message };
    }
    return NextResponse.json({ quality });
  }

  // 인구는 시장 갱신보다 먼저 — 시장 갱신(17개 시도)이 maxDuration 300s를 넘기면 함수가 끊겨
  // 뒤에 둔 인구 수집이 영영 안 돌던 문제(2026-09-04: 4개 시도 외 인구 결측 실측). 인구는 1~2분이면 끝난다.
  // population_only=1: 인구만 수집(수동 백필·테스트용).
  let population: unknown;
  try {
    population = await refreshPopulation(SUPABASE_URL, SERVICE_KEY);
  } catch (e) {
    population = { error: (e as Error).message };
  }
  if (req.nextUrl.searchParams.get('population_only') === '1') {
    return NextResponse.json({ population });
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

    // 17개 시도를 6개씩 병렬 — 한꺼번에 띄우면 공공 API 부하·maxDuration(300s) 초과 위험
    for (let i = 0; i < MARKET_SIDOS.length; i += 6) {
      await Promise.all(
        MARKET_SIDOS.slice(i, i + 6).map(async (sido) => {
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
    }
  } catch {}

  // 품질 점검 편승(매월 1일) — 실패해도 본 결과는 그대로 반환
  let quality: unknown;
  try {
    quality = await runQualityAudit(SUPABASE_URL, SERVICE_KEY, auditForce);
  } catch (e) {
    quality = { error: (e as Error).message };
  }

  return NextResponse.json({ market: marketResult, population, quality });
}
