'use client';

// 영업동선 패널 — 장바구니 경유지 + 반경 3km 자동수집 + TSP + OSRM 경로
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import type { NaverMap, NaverMarker, NaverPolyline } from '@/lib/naver/loader';
import {
  type CartStop,
  type RouteStop,
  type Coord,
  haversineKm,
  nearestNeighborTSP,
  drawRoute,
  openNaverMapsRoute,
  isValidCoord,
} from '@/lib/dashboard/route';

export interface LicenseStop {
  name: string;
  address: string;
  lat: number;
  lng: number;
  priority: string;
  status: string;
}
export interface AccountStop {
  name: string;
  address: string;
  lat: number;
  lng: number;
  dealStatus: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  map: NaverMap | null;
  cart: CartStop[];
  onRemoveFromCart: (idx: number) => void;
  onClearCart: () => void;
  licenseStops: LicenseStop[];
  accountStops: AccountStop[];
  routeStartCoord: Coord | null;
  setRouteStartCoord: (c: Coord | null) => void;
  forcedFirstStop: RouteStop | null;
  setForcedFirstStop: (s: RouteStop | null) => void;
  myManagerName: string | null;
  onSavePlanForDate?: (date: string) => void;
}

const RADIUS_KM = 3;

export function RoutePanel({
  open,
  onClose,
  map,
  cart,
  onRemoveFromCart,
  onClearCart,
  licenseStops,
  accountStops,
  routeStartCoord,
  setRouteStartCoord,
  forcedFirstStop,
  setForcedFirstStop,
  onSavePlanForDate,
}: Props) {
  const [startInfo, setStartInfo] = useState('');
  const [planDate, setPlanDate] = useState('');
  const [showStartInput, setShowStartInput] = useState(false);
  const [startAddr, setStartAddr] = useState('');
  const [routeStops, setRouteStops] = useState<RouteStop[]>([]);
  const [summaryHtml, setSummaryHtml] = useState('');
  const [showResult, setShowResult] = useState(false);

  const routeObjRef = useRef<{ markers: NaverMarker[]; polyline: NaverPolyline | null }>({
    markers: [],
    polyline: null,
  });
  const locMarkerRef = useRef<NaverMarker | null>(null);

  function clearDrawn() {
    routeObjRef.current.markers.forEach((m) => m.setMap(null));
    routeObjRef.current.polyline?.setMap(null);
    routeObjRef.current = { markers: [], polyline: null };
  }

  function showLocMarker(lat: number, lng: number) {
    if (!map) return;
    locMarkerRef.current?.setMap(null);
    locMarkerRef.current = new window.naver.maps.Marker({
      position: new window.naver.maps.LatLng(lat, lng),
      map,
      icon: {
        content:
          '<div style="width:14px;height:14px;background:#007AFF;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(0,122,255,0.3);"></div>',
        anchor: new window.naver.maps.Point(7, 7),
      },
      zIndex: 300,
    }) as NaverMarker;
  }

  function useCurrentLocation() {
    if (!navigator.geolocation) {
      toast.error('위치 서비스를 지원하지 않는 브라우저입니다.');
      return;
    }
    setStartInfo('위치 확인 중...');
    const apply = (pos: GeolocationPosition) => {
      const c = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setRouteStartCoord(c);
      setForcedFirstStop(null);
      setStartInfo('현재 위치 설정됨');
      showLocMarker(c.lat, c.lng);
      if (map) {
        map.setCenter(new window.naver.maps.LatLng(c.lat, c.lng));
        map.setZoom(14);
      }
    };
    navigator.geolocation.getCurrentPosition(
      apply,
      (err) => {
        if (err.code === 1) setStartInfo('위치 권한 거부됨 (직접 입력 이용)');
        else setStartInfo('위치 확인 실패 (직접 입력 이용)');
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 },
    );
  }

  async function geocodeStart() {
    const addr = startAddr.trim();
    if (!addr) return;
    setStartInfo('주소 변환 중...');
    const { cachedGeocode } = await import('@/lib/naver/loader');
    const c = await cachedGeocode(addr);
    if (c) {
      setRouteStartCoord(c);
      setStartInfo(`출발지: ${addr}`);
      showLocMarker(c.lat, c.lng);
    } else {
      setStartInfo('주소를 찾을 수 없습니다.');
    }
  }

  async function optimize() {
    if (!map) return;
    if (!routeStartCoord) {
      toast.error('출발지를 먼저 설정해 주세요.');
      return;
    }
    const myLocationStop: RouteStop = {
      name: '내 위치', address: '현재 출발지',
      lat: routeStartCoord.lat, lng: routeStartCoord.lng, type: 'primary', _dist: 0,
    };

    // 장바구니 모드: 담긴 곳만
    if (cart.length > 0) {
      const stops: RouteStop[] = cart.map((c) => ({
        name: c.name, address: c.address, lat: c.lat, lng: c.lng,
        type: c.type === 'account' ? 'account' : 'primary',
      }));
      const ordered = nearestNeighborTSP(stops, routeStartCoord);
      await finishRoute([myLocationStop, ...ordered]);
      return;
    }

    const searchCenter = forcedFirstStop
      ? { lat: forcedFirstStop.lat, lng: forcedFirstStop.lng }
      : routeStartCoord;

    // 1순위 인허가 + 공사중, 반경 3km
    const primaryStops: RouteStop[] = licenseStops
      .filter((d) => (d.priority === '1' && d.status === '인허가') || d.status === '공사중')
      .filter((d) => isValidCoord(d.lat, d.lng))
      .filter((d) => {
        if (
          forcedFirstStop &&
          Math.abs(d.lat - forcedFirstStop.lat) < 0.0001 &&
          Math.abs(d.lng - forcedFirstStop.lng) < 0.0001
        )
          return false;
        return haversineKm(searchCenter.lat, searchCenter.lng, d.lat, d.lng) <= RADIUS_KM;
      })
      .map((d) => ({
        name: d.name, address: d.address, lat: d.lat, lng: d.lng,
        type: d.status === '공사중' ? 'construction' : 'primary',
      }));

    const addedKeys = new Set<string>();
    if (forcedFirstStop)
      addedKeys.add(`${forcedFirstStop.lat.toFixed(5)},${forcedFirstStop.lng.toFixed(5)}`);
    const accountRouteStops: RouteStop[] = [];
    accountStops
      .filter((m) => isValidCoord(m.lat, m.lng))
      .forEach((m) => {
        const key = `${m.lat.toFixed(5)},${m.lng.toFixed(5)}`;
        if (addedKeys.has(key)) return;
        const nearCenter = haversineKm(searchCenter.lat, searchCenter.lng, m.lat, m.lng) <= RADIUS_KM;
        const nearPrimary = primaryStops.some((p) => haversineKm(p.lat, p.lng, m.lat, m.lng) <= RADIUS_KM);
        if (nearCenter || nearPrimary) {
          addedKeys.add(key);
          accountRouteStops.push({
            name: m.name, address: m.address, lat: m.lat, lng: m.lng,
            type: 'account', dealStatus: m.dealStatus,
          });
        }
      });

    const MAX_TOTAL = forcedFirstStop ? 4 : 5;
    primaryStops.sort(
      (a, b) =>
        haversineKm(searchCenter.lat, searchCenter.lng, a.lat, a.lng) -
        haversineKm(searchCenter.lat, searchCenter.lng, b.lat, b.lng),
    );
    const selectedPrimaries = primaryStops.slice(0, MAX_TOTAL);
    const remaining = MAX_TOTAL - selectedPrimaries.length;
    let selectedAccounts: RouteStop[] = [];
    if (remaining > 0 && accountRouteStops.length > 0) {
      selectedAccounts = accountRouteStops
        .slice()
        .sort(
          (a, b) =>
            haversineKm(searchCenter.lat, searchCenter.lng, a.lat, a.lng) -
            haversineKm(searchCenter.lat, searchCenter.lng, b.lat, b.lng),
        )
        .slice(0, remaining);
    }
    const additional = [...selectedPrimaries, ...selectedAccounts];

    let stops: RouteStop[];
    if (forcedFirstStop) {
      const first = { ...forcedFirstStop };
      first._dist = haversineKm(routeStartCoord.lat, routeStartCoord.lng, first.lat, first.lng);
      if (additional.length === 0) stops = [myLocationStop, first];
      else stops = [myLocationStop, first, ...nearestNeighborTSP(additional, first)];
    } else {
      if (additional.length === 0) {
        toast.error('출발지 반경 3km 이내에 방문 대상이 없습니다.');
        return;
      }
      stops = [myLocationStop, ...nearestNeighborTSP(additional, routeStartCoord)];
    }
    await finishRoute(stops);
  }

  async function finishRoute(stops: RouteStop[]) {
    if (!map) return;
    clearDrawn();
    const result = await drawRoute(map, stops, (stop) => {
      toast.message(stop.name, { description: stop.address });
    });
    routeObjRef.current = { markers: result.markers, polyline: result.polyline };
    setRouteStops(stops);
    setSummaryHtml(result.summaryHtml);
    setShowResult(true);
  }

  function clearRoute() {
    clearDrawn();
    locMarkerRef.current?.setMap(null);
    locMarkerRef.current = null;
    setRouteStops([]);
    setForcedFirstStop(null);
    setRouteStartCoord(null);
    setShowResult(false);
    setStartInfo('');
  }

  const totalDist = routeStops.reduce((s, r) => s + (r._dist || 0), 0);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed right-0 top-[var(--app-header-h)] z-50 flex h-[calc(100dvh-var(--app-header-h))] w-[330px] max-w-[88vw] flex-col bg-white shadow-2xl transition-transform duration-300 md:top-[88px] md:h-[calc(100dvh-88px)] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between bg-[#5856d6] px-4 py-3 text-white">
          <h3 className="text-base font-bold">영업동선</h3>
          <button onClick={onClose} className="text-2xl leading-none text-white/80">×</button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mb-2 text-xs font-semibold text-gray-500">출발지 설정</div>
          <div className="flex gap-1.5">
            <button onClick={useCurrentLocation} className="flex-1 rounded-lg bg-blue-600 py-2 text-xs font-semibold text-white">
              현재 위치
            </button>
            <button onClick={() => setShowStartInput((v) => !v)} className="flex-1 rounded-lg bg-gray-700 py-2 text-xs font-semibold text-white">
              직접 입력
            </button>
          </div>
          {showStartInput && (
            <div className="mt-1.5">
              <input
                value={startAddr}
                onChange={(e) => setStartAddr(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && geocodeStart()}
                placeholder="출발지 주소 입력"
                className="w-full rounded-md border border-gray-300 px-2 py-2 text-xs outline-none"
              />
              <button onClick={geocodeStart} className="mt-1 w-full rounded-md bg-blue-600 py-1.5 text-xs font-semibold text-white">
                주소 확인
              </button>
            </div>
          )}
          {startInfo && <div className="mt-1.5 min-h-[16px] text-[11px] text-gray-500">{startInfo}</div>}

          <div className="mb-1.5 mt-4 flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>
              경유지 목록{' '}
              {cart.length > 0 && (
                <span className="ml-1 rounded-full bg-[#5856d6] px-1.5 py-0.5 text-[10px] text-white">{cart.length}</span>
              )}
            </span>
            {cart.length > 0 && (
              <button onClick={onClearCart} className="text-[11px] font-semibold text-red-500">전체 삭제</button>
            )}
          </div>
          {cart.length === 0 ? (
            <div className="rounded-lg bg-gray-50 p-2.5 text-center text-xs text-gray-400">
              마커를 클릭해 경유지를 담으세요
            </div>
          ) : (
            <div className="space-y-1.5">
              {cart.map((c, i) => (
                <div key={c._key} className="flex items-center gap-2 rounded-lg bg-gray-50 px-2.5 py-2">
                  <span className="text-[11px] font-bold text-[#5856d6]">{i + 1}</span>
                  <span className="flex-1 truncate text-xs text-gray-800">{c.name}</span>
                  <button onClick={() => onRemoveFromCart(i)} className="text-gray-400 hover:text-red-500">×</button>
                </div>
              ))}
            </div>
          )}


          <button onClick={optimize} className="mt-3.5 w-full rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white">
            동선 최적화
          </button>

          {cart.length > 0 && onSavePlanForDate && (
            <div className="mt-3 rounded-lg border border-gray-100 p-2.5">
              <div className="mb-1.5 text-[11px] font-semibold text-gray-500">이 경유지로 방문 일정 저장</div>
              <div className="flex gap-1.5">
                <input
                  type="date"
                  value={planDate}
                  min={new Date().toISOString().split('T')[0]}
                  onChange={(e) => setPlanDate(e.target.value)}
                  className="flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs outline-none"
                />
                <button
                  onClick={() => { if (planDate) { onSavePlanForDate(planDate); setPlanDate(''); } }}
                  className="rounded-md bg-[#5856d6] px-3 py-1.5 text-xs font-semibold text-white"
                >
                  저장
                </button>
              </div>
            </div>
          )}

          {showResult && (
            <div className="mt-4">
              <div className="mb-2 text-xs font-semibold text-gray-500">최적화 결과</div>
              <div className="space-y-1.5">
                {routeStops.map((stop, idx) => {
                  const tag =
                    idx === 0 ? null
                    : stop.type === 'primary' ? { label: '인허가', bg: '#ff3b30' }
                    : stop.type === 'construction' ? { label: '공사중', bg: '#ff9500' }
                    : stop.dealStatus === '거래' ? { label: '기거래처', bg: '#c8a000' }
                    : { label: '미거래처', bg: '#8e8e93' };
                  return (
                    <div key={idx} className="flex items-center gap-2 rounded-lg border border-gray-100 px-2.5 py-2">
                      <div
                        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                        style={{ background: tag?.bg || '#86868b' }}
                      >
                        {idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[13px] font-medium text-gray-800">{stop.name}</div>
                        <div className="text-[11px] text-gray-400">
                          {idx === 0 ? '출발 기준점' : `${stop._dist?.toFixed(1) ?? '?'}km`}
                        </div>
                      </div>
                      {tag && (
                        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold text-white" style={{ background: tag.bg }}>
                          {tag.label}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
              <div
                className="mt-2 rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600"
                dangerouslySetInnerHTML={{ __html: summaryHtml }}
              />
              <div className="mt-1 text-right text-[11px] text-gray-400">예상 총 거리(직선) 약 {totalDist.toFixed(1)}km</div>
              <button
                onClick={() => openNaverMapsRoute(routeStops)}
                className="mt-2 w-full rounded-lg bg-[#03C75A] py-2.5 text-sm font-semibold text-white"
              >
                네이버지도 연결
              </button>
              <button onClick={clearRoute} className="mt-1.5 w-full rounded-lg bg-gray-100 py-2 text-sm font-semibold text-gray-600">
                동선 초기화
              </button>
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
