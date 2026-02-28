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

---

## 10. 통합 필터 패널 구현 (2026-02-28)

### 배경
기존 담당자/지역 드롭다운 카드(토글 방식) 2개 → 항상 펼쳐진 2컬럼 통합 패널로 교체
- 접힌 상태에서 적용 중인 필터 파악 어려움
- 사이드바 공간 효율 개선

### 변경 내용

**HTML** (`index.html` lines 1796–1816)
- `#managerDropdown` + `#regionDropdown` 드롭다운 카드 제거
- `.filter-panel` 2컬럼 레이아웃으로 교체
- `id="managerList"` / `id="regionList"` 유지 → JS 변경 최소화

**CSS**
- `.filter-panel`, `.filter-panel-header`, `.filter-panel-body` 추가
- `.filter-col`, `.filter-col-header`, `.filter-col-list` 추가
- `.filter-item`, `.filter-item.active`, `.filter-item-name`, `.filter-item-count` 추가

**JS**
- 렌더링 시 `.dropdown-item` → `.filter-item` 클래스로 교체
- active 판정: inline style 제거 → `class="filter-item active"` 방식으로 변경
- `clearAllFilters()` 함수 추가 (담당자·지역 동시 초기화)

### 커밋
- `f6aa48e` — 통합 필터 패널 구현 (2컬럼, 항상 펼침)

---

## 11. 성능 개선 아키텍처 검토 (2026-02-28)

### 현재 구조의 문제
```
사용자 → Vercel 프록시 → 공공데이터 API (최대 60번 순차 호출)
```
- 3개 업종 × 최대 20페이지 = 최대 60회 API 호출
- 체감 로딩 5~15초

### 목표 구조
```
사용자 → Supabase DB (1회 쿼리, ~50ms)
              ↑
GitHub Actions 또는 Vercel Cron (하루 1회 공공API 동기화 → DB 저장)
```

### 공공데이터 API 엔드포인트
```
일반음식점: https://apis.data.go.kr/1741000/general_restaurants/info
제과점영업: https://apis.data.go.kr/1741000/bakeries/info
휴게음식점: https://apis.data.go.kr/1741000/rest_cafes/info
```
- 파라미터: `serviceKey`, `pageNo`, `numOfRows`, `returnType`, `SALS_STTS_CD`, `LOTNO_ADDR`, `startDate`, `endDate`

### 데이터 규모 검토

| 범위 | 영업중 건수 | 용량 |
|---|---|---|
| 경기북부만 (11개 시군구) | ~41,000건 | ~40MB |
| 수도권 전체 (서울+경기+인천) | ~190,000건 | ~190MB |
| 전국 | ~700,000건+ | ~700MB |

### 플랜별 제약

**Vercel Hobby (현재)**
- 함수 최대 실행 시간: 60초
- Cron: 최대 2개
- 수도권 전체 데이터 로드 시 타임아웃 발생 (600페이지 ≒ 3~5분 필요)

**Supabase Free**
- DB 용량: 500MB
- 월 트래픽: 5GB
- 수도권 190MB → **Free 플랜 가능**

### 최종 권장 아키텍처

```
GitHub Actions (스케줄 워크플로우, 무료)
    ↓ 타임아웃 없음 (최대 6시간), 월 2,000분/무료
    ↓ 영업중 필터 + 시도별 병렬 처리
Supabase DB (Free, ~190MB)
    ↑
Vercel API 프록시 (DB 조회만, <50ms)
    ↑
브라우저 (로딩 500ms 이내)
```

**비용: $0** (현재와 동일)

### 증분 동기화 전략
- 1회: 전체 데이터 초기 적재 (GitHub Actions 수동 실행)
- 이후 매일 새벽 3시: 전날 변경분만 동기화 (startDate/endDate 활용)
- 하루 신규 건수: ~200~500건 → 실행 1~2분

### 참고: mapzine.vercel.app 추정 구조
- Next.js + React DOM 18.3.0 (webpack chunk 확인)
- API 엔드포인트: `?types=general_restaurants&regions=서울특별시&startDate=...`
- 자체 DB 직접 쿼리 방식으로 빠른 응답
- 유료 플랜 운영 (상용 서비스)
- 우리는 GitHub Actions + Supabase Free로 동일 UX 구현 가능

