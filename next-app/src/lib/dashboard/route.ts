// 영업동선(루트 최적화) 헬퍼 — 원본 index.html 포팅
import type { NaverMap, NaverMarker, NaverPolyline, NaverLatLng } from '@/lib/naver/loader';

export interface Coord {
  lat: number;
  lng: number;
}

export interface CartStop extends Coord {
  name: string;
  address: string;
  type: 'license' | 'account';
  _key: string;
}

export interface RouteStop extends Coord {
  name: string;
  address: string;
  type: 'primary' | 'construction' | 'account';
  dealStatus?: string;
  _dist?: number;
}

export function cartKey(lat: number | string, lng: number | string): string {
  return `${parseFloat(String(lat)).toFixed(5)},${parseFloat(String(lng)).toFixed(5)}`;
}

export function isValidCoord(lat?: number, lng?: number): boolean {
  return !!lat && !!lng && !isNaN(lat) && !isNaN(lng) && lat !== 0 && lng !== 0;
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** 최근접 이웃 TSP — 출발점에서 가까운 순으로 순회 */
export function nearestNeighborTSP<T extends RouteStop>(stops: T[], start: Coord): T[] {
  const unvisited = [...stops];
  const ordered: T[] = [];
  let cur: Coord = start;
  while (unvisited.length > 0) {
    let minDist = Infinity;
    let nearestIdx = -1;
    unvisited.forEach((s, i) => {
      const d = haversineKm(cur.lat, cur.lng, s.lat, s.lng);
      if (d < minDist) {
        minDist = d;
        nearestIdx = i;
      }
    });
    const nearest = unvisited.splice(nearestIdx, 1)[0];
    nearest._dist = minDist;
    ordered.push(nearest);
    cur = nearest;
  }
  return twoOptImprove(ordered, start);
}

// 2-opt 개선 — NN 결과에서 구간 교차를 풀어 총거리 단축 (열린 경로: 출발 고정, 복귀 없음)
function twoOptImprove<T extends RouteStop>(ordered: T[], start: Coord): T[] {
  if (ordered.length < 3) return ordered;
  const route = [...ordered];
  const d = (a: Coord, b: Coord) => haversineKm(a.lat, a.lng, b.lat, b.lng);
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < route.length - 1; i++) {
      const prev = i === 0 ? start : route[i - 1];
      for (let j = i + 1; j < route.length; j++) {
        // [i..j] 구간 반전 시 변화량: 경계 두 변만 비교 (마지막 정점 뒤는 열린 끝)
        const after = j + 1 < route.length ? route[j + 1] : null;
        const before = d(prev, route[i]) + (after ? d(route[j], after) : 0);
        const afterSwap = d(prev, route[j]) + (after ? d(route[i], after) : 0);
        if (afterSwap < before - 1e-9) {
          route.splice(i, j - i + 1, ...route.slice(i, j + 1).reverse());
          improved = true;
        }
      }
    }
  }
  // 반전으로 순서가 바뀌었으니 직전 정점 기준 거리 재계산
  let cur: Coord = start;
  for (const s of route) {
    s._dist = d(cur, s);
    cur = s;
  }
  return route;
}

export interface DrawResult {
  markers: NaverMarker[];
  polyline: NaverPolyline | null;
  summaryHtml: string;
}

// 경로선을 지도에 그리고 bounds를 맞춘다 (Naver·OSRM 공용)
function drawPolyline(
  map: NaverMap,
  coords: NaverLatLng[],
): NaverPolyline {
  const naver = window.naver;
  const polyline = new naver.maps.Polyline({
    map,
    path: coords,
    strokeColor: '#34C759',
    strokeWeight: 5,
    strokeOpacity: 0.8,
    strokeLineCap: 'round',
    strokeLineJoin: 'round',
  });
  const bounds = new naver.maps.LatLngBounds();
  coords.forEach((c) => bounds.extend(c));
  map.fitBounds(bounds);
  return polyline;
}

