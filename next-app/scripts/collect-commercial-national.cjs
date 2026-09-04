// 소진공 상가(상권)정보 전국 집계 수집 → commercial_sigungu_stats / commercial_adong_stats
//
// 왜 집계만 저장하나: 전국 상가는 약 277만 건이라 원본을 그대로 넣으면 1GB가 넘는데, Supabase 무료 플랜 한도는 500MB.
// 상권 모드가 쓰는 건 시군구·행정동별 업종 개수뿐이라, 이 스크립트가 API를 페이지 단위로 읽으면서 메모리에서
// 바로 세고 결과(시군구 약 250행, 행정동 약 3,500행)만 저장한다. 원본 저장 없음.
//
// 사용:  node scripts/collect-commercial-national.cjs            (전국 16개 시도 코드 순서대로)
//        node scripts/collect-commercial-national.cjs 41 11      (특정 시도 코드만)
// 재실행: 시도 단위로 체크포인트(.done 파일)를 남기므로 중단돼도 다시 실행하면 안 한 시도부터 이어감.
//        처음부터 다시 하려면 .done 파일을 지우면 된다.
// 호출량: 1페이지 1,000건 → 전국 약 2,800회 (공공데이터포털 일일 한도 10,000회 안).
const fs = require('fs');
const path = require('path');

