import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60;
import proj4 from 'proj4';

const EPSG5174 =
  '+proj=tmerc +lat_0=38 +lon_0=127.0028902777778 +k=1 +x_0=200000 +y_0=500000 +ellps=bessel +units=m +no_defs +towgs84=-115.80,474.99,674.11,1.16,-2.31,-1.63,6.43';

const ENDPOINTS: Record<string, string> = {
  general_restaurants: 'https://apis.data.go.kr/1741000/general_restaurants/info',
  rest_cafes: 'https://apis.data.go.kr/1741000/rest_cafes/info',
  bakeries: 'https://apis.data.go.kr/1741000/bakeries/info',
};

const EXCLUDE_KEYWORDS = [
  '편의점', 'GS25', 'CU', '세븐일레븐', '이마트24', '찐빵', '육회', '고기', '홍어', '회', '씨유', '포차', '한끼',
  'PC', '피시', '게임', '당구', '만화', '노래', '제육', '곰탕', '숯불', '베트남', '동남아', '쌀국수', '조건부', '펍',
  '무인', '자판기', '아이스크림', '밀키트', '한시적', '피씨', '핫도그', '분식', '떡볶이', '치킨', '튀김', '어묵', '오뎅', '브뤼셀프라이', '피자', '7080라이브',
  '구내식당', '급식', '장례', '매점', '휴게소', '반점', '고로케', '초밥', '써브웨이', '홍콩반점', '삼겹', '갈비', '찜', '밥상', '롯데리아', '맥도날드', '버거킹', '맘스터치',
  '곱창', '닭', '이자카야', '라멘', '라면', '우동', '스시', '카츠', '돈까스', '야끼',
];

const SIDO_SHORT: Record<string, string> = {
  서울특별시: '서울', 서울시: '서울', 서울: '서울',
  부산광역시: '부산', 부산시: '부산', 부산: '부산',
  대구광역시: '대구', 대구시: '대구', 대구: '대구',
  인천광역시: '인천', 인천시: '인천', 인천: '인천',
  광주광역시: '광주', 광주시: '광주', 광주: '광주',
  대전광역시: '대전', 대전시: '대전', 대전: '대전',
  울산광역시: '울산', 울산시: '울산', 울산: '울산',
  세종특별자치시: '세종', 세종시: '세종', 세종: '세종',
  제주특별자치도: '제주', 제주도: '제주', 제주: '제주',
  경기도: '경기도', 경기: '경기도',
  강원도: '강원도', 강원특별자치도: '강원도',
  충청북도: '충청북도', 충북: '충청북도',
  충청남도: '충청남도', 충남: '충청남도',
  전라북도: '전라북도', 전북: '전라북도', 전북특별자치도: '전라북도',
  전라남도: '전라남도', 전남: '전라남도',
  경상북도: '경상북도', 경북: '경상북도',
  경상남도: '경상남도', 경남: '경상남도',
};

function toShort(sido: string | null | undefined): string {
  return SIDO_SHORT[sido?.trim() ?? ''] || sido?.trim() || '';
}

function buildQS(params: Record<string, string | undefined | null>): string {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join('&');
}

function getBizName(item: any): string {
  return (item.BPLC_NM || item.BPLCNM || item.BIZPLC_NM || item.BIZ_PLCE_NM || '').toString().trim();
}

function isTarget(item: any): boolean {
  const bizName = getBizName(item);
  if (EXCLUDE_KEYWORDS.some((kw) => bizName.includes(kw))) return false;
  return true;
}

async function fetchPage(type: string, apiKey: string, sido: string, pageNo: number, mode: string, start: string, end: string) {
  const isNew = mode === 'new';
  const qs = buildQS({
    serviceKey: apiKey,
    pageNo: String(pageNo),
    numOfRows: '100',
    returnType: 'json',
    ...(isNew
      ? { 'cond[LCPMT_YMD::GTE]': start, 'cond[LCPMT_YMD::LTE]': end, 'cond[SALS_STTS_CD::EQ]': '01' }
      : { 'cond[CLSBIZ_YMD::GTE]': start, 'cond[CLSBIZ_YMD::LTE]': end }),
    'cond[LOTNO_ADDR::LIKE]': sido,
  });

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 9000);
  try {
    const res = await fetch(`${ENDPOINTS[type]}?${qs}`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return { items: [] as any[], totalCount: 0 };

    const json = await res.json();
    const body = json?.response?.body ?? json?.body ?? json ?? {};
    const raw = body?.items?.item ?? body?.items ?? body?.data ?? [];
    const items = Array.isArray(raw) ? raw : raw ? [raw] : [];
    const totalCount = parseInt(body?.totalCount ?? items.length, 10) || 0;
    return { items, totalCount };
  } catch {
    clearTimeout(timer);
    return { items: [] as any[], totalCount: 0 };
  }
}