### 미구현 (추후 작업)
- `scripts/sync-licenses.js` 작성
- Supabase `license_cache` 테이블 생성
- `.github/workflows/sync-licenses.yml` 작성
- GitHub Secrets 등록 (PUBLIC_DATA_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_KEY)
- Vercel API를 DB 조회 방식으로 교체

---

## 15. 견적서 제품DB 개선 — 이미지/사용용도/신규 제품 (2026-02-28)

### D열 이미지 → 사용용도 전환
- Google Sheets 제품DB 시트 D열: `이미지` → `사용용도` 헤더 변경
- proposal.html: `image: r['이미지']` → `usage: r['사용용도']` 로 변경
- 이모지 폴백은 `'📦'` 하드코딩으로 유지
- `usage` 필드는 naver-reviews.js 프롬프트에 제품 용도 정보로 전달됨

### 신규 이미지 파일 등록 (총 25개 추가, 누적 69개)
추가된 주요 파일:
- 소프트믹스 전 라인 (M8/딸기/프레쉬/다크초콜릿/식물성/비건오트)
- 두유·오트류 (어메이징오트 바리스타, 아몬드브리즈 오리지널/언스위트, 매일 두유)
- 테너 소스류 (카라멜, 초콜렛), 고흥유자, 패션후르츠, 청포도
- 사워크림, 연유 대용량(5kg/20kg), 라크림 스프레이
- 상하목장 소프트믹스 OM3/OM10, 초콜릿믹스
- 소프트 아이스크림 기기, 매일바이오 무가당 플레인
- 매일 후레쉬 쉐프크림 1L (jpeg)

### PRODUCT_IMAGE_MANUAL_MAP 키 오류 수정
기존 manual map 키가 Google Sheets 품명과 대소문자 불일치로 실제 매칭 안 되던 항목 수정:
- `1.8KG` → `1.8kg`, `1KG` → `1kg`, `900ML` → `900ml` 등

### 신규 manual map 항목 추가
파일명이 품명으로 시작하지 않는 경우 수동 매핑:
- `매일 두유 99.9 950ml` → `매일두유 99.9 950mL.jpg`
- `상하목장 요거트 소프트믹스 OM3 1L` → `상하목장 요거트 소프트믹스 OM3.jpg`
- `상하목장 소프트믹스 OM10 1L` → `상하목장소프트믹스OM10 1L.jpg`
- `상하목장 초콜릿믹스 1L` → `상하목장 초콜릿 믹스 1L*10 .jpg`
- `테너 베이스 과육플러스 청포도 1kg` → `테너베이스 과육 플러스 청포도 1kg.jpg`

### 이미지 자동매칭 구조 메모
```js
findProductImage(품명):
  1. PRODUCT_IMAGE_MANUAL_MAP[품명] 정확히 일치 → 우선 반환
  2. PRODUCT_IMAGE_FILES 에서 filename.toLowerCase().startsWith(품명.toLowerCase()) → 자동매칭
  3. null 반환 → 'NO IMG' 표시
```
- 새 이미지 추가 시: PRODUCT_IMAGE_FILES에 파일명 추가 필수
- 파일명이 품명으로 시작하지 않으면 PRODUCT_IMAGE_MANUAL_MAP에도 추가

### 커밋
- `0ebb74d` — 신규 제품 이미지 등록 및 D열 사용용도 컬럼 전환
- `6bfd353` — 매일 후레쉬 쉐프크림 이미지 추가

---

## 16. 매장 맞춤 분석 AI 개선 — 음료 우선 추천 (2026-02-28)

### 현재 구조 확인 (api/naver-reviews.js)
```
1. 네이버 지역검색 + 블로그 리뷰 병렬 호출
2. Google Sheets 방문일지에서 해당 매장 기록 로드 (loadVisitLogsForStore)
3. Gemini 2.5 Flash에 전달:
   - 네이버 리뷰 요약
   - 방문일지 최근 5건 (있을 경우)
   - 제품DB 전체 목록 (품명 + 규격)
4. 응답: tags, description, recommendedIndices, signatureMenus
5. recommendedIndices → 실제 제품 객체로 매핑 → 추천 표시
```
→ 방문일지는 이미 반영되고 있었음 (기존 구현)

### 변경 내용 (cbbf865)

**① 제품 목록에 사용용도 추가**
```js
// 변경 전
`[${i}] ${p.name} / ${p.spec}`
// 변경 후
`[${i}] ${p.name} / ${p.spec}${p.usage ? ` / 용도: ${p.usage}` : ''}`
```

