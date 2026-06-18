'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
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
}

interface DrillSummary {
  new: number;
  closed: number;
}

type ViewMode = 'map' | 'rank';
type RegionMode = 'branch' | 'sido';
type RankSort = 'new' | 'closed' | 'net' | 'rate';
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

const API_BASE = 'https://maeilfs-sales.vercel.app';

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function getMonthList(): string[] {
  const list: string[] = [];
  const now = new Date();
  const cur = new Date(2025, 0, 1);
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

function matchCategory(store: DrillStore, cat: Category): boolean {
  if (cat === 'all') return true;
  const haystack = ((store.category || '') + ' ' + (store.name || '')).toLowerCase();
  return CAT_KW[cat]?.some(kw => haystack.includes(kw)) ?? false;
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
  const [cachedRegionsArr, setCachedRegionsArr] = useState<RegionData[]>([]);
  const [availableSidos, setAvailableSidos] = useState<string[]>([]);

  // UI state
  const [mapError, setMapError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('map');
  const [regionMode, setRegionModeState] = useState<RegionMode>('branch');
  const [regionSido, setRegionSido] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category>('all');
  const [rankSort, setRankSort] = useState<RankSort>('new');
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
  const [drillSummary, setDrillSummary] = useState<DrillSummary | null>(null);
  const [drillData, setDrillData] = useState<DrillStore[]>([]);
  const [drillTab, setDrillTab] = useState<DrillTab>('all');
  const [drillLoading, setDrillLoading] = useState(false);
  const [spChartOpen, setSpChartOpen] = useState(false);
  const [currentDrillRegion, setCurrentDrillRegion] = useState('');

  // Refs to hold mutable values without triggering re-renders in map handlers
  const sigunguSidoMapRef = useRef<Record<string, string>>({});
  const viewSidoRef = useRef<string | null>(null);
  const selectedMonthRef = useRef<string | null>(null);
  const selectedCategoryRef = useRef<Category>('all');

  useEffect(() => { sigunguSidoMapRef.current = sigunguSidoMap; }, [sigunguSidoMap]);
  useEffect(() => { viewSidoRef.current = regionSido; }, [regionSido]);
  useEffect(() => { selectedMonthRef.current = selectedMonth; }, [selectedMonth]);
  useEffect(() => { selectedCategoryRef.current = selectedCategory; }, [selectedCategory]);

  // ─── AUTH CHECK ────────────────────────────────────────────────────────────

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) router.replace('/login');
    });
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

    const regionMap: Record<string, RegionData> = {};
    regions.forEach(r => { regionMap[r.region] = r; });

    if (!geoLayerReadyRef.current) {
      const maplibregl = (mapInstance as { getLayer: () => void }).constructor;
      void maplibregl;

      mapInstance.addSource('munis', { type: 'geojson', data: geoData, promoteId: 'name' });

      const tone = ['coalesce', ['feature-state', 'tone'], 'none'];
      const t    = ['coalesce', ['feature-state', 't'], 0];
      mapInstance.addLayer({
        id: 'muni-fill', type: 'fill', source: 'munis',
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
        paint: { 'line-color': '#ffffff', 'line-width': 0.8, 'line-opacity': 0.45 },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mapInstance.on('mousemove', 'muni-fill', (e: any) => {
        const f = e.features[0]; if (!f) return;
        const st = f.state || {};
        if (st.tone == null || st.tone === 'none') {
          mapInstance.getCanvas().style.cursor = '';
          if (mapPopupRef.current) mapPopupRef.current.remove();
          return;
        }
        mapInstance.getCanvas().style.cursor = 'pointer';
        const netStr = (st.net ?? 0) > 0 ? `+${st.net}` : String(st.net ?? 0);
        const html = `<div style="background:#0f172a;color:#fff;border-radius:8px;padding:7px 13px;font-size:13px;font-weight:500;box-shadow:0 4px 20px rgba(15,23,42,.09);white-space:nowrap"><b style="font-weight:800">${f.properties.name}</b><br>신규 ${st.nnew || 0} · 폐업 ${st.closed || 0} · 순증 ${netStr}</div>`;

        if (!mapPopupRef.current) {
          const maplibregl = mapRef.current.constructor;
          void maplibregl;
          // Access Popup via dynamic import — already loaded
          // We use a trick: access the global maplibregl that was loaded
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const ML = (window as any).maplibregl;
          if (ML) {
            mapPopupRef.current = new ML.Popup({
              closeButton: false,
              closeOnClick: false,
              offset: 10,
            });
          }
        }
        if (mapPopupRef.current) {
          mapPopupRef.current.setLngLat(e.lngLat).setHTML(html).addTo(mapInstance);
        }
      });

      mapInstance.on('mouseleave', 'muni-fill', () => {
        mapInstance.getCanvas().style.cursor = '';
        if (mapPopupRef.current) mapPopupRef.current.remove();
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mapInstance.on('click', 'muni-fill', (e: any) => {
        const f = e.features[0];
        if (f && f.state && f.state.tone && f.state.tone !== 'none') {
          openDrilldown(f.properties.name);
        }
      });

      geoLayerReadyRef.current = true;
    }

    mapInstance.removeFeatureState({ source: 'munis' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    geoData.features.forEach((f: any) => {
      const name = f.properties.name;
      let d = regionMap[name];
      if (!d) {
        const parent = Object.keys(regionMap).find(k => k.endsWith('시') && name.startsWith(k));
        if (parent) d = regionMap[parent];
      }
      if (!d) return;
      let toneVal = 'zero';
      let tVal = 0;
      if (d.net > 0)      { toneVal = 'pos'; tVal = Math.min(d.net / 25, 1); }
      else if (d.net < 0) { toneVal = 'neg'; tVal = Math.min(Math.abs(d.net) / 25, 1); }
      mapInstance.setFeatureState(
        { source: 'munis', id: name },
        { tone: toneVal, t: tVal, nnew: d.new, closed: d.closed, net: d.net }
      );
    });
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

        // Fetch available sidos from market_snapshots for region chips
        const { data: sidoData } = await supabase
          .from('market_snapshots')
          .select('sido')
          .gte('month', '2025-01');
        const sidos = [...new Set((sidoData || []).map((r: { sido: string }) => r.sido))].sort();
        setAvailableSidos(sidos);

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

  const loadDashboardData = useCallback(async (
    mode: RegionMode,
    sido: string | null,
    sSigunguMap: Record<string, string[]> = sidoSigunguMap,
    sguSidoMap: Record<string, string> = sigunguSidoMap,
  ) => {
    setRefreshing(true);
    setLastSync('로딩 중...');
    mapCenteredRef.current = false;

    try {
      let snaps: SnapRow[] = [];

      if (mode === 'sido' && sido) {
        const { data, error } = await supabase
          .from('market_snapshots')
          .select('sido, sigungu, month, new_count, closed_count, updated_at')
          .eq('sido', sido)
          .gte('month', '2025-01')
          .order('month', { ascending: true });
        if (error) throw error;
        snaps = data || [];

        // Update sigunguSidoMap for newly loaded regions
        const updatedMap = { ...sguSidoMap };
        snaps.forEach(r => { updatedMap[r.sigungu] = r.sido; });
        setSigunguSidoMap(updatedMap);
        sigunguSidoMapRef.current = updatedMap;

      } else {
        const updatedMap: Record<string, string> = {};
        Object.entries(sSigunguMap).forEach(([s, list]) => {
          list.forEach(sgu => { updatedMap[sgu] = s; });
        });
        setSigunguSidoMap(updatedMap);
        sigunguSidoMapRef.current = updatedMap;

        const allSnaps = await Promise.all(
          Object.entries(sSigunguMap).map(([s, siguList]) =>
            supabase
              .from('market_snapshots')
              .select('sido, sigungu, month, new_count, closed_count, updated_at')
              .eq('sido', s)
              .in('sigungu', siguList)
              .gte('month', '2025-01')
              .order('month', { ascending: true })
              .then(({ data, error }) => {
                if (error) throw error;
                return data || [];
              })
          )
        );
        snaps = allSnaps.flat();
      }

      setCachedSnaps(snaps);

      const lastUpd = snaps.reduce((mx, r) => r.updated_at > mx ? r.updated_at : mx, '');
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

    const regions: Record<string, { new: number; closed: number }> = {};
    displaySnaps.forEach(r => {
      if (!regions[r.sigungu]) regions[r.sigungu] = { new: 0, closed: 0 };
      regions[r.sigungu].new    += r.new_count    || 0;
      regions[r.sigungu].closed += r.closed_count || 0;
    });

    const arr: RegionData[] = Object.entries(regions)
      .map(([region, { new: n, closed: c }]) => ({
        region, new: n, closed: c, net: n - c,
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
        const primarySido = (mode === 'sido' && sido)
          ? sido
          : Object.entries(sSigunguMap).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || '경기도';
        const cfg = SIDO_CENTER[primarySido];
        if (cfg) {
          mapRef.current.flyTo({ center: cfg.center, zoom: cfg.zoom, duration: 800 });
          mapCenteredRef.current = true;
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
    if (mode === 'map') {
      setTimeout(() => { mapRef.current?.resize(); }, 100);
      setTimeout(() => { mapRef.current?.resize(); }, 350);
    }
  }

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

  async function openDrilldown(sigungu: string) {
    setCurrentDrillRegion(sigungu);
    setDrillTitle(sigungu);
    setDrillSummary(null);
    setDrillData([]);
    setDrillTab('all');
    setDrillLoading(true);
    setPanelOpen(true);
    if (trendChartRef.current) { trendChartRef.current.destroy(); trendChartRef.current = null; }

    try {
      const sido = sigunguSidoMapRef.current[sigungu] || viewSidoRef.current || '경기도';
      const monthParam = selectedMonthRef.current ? `&month=${encodeURIComponent(selectedMonthRef.current)}` : '';
      const res = await fetch(`${API_BASE}/api/market-stats?detail=true&sido=${encodeURIComponent(sido)}&sigungu=${encodeURIComponent(sigungu)}${monthParam}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '조회 실패');
      setDrillSummary(data.summary);
      setDrillData(data.stores || []);
    } catch (e) {
      console.error('[discover] drilldown error', e);
      setDrillData([]);
      setDrillSummary(null);
    } finally {
      setDrillLoading(false);
    }
  }

  function closePanel() {
    setPanelOpen(false);
    setSpChartOpen(false);
    setCurrentDrillRegion('');
    setDrillData([]);
    setDrillSummary(null);
    if (trendChartRef.current) { trendChartRef.current.destroy(); trendChartRef.current = null; }
  }

  // ─── RANKING SORT ──────────────────────────────────────────────────────────

  function getSortedRegions(): RegionData[] {
    return [...cachedRegionsArr].sort((a, b) => {
      if (rankSort === 'new')    return b.new - a.new;
      if (rankSort === 'closed') return b.closed - a.closed;
      if (rankSort === 'net')    return b.net - a.net;
      if (rankSort === 'rate')   return b.netRate - a.netRate;
      return 0;
    });
  }

  // ─── DRILL LIST ────────────────────────────────────────────────────────────

  function getFilteredDrillStores(): DrillStore[] {
    let stores = drillData;
    if (drillTab === 'new')    stores = stores.filter(s => s.status === 'new');
    if (drillTab === 'closed') stores = stores.filter(s => s.status === 'closed');
    if (drillTab === 'big')    stores = stores.filter(s => (s.pyeong || 0) >= 100);
    if (selectedCategory !== 'all') stores = stores.filter(s => matchCategory(s, selectedCategory));
    return stores;
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

  const sortedRegions = getSortedRegions();
  const maxNew = Math.max(...sortedRegions.map(r => r.new), 1);
  const filteredDrillStores = getFilteredDrillStores();
  const bigCount = drillData.filter(s => (s.pyeong || 0) >= 100).length;

  return (
    <div className="relative flex-1 overflow-hidden" style={{ height: 'calc(100vh - 56px)' }}>

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

      {/* ── VIEW TOGGLE ── */}
      <div className="absolute top-3.5 left-3.5 z-[600] flex gap-0.5 p-[3px] rounded-full bg-white border border-slate-200 shadow-sm">
        <button
          onClick={() => handleSetViewMode('map')}
          className={`h-8 px-[15px] rounded-full border-none text-xs font-semibold cursor-pointer transition-all whitespace-nowrap ${viewMode === 'map' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'bg-transparent text-slate-500 hover:text-slate-900'}`}
        >
          🗺 지도
        </button>
        <button
          onClick={() => handleSetViewMode('rank')}
          className={`h-8 px-[15px] rounded-full border-none text-xs font-semibold cursor-pointer transition-all whitespace-nowrap ${viewMode === 'rank' ? 'bg-blue-600 text-white shadow-[0_2px_8px_rgba(37,99,235,.3)]' : 'bg-transparent text-slate-500 hover:text-slate-900'}`}
        >
          📊 랭킹
        </button>
      </div>

      {/* ── KPI STRIP ── */}
      <div className="absolute top-3.5 left-1/2 -translate-x-1/2 z-[200] flex items-center rounded-full bg-white border border-slate-200 shadow-sm whitespace-nowrap max-sm:top-[60px]">
        <div className="flex flex-col items-center gap-[1px] px-[18px] py-2 max-sm:px-3">
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.08em] uppercase">신규</span>
          <span className="text-xl font-extrabold text-green-600 tabular-nums leading-none tracking-[-0.03em]">{kpiNew}</span>
        </div>
        <div className="w-px h-6 bg-slate-200 flex-shrink-0" />
        <div className="flex flex-col items-center gap-[1px] px-[18px] py-2 max-sm:px-3">
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.08em] uppercase">폐업</span>
          <span className="text-xl font-extrabold text-red-600 tabular-nums leading-none tracking-[-0.03em]">{kpiClosed}</span>
        </div>
        <div className="w-px h-6 bg-slate-200 flex-shrink-0" />
        <div className="flex flex-col items-center gap-[1px] px-[18px] py-2 max-sm:px-3">
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.08em] uppercase">순증</span>
          <span className="text-xl font-extrabold text-blue-600 tabular-nums leading-none tracking-[-0.03em]">{kpiNet}</span>
        </div>
        <div className="w-px h-6 bg-slate-200 flex-shrink-0" />
        <div className="flex flex-col items-center gap-[1px] px-[18px] py-2 max-sm:px-3">
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.08em] uppercase">성장률</span>
          <span className="text-xl font-extrabold text-amber-600 tabular-nums leading-none tracking-[-0.03em]">{kpiRate}</span>
        </div>
      </div>

      {/* ── TOP RIGHT ── */}
      <div className="absolute top-3.5 right-3.5 z-[200] flex items-center gap-1.5">
        <span className="rounded-full px-3 py-1.5 text-[11px] font-medium text-slate-400 bg-white border border-slate-200 shadow-sm whitespace-nowrap">
          {lastSync}
        </span>
        <button
          disabled={refreshing}
          onClick={() => loadDashboardData(regionMode, regionSido)}
          className="h-8 px-[13px] rounded-full border border-slate-200 bg-white text-slate-500 text-xs font-semibold cursor-pointer transition-all flex items-center gap-1.5 whitespace-nowrap shadow-sm hover:border-blue-500 hover:text-blue-600 disabled:opacity-35 disabled:cursor-not-allowed"
        >
          <span className={refreshing ? 'animate-spin' : ''}>↺</span> 새로고침
        </button>
      </div>

      {/* ── FLOATING TOOLBAR ── */}
      <div className="absolute bottom-[18px] left-1/2 -translate-x-1/2 z-[200] rounded-[14px] px-[14px] pt-[10px] pb-[10px] flex flex-col gap-[7px] max-w-[calc(100vw-28px)] bg-white border border-slate-200 shadow-sm max-sm:bottom-[68px]">
        {/* Row 1: 지역 + 업종 */}
        <div className="flex items-center gap-[7px]">
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase whitespace-nowrap flex-shrink-0 min-w-[26px]">지역</span>
          <div className="flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            <button
              onClick={() => handleSetRegionMode('branch')}
              className={`h-7 px-3 text-xs font-semibold rounded-full border cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${regionMode === 'branch' ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50/50'}`}
            >
              내 지점
            </button>
            {availableSidos.map(sido => (
              <button
                key={sido}
                onClick={() => handleSetRegionMode('sido', sido)}
                className={`h-7 px-3 text-xs font-semibold rounded-full border cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${regionMode === 'sido' && regionSido === sido ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50/50'}`}
              >
                {sido}
              </button>
            ))}
          </div>
          <div className="w-px h-4 bg-slate-200 flex-shrink-0" />
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase whitespace-nowrap flex-shrink-0 min-w-[26px]">업종</span>
          <div className="flex gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {(['all', 'cafe', 'bakery', 'restaurant'] as Category[]).map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`h-7 px-3 text-xs font-semibold rounded-full border cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${selectedCategory === cat ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600 hover:bg-blue-50/50'}`}
              >
                {cat === 'all' ? '전체' : cat === 'cafe' ? '☕ 카페' : cat === 'bakery' ? '🥐 베이커리' : '🍽 음식점'}
              </button>
            ))}
          </div>
        </div>
        {/* Row 2: 월 타임라인 */}
        <div className="flex items-center gap-[7px]">
          <span className="text-[9px] font-semibold text-slate-400 tracking-[.1em] uppercase whitespace-nowrap flex-shrink-0 min-w-[26px]">월</span>
          <div ref={monthTimelineRef} className="flex gap-1 overflow-x-auto flex-1 min-w-0 [&::-webkit-scrollbar]:h-[2px] [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded">
            <button
              onClick={() => handleMonthSelect(null)}
              className={`h-7 px-[11px] rounded-full border text-[11px] font-bold cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${!selectedMonth ? 'bg-slate-900 border-slate-900 text-white' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600'}`}
            >
              전체
            </button>
            {monthList.map(mo => (
              <button
                key={mo}
                data-month={mo}
                onClick={() => handleMonthSelect(mo)}
                className={`h-7 px-[11px] rounded-full border text-[11px] font-semibold cursor-pointer whitespace-nowrap flex-shrink-0 transition-all ${selectedMonth === mo ? 'bg-blue-600 border-blue-600 text-white font-bold' : 'bg-transparent border-slate-100 text-slate-400 hover:border-blue-500 hover:text-blue-600'}`}
              >
                {mo.slice(2).replace('-', '.')}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── MAP LEGEND ── */}
      <div className="absolute z-[200] left-3.5 rounded-[10px] px-3 py-1.5 flex gap-3 text-[11px] text-slate-500 font-medium bg-white border border-slate-200 shadow-sm" style={{ bottom: 'calc(150px + 18px + 4px + 18px)' }}>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#34c759' }} />순증</div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#ff3b30' }} />순감</div>
        <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: '#a1a1a6' }} />보합</div>
      </div>

      {/* ── PANEL BACKDROP ── */}
      {panelOpen && (
        <div
          className="absolute inset-0 bg-slate-900/30 z-[499] transition-opacity duration-300"
          onClick={closePanel}
        />
      )}

      {/* ── SLIDE PANEL ── */}
      <div className={`absolute top-0 right-0 w-[440px] max-w-full h-full bg-white border-l border-slate-200 shadow-[-6px_0_32px_rgba(15,23,42,.1)] z-[500] flex flex-col overflow-hidden transition-transform duration-300 ease-[cubic-bezier(.4,0,.2,1)] max-sm:w-full ${panelOpen ? 'translate-x-0' : 'translate-x-full'}`}>
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200 flex-shrink-0 bg-slate-50">
          <button
            onClick={closePanel}
            className="w-[30px] h-[30px] rounded-full border border-slate-200 bg-white text-slate-500 cursor-pointer flex items-center justify-center text-[13px] flex-shrink-0 transition-all hover:bg-red-50 hover:text-red-600 hover:border-red-200"
          >
            ✕
          </button>
          <span className="text-[17px] font-extrabold text-slate-900 flex-1 tracking-[-0.025em]">{drillTitle}</span>
        </div>

        {/* Drill summary */}
        {drillSummary && (
          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex gap-6 flex-shrink-0">
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
        )}

        {/* Drill tabs */}
        <div className="flex gap-1 px-3.5 py-[9px] border-b border-slate-200 flex-shrink-0 overflow-x-auto [&::-webkit-scrollbar]:hidden">
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

        {/* Drill list */}
        <div className="flex-1 overflow-y-auto min-h-0 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded">
          {drillLoading ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-slate-400 text-[13px] text-center leading-relaxed">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
              불러오는 중...
            </div>
          ) : filteredDrillStores.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-slate-400 text-[13px] text-center leading-relaxed">
              <span className="text-3xl opacity-70">{drillSummary ? '📭' : '⏳'}</span>
              {drillSummary ? '해당 데이터 없음' : (
                <span>데이터 없음<br /><span className="text-xs">상권 통계 저장 후 이용 가능합니다</span></span>
              )}
            </div>
          ) : (
            filteredDrillStores.map((s, i) => {
              const isBig = (s.pyeong || 0) >= 100;
              return (
                <div key={i} className="px-5 py-[13px] border-b border-slate-100 transition-colors hover:bg-slate-50">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-sm font-bold text-slate-900 flex-1 overflow-hidden text-ellipsis whitespace-nowrap">{s.name}</span>
                    {isBig && (
                      <span className="text-[10px] font-bold text-amber-600 bg-amber-50 rounded px-1.5 py-0.5 flex-shrink-0">★ 대형</span>
                    )}
                    <span className={`text-[11px] font-bold px-[9px] py-0.5 rounded-[20px] flex-shrink-0 ${s.status === 'new' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {s.status === 'new' ? '신규' : '폐업'}
                    </span>
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
            <span>📈 월별 추이</span>
            <span>{spChartOpen ? '▼ 접기' : '▲ 펼치기'}</span>
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
            <div className="flex gap-1">
              {(['new', 'closed', 'net', 'rate'] as RankSort[]).map(sort => (
                <button
                  key={sort}
                  onClick={() => setRankSort(sort)}
                  className={`h-[27px] px-3 rounded-full border text-[11px] font-semibold cursor-pointer transition-all ${rankSort === sort ? 'bg-slate-900 border-slate-900 text-white font-bold' : 'bg-transparent border-slate-200 text-slate-500 hover:border-blue-500 hover:text-blue-600'}`}
                >
                  {sort === 'new' ? '신규순' : sort === 'closed' ? '폐업순' : sort === 'net' ? '순증순' : '성장률순'}
                </button>
              ))}
            </div>
          </div>

          {/* Card grid */}
          <div className="flex-1 overflow-y-auto p-3.5 grid gap-2.5 [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-slate-200 [&::-webkit-scrollbar-thumb]:rounded" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', alignContent: 'start' }}>
            {sortedRegions.length === 0 ? (
              <div className="col-span-full flex flex-col items-center justify-center gap-2.5 py-16 text-slate-400 text-[13px] text-center leading-relaxed">
                <span className="text-3xl opacity-70">⏳</span>
                데이터 불러오는 중...
              </div>
            ) : sortedRegions.map((r, i) => {
              const pct    = Math.round((r.new / maxNew) * 100);
              const barC   = r.net > 0 ? '#34c759' : r.net < 0 ? '#ff3b30' : '#d1d5db';
              const netStr = r.net > 0 ? `+${r.net}` : String(r.net);
              const netCls = r.net > 0 ? 'text-green-600' : r.net < 0 ? 'text-red-600' : 'text-slate-400';
              return (
                <div
                  key={r.region}
                  onClick={() => openDrilldown(r.region)}
                  className="bg-white rounded-[10px] border border-slate-200 px-[18px] py-4 cursor-pointer transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-blue-200"
                >
                  <div className="flex items-baseline justify-between mb-2.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11px] font-semibold text-slate-400 min-w-[22px]">#{i + 1}</span>
                      <span className="text-base font-extrabold text-slate-900 tracking-[-0.02em]">{r.region}</span>
                    </div>
                    <span className={`text-[15px] font-extrabold tabular-nums ${netCls}`}>{netStr}</span>
                  </div>
                  <div className="h-[3px] bg-slate-200 rounded mb-3 overflow-hidden">
                    <div className="h-full rounded transition-[width] duration-500 ease-[cubic-bezier(.4,0,.2,1)]" style={{ width: `${pct}%`, background: barC }} />
                  </div>
                  <div className="flex gap-[18px]">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-semibold tracking-[.08em] uppercase" style={{ color: '#34c759' }}>신규</span>
                      <span className="text-[19px] font-extrabold tabular-nums leading-none" style={{ color: '#34c759' }}>{r.new}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-semibold tracking-[.08em] uppercase" style={{ color: '#ff3b30' }}>폐업</span>
                      <span className="text-[19px] font-extrabold tabular-nums leading-none" style={{ color: '#ff3b30' }}>{r.closed}</span>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[9px] font-semibold text-slate-400 tracking-[.08em] uppercase">성장률</span>
                      <span className="text-[19px] font-extrabold tabular-nums leading-none text-slate-500">{r.netRate}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
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
  );
}
