'use client';

import { Fragment, useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getColorblind, onColorblindChange } from '@/lib/settings';
import { LEGACY_TO_CURRENT, legacySigungu, sigunguMatches, geoBucket } from '@/lib/regions';
import { loadNaverMaps, cachedGeocodeDetailed, cleanGeocodeQuery } from '@/lib/naver/loader';
import { toast } from 'sonner';
import {
  Map as MapIcon, BarChart3, RefreshCw, X,
  Inbox, Clock, Star, TrendingUp, ChevronDown, ChevronLeft, ChevronRight,
  Check, MapPin, CalendarDays, Tag, Play, Pause, Layers, Box, ExternalLink, Download, Info,
  ClipboardList, Target,
} from 'lucide-react';
// MapLibre CSS는 반드시 정적 import (런타임 await import()는 Next에서 reject되어 지도 초기화가 중단됨)
import 'maplibre-gl/dist/maplibre-gl.css';

// ─── TYPES ───────────────────────────────────────────────────────────────────

interface SnapRow {
  sido: string;
  sigungu: string;
  month: string;
  new_count: number;
  closed_count: number;
  updated_at: string;
}

interface RegionData {
  region: string;
  sido: string;
  new: number;
  closed: number;
  net: number;
  netRate: number;
}

interface DrillStore {
  name: string;
  status: 'new' | 'closed';
  category?: string;
  pyeong?: number;
  license_date?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  dong?: string | null;
  key: string;
}

type DrillSort = 'default' | 'pyeong' | 'date' | 'name';

// 매장 식별 키 (지도 점 ↔ 리스트 항목 매칭용) — 이름+좌표로 고유화
function storeKey(name: string, lat?: number | null, lng?: number | null) {
  return `${name}|${lat ?? ''}|${lng ?? ''}`;
}

interface DrillSummary {
  new: number;
  closed: number;
}

// 개별 매장 레코드 (market_store_records, 좌표 기반 점/히트맵 + 동별 집계)
// 컬럼 다이어트: 주소·인허가일은 본 로드에서 제외(전송량 54%↓), 드릴다운 열 때 지연 로드로 채움
interface StoreRow {
  name: string;
  sido: string;
  sigungu: string;
  month: string;
  status: 'new' | 'closed';
  category: string | null;
  pyeong: number | null;
  lat: number | null;
  lng: number | null;
  dong: string;    // 서버 파생 컬럼(법정동) — 동별 채색·집계용
  addrKey: string; // 주소 지문(md5 8자, 서버 파생) — 중복제거·지연 로드 매칭용
  address?: string | null;      // 지연 로드 (undefined=미로드, null=조회했으나 없음)
  license_date?: string | null; // 〃
}

interface DongAgg {
  dong: string;
  new: number;
  closed: number;
  net: number;
}

type ViewMode = 'map' | 'rank' | 'plan';

// 운영계획 뷰 — (시도|시군구)×연도 집계 행. years/nets 인덱스 0~3 = 최근 4개 연도(오래된 순)
interface PlanRegion {
  sido: string;
  sigungu: string;
  years: { n: number; c: number }[];
  big: number; // 최근년 신규 중 100평+ 대형
  nets: number[];
}
type DisplayMode = 'area' | 'points' | 'heat' | 'd3';
type RegionMode = 'branch' | 'sido';
type RankSort = 'net' | 'mom' | 'new' | 'closed' | 'rate';
type DrillTab = 'all' | 'new' | 'closed' | 'big';
type Category = 'all' | 'cafe' | 'bakery' | 'restaurant';

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const SIDO_NORM: Record<string, string> = {
  서울특별시: '서울', 서울시: '서울', 서울: '서울',
  부산광역시: '부산', 부산시: '부산', 부산: '부산',
  대구광역시: '대구', 대구시: '대구', 대구: '대구',
  인천광역시: '인천', 인천시: '인천', 인천: '인천',
  광주광역시: '광주', 광주시: '광주', 광주: '광주',
  대전광역시: '대전', 대전시: '대전', 대전: '대전',
  울산광역시: '울산', 울산시: '울산', 울산: '울산',
  세종특별자치시: '세종', 세종시: '세종', 세종: '세종',
  경기도: '경기도', 경기: '경기도',
  강원도: '강원도', 강원특별자치도: '강원도', 강원: '강원도',
  충청북도: '충청북도', 충북: '충청북도',
  충청남도: '충청남도', 충남: '충청남도',
  전라북도: '전라북도', 전북특별자치도: '전라북도', 전북: '전라북도',
  전라남도: '전라남도', 전남: '전라남도',
  경상북도: '경상북도', 경북: '경상북도',
  경상남도: '경상남도', 경남: '경상남도',
  제주특별자치도: '제주', 제주도: '제주', 제주: '제주',
};
// 지역 드롭다운 — 전국 17개 시도 (수도권=데이터 보유 우선, 나머지는 UI만/선택 시 데이터 없음)
const ALL_SIDOS = ['서울', '경기도', '인천', '부산', '대구', '광주', '대전', '울산', '세종', '강원도', '충청북도', '충청남도', '전라북도', '전라남도', '경상북도', '경상남도', '제주'];
// 줌인 시 표시할 행정동 경계 파일 (데이터 있는 시도만, public/geojson/dong/)
const DONG_FILE: Record<string, string> = { 서울: 'seoul', 경기도: 'gyeonggi', 인천: 'incheon' };
const DONG_FILE_SIDO: Record<string, string> = { seoul: '서울', gyeonggi: '경기도', incheon: '인천' };
// geojson code 앞2자리 → 시도 (중복 시군구명 구분용 — southkorea-maps 코드 체계)
const CODE_SIDO: Record<string, string> = {
  '11': '서울', '21': '부산', '22': '대구', '23': '인천', '24': '광주', '25': '대전', '26': '울산', '29': '세종',
  '31': '경기도', '32': '강원도', '33': '충청북도', '34': '충청남도', '35': '전라북도', '36': '전라남도', '37': '경상북도', '38': '경상남도', '39': '제주',
};
function sidoFromCode(code: unknown) { return CODE_SIDO[String(code ?? '').slice(0, 2)] || ''; }
// 2013 geojson 이름 → 현재 데이터 이름 (행정구역 개편). 예: 인천 남구→미추홀구(2018)
const NAME_ALIAS: Record<string, string> = { '인천|남구': '미추홀구' };
function shortSido(s: string) { return s === '경기도' ? '경기' : s; }
// 여러 시도를 함께 볼 때(withSido)만 시도 접두 — 단일 시도 보기면 드롭다운이 이미 알려주므로 생략
function regionLabel(sido: string, sigungu: string, withSido: boolean) {
  return withSido && sido ? `${shortSido(sido)} ${sigungu}` : sigungu;
}
function normSido(s?: string | null) {
  return SIDO_NORM[s?.trim() ?? ''] || s?.trim() || '';
}

const SIDO_CENTER: Record<string, { center: [number, number]; zoom: number }> = {
  서울:    { center: [126.978, 37.5665], zoom: 10 },
  부산:    { center: [129.0756, 35.1796], zoom: 10 },
  대구:    { center: [128.6014, 35.8714], zoom: 10 },
  인천:    { center: [126.7052, 37.4563], zoom: 10 },
  광주:    { center: [126.8526, 35.1595], zoom: 10 },
  대전:    { center: [127.3845, 36.3504], zoom: 10 },
  울산:    { center: [129.3114, 35.5384], zoom: 10 },
  세종:    { center: [127.289, 36.48], zoom: 10 },
  경기도:  { center: [127.5183, 37.4138], zoom: 9 },
  강원도:  { center: [128.1555, 37.8228], zoom: 8 },
  충청북도: { center: [127.4912, 36.6357], zoom: 9 },
  충청남도: { center: [126.8, 36.5184], zoom: 9 },
  전라북도: { center: [127.153, 35.7175], zoom: 9 },
  전라남도: { center: [126.991, 34.8679], zoom: 9 },
  경상북도: { center: [128.8889, 36.4919], zoom: 8 },
  경상남도: { center: [128.2132, 35.4606], zoom: 9 },
  제주:    { center: [126.4983, 33.489], zoom: 9 },
};

const CAT_KW: Record<string, string[]> = {
  cafe:       ['카페', '커피', 'coffee', 'cafe', '다방', '테이크아웃', '음료'],
  bakery:     ['베이커리', '제과', '빵', '케이크', '도넛', '파이', '쿠키'],
  restaurant: ['음식점', '식당', '레스토랑', '분식', '치킨', '피자', '햄버거',
               '중식', '일식', '한식', '양식', '탕', '찌개', '국밥', '냉면'],
};

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getMonthList(): string[] {
  const list: string[] = [];
  const now = new Date();
  const cur = new Date(now.getFullYear(), now.getMonth() - 35, 1); // 최근 36개월(3년) — 로드 윈도우와 일치
  while (cur <= now) {
    list.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
    cur.setMonth(cur.getMonth() + 1);
  }
  return list;
}