**② 음료 우선 추천 지침 추가 (프롬프트)**
```
- 일반 카페·음식점: 음료용 제품(우유·크림·베이스류) 최우선 추천
- 베이킹 원료(치즈·버터)는 베이커리·제과점 확인 시에만 포함
- 제품 목록의 '용도' 항목 반드시 참고
```

### 커밋
- `cbbf865` — 매장 분석 AI 개선 (사용용도 반영 + 음료 우선 추천)

---

## 12. RAG 시스템 설계 검토 (2026-02-28)

### 적용 대상 3가지
- **B. 방문일지**: 유사 성공/실패 사례 검색
- **견적서 메뉴추천 고도화**: 메뉴 → 레시피 → 자사제품 자동 추천 체인
- **C. AI 태그 고도화**: 팀 누적 데이터 기반 더 정확한 태깅

### 기술 스택 (추가 비용 없음)
- **임베딩**: Gemini `text-embedding-004` (무료 1,500건/일)
- **벡터 DB**: Supabase pgvector (Free 플랜 지원)
- **생성 모델**: Gemini (기존 사용 중)
- **총 추가 비용: $0**

### Supabase 테이블 구조
```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- 방문일지 임베딩
CREATE TABLE visit_embeddings (
    id BIGSERIAL PRIMARY KEY,
    visit_id TEXT,
    biz_name TEXT,
    content TEXT,
    embedding vector(768),
    outcome TEXT,  -- 'success' | 'fail' | 'pending'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 견적서 임베딩
CREATE TABLE quote_embeddings (
    id BIGSERIAL PRIMARY KEY,
    biz_type TEXT,
    biz_scale TEXT,
    recommended_menu JSONB,
    content TEXT,
    embedding vector(768),
    success BOOLEAN,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 레시피 임베딩 (PDF 기반)
CREATE TABLE recipe_embeddings (
    id BIGSERIAL PRIMARY KEY,
    name TEXT,
    ingredients JSONB,
    store_types TEXT[],
    our_products JSONB,   -- 자사제품 매핑
    content TEXT,
    embedding vector(768),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON visit_embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON quote_embeddings USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX ON recipe_embeddings USING ivfflat (embedding vector_cosine_ops);
```

### 견적서 RAG 체인 흐름
```
매장 검색 → 방문일지 + 네이버 리뷰
    → 메뉴 추천 (기존)
    → 레시피 RAG 검색 (메뉴 → 관련 레시피)
    → 자사제품 매핑 (레시피 재료 → 자사제품)
    → 견적서 추천 품목 자동 삽입
```

**핵심 장점**: 영업사원이 레시피를 몰라도 자사 제품을 자연스럽게 제안 가능

---

## 13. PDF 레시피 → RAG 파이프라인 (2026-02-28)

### 결론
**가능함.** PDF는 RAG의 가장 대표적인 활용 케이스.
Gemini Vision이 텍스트/이미지/복잡한 레이아웃 PDF 모두 처리 가능.

### PDF 유형별 처리
| PDF 유형 | 처리 방법 | 가능 여부 |
|---|---|---|
| 텍스트 기반 | pdf-parse 라이브러리 | ✅ 쉬움 |
| 이미지 스캔 | Gemini Vision | ✅ 가능 |
| 표/레이아웃 복잡 | Gemini Vision | ✅ 가능 |
| 손글씨 | Gemini Vision | ⚠️ 70~80% |

### 처리 파이프라인 코드 (Node.js)
```js
// 1. PDF → Gemini로 구조화 추출
async function extractRecipeFromPDF(pdfPath) {
    const base64 = fs.readFileSync(pdfPath).toString('base64');
    const result = await gemini.generateContent([
        { inlineData: { mimeType: 'application/pdf', data: base64 } },
        `레시피명, 재료 목록, 어울리는 매장 유형, 자사제품 대체 가능 재료를 JSON으로 추출`
    ]);
    return JSON.parse(result.response.text());
}

// 2. 추출된 데이터 → 임베딩 → Supabase 저장
async function processRecipePDF(file) {
    const recipe = await extractRecipeFromPDF(file);
    const embedding = await getEmbedding(
        `${recipe.name} ${recipe.ingredients.join(' ')} ${recipe.storeTypes.join(' ')}`
    );
    await supabase.from('recipe_embeddings').insert({
        name: recipe.name,
        ingredients: recipe.ingredients,
        store_types: recipe.storeTypes,
        our_products: recipe.ourProducts,
        content: JSON.stringify(recipe),
        embedding
    });
}

// 3. 견적서에서 메뉴 → 레시피 → 자사제품 쿼리
async function getProductRecommendations(menus) {
    const embedding = await getEmbedding(menus.join(' '));
    const { data: recipes } = await supabase.rpc('match_recipes', {
        query_embedding: embedding, match_count: 5
    });
    const products = [...new Set(recipes.flatMap(r => r.our_products))];
    return products;
}
```