async function fetchAll(type: string, apiKey: string, sido: string, mode: string, start: string, end: string) {
  const first = await fetchPage(type, apiKey, sido, 1, mode, start, end);
  const items = [...first.items];
  const pages = Math.min(Math.ceil((first.totalCount || 0) / 100), 20);

  if (pages > 1) {
    const rest = await Promise.all(Array.from({ length: pages - 1 }, (_, i) => fetchPage(type, apiKey, sido, i + 2, mode, start, end)));
    rest.forEach((r) => items.push(...r.items));
  }

  return { items, totalCount: first.totalCount };
}

function extract(item: any, mode: string, expectedSido: string) {
  const addr = (item.LOTNO_ADDR || '').toString().trim();
  const tokens = addr.split(' ').filter(Boolean);

  if (expectedSido) {
    const addrSido = toShort(tokens[0] || '');
    if (addrSido && addrSido !== expectedSido) return { sigungu: '', month: '' };
  }

  const sigungu = tokens[1] || '';
  const raw = (mode === 'new' ? item.LCPMT_YMD : item.CLSBIZ_YMD || item.DCB_YMD)?.toString().replace(/\D/g, '') || '';
  const month = raw.length >= 6 ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}` : '';

  return { sigungu, month };
}

function extractCoords(item: any): { lat: number | null; lng: number | null } {
  let lat = parseFloat(item.LAT_EPSG4326 ?? item.WGS84_LAT);
  let lng = parseFloat(item.LOT_EPSG4326 ?? item.LOT_EPST4326 ?? item.WGS84_LOT);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    const x = parseFloat(item.CRD_INFO_X);
    const y = parseFloat(item.CRD_INFO_Y);
    if (Number.isFinite(x) && Number.isFinite(y) && x > 0 && y > 0) {
      try {
        [lng, lat] = proj4(EPSG5174, 'EPSG:4326', [x, y]);
      } catch {
        return { lat: null, lng: null };
      }
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { lat: null, lng: null };
  if (lat < 33 || lat > 39 || lng < 124 || lng > 132) return { lat: null, lng: null };
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

async function saveToSupabase(sidoShort: string, detail: Record<string, Record<string, { new: number; closed: number }>>, storeRecords: any[]) {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return { saved: 0, error: 'env 누락' };

  const commonHeaders: Record<string, string> = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
    Prefer: 'resolution=merge-duplicates,return=minimal',
  };

  const snapRows: any[] = [];
  for (const [sigungu, months] of Object.entries(detail)) {
    for (const [month, counts] of Object.entries(months)) {
      snapRows.push({
        sido: sidoShort,
        sigungu,
        month,
        new_count: counts.new || 0,
        closed_count: counts.closed || 0,
        updated_at: new Date().toISOString(),
      });
    }
  }

  let saved = 0;
  let lastError: string | null = null;

  for (let i = 0; i < snapRows.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/market_snapshots?on_conflict=sido,sigungu,month`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(snapRows.slice(i, i + 100)),
    });
    if (res.ok) saved += Math.min(100, snapRows.length - i);
    else {
      const t = await res.text().catch(() => String(res.status));
      lastError = `snapshots HTTP ${res.status}: ${t.slice(0, 200)}`;
    }
  }

  const storeMap = new Map<string, any>();
  for (const s of storeRecords) {
    const k = `${s.sido}|${s.sigungu}|${s.month}|${s.name}|${s.status}`;
    const prev = storeMap.get(k);
    if (!prev || (s.lat != null && prev.lat == null)) storeMap.set(k, s);
  }
  const uniqueStores = [...storeMap.values()];

  let storesSaved = 0;
  for (let i = 0; i < uniqueStores.length; i += 100) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/market_store_records?on_conflict=sido,sigungu,month,name,status`, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(uniqueStores.slice(i, i + 100)),
    });
    if (res.ok) storesSaved += Math.min(100, uniqueStores.length - i);
    else {
      const t = await res.text().catch(() => String(res.status));
      lastError = `stores HTTP ${res.status}: ${t.slice(0, 200)}`;
    }
  }

  return { saved, storesSaved, ...(lastError ? { error: lastError } : {}) };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const API_KEY = process.env.PUBLIC_DATA_API_KEY;
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const sido = searchParams.get('sido');
  const months = searchParams.get('months') || '12';
  const startYM = searchParams.get('start') || ''; // YYYYMM — 명시 윈도우(과거월 백필, 24개월 캡 우회)
  const endYM = searchParams.get('end') || '';      // YYYYMM
  const save = searchParams.get('save') || '';
  const detailMode = searchParams.get('detail') || '';
  const sigungu = searchParams.get('sigungu') || '';
  const month = searchParams.get('month') || '';

  if (detailMode === 'true') {
    if (!sido || !sigungu) {
      return NextResponse.json({ success: false, error: 'sido, sigungu 파라미터 필요' }, { status: 400 });
    }
    if (!SUPABASE_URL || !ANON_KEY) {
      return NextResponse.json({ success: false, error: 'Supabase env 누락' }, { status: 500 });
    }
    try {
      let url =
        `${SUPABASE_URL}/rest/v1/market_store_records` +
        `?sido=eq.${encodeURIComponent(toShort(sido))}` +
        `&sigungu=eq.${encodeURIComponent(sigungu)}` +
        `&select=name,category,area_m2,pyeong,address,status,license_date,lat,lng` +
        `&order=license_date.desc`;
      if (month) url += `&month=eq.${encodeURIComponent(month)}`;

      const r = await fetch(url, {
        headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
      });
      if (!r.ok) throw new Error(`Supabase HTTP ${r.status}`);
      const stores = await r.json();
      const summary = stores.reduce(
        (a: any, s: any) => {
          if (s.status === 'new') a.new++;
          else a.closed++;
          return a;
        },
        { new: 0, closed: 0 },
      );
      return NextResponse.json({ success: true, sido: toShort(sido), sigungu, month: month || null, summary, stores });
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e.message }, { status: 500 });
    }
  }

  if (!API_KEY) return NextResponse.json({ success: false, error: 'API key missing' }, { status: 500 });
  if (!sido) return NextResponse.json({ success: false, error: 'sido 파라미터 필요' }, { status: 400 });

  const sidoShort = toShort(sido);
  const doSave = save === 'true';

  const now = new Date();
  const fmt = (d: Date) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;

  // 윈도우 결정: start/end(YYYYMM) 명시 시 그 구간(과거 포함), 아니면 "오늘 기준 N개월"
  const ymRe = /^\d{6}$/;
  let startStr: string, endStr: string, monthList: string[];
  if (ymRe.test(startYM) && ymRe.test(endYM)) {
    const ey = parseInt(endYM.slice(0, 4)), em = parseInt(endYM.slice(4, 6));
    const lastDay = new Date(ey, em, 0).getDate(); // 해당 월의 실제 말일 (잘못된 31일 방지)
    startStr = `${startYM}01`;
    endStr = `${endYM}${String(lastDay).padStart(2, '0')}`;
    monthList = [];
    let y = parseInt(startYM.slice(0, 4)), m = parseInt(startYM.slice(4, 6));
    while (y < ey || (y === ey && m <= em)) {
      monthList.push(`${y}-${String(m).padStart(2, '0')}`);
      m++; if (m > 12) { m = 1; y++; }
      if (monthList.length > 60) break; // 안전장치
    }
  } else {
    const monthCount = Math.min(Math.max(parseInt(months) || 12, 1), 24);
    startStr = fmt(new Date(now.getFullYear(), now.getMonth() - monthCount, 1));
    endStr = fmt(now);
    monthList = Array.from({ length: monthCount }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() - (monthCount - 1 - i), 1);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });
  }

  try {
    const types = Object.keys(ENDPOINTS);

    const [newRes, closedRes] = await Promise.all([
      Promise.all(types.map((t) => fetchAll(t, API_KEY, sidoShort, 'new', startStr, endStr))),
      Promise.all(types.map((t) => fetchAll(t, API_KEY, sidoShort, 'closed', startStr, endStr))),
    ]);

    const monthly: Record<string, { new: number; closed: number }> = {};
    const regions: Record<string, { new: number; closed: number }> = {};
    const detailData: Record<string, Record<string, { new: number; closed: number }>> = {};
    const storeRecords: any[] = [];

    function tally(results: { items: any[] }[], mode: string) {
      results.forEach(({ items }) => {
        items.forEach((item) => {
          if (!isTarget(item)) return;
          const { sigungu: sg, month: mo } = extract(item, mode, sidoShort);
          if (!mo || !sg) return;

          const key = mode === 'new' ? 'new' : 'closed';

          if (!monthly[mo]) monthly[mo] = { new: 0, closed: 0 };
          (monthly[mo] as any)[key]++;

          if (!regions[sg]) regions[sg] = { new: 0, closed: 0 };
          (regions[sg] as any)[key]++;

          if (!detailData[sg]) detailData[sg] = {};
          if (!detailData[sg][mo]) detailData[sg][mo] = { new: 0, closed: 0 };
          (detailData[sg][mo] as any)[key]++;

          const name = getBizName(item);
          if (!name) return;
          const areaM2 = parseFloat((item.LCTN_AREA || item.FCLT_TOTAL_SCL || '0').toString().replace(/,/g, '')) || 0;
          const dateRaw = (mode === 'new' ? item.LCPMT_YMD : item.CLSBIZ_YMD || item.DCB_YMD)?.toString().replace(/\D/g, '') || '';
          const { lat, lng } = extractCoords(item);
          storeRecords.push({
            sido: sidoShort,
            sigungu: sg,
            month: mo,
            name,
            category: (item.UPTAE_NM || item.BZSTAT_SE_NM || '').trim(),
            area_m2: areaM2 > 0 ? areaM2 : null,
            pyeong: areaM2 > 0 ? Math.round((areaM2 / 3.3) * 10) / 10 : null,
            address: (item.ROAD_NM_ADDR || item.LOTNO_ADDR || '').trim(),
            status: key,
            license_date: dateRaw.length >= 8 ? `${dateRaw.slice(0, 4)}-${dateRaw.slice(4, 6)}-${dateRaw.slice(6, 8)}` : null,
            lat,
            lng,
            updated_at: new Date().toISOString(),
          });
        });
      });
    }

    tally(newRes, 'new');
    tally(closedRes, 'closed');

    const monthlyArr = monthList.map((m) => ({
      month: m,
      new: monthly[m]?.new || 0,
      closed: monthly[m]?.closed || 0,
      net: (monthly[m]?.new || 0) - (monthly[m]?.closed || 0),
    }));

    const regionsArr = Object.entries(regions)
      .map(([region, { new: n, closed: c }]) => ({
        region,
        new: n,
        closed: c,
        net: n - c,
        netRate: n > 0 ? Math.round(((n - c) / n) * 100) : 0,
      }))
      .filter((r) => r.region && r.new + r.closed > 0)
      .sort((a, b) => b.new - a.new);

    const totalNew = monthlyArr.reduce((s, m) => s + m.new, 0);
    const totalClosed = monthlyArr.reduce((s, m) => s + m.closed, 0);

    let saveResult = null;
    if (doSave) {
      saveResult = await saveToSupabase(sidoShort, detailData, storeRecords);
    }

    return NextResponse.json({
      success: true,
      sido: sidoShort,
      period: { start: startStr.slice(0, 6), end: endStr.slice(0, 6), months: monthList.length },
      summary: { totalNew, totalClosed, net: totalNew - totalClosed },
      monthly: monthlyArr,
      regions: regionsArr,
      ...(doSave ? { saved: saveResult } : {}),
    });
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e.message }, { status: 500 });
  }
}