const APP = path.resolve(__dirname, '..');
const { createClient } = require(path.join(APP, 'node_modules/@supabase/supabase-js'));
const env = Object.fromEntries(
  fs.readFileSync(path.join(APP, '.env.local'), 'utf8').split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const KEY = env.PUBLIC_DATA_API_KEY;
const BASE = 'https://apis.data.go.kr/B553077/api/open/sdsc2';
const DONE_FILE = path.join(__dirname, '.commercial-national.done');

// 행안부 시도 코드 (2026-09 기준). 광주+전남은 2026-07 통합돼 코드 12 하나로 내려오고, 아래 toSido()에서 둘로 나눈다.
const SIDO_CODES = ['11', '26', '27', '28', '30', '31', '36', '41', '51', '43', '44', '52', '12', '47', '48', '50'];

// API의 시도명 → DB(market_store_records)와 같은 약칭
const SIDO_NAME = {
  서울특별시: '서울', 부산광역시: '부산', 대구광역시: '대구', 인천광역시: '인천', 광주광역시: '광주', 대전광역시: '대전',
  울산광역시: '울산', 세종특별자치시: '세종', 경기도: '경기도', 강원특별자치도: '강원도', 충청북도: '충청북도', 충청남도: '충청남도',
  전북특별자치도: '전라북도', 전라남도: '전라남도', 경상북도: '경상북도', 경상남도: '경상남도', 제주특별자치도: '제주',
};
const GWANGJU_GUS = new Set(['광산구', '남구', '동구', '북구', '서구']);

function toSido(item) {
  const name = item.ctprvnNm || '';
  if (name === '전남광주통합특별시') return GWANGJU_GUS.has(item.signguNm) ? '광주' : '전라남도'; // 통합시는 구 이름으로 분리
  return SIDO_NAME[name] || name;
}
function toSigungu(item) {
  const name = (item.signguNm || '').split(' ')[0]; // '전주시 완산구' → '전주시' (시 단위로 통일)
  return name === '세종특별자치시' ? '세종시' : name;
}

// 업종 분류 — DB 함수 refresh_commercial_stats()와 같은 규칙 (소진공 표준산업분류 대·중·소분류)
const OFFICE_L = new Set(['M1', 'K1', 'L1', 'J1', 'N1', 'O1']);
const NOT_RESTAURANT_M = new Set(['I211', 'I212', 'I207', 'I208', 'I209']);
const ICECREAM_S = new Set(['아이스크림/빙수', '아이스크림 할인점']);
function classify(it) {
  const l = it.indsLclsCd, m = it.indsMclsCd, s = it.indsSclsNm;
  return {
    cafe: m === 'I212',
    bakery: s === '빵/도넛',
    icecream: ICECREAM_S.has(s),
    restaurant: l === 'I2' && !NOT_RESTAURANT_M.has(m) && s !== '빵/도넛',
    pub: m === 'I211',
    retail: l === 'G2',
    service: l === 'S2',
    office: OFFICE_L.has(l),
    education: l === 'P1',
    medical: l === 'Q1',
    leisure: l === 'I1' || l === 'R1',
  };
}
const COUNT_KEYS = ['cafe', 'bakery', 'icecream', 'restaurant', 'pub', 'retail', 'service', 'office', 'education', 'medical', 'leisure'];

async function call(params, attempt = 0) {
  const qs = Object.entries({ serviceKey: KEY, type: 'json', ...params })
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&');
  try {
    const r = await fetch(`${BASE}/storeListInDong?${qs}`, { signal: AbortSignal.timeout(60000) });
    const d = await r.json();
    const code = d?.header?.resultCode;
    if (code === '03') return { items: [], total: 0 }; // NODATA
    if (code !== '00') throw new Error(d?.header?.resultMsg || `code ${code}`);
    return { items: d.body?.items || [], total: Number(d.body?.totalCount || 0) };
  } catch (e) {
    if (attempt < 3) { await new Promise((r) => setTimeout(r, 3000 * (attempt + 1))); return call(params, attempt + 1); }
    throw e;
  }
}

// 한 시도를 끝까지 읽어 (시도|시군구)·(시도|시군구|행정동) 두 집계로 만든다
async function collectSido(code) {
  const bySgg = new Map();   // key 시도|시군구 → { total, cafe, ..., adongs:Set }
  const byAdong = new Map(); // key 시도|시군구|행정동 → { total, cafe, restaurant, office, education }
  let page = 1, got = 0, total = 0, calls = 0;
  while (true) {
    const { items, total: tc } = await call({ divId: 'ctprvnCd', key: code, numOfRows: 1000, pageNo: page });
    calls++;
    total = tc;
    if (!items.length) break;
    for (const it of items) {
      const sido = toSido(it), sgg = toSigungu(it), adong = it.adongNm || null;
      const c = classify(it);
      const k = `${sido}|${sgg}`;
      let row = bySgg.get(k);
      if (!row) { row = { sido, sigungu: sgg, total: 0, adongs: new Set() }; COUNT_KEYS.forEach((key) => { row[key] = 0; }); bySgg.set(k, row); }
      row.total++;
      COUNT_KEYS.forEach((key) => { if (c[key]) row[key]++; });
      if (it.adongCd) row.adongs.add(it.adongCd);
      if (adong) {
        const ak = `${k}|${adong}`;
        let a = byAdong.get(ak);
        if (!a) { a = { sido, sigungu: sgg, adong_nm: adong, total: 0, cafe: 0, restaurant: 0, office: 0, education: 0 }; byAdong.set(ak, a); }
        a.total++;
        if (c.cafe) a.cafe++;
        if (c.restaurant) a.restaurant++;
        if (c.office) a.office++;
        if (c.education) a.education++;
      }
    }
    got += items.length;
    if (got >= total || items.length < 1000) break;
    page++;
  }
  return { bySgg, byAdong, got, total, calls };
}

async function loadPopulation() {
  const { data, error } = await sb.from('population_latest_by_sigungu').select('sido,sigungu,pop');
  if (error) throw error;
  return new Map(data.map((r) => [`${r.sido}|${r.sigungu}`, Number(r.pop)]));
}

async function saveSido(bySgg, byAdong, pop) {
  const sidos = [...new Set([...bySgg.values()].map((r) => r.sido))];
  const sggRows = [...bySgg.values()].map((r) => {
    const o = { sido: r.sido, sigungu: r.sigungu, total: r.total, pop: pop.get(`${r.sido}|${r.sigungu}`) || 0, adongs: r.adongs.size, refreshed_at: new Date().toISOString() };
    COUNT_KEYS.forEach((key) => { o[key] = r[key]; });
    return o;
  });
  const adongRows = [...byAdong.values()];
  for (const sido of sidos) {
    let e = (await sb.from('commercial_sigungu_stats').delete().eq('sido', sido)).error; if (e) throw e;
    e = (await sb.from('commercial_adong_stats').delete().eq('sido', sido)).error; if (e) throw e;
  }
  for (let i = 0; i < sggRows.length; i += 500) { const { error } = await sb.from('commercial_sigungu_stats').insert(sggRows.slice(i, i + 500)); if (error) throw error; }
  for (let i = 0; i < adongRows.length; i += 500) { const { error } = await sb.from('commercial_adong_stats').insert(adongRows.slice(i, i + 500)); if (error) throw error; }
  return { sidos, sgg: sggRows.length, adong: adongRows.length };
}

(async () => {
  const codes = process.argv.length > 2 ? process.argv.slice(2) : SIDO_CODES;
  const done = new Set(fs.existsSync(DONE_FILE) ? fs.readFileSync(DONE_FILE, 'utf8').split('\n').filter(Boolean) : []);
  const pop = await loadPopulation();
  for (const code of codes) {
    if (done.has(code)) { console.log(`${code}: 이미 완료 (건너뜀)`); continue; }
    const t0 = Date.now();
    try {
      const { bySgg, byAdong, got, total, calls } = await collectSido(code);
      const saved = await saveSido(bySgg, byAdong, pop);
      fs.appendFileSync(DONE_FILE, code + '\n');
      console.log(`${code} ${saved.sidos.join('·')}: 상가 ${got.toLocaleString()}/${total.toLocaleString()}, 시군구 ${saved.sgg}, 행정동 ${saved.adong}, 호출 ${calls}, ${Math.round((Date.now() - t0) / 1000)}s`);
    } catch (e) {
      console.log(`${code} FAILED: ${e.message || e}`);
    }
  }
  console.log('DONE');
})();
