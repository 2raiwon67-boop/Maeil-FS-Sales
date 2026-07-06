'use client';

import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { toast } from 'sonner';
import { useDashboardData } from '@/hooks/use-dashboard-data';
import { useAuth } from '@/hooks/use-auth';
import { useManager } from '@/hooks/use-manager';
import {
  loadNaverMaps,
  cachedGeocode,
  cleanGeocodeQuery,
  onNaverAuthFailure,
  type NaverMap,
  type NaverMarker,
} from '@/lib/naver/loader';
import { buildMarkerIcon, buildCartMarkerIcon, buildAccountMarkerIcon, buildSelectionRingIcon } from '@/lib/dashboard/markers';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/dashboard/constants';
import {
  emptyFilters,
  computeCounts,
  licenseMarkerVisible,
  accountMarkerVisible,
  toggleInSet,
  type FilterState,
  type SidebarTab,
} from '@/lib/dashboard/filters';
import { cartKey, haversineKm, type CartStop, type Coord, type RouteStop } from '@/lib/dashboard/route';
import {
  updateLicenseStatus,
  updateLicenseMilk,
  updateAccountStatus,
} from '@/lib/dashboard/mutations';
import { DashboardSidebar } from '@/components/dashboard/sidebar';
import { DashboardCharts } from '@/components/dashboard/dashboard-charts';
import { StoreDetail, type SelectedStore } from '@/components/dashboard/store-detail';
import {
  RoutePanel,
  type LicenseStop,
  type AccountStop,
} from '@/components/dashboard/route-panel';
import { VisitPlansModal, type PlanItem } from '@/components/dashboard/visit-plans-modal';
import { StoreListPanel } from '@/components/dashboard/store-list-panel';
import { RecommendPanel, type RecItem } from '@/components/dashboard/recommend-panel';
import { Sparkles, Search } from 'lucide-react';
import { getColorblind, onColorblindChange, setColorblind as setColorblindSetting } from '@/lib/settings';
import type { License, Account } from '@/types';
import { createClient } from '@/lib/supabase/client';

interface SearchHit {
  name: string;
  sub: string;
  marker: NaverMarker;
}

