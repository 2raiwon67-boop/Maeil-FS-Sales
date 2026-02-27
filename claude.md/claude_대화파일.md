# Claude 대화 요약 — 경기북부 FS 인허가 대시보드

> 기간: 2026년 2월 27일
> 모델: Claude Sonnet 4.6
> 저장소: https://github.com/2raiwon67-boop/Maeil-FS-Sales

---

## 1. 마커 재사용 구현 완료

### 배경
AI 할당량 소진으로 작업이 중단된 상태에서 이어받아 완료.

### 변경 내용
| 항목 | 내용 |
|------|------|
| 기존 방식 | 필터 클릭마다 마커 전체 삭제 → 재생성 |
| 개선 방식 | 최초 1회 생성 후 `setMap(null)` / `setMap(naverMap)` 으로 ON/OFF |

### 주요 함수
- `initAllMarkers()` — `allData` 기반 마커 최초 생성, 메타데이터 캐싱
- `filterMarkers()` — 현재 필터 조건으로 마커 표시/숨김 전환
- `updateMap()` — 진입점: `allMarkers` 없으면 `initAllMarkers()`, 있으면 `filterMarkers()`
- `updateMapByStatus()` — `updateMap()` 래퍼

### 수정된 호출 지점
- Google Sheets 로드 완료 시: `updateMap()` → `initAllMarkers()`
- 거래여부 인플레이스 변경 후: `updateMap()` → `initAllMarkers()` (stale 클로저 방지)
- 구버전 `updateMapByStatus()` 중복 정의 제거

### 커밋
- `bbea118` — 마커 재사용 구현 및 필터 구조 중앙집중화

---

## 2. 모바일 레이어 드롭다운 PC 숨김 처리

### 문제
`.layer-filter-btn`, `.layer-dropdown` 요소에 `display: none` 기본값 없이 `@media (max-width: 768px)` 블록에만 스타일 정의 → PC에서도 표시됨

### 수정
```css
/* 모바일 전용 요소 — PC에서 숨김 */
.layer-filter-btn,
.layer-dropdown {
    display: none;
}
```

### 커밋
- `92262ea` — 레이어 드롭다운 버튼 PC에서 숨김 처리

---

## 3. 파일 구조 정리

### 변경 전 (루트에 혼재)
```
/ (루트)
├── test-admin-update.js
├── test-api.js
├── apps_script_dynamic.txt
├── Apps_Script_AI_Tag_Snippet.javascript
├── supabase_setup.sql
├── start_server.bat
└── MASSI/
    └── gemini-chatbot.js  ← API 키 하드코딩된 구버전
```

### 변경 후
```
/
├── dev/  ← .gitignore 처리 (로컬 전용)
│   ├── test-admin-update.js
│   ├── test-api.js
│   ├── apps_script_dynamic.txt
│   ├── Apps_Script_AI_Tag_Snippet.javascript
│   ├── supabase_setup.sql
│   └── start_server.bat
└── (MASSI/ 삭제)
```

### 참고
MASSI/gemini-chatbot.js 는 API 키(`AIzaSy...`)가 프론트엔드에 하드코딩된 구버전. 해당 키는 Google Cloud Console에서 폐기 권장.

### 커밋
- `d272298` — 파일 구조 정리

---

## 4. 디자인 시스템 구축 (common.css / nav-component.js)

### 추가된 CSS 변수 (디자인 토큰)
```css
:root {
    --color-primary:        #0071e3;
    --color-success:        #34c759;
    --color-danger:         #ff3b30;
    --color-warning:        #ff9500;
    --color-text:           #1d1d1f;
    --color-bg:             #f5f5f7;
    --color-surface:        #ffffff;
    --color-border:         #e0e0e5;
    --radius-sm:  8px;
    --radius-md:  12px;
    --radius-lg:  16px;
    --space-xs:   4px;
    --space-sm:   8px;
    --space-md:   16px;
    --space-lg:   24px;
    --shadow-sm:  0 1px 4px rgba(0,0,0,0.08);
    --shadow-md:  0 4px 16px rgba(0,0,0,0.12);
    --shadow-lg:  0 8px 32px rgba(0,0,0,0.18);
}
```

### 추가된 공통 컴포넌트

**스피너**
```html
<div class="miso-spinner"></div>
<div class="miso-spinner white lg"></div>
```

**스켈레톤 로더**
```html
<div class="skeleton" style="height:20px; width:60%;"></div>
```

**Toast 알림** (모든 페이지에서 사용 가능)
```js
showToast('저장되었습니다', 'success');
showToast('오류가 발생했습니다', 'error', 5000);
showToast('확인이 필요합니다', 'warning');
showToast('완료');  // default
```

**모바일 탭 피드백**
```css
/* -webkit-tap-highlight-color 제거 (모바일 파란 하이라이트 없앰) */
```

### 커밋
- `13dc23c` — 디자인 토큰 + 공통 컴포넌트 추가

---

## 5. 코드 품질 개선

### 5-1. console.log 55개 제거

| 파일 | 제거 수 |
|------|---------|
| index.html | 29개 |
| 방문일지.html | 12개 |
| auth.js | 2개 |
| gemini-chatbot.js | 4개 |
| proposal.html | 3개 |
| sw.js | 1개 |
| server.js | 4개 |

`console.error` / `console.warn` 28개는 오류 추적 목적으로 **유지**.

### 커밋
- `902fca8` — console.log 전체 제거

---

### 5-2. Chart.js 렌더링 최적화

**문제:** 필터 클릭마다 차트 4개 전체 `destroy()` → `new Chart()` 반복

**수정:** `chart.update()` 로 데이터만 교체