/** NCP Directions(실시간 교통) → OSRM → 직선 3단 폴백. 마커/폴리라인을 지도에 그린다. */
export async function drawRoute(
  map: NaverMap,
  stops: RouteStop[],
  onStopClick?: (stop: RouteStop) => void,
): Promise<DrawResult> {
  const naver = window.naver;
  const markers: NaverMarker[] = [];
  let polyline: NaverPolyline | null = null;
  let summaryHtml = '';
  if (stops.length < 2) return { markers, polyline, summaryHtml };

  const colorMap: Record<string, string> = {
    primary: '#ff3b30',
    construction: '#ff9500',
    account: '#FFD700',
  };
  const borderMap: Record<string, string> = {
    primary: '#c0392b',
    construction: '#e67e00',
    account: '#FFA500',
  };

  stops.forEach((stop, idx) => {
    const c = colorMap[stop.type] || '#86868b';
    const b = borderMap[stop.type] || '#666';
    const marker = new naver.maps.Marker({
      position: new naver.maps.LatLng(stop.lat, stop.lng),
      map,
      icon: {
        content: `<div style="width:22px;height:22px;background:${c};border:2px solid ${b};border-radius:50%;color:white;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 6px rgba(0,0,0,0.35);">${idx + 1}</div>`,
        anchor: new naver.maps.Point(11, 11),
      },
      zIndex: 50,
    }) as NaverMarker;
    if (onStopClick) {
      naver.maps.Event.addListener(marker, 'click', () => onStopClick(stop));
    }
    markers.push(marker);
  });

  const coordsUrl = stops.map((s) => `${s.lng},${s.lat}`).join(';');

  // 1) NCP Directions 15 — 한국 실도로 + 실시간 교통 반영 (경유지 15개 한도 내에서만)
  if (stops.length <= 17) {
    try {
      const res = await fetch(`/api/directions?coords=${coordsUrl}`);
      if (res.ok) {
        const data = await res.json();
        const nwCoords = (data.path as [number, number][]).map(
          (c) => new naver.maps.LatLng(c[1], c[0]),
        );
        polyline = drawPolyline(map, nwCoords);
        const distKm = (data.distance / 1000).toFixed(1);
        const timeMin = Math.round(data.duration / 60000);
        summaryHtml = `<div style="font-size:12px;color:#03C75A;font-weight:600;">네이버 실시간 교통 반영</div><div style="font-size:16px;font-weight:700;color:#1d1d1f;margin-top:4px;">${distKm}km • 약 ${timeMin}분</div>`;
        return { markers, polyline, summaryHtml };
      }
    } catch {
      /* OSRM 폴백으로 진행 */
    }
  }

  // 2) OSRM 폴백 (교통 미반영)
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coordsUrl}?overview=full&geometries=geojson`,
    );
    const data = await res.json();
    if (data.code === 'Ok' && data.routes?.length > 0) {
      const route = data.routes[0];
      const nwCoords = route.geometry.coordinates.map(
        (c: [number, number]) => new naver.maps.LatLng(c[1], c[0]),
      );
      polyline = drawPolyline(map, nwCoords);
      const distKm = (route.distance / 1000).toFixed(1);
      const timeMin = Math.round(route.duration / 60);
      summaryHtml = `<div style="font-size:12px;color:#666;">실도로 경로 (교통 미반영)</div><div style="font-size:16px;font-weight:700;color:#1d1d1f;margin-top:4px;">${distKm}km • 약 ${timeMin}분</div>`;
      return { markers, polyline, summaryHtml };
    }
    throw new Error('OSRM 라우팅 실패');
  } catch {
    const path = stops.map((s) => new naver.maps.LatLng(s.lat, s.lng));
    polyline = new naver.maps.Polyline({
      map,
      path,
      strokeColor: '#FF3B30',
      strokeWeight: 4,
      strokeOpacity: 0.6,
      strokeStyle: 'shortdash',
    });
    summaryHtml = `<div style="font-size:12px;color:#ff3b30;">실도로 경로를 불러오지 못해 직선으로 표시합니다.</div>`;
    const bounds = new naver.maps.LatLngBounds();
    path.forEach((c) => bounds.extend(c));
    map.fitBounds(bounds);
    return { markers, polyline, summaryHtml };
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

// nmap:// 스킴 필수 파라미터 — 없으면 네이버 지도 앱이 요청을 거부함
const NMAP_APPNAME = `appname=${enc('https://maeilfs-sales.vercel.app')}`;

// map.naver.com/p/directions는 경위도가 아니라 Web Mercator(EPSG:3857) 좌표를 받는다.
// WGS84를 그대로 넣으면 적도 부근 (0,0)으로 해석돼 길찾기가 실패.
function toMercator(lng: number, lat: number): [number, number] {
  const R = 20037508.34;
  const x = (lng * R) / 180;
  const y = ((Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) * R) / 180;
  return [x, y];
}

// map.naver.com/p/directions 한 지점 세그먼트 = "{merX},{merY},{이름}"
function naverWebSeg(stop: RouteStop): string {
  const [x, y] = toMercator(stop.lng, stop.lat);
  return `${x.toFixed(1)},${y.toFixed(1)},${enc(stop.name)}`;
}

function buildNaverWebRouteUrl(stops: RouteStop[]): string {
  // 세그먼트 구조: /p/directions/{출발}/{도착}/{경유}/car
  // 출발(stops[0])을 채워야 웹에서 출발지가 뜬다. 예전엔 '-'로 둬서 목적지만 표시됐음.
  // 경유(3번째)는 웹 URL 인코딩 포맷이 비공개라 '-' 유지 — 다중 경유 순회는 모바일 앱 스킴에서만.
  const dest = stops[stops.length - 1];
  const start = stops.length > 1 ? stops[0] : null;
  const startSeg = start ? naverWebSeg(start) : '-';
  return `https://map.naver.com/p/directions/${startSeg}/${naverWebSeg(dest)}/-/car`;
}