### 처리 전략 (PDF 수량별)
| PDF 수량 | 전략 |
|---|---|
| ~50개 | 스크립트 1회 실행으로 일괄 처리 |
| 50~200개 | 관리자 업로드 UI |
| 200개 이상 | 배치 처리 파이프라인 |

### 미확인 사항 (다음 대화 시 확인 필요)
- 레시피 PDF 개수
- 자사 제품 카테고리/목록 형태
- PDF가 텍스트 기반인지 이미지 스캔인지

---

## 14. 방문일지 고도화 방향 (2026-02-28)

### 핵심 문제
> "가야 할 매장이 맞아야 하는데 매장마다 모수가 너무 많다"

방문일지가 현재 **기록 도구** → **방문 결정 도구**로 전환 필요

### 제안 기능

**① 매장 상태 분류 체계**
```
🔴 미접촉    — 신규 대상
🟡 접촉 중   — 방문했지만 거래 미성사
🟠 거절      — 거절 사유 기록됨
🟢 거래 중   — 활성 거래처
⚪ 보류      — 재접근 일정 있음
```

**② 방문 우선순위 스코어링**
```
업체별 점수 =
  인허가 만료 임박 (D-90 이내 +30점)
+ 마지막 방문 후 경과 (6개월 이상 +20점)
+ 거래 가능성 AI 예측 (업종/규모/리뷰 기반 +0~30점)
+ 경쟁 대리점 없음 (+20점)
- 최근 거절 이력 (-20점)
→ 오늘 방문할 매장 TOP N 자동 추천
```

**③ 거절 사유 구조화 + 재접근 알림**
- 사유 카테고리: [기존대리점관계] [가격] [필요없음] [타이밍] 기타
- 재접근 예정일 설정 → 자동 알림 + 우선순위 복귀

**④ 팀 인사이트 RAG**
- 방문 전: 비슷한 조건 업체에서 팀원이 성공한 설득 포인트 자동 표시
- 누적 데이터가 쌓일수록 정확도 향상

### 구현 우선순위
| 순서 | 기능 | 난이도 |
|---|---|---|
| 1 | 매장 상태 분류 체계 | 낮음 |
| 2 | 거절 사유 + 재접근 알림 | 낮음 |
| 3 | 자사제품 DB + 레시피 RAG (PDF) | 중간 |
| 4 | 방문 우선순위 스코어링 | 중간 |
| 5 | 팀 인사이트 RAG | 높음 |

---

## 15. 제품 DB 개선 및 이미지 등록 (2026-02-28)

### 신규 제품 이미지 추가 (assets/images/)
소프트믹스 전 라인, 두유/오트류, 테너 소스류, 연유 대용량, 후레쉬 쉐프크림 등 26개 이미지 추가

### PRODUCT_IMAGE_MANUAL_MAP 케이스 오류 수정
기존 키가 대문자(1.8KG, 900ML)였으나 Google Sheets 실제 값은 소문자(1.8kg, 900ml)
→ 케이스 일치 수정 + 5개 신규 매핑 추가

### D열 용도 변경 (이미지 → 사용용도)
```js
// 변경 전
image: r['이미지'] || '📦'

// 변경 후
usage: (r['사용용도'] || '').trim()
```
- 이미지열은 실제 이미지 URL로 사용되지 않았음 (emoji 폴백만)
- 사용용도 데이터를 Gemini 추천 프롬프트에 활용

### 커밋
- `6bfd353` — 후레쉬 쉐프크림 이미지 추가
- `0ebb74d` — 25개 이미지 추가 + 케이스 오류 수정 + D열 변경
- `76c3e22` — Rate limit 개선 + 신규 이미지 26개

