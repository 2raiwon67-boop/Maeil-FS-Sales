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
