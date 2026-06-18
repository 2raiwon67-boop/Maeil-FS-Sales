// Naver Maps SDK 로더 + 지오코딩 헬퍼
// 원본 index.html은 oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=uipaxmujrl&submodules=geocoder 사용.
// ncpKeyId는 도메인 화이트리스트 클라이언트 키(시크릿 아님). 운영 도메인 추가 필요.

const NCP_KEY_ID = process.env.NEXT_PUBLIC_NAVER_MAP_KEY_ID || 'uipaxmujrl';
const SDK_URL = `https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${NCP_KEY_ID}&submodules=geocoder`;

let loadPromise: Promise<void> | null = null;

// Naver 인증 실패 콜백 (도메인 화이트리스트 미등록 등). Naver SDK가 전역 함수를 호출함.
let authFailed = false;
const authFailureListeners = new Set<() => void>();

export function onNaverAuthFailure(cb: () => void): () => void {
  authFailureListeners.add(cb);
  if (authFailed) cb();
  return () => authFailureListeners.delete(cb);
}

function registerAuthFailureGlobal() {
  if (typeof window === 'undefined') return;
  (window as unknown as { navermap_authFailure?: () => void }).navermap_authFailure = () => {
    authFailed = true;
    authFailureListeners.forEach((cb) => cb());
  };
}

/** Naver Maps SDK를 1회만 로드 (중복 호출 안전) */
export function loadNaverMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  registerAuthFailureGlobal();
  if (window.naver?.maps?.Service) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src^="https://oapi.map.naver.com"]`);
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Naver Maps SDK 로드 실패')));
      if (window.naver?.maps) resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Naver Maps SDK 로드 실패'));
    document.head.appendChild(script);
  });
  return loadPromise;
}

/** 주소 → 좌표 (Naver geocoder). 실패 시 null. localStorage 캐시. */
export function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  return new Promise((resolve) => {
    const naver = window.naver;
    if (!naver?.maps?.Service || !address) {
      resolve(null);
      return;
    }
    naver.maps.Service.geocode({ query: address }, (status: string, response: NaverGeocodeResponse) => {
      if (status !== naver.maps.Service.Status.OK) {
        resolve(null);
        return;
      }
      try {
        const result = response.v2.addresses[0];
        resolve({ lat: parseFloat(result.y), lng: parseFloat(result.x) });
      } catch {
        resolve(null);
      }
    });
  });
}

/** 캐시 적용 지오코딩 (localStorage, 키 prefix maeil_geo_) */
export async function cachedGeocode(address: string): Promise<{ lat: number; lng: number } | null> {
  if (!address) return null;
  const key = `maeil_geo_${address}`;
  try {
    const cached = localStorage.getItem(key);
    if (cached) return JSON.parse(cached);
  } catch {
    /* ignore */
  }
  const coords = await geocodeAddress(address);
  if (coords) {
    try {
      localStorage.setItem(key, JSON.stringify(coords));
    } catch {
      /* quota exceeded — ignore */
    }
  }
  return coords;
}

// ── 최소 타입 선언 (naver.maps 전역) ──────────────────────────────
interface NaverGeocodeResponse {
  v2: { addresses: Array<{ x: string; y: string }> };
}

declare global {
  interface Window {
    naver: typeof naver;
  }
  // eslint-disable-next-line @typescript-eslint/no-namespace
  const naver: NaverNamespace;
}

// 느슨한 타입 — 포팅 단계에서 점진적으로 구체화
export interface NaverNamespace {
  maps: {
    Map: new (el: HTMLElement | string, opts?: Record<string, unknown>) => NaverMap;
    LatLng: new (lat: number, lng: number) => NaverLatLng;
    LatLngBounds: new () => NaverLatLngBounds;
    Point: new (x: number, y: number) => unknown;
    Marker: new (opts: Record<string, unknown>) => NaverMarker;
    InfoWindow: new (opts: Record<string, unknown>) => NaverInfoWindow;
    Polyline: new (opts: Record<string, unknown>) => NaverPolyline;
    Event: {
      addListener: (target: unknown, event: string, handler: (e: NaverPointerEvent) => void) => unknown;
      removeListener: (listener: unknown) => void;
    };
    Service: {
      geocode: (opts: { query: string }, cb: (status: string, res: NaverGeocodeResponse) => void) => void;
      Status: { OK: string };
    };
    Position: Record<string, unknown>;
  };
}

export interface NaverLatLng {
  lat: () => number;
  lng: () => number;
}
export interface NaverLatLngBounds {
  extend: (latlng: NaverLatLng) => void;
}
export interface NaverPointerEvent {
  coord: NaverLatLng;
}
export interface NaverMap {
  setCenter: (latlng: NaverLatLng) => void;
  setZoom: (zoom: number) => void;
  panTo: (latlng: NaverLatLng) => void;
  fitBounds: (bounds: NaverLatLngBounds) => void;
  getCenter: () => NaverLatLng;
}
export interface NaverMarker {
  setMap: (map: NaverMap | null) => void;
  setIcon: (icon: unknown) => void;
  getIcon: () => unknown;
  getPosition: () => NaverLatLng;
  setPosition: (latlng: NaverLatLng) => void;
  // 포팅용 커스텀 메타 (원본 marker._item 등)
  _id?: string;
  _item?: unknown;
  _origIconObj?: unknown;
  _status?: string;
  _rank?: string;
  _region?: string;
  _manager?: string;
  _milk?: string;
  _origIcon?: unknown;
  _dealStatus?: string;
  _address?: string;
  _managerName?: string;
  _name?: string;
  _lat?: number;
  _lng?: number;
}
export interface NaverInfoWindow {
  open: (map: NaverMap, marker: NaverMarker) => void;
  close: () => void;
  setContent: (content: string) => void;
}
export interface NaverPolyline {
  setMap: (map: NaverMap | null) => void;
}