function useIsMobile() {
  const [mobile, setMobile] = useState(false);
  useEffect(() => {
    const check = () => setMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  return mobile;
}

export default function DashboardPage() {
  const { licenses, accounts, loading, error, setLicenses, setAccounts } = useDashboardData();
  const { metadata } = useAuth();
  const { myManagerName } = useManager();
  const businessUnit = metadata?.business_unit ?? null;
  const mobile = useIsMobile();

  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | null>(null);
  const [mapInstance, setMapInstance] = useState<NaverMap | null>(null);
  const licMarkersRef = useRef<NaverMarker[]>([]);
  const accMarkersRef = useRef<NaverMarker[]>([]);
  const markerByKeyRef = useRef<Map<string, NaverMarker>>(new Map());
  const selRingRef = useRef<NaverMarker | null>(null);
  const coordsByIdRef = useRef<Map<string, { lat: number; lng: number }>>(new Map());

  const [sdkReady, setSdkReady] = useState(false);
  const [geocoding, setGeocoding] = useState<{ done: number; total: number } | null>(null);
  const [built, setBuilt] = useState(false);
  const [authFail, setAuthFail] = useState(false);

  const [filters, setFilters] = useState<FilterState>(emptyFilters);
  const [collapsed, setCollapsed] = useState(false);
  const [view, setView] = useState<'map' | 'dashboard'>('map');
  const [colorblind, setColorblind] = useState(false);

  // 모바일(협폭)에선 300px 필터 사이드바가 지도를 대부분 가리므로 기본 접힘
  useEffect(() => {
    const t = setTimeout(() => { if (window.innerWidth < 768) setCollapsed(true); }, 0);
    return () => clearTimeout(t);
  }, []);

  const [search, setSearch] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  // 모바일: 검색창을 상시 노출하지 않고 지도/통계 토글 옆 아이콘으로 여닫음 (컴팩트)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (mobileSearchOpen) searchInputRef.current?.focus(); }, [mobileSearchOpen]);

  // 상세 / 장바구니 / 동선 / 일정
  const [selected, setSelected] = useState<SelectedStore | null>(null);
  // 알림 클릭 → 해당 인허가 매장 포커스 (?focus=id 또는 헤더 벨 이벤트)
  const [focusId, setFocusId] = useState<string | null>(() =>
    typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('focus') : null,
  );
  const focusDoneRef = useRef<string | null>(null);
  const [cart, setCart] = useState<CartStop[]>([]);
  const [routeOpen, setRouteOpen] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [recOpen, setRecOpen] = useState(false);
  const [todayHasPlan, setTodayHasPlan] = useState(false);
  const [routeStartCoord, setRouteStartCoord] = useState<Coord | null>(null);
  const [forcedFirstStop, setForcedFirstStop] = useState<RouteStop | null>(null);
  const [licenseStops, setLicenseStops] = useState<LicenseStop[]>([]);
  const [accountStops, setAccountStops] = useState<AccountStop[]>([]);

  const counts = useMemo(
    () => computeCounts(licenses, accounts, filters),
    [licenses, accounts, filters],
  );

  // 오늘 가볼 곳 추천 — 내 담당 미거래/미확인 거래처를 1순위 기준 20km·최대 3곳
  // (accountStops를 의존성에 둬 지오코딩 완료 후 좌표가 채워지면 재계산)
  const recs = useMemo<RecItem[]>(() => {
    if (!myManagerName) return [];
    void accountStops;
    const scored = accounts
      .filter((a) => (a.manager_name || '').trim() === myManagerName && a.business_name)
      .map((a) => {
        const c = coordsByIdRef.current.get(a.id);
        if (!c) return null;
        const ds = a.trade_status || '';
        let priority = 0;
        let reason = '';
        if (ds === '미거래') { priority = 2; reason = '미거래 거래처'; }
        else if (!ds) { priority = 1; reason = '거래상태 미확인'; }
        if (!priority) return null;
        const item: RecItem = { id: a.id, name: a.business_name.trim(), dealStatus: ds, reason, lat: c.lat, lng: c.lng, address: a.address || '' };
        return { item, priority };
      })
      .filter((r): r is { item: RecItem; priority: number } => !!r)
      .sort((a, b) => b.priority - a.priority);
    if (!scored.length) return [];
    const anchor = scored[0].item;
    return scored
      .filter((s) => s.item === anchor || haversineKm(anchor.lat, anchor.lng, s.item.lat, s.item.lng) <= 20)
      .slice(0, 3)
      .map((s) => s.item);
  }, [accounts, myManagerName, accountStops]);

  // 오늘 이미 방문 일정이 있으면 추천 뱃지 숨김 (나만 보기 담당자 기준)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!myManagerName || !businessUnit) { if (!cancelled) setTodayHasPlan(false); return; }
      const today = new Date().toISOString().split('T')[0];
      const supabase = createClient();
      const { data } = await supabase
        .from('visit_plans').select('id')
        .eq('business_unit', businessUnit).eq('manager', myManagerName).eq('visit_date', today)
        .maybeSingle();
      if (!cancelled) setTodayHasPlan(!!data);
    })();
    return () => { cancelled = true; };
  }, [myManagerName, businessUnit]);

  // 선택 강조 링: 선택 위치로 옮기고 표시 / 해제 시 숨김
  const showSelRing = useCallback((lat: number, lng: number) => {
    const map = mapRef.current;
    if (!map || !window.naver) return;
    const pos = new window.naver.maps.LatLng(lat, lng);
    if (!selRingRef.current) {
      selRingRef.current = new window.naver.maps.Marker({
        position: pos,
        map,
        icon: buildSelectionRingIcon(),
        zIndex: 50,
        clickable: false,
      }) as NaverMarker;
    } else {
      selRingRef.current.setPosition(pos);
      selRingRef.current.setMap(map);
    }
  }, []);
  const hideSelRing = useCallback(() => {
    selRingRef.current?.setMap(null);
  }, []);

  // 마커 클릭 핸들러를 ref로 안정화 (build effect 내부 리스너에서 호출)
  const onMarkerClickRef = useRef<(m: NaverMarker) => void>(() => {});
  useEffect(() => {
    onMarkerClickRef.current = (m: NaverMarker) => {
      const pos = m.getPosition();
      showSelRing(pos.lat(), pos.lng());
      setSelected({
        item: m._item as License | Account,
        type: (m._dealStatus !== undefined ? 'account' : 'license') as 'license' | 'account',
        lat: pos.lat(),
        lng: pos.lng(),
      });
    };
  });

  useEffect(() => onNaverAuthFailure(() => setAuthFail(true)), []);

  // SDK 로드 + 지도 생성
  useEffect(() => {
    let cancelled = false;
    loadNaverMaps()
      .then(() => {
        if (cancelled || !mapElRef.current || mapRef.current) return;
        mapRef.current = new window.naver.maps.Map(mapElRef.current, {
          center: new window.naver.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
          zoom: DEFAULT_ZOOM,
        });
        window.naver.maps.Event.addListener(mapRef.current, 'click', () => {
          selRingRef.current?.setMap(null);
          setSelected(null);
        });
        setMapInstance(mapRef.current);
        setSdkReady(true);
      })
      .catch((e) => console.error('[dashboard] Naver SDK 로드 실패', e));
    return () => {
      cancelled = true;
    };
  }, []);

  const applyFilters = useCallback((f: FilterState) => {
    const map = mapRef.current;
    if (!map) return;
    licMarkersRef.current.forEach((m) => m.setMap(licenseMarkerVisible(m, f) ? map : null));
    accMarkersRef.current.forEach((m) => m.setMap(accountMarkerVisible(m, f) ? map : null));
  }, []);

  // 데이터+SDK 준비되면 좌표 보강 후 마커 생성
  useEffect(() => {
    if (!sdkReady || loading || built) return;
    if (licenses.length === 0 && accounts.length === 0) return;
    let cancelled = false;

    async function build() {
      const naver = window.naver;
      const map = mapRef.current!;

      const licNeedGeo = licenses.filter(
        (l) => !(parseFloat(String(l.lat)) && parseFloat(String(l.lng))) && l.road_address,
      );
      const accNeedGeo = accounts.filter((a) => a.address);
      const total = licNeedGeo.length + accNeedGeo.length;
      const licCoords = new Map<string, { lat: number; lng: number }>();
      const accCoords = new Map<string, { lat: number; lng: number }>();

      // 지오코딩 성공분은 /api/license-geocode로 DB에도 저장(결측 행만) —
      // 첫 사용자가 채우면 이후 세션·사용자·기기는 재지오코딩 불필요 (discover와 동일 패턴).
      // accounts는 테이블에 lat/lng 컬럼이 없어 localStorage 캐시만 사용.
      let pendingSave: { id: string; lat: number; lng: number }[] = [];
      const flushSave = async () => {
        if (!pendingSave.length) return;
        const body = JSON.stringify({ updates: pendingSave });
        pendingSave = [];
        try {
          await fetch('/api/license-geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
        } catch { /* 저장 실패해도 이번 세션 화면 표시는 유지 */ }
      };

      if (total > 0) setGeocoding({ done: 0, total });
      let done = 0;
      for (const l of licNeedGeo) {
        if (cancelled) { await flushSave(); return; }
        const c = await cachedGeocode(cleanGeocodeQuery(l.road_address!));
        if (c) {
          licCoords.set(l.id, c);
          pendingSave.push({ id: l.id, lat: c.lat, lng: c.lng });
          if (pendingSave.length >= 100) await flushSave();
        }
        done++;
        if (done % 5 === 0 || done === total) setGeocoding({ done, total });
      }
      await flushSave();
      for (const a of accNeedGeo) {
        if (cancelled) return;
        const c = await cachedGeocode(cleanGeocodeQuery(a.address!));
        if (c) accCoords.set(a.id, c);
        done++;
        if (done % 5 === 0 || done === total) setGeocoding({ done, total });
      }
      if (cancelled) return;
      setGeocoding(null);

      const keyMap = new Map<string, NaverMarker>();
      const coordsById = new Map<string, { lat: number; lng: number }>();
      const licMarkers: NaverMarker[] = [];
      const licStops: LicenseStop[] = [];
      for (const l of licenses) {
        const lat = licCoords.get(l.id)?.lat ?? parseFloat(String(l.lat));
        const lng = licCoords.get(l.id)?.lng ?? parseFloat(String(l.lng));
        if (!lat || !lng || isNaN(lat) || isNaN(lng)) continue;
        const status = (l.trade_status || '').toString().trim();
        const icon = buildMarkerIcon(status, l, colorblind);
        if (!icon) continue;
        const marker = new naver.maps.Marker({
          position: new naver.maps.LatLng(lat, lng),
          map: null,
          icon,
        }) as NaverMarker;
        marker._id = l.id;
        marker._item = l;
        marker._origIconObj = icon;
        marker._status = status;
        marker._rank = l.priority || '';
        marker._region = (l.address2 || '기타').trim();
        marker._manager = (l.manager || '미지정').trim();
        marker._milk = (l.milk_type || '').trim();
        marker._name = l.business_name;
        marker._lat = lat;
        marker._lng = lng;
        naver.maps.Event.addListener(marker, 'click', () => onMarkerClickRef.current(marker));
        licMarkers.push(marker);
        keyMap.set(cartKey(lat, lng), marker);
        coordsById.set(l.id, { lat, lng });
        licStops.push({
          name: l.business_name,
          address: l.road_address || '',
          lat,
          lng,
          priority: l.priority || '',
          status,
        });
      }

      const accMarkers: NaverMarker[] = [];
      const accStops: AccountStop[] = [];
      for (const a of accounts) {
        const c = accCoords.get(a.id);
        if (!c) continue;
        const dealStatus = (a.trade_status || '').toString().trim();
        const icon = buildAccountMarkerIcon(dealStatus);
        const marker = new naver.maps.Marker({
          position: new naver.maps.LatLng(c.lat, c.lng),
          map: null,
          icon,
        }) as NaverMarker;
        marker._id = a.id;
        marker._item = a;
        marker._origIconObj = icon;
        marker._dealStatus = dealStatus;
        marker._address = a.address || '';
        marker._managerName = (a.manager_name || '').trim();
        marker._name = a.business_name;
        marker._lat = c.lat;
        marker._lng = c.lng;
        naver.maps.Event.addListener(marker, 'click', () => onMarkerClickRef.current(marker));
        accMarkers.push(marker);
        keyMap.set(cartKey(c.lat, c.lng), marker);
        coordsById.set(a.id, { lat: c.lat, lng: c.lng });
        accStops.push({
          name: a.business_name,
          address: a.address || '',
          lat: c.lat,
          lng: c.lng,
          dealStatus,
        });
      }

      if (cancelled) return;
      licMarkersRef.current = licMarkers;
      accMarkersRef.current = accMarkers;
      markerByKeyRef.current = keyMap;
      coordsByIdRef.current = coordsById;
      setLicenseStops(licStops);
      setAccountStops(accStops);
      applyFilters(filters);
      setBuilt(true);

      const all = [...licMarkers, ...accMarkers];
      if (all.length > 0) {
        const bounds = new naver.maps.LatLngBounds();
        all.forEach((m) => bounds.extend(m.getPosition()));
        map.fitBounds(bounds);
      }
    }

    build();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sdkReady, loading, licenses, accounts]);

  useEffect(() => {
    if (built) applyFilters(filters);
  }, [filters, built, applyFilters]);

  // 색각 보정 설정 로드 + 전역 변경(프로필▸설정) 구독 — 사이드바·설정 모달이 같은 값 공유
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const v = getColorblind();
      if (v && !cancelled) setColorblind(true);
    })();
    const unsub = onColorblindChange((v) => setColorblind(v));
    return () => {
      cancelled = true;
      unsub();
    };
  }, []);

  // 색각 보정 변경 시 인허가 마커 색상 즉시 재적용 (장바구니 담긴 마커는 보라색 유지)
  useEffect(() => {
    if (!built) return;
    licMarkersRef.current.forEach((m) => {
      const icon = buildMarkerIcon(m._status || '', m._item as License, colorblind);
      if (!icon) return;
      m._origIconObj = icon;
      if (!cart.some((c) => c._key === cartKey(m._lat!, m._lng!))) m.setIcon(icon);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [colorblind, built]);

  // 토글 → 전역 설정에 기록(이벤트 발행). 구독 effect가 상태를 갱신해 마커 재색칠.
  const toggleColorblind = () => setColorblindSetting(!colorblind);

  // ── 필터 토글 ──
  const setTab = (tab: SidebarTab) => setFilters((f) => ({ ...f, tab }));
  const toggleStatus = (k: string) => setFilters((f) => ({ ...f, status: toggleInSet(f.status, k) }));
  const toggleMilk = (k: string) => setFilters((f) => ({ ...f, milk: toggleInSet(f.milk, k) }));
  const toggleAccount = (k: string) => setFilters((f) => ({ ...f, account: toggleInSet(f.account, k) }));
  const toggleRegion = (k: string) => setFilters((f) => ({ ...f, region: toggleInSet(f.region, k) }));
  const toggleManager = (k: string) => setFilters((f) => ({ ...f, manager: toggleInSet(f.manager, k) }));
  const resetFilters = () =>
    setFilters((f) => ({
      ...f,
      status: new Set<string>(),
      milk: new Set<string>(),
      account: new Set<string>(),
      region: new Set<string>(),
      manager: new Set<string>(),
    }));

  // ── 검색 ──
  const onSearch = (q: string) => {
    setSearch(q);
    const term = q.trim().toLowerCase();
    if (!term) {
      setHits([]);
      return;
    }
    const pool = [...licMarkersRef.current, ...accMarkersRef.current];
    const result: SearchHit[] = [];
    for (const m of pool) {
      const item = m._item as License & Account;
      const name = (m._name || '').toLowerCase();
      const addr = (item?.road_address || item?.address || '').toLowerCase();
      if (name.includes(term) || addr.includes(term)) {
        result.push({ name: m._name || '', sub: item?.road_address || item?.address || '', marker: m });
        if (result.length >= 20) break;
      }
    }
    setHits(result);
  };

  const goToHit = (hit: SearchHit) => {
    const map = mapRef.current;
    if (!map) return;
    map.setCenter(hit.marker.getPosition());
    map.setZoom(16);
    setHits([]);
    setSearch(hit.name);
    onMarkerClickRef.current(hit.marker);
  };

  // ── 장바구니 ──
  const cartHas = useCallback((key: string) => cart.some((c) => c._key === key), [cart]);

  const setMarkerCartColor = (key: string, inCart: boolean) => {
    const m = markerByKeyRef.current.get(key);
    if (!m) return;
    m.setIcon(inCart ? buildCartMarkerIcon() : m._origIconObj);
  };

  const toggleCart = useCallback((stop: CartStop) => {
    setCart((prev) => {
      const idx = prev.findIndex((c) => c._key === stop._key);
      if (idx !== -1) {
        setMarkerCartColor(stop._key, false);
        return prev.filter((_, i) => i !== idx);
      }
      if (prev.length >= 4) {
        toast.warning('경유지는 최대 4곳까지 담을 수 있습니다.');
        return prev;
      }
      setMarkerCartColor(stop._key, true);
      toast.success(`담겼습니다: ${stop.name}`);
      return [...prev, stop];
    });
  }, []);

  const removeFromCart = (idx: number) => {
    setCart((prev) => {
      const target = prev[idx];
      if (target) setMarkerCartColor(target._key, false);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const clearCart = () => {
    cart.forEach((c) => setMarkerCartColor(c._key, false));
    setCart([]);
  };

  // 추천 항목을 동선 cart에 토글 (toggleCart가 최대 4곳·마커색·토스트 처리)
  const toggleRec = (r: RecItem) => {
    toggleCart({ lat: r.lat, lng: r.lng, name: r.name, address: r.address, type: 'account', _key: cartKey(r.lat, r.lng) });
  };
  const addAllRecs = () => {
    recs.forEach((r) => { if (!cart.some((c) => c._key === cartKey(r.lat, r.lng))) toggleRec(r); });
  };

  const loadPlanItemsToCart = (items: PlanItem[]) => {
    cart.forEach((c) => setMarkerCartColor(c._key, false));
    const next: CartStop[] = [];
    for (const it of items) {
      if (next.length >= 4 || !it.lat || !it.lng) continue;
      const key = cartKey(it.lat, it.lng);
      next.push({
        lat: it.lat,
        lng: it.lng,
        name: it.name,
        address: it.address || '',
        type: (it.type as 'license' | 'account') || 'license',
        _key: key,
      });
      setMarkerCartColor(key, true);
    }
    setCart(next);
    setRouteOpen(true);
    toast.success(`${next.length}곳이 경유지에 불러와졌습니다`);
  };

  const savePlanForDate = async (date: string) => {
    if (cart.length === 0) {
      toast.warning('경유지를 먼저 담아주세요');
      return;
    }
    if (!myManagerName) {
      toast.error('담당자 정보를 확인할 수 없습니다');
      return;
    }
    const supabase = createClient();
    const today = new Date().toISOString().split('T')[0];
    try {
      await supabase.from('visit_plans').delete().eq('business_unit', businessUnit).eq('manager', myManagerName).lt('visit_date', today);
      const { error: e } = await supabase.from('visit_plans').upsert(
        {
          business_unit: businessUnit,
          manager: myManagerName,
          visit_date: date,
          items: cart.map((c) => ({ name: c.name, address: c.address, lat: c.lat, lng: c.lng, type: c.type })),
        },
        { onConflict: 'business_unit,manager,visit_date' },
      );
      if (e) throw e;
      toast.success('일정이 생성되었습니다!');
    } catch {
      toast.error('일정 저장에 실패했습니다');
    }
  };

  // ── 인라인 수정 ──
  const refreshLicenseMarker = (id: string, lic: License) => {
    const m = licMarkersRef.current.find((mk) => mk._id === id);
    if (!m) return;
    const status = (lic.trade_status || '').trim();
    const icon = buildMarkerIcon(status, lic, colorblind);
    m._status = status;
    m._milk = (lic.milk_type || '').trim();
    m._item = lic;
    if (icon) {
      m._origIconObj = icon;
      if (!cartHas(cartKey(m._lat!, m._lng!))) m.setIcon(icon);
    } else {
      m.setMap(null);
    }
  };

  const onStatusChange = async (newStatus: string): Promise<boolean> => {
    if (!selected || !businessUnit) return false;
    try {
      if (selected.type === 'license') {
        const lic = selected.item as License;
        await updateLicenseStatus(businessUnit, lic.business_name, lic.road_address, newStatus);
        const updated = { ...lic, trade_status: newStatus };
        setLicenses((ls) => ls.map((l) => (l.id === lic.id ? updated : l)));
        setSelected((s) => (s ? { ...s, item: updated } : s));
        refreshLicenseMarker(lic.id, updated);
      } else {
        const acc = selected.item as Account;
        await updateAccountStatus(businessUnit, acc.business_name, newStatus);
        const updated = { ...acc, trade_status: newStatus };
        setAccounts((as) => as.map((a) => (a.id === acc.id ? updated : a)));
        setSelected((s) => (s ? { ...s, item: updated } : s));
        const m = accMarkersRef.current.find((mk) => mk._id === acc.id);
        if (m) {
          const icon = buildAccountMarkerIcon(newStatus);
          m._dealStatus = newStatus;
          m._origIconObj = icon;
          if (!cartHas(cartKey(m._lat!, m._lng!))) m.setIcon(icon);
        }
      }
      toast.success('변경되었습니다');
      return true;
    } catch (e) {
      toast.error(`변경 실패: ${(e as Error).message}`);
      return false;
    }
  };

  const onMilkChange = async (newMilk: string): Promise<boolean> => {
    if (!selected || selected.type !== 'license' || !businessUnit) return false;
    try {
      const lic = selected.item as License;
      await updateLicenseMilk(businessUnit, lic.business_name, lic.road_address, newMilk);
      const updated = { ...lic, milk_type: newMilk };
      setLicenses((ls) => ls.map((l) => (l.id === lic.id ? updated : l)));
      setSelected((s) => (s ? { ...s, item: updated } : s));
      refreshLicenseMarker(lic.id, updated);
      return true;
    } catch (e) {
      toast.error(`사용우유 변경 실패: ${(e as Error).message}`);
      return false;
    }
  };

  // 목록 패널에서 항목 클릭 → 상세 열기 + 지도 이동
  const onOpenStore = (item: License | Account, type: 'license' | 'account') => {
    const c = coordsByIdRef.current.get(item.id);
    const lat = c?.lat ?? 0;
    const lng = c?.lng ?? 0;
    setSelected({ item, type, lat, lng });
    // 모바일: 목록 패널(z-50)이 상세 바텀시트를 덮으므로 선택 즉시 닫아 상세가 보이게
    if (mobile) setListOpen(false);
    if (c && mapRef.current) {
      mapRef.current.setCenter(new window.naver.maps.LatLng(c.lat, c.lng));
      mapRef.current.setZoom(16);
      showSelRing(c.lat, c.lng);
    }
  };

  // 헤더 벨에서 같은 페이지 클릭 시 (리마운트 없음) 포커스 이벤트 수신
  useEffect(() => {
    const onFocus = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id) setFocusId(id);
    };
    window.addEventListener('fs-focus-store', onFocus);
    return () => window.removeEventListener('fs-focus-store', onFocus);
  }, []);

  // 데이터·지도 준비되면 대상 매장 상세 열기 (마커 좌표 빌드 대기 후)
  useEffect(() => {
    if (!focusId || focusDoneRef.current === focusId) return;
    if (!licenses.length || !mapInstance) return;
    const lic = licenses.find((l) => l.id === focusId);
    if (!lic) return;
    focusDoneRef.current = focusId;
    const t = setTimeout(() => {
      const c = coordsByIdRef.current.get(lic.id);
      setSelected({ item: lic, type: 'license', lat: c?.lat ?? 0, lng: c?.lng ?? 0 });
      if (c && mapRef.current) {
        mapRef.current.setCenter(new window.naver.maps.LatLng(c.lat, c.lng));
        mapRef.current.setZoom(16);
        showSelRing(c.lat, c.lng);
      }
      setFocusId(null);
      if (window.location.search.includes('focus')) {
        window.history.replaceState(null, '', '/');
      }
    }, 300);
    return () => clearTimeout(t);
  }, [focusId, licenses, mapInstance, showSelRing]);

  const selectedInCart = selected ? cartHas(cartKey(selected.lat, selected.lng)) : false;

  const onToggleCartFromDetail = () => {
    if (!selected) return;
    toggleCart({
      lat: selected.lat,
      lng: selected.lng,
      name: (selected.item.business_name as string) || '매장',
      address:
        (selected.type === 'account'
          ? (selected.item as Account).address
          : (selected.item as License).road_address) || '',
      type: selected.type,
      _key: cartKey(selected.lat, selected.lng),
    });
  };

  const onRouteFromDetail = () => {
    if (!selected) return;
    setForcedFirstStop({
      lat: selected.lat,
      lng: selected.lng,
      name: (selected.item.business_name as string) || '선택 목적지',
      address:
        (selected.type === 'account'
          ? (selected.item as Account).address
          : (selected.item as License).road_address) || '',
      type: 'primary',
    });
    hideSelRing();
    setSelected(null);
    setRouteOpen(true);
  };

  return (
    <div className="relative flex h-[calc(100dvh-3rem-4rem)] w-full md:h-[calc(100dvh-88px)]">
      <DashboardSidebar
        filters={filters}
        counts={counts}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed((c) => !c)}
        onTab={setTab}
        onStatus={toggleStatus}
        onMilk={toggleMilk}
        onAccount={toggleAccount}
        onRegion={toggleRegion}
        onManager={toggleManager}
        onReset={resetFilters}
        colorblind={colorblind}
        onToggleColorblind={toggleColorblind}
      />

      <div className="relative flex-1">
        <div ref={mapElRef} className="h-full w-full" />

        {/* 통계 오버레이 */}
        {view === 'dashboard' && (
          <div className="absolute inset-0 z-20">
            <DashboardCharts licenses={licenses} />
          </div>
        )}

        {/* 지도 검색창 */}
        {view === 'map' && (
          <div className={`absolute left-3 top-3 z-10 w-[min(320px,calc(100%-1.5rem))] max-md:top-[3.6rem] ${mobileSearchOpen || search ? '' : 'max-md:hidden'}`}>
            <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-lg ring-1 ring-black/5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#86868b" strokeWidth="2.5" strokeLinecap="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                ref={searchInputRef}
                value={search}
                onChange={(e) => onSearch(e.target.value)}
                placeholder="매장명·주소 검색"
                className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400"
              />
              {search && (
                <button onClick={() => onSearch('')} className="text-gray-400 hover:text-gray-600">
                  ✕
                </button>
              )}
            </div>
            {hits.length > 0 && (
              <div className="mt-1 max-h-72 overflow-y-auto rounded-xl bg-white shadow-lg ring-1 ring-black/5">
                {hits.map((h, i) => (
                  <button
                    key={i}
                    onClick={() => goToHit(h)}
                    className="flex w-full flex-col items-start gap-0.5 border-b border-gray-50 px-3 py-2 text-left last:border-0 hover:bg-gray-50"
                  >
                    <span className="text-sm font-medium text-gray-800">{h.name}</span>
                    {h.sub && <span className="text-xs text-gray-400">{h.sub}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 지도/통계 토글 (통계 오버레이 z-20 위에 떠야 다시 지도로 전환 가능) */}
        <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 gap-1 rounded-xl bg-white/95 p-1 shadow-lg ring-1 ring-black/5">
          {view === 'map' && (
            <button
              onClick={() => setMobileSearchOpen((o) => !o)}
              aria-label="매장 검색"
              className={`flex items-center justify-center rounded-lg px-2.5 transition-colors md:hidden ${
                mobileSearchOpen || search ? 'bg-blue-600 text-white' : 'text-gray-600'
              }`}
            >
              <Search size={15} />
            </button>
          )}
          {(['map', 'dashboard'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`whitespace-nowrap rounded-lg px-4 py-1.5 text-sm font-medium transition-colors ${
                view === v ? 'bg-blue-600 text-white' : 'text-gray-600'
              }`}
            >
              {v === 'map' ? '지도' : '통계'}
            </button>
          ))}
        </div>

        {/* 플로팅 액션 버튼 (목록 / 영업동선 / 내 일정) */}
        {view === 'map' && (
          <div className="absolute bottom-6 right-4 z-10 flex flex-col items-end gap-2">
            <button
              onClick={() => setListOpen(true)}
              className="rounded-full bg-white px-4 py-2.5 text-sm font-bold text-gray-700 shadow-lg ring-1 ring-black/5"
            >
              ☰ 목록
            </button>
            {recs.length > 0 && !todayHasPlan && !recOpen && (
              <button
                onClick={() => setRecOpen(true)}
                className="flex items-center gap-1.5 rounded-full bg-white px-4 py-2.5 text-sm font-bold text-[#ff9f0a] shadow-lg ring-1 ring-[#ff9f0a]/30"
              >
                <Sparkles size={15} />방문 추천
                <span className="rounded-full bg-[#ff9f0a] px-1.5 text-xs text-white">{recs.length}</span>
              </button>
            )}
            {myManagerName && (
              <button
                onClick={() => setPlansOpen(true)}
                className="rounded-full bg-[#ff9f0a] px-4 py-2.5 text-sm font-bold text-white shadow-lg"
              >
                📅 내 일정
              </button>
            )}
            <button
              onClick={() => setRouteOpen(true)}
              className="flex items-center gap-2 rounded-full bg-[#5856d6] px-4 py-2.5 text-sm font-bold text-white shadow-lg"
            >
              동선
              {cart.length > 0 && (
                <span className="rounded-full bg-white/30 px-1.5 text-xs">{cart.length}</span>
              )}
            </button>
          </div>
        )}

        {/* 인증 실패 */}
        {authFail && (
          <div className="absolute left-1/2 top-20 z-30 w-[min(90%,520px)] -translate-x-1/2 rounded-xl bg-red-50 p-4 text-sm text-red-800 shadow-lg ring-1 ring-red-200">
            <p className="font-semibold">네이버 지도 인증 실패</p>
            <p className="mt-1 text-red-700">
              이 도메인이 네이버 클라우드 플랫폼 Maps의 Web 서비스 URL에 등록되지 않았습니다.
            </p>
          </div>
        )}

        {/* 로딩 / 지오코딩 / 에러 */}
        {(loading || geocoding) && (
          <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-black/75 px-5 py-2.5 text-sm text-white shadow-lg">
            {loading ? '데이터를 불러오는 중...' : `좌표 변환 중... (${geocoding!.done}/${geocoding!.total})`}
          </div>
        )}
        {error && (
          <div className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full bg-red-600 px-5 py-2.5 text-sm text-white shadow-lg">
            데이터 로드 실패: {error}
          </div>
        )}

        {/* 상세 (데스크탑 카드 / 모바일 바텀시트) */}
        <StoreDetail
          key={selected ? `${selected.type}-${selected.item.id}` : 'none'}
          selected={selected}
          mobile={mobile}
          inCart={selectedInCart}
          businessUnit={businessUnit}
          onClose={() => { hideSelRing(); setSelected(null); }}
          onStatusChange={onStatusChange}
          onMilkChange={onMilkChange}
          onToggleCart={onToggleCartFromDetail}
          onRouteFrom={onRouteFromDetail}
        />

        {/* 오늘 가볼 곳 추천 패널 */}
        {view === 'map' && (
          <RecommendPanel
            open={recOpen}
            onClose={() => setRecOpen(false)}
            recs={recs}
            cartKeys={new Set(cart.map((c) => c._key))}
            onToggle={toggleRec}
            onAddAll={addAllRecs}
          />
        )}
      </div>

      <StoreListPanel
        open={listOpen}
        onClose={() => setListOpen(false)}
        licenses={licenses}
        accounts={accounts}
        onOpenStore={onOpenStore}
      />

      <RoutePanel
        open={routeOpen}
        onClose={() => setRouteOpen(false)}
        map={mapInstance}
        cart={cart}
        onRemoveFromCart={removeFromCart}
        onClearCart={clearCart}
        licenseStops={licenseStops}
        accountStops={accountStops}
        routeStartCoord={routeStartCoord}
        setRouteStartCoord={setRouteStartCoord}
        forcedFirstStop={forcedFirstStop}
        setForcedFirstStop={setForcedFirstStop}
        myManagerName={myManagerName}
        onSavePlanForDate={myManagerName ? savePlanForDate : undefined}
      />

      {plansOpen && (
        <VisitPlansModal
          onClose={() => setPlansOpen(false)}
          businessUnit={businessUnit}
          myManagerName={myManagerName}
          onLoadToCart={loadPlanItemsToCart}
        />
      )}
    </div>
  );
}
