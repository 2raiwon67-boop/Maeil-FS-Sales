'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getColorblind, onColorblindChange } from '@/lib/settings';
import { LEGACY_TO_CURRENT, legacySigungu, sigunguMatches } from '@/lib/regions';
import { loadNaverMaps, cachedGeocode, cleanGeocodeQuery } from '@/lib/naver/loader';
import { toast } from 'sonner';
import {
  Map as MapIcon, BarChart3, RefreshCw, X,
  Inbox, Clock, Star, TrendingUp, ChevronDown, ChevronLeft, ChevronRight,
  Check, MapPin, CalendarDays, Tag, Play, Pause, Layers, Box, ExternalLink,
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
interface StoreRow {
  id?: number; // 지오코딩 백필 영속화(market-geocode)용 — DB 행 식별
  name: string;
  sido: string;
  sigungu: string;
  month: string;
  status: 'new' | 'closed';
  category: string | null;
  pyeong: number | null;
  lat: number | null;
  lng: number | null;
  address: string | null;
  license_date: string | null;
  dong: string;
}

interface DongAgg {
  dong: string;
  new: number;
  closed: number;
  net: number;
}

type ViewMode = 'map' | 'rank';
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

function matchCategory(store: { category?: string | null; name?: string | null }, cat: Category): boolean {
  if (cat === 'all') return true;
  const haystack = ((store.category || '') + ' ' + (store.name || '')).toLowerCase();
  return CAT_KW[cat]?.some(kw => haystack.includes(kw)) ?? false;
}

// 주소에서 동/읍/면 추출.
// 도로명주소는 끝 괄호의 법정동 `(여울동)`을, 지번/읍면은 중간 `향남읍`을 사용.
// 건물 동(101동·상가동 등)은 제외 — 행정 단위만.
function extractDong(address?: string | null): string {
  if (!address) return '기타';
  const paren = address.match(/\(([가-힣]+[0-9]?(?:동|읍|면|가))\)\s*$/);
  if (paren) return paren[1];
  // 괄호 안이 "동명,건물명" 형태(도로명주소 흔한 패턴) — 콤마 앞 동명만 추출
  const parenComma = address.match(/\(([가-힣]+[0-9]?(?:동|읍|면|가)),/);
  if (parenComma) return parenComma[1];
  const eupmyeon = address.match(/\s([가-힣]{2,}(?:읍|면))(?:\s|$)/);
  if (eupmyeon) return eupmyeon[1];
  return '기타';
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
        className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${open ? 'border-blue-500 text-blue-600 bg-blue-50/50' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
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

// ─── SPARKLINE ───────────────────────────────────────────────────────────────
// 최근 N개월 순증 미니 막대 (양수 초록↑ / 음수 빨강↓, 0 기준선)
function Sparkline({ values }: { values: number[] }) {
  const n = values.length || 1;
  const max = Math.max(1, ...values.map(v => Math.abs(v)));
  const W = 58, H = 22, bw = W / n, mid = H / 2;
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
            fill={v > 0 ? '#16a34a' : v < 0 ? '#ef4444' : '#cbd5e1'} opacity={0.9}
          />
        );
      })}
    </svg>
  );
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
  const [displayMode, setDisplayMode] = useState<DisplayMode>('points');
  const [colorblind, setColorblind] = useState(false); // 색각보정 (홈/설정모달과 fs_colorblind 공유)
  const [playing, setPlaying] = useState(false);
  const [dockOpen, setDockOpen] = useState(true);
  const [timelineOpen, setTimelineOpen] = useState(true); // 타임랩스 바 접기(지도 시야 확보용)
  const [regionMode, setRegionModeState] = useState<RegionMode>('branch');
  const [regionSido, setRegionSido] = useState<string | null>(null);
  // 기본값=최신 월(3년치 전체 점이 한 번에 찍히는 부담·혼잡 방지). '전체 월'은 드롭다운에서 선택.
  const [selectedMonth, setSelectedMonth] = useState<string | null>(() => { const ml = getMonthList(); return ml[ml.length - 1] ?? null; });
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [rankSort, setRankSort] = useState<RankSort>('net');
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
  const selectedCategoryRef = useRef<Category>('all');
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

  useEffect(() => { sigunguSidoMapRef.current = sigunguSidoMap; }, [sigunguSidoMap]);
  useEffect(() => { viewSidoRef.current = regionSido; }, [regionSido]);
  useEffect(() => { selectedMonthRef.current = selectedMonth; }, [selectedMonth]);
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

      const mapInstance = new maplibregl.Map({
        container: mapContainerRef.current,
        style: `https://api.maptiler.com/maps/streets-v2/style.json?key=${key}`,
        center: [127.1, 37.5],
        zoom: 8,
        attributionControl: false,
        localIdeographFontFamily: "'Pretendard','Apple SD Gothic Neo',sans-serif",
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
    // 시도별로 실제 로드된 시군구 목록(시 폴백 매칭용) + (시도|시군구|동) 순증 집계
    const sigunguBySido = new Map<string, Set<string>>();
    const agg = new Map<string, { new: number; closed: number }>();
    for (const s of cachedStoresRef.current) {
      if (month && s.month !== month) continue;
      if (!sigunguBySido.has(s.sido)) sigunguBySido.set(s.sido, new Set());
      // 동 경계(geojson)는 옛 구명 기준 — 개편된 새 구명(검단구 등)은 옛 이름으로 정규화해 매칭
      const lsg = legacySigungu(s.sido, s.sigungu);
      sigunguBySido.get(s.sido)!.add(lsg);
      const dong = extractDong(s.address);
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
      const city = candidates.has(sgg) ? sgg : [...candidates].find(c => sgg.startsWith(c));
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
    stores: StoreRow[], month: string | null, cat: Category,
    dongFilter?: { sigungu: string; dong: string } | null,
  ) {
    const cb = colorblindRef.current;
    const newC = cb ? '#2563eb' : '#16a34a';   // 색각보정: 신규=파랑 / 폐업=주황 (적록 회피)
    const closedC = cb ? '#f97316' : '#e24b4a';
    const bigRing = cb ? '#a855f7' : '#f59e0b'; // 100평+ 링: 일반 앰버 / 색각보정 보라
    const feats = [];
    for (const s of stores) {
      if (s.lat == null || s.lng == null) continue;
      if (month && s.month !== month) continue;
      if (!matchCategory(s, cat)) continue;
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
    const data = buildStoreFeatures(cachedStoresRef.current, selectedMonthRef.current, selectedCategoryRef.current, dongFilter);
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
  // 홈 지도와 동일한 Naver 지오코더+localStorage 캐시 사용. 백그라운드로 돌며 점이 점진적으로 나타남.
  // 성공분은 /api/market-geocode로 DB에도 저장 — 첫 사용자가 채우면 이후 세션·사용자는 재지오코딩 불필요.
  const runGeocodeBackfill = useCallback(async (rows: StoreRow[]) => {
    const runId = ++geocodeRunRef.current; // 새 로드가 시작되면 이전 백필 중단
    const missing = rows.filter(s => (s.lat == null || s.lng == null) && s.address);
    if (!missing.length) return;
    // 현재 보고 있는 월을 먼저 좌표화 (점이 빨리 채워지도록)
    const sel = selectedMonthRef.current;
    missing.sort((a, b) => (b.month === sel ? 1 : 0) - (a.month === sel ? 1 : 0));
    try { await loadNaverMaps(); } catch { return; }
    if (geocodeRunRef.current !== runId) return;
    const coordByAddr = new Map<string, { lat: number; lng: number } | null>();
    let pendingSave: { id: number; lat: number; lng: number }[] = [];
    const flushSave = async () => {
      if (!pendingSave.length) return;
      const body = JSON.stringify({ updates: pendingSave });
      pendingSave = [];
      try {
        await fetch('/api/market-geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      } catch { /* 저장 실패해도 이번 세션 화면 표시는 유지 */ }
    };
    let patched = 0;
    for (const s of missing) {
      if (geocodeRunRef.current !== runId) { await flushSave(); return; }
      const addr = cleanGeocodeQuery(s.address!);
      let c = coordByAddr.get(addr);
      if (c === undefined) { c = await cachedGeocode(addr); coordByAddr.set(addr, c); }
      if (c) {
        s.lat = c.lat; s.lng = c.lng; patched++;
        if (s.id != null) pendingSave.push({ id: s.id, lat: c.lat, lng: c.lng });
        if (patched % 20 === 0) updateStoreLayer();
        if (pendingSave.length >= 100) await flushSave();
      }
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
    mapCenteredRef.current = false;
    // 행정동 경계 스코프 갱신 (줌인 시 이 시도들 경계를 로드) — 스코프 바뀌면 재로드
    scopeSidosRef.current = mode === 'sido' && sido ? [sido] : Object.keys(sSigunguMap);
    dongLoadedKeyRef.current = '';

    try {
      // 단일 소스: market_store_records만 읽고, 독/KPI/랭킹/면/차트/드릴다운 전부 이 데이터로 집계.
      // (예전엔 독은 market_snapshots 집계·드릴다운은 store_records라 숫자가 어긋났음 → 통일)
      // PostgREST max-rows(≈1000) 캡 때문에 .order('id')+.range() 페이지네이션 필수.
      // 좌표 없는 레코드도 포함 — 집계는 전건 기준. 점/히트맵만 buildStoreFeatures에서 좌표 필터.
      const storeCols = 'id,name,sido,sigungu,month,status,category,pyeong,lat,lng,address,license_date,updated_at';
      const PAGE = 1000;
      // 최근 36개월(3년) 롤링 윈도우 — 백필된 과거치까지 노출
      const minMonth = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 35); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })();
      // 총건수를 먼저 구해 페이지를 병렬로 로드(3년치=대량이라 순차면 느림). count 불가 시 순차 폴백.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loadScoped = async (applyFilters: (q: any) => any) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const acc: any[] = [];
        const { count } = await applyFilters(supabase.from('market_store_records').select('id', { count: 'exact', head: true }));
        if (count != null && count >= 0) {
          const pages = Math.min(Math.max(1, Math.ceil(count / PAGE)), 120);
          const res = await Promise.all(
            Array.from({ length: pages }, (_, i) =>
              applyFilters(supabase.from('market_store_records').select(storeCols)).order('id').range(i * PAGE, i * PAGE + PAGE - 1))
          );
          for (const { data, error } of res) { if (error) { console.warn('[discover] 매장 페이지 로드 실패', error); continue; } if (data) acc.push(...data); }
          return acc;
        }
        for (let from = 0; from < 200000; from += PAGE) { // 폴백: 순차 드레인
          const { data, error } = await applyFilters(supabase.from('market_store_records').select(storeCols)).order('id').range(from, from + PAGE - 1);
          if (error) { console.warn('[discover] 매장 페이지 로드 실패', error); break; }
          const batch = data || [];
          acc.push(...batch);
          if (batch.length < PAGE) break;
        }
        return acc;
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let rawStores: any[] = [];
      if (mode === 'sido' && sido) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        rawStores = await loadScoped((q: any) => q.eq('sido', sido).gte('month', minMonth));
      } else {
        const all = await Promise.all(
          Object.entries(sSigunguMap).map(([s, list]) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            loadScoped((q: any) => q.eq('sido', s).in('sigungu', list).gte('month', minMonth))
          )
        );
        rawStores = all.flat();
      }

      const storeRows: StoreRow[] = rawStores.map(r => ({
        id: r.id, name: r.name, sido: r.sido, sigungu: r.sigungu, month: r.month,
        status: r.status === 'closed' ? 'closed' : 'new',
        category: r.category, pyeong: r.pyeong != null ? Number(r.pyeong) : null,
        lat: r.lat != null ? Number(r.lat) : null, lng: r.lng != null ? Number(r.lng) : null,
        address: r.address, license_date: r.license_date, dong: extractDong(r.address),
      }));
      setCachedStores(storeRows);
      cachedStoresRef.current = storeRows;
      void runGeocodeBackfill(storeRows); // 좌표 결측분 백그라운드 지오코딩(신규 인허가 등)

      // 선택 월에 데이터가 없으면(월초 야간수집 前·수집 지연 등) 데이터가 있는 최신 월로 폴백
      // — 캘린더상 새 달로 넘어갔지만 아직 그 달 데이터가 없을 때 화면 전체가 0으로 비는 문제 방지
      const selMonth = selectedMonthRef.current;
      if (selMonth && storeRows.length && !storeRows.some(r => r.month === selMonth)) {
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
      const snapAgg = new Map<string, SnapRow>();
      for (const r of storeRows) {
        const k = `${r.sido}|${r.sigungu}|${r.month}`;
        let o = snapAgg.get(k);
        if (!o) { o = { sido: r.sido, sigungu: r.sigungu, month: r.month, new_count: 0, closed_count: 0, updated_at: '' }; snapAgg.set(k, o); }
        if (r.status === 'new') o.new_count++; else o.closed_count++;
      }
      const snaps = [...snapAgg.values()];
      setCachedSnaps(snaps);

      const lastUpd = rawStores.reduce((mx, r) => (r.updated_at && r.updated_at > mx ? r.updated_at : mx), '');
      if (lastUpd) {
        const d = new Date(lastUpd).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        setLastSync(`갱신 ${d}`);
      } else {
        setLastSync('데이터 없음');
      }

      applyFiltersInternal(snaps, null, mode, sido, sSigunguMap);

    } catch (e) {
      console.error('[discover] load error', e);
      setLastSync('오류');
      toast.error('데이터 로드에 실패했습니다');
    } finally {
      setRefreshing(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidoSigunguMap, sigunguSidoMap]);

  // ─── APPLY FILTERS ─────────────────────────────────────────────────────────

  function applyFiltersInternal(
    snaps: SnapRow[],
    month: string | null,
    mode: RegionMode,
    sido: string | null,
    sSigunguMap: Record<string, string[]>,
  ) {
    if (!snaps.length) {
      setKpiNew('0'); setKpiClosed('0'); setKpiNet('0'); setKpiRate('0');
      setCachedRegionsArr([]);
      return;
    }

    const displaySnaps = month ? snaps.filter(r => r.month === month) : snaps;

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
    applyFiltersInternal(snaps, month, regionMode, regionSido, sidoSigunguMap);
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
          mapRef.current.fitBounds([[minLng, minLat], [maxLng, maxLat]], {
            padding: { top: 80, bottom: 120, left: 230, right: 50 }, maxZoom: 11, duration: 800,
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
    applyFiltersInternal(cachedSnaps, month, regionMode, regionSido, sidoSigunguMap);
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

  // ─── VIEW MODE TOGGLE ──────────────────────────────────────────────────────

  function handleSetViewMode(mode: ViewMode) {
    setViewMode(mode);
    if (mode === 'rank') stopPlay();
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
    cachedSnaps.filter(r => r.sigungu === sigungu).forEach(r => {
      monthMap[r.month] = { new: r.new_count || 0, closed: r.closed_count || 0 };
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
    if (hadDongFilter) updateStoreLayer();
    if (trendChartRef.current) { trendChartRef.current.destroy(); trendChartRef.current = null; }
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
  const anchorMonth = selectedMonth || monthList[monthList.length - 1];
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
      if (selectedMonth && s.month !== selectedMonth) continue;
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

  // 드릴다운 라이브 집계 (선택 월·업종 즉시 반영)
  const drillScoped = drillStores
    .filter(s => !selectedMonth || s.month === selectedMonth)
    .filter(s => matchCategory(s, selectedCategory));
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
  const drillMM = regionMonthlyNet.get(`${drillSido}|${currentDrillRegion}`);
  const drillTrend = trendMonths.map(mo => drillMM?.get(mo) ?? 0);
  const drillMom = anchorIdx > 0 ? (drillMM?.get(anchorMonth) ?? 0) - (drillMM?.get(monthList[anchorIdx - 1]) ?? 0) : 0;
  const DRILL_CAT_LABEL: Record<'cafe' | 'bakery' | 'restaurant', string> = { cafe: '카페', bakery: '베이커리', restaurant: '음식점' };
  const drillTopCategory = (() => {
    const counts: Record<'cafe' | 'bakery' | 'restaurant', number> = { cafe: 0, bakery: 0, restaurant: 0 };
    drillScoped.forEach(s => { (['cafe', 'bakery', 'restaurant'] as const).forEach(c => { if (matchCategory(s, c)) counts[c]++; }); });
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

  const monthValue = selectedMonth ? selectedMonth.slice(2).replace('-', '.') : '전체 월';
  const monthOptions: DropdownOption[] = [
    { key: '__all', label: '전체 월', active: !selectedMonth },
    ...[...monthList].reverse().map(mo => ({ key: mo, label: mo.slice(2).replace('-', '.'), active: selectedMonth === mo })),
  ];

  return (
    <div className="flex h-[calc(100dvh-3rem)] flex-col overflow-hidden md:h-[calc(100dvh-88px)]">

      {/* ── HEADS-UP FILTER BAR ── */}
      <div className="relative z-[630] flex flex-shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4 py-2.5">
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
          onSelect={(k) => { setSelectedCategory(k as Category); selectedCategoryRef.current = k as Category; updateStoreLayer(); }}
        />
        <FilterDropdown
          icon={<CalendarDays size={14} />}
          value={monthValue}
          options={monthOptions}
          onSelect={(k) => handleMonthSelect(k === '__all' ? null : k)}
        />

        {/* 표시 모드 — 면 / 점 / 히트맵 */}
        {viewMode === 'map' && (
          <div className="ml-auto inline-flex items-center gap-1.5">
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

      {/* ── MAP AREA ── */}
      <div className="relative flex-1 overflow-hidden">

      {/* ── MAP ── */}
      <div ref={mapContainerRef} className="absolute inset-0 w-full h-full" />
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
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-[15px] text-xs font-semibold whitespace-nowrap transition-all ${viewMode === 'map' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <MapIcon size={14} />지도
          </button>
          <button
            onClick={() => handleSetViewMode('rank')}
            className={`inline-flex h-8 items-center gap-1.5 rounded-full px-[15px] text-xs font-semibold whitespace-nowrap transition-all ${viewMode === 'rank' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'text-slate-500 hover:text-slate-900'}`}
          >
            <BarChart3 size={14} />랭킹
          </button>
        </div>
        <button
          disabled={refreshing}
          onClick={() => loadDashboardData(regionMode, regionSido)}
          title={lastSync}
          className="inline-flex h-[34px] w-[34px] items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition-all hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
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
              {selectedMonth ? selectedMonth.slice(2).replace('-', '.') : '전체'}
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

      {/* ── PANEL BACKDROP ── (항상 마운트 → 패널 슬라이드와 같은 300ms로 페이드 인/아웃) */}
      <div
        aria-hidden={!panelOpen}
        onClick={closePanel}
        className={`absolute inset-0 bg-slate-900/30 z-[499] transition-opacity duration-300 ${panelOpen ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
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
              <Sparkline values={drillTrend} />
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
          {/* Header */}
          <div className="px-5 py-3 border-b border-slate-200 bg-white flex-shrink-0 flex items-center justify-between gap-3">
            <span className="text-[11px] font-bold text-slate-500 tracking-[.1em] uppercase">시군구 랭킹</span>
            <div className="flex flex-wrap gap-1">
              {(['net', 'mom', 'new', 'closed', 'rate'] as RankSort[]).map(sort => (
                <button
                  key={sort}
                  onClick={() => setRankSort(sort)}
                  className={`h-[27px] px-3 rounded-full border text-[11px] font-semibold cursor-pointer transition-all ${rankSort === sort ? 'bg-slate-900 border-slate-900 text-white font-bold' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600'}`}
                >
                  {sort === 'net' ? '순증순' : sort === 'mom' ? '모멘텀순' : sort === 'new' ? '신규순' : sort === 'closed' ? '폐업순' : '성장률순'}
                </button>
              ))}
            </div>
          </div>

          {/* Compact ranking table */}
          <div className="flex-1 overflow-y-auto px-3 py-3 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded">
            {sortedRegions.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-slate-400 text-[13px] text-center leading-relaxed">
                <Clock size={28} className="opacity-60" />
                데이터 불러오는 중...
              </div>
            ) : (
              <div className="mx-auto max-w-[760px]">
                {/* 컬럼 헤더 */}
                <div className="grid grid-cols-[1.75rem_minmax(0,1fr)_3rem_4.25rem_4rem_2.25rem] items-center gap-2 px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                  <span className="text-center">#</span>
                  <span>지역</span>
                  <span className="text-right">순증</span>
                  <span className="text-center">최근 6개월</span>
                  <span className="text-right">신·폐</span>
                  <span className="text-right">대형</span>
                </div>
                <div className="flex flex-col gap-1">
                  {sortedRegions.map((r, i) => {
                    const up = r.net > 0, down = r.net < 0;
                    const netStr = up ? `+${r.net}` : String(r.net);
                    const netCls = up ? 'text-green-600' : down ? 'text-red-600' : 'text-slate-400';
                    const momIco = r.mom > 0 ? '▲' : r.mom < 0 ? '▼' : '─';
                    const momCls = r.mom > 0 ? 'text-green-600' : r.mom < 0 ? 'text-red-500' : 'text-slate-300';
                    const momStr = r.mom > 0 ? `전월대비 +${r.mom}` : r.mom < 0 ? `전월대비 ${r.mom}` : '전월과 동일';
                    // 상위 3위 메달 강조 (금/은/동)
                    const medal = i === 0 ? 'bg-amber-400 text-white shadow-[0_2px_6px_rgba(245,158,11,.45)]'
                                : i === 1 ? 'bg-slate-300 text-slate-700'
                                : i === 2 ? 'bg-orange-300 text-white'
                                : 'bg-slate-100 text-slate-400';
                    return (
                      <div
                        key={r.sido + r.region}
                        onClick={() => openDrilldown(r.region, r.sido)}
                        className="grid grid-cols-[1.75rem_minmax(0,1fr)_3rem_4.25rem_4rem_2.25rem] items-center gap-2 cursor-pointer rounded-xl border border-slate-200/70 bg-white px-3 py-2.5 shadow-sm transition-all hover:border-blue-300 hover:bg-blue-50/40"
                      >
                        <span className={`mx-auto flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-extrabold tabular-nums ${medal}`}>{i + 1}</span>
                        <span className="truncate text-[14px] font-bold tracking-[-0.02em] text-slate-900">{regionLabel(r.sido, r.region, multiSido)}</span>
                        <span className={`text-right text-[14px] font-extrabold tabular-nums ${netCls}`}>{netStr}</span>
                        <span className="flex items-center justify-center gap-0.5" title={momStr}>
                          <Sparkline values={r.trend} />
                          <span className={`text-[11px] font-bold ${momCls}`}>{momIco}</span>
                        </span>
                        <span className="text-right text-xs tabular-nums">
                          <span className="font-semibold text-green-600">{r.new}</span>
                          <span className="text-slate-300">·</span>
                          <span className="font-semibold text-red-500">{r.closed}</span>
                        </span>
                        <span className="text-right text-xs font-extrabold tabular-nums">
                          {r.big > 0 ? <span className="text-amber-600">{r.big}</span> : <span className="text-slate-300">0</span>}
                        </span>
                      </div>
                    );
                  })}
                </div>
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
      </div>
    </div>
  );
}