---

## 16. naver-reviews.js AI 분석 개선 (2026-02-28)

### 변경 1 — 사용용도 필드 추가
```js
// 변경 전
`[${i}] ${p.name} / ${p.spec}`

// 변경 후
`[${i}] ${p.name} / ${p.spec}${p.usage ? ` / 용도: ${p.usage}` : ''}`
```

### 변경 2 — 음료 우선 추천 규칙 추가
```
- 일반 카페·음식점: 음료용 제품(우유·크림·베이스류) 최우선
- 베이킹 원료(치즈·버터): 베이커리·제과점 확인 시에만 포함
- 제품 목록의 '용도' 항목 반드시 참고
```

### 커밋
- `cbbf865` — usage 필드 + 음료 우선 추천 규칙

---

## 17. 레시피 PDF 파이프라인 구축 (2026-02-28)

### 배경
- 337개 레시피 PDF → `assets/recipe/` 업로드 (79MB, 깃에 미포함)
- Gemini Vision으로 구조화 데이터 추출 → Supabase pgvector 저장 → RAG 검색

### 파이프라인 3단계

**STEP 1 — PDF 추출 (scripts/process-recipes.js)**
- 각 PDF를 base64 인코딩 후 Gemini 2.0 Flash에 전송
- 추출 필드: name, nameEn, description, mainProducts, ingredients, steps, category, tags, isVegan
- 30초 간격 (2 RPM, 일일 할당량 절약), 429 에러 시 최대 3회 재시도
- 중단 후 재개 가능 (기존 recipe-data.json 확인 후 스킵)
- 예상 소요: 약 170분 (337개 × 30초)

**STEP 2 — Supabase 테이블 생성 (dev/supabase_setup.sql)**
- `recipes` 테이블 + pgvector(768차원) + ivfflat 인덱스
- `search_recipes()` 함수: 벡터 유사도 검색 + 카테고리 필터

**STEP 3 — Supabase 업로드 (scripts/upload-recipes.js)**
- Gemini text-embedding-004로 임베딩 생성
- Supabase REST API upsert (filename 기준 중복 방지)

### Rate Limit 이슈 및 해결
- 문제: Gemini 2.0 Flash PDF 멀티모달 요청이 첫 요청부터 429 발생
- 원인: 재시도 반복으로 일일 할당량(1,500 RPD) 소진
- 해결: 딜레이 4.2초→30초, 재시도 최대 3회 제한, **다음날 오후 4시 이후 재실행 예정**

### Gemini API 관련 정리
- API 키는 인증 토큰일 뿐, 요청 간 학습/기억 없음
- 각 요청에 데이터를 직접 프롬프트에 포함해야 컨텍스트 활용 가능
- 새 프로젝트 키는 초기 할당량 활성화 문제 있을 수 있음 → 기존 키 사용 권장

### 커밋
- `d7a7e1e` — process-recipes.js 생성 + package.json type:module
- `2fdf579` — upload-recipes.js + supabase recipes 테이블 스키마
- `76c3e22` — Rate limit 개선 (30초 딜레이, 재시도 3회 제한)

### 실행 명령어 (내일 오후 4시 이후)
```bash
cd "/Users/leedo/Documents/경기북부 인허가"
GEMINI_API_KEY=your_key node scripts/process-recipes.js
```

---

## 18. upload.html — 현재 DB 현황 섹션 추가 (2026-02-28)

### 배경
기존 upload.html은 엑셀 업로드만 가능했고 현재 DB 상태 확인 불가.

### 변경 내용

**페이지 구조 변경**
```
[1 — 데이터 유형 선택]   기존 유지
[2 — 현재 DB 현황]       신규 (🔄 새로고침 버튼 포함)
[3 — 엑셀 업로드]        기존, 하단 이동
[4 — 데이터 미리보기]    기존 유지
```

**유형별 동작**
| 유형 | 동작 | 표시 |
|------|------|------|
| managers / accounts | 편집 가능 테이블 | 전체 행 + 셀 편집 + 행추가/삭제 + 저장 |
| licenses / visit_logs | 읽기 전용 | 최신 20건 + 요약 뱃지 |

**licenses 요약 뱃지**: 총 N건 | 마지막 업로드: YYYY-MM-DD
**visit_logs 요약 뱃지**: 총 N건 | 최신 seq_no: N | 최근 방문일: YYYY-MM-DD