| 차트 | 타입 |
|------|------|
| 월별 추이 | Line |
| 지역별 분포 | Bar |
| 거래상태 | Bar |
| 사용우유 | Doughnut |

**추가 수정:** `onClick` 핸들러의 `labels` 클로저 참조 →
`dashRegionChartInstance.data.labels[idx]` 인스턴스 직접 참조로 변경 (stale 클로저 방지)

### 커밋
- `c0a87af` — chart.update() 교체로 렌더링 최적화

---

## 6. 코드 점검 결과 (전체)

### 보류된 항목 (의도적)
| 항목 | 이유 |
|------|------|
| `setInterval` 타임아웃 없음 | 실제 위험도 낮음, 기능 변경 리스크 있음 |
| Google Sheets 중복 fetch | 별도 캐시 레이어 필요, 미결 |
| `innerHTML` XSS | 내부 도구 + 외부 입력 없음, 의도적 HTML 포함 구조 |

### 파일 크기 현황
```
index.html      ~205KB  (5,000줄)
proposal.html    ~77KB
방문일지.html    ~72KB
gemini-chatbot   ~42KB
report.html      ~38KB
auth.js          ~11KB
common.css       ~8KB (확장됨)
nav-component.js ~4KB (확장됨)
```

---

## 7. 기능 제안 (미구현)

영업 현장 맥락 기반 우선순위:

### 1순위 — 즉시 체감 가능
1. **인허가 만료 임박 업체 강조** — 만료 D-90일 업체 마커 색상 변경 (갱신 타이밍 = 제안 타이밍)
2. **거절 사유 기록 + 재접근 트리거** — 방문일지에 거절 카테고리 추가, 재접근 스케줄 설정
3. **배치 방문 스케줄러** — 선택 업체들을 하루 동선 기준 자동 정렬

### 2순위 — 설득력 강화
4. **업체별 설득 포인트 공유** — 팀 성공 케이스 공유
5. **경쟁 현황 태깅** — 타사 대리점 기록, 집중 공략 루트 설계

### 3순위 — 데이터 기반
6. **영업사원별 KPI 대시보드** — 방문/전환 추이, 패턴 분석

---

---

## 7-2. 버그 수정 (코드 점검 후)

### gemini-chatbot.js:136 — 한국어 조사 정규식 오타
```js
// 수정 전 (오타)
w.replace(/[은는이갸을를에에서에게뿐만도]+$/g, '')
//              ↑ '갸' (잘못된 글자), '에' 중복

// 수정 후
w.replace(/[은는이가을를에서에게뿐만도]+$/g, '')
```
→ 커밋 `7413c74`

---

### 방문일지.html — fetch response.ok 누락
`loadVisitLogs()`, `loadAccounts()` 함수에서 HTTP 오류 시 에러 HTML을 CSV로 파싱 시도하는 무음 실패 버그.

```js
// 수정 전
const response = await fetch(url);
const csv = await response.text(); // HTTP 오류여도 진행

// 수정 후
const response = await fetch(url);
if (!response.ok) throw new Error(`로드 실패 (HTTP ${response.status})`);
const csv = await response.text();
```
→ 커밋 `2dcfac5`

---

## 8. T-map 연동 (js/tmap-service.js 모듈화)

### 배경
- 네이버 지도 앱 연동이 현장에서 잘 안 쓰임
- T-map이 실질적인 국내 내비 표준
- index.html 5,000줄 과부하 우려 → 분리 필요

### 플랫폼 분기 전략

| 위치 | PC | 모바일 |
|------|----|----|
| 마커 인포윈도우 | 네이버 지도 (유지) | 🚗 T-map 길찾기 |
| 모바일 바텀시트 | 네이버 지도 (유지) | 🚗 T-map 길찾기 |
| 루트 패널 버튼 | 네이버 지도 앱 (유지) | T-map 다중 경유지 |

### 경로 폴리라인 (PC/모바일 공통)
```
T-map Route API (한국 도로 정확도 높음, 빨간선)
    ↓ 실패 (할당량 초과 등)
OSRM (기존 외국 서버, 파란선)
    ↓ 실패
직선 연결 (점선)
```

### T-map API 요금
- 딥링크: 완전 무료 (API 호출 없음)
- Route API: 무료 1,000건/일 → 내부 팀 규모에서 초과 불가

### 신규 파일: js/tmap-service.js
```
isMobile()                  — 모바일 감지
openPlatformMap()           — 인포윈도우용 (PC/모바일 분기)
openTmapSingle()            — T-map 단일 목적지 딥링크
openPlatformMultiRoute()    — 루트 패널용 (PC/모바일 분기)
openTmapMulti()             — T-map 다중 경유지 딥링크
fetchTmapRoutePolyline()    — Route API 폴리라인 좌표 조회
```

### T-map 앱 미설치 폴백
- Android: Play Store 이동
- iOS: App Store 이동

### 커밋
- `7413c74` — 조사 정규식 오타 수정 + 대화파일 추가
- `2dcfac5` — 방문일지 fetch 오류 수정
- `fb42055` — T-map 연동 모듈화

---

## 9. 커밋 히스토리 요약

| 커밋 | 내용 |
|------|------|
| `bbea118` | 마커 재사용 구현 |
| `92262ea` | 모바일 드롭다운 PC 숨김 |
| `d272298` | 파일 구조 정리 |
| `13dc23c` | 디자인 토큰 + 공통 컴포넌트 |
| `902fca8` | console.log 제거 |
| `c0a87af` | Chart.js 렌더링 최적화 |
| `7413c74` | 조사 정규식 오타 수정 |
| `2dcfac5` | 방문일지 fetch 오류 수정 |
| `fb42055` | T-map 연동 (js/tmap-service.js) |