function addMonths(ym: string, delta: number): string {
  let [y, m] = ym.split('-').map(Number);
  m += delta;
  while (m > 12) { m -= 12; y++; }
  while (m < 1)  { m += 12; y--; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// 월 필터 매칭 — from=null이면 전체, to가 없거나 from과 같으면 단일 월, 그 외 [from..to] 범위.
// 'YYYY-MM' 형식은 사전순 비교가 시간순과 일치해 문자열 비교로 충분.
function monthInSel(m: string, from: string | null, to: string | null): boolean {
  if (!from) return true;
  if (!to || to === from) return m === from;
  return m >= from && m <= to;
}

function matchCategory(store: { category?: string | null; name?: string | null }, cat: Category): boolean {
  if (cat === 'all') return true;
  const haystack = ((store.category || '') + ' ' + (store.name || '')).toLowerCase();
  return CAT_KW[cat]?.some(kw => haystack.includes(kw)) ?? false;
}

// 인허가 추출/업로드(public-license)의 업태 화이트리스트와 동일한 목록.
// 시장분석 수집은 블랙리스트 방식이라 일반조리판매·분식·패스트푸드·아이스크림·뷔페식이
// 같이 들어온다(상권 규모용으로는 맞음) — '타겟만' 스위치는 이걸 화면에서만 걷어낸다.
// 두 코드가 같은 필드(BZSTAT_SE_NM)를 보므로 매핑 없이 같은 목록을 그대로 쓸 수 있다.
// ⚠️ public-license의 TARGET_CATEGORIES를 고치면 여기도 같이 고쳐야 한다.
const TARGET_CATS = new Set([
  '한식', '기타 휴게음식점', '기타', '레스토랑', '키즈카페', '경양식',
  '커피숍', '까페', '다방', '전통찻집', '떡카페',
  '제과점영업', '과자점',
  '패밀리레스트랑',
]);

/** 업종 칩 + '타겟만' 스위치 통합 판정. 매장 필터는 전부 이걸 거쳐야 화면 간 숫자가 일치한다. */
function passesFilters(
  store: { category?: string | null; name?: string | null },
  cat: Category,
  targetOnly: boolean,
): boolean {
  if (targetOnly && !TARGET_CATS.has((store.category || '').trim())) return false;
  return matchCategory(store, cat);
}

/** 매장 행 → (시도|시군구|월) SnapRow 집계. KPI·랭킹·면 채색·차트가 이걸 소비한다. */
function aggregateSnaps(rows: StoreRow[], targetOnly: boolean, cat: Category): SnapRow[] {
  const agg = new Map<string, SnapRow>();
  for (const r of rows) {
    if (!passesFilters(r, cat, targetOnly)) continue;
    const k = `${r.sido}|${r.sigungu}|${r.month}`;
    let o = agg.get(k);
    if (!o) { o = { sido: r.sido, sigungu: r.sigungu, month: r.month, new_count: 0, closed_count: 0, updated_at: '' }; agg.set(k, o); }
    if (r.status === 'new') o.new_count++; else o.closed_count++;
  }
  return [...agg.values()];
}

// 동/읍/면 추출은 DB 파생 컬럼 `dong`이 담당 (마이그레이션 add_dong_addr_key_generated_columns,
// 158,830건 기준 99.85% 추출 — 옛 클라 extractDong보다 지번주소·한글자 면 유형까지 커버)

// n개월 전의 YYYY-MM (롤링 윈도우 계산용)
function monthsAgoStr(n: number): string {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── FILTER DROPDOWN ─────────────────────────────────────────────────────────

interface DropdownOption { key: string; label: string; active: boolean; }

function FilterDropdown({
  icon, value, options, onSelect,
}: {
  icon: React.ReactNode;
  value: string;
  options: DropdownOption[];
  onSelect: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${open ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
      >
        <span className="text-slate-400">{icon}</span>
        {value}
        <ChevronDown size={13} className="text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[610]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[620] mt-1.5 max-h-[280px] min-w-[150px] overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-lg [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200">
            {options.map(o => (
              <button
                key={o.key}
                onClick={() => { onSelect(o.key); setOpen(false); }}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors ${o.active ? 'font-semibold text-blue-700 bg-blue-50/60' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                {o.label}
                {o.active && <Check size={13} className="flex-shrink-0 text-blue-600" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 월/기간 선택 드롭다운 ───────────────────────────────────────────────────
// 단일 월(기존 동작)과 시작~종료월 범위 지정을 한 드롭다운에서 — 탭 2개 + 빠른 프리셋.
function MonthRangeDropdown({
  monthList, selectedMonth, rangeTo, onSelectSingle, onSelectRange,
}: {
  monthList: string[];
  selectedMonth: string | null;
  rangeTo: string | null;
  onSelectSingle: (month: string | null) => void;
  onSelectRange: (from: string, to: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'single' | 'range'>('single');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const fmt = (m: string) => m.slice(2).replace('-', '.');
  const last = monthList[monthList.length - 1];
  const label = selectedMonth ? (rangeTo ? `${fmt(selectedMonth)}~${fmt(rangeTo)}` : fmt(selectedMonth)) : '전체 월';

  const openPanel = () => {
    setTab(rangeTo ? 'range' : 'single');
    setFrom(selectedMonth || monthList[Math.max(0, monthList.length - 3)]);
    setTo(rangeTo || last);
    setOpen(true);
  };
  const applyRange = (f: string, t: string) => {
    if (f > t) [f, t] = [t, f]; // 시작·종료가 뒤바뀌면 자동 교정
    onSelectRange(f, t);
    setOpen(false);
  };
  const presets = [
    { label: '최근 3개월', from: monthList[Math.max(0, monthList.length - 3)] },
    { label: '최근 6개월', from: monthList[Math.max(0, monthList.length - 6)] },
    { label: '최근 12개월', from: monthList[Math.max(0, monthList.length - 12)] },
    { label: '올해', from: `${last?.slice(0, 4)}-01` },
  ];
  return (
    <div className="relative">
      <button
        onClick={() => (open ? setOpen(false) : openPanel())}
        className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 text-xs font-medium transition-colors ${open ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
      >
        <span className="text-slate-400"><CalendarDays size={14} /></span>
        {label}
        <ChevronDown size={13} className="text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[610]" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full z-[620] mt-1.5 w-[248px] rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="m-2 grid grid-cols-2 rounded-lg bg-slate-100 p-0.5 text-[12px] font-medium">
              {([['single', '개별 월'], ['range', '기간 지정']] as const).map(([t, l]) => (
                <button key={t} onClick={() => setTab(t)} className={`h-7 rounded-md transition-all ${tab === t ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
              ))}
            </div>
            {tab === 'single' ? (
              <div className="max-h-[240px] overflow-y-auto pb-1 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200">
                {[{ key: '__all', label: '전체 월', active: !selectedMonth }, ...[...monthList].reverse().map(mo => ({ key: mo, label: fmt(mo), active: !rangeTo && selectedMonth === mo }))].map(o => (
                  <button
                    key={o.key}
                    onClick={() => { onSelectSingle(o.key === '__all' ? null : o.key); setOpen(false); }}
                    className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-xs transition-colors ${o.active ? 'font-semibold text-blue-700 bg-blue-50/60' : 'text-slate-600 hover:bg-slate-50'}`}
                  >
                    {o.label}
                    {o.active && <Check size={13} className="flex-shrink-0 text-blue-600" />}
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col gap-2.5 p-3 pt-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {presets.map(p => (
                    <button
                      key={p.label}
                      onClick={() => applyRange(monthList.includes(p.from) ? p.from : monthList[0], last)}
                      className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600"
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <select
                    value={from} onChange={e => setFrom(e.target.value)} aria-label="시작월"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
                  >
                    {monthList.map(mo => <option key={mo} value={mo}>{fmt(mo)}</option>)}
                  </select>
                  <span className="flex-shrink-0 text-xs text-slate-400">~</span>
                  <select
                    value={to} onChange={e => setTo(e.target.value)} aria-label="종료월"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700"
                  >
                    {monthList.map(mo => <option key={mo} value={mo}>{fmt(mo)}</option>)}
                  </select>
                </div>
                <button
                  onClick={() => from && to && applyRange(from, to)}
                  className="h-8 rounded-lg bg-blue-600 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
                >
                  적용
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── SPARKLINE ───────────────────────────────────────────────────────────────
// 최근 N개월 순증 미니 막대 (양수 초록↑ / 음수 빨강↓, 0 기준선)
function Sparkline({ values, colorblind = false }: { values: number[]; colorblind?: boolean }) {
  const n = values.length || 1;
  const max = Math.max(1, ...values.map(v => Math.abs(v)));
  const W = 58, H = 22, bw = W / n, mid = H / 2;
  const pos = colorblind ? '#2563eb' : '#16a34a';
  const neg = colorblind ? '#f97316' : '#ef4444';
  return (
    <svg width={W} height={H} className="flex-shrink-0" aria-hidden>
      <line x1={0} y1={mid} x2={W} y2={mid} stroke="#e2e8f0" strokeWidth={1} />
      {values.map((v, i) => {
        const h = Math.max(1.5, (Math.abs(v) / max) * (H / 2 - 1.5));
        return (
          <rect
            key={i}
            x={i * bw + bw * 0.22} y={v >= 0 ? mid - h : mid}
            width={bw * 0.56} height={h} rx={1}
            fill={v > 0 ? pos : v < 0 ? neg : '#cbd5e1'} opacity={0.9}
          />
        );
      })}
    </svg>
  );
}

// ─── 이벤트 중복 제거 ────────────────────────────────────────────────────────
// 공공 인허가 API는 폐업(드물게 신규) 레코드를 여러 달의 월간 스냅샷에 반복 노출하고,
// 야간 refresh-market은 month별 행으로 upsert하므로 같은 매장이 연속된 여러 달에
// 중복 등재된다 (2026-07 실측: 폐업 1,515곳이 2개월 이상 반복·최대 22개월, 신규 91곳
// — 그대로 합산하면 폐업이 약 2,600건 과다 집계). 동일 (이름|주소|월|상태) 완전 중복은 0건.
// 규칙: (이름|주소|상태)별 month 집합에서 "직전 달에도 같은 상태로 존재"하는 행은 같은
// 이벤트의 반복 노출로 보고 제외 — 연속 체인의 시작 달 1건만 실제 발생으로 남긴다.
// 체인이 끊긴 뒤(1개월+ 공백) 재등장하면 별개 이벤트(재개업 후 재폐업 등)로 인정.
// 한계: 조회 창(36개월) 이전에 시작된 체인은 창 안의 첫 달이 발생 월로 기록된다.
// 반복 노출 행에만 좌표가 있으면 대표 행에 이식해 지도 점 손실을 막는다.
function prevMonthStr(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/** 두 'YYYY-MM' 사이 개월 수 (b - a). 생존율의 관측 기간 판정용. */
function monthDiff(a: string, b: string): number {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
}

function dedupeStoreEvents(rows: StoreRow[]): StoreRow[] {
  const byKey = new Map<string, Map<string, StoreRow>>(); // (이름|주소지문|상태) → month → 대표 행
  for (const r of rows) {
    const k = `${r.name}|${r.addrKey}|${r.status}`;
    let mm = byKey.get(k);
    if (!mm) { mm = new Map(); byKey.set(k, mm); }
    const prev = mm.get(r.month);
    if (!prev || (prev.lat == null && r.lat != null)) mm.set(r.month, r);
  }
  const out: StoreRow[] = [];
  for (const mm of byKey.values()) {
    for (const mo of [...mm.keys()].sort()) {
      const row = mm.get(mo)!;
      if (mm.has(prevMonthStr(mo))) {
        if (row.lat != null && row.lng != null) {
          let head = mo;
          while (mm.has(prevMonthStr(head))) head = prevMonthStr(head);
          const headRow = mm.get(head)!;
          if (headRow.lat == null || headRow.lng == null) { headRow.lat = row.lat; headRow.lng = row.lng; }
        }
        continue;
      }
      out.push(row);
    }
  }
  return out;
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

export default function DiscoverPage() {
  const router = useRouter();
  const supabase = createClient();

  // Map refs
  const mapContainerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  const mapReadyRef = useRef(false);
  const geoDataRef = useRef<object | null>(null);
  const geoLayerReadyRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapPopupRef = useRef<any>(null);
  const hoveredMuniIdRef = useRef<string | number | null>(null);
  const hoveredDongIdRef = useRef<string | number | null>(null);
  const pendingMapRenderRef = useRef<(() => void) | null>(null);
  const mapCenteredRef = useRef(false);

  // Chart refs
  const overallChartCanvasRef = useRef<HTMLCanvasElement>(null);
  const trendChartCanvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overallChartRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const trendChartRef = useRef<any>(null);

  // Month timeline ref for scrolling
  const monthTimelineRef = useRef<HTMLDivElement>(null);

  // Data state
  const [sidoSigunguMap, setSidoSigunguMap] = useState<Record<string, string[]>>({});
  const [sigunguSidoMap, setSigunguSidoMap] = useState<Record<string, string>>({});
  const [cachedSnaps, setCachedSnaps] = useState<SnapRow[]>([]);
  const [cachedStores, setCachedStores] = useState<StoreRow[]>([]);
  const [cachedRegionsArr, setCachedRegionsArr] = useState<RegionData[]>([]);

  // UI state
  const [mapError, setMapError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [planSort, setPlanSort] = useState<{ k: string; d: 1 | -1 }>({ k: '3:2', d: -1 }); // 운영계획 표 정렬 — 기본: 최근년 순증 내림차순
  const [planOpenRegion, setPlanOpenRegion] = useState<string | null>(null); // 운영계획 표에서 펼친 지역(`시도|시군구`) — 동별 상세 아코디언
  const [displayMode, setDisplayMode] = useState<DisplayMode>('points');
  const [colorblind, setColorblind] = useState(false); // 색각보정 (홈/설정모달과 fs_colorblind 공유)
  const [playing, setPlaying] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true); // 타임랩스 바 접기(지도 시야 확보용)

  // 모바일(협폭)에선 인사이트 독이 지도 절반을 가리므로 기본 접힘 (핸들로 언제든 펼침)
  useEffect(() => {
    const t = setTimeout(() => { if (window.innerWidth < 768) setDockOpen(false); }, 0);
    return () => clearTimeout(t);
  }, []);
  const [regionMode, setRegionModeState] = useState<RegionMode>('branch');
  const [regionSido, setRegionSido] = useState<string | null>(null);
  // 기본값=최신 월(3년치 전체 점이 한 번에 찍히는 부담·혼잡 방지). '전체 월'은 드롭다운에서 선택.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(() => { const ml = getMonthList(); return ml[ml.length - 1] ?? null; });
  // 기간 조회 종료월 — null=단일 월(또는 전체). 설정 시 [selectedMonth..rangeTo] 범위로 집계.
  const [rangeTo, setRangeTo] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  // '타겟만' — 인허가 추출 기준 업태만 보기. 기본 OFF(기존 상권 규모 모수 유지)
  const [targetOnly, setTargetOnly] = useState(false);
  const [rankSort, setRankSort] = useState<RankSort>('net');
  const [dedupInfoOpen, setDedupInfoOpen] = useState(false); // 중복 집계 제거 로직 설명 패널
  const [loading, setLoading] = useState(true);
  const [lastSync, setLastSync] = useState('로딩 중...');
  const [refreshing, setRefreshing] = useState(false);
  const monthList = getMonthList();

  // KPI state
  const [kpiNew, setKpiNew] = useState<string>('—');
  const [kpiClosed, setKpiClosed] = useState<string>('—');
  const [kpiNet, setKpiNet] = useState<string>('—');
  const [kpiRate, setKpiRate] = useState<string>('—');

  // Panel state
  const [panelOpen, setPanelOpen] = useState(false);
  const [drillTitle, setDrillTitle] = useState('—');
  const [drillStores, setDrillStores] = useState<StoreRow[]>([]); // 클릭한 시군구의 전체 매장(전월·전업종)
  const [selectedDong, setSelectedDong] = useState<string | null>(null);
  const [drillTab, setDrillTab] = useState<DrillTab>('all');
  const [drillSort, setDrillSort] = useState<DrillSort>('default');
  const [selectedStoreKey, setSelectedStoreKey] = useState<string | null>(null);
  const [spChartOpen, setSpChartOpen] = useState(false);
  const [currentDrillRegion, setCurrentDrillRegion] = useState('');
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const drillListRef = useRef<any>(null);
  const selectedStoreKeyRef = useRef<string | null>(null);

  // Refs to hold mutable values without triggering re-renders in map handlers
  const sigunguSidoMapRef = useRef<Record<string, string>>({});
  const viewSidoRef = useRef<string | null>(null);
  const selectedMonthRef = useRef<string | null>(null);
  const rangeToRef = useRef<string | null>(null);
  const selectedCategoryRef = useRef<Category>('all');
  const targetOnlyRef = useRef(false);
  const cachedStoresRef = useRef<StoreRow[]>([]);
  const geocodeRunRef = useRef(0);
  const selectedDongRef = useRef<string | null>(null);
  const drillRegionRef = useRef<string>('');
  const displayModeRef = useRef<DisplayMode>('points');
  const colorblindRef = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const storeHoverPopupRef = useRef<any>(null);
  const storeLayerReadyRef = useRef(false);
  // 행정동 경계(줌인 시) — lazy 로드
  const dongLayerReadyRef = useRef(false);
  const dongLoadedKeyRef = useRef('');
  const dongCacheRef = useRef<Record<string, { features: unknown[] } | null>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dongFeaturesRef = useRef<any[]>([]); // 현재 로드된 동 폴리곤(그라데이션 채색 대상) — sido 주입된 상태
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dongHoverPopupRef = useRef<any>(null);
  const scopeSidosRef = useRef<string[]>([]);
  const playTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 지역별 세션 캐시 — 한 번 내려받은 원본을 기억해 재방문 시 다운로드 없이 즉시 표시.
  // 데이터 갱신은 하루 1회(새벽 크론)뿐이라 세션 내 재사용은 안전. 새로고침하면 비워진다.
  const storeCacheRef = useRef<Map<string, StoreRow[]>>(new Map());
  const loadRunRef = useRef(0); // 지역을 연달아 바꿀 때 늦게 끝난 이전 로드가 화면을 덮어쓰지 않게

  useEffect(() => { sigunguSidoMapRef.current = sigunguSidoMap; }, [sigunguSidoMap]);
  useEffect(() => { viewSidoRef.current = regionSido; }, [regionSido]);
  useEffect(() => { selectedMonthRef.current = selectedMonth; }, [selectedMonth]);
  useEffect(() => { rangeToRef.current = rangeTo; }, [rangeTo]);
  useEffect(() => { selectedCategoryRef.current = selectedCategory; }, [selectedCategory]);
  useEffect(() => { cachedStoresRef.current = cachedStores; }, [cachedStores]);

  // 선택된 매장이 바뀌면 리스트에서 해당 행을 화면 안으로 스크롤 (점 클릭 → 리스트 동기화)
  useEffect(() => {
    if (!selectedStoreKey) return;
    const cont = drillListRef.current;
    if (!cont) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let found: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    cont.querySelectorAll('[data-skey]').forEach((el: any) => { if (el.getAttribute('data-skey') === selectedStoreKey) found = el; });
    if (found) found.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedStoreKey]);

  // ─── AUTH CHECK ────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/login');
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 색각보정 — 공유 설정(fs_colorblind) 읽기 + 같은 탭 변경 구독 → 점/히트맵 재색칠
  useEffect(() => {
    const apply = (v: boolean) => { setColorblind(v); colorblindRef.current = v; updateStoreLayer(); };
    const t = setTimeout(() => apply(getColorblind()), 0); // 초기값(effect 내 동기 setState 회피)
    const off = onColorblindChange(apply);
    return () => { clearTimeout(t); off(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── MAP INIT ──────────────────────────────────────────────────────────────

  useEffect(() => {
    // 컨테이너는 loading=false 이후에야 렌더되므로 effect가 loading 변화에 반응해야 함.
    // (mapRef로 1회 생성만 보장 — 재실행돼도 이미 만들어졌으면 skip)
    if (!mapContainerRef.current || mapRef.current) return;
    let destroyed = false;

    async function initMap() {
      const maplibregl = (await import('maplibre-gl')).default;
      // Popup 생성 시 참조 (muni hover · store click 팝업 공용)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).maplibregl = maplibregl;
      if (destroyed || !mapContainerRef.current || mapRef.current) return;

      const key = process.env.NEXT_PUBLIC_MAPTILER_KEY || '';
      if (!key) console.warn('[discover] MAPTILER_KEY 없음 — 지도 타일이 안 보일 수 있습니다');

      // 초기 시점: 마지막 안착 시점(지점 중심 안착 포함)을 기억해 재사용 — 첫 화면부터 전국 뷰가 아닌
      // 내 지점 구역에서 시작. 저장값이 없을 때(최초 방문)만 광역 기본값.
      let initView: { center: [number, number]; zoom: number } = { center: [127.1, 37.5], zoom: 8 };
      try {
        const saved = JSON.parse(localStorage.getItem('discover_last_view') || 'null');
        if (saved && Number.isFinite(saved.lng) && Number.isFinite(saved.lat) && Number.isFinite(saved.zoom)) {
          initView = { center: [saved.lng, saved.lat], zoom: saved.zoom };
        }
      } catch { /* ignore */ }

      const mapInstance = new maplibregl.Map({
        container: mapContainerRef.current,
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`,
        center: initView.center,
        zoom: initView.zoom,
        attributionControl: false,
        localIdeographFontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
      });
      mapInstance.on('moveend', () => {
        try {
          const c = mapInstance.getCenter();
          localStorage.setItem('discover_last_view', JSON.stringify({ lng: c.lng, lat: c.lat, zoom: mapInstance.getZoom() }));
        } catch { /* ignore */ }
      });

      mapInstance.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
      mapInstance.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');

      mapInstance.on('load', () => {
        setMapError(null);
        // Localize labels to Korean
        const field = ['coalesce', ['get', 'name:ko'], ['get', 'name:latin'], ['get', 'name']];
        for (const layer of mapInstance.getStyle().layers) {
          if (layer.type === 'symbol' && layer.layout && 'text-field' in layer.layout) {
            try { mapInstance.setLayoutProperty(layer.id, 'text-field', field); } catch (_) {}
          }
        }

        mapReadyRef.current = true;
        loadGeoData().then((geo) => {
          if (geo) renderGeoMap([], geo, mapInstance);
        });
        if (pendingMapRenderRef.current) {
          pendingMapRenderRef.current();
          pendingMapRenderRef.current = null;
        }
        // 일부 환경에서 첫 프레임이 안 그려져 흰 화면으로 남는 문제 → 강제 resize로 페인트 유발
        [80, 350, 900].forEach(ms => setTimeout(() => { try { mapInstance.resize(); } catch { /* noop */ } }, ms));
      });

      mapRef.current = mapInstance;
    }

    initMap().catch((e) => {
      console.error('[discover] 지도 초기화 실패', e);
      setMapError(String((e && (e.stack || e.message)) || e));
    });
    return () => {
      destroyed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        mapReadyRef.current = false;
        geoLayerReadyRef.current = false;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ─── GEO DATA ──────────────────────────────────────────────────────────────

  const geoLoadPromiseRef = useRef<Promise<object | null> | null>(null);

  async function loadGeoData(): Promise<object | null> {
    if (geoDataRef.current) return geoDataRef.current;
    if (geoLoadPromiseRef.current) return geoLoadPromiseRef.current;
    geoLoadPromiseRef.current = (async () => {
      try {
        const r = await fetch('/geojson/municipalities.json');
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const geo = await r.json();
        geoDataRef.current = geo;
        return geo;
      } catch (e) {
        console.warn('[discover] GeoJSON 실패:', e);
        geoDataRef.current = null;
        geoLoadPromiseRef.current = null;
        return null;
      }
    })();
    return geoLoadPromiseRef.current;
  }

  // ─── GEO MAP RENDER ────────────────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function renderGeoMap(regions: RegionData[], geoData: any, mapInstance: any) {
    if (!mapInstance || !geoData) return;

    // (시도|시군구) 복합키 — 같은 이름(중구 등)이라도 시도로 구분
    const regionMap: Record<string, RegionData> = {};
    regions.forEach(r => { regionMap[`${r.sido}|${r.region}`] = r; });

    if (!geoLayerReadyRef.current) {
      const maplibregl = (mapInstance as { getLayer: () => void }).constructor;
      void maplibregl;

      mapInstance.addSource('munis', { type: 'geojson', data: geoData, promoteId: 'code' });

      const tone = ['coalesce', ['feature-state', 'tone'], 'none'];
      const t    = ['coalesce', ['feature-state', 't'], 0];
      mapInstance.addLayer({
        // 줌 10.5부터는 dong-fill(읍면동 그라데이션)이 대체 — 서로 안 겹치게 maxzoom으로 분리
        id: 'muni-fill', type: 'fill', source: 'munis', maxzoom: 10.5,
        paint: {
          'fill-color': [
            'case',
            ['==', tone, 'pos'], ['interpolate', ['linear'], t, 0, '#bbf7d0', 1, '#15803d'],
            ['==', tone, 'neg'], ['interpolate', ['linear'], t, 0, '#fecaca', 1, '#b91c1c'],
            ['==', tone, 'zero'], '#94a3b8',
            'rgba(148,163,184,0.18)',
          ],
          'fill-opacity': ['case', ['==', tone, 'none'], 0.25, 0.72],
        },
      });
      mapInstance.addLayer({
        id: 'muni-line', type: 'line', source: 'munis',
        paint: {
          // 호버한 시군구는 외곽선 강조
          'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#2563eb', '#ffffff'],
          'line-width': ['case', ['boolean', ['feature-state', 'hover'], false], 2.6, 0.8],
          'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 1, 0.45],
        },
      });

      // 3D 입체 — 데이터 있는 시군구만 담은 전용 소스(muni3d)로 솟는 블록.
      // (feature-state는 layer filter에 못 써서, 무데이터 폴리곤이 검게 깔리는 문제 회피)
      mapInstance.addSource('muni3d', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      mapInstance.addLayer({
        id: 'muni-extrusion', type: 'fill-extrusion', source: 'muni3d',
        layout: { visibility: 'none' },
        paint: {
          'fill-extrusion-color': ['get', 'color'],
          'fill-extrusion-height': ['get', 'height'],
          'fill-extrusion-base': 0,
          'fill-extrusion-opacity': 0.92,
        },
      });

      // 면·입체 블록 공용 hover/click 핸들러 (입체 모드에선 muni-fill이 숨겨져 muni-extrusion이 히트테스트 담당)
      // muni-fill은 feature-state, muni-extrusion(muni3d)은 properties에 정보를 담는다.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const muniInfo = (f: any) => (f.state && f.state.tone) ? f.state : (f.properties && f.properties.tone ? f.properties : {});
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onMuniMove = (e: any) => {
        const f = e.features[0]; if (!f) return;
        const st = muniInfo(f);
        if (st.tone == null || st.tone === 'none') {
          mapInstance.getCanvas().style.cursor = '';
          if (mapPopupRef.current) mapPopupRef.current.remove();
          return;
        }
        mapInstance.getCanvas().style.cursor = 'pointer';
        // 호버 외곽선 강조 (2D muni-fill만; 입체는 블록 자체가 강조)
        if (f.source === 'munis') {
          if (hoveredMuniIdRef.current != null && hoveredMuniIdRef.current !== f.id) {
            mapInstance.setFeatureState({ source: 'munis', id: hoveredMuniIdRef.current }, { hover: false });
          }
          hoveredMuniIdRef.current = f.id;
          mapInstance.setFeatureState({ source: 'munis', id: f.id }, { hover: true });
        }
        const netStr = (st.net ?? 0) > 0 ? `+${st.net}` : String(st.net ?? 0);
        const html = `<div style="background:rgba(15,23,42,0.96);color:#fff;border-radius:10px;padding:8px 13px;font-size:12px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 6px 20px rgba(0,0,0,0.28);white-space:nowrap"><div style="font-weight:700;font-size:13px;margin-bottom:2px">${regionLabel(st.sido, st.name || f.properties.name, scopeSidosRef.current.length > 1)}</div><div style="color:#cbd5e1;font-size:11px">신규 ${st.nnew || 0} · 폐업 ${st.closed || 0} · 순증 ${netStr}</div></div>`;

        if (!mapPopupRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ML = (window as any).maplibregl;
          if (ML) {
            mapPopupRef.current = new ML.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'fs-pop' });
          }
        }
        if (mapPopupRef.current) {
          mapPopupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(mapInstance);
        }
      };
      const onMuniLeave = () => {
        mapInstance.getCanvas().style.cursor = '';
        if (mapPopupRef.current) mapPopupRef.current.remove();
        if (hoveredMuniIdRef.current != null) {
          mapInstance.setFeatureState({ source: 'munis', id: hoveredMuniIdRef.current }, { hover: false });
          hoveredMuniIdRef.current = null;
        }
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const onMuniClick = (e: any) => {
        const f = e.features[0];
        const st = f && muniInfo(f);
        if (st && st.tone && st.tone !== 'none') {
          openDrilldown(st.name || f.properties.name, st.sido);
        }
      };
      for (const lid of ['muni-fill', 'muni-extrusion']) {
        mapInstance.on('mousemove', lid, onMuniMove);
        mapInstance.on('mouseleave', lid, onMuniLeave);
        mapInstance.on('click', lid, onMuniClick);
      }

      geoLayerReadyRef.current = true;
    }

    // 매장 점/히트맵 레이어를 시군구 면 위에 얹는다 (순서 보장)
    ensureStoreLayers(mapInstance);
    ensureDongLayer(mapInstance);

    mapInstance.removeFeatureState({ source: 'munis' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d3feats: any[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    geoData.features.forEach((f: any) => {
      const name = f.properties.name;
      const fSido = sidoFromCode(f.properties.code); // 코드로 이 폴리곤의 시도 판별
      const dataName = NAME_ALIAS[`${fSido}|${name}`] || name; // 개명 반영(남구→미추홀구)
      let d = regionMap[`${fSido}|${dataName}`];
      // 행정구역 개편(2026-07 인천 등): 옛 폴리곤 하나에 새 구 여러 개가 대응 → 합산해서 칠한다
      const curNames = LEGACY_TO_CURRENT[`${fSido}|${dataName}`];
      if (curNames) {
        const ds = curNames.map(n => regionMap[`${fSido}|${n}`]).filter(Boolean);
        if (ds.length) {
          d = ds.reduce((a, b) => ({ ...a, new: a.new + b.new, closed: a.closed + b.closed, net: a.net + b.net }));
          if (ds.length > 1) d = { ...d, region: ds.map(x => x.region).join('·') };
        }
      }
      if (!d) {
        // 시 폴백 (고양시덕양구 → 고양시) — 같은 시도 안에서만
        const parentKey = Object.keys(regionMap).find(k =>
          k.startsWith(`${fSido}|`) && k.slice(fSido.length + 1).endsWith('시') && name.startsWith(k.slice(fSido.length + 1)));
        if (parentKey) d = regionMap[parentKey];
      }
      if (!d) return; // 데이터 없는 시도의 동명 폴리곤(서울 중구 등)엔 안 칠해짐
      let toneVal = 'zero';
      let tVal = 0;
      if (d.net > 0)      { toneVal = 'pos'; tVal = Math.min(d.net / 25, 1); }
      else if (d.net < 0) { toneVal = 'neg'; tVal = Math.min(Math.abs(d.net) / 25, 1); }
      mapInstance.setFeatureState(
        { source: 'munis', id: String(f.properties.code) }, // promoteId=code
        { tone: toneVal, t: tVal, nnew: d.new, closed: d.closed, net: d.net, sido: d.sido, name: d.region }
      );
      // 3D 블록 — 데이터 지역만, 높이=|순증|·색=방향
      d3feats.push({
        type: 'Feature',
        geometry: f.geometry,
        properties: {
          name: d.region, tone: toneVal, nnew: d.new, closed: d.closed, net: d.net, sido: d.sido,
          color: toneVal === 'pos' ? '#16a34a' : toneVal === 'neg' ? '#dc2626' : '#cbd5e1',
          height: 250 + Math.abs(d.net) * 650,
        },
      });
    });
    const s3 = mapInstance.getSource('muni3d');
    if (s3) s3.setData({ type: 'FeatureCollection', features: d3feats });

    // 면 갱신 때마다 점/히트맵도 동기화
    updateStoreLayer();
    updateDongBoundaries();
  }

  // ─── 행정동 경계 (줌인 시 lazy) ────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function ensureDongLayer(mapInstance: any) {
    if (dongLayerReadyRef.current || !mapInstance) return;
    // promoteId='id' — setFeatureState/클릭 시 안정적인 피처 식별용(id는 `${sgg}|${name}` 합성키, 빌드 시 부여)
    mapInstance.addSource('dong', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'id' });

    // 동 그라데이션 채색 — 줌인 시 시군구 면(muni-fill)을 대체(minzoom/maxzoom로 서로 안 겹치게 분리).
    // store-heat보다 먼저 추가해 매장 점/히트맵 레이어 '아래'에 깔리도록 stacking 보장.
    const dTone = ['coalesce', ['feature-state', 'tone'], 'none'];
    const dT    = ['coalesce', ['feature-state', 't'], 0];
    mapInstance.addLayer({
      id: 'dong-fill', type: 'fill', source: 'dong', minzoom: 10.5,
      paint: {
        'fill-color': [
          'case',
          ['==', dTone, 'pos'], ['interpolate', ['linear'], dT, 0, '#bbf7d0', 1, '#15803d'],
          ['==', dTone, 'neg'], ['interpolate', ['linear'], dT, 0, '#fecaca', 1, '#b91c1c'],
          ['==', dTone, 'zero'], '#94a3b8',
          'rgba(148,163,184,0.12)',
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.3, 0.72],
      },
    }, 'store-heat');

    mapInstance.addLayer({
      id: 'dong-line', type: 'line', source: 'dong', minzoom: 10.5,
      paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'hover'], false], '#2563eb', '#475569'],
        // zoom 표현식은 top-level interpolate에만 허용 — hover 분기는 각 stop 출력 안에서 처리
        'line-width': ['interpolate', ['linear'], ['zoom'],
          10.5, ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.2],
          13, ['case', ['boolean', ['feature-state', 'hover'], false], 2, 0.7],
          15, ['case', ['boolean', ['feature-state', 'hover'], false], 2.4, 1.3]],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10.5, 0, 12, 0.45, 15, 0.75],
        'line-dasharray': [2, 1.5],
      },
    });

    // 동 면 hover/click — 시군구 면(muni-fill)과 동일 UX 패턴
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDongMove = (e: any) => {
      const f = e.features[0]; if (!f) return;
      const st = f.state || {};
      if (st.tone == null || st.tone === 'none') {
        mapInstance.getCanvas().style.cursor = '';
        if (dongHoverPopupRef.current) dongHoverPopupRef.current.remove();
        return;
      }
      mapInstance.getCanvas().style.cursor = 'pointer';
      if (hoveredDongIdRef.current != null && hoveredDongIdRef.current !== f.id) {
        mapInstance.setFeatureState({ source: 'dong', id: hoveredDongIdRef.current }, { hover: false });
      }
      hoveredDongIdRef.current = f.id;
      mapInstance.setFeatureState({ source: 'dong', id: f.id }, { hover: true });
      const netStr = (st.net ?? 0) > 0 ? `+${st.net}` : String(st.net ?? 0);
      const html = `<div style="background:rgba(15,23,42,0.96);color:#fff;border-radius:10px;padding:8px 13px;font-size:12px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 6px 20px rgba(0,0,0,0.28);white-space:nowrap"><div style="font-weight:700;font-size:13px;margin-bottom:2px">${f.properties.name}</div><div style="color:#cbd5e1;font-size:11px">신규 ${st.nnew || 0} · 폐업 ${st.closed || 0} · 순증 ${netStr}</div></div>`;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ML = (window as any).maplibregl;
      if (ML) {
        if (!dongHoverPopupRef.current) dongHoverPopupRef.current = new ML.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: 'fs-pop' });
        dongHoverPopupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(mapInstance);
      }
    };
    const onDongLeave = () => {
      mapInstance.getCanvas().style.cursor = '';
      if (dongHoverPopupRef.current) dongHoverPopupRef.current.remove();
      if (hoveredDongIdRef.current != null) {
        mapInstance.setFeatureState({ source: 'dong', id: hoveredDongIdRef.current }, { hover: false });
        hoveredDongIdRef.current = null;
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onDongClick = (e: any) => {
      const f = e.features[0]; if (!f) return;
      const st = f.state || {};
      if (st.tone == null || st.tone === 'none') return; // 데이터 없는 동은 무시
      const rawName = String(f.properties.name);
      // openDrilldown 내부의 "시 폴백"이 구 단위(sgg, 예: 수원시장안구)→시 단위(수원시) 매칭을 처리
      openDrilldown(String(f.properties.sgg), st.sido ? String(st.sido) : undefined);
      // 행정동이 분동(화정1동 등)인데 매장 주소는 법정동(화정동) 기준일 수 있음 — 실측으로 판정 후 폴백
      const resolvedSigungu = drillRegionRef.current;
      const hasRaw = cachedStoresRef.current.some(s => sigunguMatches(s.sido, s.sigungu, resolvedSigungu) && s.dong === rawName);
      handleSelectDong(hasRaw ? rawName : rawName.replace(/\d+동$/, '동'));
    };
    mapInstance.on('mousemove', 'dong-fill', onDongMove);
    mapInstance.on('mouseleave', 'dong-fill', onDongLeave);
    mapInstance.on('click', 'dong-fill', onDongClick);
    // 줌인할 때만 해당 시도 동 경계 로드 (lazy)
    mapInstance.on('zoomend', updateDongBoundaries);
    dongLayerReadyRef.current = true;
  }

  async function loadDongFile(key: string): Promise<{ features: unknown[] } | null> {
    if (dongCacheRef.current[key] !== undefined) return dongCacheRef.current[key];
    try {
      const r = await fetch(`/geojson/dong/${key}.json`);
      if (!r.ok) { dongCacheRef.current[key] = null; return null; }
      const j = await r.json();
      dongCacheRef.current[key] = j;
      return j;
    } catch {
      dongCacheRef.current[key] = null;
      return null;
    }
  }

  // 현재 보고 있는 시도(스코프)의 행정동 경계를 줌인 시 로드해서 표시
  async function updateDongBoundaries() {
    const map = mapRef.current;
    if (!map || !dongLayerReadyRef.current) return;
    if (map.getZoom() < 10.5) return; // 줌아웃 상태면 로드 안 함
    const keys = scopeSidosRef.current.map(s => DONG_FILE[s]).filter(Boolean);
    const sig = [...keys].sort().join(',');
    if (sig === dongLoadedKeyRef.current) return; // 이미 로드된 스코프
    dongLoadedKeyRef.current = sig;
    if (!keys.length) {
      dongFeaturesRef.current = [];
      const src = map.getSource('dong');
      if (src) src.setData({ type: 'FeatureCollection', features: [] });
      return;
    }
    const fcs = await Promise.all(keys.map(loadDongFile));
    // 시도 태그 주입(파일별로 어느 시도인지 알아야 store 데이터와 매칭 가능) — 캐시 원본은 불변 유지 위해 복사
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const feats = fcs.flatMap((fc: any, i: number) => {
      if (!fc) return [];
      const sido = DONG_FILE_SIDO[keys[i]] || '';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (fc.features as any[]).map(f => ({ ...f, properties: { ...f.properties, sido } }));
    });
    dongFeaturesRef.current = feats;
    const src = map.getSource('dong');
    if (src) src.setData({ type: 'FeatureCollection', features: feats });
    updateDongFillState();
  }

  // 동 그라데이션 채색 — muni-fill과 동일 컨벤션(월 필터만 반영, 업종 무관 순증)으로
  // cachedStores를 (시도|시군구|동) 단위 집계해 setFeatureState. 월·매장 데이터 갱신 시마다 재호출.
  function updateDongFillState() {
    const map = mapRef.current;
    if (!map || !dongLayerReadyRef.current) return;
    const feats = dongFeaturesRef.current;
    if (!map.getSource('dong')) return;
    map.removeFeatureState({ source: 'dong' });
    if (!feats.length) return;

    const month = selectedMonthRef.current;
    const monthTo = rangeToRef.current;
    // 시도별로 실제 로드된 시군구 목록(시 폴백 매칭용) + (시도|시군구|동) 순증 집계
    const sigunguBySido = new Map<string, Set<string>>();
    const agg = new Map<string, { new: number; closed: number }>();
    for (const s of cachedStoresRef.current) {
      if (!monthInSel(s.month, month, monthTo)) continue;
      if (!passesFilters(s, 'all', targetOnlyRef.current)) continue; // '타겟만' 반영 (동 채색도 면·KPI와 같은 모수)
      if (!sigunguBySido.has(s.sido)) sigunguBySido.set(s.sido, new Set());
      // 동 경계(geojson)는 옛 구명 기준 — 개편된 새 구명(검단구 등)은 옛 이름으로 정규화해 매칭
      const lsg = legacySigungu(s.sido, s.sigungu);
      sigunguBySido.get(s.sido)!.add(lsg);
      const dong = s.dong;
      if (dong === '기타') continue;
      const k = `${s.sido}|${lsg}|${dong}`;
      let o = agg.get(k);
      if (!o) { o = { new: 0, closed: 0 }; agg.set(k, o); }
      if (s.status === 'new') o.new++; else o.closed++;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const f of feats as any[]) {
      const sido = f.properties.sido as string;
      const sgg = f.properties.sgg as string;
      const name = f.properties.name as string;
      const candidates = sigunguBySido.get(sido);
      if (!candidates) continue; // 이 시도 데이터가 아예 없음
      // 정확일치(구 없는 시) 우선, 없으면 시 접두 매칭(예: 수원시장안구 → 수원시)
      // 개편 병합 폴리곤(옛 동구)은 데이터가 다른 버킷(중구)에 정규화돼 있어 버킷명으로 조회
      const bsgg = geoBucket(sido, sgg);
      const city = candidates.has(bsgg) ? bsgg : [...candidates].find(c => bsgg.startsWith(c));
      if (!city) continue; // 매칭되는 시군구 데이터 없음 → 무채색 유지
      let rec = agg.get(`${sido}|${city}|${name}`);
      if (!rec) {
        // 주소는 법정동(예: 화정동)인데 행정동은 분동(화정1동/화정2동)인 경우 — 숫자 뗀 기본명으로 폴백
        const base = name.replace(/\d+동$/, '동');
        if (base !== name) rec = agg.get(`${sido}|${city}|${base}`);
      }
      if (!rec) continue; // 해당 시군구는 있지만 이 동엔 데이터 없음(순증 0과 구분 위해 무채색 유지)
      const net = rec.new - rec.closed;
      let tone = 'zero';
      let t = 0;
      // 동 단위는 시군구보다 규모가 작아 스케일 축소(÷8 vs 시군구 ÷25)
      if (net > 0)      { tone = 'pos'; t = Math.min(net / 8, 1); }
      else if (net < 0) { tone = 'neg'; t = Math.min(Math.abs(net) / 8, 1); }
      map.setFeatureState({ source: 'dong', id: f.id }, { tone, t, nnew: rec.new, closed: rec.closed, net, sido });
    }
  }

  // ─── STORE POINT / HEATMAP LAYERS ──────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function ensureStoreLayers(mapInstance: any) {
    if (storeLayerReadyRef.current || !mapInstance) return;

    mapInstance.addSource('stores', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    // 히트맵 — 줌아웃 시 동 단위 신규 농도
    mapInstance.addLayer({
      id: 'store-heat', type: 'heatmap', source: 'stores',
      layout: { visibility: 'none' },
      paint: {
        'heatmap-weight': ['case', ['==', ['get', 'status'], 'new'], 1, 0.3],
        'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.7, 14, 1.6],
        'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 14, 12, 26, 15, 40],
        'heatmap-color': [
          'interpolate', ['linear'], ['heatmap-density'],
          0, 'rgba(22,163,74,0)',
          0.25, 'rgba(134,239,172,0.55)',
          0.55, 'rgba(34,197,94,0.75)',
          0.85, 'rgba(21,128,61,0.9)',
          1, 'rgba(20,83,45,1)',
        ],
        'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.85, 15, 0.55],
      },
    });

    // 점 — 신규 초록 / 폐업 빨강
    mapInstance.addLayer({
      id: 'store-point', type: 'circle', source: 'stores',
      layout: { visibility: 'visible' },
      paint: {
        // 100평+(big=1)은 크게 + 굵은 링으로 강조.
        // zoom 표현식은 top-level interpolate여야 하므로, 분기는 각 stop 출력에 넣는다.
        'circle-radius': ['interpolate', ['linear'], ['zoom'],
          8, ['case', ['==', ['get', 'big'], 1], 4.5, 2.6],
          11, ['case', ['==', ['get', 'big'], 1], 7, 4],
          14, ['case', ['==', ['get', 'big'], 1], 11, 6.5],
          16, ['case', ['==', ['get', 'big'], 1], 15, 9],
        ],
        'circle-color': ['get', 'color'],
        'circle-opacity': 0.85,
        'circle-stroke-width': ['case', ['==', ['get', 'big'], 1], 2.4, 0.7],
        'circle-stroke-color': ['get', 'ring'],
        'circle-stroke-opacity': 0.95,
      },
    });

    // 선택된 매장 강조 — 흰 헤일로(뒤) + 파란 링(앞). 표시모드 무관 항상 표시.
    mapInstance.addSource('store-sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    mapInstance.addLayer({
      id: 'store-sel-halo', type: 'circle', source: 'store-sel',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 11, 12, 17, 15, 24, 17, 32],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 7, 'circle-stroke-color': '#ffffff', 'circle-stroke-opacity': 0.9,
      },
    });
    mapInstance.addLayer({
      id: 'store-sel-ring', type: 'circle', source: 'store-sel',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 11, 12, 17, 15, 24, 17, 32],
        'circle-color': 'rgba(0,0,0,0)',
        'circle-stroke-width': 3, 'circle-stroke-color': '#2563eb', 'circle-stroke-opacity': 1,
      },
    });

    // 매장 점 — hover 시 거의 불투명한 다크 카드 툴팁 (블러로 인한 배경 겹침 방지)
    const POP = 'background:rgba(15,23,42,0.96);color:#fff;border-radius:10px;padding:9px 12px;font-size:12px;max-width:240px;border:1px solid rgba(255,255,255,0.08);box-shadow:0 6px 20px rgba(0,0,0,0.28)';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const storeHtml = (p: any) => {
      const cb = colorblindRef.current;
      const sc = p.status === 'new' ? (cb ? '#60a5fa' : '#4ade80') : (cb ? '#fb923c' : '#f87171');
      const label = p.status === 'new' ? '신규' : '폐업';
      const bigBadge = String(p.big) === '1' ? ' <span style="color:#fbbf24;font-weight:700">· 100평+</span>' : '';
      const meta = [p.category, p.pyeong && Number(p.pyeong) ? `${p.pyeong}평` : '', p.month].filter(Boolean).join(' · ');
      return `<div style="${POP}"><div style="font-weight:700;font-size:13px;margin-bottom:2px">${p.name || '매장'} <span style="color:${sc};font-weight:700">${label}</span>${bigBadge}</div><div style="color:#cbd5e1;font-size:11px">${meta}</div></div>`;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapInstance.on('mousemove', 'store-point', (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      mapInstance.getCanvas().style.cursor = 'pointer';
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ML = (window as any).maplibregl;
      if (!ML) return;
      if (!storeHoverPopupRef.current) storeHoverPopupRef.current = new ML.Popup({ closeButton: false, closeOnClick: false, offset: 12, className: 'fs-pop' });
      storeHoverPopupRef.current.setLngLat(e.lngLat).setHTML(storeHtml(f.properties || {})).addTo(mapInstance);
    });
    mapInstance.on('mouseleave', 'store-point', () => {
      mapInstance.getCanvas().style.cursor = '';
      if (storeHoverPopupRef.current) storeHoverPopupRef.current.remove();
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mapInstance.on('click', 'store-point', (e: any) => {
      const f = e.features?.[0]; if (!f) return;
      const p = f.properties || {};
      const coords = f.geometry?.coordinates || [];
      const lng = Number(coords[0]), lat = Number(coords[1]);
      // 해당 시군구 패널을 열고(없으면), 그 매장을 리스트에서 선택·스크롤
      if (p.sigungu) openDrilldown(String(p.sigungu), p.sido ? String(p.sido) : undefined);
      selectStore(String(p.k || storeKey(p.name, lat, lng)), lat, lng, false);
    });

    storeLayerReadyRef.current = true;
  }

  // 필터(월·업종·선택 동) 적용된 매장 → GeoJSON 포인트
  function buildStoreFeatures(
    stores: StoreRow[], month: string | null, monthTo: string | null, cat: Category,
    dongFilter?: { sigungu: string; dong: string } | null,
  ) {
    const cb = colorblindRef.current;
    const newC = cb ? '#2563eb' : '#16a34a';   // 색각보정: 신규=파랑 / 폐업=주황 (적록 회피)
    const closedC = cb ? '#f97316' : '#e24b4a';
    const bigRing = cb ? '#a855f7' : '#f59e0b'; // 100평+ 링: 일반 앰버 / 색각보정 보라
    const feats = [];
    for (const s of stores) {
      if (s.lat == null || s.lng == null) continue;
      if (!monthInSel(s.month, month, monthTo)) continue;
      if (!passesFilters(s, cat, targetOnlyRef.current)) continue;
      if (dongFilter && (!sigunguMatches(s.sido, s.sigungu, dongFilter.sigungu) || s.dong !== dongFilter.dong)) continue;
      const big = (s.pyeong || 0) >= 100 ? 1 : 0;
      feats.push({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [s.lng, s.lat] },
        properties: {
          name: s.name, status: s.status, category: s.category || '',
          pyeong: s.pyeong || 0, month: s.month,
          sigungu: s.sigungu, sido: s.sido, lat: s.lat, lng: s.lng,
          k: storeKey(s.name, s.lat, s.lng),
          big,
          color: s.status === 'new' ? newC : closedC,
          ring: big ? bigRing : '#ffffff',
        },
      });
    }
    return { type: 'FeatureCollection' as const, features: feats };
  }

  // 매장 레이어 데이터 + 표시 모드 반영 (refs 사용 — 핸들러 재생성 회피)
  function updateStoreLayer() {
    const mapInstance = mapRef.current;
    if (!mapInstance || !storeLayerReadyRef.current) return;
    const mode = displayModeRef.current;
    const is3d = mode === 'd3';

    const dongFilter = selectedDongRef.current && drillRegionRef.current
      ? { sigungu: drillRegionRef.current, dong: selectedDongRef.current }
      : null;
    const data = buildStoreFeatures(cachedStoresRef.current, selectedMonthRef.current, rangeToRef.current, selectedCategoryRef.current, dongFilter);
    const src = mapInstance.getSource('stores');
    if (src) src.setData(data);

    mapInstance.setLayoutProperty('store-point', 'visibility', mode === 'points' ? 'visible' : 'none');
    mapInstance.setLayoutProperty('store-heat', 'visibility', mode === 'heat' ? 'visible' : 'none');
    // 히트맵 램프도 색각보정 반영 (초록 → 파랑)
    if (mapInstance.getLayer('store-heat')) {
      mapInstance.setPaintProperty('store-heat', 'heatmap-color', colorblindRef.current
        ? ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(37,99,235,0)', 0.25, 'rgba(147,197,253,0.55)', 0.55, 'rgba(59,130,246,0.78)', 0.85, 'rgba(29,78,216,0.92)', 1, 'rgba(30,58,138,1)']
        : ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(22,163,74,0)', 0.25, 'rgba(134,239,172,0.55)', 0.55, 'rgba(34,197,94,0.75)', 0.85, 'rgba(21,128,61,0.9)', 1, 'rgba(20,83,45,1)']);
    }
    if (mapInstance.getLayer('muni-extrusion')) {
      mapInstance.setLayoutProperty('muni-extrusion', 'visibility', is3d ? 'visible' : 'none');
    }

    // 입체 모드에선 평면 면을 숨기고(블록만), 그 외엔 모드별로 면 색 농도 조절
    if (mapInstance.getLayer('muni-fill')) {
      mapInstance.setLayoutProperty('muni-fill', 'visibility', is3d ? 'none' : 'visible');
      if (!is3d) {
        mapInstance.setPaintProperty('muni-fill', 'fill-opacity',
          mode === 'area'
            ? ['case', ['==', ['coalesce', ['feature-state', 'tone'], 'none'], 'none'], 0.25, 0.72]
            : ['case', ['==', ['coalesce', ['feature-state', 'tone'], 'none'], 'none'], 0.12, 0.38]);
      }
    }
    // 동 그라데이션 — muni-fill과 동일한 모드별 농도, 줌 10.5~11.3 구간 페이드인은 유지
    if (mapInstance.getLayer('dong-fill')) {
      mapInstance.setLayoutProperty('dong-fill', 'visibility', is3d ? 'none' : 'visible');
      if (!is3d) {
        const maxOpacity = mode === 'area'
          ? ['case', ['==', ['coalesce', ['feature-state', 'tone'], 'none'], 'none'], 0.25, 0.72]
          : ['case', ['==', ['coalesce', ['feature-state', 'tone'], 'none'], 'none'], 0.12, 0.38];
        mapInstance.setPaintProperty('dong-fill', 'fill-opacity', ['interpolate', ['linear'], ['zoom'], 10.5, 0, 11.3, maxOpacity]);
      }
    }
    updateDongFillState();
  }

  function handleSetDisplayMode(mode: DisplayMode) {
    setDisplayMode(mode);
    displayModeRef.current = mode;
    updateStoreLayer();
    // 입체 모드는 지도를 기울여(pitch) 3D로, 벗어나면 평면으로 복귀
    const map = mapRef.current;
    if (map) {
      if (mode === 'd3') map.easeTo({ pitch: 52, duration: 700 });
      else if (map.getPitch() > 0) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
      nudgePaint();
    }
  }

  // ─── INIT DASHBOARD ────────────────────────────────────────────────────────

  useEffect(() => {
    async function init() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const bu = user.user_metadata?.business_unit || '';
        const { data: mgrs, error } = await supabase
          .from('managers')
          .select('region1, region2')
          .eq('business_unit', bu)
          .neq('region2', '지점장');
        if (error) throw error;

        const rows = mgrs || [];
        const newSidoSigunguMap: Record<string, string[]> = {};
        const newSigunguSidoMap: Record<string, string> = {};
        rows.forEach((m: { region1?: string; region2?: string }) => {
          const sido = normSido(m.region1);
          const sgu  = m.region2?.trim();
          if (!sido || !sgu) return;
          if (!newSidoSigunguMap[sido]) newSidoSigunguMap[sido] = [];
          if (!newSidoSigunguMap[sido].includes(sgu)) newSidoSigunguMap[sido].push(sgu);
          newSigunguSidoMap[sgu] = sido;
        });

        setSidoSigunguMap(newSidoSigunguMap);
        setSigunguSidoMap(newSigunguSidoMap);
        sigunguSidoMapRef.current = newSigunguSidoMap;

        // Load initial data
        await loadDashboardData('branch', null, newSidoSigunguMap, newSigunguSidoMap);
      } catch (e) {
        console.error('[discover] init error', e);
        setLastSync('초기화 실패');
        toast.error('초기화에 실패했습니다');
      } finally {
        setLoading(false);
      }
    }
    init();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── LOAD DASHBOARD DATA ───────────────────────────────────────────────────

  // 좌표 없는 레코드(신규 인허가는 공공 API에 좌표가 아직 없음) 주소 → 좌표 백필.
  // 본 로드는 주소를 안 내려받으므로(컬럼 다이어트) 결측 행(전체의 <1%)만 여기서 별도 조회한다.
  // 홈 지도와 동일한 Naver 지오코더+localStorage 캐시 사용. 백그라운드로 돌며 점이 점진적으로 나타남.
  // 성공분은 /api/market-geocode로 DB에도 저장 — 첫 사용자가 채우면 이후 세션·사용자는 재지오코딩 불필요.
  const runGeocodeBackfill = useCallback(async (minMonth: string) => {
    const runId = ++geocodeRunRef.current; // 새 로드가 시작되면 이전 백필 중단
    const { data } = await supabase.from('market_store_records')
      .select('id,name,status,addr_key,address')
      .in('sido', scopeSidosRef.current).gte('month', minMonth).is('lat', null)
      .order('month', { ascending: false }).limit(1000); // 최신 월 우선 (점이 빨리 채워지도록)
    const missing = data || [];
    if (!missing.length || geocodeRunRef.current !== runId) return;
    try { await loadNaverMaps(); } catch { return; }
    if (geocodeRunRef.current !== runId) return;
    // 화면 행 매칭 인덱스 (이름|주소지문|상태) — 좌표를 화면 점에도 반영
    const byKey = new Map<string, StoreRow[]>();
    for (const r of cachedStoresRef.current) {
      if (r.lat != null) continue;
      const k = `${r.name}|${r.addrKey}|${r.status}`;
      let list = byKey.get(k);
      if (!list) { list = []; byKey.set(k, list); }
      list.push(r);
    }
    // 서버 공유 무매칭 목록 — 영구 실패 확정 주소는 시도 자체를 생략 (쿼터 절약).
    // 새로 확정된 무매칭은 저장 요청에 실어 서버 목록에 병합.
    let noMatchSet = new Set<string>();
    try {
      const r = await fetch('/api/market-geocode');
      if (r.ok) noMatchSet = new Set<string>((await r.json()).noMatch || []);
    } catch { /* 목록 없이도 기존 동작 유지 */ }
    const newNoMatch = new Set<string>();

    const coordByAddr = new Map<string, { lat: number; lng: number } | null>();
    let pendingSave: { id: number; lat: number; lng: number }[] = [];
    const flushSave = async () => {
      if (!pendingSave.length && !newNoMatch.size) return;
      const body = JSON.stringify({ updates: pendingSave, noMatch: [...newNoMatch] });
      pendingSave = [];
      newNoMatch.clear();
      try {
        await fetch('/api/market-geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      } catch { /* 저장 실패해도 이번 세션 화면 표시는 유지 */ }
    };
    let patched = 0;
    for (const s of missing) {
      if (geocodeRunRef.current !== runId) { await flushSave(); return; }
      if (!s.address) continue;
      const addr = cleanGeocodeQuery(s.address);
      if (noMatchSet.has(addr)) continue;
      let c = coordByAddr.get(addr);
      if (c === undefined) {
        const d = await cachedGeocodeDetailed(addr);
        c = d.coords;
        coordByAddr.set(addr, c);
        if (d.noMatch) { noMatchSet.add(addr); newNoMatch.add(addr); }
      }
      if (!c) continue;
      pendingSave.push({ id: s.id, lat: c.lat, lng: c.lng });
      for (const row of byKey.get(`${s.name}|${s.addr_key}|${s.status}`) || []) { row.lat = c.lat; row.lng = c.lng; }
      if (++patched % 20 === 0) updateStoreLayer();
      if (pendingSave.length >= 100) await flushSave();
    }
    if (patched) updateStoreLayer();
    await flushSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadDashboardData = useCallback(async (
    mode: RegionMode,
    sido: string | null,
    sSigunguMap: Record<string, string[]> = sidoSigunguMap,
    sguSidoMap: Record<string, string> = sigunguSidoMap,
  ) => {
    setRefreshing(true);
    setLastSync('로딩 중...');
    const runId = ++loadRunRef.current; // 이 로드가 최신인지 판별 (지역 연속 전환 대비)
    let statsShown = false; // 빠른 통계 경로(RPC)가 KPI/랭킹을 이미 렌더했는지
    mapCenteredRef.current = false;
    // 행정동 경계 스코프 갱신 (줌인 시 이 시도들 경계를 로드) — 스코프 바뀌면 재로드
    scopeSidosRef.current = mode === 'sido' && sido ? [sido] : Object.keys(sSigunguMap);
    dongLoadedKeyRef.current = '';

    try {
      // 단일 소스: market_store_records만 읽고, 독/KPI/랭킹/면/차트/드릴다운 전부 이 데이터로 집계.
      // (예전엔 독은 market_snapshots 집계·드릴다운은 store_records라 숫자가 어긋났음 → 통일)
      // PostgREST max-rows(≈1000) 캡 때문에 .order('id')+.range() 페이지네이션 필수.
      // 좌표 없는 레코드도 포함 — 집계는 전건 기준. 점/히트맵만 buildStoreFeatures에서 좌표 필터.
      // 컬럼 다이어트: 지도·집계에 필요한 최소 컬럼만 (주소·인허가일은 드릴다운 열 때 지연 로드)
      const storeCols = 'name,sigungu,month,status,category,pyeong,lat,lng,dong,addr_key';
      const PAGE = 1000;
      // 최근 36개월(3년) 롤링 윈도우 — 백필된 과거치까지 노출
      const minMonth = monthsAgoStr(35);
      const recentMin = monthsAgoStr(11); // 우선 로딩 창(최근 12개월) — 첫 지도를 ⅓ 용량으로

      // 세션 캐시 조회 — 이번 세션에 이미 받아본 지역이면 다운로드·RPC 없이 즉시 표시
      const cacheKey = mode === 'sido' && sido
        ? `sido|${sido}`
        : `mine|${Object.entries(sSigunguMap).map(([s, list]) => `${s}:${list.join(',')}`).join(';')}`;
      // 빈 캐시는 미스로 취급 — 과거 로드가 실패해 빈 배열이 남아 있으면 그 지역이 새로고침 전까지
      // 계속 빈 화면으로 보이는 버그가 됨(크롬처럼 탭을 오래 켜두는 환경에서 발생). 재조회로 자가 복구.
      const cachedHit = storeCacheRef.current.get(cacheKey);
      const cachedRows = cachedHit && cachedHit.length ? cachedHit : undefined;

      // ── 빠른 통계 경로: 서버 집계 RPC(discover_market_agg) ──────────────────────
      // KPI/랭킹/시군구 지도를 원본 12만행 다운로드를 기다리지 않고 즉시 렌더한다.
      // dedup+집계는 서버가 수행하며 클라 집계와 수치가 동일함(파리티 검증됨: 45,257/73,691).
      // 지도 점·동채색·지오코딩은 아래 원본 경로가 이어서 채우고 통계도 동일 수치로 재확인(폴백).
      // RPC가 실패/빈값이면 statsShown=false로 남아 원본 경로가 단독으로 정확히 렌더한다.
      const scopeSnaps = (rows: SnapRow[]): SnapRow[] => {
        if (mode === 'sido' && sido) return rows.filter(r => r.sido === sido);
        const allow = new Set<string>();
        Object.entries(sSigunguMap).forEach(([s, list]) => list.forEach(g => allow.add(`${s}|${g}`)));
        return rows.filter(r => allow.has(`${r.sido}|${r.sigungu}`));
      };
      if (!cachedRows) try {
        const { data: aggData, error: aggErr } = await supabase.rpc('discover_market_agg', { p_min_month: minMonth });
        if (!aggErr && Array.isArray(aggData) && loadRunRef.current === runId) {
          const snapsFast = scopeSnaps((aggData as Array<{ sido: string; sigungu: string; month: string; new_count: number; closed_count: number }>)
            .map(r => ({ sido: r.sido, sigungu: r.sigungu, month: r.month, new_count: r.new_count, closed_count: r.closed_count, updated_at: '' })));
          if (snapsFast.length) {
            setCachedSnaps(snapsFast);
            const selM = selectedMonthRef.current;
            if (selM && !snapsFast.some(r => r.month === selM)) {
              const latest = snapsFast.reduce((m, r) => (r.month > m ? r.month : m), '');
              setSelectedMonth(latest); selectedMonthRef.current = latest;
            }
            const upMap: Record<string, string> = mode === 'sido' && sido ? { ...sguSidoMap } : {};
            if (mode === 'sido' && sido) snapsFast.forEach(r => { upMap[r.sigungu] = r.sido; });
            else Object.entries(sSigunguMap).forEach(([s, list]) => list.forEach(g => { upMap[g] = s; }));
            setSigunguSidoMap(upMap); sigunguSidoMapRef.current = upMap;
            applyFiltersInternal(snapsFast, selectedMonthRef.current, rangeToRef.current, mode, sido, sSigunguMap);
            setRefreshing(false);
            statsShown = true;
          }
        }
      } catch { /* RPC 실패 → 아래 원본 경로가 이어서 렌더 */ }

      // 점진 렌더 — 페이지가 도착하는 만큼 지도 점을 미리 찍는다(전체 완료를 기다리지 않음).
      // KPI/랭킹 등 통계는 부분값으로 깜빡이지 않게 여기서 건드리지 않고, 단계 완료 시 finishRows가 확정.
      const arrived: StoreRow[] = [];
      let loadFailed = false; // 페이지 로드 실패 흔적 — 불완전한 결과를 세션 캐시에 남기지 않기 위한 플래그
      let lastPaint = 0;
      const paintPartial = () => {
        if (loadRunRef.current !== runId) return; // 더 최신 로드가 시작됨 — 화면 덮어쓰기 금지
        const now = Date.now();
        if (now - lastPaint < 500) return; // 0.5초에 한 번만 다시 그리기
        lastPaint = now;
        cachedStoresRef.current = dedupeStoreEvents(arrived);
        updateStoreLayer();
      };

      // 총건수를 먼저 구해 페이지를 병렬로 로드(3년치=대량이라 순차면 느림). count 불가 시 순차 폴백.
      // 각 페이지는 도착 즉시 StoreRow로 변환·누적하고 paintPartial로 점을 찍는다.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loadScoped = async (applyFilters: (q: any) => any, toRow: (r: any) => StoreRow) => {
        const acc: StoreRow[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const onPage = (data: any[] | null, error: any): number => {
          if (error) { console.warn('[discover] 매장 페이지 로드 실패', error); loadFailed = true; return 0; }
          const rows = (data || []).map(toRow);
          acc.push(...rows);
          arrived.push(...rows);
          paintPartial();
          return rows.length;
        };
        const { count } = await applyFilters(supabase.from('market_store_records').select('id', { count: 'exact', head: true }));
        if (count != null && count >= 0) {
          const pages = Math.min(Math.max(1, Math.ceil(count / PAGE)), 120);
          await Promise.all(
            Array.from({ length: pages }, (_, i) =>
              applyFilters(supabase.from('market_store_records').select(storeCols)).order('id').range(i * PAGE, i * PAGE + PAGE - 1)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .then(({ data, error }: any) => onPage(data, error)))
          );
          return acc;
        }
        for (let from = 0; from < 200000; from += PAGE) { // 폴백: 순차 드레인
          const { data, error } = await applyFilters(supabase.from('market_store_records').select(storeCols)).order('id').range(from, from + PAGE - 1);
          if (error) { onPage(null, error); break; }
          if (onPage(data, null) < PAGE) break;
        }
        return acc;
      };
      // 시도별 스코프 — sido 컬럼은 전송하지 않고 클라에서 주입 (조회 조건에 이미 있으므로)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scopes: Array<[string, (q: any) => any]> = mode === 'sido' && sido
        ? [[sido, (q: any) => q.eq('sido', sido)]]
        : Object.entries(sSigunguMap).map(([s, list]) => [s, (q: any) => q.eq('sido', s).in('sigungu', list)]);

      const loadPhase = async (from: string, to?: string): Promise<StoreRow[]> => (await Promise.all(
        scopes.map(([s, filter]) => loadScoped(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (q: any) => { const b = filter(q).gte('month', from); return to ? b.lt('month', to) : b; },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any): StoreRow => ({
            name: r.name, sido: s, sigungu: r.sigungu, month: r.month,
            status: r.status === 'closed' ? 'closed' : 'new',
            category: r.category, pyeong: r.pyeong != null ? Number(r.pyeong) : null,
            lat: r.lat != null ? Number(r.lat) : null, lng: r.lng != null ? Number(r.lng) : null,
            dong: r.dong || '기타', addrKey: r.addr_key || '',
          }),
        ))
      )).flat();

      // 화면 반영 — 1·2단계 로딩이 같은 경로를 재사용
      const finishRows = (raw: StoreRow[]) => {
        if (loadRunRef.current !== runId) return; // 더 최신 로드가 시작됨 — 화면 덮어쓰기 금지
        // 반복 노출 중복 제거(dedupeStoreEvents 주석 참고) — KPI/랭킹/동별/드릴다운/지도 점이
        // 전부 이 배열에서 파생되므로 여기 한 곳에서 걸러야 화면 간 숫자가 일치한다.
        const storeRows = dedupeStoreEvents(raw);
        setCachedStores(storeRows);
        cachedStoresRef.current = storeRows;

        // 선택 월에 데이터가 없으면(월초 야간수집 前·수집 지연 등) 데이터가 있는 최신 월로 폴백
        // — 캘린더상 새 달로 넘어갔지만 아직 그 달 데이터가 없을 때 화면 전체가 0으로 비는 문제 방지
        const selM = selectedMonthRef.current;
        if (selM && storeRows.length && !storeRows.some(r => r.month === selM)) {
          const latest = storeRows.reduce((m, r) => (r.month > m ? r.month : m), '');
          setSelectedMonth(latest);
          selectedMonthRef.current = latest;
        }

        // sigunguSidoMap 갱신 (지도 중심 이동·라벨용)
        const updatedMap: Record<string, string> = mode === 'sido' && sido ? { ...sguSidoMap } : {};
        if (mode === 'sido' && sido) {
          storeRows.forEach(r => { updatedMap[r.sigungu] = r.sido; });
        } else {
          Object.entries(sSigunguMap).forEach(([s, list]) => list.forEach(sgu => { updatedMap[sgu] = s; }));
        }
        setSigunguSidoMap(updatedMap);
        sigunguSidoMapRef.current = updatedMap;

        // 매장 → SnapRow 집계 (다운스트림 KPI/랭킹/면/차트는 SnapRow를 그대로 소비)
        const snaps = aggregateSnaps(storeRows, targetOnlyRef.current, selectedCategoryRef.current);
        setCachedSnaps(snaps);
        // 선택 월 존중 (예전엔 null 고정 → 칩은 특정 월인데 KPI/랭킹은 3년 누적으로 어긋났음)
        applyFiltersInternal(snaps, selectedMonthRef.current, rangeToRef.current, mode, sido, sSigunguMap);
      };

      if (cachedRows) {
        // 재방문 지역 — 세션 캐시로 다운로드 없이 즉시 표시
        finishRows(cachedRows);
      } else {
        // 1단계: 최근 12개월 먼저 렌더 → 2단계: 과거 24개월 병합 재렌더
        let raw = await loadPhase(recentMin);
        finishRows(raw);
        const older = await loadPhase(minMonth, recentMin);
        if (older.length) { raw = raw.concat(older); finishRows(raw); }
        // 완전한 결과만 기억 — 실패 흔적이 있거나 빈 결과면 캐시하지 않고 다음 방문 때 재조회
        if (!loadFailed && raw.length) storeCacheRef.current.set(cacheKey, raw);
      }
      void runGeocodeBackfill(minMonth); // 좌표 결측분 백그라운드 지오코딩(신규 인허가 등)

      // "갱신 시각"은 행 전체 대신 최신 1건만 조회 (updated_at 컬럼 다이어트 대체)
      void supabase.from('market_store_records').select('updated_at')
        .order('updated_at', { ascending: false }).limit(1).then(({ data }) => {
          const t = data?.[0]?.updated_at;
          setLastSync(t ? `갱신 ${new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '데이터 없음');
        });

    } catch (e) {
      console.error('[discover] load error', e);
      // 빠른 통계 경로가 이미 KPI/랭킹을 렌더했으면(지도 원본만 실패) 통계는 유효 → 오류 표기 억제
      if (!statsShown) {
        setLastSync('오류');
        toast.error('데이터 로드에 실패했습니다');
      }
    } finally {
      if (loadRunRef.current === runId) setRefreshing(false); // 이전 로드가 새 로드의 스피너를 끄지 않게
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidoSigunguMap, sigunguSidoMap]);

  // ─── APPLY FILTERS ─────────────────────────────────────────────────────────

  function applyFiltersInternal(
    snaps: SnapRow[],
    month: string | null,
    monthTo: string | null,
    mode: RegionMode,
    sido: string | null,
    sSigunguMap: Record<string, string[]>,
  ) {
    if (!snaps.length) {
      setKpiNew('0'); setKpiClosed('0'); setKpiNet('0'); setKpiRate('0');
      setCachedRegionsArr([]);
      return;
    }

    const displaySnaps = month ? snaps.filter(r => monthInSel(r.month, month, monthTo)) : snaps;

    const regions: Record<string, { new: number; closed: number; sido: string }> = {};
    displaySnaps.forEach(r => {
      if (!regions[r.sigungu]) regions[r.sigungu] = { new: 0, closed: 0, sido: r.sido || '' };
      regions[r.sigungu].new    += r.new_count    || 0;
      regions[r.sigungu].closed += r.closed_count || 0;
    });

    const arr: RegionData[] = Object.entries(regions)
      .map(([region, { new: n, closed: c, sido }]) => ({
        region, sido, new: n, closed: c, net: n - c,
        netRate: n > 0 ? Math.round(((n - c) / n) * 100) : (c > 0 ? -100 : 0),
      }))
      .sort((a, b) => b.new - a.new);

    const totalNew    = arr.reduce((s, r) => s + r.new,    0);
    const totalClosed = arr.reduce((s, r) => s + r.closed, 0);
    const net = totalNew - totalClosed;
    const rate = totalNew > 0 ? Math.round((net / totalNew) * 100) : 0;

    setKpiNew(totalNew.toLocaleString());
    setKpiClosed(totalClosed.toLocaleString());
    setKpiNet((net > 0 ? '+' : '') + net.toLocaleString());
    setKpiRate((rate > 0 ? '+' : '') + rate + '%');
    setCachedRegionsArr(arr);

    // Render map
    renderMap(arr, mode, sido, sSigunguMap);
  }

  function applyFilters(snaps = cachedSnaps, month = selectedMonth) {
    applyFiltersInternal(snaps, month, rangeTo, regionMode, regionSido, sidoSigunguMap);
  }

  // ─── MAP RENDER ────────────────────────────────────────────────────────────

  function renderMap(
    regions: RegionData[],
    mode: RegionMode,
    sido: string | null,
    sSigunguMap: Record<string, string[]>,
  ) {
    const doRender = async () => {
      const geo = geoDataRef.current || await loadGeoData();
      if (!mapRef.current || !geo) return;

      if (!mapCenteredRef.current) {
        // 내 지점(여러 시도) = 매장 전체 범위로 맞춤(경기+인천 다 보이게). 단일 시도 = 그 시도 중심.
        const pts = mode === 'branch'
          ? cachedStoresRef.current.filter(s => s.lat != null && s.lng != null)
          : [];
        if (pts.length) {
          let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
          for (const p of pts) {
            minLng = Math.min(minLng, p.lng!); maxLng = Math.max(maxLng, p.lng!);
            minLat = Math.min(minLat, p.lat!); maxLat = Math.max(maxLat, p.lat!);
          }
          // 좌측 230px 패딩은 PC 드릴다운 패널 공간 — 모바일에 그대로 쓰면 지도가 과도하게 축소됨
          const mobilePad = typeof window !== 'undefined' && window.innerWidth < 768;
          mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: mobilePad
              ? { top: 60, bottom: 110, left: 28, right: 28 }
              : { top: 80, bottom: 120, left: 230, right: 50 },
            maxZoom: 11, duration: 800,
          });
          mapCenteredRef.current = true;
        } else {
          const primarySido = (mode === 'sido' && sido)
            ? sido
            : Object.entries(sSigunguMap).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || '경기도';
          const cfg = SIDO_CENTER[primarySido];
          if (cfg) {
            mapRef.current.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 800 });
            mapCenteredRef.current = true;
          }
        }
      }

      renderGeoMap(regions, geo, mapRef.current);
    };

    if (!mapReadyRef.current) {
      pendingMapRenderRef.current = doRender;
    } else {
      doRender();
    }
  }

  // ─── REGION MODE CHANGE ────────────────────────────────────────────────────

  async function handleSetRegionMode(mode: RegionMode, sido?: string) {
    mapCenteredRef.current = false;
    setRegionModeState(mode);
    setRegionSido(sido || null);
    viewSidoRef.current = sido || null;
    await loadDashboardData(mode, sido || null);
  }

  // ─── MONTH SELECT ──────────────────────────────────────────────────────────

  function handleMonthSelect(month: string | null) {
    setSelectedMonth(month);
    selectedMonthRef.current = month;
    setRangeTo(null);
    rangeToRef.current = null;
    applyFiltersInternal(cachedSnaps, month, null, regionMode, regionSido, sidoSigunguMap);
    // Scroll active pill into view
    setTimeout(() => {
      if (!monthTimelineRef.current) return;
      if (month) {
        const el = monthTimelineRef.current.querySelector(`[data-month="${month}"]`) as HTMLElement;
        el?.scrollIntoView({ inline: 'nearest', behavior: 'smooth', block: 'nearest' });
      } else {
        monthTimelineRef.current.scrollLeft = 0;
      }
      mapRef.current?.resize();
    }, 60);
  }

  // 기간(시작~종료월) 선택 — 같은 달이면 단일 월 선택과 동일 처리
  function handleRangeSelect(from: string, to: string) {
    stopPlay();
    if (from === to) { handleMonthSelect(from); return; }
    setSelectedMonth(from);
    selectedMonthRef.current = from;
    setRangeTo(to);
    rangeToRef.current = to;
    applyFiltersInternal(cachedSnaps, from, to, regionMode, regionSido, sidoSigunguMap);
    setTimeout(() => { mapRef.current?.resize(); }, 60);
  }

  // ─── VIEW MODE TOGGLE ──────────────────────────────────────────────────────

  function handleSetViewMode(mode: ViewMode) {
    setViewMode(mode);
    if (mode !== 'map') stopPlay();
    if (mode === 'plan' && panelOpen) closePanel(); // 랭킹 드릴다운 패널이 운영계획 화면을 덮은 채 남지 않게
    if (mode === 'map') {
      setTimeout(() => { mapRef.current?.resize(); }, 100);
      setTimeout(() => { mapRef.current?.resize(); }, 350);
    }
  }

  // ─── TIMELAPSE PLAY ────────────────────────────────────────────────────────

  function stopPlay() {
    if (playTimerRef.current) { clearInterval(playTimerRef.current); playTimerRef.current = null; }
    setPlaying(false);
  }

  function handleTogglePlay() {
    if (playTimerRef.current) { stopPlay(); return; }
    let idx = selectedMonth ? monthList.indexOf(selectedMonth) : -1;
    if (idx >= monthList.length - 1) idx = -1; // 끝(또는 전체)이면 처음부터
    setPlaying(true);
    const step = () => {
      idx += 1;
      if (idx >= monthList.length) { stopPlay(); return; }
      handleMonthSelect(monthList[idx]);
    };
    step();
    playTimerRef.current = setInterval(step, 750);
  }

  // 언마운트 시 타이머 정리
  useEffect(() => () => { if (playTimerRef.current) clearInterval(playTimerRef.current); }, []);

  // ─── CHARTS ────────────────────────────────────────────────────────────────

  useEffect(() => {
    if (viewMode !== 'rank' || !cachedSnaps.length) return;
    renderOverallChart();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, cachedSnaps, cachedRegionsArr]);

  useEffect(() => {
    if (!spChartOpen || !currentDrillRegion) return;
    renderRegionChart(currentDrillRegion);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spChartOpen, currentDrillRegion]);

  async function getChartJS() {
    const { Chart, registerables } = await import('chart.js');
    Chart.register(...registerables);
    return Chart;
  }

  async function renderChartOnCanvas(
    canvas: HTMLCanvasElement | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    existingChart: any,
    monthly: Array<{ month: string; new: number; closed: number }>,
    highlightMonth: string | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    setter: (c: any) => void,
  ) {
    if (!canvas) return;
    if (existingChart) existingChart.destroy();

    const Chart = await getChartJS();
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const labels     = monthly.map(m => m.month.slice(2));
    const newData    = monthly.map(m => m.new);
    const closedData = monthly.map(m => m.closed);
    const netData    = monthly.map(m => m.new - m.closed);

    const hlMonths = highlightMonth
      ? [highlightMonth, addMonths(highlightMonth, -1), addMonths(highlightMonth, -12)]
      : [];

    const mkBg = (i: number, hiC: string, loA: string) => {
      if (!hlMonths.length) return hiC;
      const m = '20' + labels[i];
      if (m === highlightMonth) return hiC;
      if (hlMonths.includes(m)) return loA.replace(/[\d.]+\)$/, '0.45)');
      return loA;
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart = new Chart(ctx as any, {
      data: {
        labels,
        datasets: [
          {
            type: 'bar' as const, label: '신규', data: newData,
            backgroundColor: newData.map((_, i) => mkBg(i, 'rgba(52,199,89,.8)', 'rgba(52,199,89,.07)')),
            borderColor: 'rgba(52,199,89,.6)', borderWidth: 1, borderRadius: 3, yAxisID: 'y',
          },
          {
            type: 'bar' as const, label: '폐업', data: closedData,
            backgroundColor: closedData.map((_, i) => mkBg(i, 'rgba(255,59,48,.75)', 'rgba(255,59,48,.06)')),
            borderColor: 'rgba(255,59,48,.5)', borderWidth: 1, borderRadius: 3, yAxisID: 'y',
          },
          {
            type: 'line' as const, label: '순증', data: netData,
            borderColor: 'rgba(0,113,227,.8)', backgroundColor: 'rgba(0,113,227,.06)',
            borderWidth: 2, pointRadius: 2.5, fill: true, tension: 0.35, yAxisID: 'y',
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { labels: { color: '#64748b', font: { size: 11 }, boxWidth: 10, padding: 12 } },
          tooltip: {
            backgroundColor: '#0f172a', borderColor: '#1e293b', borderWidth: 0,
            titleColor: '#f1f5f9', bodyColor: '#94a3b8', padding: 10, cornerRadius: 8,
            callbacks: { label: (c: { dataset: { label?: string }; raw: unknown }) => ` ${c.dataset.label}: ${c.raw}건` },
          },
        },
        scales: {
          x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { color: 'rgba(15,23,42,.04)' } },
          y: { ticks: { color: '#94a3b8', font: { size: 10 }, stepSize: 5 }, grid: { color: 'rgba(15,23,42,.04)' }, beginAtZero: true },
        },
      },
    });
    setter(chart);
  }

  function renderOverallChart() {
    const monthlyAll: Record<string, { new: number; closed: number }> = {};
    cachedSnaps.forEach(r => {
      if (!monthlyAll[r.month]) monthlyAll[r.month] = { new: 0, closed: 0 };
      monthlyAll[r.month].new    += r.new_count    || 0;
      monthlyAll[r.month].closed += r.closed_count || 0;
    });
    const filtered = monthList
      .map(m => ({ month: m, new: monthlyAll[m]?.new || 0, closed: monthlyAll[m]?.closed || 0 }))
      .filter(m => m.new + m.closed > 0);
    if (!filtered.length) return;
    renderChartOnCanvas(overallChartCanvasRef.current, overallChartRef.current, filtered, null, c => { overallChartRef.current = c; });
  }

  function renderRegionChart(sigungu: string) {
    const monthMap: Record<string, { new: number; closed: number }> = {};
    // 개편 폴리곤 드릴다운('검단구·서해구' 등)은 여러 구가 한 지역이므로 매칭되는 행을 합산
    cachedSnaps.filter(r => sigunguMatches(r.sido, r.sigungu, sigungu)).forEach(r => {
      const o = monthMap[r.month] ?? (monthMap[r.month] = { new: 0, closed: 0 });
      o.new += r.new_count || 0;
      o.closed += r.closed_count || 0;
    });
    const filtered = monthList
      .map(m => ({ month: m, new: monthMap[m]?.new || 0, closed: monthMap[m]?.closed || 0 }))
      .filter(m => m.new + m.closed > 0);
    if (!filtered.length) return;
    renderChartOnCanvas(trendChartCanvasRef.current, trendChartRef.current, filtered, selectedMonth, c => { trendChartRef.current = c; });
  }

  // ─── DRILLDOWN ─────────────────────────────────────────────────────────────

  // 옛 maeilfs-sales API 대신 로컬 cachedStores에서 즉시 집계 (월·업종은 렌더 시점 라이브 적용)
  function openDrilldown(sigungu: string, sido?: string) {
    const stores = cachedStoresRef.current;
    // 신구명 모두 매칭(개편 폴리곤 클릭 시 검단구·서해구 데이터가 '서구'로 들어옴)
    let rows = stores.filter(s => sigunguMatches(s.sido, s.sigungu, sigungu));
    // geojson은 구 단위(예: 고양시덕양구)인데 데이터는 시 단위(고양시)일 수 있음 → 시 폴백
    if (!rows.length) {
      const parent = [...new Set(stores.map(s => s.sigungu))].find(sg => sg.endsWith('시') && sigungu.startsWith(sg));
      if (parent) { sigungu = parent; rows = stores.filter(s => s.sigungu === parent); }
    }
    // sido 모르면 데이터에서 유추 (중복명 구분용)
    const sd = sido || rows[0]?.sido || '';
    // 동 필터가 걸려 있던 경우에만 점 레이어를 다시 그린다 (없으면 표시 점이 동일 → 깜빡임 방지)
    const hadDongFilter = selectedDongRef.current !== null;
    setCurrentDrillRegion(sigungu);
    drillRegionRef.current = sigungu;
    setSelectedDong(null);
    selectedDongRef.current = null;
    setDrillTitle(regionLabel(sd, sigungu, scopeSidosRef.current.length > 1));
    setDrillTab('all');
    setSelectedStoreKey(null);
    selectedStoreKeyRef.current = null;
    updateSelectedMarker(null);
    setDrillStores(rows);
    setPanelOpen(true);
    void loadDrillDetails(rows); // 주소·인허가일 지연 로드 (컬럼 다이어트 보완)
    if (hadDongFilter) updateStoreLayer();
    if (trendChartRef.current) { trendChartRef.current.destroy(); trendChartRef.current = null; }
  }

  // 드릴다운 상세(주소·인허가일) 지연 로드 — 본 로드에서 뺀 무거운 컬럼을 열람 시군구만 채운다.
  // 같은 행 객체를 다시 열면 address가 이미 있어 재조회하지 않는다.
  async function loadDrillDetails(rows: StoreRow[]) {
    const need = rows.filter(r => r.address === undefined);
    if (!need.length) return;
    const sd = need[0].sido;
    const sgs = [...new Set(need.map(r => r.sigungu))];
    const region = drillRegionRef.current;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const acc: any[] = [];
    for (let from = 0; from < 20000; from += 1000) {
      const { data, error } = await supabase.from('market_store_records')
        .select('name,status,month,addr_key,address,license_date')
        .eq('sido', sd).in('sigungu', sgs).order('id').range(from, from + 999);
      if (error || !data) break;
      acc.push(...data);
      if (data.length < 1000) break;
    }
    if (drillRegionRef.current !== region) return; // 로드 중 다른 지역으로 전환됨
    const detail = new Map(acc.map(d => [`${d.name}|${d.addr_key}|${d.status}|${d.month}`, d]));
    for (const r of rows) {
      const d = detail.get(`${r.name}|${r.addrKey}|${r.status}|${r.month}`);
      r.address = d?.address ?? null;
      r.license_date = d?.license_date ?? null;
    }
    setDrillStores([...rows]);
  }

  function closePanel() {
    // 동 필터가 걸려 있던 경우에만 점 레이어 복원 (없으면 전체 점 그대로 → 깜빡임 방지)
    const hadDongFilter = selectedDongRef.current !== null;
    setPanelOpen(false);
    setSpChartOpen(false);
    setCurrentDrillRegion('');
    drillRegionRef.current = '';
    setSelectedDong(null);
    selectedDongRef.current = null;
    setSelectedStoreKey(null);
    selectedStoreKeyRef.current = null;
    updateSelectedMarker(null);
    setDrillStores([]);
    if (hadDongFilter) updateStoreLayer();
    if (trendChartRef.current) { trendChartRef.current.destroy(); trendChartRef.current = null; }
  }

  // 카메라 이동 후 일부 환경(비포커스 탭 등)에서 렌더 루프가 멈춰 흰 화면이 남는 것 방지
  function nudgePaint() {
    const map = mapRef.current;
    if (!map) return;
    [40, 500].forEach(ms => setTimeout(() => { try { map.resize(); } catch { /* noop */ } }, ms));
  }

  // 지도를 조건에 맞는 매장들의 범위로 맞춤 (좌측 독·우측 패널 여백 고려)
  function fitToStores(predicate: (s: StoreRow) => boolean, maxZoom: number) {
    const map = mapRef.current;
    if (!map) return;
    const pts = cachedStoresRef.current.filter(s => s.lat != null && s.lng != null && predicate(s));
    if (!pts.length) return;
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const p of pts) {
      minLng = Math.min(minLng, p.lng!); maxLng = Math.max(maxLng, p.lng!);
      minLat = Math.min(minLat, p.lat!); maxLat = Math.max(maxLat, p.lat!);
    }
    map.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
      padding: { top: 90, bottom: 130, left: 240, right: 470 },
      maxZoom, duration: 800,
    });
    nudgePaint();
  }

  // 선택 매장 강조 마커 갱신 (좌표 없으면 비움)
  function updateSelectedMarker(lat?: number | null, lng?: number | null) {
    const map = mapRef.current;
    const src = map?.getSource('store-sel');
    if (!src) return;
    src.setData(lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
      ? { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} }] }
      : { type: 'FeatureCollection', features: [] });
  }

  // 매장 선택 — 리스트 행 하이라이트 + 지도 강조 링 + (옵션) 해당 위치로 이동
  function selectStore(key: string | null, lat?: number | null, lng?: number | null, fly = false) {
    setSelectedStoreKey(key);
    selectedStoreKeyRef.current = key;
    updateSelectedMarker(lat, lng);
    if (fly && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng) && mapRef.current) {
      const z = Math.max(mapRef.current.getZoom(), 15);
      mapRef.current.flyTo({ center: [lng, lat], zoom: z, duration: 700 });
      nudgePaint();
    }
  }

  // 동별 순증 행 클릭 — 토글: 리스트·지도 점을 해당 동만, 지도도 그 동으로 확대
  function handleSelectDong(dong: string) {
    const next = selectedDong === dong ? null : dong;
    setSelectedDong(next);
    selectedDongRef.current = next;
    if (next) {
      // 점이 보이도록 점 모드로 전환(입체였다면 평면 복귀)
      if (displayModeRef.current !== 'points') {
        setDisplayMode('points');
        displayModeRef.current = 'points';
        if (mapRef.current && mapRef.current.getPitch() > 0) mapRef.current.easeTo({ pitch: 0, bearing: 0, duration: 500 });
      }
      updateStoreLayer();
      fitToStores(s => sigunguMatches(s.sido, s.sigungu, drillRegionRef.current) && s.dong === next, 15.5);
    } else {
      updateStoreLayer();
      fitToStores(s => sigunguMatches(s.sido, s.sigungu, drillRegionRef.current), 12.5);
    }
  }

  // ─── SCROLL MONTH INTO VIEW ON INIT ───────────────────────────────────────

  useEffect(() => {
    if (!monthTimelineRef.current) return;
    setTimeout(() => {
      if (monthTimelineRef.current) {
        monthTimelineRef.current.scrollLeft = monthTimelineRef.current.scrollWidth;
      }
    }, 150);
  }, [loading]);

  // ─── RENDER ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <div className="text-center">
          <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
          <p className="text-slate-500 text-sm">시장 분석 데이터 불러오는 중...</p>
        </div>
      </div>
    );
  }

  // ─── 랭킹 인사이트 (모멘텀·대형) — 추가 쿼리 없이 cached에서 계산 ──────────
  // 기준월(anchor) — 기간 조회 시엔 종료월. 스파크라인 창·전월 비교·부분월 판정의 기준.
  const anchorMonth = rangeTo || selectedMonth || monthList[monthList.length - 1];
  // 필터 라벨 — 단일 월 'YYYY-MM' / 기간 'YYYY-MM~YYYY-MM' / 전체 null
  const monthFilterLabel = selectedMonth ? (rangeTo ? `${selectedMonth}~${rangeTo}` : selectedMonth) : null;
  const anchorIdx = monthList.indexOf(anchorMonth);
  const trendMonths = monthList.slice(Math.max(0, anchorIdx - 5), anchorIdx + 1); // 최근 6개월
  // 시군구별 월별 순증 시계열
  const regionMonthlyNet = (() => {
    const m = new Map<string, Map<string, number>>();
    for (const r of cachedSnaps) {
      const k = `${r.sido}|${r.sigungu}`;
      let mm = m.get(k); if (!mm) { mm = new Map(); m.set(k, mm); }
      mm.set(r.month, (mm.get(r.month) || 0) + (r.new_count || 0) - (r.closed_count || 0));
    }
    return m;
  })();
  // 시군구별 100평+ 신규(선택 월 기준, 전체 월이면 전기간)
  const regionBigNew = (() => {
    const m = new Map<string, number>();
    for (const s of cachedStores) {
      if (s.status !== 'new' || (s.pyeong || 0) < 100) continue;
      if (!monthInSel(s.month, selectedMonth, rangeTo)) continue;
      const k = `${s.sido}|${s.sigungu}`;
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  })();
  const sortedRegions = cachedRegionsArr.map(r => {
    const k = `${r.sido}|${r.region}`;
    const mm = regionMonthlyNet.get(k);
    const trend = trendMonths.map(mo => mm?.get(mo) ?? 0);
    const prevNet = anchorIdx > 0 ? (mm?.get(monthList[anchorIdx - 1]) ?? 0) : 0;
    const curNet = mm?.get(anchorMonth) ?? r.net;
    return { ...r, trend, mom: curNet - prevNet, big: regionBigNew.get(k) || 0 };
  }).sort((a, b) =>
    rankSort === 'new'    ? b.new - a.new
    : rankSort === 'closed' ? b.closed - a.closed
    : rankSort === 'mom'    ? b.mom - a.mom
    : rankSort === 'rate'   ? b.netRate - a.netRate
    : b.net - a.net);

  // ─── 랭킹뷰 파생값 — 순위 변동·합계 KPI·막대 스케일 ────────────────────────
  // 순위 변동(▲/▼)은 특정 월 선택 시에만 계산: 전월 데이터로 동일 정렬 기준의 순위표를
  // 만들어 현재 순위와 비교한다. '전체 월'은 3년 누적 순위라 전월 비교가 정의되지 않음.
  const prevRankMap = (() => {
    if (!selectedMonth || rangeTo || anchorIdx < 1) return null; // 기간 조회는 '전월 순위' 비교가 정의되지 않음
    const pm = monthList[anchorIdx - 1];
    const agg = new Map<string, { new: number; closed: number }>();
    for (const s of cachedSnaps) {
      if (s.month !== pm) continue;
      const k = `${s.sido}|${s.sigungu}`;
      let o = agg.get(k); if (!o) { o = { new: 0, closed: 0 }; agg.set(k, o); }
      o.new += s.new_count || 0; o.closed += s.closed_count || 0;
    }
    const rows = [...agg.entries()].map(([k, v]) => {
      const net = v.new - v.closed;
      const prevPrev = anchorIdx > 1 ? (regionMonthlyNet.get(k)?.get(monthList[anchorIdx - 2]) ?? 0) : 0;
      return {
        k, new: v.new, closed: v.closed, net,
        rate: v.new > 0 ? Math.round((net / v.new) * 100) : (v.closed > 0 ? -100 : 0),
        mom: net - prevPrev,
      };
    }).sort((a, b) =>
      rankSort === 'new'    ? b.new - a.new
      : rankSort === 'closed' ? b.closed - a.closed
      : rankSort === 'mom'    ? b.mom - a.mom
      : rankSort === 'rate'   ? b.rate - a.rate
      : b.net - a.net);
    return new Map(rows.map((r, i) => [r.k, i]));
  })();

  // 합계 KPI(랭킹뷰 상단 카드) — 표시 지역 합계 + 기준월 vs 직전월 증감
  const rankTotals = (() => {
    const tNew = sortedRegions.reduce((s, r) => s + r.new, 0);
    const tClosed = sortedRegions.reduce((s, r) => s + r.closed, 0);
    const tBig = sortedRegions.reduce((s, r) => s + r.big, 0);
    const monthAgg = (mo: string | undefined) => {
      if (!mo) return null;
      let n = 0, c = 0;
      for (const s of cachedSnaps) if (s.month === mo) { n += s.new_count || 0; c += s.closed_count || 0; }
      return { n, c };
    };
    const cur = monthAgg(anchorMonth);
    const prev = monthAgg(anchorIdx > 0 ? monthList[anchorIdx - 1] : undefined);
    // 기간 조회는 "기간 합계 vs 직전월" 비교가 성립하지 않으므로 증감 표시 생략
    const delta = cur && prev && !rangeTo
      ? { new: cur.n - prev.n, closed: cur.c - prev.c, net: (cur.n - cur.c) - (prev.n - prev.c) }
      : null;
    return { new: tNew, closed: tClosed, net: tNew - tClosed, big: tBig, delta };
  })();
  const rankMaxAbsNet = Math.max(1, ...sortedRegions.map(r => Math.abs(r.net)));
  // 기준월이 아직 진행 중인 달이면 "전월 대비"가 부분월 vs 완전월 비교라 왜곡 → 증감 숨기고 집계 중 표기
  const rankPartialMonth = (() => { const d = new Date(); return anchorMonth === `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
  // 색각보정 시 초록/빨강 → 파랑/주황 (지도 점과 동일 팔레트)
  const rankPosCls = colorblind ? 'text-blue-600' : 'text-green-600';
  const rankNegCls = colorblind ? 'text-orange-500' : 'text-red-500';
  const rankPosBar = colorblind ? '#2563eb' : '#16a34a';
  const rankNegBar = colorblind ? '#f97316' : '#ef4444';

  const exportRankXlsx = async () => {
    const XLSX = await import('xlsx');
    const rows = sortedRegions.map((r, i) => ({
      순위: i + 1, 시도: r.sido, 시군구: r.region, 신규: r.new, 폐업: r.closed, 순증: r.net,
      '성장률(%)': r.netRate, '전월대비 순증변화': r.mom, '대형(100평+)': r.big,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '시군구 랭킹');
    XLSX.writeFile(wb, `시군구랭킹_${monthFilterLabel || '전체월'}.xlsx`);
    toast.success('엑셀 파일을 내려받았습니다');
  };

  // ─── 운영계획 뷰 — 지역×연도 트렌드 표 (연말 중점 지역 선정용) ────────────────
  // cachedStores 단일 소스를 (시도|시군구)×연도로 집계. 업종 칩(selectedCategory) 연동.
  // 양끝 연도는 부분 집계(조회 창이 최근 36개월) — 표 하단 각주로 안내.
  const planYear0 = new Date().getFullYear() - 3;
  const planYearLabel = (yi: number) => `${(planYear0 + yi) % 100}년`;
  const planRows: PlanRegion[] = (() => {
    const byRegion = new Map<string, { sido: string; sigungu: string; years: { n: number; c: number }[]; big: number }>();
    for (const s of cachedStores) {
      if (!passesFilters(s, selectedCategory, targetOnly)) continue;
      const yi = Number(s.month.slice(0, 4)) - planYear0;
      if (yi < 0 || yi > 3) continue;
      const key = `${s.sido}|${s.sigungu}`;
      let r = byRegion.get(key);
      if (!r) {
        r = { sido: s.sido, sigungu: s.sigungu, years: [{ n: 0, c: 0 }, { n: 0, c: 0 }, { n: 0, c: 0 }, { n: 0, c: 0 }], big: 0 };
        byRegion.set(key, r);
      }
      if (s.status === 'new') {
        r.years[yi].n++;
        if (yi === 3 && (s.pyeong || 0) >= 100) r.big++;
      } else r.years[yi].c++;
    }
    return [...byRegion.values()].map(r => ({ ...r, nets: r.years.map(y => y.n - y.c) }));
  })();
  // ─── 신규 매장 2년 생존율 ────────────────────────────────────────────────────
  // "새로 생긴 가게가 2년을 버티는가" — 개척해도 반년 뒤 사라지는 지역을 걸러내는 지표.
  // 코호트를 조회 창(36개월)의 가장 오래된 12개월 개업분으로 고정한다: 이 매장들만 전원
  // 24개월 이상 관측이 끝나 있어서다. 최근 연도로 잡으면 아직 폐업할 시간이 없어 생존율이
  // 무조건 높게 나온다(관측 절단) → 연도별 열이 아니라 고정 코호트 1열로 둔다.
  // 폐업 판정: 같은 (상호|주소지문)이 개업 후 24개월 안에 폐업 명단에 등장. 지역은 개업 당시 시군구.
  // ※ 폐업 행에는 원래 인허가일이 없고 폐업일이 들어 있어(수집기 특성) 개업·폐업 명단을 맞춰야 한다.
  const survFrom = monthList[0];
  const survTo = monthList[11];
  const planSurvival = (() => {
    // 폐업 최초 시점 — 업종 무관으로 모은다(재등록으로 업종이 바뀌어도 폐업은 폐업)
    const closedAt = new Map<string, string>();
    for (const s of cachedStores) {
      if (s.status !== 'closed') continue;
      const k = `${s.name}|${s.addrKey}`;
      const prev = closedAt.get(k);
      if (!prev || s.month < prev) closedAt.set(k, s.month);
    }
    // 코호트 = 창의 첫 12개월에 개업한 매장 (업종 칩 연동)
    const opened = new Map<string, { month: string; region: string }>();
    for (const s of cachedStores) {
      if (s.status !== 'new' || !passesFilters(s, selectedCategory, targetOnly)) continue;
      if (s.month < survFrom || s.month > survTo) continue;
      const k = `${s.name}|${s.addrKey}`;
      const prev = opened.get(k);
      if (!prev || s.month < prev.month) opened.set(k, { month: s.month, region: `${s.sido}|${s.sigungu}` });
    }
    const out = new Map<string, { n: number; dead: number }>();
    for (const [k, o] of opened) {
      let r = out.get(o.region);
      if (!r) { r = { n: 0, dead: 0 }; out.set(o.region, r); }
      r.n++;
      const cm = closedAt.get(k);
      if (cm && cm >= o.month && monthDiff(o.month, cm) <= 24) r.dead++;
    }
    return out;
  })();
  const SURV_MIN_N = 30; // 표본이 이보다 적으면 비율 변동이 커서 숫자를 내지 않는다
  const survOf = (r: PlanRegion): { pct: number; n: number } | null => {
    const s = planSurvival.get(`${r.sido}|${r.sigungu}`);
    if (!s || s.n < SURV_MIN_N) return null;
    return { pct: Math.round((1 - s.dead / s.n) * 1000) / 10, n: s.n };
  };
  // 조회 범위 전체 평균 — 절대 기준선이 없는 지표라 '평균 대비'로 색을 준다
  const survAvg = (() => {
    let n = 0, dead = 0;
    for (const s of planSurvival.values()) { n += s.n; dead += s.dead; }
    return n ? Math.round((1 - dead / n) * 1000) / 10 : null;
  })();
  const survHeat = (pct: number): string | undefined => {
    if (survAvg == null || Math.abs(pct - survAvg) < 2) return undefined;
    const d = pct - survAvg;
    const a = Math.min(Math.abs(d) / 25 + 0.06, 0.34).toFixed(2);
    return `${d > 0 ? 'rgba(37,99,235,' : colorblind ? 'rgba(249,115,22,' : 'rgba(226,75,74,'}${a})`;
  };

  const planVal = (r: PlanRegion, k: string): number => {
    if (k === 'big') return r.big;
    if (k === 'surv') return survOf(r)?.pct ?? -1; // 미산출은 항상 끝으로
    const [yi, m] = k.split(':').map(Number);
    return m === 0 ? r.years[yi].n : m === 1 ? r.years[yi].c : r.nets[yi];
  };
  const planSorted = [...planRows].sort((a, b) => planSort.k === 'region'
    ? planSort.d * `${a.sido} ${a.sigungu}`.localeCompare(`${b.sido} ${b.sigungu}`, 'ko')
    : planSort.d * (planVal(a, planSort.k) - planVal(b, planSort.k)));
  const planArrow = (k: string) => planSort.k === k ? (planSort.d === 1 ? ' ↑' : ' ↓') : '';
  const planSortBy = (k: string) => setPlanSort(p => ({ k, d: p.k === k ? (p.d === 1 ? -1 : 1) : k === 'region' ? 1 : -1 }));
  // 요약 카드 — 최근년 순증 상위(공략)·하위 음수(주의) 자동 도출
  const planFocus = planRows.filter(r => r.nets[3] > 0).sort((a, b) => b.nets[3] - a.nets[3]).slice(0, 3);
  const planRisk = planRows.filter(r => r.nets[3] < 0).sort((a, b) => a.nets[3] - b.nets[3]).slice(0, 3);
  const planReason = (r: PlanRegion) =>
    r.nets[1] > 0 && r.nets[2] > 0 ? '순증 플러스 지속' : r.nets[2] < 0 ? `전년 ${r.nets[2]}에서 반등` : '전년 대비 성장';
  // 순증 비교 가로 막대 — 전 행이 같은 0 기준선 공유 (스케일은 최근년 순증 최대값 기준)
  const planMaxPos = Math.max(1, ...planRows.map(r => r.nets[3]));
  const planMaxNeg = Math.max(1, ...planRows.map(r => -r.nets[3]));
  const planNegBar = colorblind ? '#f97316' : '#e24b4a';
  const planHeat = (v: number): string | undefined => v === 0 ? undefined
    : `${v > 0 ? 'rgba(37,99,235,' : colorblind ? 'rgba(249,115,22,' : 'rgba(226,75,74,'}${Math.min(Math.abs(v) / 170 + 0.05, 0.4).toFixed(2)})`;
  const sidoShort = (s: string) => (s === '경기도' ? '경기' : s);
  // 선택 지역의 동별 집계 — "파주 +70의 실체가 어느 동인지"를 행 클릭 → 오른쪽 패널로 확인
  // 본 표와 같은 문법(연도별 신규·폐업·순증)으로 전 동 표시, 최근년 순증 내림차순
  const planDongRows = (() => {
    if (!planOpenRegion) return [];
    const [sd, sgg] = planOpenRegion.split('|');
    const byDong = new Map<string, { n: number; c: number }[]>();
    for (const s of cachedStores) {
      if (s.sido !== sd || s.sigungu !== sgg || !passesFilters(s, selectedCategory, targetOnly)) continue;
      const yi = Number(s.month.slice(0, 4)) - planYear0;
      if (yi < 0 || yi > 3) continue;
      const key = s.dong || '기타';
      let d = byDong.get(key);
      if (!d) { d = [{ n: 0, c: 0 }, { n: 0, c: 0 }, { n: 0, c: 0 }, { n: 0, c: 0 }]; byDong.set(key, d); }
      if (s.status === 'new') d[yi].n++; else d[yi].c++;
    }
    return [...byDong.entries()]
      .map(([dong, years]) => ({ dong, years, nets: years.map(y => y.n - y.c) }))
      .sort((a, b) => b.nets[3] - a.nets[3]);
  })();
  const exportPlanXlsx = async () => {
    const XLSX = await import('xlsx');
    const rows = planSorted.map(r => {
      const o: Record<string, string | number> = { 시도: r.sido, 시군구: r.sigungu };
      r.years.forEach((y, yi) => {
        o[`${planYearLabel(yi)} 신규`] = y.n;
        o[`${planYearLabel(yi)} 폐업`] = y.c;
        o[`${planYearLabel(yi)} 순증`] = r.nets[yi];
      });
      o[`${planYearLabel(3)} 100평+`] = r.big;
      const s = survOf(r);
      o[`2년 생존율(%) ${survFrom}~${survTo} 개업`] = s ? s.pct : '';
      o['생존율 표본(개업 수)'] = planSurvival.get(`${r.sido}|${r.sigungu}`)?.n ?? 0;
      return o;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, '운영계획');
    XLSX.writeFile(wb, `운영계획_지역트렌드_${planYear0 + 3}.xlsx`);
    toast.success('엑셀 파일을 내려받았습니다');
  };

  // 드릴다운 라이브 집계 (선택 월·업종 즉시 반영)
  const drillScoped = drillStores
    .filter(s => monthInSel(s.month, selectedMonth, rangeTo))
    .filter(s => passesFilters(s, selectedCategory, targetOnly));
  const drillSummary: DrillSummary | null = drillStores.length
    ? { new: drillScoped.filter(s => s.status === 'new').length, closed: drillScoped.filter(s => s.status === 'closed').length }
    : null;
  const drillDongs: DongAgg[] = (() => {
    const m: Record<string, DongAgg> = {};
    drillScoped.forEach(s => {
      const k = s.dong || '기타';
      if (!m[k]) m[k] = { dong: k, new: 0, closed: 0, net: 0 };
      if (s.status === 'new') m[k].new++; else m[k].closed++;
    });
    return Object.values(m)
      .map(d => ({ ...d, net: d.new - d.closed }))
      .sort((a, b) => b.net - a.net || b.new - a.new);
  })();
  // 동 선택 시 리스트는 그 동만 (동별 순증 랭킹·요약은 시군구 전체 유지)
  const drillListBase = selectedDong ? drillScoped.filter(s => s.dong === selectedDong) : drillScoped;
  const filteredDrillStores: DrillStore[] = drillListBase
    .filter(s => drillTab === 'all' ? true : drillTab === 'new' ? s.status === 'new' : drillTab === 'closed' ? s.status === 'closed' : (s.pyeong || 0) >= 100)
    .map(s => ({ name: s.name, status: s.status, category: s.category || undefined, pyeong: s.pyeong ?? undefined, license_date: s.license_date || undefined, address: s.address || undefined, lat: s.lat, lng: s.lng, dong: s.dong, key: storeKey(s.name, s.lat, s.lng) }))
    .sort((a, b) =>
      drillSort === 'pyeong' ? (b.pyeong || 0) - (a.pyeong || 0)
      : drillSort === 'date' ? (b.license_date || '').localeCompare(a.license_date || '')
      : drillSort === 'name' ? a.name.localeCompare(b.name, 'ko')
      : 0);
  const bigCount = drillScoped.filter(s => (s.pyeong || 0) >= 100).length;

  // 드릴다운 요약 인사이트 — 최근 추세·전월대비·주력 업종 (패널 상단 한 줄 요약, 랭킹뷰와 동일 정의로 카테고리 무관 순증 사용)
  const drillSido = drillStores[0]?.sido || '';
  // 개편 폴리곤 드릴다운('검단구·서해구' 등)은 키 직조회가 안 되므로 매칭되는 구들의 시계열을 합산
  const drillMM = (() => {
    const direct = regionMonthlyNet.get(`${drillSido}|${currentDrillRegion}`);
    if (direct || !currentDrillRegion) return direct;
    const out = new Map<string, number>();
    for (const [k, mm] of regionMonthlyNet) {
      const [sd, sg] = k.split('|');
      if (sd !== drillSido || !sigunguMatches(sd, sg, currentDrillRegion)) continue;
      for (const [mo, v] of mm) out.set(mo, (out.get(mo) || 0) + v);
    }
    return out.size ? out : undefined;
  })();
  const drillTrend = trendMonths.map(mo => drillMM?.get(mo) ?? 0);
  const drillMom = anchorIdx > 0 ? (drillMM?.get(anchorMonth) ?? 0) - (drillMM?.get(monthList[anchorIdx - 1]) ?? 0) : 0;
  const DRILL_CAT_LABEL: Record<'cafe' | 'bakery' | 'restaurant', string> = { cafe: '카페', bakery: '베이커리', restaurant: '음식점' };
  const drillTopCategory = (() => {
    const counts: Record<'cafe' | 'bakery' | 'restaurant', number> = { cafe: 0, bakery: 0, restaurant: 0 };
    drillScoped.forEach(s => { (['cafe', 'bakery', 'restaurant'] as const).forEach(c => { if (matchCategory(s, c)) counts[c]++; }); }); // drillScoped가 이미 타겟만 필터를 통과한 집합
    const top = (['cafe', 'bakery', 'restaurant'] as const).reduce((a, b) => counts[b] > counts[a] ? b : a);
    return counts[top] > 0 ? { cat: top, count: counts[top] } : null;
  })();

  const topNewRegions = [...cachedRegionsArr].sort((a, b) => b.new - a.new).slice(0, 6);

  // 여러 시도를 함께 보는 경우(내 지점에 시도가 2개+)만 라벨에 시도 접두
  const multiSido = regionMode === 'branch' && Object.keys(sidoSigunguMap).length > 1;
  const regionValue = regionMode === 'branch' ? '내 지점' : (regionSido ?? '내 지점');
  // 내 지점(기본) + 전국 17개 시도 (데이터 없는 시도는 선택 시 빈 화면)
  const regionOptions: DropdownOption[] = [
    { key: '__branch', label: '내 지점', active: regionMode === 'branch' },
    ...ALL_SIDOS.map(s => ({ key: s, label: s, active: regionMode === 'sido' && regionSido === s })),
  ];

  const CAT_LABEL: Record<Category, string> = { all: '전체 업종', cafe: '카페', bakery: '베이커리', restaurant: '음식점' };
  const categoryOptions: DropdownOption[] = (['all', 'cafe', 'bakery', 'restaurant'] as Category[])
    .map(c => ({ key: c, label: CAT_LABEL[c], active: selectedCategory === c }));

  // 업종 칩·'타겟만' 변경 시 화면 전체를 같은 모수로 다시 그린다.
  // KPI/랭킹/시군구 면/월별 차트는 SnapRow에서 나오므로 재집계가 필수 —
  // 예전엔 업종 칩이 SnapRow를 안 건드려서 '카페'를 골라도 상단 숫자가 그대로였다.
  // 매장 행이 아직 없으면(초기 RPC 빠른 경로 구간) 집계를 건너뛴다. 로드가 끝나면
  // finishRows가 그때의 선택값으로 다시 집계하므로 결과는 같아진다.
  const reapplyStoreFilters = () => {
    const rows = cachedStoresRef.current;
    if (rows.length) {
      const snaps = aggregateSnaps(rows, targetOnlyRef.current, selectedCategoryRef.current);
      setCachedSnaps(snaps);
      applyFiltersInternal(snaps, selectedMonthRef.current, rangeToRef.current, regionMode, regionSido, sidoSigunguMap);
    }
    updateStoreLayer();
    updateDongFillState();
  };

  const toggleTargetOnly = () => {
    const next = !targetOnly;
    setTargetOnly(next);
    targetOnlyRef.current = next;
    reapplyStoreFilters();
  };


  return (
    <div className="flex h-[calc(100dvh-var(--app-header-h)-var(--app-tabbar-h))] flex-col overflow-hidden md:h-[calc(100dvh-88px)]">

      {/* ── HEADS-UP FILTER BAR ── 모바일은 한 줄 가로 스크롤(줄바꿈 시 좌우 불균형 방지) */}
      <div className="relative z-[630] flex flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5 max-md:flex-nowrap max-md:overflow-x-auto max-md:[scrollbar-width:none] md:flex-wrap">
        <FilterDropdown
          icon={<MapPin size={14} />}
          value={regionValue}
          options={regionOptions}
          onSelect={(k) => (k === '__branch' ? handleSetRegionMode('branch') : handleSetRegionMode('sido', k))}
        />
        <FilterDropdown
          icon={<Tag size={14} />}
          value={CAT_LABEL[selectedCategory]}
          options={categoryOptions}
          onSelect={(k) => { setSelectedCategory(k as Category); selectedCategoryRef.current = k as Category; reapplyStoreFilters(); }}
        />
        <button
          onClick={toggleTargetOnly}
          title="인허가 추출 기준 업태만 — 일반조리판매·분식·패스트푸드·아이스크림·뷔페식 제외"
          className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-all max-md:h-7 max-md:px-2.5 max-md:text-[11px] ${
            targetOnly
              ? 'border-blue-600 bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]'
              : 'border-slate-200 bg-white text-slate-500 hover:border-blue-400 hover:text-blue-600'
          }`}
        >
          <Target size={13} />타겟만
        </button>
        <MonthRangeDropdown
          monthList={monthList}
          selectedMonth={selectedMonth}
          rangeTo={rangeTo}
          onSelectSingle={(m) => { stopPlay(); handleMonthSelect(m); }}
          onSelectRange={handleRangeSelect}
        />

        {/* 표시 모드 — 면 / 점 / 히트맵 */}
        {viewMode === 'map' && (
          <div className="inline-flex shrink-0 items-center gap-1.5 md:ml-auto">
            <span className="hidden text-[10px] font-medium text-slate-400 sm:inline">표시</span>
            <div className="inline-flex rounded-lg border border-slate-200 bg-white p-[3px]">
              {([['area', '면'], ['points', '점'], ['heat', '히트맵'], ['d3', '입체']] as [DisplayMode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  onClick={() => handleSetDisplayMode(m)}
                  className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition-colors ${displayMode === m ? 'bg-blue-600 text-white' : 'text-slate-500 hover:text-slate-800'}`}
                >
                  {m === 'heat' && <Layers size={12} />}{m === 'points' && <MapPin size={12} />}{m === 'd3' && <Box size={12} />}{label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 모바일 KPI 스트립 — 인사이트 독이 접혀 있어도 핵심 4개 수치는 항상 보이게 (지도는 안 가림) */}
      {viewMode === 'map' && (
        <div className="flex shrink-0 items-center justify-between gap-1 border-b border-slate-200 bg-white px-3 py-1.5 md:hidden">
          {([['신규', kpiNew, 'text-green-600'], ['폐업', kpiClosed, 'text-red-600'], ['순증', kpiNet, 'text-blue-600'], ['성장률', kpiRate, 'text-amber-600']] as [string, string | number, string][]).map(([label, value, tone]) => (
            <div key={label} className="flex flex-1 flex-col items-center leading-tight">
              <span className="text-[9px] font-semibold text-slate-400">{label}</span>
              <span className={`text-[15px] font-extrabold tabular-nums ${tone}`}>{value}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── MAP AREA ── */}
      <div className="relative flex-1 overflow-hidden">

      {/* ── MAP ── */}
      {/* isolate — MapLibre 컨트롤(저작권·ⓘ)이 타임랩스 바 위로 올라오는 것 차단 */}
      <div ref={mapContainerRef} className="isolate absolute inset-0 w-full h-full" />
      {mapError && (
        <div
          data-map-error={mapError}
          className="absolute left-3 top-3 z-50 max-w-[90%] rounded-lg bg-red-600/95 px-3 py-2 text-xs text-white shadow-lg"
        >
          지도 초기화 실패: {mapError}
        </div>
      )}

      {/* ── TOP-RIGHT CONTROLS (지도/랭킹 + 새로고침) ── */}
      <div className="absolute top-3 right-3 z-[600] flex items-center gap-1.5">
        <div className="flex gap-0.5 rounded-full border border-slate-200 bg-white p-[3px] shadow-sm">
          <button
            onClick={() => handleSetViewMode('map')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-[15px] text-xs font-semibold whitespace-nowrap transition-all max-md:h-7 max-md:gap-1 max-md:px-2.5 max-md:text-[11px] ${viewMode === 'map' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <MapIcon size={14} />지도
          </button>
          <button
            onClick={() => handleSetViewMode('rank')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-[15px] text-xs font-semibold whitespace-nowrap transition-all max-md:h-7 max-md:gap-1 max-md:px-2.5 max-md:text-[11px] ${viewMode === 'rank' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <BarChart3 size={14} />랭킹
          </button>
          <button
            onClick={() => handleSetViewMode('plan')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-[15px] text-xs font-semibold whitespace-nowrap transition-all max-md:h-7 max-md:gap-1 max-md:px-2.5 max-md:text-[11px] ${viewMode === 'plan' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <ClipboardList size={14} />운영계획
          </button>
        </div>
        <button
          disabled={refreshing}
          onClick={() => loadDashboardData(regionMode, regionSido)}
          title={lastSync}
          className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm max-md:h-[30px] max-md:w-[30px] transition-all hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* ── LEFT INSIGHT DOCK (overlay · 지도 모드 전용) ── */}
      {viewMode === 'map' && (
        <div className={`absolute bottom-0 left-0 top-0 z-[400] flex transition-transform duration-300 ease-[cubic-bezier(.4,0,.2,1)] ${dockOpen ? 'translate-x-0' : '-translate-x-[212px]'}`}>
          <aside className="flex w-[212px] flex-col gap-3 overflow-y-auto border-r border-slate-200 bg-white p-3 shadow-[4px_0_18px_rgba(15,23,42,.06)] [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200">
            {/* KPI 카드 */}
            <div className="grid grid-cols-2 gap-1.5">
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-[9px] font-semibold uppercase tracking-[.05em] text-slate-400">신규</div><div className="text-lg font-extrabold leading-tight text-green-600 tabular-nums">{kpiNew}</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-[9px] font-semibold uppercase tracking-[.05em] text-slate-400">폐업</div><div className="text-lg font-extrabold leading-tight text-red-600 tabular-nums">{kpiClosed}</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-[9px] font-semibold uppercase tracking-[.05em] text-slate-400">순증</div><div className="text-lg font-extrabold leading-tight text-blue-600 tabular-nums">{kpiNet}</div></div>
              <div className="rounded-lg bg-slate-50 px-2.5 py-2"><div className="text-[9px] font-semibold uppercase tracking-[.05em] text-slate-400">성장률</div><div className="text-lg font-extrabold leading-tight text-amber-600 tabular-nums">{kpiRate}</div></div>
            </div>
            {/* 신규 상위 상권 */}
            <div className="min-h-0 flex-1">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold text-slate-500">신규 상위 상권</span>
                <TrendingUp size={14} className="text-green-600" />
              </div>
              <div className="flex flex-col gap-1.5">
                {topNewRegions.length === 0 ? (
                  <div className="py-6 text-center text-[11px] text-slate-300">데이터 없음</div>
                ) : topNewRegions.map((r, i) => (
                  <button
                    key={r.sido + r.region}
                    onClick={() => openDrilldown(r.region, r.sido)}
                    className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-slate-50"
                  >
                    <span className={`flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-[5px] text-[10px] font-semibold ${i < 2 ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>{i + 1}</span>
                    <span className="flex-1 truncate text-xs text-slate-800">{regionLabel(r.sido, r.region, multiSido)}</span>
                    <span className={`text-xs font-semibold tabular-nums ${r.new > 0 ? 'text-green-600' : 'text-slate-300'}`}>{r.new > 0 ? `+${r.new}` : '0'}</span>
                  </button>
                ))}
              </div>
            </div>
            {/* 범례 — 표시 모드에 맞춤 */}
            <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-slate-100 pt-2.5 text-[10px] font-medium text-slate-500">
              {displayMode === 'area' ? (
                <>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: '#34c759' }} />순증</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: '#ff3b30' }} />순감</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: '#a1a1a6' }} />보합</span>
                </>
              ) : displayMode === 'heat' ? (
                <span className="inline-flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: colorblind ? 'rgba(59,130,246,.6)' : 'rgba(34,197,94,.55)' }} />신규 농도(동 단위)</span>
              ) : displayMode === 'd3' ? (
                <>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-2 rounded-sm" style={{ background: '#15803d' }} />순증↑</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-3 w-2 rounded-sm" style={{ background: '#b91c1c' }} />순감↑</span>
                  <span className="text-slate-400">높이=순증 크기</span>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colorblind ? '#2563eb' : '#16a34a' }} />신규 매장</span>
                  <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: colorblind ? '#f97316' : '#e24b4a' }} />폐업 매장</span>
                  <span className="inline-flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: colorblind ? '#a855f7' : '#f59e0b', background: 'transparent' }} />100평+</span>
                  {colorblind && <span className="text-slate-400">색각보정</span>}
                </>
              )}
            </div>
          </aside>
          {/* 접기/펼치기 핸들 */}
          <button
            onClick={() => setDockOpen(o => !o)}
            title={dockOpen ? '패널 접기' : '패널 펼치기'}
            className="my-auto flex h-11 w-[18px] items-center justify-center rounded-r-lg border border-l-0 border-slate-200 bg-white text-slate-500 shadow-sm transition-colors hover:text-blue-600"
          >
            {dockOpen ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      )}

      {/* ── TIMELAPSE 재생 바 ── (저프로파일 · 접기 토글로 지도 시야 확보) */}
      {viewMode === 'map' && (
        <div className="absolute bottom-3 left-3 right-14 z-[450] md:left-[232px]">
          <div className="mx-auto flex w-fit max-w-full items-center gap-2 rounded-full border border-slate-200/70 bg-white/75 px-2 py-1.5 shadow-[0_4px_18px_rgba(15,23,42,.08)] backdrop-blur transition-colors hover:bg-white/95">
            {/* 재생/일시정지 토글 — 항상 노출 */}
            <button
              onClick={handleTogglePlay}
              title={playing ? '일시정지' : '월별 재생'}
              className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-white shadow-sm transition-colors ${playing ? 'bg-blue-700' : 'bg-blue-600 hover:bg-blue-700'}`}
            >
              {playing ? <Pause size={15} /> : <Play size={15} className="ml-0.5" />}
            </button>
            {/* 현재 월 — 항상 노출 */}
            <span className="min-w-[40px] flex-shrink-0 text-center text-xs font-bold tabular-nums text-blue-600">
              {selectedMonth ? (rangeTo ? `${selectedMonth.slice(2).replace('-', '.')}~${rangeTo.slice(2).replace('-', '.')}` : selectedMonth.slice(2).replace('-', '.')) : '전체'}
              {playing && <span className="ml-0.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-blue-500 align-middle" />}
            </span>
            {/* 슬라이더 본체 — 접으면 숨김 */}
            {timelineOpen && (
              <div className="flex min-w-0 items-center gap-2 pl-1">
                <span className="hidden flex-shrink-0 text-[10px] tabular-nums text-slate-400 sm:inline">{monthList[0]?.slice(2).replace('-', '.')}</span>
                <input
                  type="range" min={0} max={monthList.length - 1} step={1}
                  value={selectedMonth ? monthList.indexOf(selectedMonth) : 0}
                  onChange={(e) => { stopPlay(); handleMonthSelect(monthList[Number(e.target.value)]); }}
                  className="w-[180px] max-w-full accent-blue-600 sm:w-[240px]"
                  aria-label="월 타임라인"
                />
                <span className="hidden flex-shrink-0 text-[10px] tabular-nums text-slate-400 sm:inline">{monthList[monthList.length - 1]?.slice(2).replace('-', '.')}</span>
                {selectedMonth && (
                  <button
                    onClick={() => { stopPlay(); handleMonthSelect(null); }}
                    className="flex-shrink-0 rounded-full px-2 py-1 text-[10px] font-medium text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                  >
                    전체
                  </button>
                )}
              </div>
            )}
            {/* 접기/펼치기 토글 */}
            <button
              onClick={() => setTimelineOpen(o => !o)}
              title={timelineOpen ? '타임라인 접기' : '타임라인 펼치기'}
              className="flex h-7 w-6 flex-shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            >
              {timelineOpen ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
            </button>
          </div>
        </div>
      )}

      {/* ── PANEL BACKDROP ── (항상 마운트 → 패널 슬라이드와 같은 300ms로 페이드 인/아웃)
          지도 모드에서만 어둡게 — 랭킹 뷰는 본문이 옆으로 비켜나는 2단 배치라 화면을 덮지 않는다(눈 피로 감소) */}
      <div
        aria-hidden={!panelOpen}
        onClick={closePanel}
        className={`absolute inset-0 bg-slate-900/30 z-[499] transition-opacity duration-300 ${panelOpen && viewMode === 'map' ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
      />

      {/* ── SLIDE PANEL ── */}
      <div className={`absolute top-0 right-0 w-[440px] max-w-full h-full bg-white border-l border-slate-200 shadow-[-6px_0_32px_rgba(15,23,42,.1)] z-[500] flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(.4,0,.2,1)] max-sm:w-full ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 flex-shrink-0 bg-slate-50">
          <button
            onClick={closePanel}
            className="w-[30px] h-[30px] rounded-full border border-slate-200 bg-white text-slate-500 cursor-pointer flex items-center justify-center flex-shrink-0 transition-all hover:bg-red-50 hover:text-red-600 hover:border-red-200"
          >
            <X size={16} />
          </button>
          <span className="text-[17px] font-extrabold text-slate-900 flex-1 tracking-[-0.025em]">{drillTitle}</span>
        </div>

        {/* Drill summary */}
        {drillSummary && (
          <div className="px-5 pt-2.5 pb-3 bg-slate-50 border-b border-slate-200 flex-shrink-0">
            {/* 인사이트 한 줄 — 최근 추세·전월대비·주력 업종 (클릭 없이 바로 판단 가능하도록) */}
            <div className="mb-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className={`inline-flex items-center gap-1 text-xs font-bold ${drillMom > 0 ? 'text-green-600' : drillMom < 0 ? 'text-red-500' : 'text-slate-400'}`}>
                {drillMom > 0 ? '▲' : drillMom < 0 ? '▼' : '─'} 전월대비 {drillMom > 0 ? `+${drillMom}` : drillMom}
              </span>
              <Sparkline values={drillTrend} colorblind={colorblind} />
              {bigCount > 0 && (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                  <Star size={11} className="fill-amber-500 text-amber-500" />대형 신규 {bigCount}건
                </span>
              )}
              {drillTopCategory && (
                <span className="text-xs text-slate-400">
                  주력 <span className="font-bold text-slate-700">{DRILL_CAT_LABEL[drillTopCategory.cat]}</span>
                </span>
              )}
            </div>
            <div className="flex gap-6">
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase">신규</span>
                <span className="text-[26px] font-extrabold tabular-nums leading-none text-green-600">{drillSummary.new}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase">폐업</span>
                <span className="text-[26px] font-extrabold tabular-nums leading-none text-red-600">{drillSummary.closed}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase">100평+</span>
                <span className="text-[26px] font-extrabold tabular-nums leading-none text-amber-600">{bigCount}</span>
              </div>
            </div>
          </div>
        )}

        {/* 동별 순증 집계 */}
        {drillDongs.length > 0 && (
          <div className="flex-shrink-0 border-b border-slate-200 px-5 py-3">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
              <MapPin size={12} />동별 순증
              {selectedDong && (
                <button
                  onClick={() => handleSelectDong(selectedDong)}
                  className="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 hover:bg-blue-100"
                >
                  {selectedDong} <X size={11} />
                </button>
              )}
              <span className="ml-auto flex gap-2 text-[9px] font-medium text-slate-400">
                <span className="w-7 text-right">신규</span>
                <span className="w-7 text-right">폐업</span>
                <span className="w-9 text-right">순증</span>
              </span>
            </div>
            <div className="flex max-h-[140px] flex-col gap-0.5 overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200">
              {drillDongs.map((d, i) => {
                const sel = selectedDong === d.dong;
                return (
                  <button
                    key={d.dong}
                    onClick={() => handleSelectDong(d.dong)}
                    className={`flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs transition-colors ${sel ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'hover:bg-slate-50'}`}
                  >
                    <span className={`flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center rounded-[5px] text-[9px] font-semibold ${sel ? 'bg-blue-600 text-white' : i < 3 ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>{i + 1}</span>
                    <span className={`flex-1 truncate ${sel ? 'font-semibold text-blue-800' : 'text-slate-800'}`}>{d.dong}</span>
                    <span className="w-7 text-right tabular-nums text-green-600">{d.new || '·'}</span>
                    <span className="w-7 text-right tabular-nums text-red-500">{d.closed || '·'}</span>
                    <span className={`w-9 text-right font-semibold tabular-nums ${d.net > 0 ? 'text-green-600' : d.net < 0 ? 'text-red-600' : 'text-slate-400'}`}>{d.net > 0 ? `+${d.net}` : d.net}</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Drill tabs + 정렬 */}
        <div className="flex items-center gap-2 px-3.5 py-[9px] border-b border-slate-200 flex-shrink-0">
          <div className="flex gap-1 overflow-x-auto flex-1 [&::-webkit-scrollbar]:hidden">
            {(['all', 'new', 'closed', 'big'] as DrillTab[]).map(tab => (
              <button
                key={tab}
                onClick={() => setDrillTab(tab)}
                className={`h-7 px-[13px] text-xs font-semibold rounded-full border cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${drillTab === tab ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600'}`}
              >
                {tab === 'all' ? '전체' : tab === 'new' ? '신규' : tab === 'closed' ? '폐업' : '100평+'}
              </button>
            ))}
          </div>
          <select
            value={drillSort}
            onChange={e => setDrillSort(e.target.value as DrillSort)}
            aria-label="정렬"
            className="h-7 text-xs font-semibold text-slate-600 border border-slate-200 rounded-full pl-2.5 pr-1.5 bg-white cursor-pointer flex-shrink-0 hover:border-blue-400 focus:outline-none focus:border-blue-500"
          >
            <option value="default">기본순</option>
            <option value="pyeong">평수순</option>
            <option value="date">최신순</option>
            <option value="name">이름순</option>
          </select>
        </div>

        {/* Drill list */}
        <div ref={drillListRef} className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded">
          {filteredDrillStores.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-slate-400 text-[13px] text-center leading-relaxed">
              <span className="opacity-60">{drillSummary ? <Inbox size={28} /> : <Clock size={28} />}</span>
              {drillSummary ? '해당 데이터 없음' : (
                <span>데이터 없음<br /><span className="text-xs">상권 통계 저장 후 이용 가능합니다</span></span>
              )}
            </div>
          ) : (
            filteredDrillStores.map((s, i) => {
              const isBig = (s.pyeong || 0) >= 100;
              const isSel = selectedStoreKey === s.key;
              const hasGeo = s.lat != null && s.lng != null;
              return (
                <div
                  key={s.key + '|' + i}
                  data-skey={s.key}
                  onClick={() => selectStore(s.key, s.lat, s.lng, true)}
                  title={hasGeo ? '클릭 시 지도에서 위치 보기' : '좌표 정보 없음'}
                  className={`px-5 py-[13px] border-b border-slate-100 cursor-pointer transition-colors ${isSel ? 'bg-blue-50 ring-1 ring-inset ring-blue-300' : 'hover:bg-slate-50'}`}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-bold text-slate-900 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{s.name}</span>
                    {isBig && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 flex-shrink-0"><Star size={10} className="fill-amber-500 text-amber-500" />대형</span>
                    )}
                    <span className={`text-[11px] font-bold px-[9px] py-0.5 rounded-[20px] flex-shrink-0 ${s.status === 'new' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {s.status === 'new' ? '신규' : '폐업'}
                    </span>
                    <a
                      href={`https://map.naver.com/p/search/${encodeURIComponent([s.name, s.address].filter(Boolean).join(' '))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      title="네이버 지도에서 검색"
                      className="inline-flex items-center gap-0.5 text-[10px] font-bold text-[#03c75a] bg-[#03c75a]/10 rounded px-1.5 py-0.5 flex-shrink-0 hover:bg-[#03c75a]/20 transition-colors"
                    >
                      <ExternalLink size={10} />네이버
                    </a>
                  </div>
                  <div className="flex gap-1.5 flex-wrap mb-1">
                    {s.category    && <span className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-px">{s.category}</span>}
                    {s.pyeong      && <span className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-px">{s.pyeong}평</span>}
                    {s.license_date && <span className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded px-1.5 py-px">{s.license_date}</span>}
                  </div>
                  {s.address && (
                    <div className="text-[11px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">{s.address}</div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Panel chart section */}
        <div className="flex-shrink-0 border-t border-slate-200">
          <button
            onClick={() => setSpChartOpen(v => !v)}
            className="w-full flex items-center justify-between px-5 py-2.5 cursor-pointer text-[11px] font-semibold text-slate-500 tracking-[.04em] transition-colors hover:bg-slate-50 select-none"
          >
            <span className="inline-flex items-center gap-1.5"><TrendingUp size={13} />월별 추이</span>
            <ChevronDown size={15} className={`transition-transform ${spChartOpen ? '' : '-rotate-90'}`} />
          </button>
          {spChartOpen && (
            <div className="px-4 pb-3 h-[148px]">
              <canvas ref={trendChartCanvasRef} />
            </div>
          )}
        </div>
      </div>

      {/* ── RANKING VIEW ── */}
      {viewMode === 'rank' && (
        <div className="absolute inset-0 bg-slate-50 z-[300] flex flex-col overflow-hidden">
          {/* Header — 제목·기준월 + 정렬 세그먼트 + 엑셀 (우측 여백은 top-right 지도/랭킹 토글 오버레이 회피) */}
          <div className={`px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0 flex flex-wrap items-center justify-between gap-3 max-sm:pr-5 max-sm:pt-[52px] ${panelOpen ? 'pr-[455px]' : 'pr-[345px]'}`}>
            <div>
              <div className="text-[16px] font-bold tracking-[-0.01em] text-slate-900">시군구 상권 랭킹</div>
              <div className="mt-0.5 text-[12px] text-slate-500">{monthFilterLabel ? `${monthFilterLabel} 기준${rankPartialMonth ? '(집계 중)' : ''}` : '최근 3년 누적'} · {sortedRegions.length}개 시군구 · 매장 수 집계</div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5">
                {(['net', 'mom', 'new', 'closed', 'rate'] as RankSort[]).map(sort => (
                  <button
                    key={sort}
                    onClick={() => setRankSort(sort)}
                    className={`h-[30px] cursor-pointer rounded-md px-3 text-[13px] transition-all ${rankSort === sort ? 'bg-white font-semibold text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                  >
                    {sort === 'net' ? '순증' : sort === 'mom' ? '모멘텀' : sort === 'new' ? '신규' : sort === 'closed' ? '폐업' : '성장률'}
                  </button>
                ))}
              </div>
              <button
                onClick={exportRankXlsx}
                className="inline-flex h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[13px] font-medium text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600"
              >
                <Download size={14} />엑셀
              </button>
            </div>
          </div>

          {/* KPI + ranking table — 드릴다운 패널이 열리면 본문이 왼쪽으로 비켜 2단 배치(팝업 덮임 없음) */}
          <div className={`flex-1 overflow-y-auto px-4 py-3 transition-[margin] duration-300 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded ${panelOpen ? 'mr-[440px] max-sm:mr-0' : ''}`}>
            {sortedRegions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-slate-400 text-[13px] text-center leading-relaxed">
                <Clock size={28} className="opacity-60" />
                데이터 불러오는 중...
              </div>
            ) : (
              <div className="w-full">
                {/* KPI 카드 — 합계 + 전월 대비 (기준월 vs 직전월) */}
                <div className="mb-3 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                  {([
                    { label: '총 순증', value: (rankTotals.net > 0 ? '+' : '') + rankTotals.net.toLocaleString(), delta: rankTotals.delta?.net ?? null, badWhenUp: false, hero: true },
                    { label: '신규 개점', value: rankTotals.new.toLocaleString(), delta: rankTotals.delta?.new ?? null, badWhenUp: false },
                    { label: '폐업', value: rankTotals.closed.toLocaleString(), delta: rankTotals.delta?.closed ?? null, badWhenUp: true },
                    { label: '대형 매장(100평+)', value: rankTotals.big.toLocaleString(), delta: null, badWhenUp: false },
                  ] as { label: string; value: string; delta: number | null; badWhenUp: boolean; hero?: boolean }[]).map(c => (
                    // 핵심 지표(총 순증)는 히어로 카드로 승격 — 화면의 한 줄 요약 역할 (시안 A)
                    <div key={c.label} className={c.hero ? 'rounded-xl bg-gradient-to-br from-blue-600 to-indigo-500 px-3.5 py-3 shadow-sm' : 'rounded-xl border border-slate-200/70 bg-white px-3.5 py-3 shadow-sm'}>
                      <div className={`text-[12px] ${c.hero ? 'text-blue-100' : 'text-slate-500'}`}>{c.label}</div>
                      <div className={`mt-0.5 text-[22px] font-bold tabular-nums tracking-[-0.01em] ${c.hero ? 'text-white' : 'text-slate-900'}`}>{c.value}</div>
                      <div className={`mt-0.5 text-[12px] font-medium ${c.hero ? 'text-blue-100/90' : c.delta == null || c.delta === 0 || rankPartialMonth ? 'text-slate-400' : (c.delta > 0) !== c.badWhenUp ? rankPosCls : rankNegCls}`}>
                        {c.delta == null ? (rangeTo ? '선택 기간 합계' : '신규 인허가 기준') : rankPartialMonth ? '이달 집계 진행 중' : c.delta === 0 ? '전월과 동일' : `${c.delta > 0 ? '▲' : '▼'} ${Math.abs(c.delta)} 전월 대비`}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 컬럼 헤더 + 행 — 좁은 화면에선 가로 스크롤 (컬럼 붕괴 방지) */}
                <div className="overflow-x-auto">
                <div className="min-w-[620px]">
                <div className="grid grid-cols-[3.4rem_minmax(0,1fr)_minmax(3.5rem,8rem)_4.4rem_4rem_3.4rem] items-center gap-2 px-3 pb-1.5 text-[12px] font-medium text-slate-400">
                  <span>순위</span>
                  <span>지역</span>
                  <span>순증</span>
                  <span className="text-right">신규·폐업</span>
                  <span className="text-center">6개월 추이</span>
                  <span className="text-right">성장률</span>
                </div>
                <div className="flex flex-col gap-1">
                  {sortedRegions.map((r, i) => {
                    const up = r.net > 0, down = r.net < 0;
                    const netStr = up ? `+${r.net}` : String(r.net);
                    const netCls = up ? rankPosCls : down ? rankNegCls : 'text-slate-400';
                    const momStr = r.mom > 0 ? `전월대비 +${r.mom}` : r.mom < 0 ? `전월대비 ${r.mom}` : '전월과 동일';
                    // 순위 변동 — 전월 순위표 대비 (전체 월 보기에선 미표시)
                    const prevIdx = prevRankMap?.get(`${r.sido}|${r.region}`);
                    const rankChg = prevRankMap ? (prevIdx == null ? null : prevIdx - i) : null;
                    const noData = r.new === 0 && r.closed === 0;
                    return (
                      <div
                        key={r.sido + r.region}
                        onClick={() => openDrilldown(r.region, r.sido)}
                        className={`grid grid-cols-[3.4rem_minmax(0,1fr)_minmax(3.5rem,8rem)_4.4rem_4rem_3.4rem] items-center gap-2 cursor-pointer rounded-xl border bg-white px-3 py-3 shadow-sm transition-all hover:bg-blue-50/40 ${i === 0 ? 'border-blue-400 ring-1 ring-blue-400/50 hover:border-blue-400' : 'border-slate-200/70 hover:border-blue-300'}`}
                      >
                        <span className="flex items-baseline gap-1">
                          <span className="w-5 text-[15px] font-bold tabular-nums text-slate-800">{i + 1}</span>
                          {rankChg == null || rankChg === 0
                            ? <span className="text-[11px] text-slate-300">—</span>
                            : rankChg > 0
                              ? <span className={`text-[11px] font-semibold tabular-nums ${rankPosCls}`}>▲{rankChg}</span>
                              : <span className={`text-[11px] font-semibold tabular-nums ${rankNegCls}`}>▼{-rankChg}</span>}
                        </span>
                        <span className="truncate text-[14px] font-bold tracking-[-0.02em] text-slate-900">{regionLabel(r.sido, r.region, multiSido)}</span>
                        <span className="flex items-center gap-2">
                          <span className={`min-w-[2.1rem] text-right text-[14px] font-extrabold tabular-nums ${netCls}`}>{netStr}</span>
                          <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <span
                              className="block h-full rounded-full"
                              style={{ width: `${Math.round((Math.abs(r.net) / rankMaxAbsNet) * 100)}%`, background: up ? rankPosBar : down ? rankNegBar : '#cbd5e1' }}
                            />
                          </span>
                        </span>
                        <span className="text-right text-[13px] tabular-nums">
                          <span className={`font-semibold ${rankPosCls}`}>{r.new}</span>
                          <span className="text-slate-300"> · </span>
                          <span className={`font-semibold ${rankNegCls}`}>{r.closed}</span>
                        </span>
                        <span className="flex justify-center" title={momStr}>
                          <Sparkline values={r.trend} colorblind={colorblind} />
                        </span>
                        <span className="text-right">
                          {noData
                            ? <span className="inline-block rounded-md bg-slate-50 px-1.5 py-0.5 text-[12px] font-medium text-slate-400" title="해당 기간 신규·폐업 데이터 없음">—</span>
                            : <span className={`inline-block rounded-md px-1.5 py-0.5 text-[12px] font-semibold tabular-nums ${r.netRate >= 0 ? (colorblind ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700') : (colorblind ? 'bg-orange-50 text-orange-600' : 'bg-red-50 text-red-600')}`}>{r.netRate}%</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
                </div>
                </div>

                {/* 푸터 — 데이터 신뢰성 표기 + 중복 집계 제거 로직 설명(토글) */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-1 pt-2.5 text-[12px] text-slate-400">
                  <span className="inline-flex items-center gap-1.5">
                    <RefreshCw size={12} />데이터 기준 {monthFilterLabel || '최근 3년'} · {lastSync} ·
                    <button
                      onClick={() => setDedupInfoOpen((o) => !o)}
                      className={`inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 transition-colors ${dedupInfoOpen ? 'text-blue-600' : 'hover:text-blue-600'}`}
                    >
                      동일 매장 반복 등재 제거 적용 <Info size={12} />
                    </button>
                  </span>
                  <span>행을 누르면 동별 상세로 이동</span>
                </div>
                {dedupInfoOpen && (
                  <div className="mt-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-[12px] leading-relaxed text-slate-600 shadow-sm">
                    <div className="mb-1 font-bold text-slate-800">폐업·신규 중복 집계 검증과 제거 규칙</div>
                    공공 인허가 API는 폐업(일부 신규) 레코드를 여러 달의 월간 스냅샷에 반복 노출합니다.
                    2026-07 실측 기준 폐업 <b className="text-slate-800">1,515곳</b>이 2개월 이상 반복 등재(최대 22개월)되어,
                    그대로 합산하면 폐업이 약 <b className="text-slate-800">2,600건 과다 집계</b>됩니다.
                    이 화면은 (이름·주소·상태)가 같은 매장이 <b className="text-slate-800">직전 달에도 등재돼 있으면 반복 노출로 보고 제외</b>하고,
                    연속 등재의 <b className="text-slate-800">시작 달 1건만 실제 발생</b>으로 집계합니다.
                    1개월 이상 공백 후 다시 나타나면 별개 사건(재개업 후 재폐업 등)으로 인정합니다.
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Overall chart strip */}
          <div className="flex-shrink-0 h-[150px] border-t border-slate-200 bg-white px-5 py-2.5 flex flex-col">
            <div className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase mb-1.5 flex-shrink-0">전체 월별 신규 / 폐업 추이</div>
            <div className="flex-1 relative min-h-0">
              <canvas ref={overallChartCanvasRef} />
            </div>
          </div>
        </div>
      )}

      {/* ── 운영계획 뷰 — 요약 카드(위) + 지역×연도 정렬 표(아래), 머리글 없이 컴팩트 ── */}
      {viewMode === 'plan' && (
        <div className="absolute inset-0 z-[300] flex flex-col overflow-hidden bg-slate-50">
          {/* 슬림 툴바 — 캡션 + 엑셀 (우측 여백은 top-right 토글 오버레이 회피) */}
          <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-slate-200 bg-white px-5 py-2 pr-[345px] max-sm:pr-5 max-sm:pt-[52px]">
            <div className="text-[12px] font-semibold text-slate-600">지역 × 연도 신규·폐업·순증 + 신규 2년 생존율</div>
            <button
              onClick={exportPlanXlsx}
              className="inline-flex h-[28px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-[12px] font-medium text-slate-600 transition-colors hover:border-blue-400 hover:text-blue-600"
            >
              <Download size={13} />엑셀
            </button>
          </div>

          <div className="relative flex-1 overflow-hidden">
          <div className={`h-full overflow-auto px-4 py-3 transition-[margin] duration-300 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200 ${planOpenRegion ? 'mr-[560px] max-lg:mr-0' : ''}`}>
            {planRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center text-[13px] leading-relaxed text-slate-400">
                <Clock size={28} className="opacity-60" />
                데이터 불러오는 중...
              </div>
            ) : (
              <div className="w-full">
                {/* 요약 카드 — 위 (공략 상위 3 + 이탈 주의) */}
                <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
                  {planFocus.map((r, i) => (
                    <div key={`${r.sido}|${r.sigungu}`} className="rounded-xl border border-l-4 border-slate-200/70 border-l-blue-500 bg-white px-3.5 py-2.5 shadow-sm">
                      <div className="text-[13px] font-bold text-slate-900">
                        🎯 {sidoShort(r.sido)} {r.sigungu} <span className="font-medium text-slate-400">{i + 1}순위 공략</span>
                      </div>
                      <div className="mt-0.5 text-[12px] text-slate-500">
                        {planYearLabel(3)} 순증 <b className="text-blue-600 tabular-nums">+{r.nets[3]}</b> · {planReason(r)}
                      </div>
                    </div>
                  ))}
                  {planRisk.length > 0 && (
                    <div className="rounded-xl border border-l-4 border-slate-200/70 border-l-amber-500 bg-white px-3.5 py-2.5 shadow-sm">
                      <div className="text-[13px] font-bold text-slate-900">⚠ 이탈 주의</div>
                      <div className="mt-0.5 text-[12px] text-slate-500 tabular-nums">
                        {planRisk.map(r => `${r.sigungu} ${r.nets[3]}`).join(' · ')}
                      </div>
                    </div>
                  )}
                </div>

                {/* 지역×연도 표 — 아래 */}
                <div className="overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-sm">
                  <table className="w-full min-w-[1130px] border-collapse text-right text-[12.5px] tabular-nums">
                    <thead>
                      <tr className="text-[11.5px] text-slate-400">
                        <th rowSpan={2} className="cursor-pointer select-none px-3 py-1.5 text-left font-semibold hover:text-blue-600" onClick={() => planSortBy('region')}>지역{planArrow('region')}</th>
                        {[0, 1, 2, 3].map(yi => (
                          <th key={yi} colSpan={3} className="border-l border-slate-100 px-2 pt-1.5 text-center font-semibold">{planYearLabel(yi)}{yi === 0 || yi === 3 ? '*' : ''}</th>
                        ))}
                        <th rowSpan={2} className="cursor-pointer select-none border-l border-slate-100 px-2 py-1.5 font-semibold hover:text-blue-600" onClick={() => planSortBy('big')}>100평+{planArrow('big')}</th>
                        <th
                          rowSpan={2}
                          onClick={() => planSortBy('surv')}
                          // 방법론 한계는 UI 본문이 아니라 이 툴팁에만 둔다(화면에 설명 문구 금지 규칙)
                          title={`${survFrom}~${survTo} 개업 매장이 2년(24개월) 안에 폐업하지 않은 비율${survAvg != null ? ` · 조회 범위 평균 ${survAvg}%` : ''}\n상호+주소로 개업·폐업 명단을 맞춘 값 — 상호를 바꾼 뒤 폐업한 곳은 생존으로 잡힐 수 있음`}
                          className="cursor-pointer select-none border-l border-slate-100 px-2 py-1.5 font-semibold hover:text-blue-600"
                        >
                          2년 생존율{planArrow('surv')}
                        </th>
                        <th rowSpan={2} className="border-l border-slate-100 px-2 py-1.5 text-center font-semibold">페이스</th>
                        <th rowSpan={2} className="border-l border-slate-100 px-3 py-1.5 text-left font-semibold">순증 비교({planYearLabel(3)})</th>
                      </tr>
                      <tr className="text-[11.5px] text-slate-400">
                        {[0, 1, 2, 3].flatMap(yi => ['신규', '폐업', '순증'].map((lb, mi) => (
                          <th key={`${yi}-${mi}`} className={`${mi === 0 ? 'border-l border-slate-100 ' : ''}cursor-pointer select-none px-2 pb-1.5 font-semibold hover:text-blue-600`} onClick={() => planSortBy(`${yi}:${mi}`)}>
                            {lb}{planArrow(`${yi}:${mi}`)}
                          </th>
                        )))}
                      </tr>
                    </thead>
                    <tbody>
                      {planSorted.map(r => {
                        const net3 = r.nets[3];
                        const pace = net3 > 5 && net3 > r.nets[2] ? 'up' : net3 < -5 ? 'dn' : 'fl';
                        // 가로 막대 — 전 행 공통 0 기준선, 왼쪽 34px는 음수 라벨 여백
                        const barSpan = 150;
                        const xZero = 34 + barSpan * planMaxNeg / (planMaxNeg + planMaxPos);
                        const w = Math.max(Math.abs(net3) / (planMaxNeg + planMaxPos) * barSpan, 1.5);
                        const regionKey = `${r.sido}|${r.sigungu}`;
                        const opened = planOpenRegion === regionKey;
                        const surv = survOf(r);
                        return (
                          <Fragment key={regionKey}>
                          <tr
                            onClick={() => setPlanOpenRegion(p => (p === regionKey ? null : regionKey))}
                            className={`cursor-pointer border-t border-slate-100 transition-colors hover:bg-blue-50/60 ${opened ? 'bg-blue-50/60' : 'odd:bg-white even:bg-slate-50/60'}`}
                          >
                            <td className="whitespace-nowrap px-3 py-1 text-left text-[13px] font-bold text-slate-900">
                              <ChevronRight size={12} className={`mr-1 inline-block ${opened ? 'text-blue-600' : 'text-slate-300'}`} />
                              <span className="mr-1 text-[11px] font-medium text-slate-400">{sidoShort(r.sido)}</span>{r.sigungu}
                            </td>
                            {r.years.flatMap((y, yi) => [
                              <td key={`n${yi}`} className="border-l border-slate-100 px-2 py-1 text-slate-500">{y.n}</td>,
                              <td key={`c${yi}`} className="px-2 py-1 text-slate-500">{y.c}</td>,
                              <td key={`t${yi}`} className="px-2 py-1 font-bold text-slate-900" style={{ background: planHeat(r.nets[yi]) }}>{r.nets[yi] > 0 ? `+${r.nets[yi]}` : r.nets[yi]}</td>,
                            ])}
                            <td className={`border-l border-slate-100 px-2 py-1 ${r.big ? 'font-semibold text-slate-700' : 'text-slate-300'}`}>{r.big}</td>
                            <td
                              className={`border-l border-slate-100 px-2 py-1 ${surv ? 'font-bold text-slate-900' : 'text-slate-300'}`}
                              style={surv ? { background: survHeat(surv.pct) } : undefined}
                              title={surv ? `${survFrom}~${survTo} 개업 ${surv.n}곳 중 ${surv.n - Math.round(surv.n * surv.pct / 100)}곳이 2년 내 폐업` : `개업 표본 ${SURV_MIN_N}곳 미만 — 비율이 불안정해 생략`}
                            >
                              {surv ? `${surv.pct}%` : '—'}
                            </td>
                            <td className={`border-l border-slate-100 px-2 py-1 text-center text-[11.5px] font-bold ${pace === 'up' ? rankPosCls : pace === 'dn' ? rankNegCls : 'text-slate-400'}`}>
                              {pace === 'up' ? '▲ 성장' : pace === 'dn' ? '▼ 둔화' : '— 보합'}
                            </td>
                            <td className="border-l border-slate-100 px-3 py-0.5 text-left">
                              <svg width={34 + barSpan + 44} height={16} className="block">
                                <line x1={xZero} y1={0} x2={xZero} y2={16} stroke="#e2e8f0" />
                                <rect x={net3 >= 0 ? xZero : xZero - w} y={3} width={w} height={10} rx={2} fill={net3 >= 0 ? '#2563eb' : planNegBar} />
                                <text x={net3 >= 0 ? xZero + w + 5 : xZero - w - 5} y={12} textAnchor={net3 >= 0 ? 'start' : 'end'} fontSize={11} fontWeight={700} fill={net3 >= 0 ? rankPosBar : rankNegBar}>
                                  {net3 > 0 ? `+${net3}` : net3}
                                </text>
                              </svg>
                            </td>
                          </tr>
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 px-1 text-[11px] leading-relaxed text-slate-400">
                  * {planYearLabel(0)}·{planYearLabel(3)}은 부분 집계(조회 창 최근 36개월) · 최근 월 폐업은 신고 지연으로 적게 잡힐 수 있음 · 100평+ = {planYearLabel(3)} 신규 중 대형 매장 수
                  <br />
                  * 2년 생존율 = {survFrom}~{survTo} 개업분이 24개월 내 폐업하지 않은 비율
                  {survAvg != null && <> · 평균 {survAvg}%</>} · 표본 {SURV_MIN_N}곳 미만 —
                </div>
              </div>
            )}
          </div>

          {/* 동별 상세 패널 — 지역 행 클릭 시 오른쪽에 표시 (본 표와 같은 문법: 연도별 신규·폐업·순증) */}
          {planOpenRegion && (
            <aside className="absolute bottom-0 right-0 top-0 z-[350] flex w-[560px] max-w-full flex-col overflow-hidden border-l border-slate-200 bg-white shadow-[-6px_0_24px_rgba(15,23,42,.08)]">
              <div className="flex flex-shrink-0 items-center gap-2.5 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
                <button
                  onClick={() => setPlanOpenRegion(null)}
                  className="flex h-7 w-7 flex-shrink-0 cursor-pointer items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                >
                  <X size={14} />
                </button>
                <div>
                  <div className="text-[14.5px] font-extrabold text-slate-900">
                    <span className="mr-1 text-[11.5px] font-medium text-slate-400">{sidoShort(planOpenRegion.split('|')[0])}</span>
                    {planOpenRegion.split('|')[1]} 동별 상세
                  </div>
                  <div className="text-[11px] text-slate-500">{planDongRows.length}개 동 · {planYearLabel(3)} 순증 순</div>
                </div>
              </div>
              <div className="flex-1 overflow-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200">
                <table className="w-full border-collapse text-right text-[12px] tabular-nums">
                  <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_rgba(226,232,240,1)]">
                    <tr className="text-[11px] text-slate-400">
                      <th className="px-2.5 pt-1.5 text-left font-semibold">동</th>
                      {[0, 1, 2, 3].map(yi => (
                        <th key={yi} colSpan={3} className="border-l border-slate-100 px-1 pt-1.5 text-center font-semibold">{planYearLabel(yi)}{yi === 0 || yi === 3 ? '*' : ''}</th>
                      ))}
                    </tr>
                    <tr className="text-[10.5px] text-slate-400">
                      <th></th>
                      {[0, 1, 2, 3].flatMap(yi => ['신규', '폐업', '순증'].map((lb, mi) => (
                        <th key={`${yi}-${mi}`} className={`${mi === 0 ? 'border-l border-slate-100 ' : ''}px-1.5 pb-1.5 font-medium`}>{lb}</th>
                      )))}
                    </tr>
                  </thead>
                  <tbody>
                    {planDongRows.map(d => (
                      <tr key={d.dong} className="border-t border-slate-100 odd:bg-white even:bg-slate-50/60">
                        <td className="whitespace-nowrap px-2.5 py-1 text-left text-[12.5px] font-bold text-slate-900">{d.dong}</td>
                        {d.years.flatMap((y, yi) => [
                          <td key={`n${yi}`} className="border-l border-slate-100 px-1.5 py-1 text-slate-500">{y.n}</td>,
                          <td key={`c${yi}`} className="px-1.5 py-1 text-slate-500">{y.c}</td>,
                          <td key={`t${yi}`} className="px-1.5 py-1 font-bold text-slate-900" style={{ background: planHeat(d.nets[yi]) }}>{d.nets[yi] > 0 ? `+${d.nets[yi]}` : d.nets[yi]}</td>,
                        ])}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </aside>
          )}
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
