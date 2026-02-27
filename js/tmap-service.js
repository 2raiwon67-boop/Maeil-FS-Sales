// ==========================================
// TMAP API 연동 서비스 모듈 (js/tmap-service.js)
// ==========================================
// 기존 index.html과 의존성을 분리하여 안전하게 TMAP 기능을 주입합니다.

const TMAP_APP_KEY = 'NRHJd5KVSc923Io4XHpGK8x7s0WKXOZ74BuhTOPv';

/**
 * 1. TMAP 다중 경유지 최적화 API (RouteOptimization30)
 * 주어진 출발, 경유, 도착지 목록의 순서를 가장 효율적인 방문 순서로 재정렬하고 예상시간/거리를 반환합니다.
 * @param {Array} originalStops - {lat, lng, name, address, ...} 객체 배열
 * @returns {Promise<Object>} { optimizedStops, summary: { distance, time, fare } }
 */
async function getOptimizedRouteFromTmap(originalStops) {
    if (!originalStops || originalStops.length < 2) {
        throw new Error("경유지가 2개 이상 필요합니다.");
    }

    // TMAP API 명세에 맞게 경유지가 2개(출/도착)면 자동차 경로안내 API, 그 이상이면 경유지최적화 API 분기
    if (originalStops.length === 2) {
        return await fetchSimpleRoute(originalStops[0], originalStops[1]);
    } else {
        return await fetchOptimizedRoute(originalStops);
    }
}

// (내부) 단일 출발/도착 경로 탐색
async function fetchSimpleRoute(start, end) {
    const url = 'https://apis.openapi.sk.com/tmap/routes?version=1&format=json';
    const payload = {
        startX: start.lng.toString(),
        startY: start.lat.toString(),
        endX: end.lng.toString(),
        endY: end.lat.toString(),
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO", // 항상 WGS84 위경도로 받기
        searchOption: "0", // 교통최적+추천
        trafficInfo: "N"
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'appKey': TMAP_APP_KEY
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`TMAP API Error: ${response.status}`);
    }

    const data = await response.json();
    const props = data.features[0].properties;

    // 선을 긋기 위한 Polyline 파리싱
    const polylineCoords = extractPolylineFromTmapData(data.features);

    return {
        optimizedStops: [start, end], // 순서 변경 없음
        summary: {
            distance: props.totalDistance, // 미터
            time: props.totalTime,         // 초
            fare: props.totalFare || 0
        },
        polyline: polylineCoords
    };
}

// (내부) 다중 경유지 최적화 (3개 이상)
async function fetchOptimizedRoute(stops) {
    const url = 'https://apis.openapi.sk.com/tmap/routes/routeOptimization30?version=1&format=json';

    const start = stops[0];
    const end = stops[stops.length - 1];

    // 중간 경유지 추출 및 TMAP 형식 변환 (최대 30개까지 가능하지만, 현재 앱 구조상 3~4개 선)
    const viaPoints = stops.slice(1, stops.length - 1).map((stop, index) => ({
        viaPointId: `via_${index}`,
        viaPointName: stop.name || `경유지 ${index + 1}`,
        viaX: stop.lng.toString(),
        viaY: stop.lat.toString()
    }));

    const payload = {
        reqCoordType: "WGS84GEO",
        resCoordType: "WGS84GEO",
        startName: start.name || "출발지",
        startX: start.lng.toString(),
        startY: start.lat.toString(),
        endName: end.name || "도착지",
        endX: end.lng.toString(),
        endY: end.lat.toString(),
        searchOption: "0",
        viaPoints: viaPoints
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'appKey': TMAP_APP_KEY
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        throw new Error(`TMAP API Error: ${response.status}`);
    }

    const data = await response.json();
    const props = data.properties;

    // TMAP이 정해준 순서 파싱
    const optimizedStops = [];
    optimizedStops.push(start); // 출발지는 고정

    // features를 순회하며 순서 알아내기
    const pointFeatures = data.features.filter(f => f.geometry.type === "Point");
    // 포인트 타입 중 S(출발), E(도착) 제외한 경유지(viaPointId를 가짐)
    const viaFeatures = pointFeatures.filter(f => f.properties.viaPointId);

    // TMAP 응답의 viaFeatures 순서대로 원본 stops의 객체를 찾아서 삽입
    viaFeatures.forEach(vf => {
        const matched = stops.find(s =>
            // 허용 오차 내에서 좌표 매칭
            Math.abs(s.lat - vf.geometry.coordinates[1]) < 0.0001 &&
            Math.abs(s.lng - vf.geometry.coordinates[0]) < 0.0001
        );
        if (matched && !optimizedStops.includes(matched)) {
            optimizedStops.push(matched);
        }
    });

    // 만약 좌표 미세오차로 매칭 안된 게 있다면 남은 것들을 뒤에 끼워넣기 (안전망)
    stops.forEach(s => {
        if (!optimizedStops.includes(s) && s !== end) optimizedStops.push(s);
    });

    optimizedStops.push(end); // 도착지는 고정

    const polylineCoords = extractPolylineFromTmapData(data.features);

    return {
        optimizedStops: optimizedStops,
        summary: {
            distance: props.totalDistance,
            time: props.totalTime,
            fare: props.totalFare || 0
        },
        polyline: polylineCoords
    };
}

/**
 * 2. TMAP 응답(features)에서 Polyline 좌표 배열만 예쁘게 뽑아내는 함수
 */
function extractPolylineFromTmapData(features) {
    const coords = [];
    features.forEach(f => {
        if (f.geometry.type === "LineString") {
            f.geometry.coordinates.forEach(point => {
                // TMAP은 [경도(X), 위도(Y)] 로 넘겨주므로, Naver Map용 {lat, lng} 로 변환
                coords.push(new naver.maps.LatLng(point[1], point[0]));
            });
        }
    });
    return coords;
}

// index.html에서 접근할 수 있도록 전역에 노출
window.TmapService = {
    getOptimizedRouteFromTmap
};
