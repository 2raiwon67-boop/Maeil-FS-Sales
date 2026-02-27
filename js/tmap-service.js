/**
 * tmap-service.js — T-map 연동 모듈
 *
 * 플랫폼별 분기:
 *   모바일 → T-map 앱 딥링크 (단일 / 다중 경유지)
 *   PC     → 네이버 지도 웹 (기존 동작 유지)
 *
 * 지도 폴리라인:
 *   T-map Route API → OSRM 폴백 → 직선 폴백
 */

const TMAP_APP_KEY = '9ztvkAM1Od9lQJUfZlxOn23DvL1BrHxGaK4Q49VL';

/* ── 유틸 ── */
function isMobile() {
    return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function _isAndroid() { return /Android/i.test(navigator.userAgent); }

/* ──────────────────────────────────────────────────────
   단일 목적지 길찾기
   - PC    : 네이버 지도 웹 새 탭
   - 모바일 : T-map 앱 딥링크 (미설치 시 스토어 이동)
   ────────────────────────────────────────────────────── */
function openPlatformMap(lat, lng, name, naverUrl) {
    if (!isMobile()) {
        window.open(naverUrl, '_blank');
        return;
    }
    openTmapSingle(lat, lng, name);
}

function openTmapSingle(lat, lng, name) {
    const enc     = encodeURIComponent;
    const params  = `goalname=${enc(name)}&goalx=${lng}&goaly=${lat}`;
    const store   = _isAndroid()
        ? 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'
        : 'https://apps.apple.com/kr/app/tmap/id431589174';

    if (_isAndroid()) {
        window.location.href =
            `intent://route?${params}#Intent;scheme=tmap;package=com.skt.tmap.ku;S.browser_fallback_url=${enc(store)};end`;
    } else {
        const t = Date.now();
        window.location.href = `tmap://route?${params}`;
        setTimeout(() => {
            if (Date.now() - t < 2500) window.open(store, '_blank');
        }, 2000);
    }
}

/* ──────────────────────────────────────────────────────
   다중 경유지 루트 (루트 최적화 패널 → 앱 열기)
   - PC    : 네이버 지도 앱 (기존 openNaverMapsRoute 호출)
   - 모바일 : T-map 다중 경유지 딥링크 (경유지 최대 3개)
   ────────────────────────────────────────────────────── */
function openPlatformMultiRoute(stops) {
    if (!isMobile()) {
        if (typeof openNaverMapsRoute === 'function') openNaverMapsRoute();
        return;
    }
    if (!stops || stops.length === 0) return;
    openTmapMulti(stops);
}

function openTmapMulti(stops) {
    const enc  = encodeURIComponent;
    const dest = stops[stops.length - 1];
    const vias = stops.slice(0, -1).slice(0, 3); // T-map 경유지 최대 3개

    let params = `goalname=${enc(dest.name)}&goalx=${dest.lng}&goaly=${dest.lat}`;
    vias.forEach((s, i) => {
        params += `&via${i + 1}name=${enc(s.name)}&via${i + 1}x=${s.lng}&via${i + 1}y=${s.lat}`;
    });

    const store = _isAndroid()
        ? 'https://play.google.com/store/apps/details?id=com.skt.tmap.ku'
        : 'https://apps.apple.com/kr/app/tmap/id431589174';

    if (_isAndroid()) {
        window.location.href =
            `intent://route?${params}#Intent;scheme=tmap;package=com.skt.tmap.ku;S.browser_fallback_url=${enc(store)};end`;
    } else {
        const t = Date.now();
        window.location.href = `tmap://route?${params}`;
        setTimeout(() => {
            if (Date.now() - t < 2500) window.open(store, '_blank');
        }, 2000);
    }
}

/* ──────────────────────────────────────────────────────
   T-map Route API — 지도 폴리라인 좌표 조회
   allWaypoints : [{lat, lng}, ...]  출발지 포함 전체
   반환          : [{lat, lng}, ...] or null (실패 시)
   ────────────────────────────────────────────────────── */
async function fetchTmapRoutePolyline(allWaypoints) {
    if (!allWaypoints || allWaypoints.length < 2) return null;

    const start = allWaypoints[0];
    const end   = allWaypoints[allWaypoints.length - 1];
    const vias  = allWaypoints.slice(1, -1);

    const body = new URLSearchParams({
        startX:       start.lng.toString(),
        startY:       start.lat.toString(),
        endX:         end.lng.toString(),
        endY:         end.lat.toString(),
        reqCoordType: 'WGS84GEO',
        resCoordType: 'WGS84GEO',
        searchOption: '0',   // 최적 경로
    });

    if (vias.length > 0) {
        // passList 형식: "lng_lat_lng_lat" (경유지 좌표를 _ 로 이어 붙임)
        body.set('passList', vias.map(p => `${p.lng}_${p.lat}`).join('_'));
    }

    const res = await fetch(
        `https://apis.openapi.sk.com/tmap/routes?version=1&appKey=${TMAP_APP_KEY}`,
        {
            method:  'POST',
            headers: {
                'appKey':       TMAP_APP_KEY,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept':       'application/json',
            },
            body: body.toString(),
        }
    );

    if (!res.ok) throw new Error(`T-map Route API 오류: ${res.status}`);

    const data = await res.json();
    if (!data.features) return null;

    // GeoJSON features → LineString 좌표 추출
    const coords = [];
    data.features.forEach(f => {
        if (f.geometry?.type === 'LineString') {
            f.geometry.coordinates.forEach(([lng, lat]) => coords.push({ lat, lng }));
        }
    });

    return coords.length > 0 ? coords : null;
}

/* ── 페이지 로드 후 루트 패널 버튼 텍스트/스타일 플랫폼 분기 ── */
document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('routeNavBtn');
    if (!btn) return;
    if (isMobile()) {
        btn.textContent = '🚗 T-map으로 이동';
        btn.classList.remove('route-btn-naver');
        btn.classList.add('route-btn-tmap');
    } else {
        btn.textContent = '📱 네이버 지도 앱으로 열기';
    }
});
