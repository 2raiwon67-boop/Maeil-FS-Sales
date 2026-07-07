/**
 * sw.js — FS MISO (Next.js) Service Worker
 * - 정적 자산(/_next/static, 아이콘, 폰트): 캐시 우선 (해시 파일이라 안전)
 * - 페이지 네비게이션: 네트워크 우선 (Supabase 인증/SSR 항상 최신, 오프라인 시 캐시 폴백)
 * - 외부 도메인(Naver/OSRM/Supabase) 및 비-GET: 서비스워커 개입 없음
 */
// v2: v1이 네비게이션 응답을 상태코드 무관하게 캐시하던 버그로 stale 404/리다이렉트가
// 물릴 수 있었음. 버전 상향으로 활성화 시 옛 캐시를 강제 폐기해 클라이언트를 복구시킨다.
const CACHE = 'fs-miso-next-v2';
const STATIC_CACHE = 'fs-miso-static-v2';

const PRECACHE = [
  '/icons/favicon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) =>
      Promise.allSettled(PRECACHE.map((url) => cache.add(url).catch(() => {}))),
    ),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE && k !== STATIC_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/icons/') ||
    /\.(?:css|js|png|jpg|jpeg|svg|webp|gif|ico|woff2?)$/.test(url.pathname)
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 외부 도메인(네이버 지도, OSRM, Supabase 등)은 개입하지 않음
  if (url.origin !== self.location.origin) return;

  // 정적 자산: 캐시 우선
  if (isStaticAsset(url)) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res && res.status === 200) {
              const clone = res.clone();
              caches.open(STATIC_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          }),
      ),
    );
    return;
  }

  // 페이지 네비게이션: 네트워크 우선, 실패 시 캐시 폴백
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          // 정상(200)·비리다이렉트 응답만 캐시. 307(로그인 리다이렉트)/404 등은 캐시 금지
          // — 예전엔 무조건 캐시해 오프라인 폴백이 stale 404/로그인화면을 물던 버그가 있었음.
          if (res.ok && !res.redirected) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(request, clone));
          }
          return res;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match('/'))),
    );
    return;
  }
  // 그 외(GET API 등)는 기본 동작
});