**편집 테이블 저장 로직**: delete(business_unit) + insert(전체 배열) — 기존 업로드 방식과 동일

**UPLOAD_TYPES 확장**
- `editable: true/false` 플래그
- managers/accounts → `columns` (편집 컬럼 정의)
- licenses/visit_logs → `previewColumns` (미리보기 컬럼 정의)

**정렬**
- licenses: `permit_date` desc (최신 허가일 순)
- visit_logs: `visit_date` desc (최신 방문일 순)

**스크롤**: max-height ~222px + overflow-y: auto, 헤더 sticky 고정

### 신규 함수
- `loadCurrentData()` — 유형 선택 시 자동 호출, count 선조회
- `renderReadonlyTable()` — 읽기 전용 + 요약 뱃지
- `renderEditableTable()` — 인라인 편집 테이블
- `collectEditableValues()` — DOM → currentDbData 동기화
- `deleteRow()` / `addRow()` — 행 편집
- `saveEditableData()` — Supabase delete + insert
- `getBusinessUnit()` — business_unit 캐시

### 커밋
- `121c0e1` — DB 현황 섹션 + 편집 가능 테이블 추가
- `f5fc6fb` — 스크롤 적용 + limit 조정 + 날짜 정렬 개선
- `8dd0726` — 읽기 전용 limit 5→20 (스크롤 표시 수정)

---

## 19. index.html — Google Sheets → Supabase 전환 (2026-02-28)

### 전환 전략
Supabase 영문 컬럼 → 기존 한국어 키 역매핑으로 나머지 코드 무수정

**역매핑 상수 3개 추가**
```javascript
LICENSE_DB_TO_KR   // permit_date → '영업 허가일', business_name → '사업장명' 등
ACCOUNTS_DB_TO_KR  // business_name → '거래처명', trade_status → '거래상태' 등
VISITLOG_DB_TO_KR  // business_name → '방문처(거래처)', visit_date → '일정기간' 등
```

### 전환된 함수

| 함수 | 변경 전 | 변경 후 |
|------|---------|---------|
| `loadManagerConfig()` | Google Sheets CSV (gid=489316402) | `managers` 테이블 select |
| `loadDataFromSheets()` | Google Sheets CSV (gid=0) | `licenses` 테이블 select |
| `loadAccountsData()` | Google Sheets CSV (gid=43116531) | `accounts` 테이블 select |
| `loadVisitLogCache()` | Google Sheets CSV (gid=707066983) | `visit_logs` 테이블 select (visit_date desc) |
| `updateDealStatus()` | Apps Script POST | Supabase `.update({ trade_status })` |

### 추가 헬퍼
```javascript
// business_unit 캐시 (페이지 전체 공유)
let _indexBusinessUnit = null;
async function getBusinessUnitForIndex() { ... }
```

### 호환성
- `allData` 배열 구조 유지 (한국어 키) → InfoWindow, 차트, 마커 코드 무수정
- `window.visitLogCache` 구조 유지 → 대시보드 방문 통계 무수정
- `accountsData` 구조 유지 → `updateAccountMarkers()` 무수정
- 지오코딩 로직 유지 (lat/lng 없는 항목만 처리)

### 미전환 (남은 작업)
- `uploadToSheets()` — Apps Script 업로드 함수 (index.html 내 엑셀 업로드 UI). 현재 Google Sheets에 저장. **Step 3**: 방문일지.html Supabase 전환 후 처리 예정

### 커밋
- `f0e087c` — index.html Supabase 전환 (4개 함수 + updateDealStatus)

---

## 20. 마이그레이션 진행 현황 (2026-02-28)

| 파일 | 데이터 소스 | 상태 |
|------|------------|------|
| `auth.js` | Supabase | ✅ 완료 |
| `upload.html` | Supabase | ✅ 완료 |
| `index.html` | Supabase | ✅ 완료 (Step 2) |
| `방문일지.html` | Google Sheets | ⏳ Step 3 (다음 작업) |

### 다음 작업 (Step 3)
`방문일지.html`에서 Google Sheets CSV 조회를 Supabase select로 전환
- `loadVisitLogs()` → `visit_logs` 테이블
- `loadAccounts()` → `accounts` 테이블
- `loadLicenses()` (있다면) → `licenses` 테이블
- 방문일지 신규 저장 → Supabase insert

---