// 앱 스킴 시도 후 웹 폴백. 앱이 열리면 페이지가 숨겨지므로(pagehide/visibilitychange)
// 폴백을 건너뛴다 — 이전의 경과시간 비교는 항상 참이라 앱이 열려도 웹이 또 열렸음.
function openSchemeWithWebFallback(schemeUrl: string, webUrl: string, waitMs = 1800): void {
  let appOpened = false;
  const markHidden = () => { if (document.hidden) appOpened = true; };
  document.addEventListener('visibilitychange', markHidden);
  window.addEventListener('pagehide', () => { appOpened = true; }, { once: true });
  window.location.href = schemeUrl;
  setTimeout(() => {
    document.removeEventListener('visibilitychange', markHidden);
    if (!appOpened) window.open(webUrl, '_blank');
  }, waitMs);
}

/** 네이버 지도 앱/웹으로 경로 연결 (모바일 앱 스킴 + 웹 폴백) */
export function openNaverMapsRoute(stops: RouteStop[]): void {
  if (stops.length === 0) return;
  const dest = stops[stops.length - 1];
  const waypoints = stops.slice(1, -1);
  const webUrl = buildNaverWebRouteUrl(stops);
  const isAndroid = /Android/i.test(navigator.userAgent);
  const isIOS = /iPhone|iPad/i.test(navigator.userAgent);

  let routeParams = `dlat=${dest.lat}&dlng=${dest.lng}&dname=${enc(dest.name)}`;
  waypoints.slice(0, 5).forEach((stop, i) => {
    routeParams += `&v${i + 1}lat=${stop.lat}&v${i + 1}lng=${stop.lng}&v${i + 1}name=${enc(stop.name)}`;
  });
  routeParams += `&${NMAP_APPNAME}`;

  if (isAndroid) {
    window.location.href = `intent://route/car?${routeParams}#Intent;scheme=nmap;package=com.nhn.android.nmap;S.browser_fallback_url=${enc(webUrl)};end`;
  } else if (isIOS) {
    openSchemeWithWebFallback(`nmap://route/car?${routeParams}`, webUrl);
  } else {
    window.open(webUrl, '_blank');
  }
}

/** 단일 매장 네이버 지도 열기 */
export function openNaverMapApp(lat: number, lng: number, name: string): void {
  const isMobile = /Android|iPhone|iPad/i.test(navigator.userAgent);
  const webUrl = `https://map.naver.com/p/search/${enc(name)}`;
  if (isMobile) {
    openSchemeWithWebFallback(
      `nmap://place?lat=${lat}&lng=${lng}&name=${enc(name)}&${NMAP_APPNAME}`,
      webUrl,
      1500,
    );
  } else {
    window.open(webUrl, '_blank');
  }
}
