/**
 * sw.js — FS MISO Service Worker
 * 정적 파일(CSS, JS) 캐시로 초기 로딩 속도 개선
 */

const CACHE_NAME = 'fs-miso-v8';

// 캐시할 정적 리소스
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/manifest.json',
    '/favicon.png',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    '/sw.js',
    '/gemini-chatbot.js',
    '/방문일지.html',
    '/report.html',
    '/proposal.html',
    '/upload.html',
    '/js/tmap-service.js'
];

// ── 설치: 정적 파일 캐시 ──
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            // 개별 실패를 허용 (외부 CDN 등 실패해도 설치 계속)
            return Promise.allSettled(
                STATIC_ASSETS.map(url => cache.add(url).catch(() => { }))
            );
        })
    );
    self.skipWaiting();
});

// ── 활성화: 구버전 캐시 정리 ──
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(
                keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
            )
        )
    );
    self.clients.claim();
});

// ── Fetch: 캐시 우선 전략 (정적 파일) / 네트워크 우선 전략 (API) ──
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Google Sheets, Naver Maps, OSRM 등 외부 API는 항상 네트워크
    const isExternalAPI = url.hostname !== self.location.hostname;
    if (isExternalAPI || event.request.method !== 'GET') {
        return; // 기본 fetch 동작 (서비스워커 개입 없음)
    }

    // 내부 정적 파일: 캐시 우선, 없으면 네트워크
    event.respondWith(
        caches.match(event.request).then((cached) => {
            if (cached) return cached;
            return fetch(event.request).then((response) => {
                if (!response || response.status !== 200) return response;
                const cloned = response.clone();
                caches.open(CACHE_NAME).then(c => c.put(event.request, cloned));
                return response;
            });
        })
    );
});
