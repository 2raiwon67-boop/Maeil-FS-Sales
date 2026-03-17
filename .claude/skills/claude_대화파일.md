# Claude 대화 요약 — 경기북부 FS 인허가 대시보드

> 저장소: https://github.com/2raiwon67-boop/Maeil-FS-Sales
> 배포: https://2raiwon67-boop.github.io/Maeil-FS-Sales/

---

## 프로젝트 구조

```
index.html       메인 대시보드 (지도 + 필터 + 마커, ~5000줄)
방문일지.html     방문 기록 관리 + AI 브리핑
proposal.html    견적서 / 매장 맞춤 분석
upload.html      데이터 관리 (업로드 + DB현황 + 공공인허가 조회)
report.html      월별 보고서
admin.html       관리자 페이지 (사용자 관리 + 소속 변경)
login.html       로그인 페이지
confirm.html     이메일 인증 확인
pending.html     승인 대기 안내
common.css       디자인 토큰 + 공통 컴포넌트
js/
  auth.js            Supabase 인증
  nav-component.js   상단 nav + 모바일 하단 탭바
api/
  gemini.js              Gemini 프록시 (리포트 분석용) — gemini-2.5-flash-lite
  generate-briefing.js   AI 브리핑 온디맨드 생성 — gemini-2.5-flash-lite
  batch-briefings.js     야간 배치 브리핑 + Mother Brain 임베딩 — gemini-2.5-flash-lite
  naver-reviews.js       네이버 검색 + Gemini 분석 (Recipe RAG 포함) — gemini-2.5-flash
  update-visit-log.js    방문일지 인라인 수정 (Service Role Key, business_unit 검증)
  send-license-alert.js  인허가 주간 알림 (Vercel Cron 월요일 09:15)
  public-license.js      공공데이터 API 프록시
  admin-all-data.js      관리자 전체 지점 데이터 조회 (x-admin-key 인증)
  admin-users.js         관리자 사용자 관리 (소속 변경 등)
scripts/
  process-recipes.js  레시피 PDF 파싱 (pdfjs 규칙 기반, API 없음)
  upload-recipes.js   Gemini 임베딩 → Supabase 업로드
  embed-visit-logs.js Mother Brain 수동 임베딩 배치
db/
  supabase_setup.sql  Supabase 테이블/RLS/RPC 정의 (멱등성 보장)
assets/
  images/   제품 이미지 (69개+)
  recipe/   레시피 PDF 337개 (gitignore, 로컬 전용)
```

---

## 데이터 소스 (전체 Supabase 전환 완료)

| 테이블 | 설명 | 비고 |
|--------|------|------|
| `licenses` | 인허가 데이터 | append 모드 업로드 |
| `accounts` | 주요거래처 | |
| `visit_logs` | 방문일지 | seq_no,business_unit UNIQUE |
| `managers` | 담당자 설정 | region1(시도), region2(시군구), manager_name, email, is_branch_manager (region 컬럼 삭제됨) |
| `recipes` | 레시피 RAG DB | 337건, pgvector(768차원) |
| `naver_cache` | 네이버 API 240h 캐시 | store_name UNIQUE |
| `quotes` | 저장된 견적 | |
| `ai_briefings` | 거래처 AI 브리핑 캐시 | (account_name, business_unit) UNIQUE, 7일 or 신규방문 2건+ 재생성 |
| `store_analysis_cache` | 네이버 매장 분석 캐시 | store_name UNIQUE, 7일 or 신규리뷰 2건+ 재생성 |

Google Sheets 의존성 완전 제거 (Step 1~4 완료).
proposal.html 제품DB(`loadProductDBFromSheets`)만 Google Sheets 잔존 (products 테이블 미생성).

---

## 완료된 주요 기능 (세션별 요약)

### 2026-02-27
- 마커 재사용 (`initAllMarkers` / `filterMarkers` 분리)
- 디자인 시스템 (`common.css` 디자인 토큰, Toast, Spinner, Skeleton)
- Chart.js `chart.update()` 최적화
- ~~T-map 연동 모듈 (`js/tmap-service.js`)~~ — 삭제됨 (미사용)

### 2026-02-28
- 통합 필터 패널 (2컬럼 항상 펼침)
- Supabase DB 아키텍처 설계 (성능 개선 목표)
- Google Sheets → Supabase 전환 (Step 1~4)
- 인허가 주간 알림 Vercel Cron (`api/send-license-alert.js`)
- 제품DB 개선: D열 사용용도 전환, 이미지 69개 등록
- naver-reviews.js AI 개선: 사용용도 + 음료 우선 추천

### 2026-03-01
- 레시피 RAG 파이프라인 구축 (337건 Supabase 적재 완료)
- upload.html: DB현황 섹션 + 편집 테이블 + 페이지네이션
- 방문일지 Supabase max-rows 1000 우회 (PAGE_SIZE 루프)
- 각종 버그 수정 (parseCSV 누락, proposal 추천상품, upload 세션)

### 2026-03-02
- proposal.html Recipe RAG 통합 (naver-reviews.js step 2.5)
- Naver API 240h Supabase 캐싱 + 프롬프트 압축
- `updateMap()` 50ms debounce 적용
- 공공인허가 조회 UI (upload.html) + `api/public-license.js`
- 마커 단건 갱신 구조 (`refreshMarkerForItem`)

### 2026-03-03
- 마커 UI: 크기 확대(16px), 원색 적용
- 마커 메모 기능 (localStorage 기반)
- 루트 패널 UI: 기거래처/미거래처 태그 분리

### 2026-03-04
- proposal.html 모바일 UX 4종 (이미지 확대, AI분석 버튼, 빈 행 버그, 가격 바텀시트)
- 견적서 디자인: 헤더 확대, 카드 1.5배, 매일유업 로고 색상 통일(`#1B3F82`)
- 소비기한(expiryDate) 카드 표시

### 2026-03-06
- 경유지 장바구니 기능 (최대 4곳, `routeCart[]`)
- 플로팅 카트 뱃지 (`#cartFloatBadge`)
- proposal.html: 견적 불러오기 팝업 모달
- proposal.html: 시그니처 메뉴 → Supabase recipes 기반 전환
- Cloudflare R2 레시피 PDF 뷰어 모달
- upload.html: 2열 그리드 레이아웃 (`minmax(0,1fr) 320px`)

### 2026-03-07
- Agentic AI 도입 기획 (N8N + Gemini + Groq, 미구현)

### 2026-03-08
- AI_핵심태그 완전 제거 (dead code 정리)
- 사이드바 필터 드롭다운 전환 + 사용우유 필터 추가
- 상태변경 버튼 → `<select>` 드롭다운 (InfoWindow + 바텀시트)
- 사용우유(milk_type) 선택 드롭다운 → Supabase 반영
- 모바일 하단 탭바 추가 (`nav-component.js`)
- 모바일 전면 버그 수정 (프로필 팝업, 마커 터치, 바텀시트 즉시닫힘)
- 거래처 바텀시트 거래상태 변경 + Supabase 연동

### 2026-03-09
- **장바구니 담긴 마커 보라색 표시** — `_buildCartMarkerIcon`, `_applyCartMarkerColor`, `_restoreCartMarkerColor`
- **모바일 내 타겟만 보기** — `managers.email`로 본인 식별, 자동 필터, 레이어 토글 버튼, localStorage 저장

### 2026-03-10 (최신 — AI 고도화 & 토큰 효율화)
- **A. JSON Mode 적용** — `generate-briefing.js`, `send-todo-alert.js`
  - `responseMimeType: 'application/json'` + `responseSchema` 강제 → JSON 파싱 실패 원천 차단
  - maxOutputTokens: 브리핑 1024→512, TO-DO 2048→1024 (평균 출력 기준 2배 여유)
  - 복잡한 JSON 복구 코드(마크다운 strip, trimEnd 패치) 제거
- **C. 사전 필터링 강화** — `send-todo-alert.js`
  - 방문 내용 15자 이상만 분석 대상 + 최대 50건 캡
- **B. 프롬프트 압축** — `naver-reviews.js`
  - 400+ 토큰 고정 지침을 `systemInstruction`으로 분리·압축 (~56K tokens/월 절감)
- **H. 클라이언트 브리핑 캐시** — `방문일지.html`
  - `window._briefingCache` Map 추가, 세션 내 같은 거래처 재오픈 시 API 호출 없이 즉시 표시
  - LRU 30개 제한 (초과 시 가장 오래된 항목 자동 삭제)
- **D. 개척완료 성공 패턴 학습** — `generate-briefing.js`
  - 방문 내용에서 `/개척\s*완료/` 감지 → 성공 방문 별도 섹션으로 프롬프트 추가
  - 성공 기록 없는 거래처는 섹션 생략 (hallucination 방지)
  - 어시스턴트 명칭 "식품 FS" → "매일유업 FS"로 수정
- **E. 방문 우선순위 AI 추천** — `방문일지.html`
  - "방문 우선순위" 토글 버튼 추가 (내 알림 / 지점 전체 옆)
  - 본인 담당 거래처만 필터 (`currentUserFullName` 기준, 폐업·DROP 제외)
  - 마지막 방문 경과일 + 거래 상태 + 최근 내용 기반 Top 5 추천
  - JSON Mode 적용, 당일 localStorage 캐시로 하루 1회 API 호출 제한
- **SW v61** 업데이트

### 2026-03-10
- **AI 브리핑 기능 신규 구현** — `api/generate-briefing.js` (온디맨드 + Supabase 캐시)
  - 방문일지 타임라인 모달에서 거래처 카드 클릭 시 AI 브리핑 자동 생성
  - Gemini 2.5 Flash, maxOutputTokens 1024 (한국어 절단 방지)
  - `ai_briefings` 테이블 캐시 (7일 or 신규 방문 2건+ 시 재생성)
- **야간 배치 자동 브리핑 갱신** — `api/batch-briefings.js` (Vercel Cron 18:00 UTC = 03:00 KST)
  - 전날 이후 방문일지 거래처만 처리, 6개월 이내 데이터, 6초 간격(10 RPM 준수)
  - 버그 수정: `lastVisitDate !== cache.last_visit_date` 날짜 비교로 교체 (기존 visit_count 숫자 비교 오류)
- **경유지 삭제 시 루트 자동 초기화** — `removeFromCart`, `clearCart`에 `clearRoute()` 연동
- **TO-DO 캐시 키 개선** — `miso_todo_{bu}_{date}_v{visitCount}` (당일 재업로드 시 스테일 캐시 우회)
- **mob-profile-popup 데스크탑 노출 버그 수정 (재발)** — common.css 전역 `display:none`에 `.mob-profile-popup` 재추가
- **통합 액션 스트립** — TO-DO 카드 + 이번달/전체 stat 카드 단일 가로 스크롤 행으로 통합
  - 오늘/이번주 stat 제거 (후행 데이터 특성상 항상 0)
  - `#todoList` `display:contents` → 자식 카드가 `.action-strip` flex에 직접 참여
  - 구분선(`strip-sep`)으로 TO-DO 영역과 통계 영역 시각적 분리
  - 이번달/전체 stat 2카드 → `.strip-stat-combined` 단일 카드로 통합 (내부 세로 구분선으로 분리, 공백감 제거)
  - **stat 카드 완전 제거** — `.strip-stat-combined` / `updateStatistics()` 삭제 (불필요 판단), SW v60
  - **이메일 발송 Resend → Brevo 교체** — `send-license-alert.js` 수정
    - Resend 무료플랜 제한 발견: `resend.dev` 도메인은 본인 이메일로만 발송 가능 (팀원 발송 불가)
    - Brevo로 교체: 도메인 불필요, 일 300건 무료, Gmail 발신자 인증으로 사용
    - 환경변수: `RESEND_API_KEY` → `BREVO_API_KEY`, `BREVO_FROM_EMAIL`
    - 발송 테스트 완료: 5명 전원 수신 확인
  - **TO-DO 알림 API 추가** — `api/send-todo-alert.js` 신규 생성 (Make.com 연동용)
    - 이번달 visit_logs 조회 → Gemini TO-DO 추출 → 담당자별 구조화 응답
    - Make.com HTTP 모듈로 호출 (Power Automate Premium 우회)
    - Teams 개별 DM: 회사 IT 보안 정책으로 차단 → 이메일 방식으로 전환 예정

### 2026-03-10 (버그 수정 — 레시피 & 방문우선순위)
- **proposal.html 레시피 항상 동일 문제 수정**
  - 원인: 태그 매칭 실패 시 `recipes.slice(0, 2)` 고정 폴백 → 항상 "바이올렛 딸기 에이드 / 레몬 청포도 아이스" 출력
  - 수정: `data.description` 텍스트 키워드도 매칭에 활용 (오트, 식물성 등 AI 분석 내용 반영)
  - 수정: 매칭 실패 폴백을 랜덤 셔플로 변경 (항상 같은 레시피 고정 방지)
  - 레시피 이름도 매칭 필드에 추가 (`rName`)
- **방문일지.html 방문우선순위 AI JSON 파싱 오류 수정**
  - 원인: `JSON.parse('')` → `SyntaxError: Unexpected end of JSON input` (rawText 빈 문자열 처리 없음)
  - 수정: 빈 응답 체크 + try-catch 안전 처리 + 에러 시 rawText 콘솔 출력
  - `maxOutputTokens` 512 → 1024 상향 (응답 잘림 방지)

### 2026-03-10 (AI 최적화 & Mother Brain 설계)
- **Gemini Embedding RPM 98/100 문제 발견 및 원인 분석**
  - naver-reviews.js Recipe RAG가 매장 분석마다 Embedding API 호출하는 구조
  - proposal.html 백그라운드 업데이트가 localStorage 캐시 히트여도 항상 재호출
  - 수정: 백그라운드 업데이트 10일 미만 캐시 스킵 (BG_UPDATE_SKIP_MS)
- **방문일지 방문우선순위 기능 제거** (불필요 판단, 140줄 코드 정리)
- **AI 브리핑 온디맨드 전환** (자동 호출 → 버튼 클릭 시만)
  - 카드 클릭 시 타임라인 즉시 열림, "✦ AI 브리핑 보기" 버튼 별도
  - 실패 시 "재시도" 버튼 노출
  - maxOutputTokens 512 → 1024, 프롬프트 "4줄 이내" 제약 제거 → 완성형 문장

**RAG 구현 현황 (점검 결과)**
- 레시피 RAG: ✅ 완성 (pgvector + Gemini Embedding + search_recipes RPC)
  - 두 시스템 병존: 백엔드 벡터 RAG (naver-reviews.js) + 프론트 키워드 매칭 (proposal.html)
  - 두 시스템이 파이프라인으로 협력하는 구조 (환각 방지 역할 분담) → 통합 불필요
- 방문일지 RAG (Mother Brain): ✅ 구현 완료 (아래 참고)

### 2026-03-10 (Mother Brain 구현 완료)
- **Mother Brain 개요**
  - 목표: 브리핑 생성 시 유사 거래처 성공 사례를 자동 참고 (팀 전체 경험이 자산화)
  - 대상: `개척완료` / `개척 완료` 포함 방문일지 375건

- **구현 내용**
  1. **DB 스키마** (`db/supabase_setup.sql`)
     - `visit_logs` 테이블에 `embedding vector(768)` 컬럼 추가
     - `visit_logs_embedding_idx` ivfflat 인덱스 생성
     - `search_success_visits(query_embedding, p_business_unit, match_count)` RPC 함수 (SECURITY DEFINER)
       - 같은 business_unit의 개척완료 레코드 중 유사도 상위 2건 반환
  2. **배치 임베딩 스크립트** (`scripts/embed-visit-logs.js`, 신규 파일)
     - `embedding=is.null & content=ilike.*개척완료*` 조건으로 미처리 레코드 조회
     - Gemini Embedding API(768차원): `business_name | trade_status | content(최대 300자)` 임베딩
     - MAX_PER_RUN=500, EMBED_DELAY_MS=50ms (RPM/RPD 보호)
     - 실행: `GEMINI_API_KEY=xxx SUPABASE_URL=xxx SUPABASE_SERVICE_ROLE_KEY=xxx node scripts/embed-visit-logs.js`
  3. **브리핑 API 연동** (`api/generate-briefing.js`)
     - 브리핑 생성 전 현재 거래처 컨텍스트를 임베딩 → `search_success_visits` RPC 호출
     - 자기 자신 제외(`business_name !== accountName`) 후 1~2건 프롬프트 주입
     - Mother Brain 실패 시 브리핑은 정상 생성 (try-catch 무시)
     - 프롬프트 예시: `[유사 거래처 개척 성공 사례]\n- XX카페 (2025-12-01): ...`

- **주의 사항**
  - "개척활동" 오매칭 방지: SQL/스크립트/JS 모두 엄격 조건 적용

### 2026-03-10 (Mother Brain 고도화 — 연결완료 포함 + 자동화)
- **임베딩 배치 실행 완료** — `node --env-file=.env scripts/embed-visit-logs.js`
  - 1차 실행 (개척완료만): 255건
  - 2차 실행 (개척 완료 + 연결완료 추가): 77건 → **총 332건 임베딩 완료**
- **`scripts/embed-visit-logs.js` 쿼리 수정**
  - 기존: `content=ilike.*개척완료*` (단일 조건)
  - 수정: `or=(content.ilike.*개척완료*,content.ilike.*개척 완료*,content.ilike.*연결완료*)` (3가지 포함)
- **`api/batch-briefings.js` — Mother Brain 임베딩 배치 통합**
  - 기존 야간 Cron(03:00 KST)에 6번 섹션으로 추가
  - `embedding=null` + 성공 키워드 포함 레코드 매일 최대 50건 자동 처리
  - 다른 사업부 추가 시에도 별도 Cron 없이 자동 대응
- **사업부 격리 검증 및 강화**
  - SQL `search_success_visits`: `v.business_unit = p_business_unit` 조건으로 DB 레벨 격리 ✅
  - `generate-briefing.js`: `businessUnit || ''` → `businessUnit ?? null` (NULL 사업부 격리 정확도 개선)
  - `db/supabase_setup.sql`: `search_success_visits` 함수에 `연결완료` 조건 추가
  - ⚠️ **Supabase SQL Editor에서 수정된 `search_success_visits` 함수 재실행 필요**

### 2026-03-11 (모델 전환 + TO-DO 삭제 + 공공인허가 개선)

- **Gemini 모델 전환 (전역)**
  - 배경: 2.5-flash RPD 20건 한도 초과(429) → 2.0-flash로 전환 → 유료 전환 후 preview 모델 차단(404) → 최종 전환
  - `api/gemini.js`: gemini-2.5-flash → 2.0-flash → 2.0-flash-001 → **gemini-2.5-flash-lite** (최종)
  - `api/generate-briefing.js`: 동일 모델 경로 변경, `responseMimeType: 'application/json'` 유지
  - `api/batch-briefings.js`: 동일 모델 경로 변경
  - `api/naver-reviews.js`: gemini-2.5-flash **유지** (복잡한 분석 필요)
  - `generate-briefing.js` thinking 모델 parts 파싱 버그 수정:
    ```js
    const parts = geminiData.candidates?.[0]?.content?.parts || [];
    const rawText = (parts.find(p => !p.thought) || parts[0])?.text?.trim() || '';
    ```
  - `report.html`: `generationConfig`에서 `thinkingConfig` 제거 (2.5-flash 한도에 영향)

- **TO-DO AI 기능 완전 삭제** (`방문일지.html`)
  - 이메일로 실제 사용 안 됨 + 토큰 소모 과다 → 완전 삭제
  - CSS ~130줄, HTML ~15줄, JS ~160줄 제거
  - `extractTodos()`, `renderTodos()`, `toggleTodoView()` 함수 삭제
  - `cachedTodoItems`, `cachedTodoItemsAll` 변수 삭제
  - 방문일지 상세보기의 TO-DO 필드 표시 코드는 유지

- **`api/send-todo-alert.js` 삭제**
  - TO-DO 기능 삭제에 따라 불필요 → 파일 삭제
  - Vercel Cron 슬롯 1개 확보 (Hobby plan 2개 제한)

- **`js/gemini-chatbot.js` 삭제**
  - 어느 HTML에도 연결되지 않은 미사용 파일 → 삭제

- **공공인허가 조회 개선** (`api/public-license.js` + `upload.html`)
  - fetch 타임아웃: 15초 → 8초 (Vercel 기본 10초 제한 고려)
  - 실패 지역 감지: `{ items: [], totalCount: 0, failed: true }` 반환 구조 추가
  - `fetchAllForType` 반환값 `{ items: all, failedRegions }` 구조로 변경
  - `upload.html`: 실패 지역 토스트 경고 추가
    ```js
    if (data.failedRegions?.length) {
        showToast(`⚠️ 일부 지역 조회 실패 (재시도 권장): ${data.failedRegions.join(', ')}`);
    }
    ```
  - `vercel.json` maxDuration 추가:
    ```json
    "functions": {
        "api/public-license.js": { "maxDuration": 60 },
        "api/batch-briefings.js": { "maxDuration": 300 },
        "api/send-license-alert.js": { "maxDuration": 60 }
    }
    ```

### 2026-03-11 (코드 점검 + AI 브리핑 UX 개선 + 방문일지 수정 기능)

- **전체 코드 점검 — 런타임 버그 2건 수정**
  - `batch-briefings.js:85`: `results` 선언(112줄) 전에 `results.failed++` 접근 → `continue`로 교체
  - `naver-reviews.js:206`: 캐시 히트 경로에서 `localSummary` TDZ 오류 → `localData.items` 직접 참조
  - `send-license-alert.js`: "Resend" 잔존 주석 → "Brevo"로 수정
  - `방문일지.html`: `showDetail()` / `closeDetailModal()` dead code 제거 (~60줄)

- **AI 브리핑 방문일지 3건 미만 차단**
  - `requestAiBriefing()` 진입 시 `visits.length < 3` 체크 → 토스트 경고 후 API 호출 차단
  - 버튼 하단 안내 문구: "방문일지 3건 이상인 거래처만 분석 가능"

- **AI 브리핑 UI 통일 + 텍스트 포매팅**
  - 다크 그라디언트(`#0a1628`) → 라이트 카드(`#f0f6ff`, 파란 테두리)로 교체
  - `formatBriefingText()` 함수: ①②③ 마커 자동 파싱 → 아이콘+레이블+본문 블록 구조화 렌더링
    - 👤 키맨/결정권자 / 🚧 반복 허들 / 💡 추천 접근법
  - `textContent` → `innerHTML` (포매팅 적용)

- **주요거래처 RAG 추가** (`generate-briefing.js`)
  - 최근 방문 `status === '거래'` 감지 → 동일 사업부 내 타 거래처 방문 사례 3건 조회
  - 프롬프트에 `[유사 주요거래처 관리 사례]` 섹션으로 주입
  - Gemini API 불필요 (Supabase REST 쿼리만 사용)

- **AI 브리핑 RAG 품질 개선**
  - `generate-briefing.js` 프롬프트: "관련성 낮으면 무시" 명시 → 억지 사례 끼워넣기 방지
  - `search_success_visits` SQL: `AND 1 - (embedding <=> query_embedding) > 0.62` 추가 (유사도 62% 미만 차단)
  - ⚠️ **Supabase SQL Editor에서 `search_success_visits` 함수 재실행 필요**

- **방문일지 인라인 수정 기능** (`api/update-visit-log.js` 신규)
  - 각 타임라인 항목에 ✏️ 수정 버튼 추가
  - 담당자 / 거래상태 / 방문 내용 인라인 수정 → DB PATCH 즉시 반영
  - Service Role Key 사용 + business_unit 검증 (타 사업부 레코드 수정 차단)
  - 저장 완료 시 해당 거래처 브리핑 세션 캐시 자동 무효화
  - `방문일지.html`: `_id`, `거래상태` VL 매핑 추가, `getStatusClass()` / `escapeHtml()` / `renderVisitView()` / `renderEditPanel()` 헬퍼 분리

- **Supabase 테이블 정의 완전화** (`db/supabase_setup.sql`)
  - 코드에서 사용 중이었으나 파일에 없던 4개 테이블 추가:
    - `ai_briefings` (business_unit RLS)
    - `naver_cache` (RLS 미적용 — anon key 서버호출)
    - `store_analysis_cache` (RLS 미적용)
    - `quotes` (business_unit RLS)
  - 전체 파일 멱등성 확인: `IF NOT EXISTS` / `CREATE OR REPLACE` 패턴으로 재실행 안전

### 2026-03-11 (크론잡 점검 + AI 브리핑 전환 제품 + UI 개선) — v76

- **Vercel 크론잡 2종 점검**
  - `send-license-alert` (`15 0 * * 1` = 월요일 09:15 KST): FS MISO 발신자로 Brevo 이메일 발송 ✅
  - `batch-briefings` (`0 18 * * *` = 매일 03:00 KST): 브리핑 캐시 갱신 + Mother Brain 임베딩 ✅ (이메일 없음)
  - 수동 터미널 호출로 이메일이 발송된 것으로 확인 (크론 오작동 아님)
  - `send-license-alert.js` 주석 `RESEND_API_KEY` → `BREVO_API_KEY` 수정 (Brevo 전환 후 미수정 주석)

- **AI 브리핑 ④ 자사 전환 제품 항목 추가**
  - `generate-briefing.js` 프롬프트: ④ 자사 전환 제품 항목 추가
    - 개척완료·연결완료 방문에서 기존 타사 제품 → 자사 제품 교체 내용 1줄 추출
    - 방문 기록에 해당 정보 없으면 AI가 이 항목 자체를 생략
  - `batch-briefings.js` 야간 배치 프롬프트에도 전환 제품 언급 추가
  - `방문일지.html` `formatBriefingText()` ④ 파서 추가:
    - `ICONS['④'] = '📦'`, `LABELS['④'] = '전환 제품'`
    - split 정규식 `/(?=[①②③④])/`, filter `/^[①②③④]/` 확장

- **브리핑 버튼 + 모바일 모달 UI 개선**
  - AI 브리핑 버튼: `width:100%` → `width:50%` + 컨테이너 `align-items:center` (가운데 정렬)
  - 모바일 타임라인 모달: `max-height:100vh` → `max-height:66.67vh` (화면 2/3 상한선 제한)
  - 누적된 방문일지가 많아도 하단에서 2/3 높이까지만 올라오고 내부 스크롤 처리

- **배포**: sw.js v75 → v76, GitHub push (커밋 `26bff87`)

### 2026-03-13 (지점 확장 대응 + upload 개선 + 알림 이메일 분리)

- **지점 확장 시 잠재적 문제 분석**
  - BUSINESS_UNITS: `js/auth.js`에 이미 서울·경기남부 등록 완료 → 회원가입 즉시 가능
  - Gemini 유료 전환 완료 → 일 500건 무료 한도 제약 해소
  - RLS 정책으로 business_unit 기반 데이터 격리 확인 (서버 레벨 강제)
  - 인허가 API 지역 하드코딩, 담당자 동명이인, 인허가 알림 미분리 3가지 실질 문제 확인

- **managers 테이블 region1/region2 컬럼 추가** (`upload.html`)
  - 기존 `region` 컬럼 유지 (index.html managerMap 호환)
  - `region1`: 시도 (경기도, 인천광역시, 강원도 등)
  - `region2`: 시군구 (포천시, 남양주시 등)
  - upload.html 담당자 관리 컬럼 구조 변경: 시도/시군구/담당자/이메일
  - ⚠️ **Supabase SQL 실행 필요**: `ALTER TABLE managers ADD COLUMN IF NOT EXISTS region1 TEXT; ALTER TABLE managers ADD COLUMN IF NOT EXISTS region2 TEXT;`
  - ⚠️ **기존 24개 담당자 행 region1/region2 직접 입력 필요** (Supabase Table Editor)

- **인허가 지역 칩 동적 로드** (`upload.html`)
  - 하드코딩된 경기북부 13개 지역 칩 → managers 테이블 region2 기반 동적 생성
  - 로그인 business_unit에 맞는 지역만 칩으로 표시

- **템플릿 예시 행 오업로드 방지** (`upload.html`)
  - 템플릿 다운로드 시 첫 셀을 `[예시]`로 마킹
  - 업로드 파싱 시 `[예시]` 행 자동 필터링

- **현재 DB 다운로드 버튼 추가** (`upload.html`)
  - 템플릿 버튼 옆 녹색 "현재 DB 다운로드" 버튼
  - 파일명: `FS_MISO_{타입}_{날짜}.xlsx`

- **샘플 데이터 현실화** (`upload.html`)
  - 날짜 2024 → 2026, 업종·주소·내용 실제 업무 형태로 수정

- **담당자 관리 가이드 카드 추가** (`upload.html`)
  - 담당자 탭 선택 시 DB 현황 위에 표시
  - 컬럼별 입력 예시·설명 표, 지점장 본인 등록법(시군구에 `지점장` 입력), 업로드 절차 안내

- **인허가 알림 이메일 business_unit 분리** (`api/send-license-alert.js`)
  - 기존: 전체 데이터 → 전 지점장에게 동일 발송 (버그)
  - 수정: business_unit별 그룹핑 → 각 지점 담당자·지점장에게 본인 지점 데이터만 발송
  - 이메일 인사말에 수신자 이름 표시: `${managerName}님, 안녕하십니까`
  - is_branch_manager OR region=`지점장`/`전체` 두 조건 모두 지점장 처리

### 2026-03-13 (지점 확장 대응 + upload 개선 + 알림 이메일 분리)

- **지점 확장 시 잠재적 문제 분석**
  - BUSINESS_UNITS: `js/auth.js`에 이미 서울·경기남부 등록 완료 → 회원가입 즉시 가능
  - Gemini 유료 전환 완료 → 일 500건 무료 한도 제약 해소
  - RLS 정책으로 business_unit 기반 데이터 격리 확인 (서버 레벨 강제)
  - 인허가 API 지역 하드코딩, 담당자 동명이인, 인허가 알림 미분리 3가지 실질 문제 확인

- **managers 테이블 region1/region2 컬럼 추가** (`upload.html`)
  - 기존 `region` 컬럼 유지 (index.html managerMap 호환 유지)
  - `region1`: 시도 (경기도, 인천광역시, 강원도 등)
  - `region2`: 시군구 (포천시, 남양주시 등)
  - upload.html 담당자 관리 컬럼 구조 변경: 시도/시군구/담당자/이메일
  - 엑셀 템플릿·샘플·columnMap 업데이트
  - ⚠️ **Supabase SQL 실행 필요**: `ALTER TABLE managers ADD COLUMN IF NOT EXISTS region1 TEXT; ALTER TABLE managers ADD COLUMN IF NOT EXISTS region2 TEXT;`
  - ⚠️ **기존 24개 담당자 행 region1/region2 직접 입력 필요** (Supabase Table Editor)

- **인허가 지역 칩 동적 로드** (`upload.html`)
  - 하드코딩된 경기북부 13개 지역 칩 → managers 테이블 region2 기반 동적 생성
  - 로그인 business_unit에 맞는 지역만 칩으로 표시
  - region2 입력 전까지는 "지역 로드 실패" 메시지 표시

- **템플릿 예시 행 오업로드 방지** (`upload.html`)
  - 템플릿 다운로드 시 첫 셀을 `[예시]`로 마킹
  - 업로드 파싱 시 `[예시]` 행 자동 필터링 → 예시 데이터 DB 저장 방지

- **현재 DB 다운로드 버튼 추가** (`upload.html`)
  - 템플릿 다운로드 버튼 옆 녹색 "현재 DB 다운로드" 버튼 추가
  - 현재 로드된 DB 데이터를 templateHeaders 기준 엑셀로 내보냄
  - 파일명: `FS_MISO_{타입}_{날짜}.xlsx`
  - 수정 후 재업로드 워크플로우 지원

- **샘플 데이터 현실화** (`upload.html`)
  - 날짜 2024 → 2026, 업종·주소·내용 실제 업무 형태로 수정
  - 이메일 예시 `@example.com` 유지 (실제 이메일 오입력 방지)

- **담당자 관리 가이드 카드 추가** (`upload.html`)
  - 담당자 탭 선택 시만 표시되는 "지점장 필독" 안내 카드
  - 컬럼별 입력 예시·설명 표, 지점장 본인 등록법(시군구에 `지점장` 입력), 업로드 절차 안내

- **인허가 알림 이메일 business_unit 분리** (`api/send-license-alert.js`)
  - 기존: service_role_key로 전체 조회 → 지점장 전원에게 전체 데이터 발송 (버그)
  - 수정: business_unit별 그룹핑 → 각 지점 담당자·지점장에게 본인 지점 데이터만 발송
  - 이메일 제목: `(지점명 전체)` 추가로 구분 명확화
  - 인사말에 수신자 이름 표시: `${managerName}님, 안녕하십니까`
  - is_branch_manager 컬럼 OR region=`지점장`/`전체` 두 조건 모두 지점장 처리

### 2026-03-13 (데이터 무결성 강화 + 관리자 기능 확장) — v78~v81

- **엑셀 업로드 카드 DB 다운로드 버튼 제거** (`upload.html`)
  - 엑셀 업로드 카드에서 녹색 "현재 DB 다운로드" 버튼 삭제 (DB 현황 섹션에만 유지)

- **인허가·주요거래처 업로드 중복 방지** (`upload.html`)
  - 기존: `mode: 'append'` → 중복 데이터 누적
  - 변경: `mode: 'add_new_only'` + `deduplicateField`로 기존 상호명 조회 후 중복 건너뜀
    - `licenses`: `deduplicateField: 'business_name'`
    - `accounts`: `deduplicateField: 'account_id'`
  - 업로드 확인 전 "중복 확인 중..." → 중복 N건 건너뜀 토스트 표시
  - 전부 중복이면 "추가할 신규 항목이 없습니다" 배너 표시

- **DB 현황 행 클릭 삭제 기능** (`upload.html`)
  - 기존: 각 행 오른쪽 🗑️ 버튼 (성능·UX 문제)
  - 변경: 행 클릭 → 빨간 하이라이트(#fff0f0) + 상단 "🗑️ 선택 행 삭제" 버튼 표시
    - 같은 행 재클릭 시 선택 해제
    - `selectDbRow()` / `deleteSelectedDbRow()` 함수 추가
    - "행을 클릭하면 선택됩니다" 힌트 텍스트 표시

- **관리자 전체 지점 마커 표시** (`index.html` + `api/admin-all-data.js`)
  - 관리자(fs_admin_access) 로그인 시 전체 지점 데이터 지도 마커 표시
  - `api/admin-all-data.js` 신규: SERVICE_ROLE_KEY 사용, `x-admin-key` 헤더 인증
  - `fetchAdminTable(table)` 헬퍼 함수 추가 (`ADMIN_CODE = '532753'`)
  - `loadDataFromSheets()`, `loadAccountsData()`, `loadVisitLogCache()` 관리자 분기 처리
  - `vercel.json` CORS 허용 헤더에 `x-admin-key` 추가
  - ⚠️ **Vercel 환경변수 추가 필요**: `ADMIN_CODE = 532753`

- **sw.js v76 → v77** 업데이트

### 2026-03-13 오후 (데이터 무결성 강화 + 관리자 기능 확장) — v78~v81

- **send-license-alert.js region → region2 수정** (v78)
  - 지점장 판별 로직 `m.region` → `m.region2` 전환
  - managers.region 컬럼 Supabase 삭제 가능 상태 확보

- **방문일지 중복 기준 변경** (`upload.html`, v78)
  - 기존: `seq_no` 단일 키 (엑셀 행번호라 파일마다 1부터 재시작 → 오탐)
  - 변경: `(visit_date + manager + business_name)` 복합키
  - DB: `visit_logs_bu_seq_unique` 삭제 → `visit_logs_natural_uq (business_unit, visit_date, manager, business_name)` 신규 생성
  - ✅ Supabase 인덱스 교체 완료

- **관리자 소속 변경(인사발령) 기능** (`admin.html` + `api/admin-users.js`, v79)
  - 전체 사용자 탭 각 유저 행에 [소속 변경] 버튼 추가
  - 드롭다운에서 새 지점 선택 → `transfer` action으로 `user_metadata.business_unit` 변경
  - 변경 즉시 RLS 적용, 이메일 알림도 새 지점 기준 전환

- **업로드 시 담당자 유효성 검사** (`upload.html`, v80)
  - 인허가·방문일지 업로드 시 같은 business_unit의 managers 테이블과 비교
  - 미등록 담당자 있으면 "⚠️ N건 이메일 알림 미발송 가능" 경고 팝업 (업로드 차단 아님)

- **데이터 정합성 점검 패널** (`upload.html`, v81)
  - DB현황 헤더 `🔍 데이터 점검` 버튼 → 9가지 항목 자동 검사
  - ⚠️ 빨강: 인허가/방문일지 미등록 담당자, 이메일 누락, 비정상 거래상태
  - ℹ️ 주황: 미지정 담당자, 순위/허가일/좌표 미입력, 방문일지 날짜 미입력

- **supabase_setup.sql 정리**
  - 실제 DB 이력 기반으로 전면 정리
  - managers: region 컬럼 제거 (region1/region2만 유지)
  - recipes: pdf_url 컬럼 추가
  - naver_cache: id→uuid, anon_all RLS 정책 추가
  - ai_briefings: RLS 활성화 + 지점별 SELECT 정책 추가 ✅ Supabase 실행 완료
  - quotes: 한글 중복 정책 3개 삭제 ✅ Supabase 실행 완료

- **Supabase 직접 실행 완료 목록**
  - `ALTER TABLE managers DROP COLUMN IF EXISTS region;`
  - `DROP INDEX IF EXISTS visit_logs_natural_uq;` (구버전)
  - `DROP INDEX IF EXISTS visit_logs_bu_seq_unique;`
  - `CREATE UNIQUE INDEX visit_logs_natural_uq ON visit_logs (business_unit, visit_date, manager, business_name) WHERE ...`
  - `DROP POLICY "지점별 견적서 조회/저장/삭제" ON quotes;`
  - `ALTER TABLE ai_briefings ENABLE ROW LEVEL SECURITY;` + SELECT 정책

### Teams/알림 시도 및 결론
- Power Automate HTTP 커넥터 → Premium 전용으로 차단
- Make.com Teams 커넥터 → 회사 IT 조건부 액세스 정책으로 차단
- Teams Incoming Webhook → 채널 공개 알림 (개별 DM 불가)
- **최종 방향**: Brevo 이메일로 개별 발송 (이미 동작 확인)

---

## 핵심 코드 패턴

### 마커 구조
```javascript
// 인허가 마커
marker._item    = item;      // 원본 데이터 참조
marker._status  = status;    // 거래여부
marker._rank    = '1'|'2';
marker._region  = '의정부시';
marker._manager = '이도현';
marker._milk    = '매일';
marker._origIcon = ...;      // 장바구니 담길 때 원본 저장

// 거래처 마커
marker._dealStatus = '거래'|'미거래';
marker._lat / _lng / _address
```

### 필터 변수
```javascript
currentManager          // 담당자 필터
currentRegion           // 지역 필터
currentMilkFilter       // 사용우유 필터
window.currentDealStatusFilter  // 거래상태 필터
currentFilter           // 순위 필터 ('all'|'1'|'2')
currentAccountFilter    // 거래처 필터
mobileVisibleLayers     // 모바일 레이어 Set
mobileStarLayers        // 모바일 별마커 Set
myManagerName           // 로그인 사용자 담당자명 (지점장=null)
isMyTargetOnly          // 내 타겟만 보기 활성화
```

### Recipe RAG 흐름 (2026-03-17 고도화)
```
[백엔드 — naver-reviews.js step 2.5]
매장명 + 블로그 제목 → Gemini embedding-001(768차원)
    → Supabase RPC search_recipes(match_count=5)
    → 유사 레시피 → Gemini 분석 프롬프트에 컨텍스트 주입

[프론트 — proposal.html → api/recipe-recommend.js]
매장 분석 완료 후:
  tags + signatureMenus.ingredients + 추천제품명 + 계절
    → Gemini embedding-001(768차원)
    → Supabase RPC search_recipes(match_count=2)
    → Gemini flash-lite로 레시피별 reason(25자) 생성
    → 카드 표시 (이름 + 카테고리 + reason + PDF 보기)
  캐시: localStorage recipe_cache_${storeName} 30일
```

### Supabase 역매핑 (index.html)
```javascript
LICENSE_DB_TO_KR   // permit_date → '영업 허가일' 등
ACCOUNTS_DB_TO_KR  // trade_status → '거래상태' 등
VISITLOG_DB_TO_KR  // visit_date → '작성일' 등
```

### 공통 헬퍼
```javascript
showToast(msg, type, duration)  // 'success'|'error'|'warning'
isMobile()                      // window.innerWidth <= 768
getBusinessUnitForIndex()       // business_unit 캐시
```

---

## SW 캐시 버전 히스토리 (주요 변경만)

| 버전 | 내용 |
|------|------|
| v19 | Supabase 전환 |
| v29 | 경유지 장바구니, proposal + upload 개선 |
| v32 | 견적 불러오기 팝업 모달 |
| v38 | 레시피 연계 추천, PDF 뷰어 |
| v40 | 거래현황·사용우유 필터 드롭다운 전환 |
| v42 | 상태변경 select 전환, 프로필 버그 수정 |
| v48 | #map touch-action:none (마커 터치 수신) |
| v49 | 거래처 바텀시트 거래상태 변경 |
| v50 | 마커 즉시 표시 최적화 + 탭 prefetch |
| v51 | 장바구니 담긴 마커 보라색 표시 |
| v52 | 모바일 내 타겟만 보기 기능 |
| v53 | batch-briefings 날짜비교 버그 수정, TO-DO 캐시키 visitCount 포함 |
| v54 | generate-briefing 원복 + batch-briefings fetch ok 체크 |
| v55 | AI 브리핑 env 폴백(후 원복), 경유지 삭제→루트 자동초기화, 에러표시 |
| v56 | SW 버전 bump |
| v57 | mob-profile-popup 데스크탑 노출 버그 재발 수정 |
| v58 | TO-DO + 통계 가로 스크롤 스트립 통합, 오늘/이번주 제거 |
| v59 | stat 카드 2개→1개 통합 (이번달+전체 combined 카드, 공백감 제거) |
| v60 | 이번주 방문 우선순위 AI 추천 추가 (방문일지.html) |
| v61 | proposal 레시피 매칭 개선 (description 키워드 반영 + 랜덤 폴백), 방문우선순위 JSON 파싱 오류 수정 |
| v62 | proposal 백그라운드 업데이트 10일 미만 스킵 (Embedding RPD 절감), 방문우선순위 기능 제거 |
| v63 | AI 브리핑 온디맨드 전환 (버튼 클릭 시만 생성), 프롬프트 개선 (maxOutputTokens 1024, 완성형 문장) |
| v64 | Mother Brain 구현 (visit_logs 임베딩 컬럼 + search_success_visits RPC + 브리핑 API 연동) |
| v65 | Mother Brain 고도화 (연결완료 포함, batch-briefings 자동 임베딩 통합, 사업부 격리 강화) |
| v66 | gemini-chatbot.js 미사용 파일 삭제 |
| v67 | 방문일지 TO-DO AI 기능 완전 삭제 (CSS/HTML/JS ~305줄 제거) |
| v68 | send-todo-alert.js 삭제 (TO-DO 기능 제거, Cron 슬롯 확보) |
| v69 | 공공인허가 fetch 타임아웃 8초 + failedRegions 응답 + upload.html 토스트 경고 |
| v70 | vercel.json maxDuration 추가 (public-license 60s, batch-briefings 300s) |
| v71 | Gemini 모델 전환: gemini.js/generate-briefing.js/batch-briefings.js → 2.5-flash-lite, report.html thinkingConfig 제거 |
| v72 | 코드 점검: batch-briefings results TDZ 버그, naver-reviews localSummary TDZ 버그 수정, dead code 제거 |
| v73 | AI 브리핑 방문일지 3건 미만 차단 + 버튼 안내 문구 |
| v74 | AI 브리핑 UI 라이트 테마 + ①②③ 구조화 렌더링 + 주요거래처 RAG |
| v75 | 방문일지 인라인 수정 기능 (update-visit-log API) + RAG 유사도 임계값 0.62 + SQL 테이블 4개 추가 |
| v76 | 인허가 알림 이메일 business_unit 분리 + 담당자 가이드 카드 + DB 다운로드 버튼 |
| v77 | DB 다운로드 버튼 위치 개선 + 담당자 가이드 카드 위치 수정 |
| v78 | region→region2 수정 + 방문일지 중복 기준 복합키 전환 + 관리자 소속 변경 기능 |
| v79 | 관리자 소속 변경 기능 (admin.html + admin-users.js transfer action) |
| v80 | 업로드 시 담당자 유효성 검사 (미등록 담당자 경고) |
| v81 | 데이터 정합성 점검 패널 (9가지 항목 자동 검사) |
| — | **2026-03-17: Recipe RAG 고도화** — api/recipe-recommend.js 신규, proposal.html renderRecipeSignatures → renderRecipeRAG 교체, 견적서 portrait / 레시피 가로 출력 분리, 레시피 30일 캐시 |
| v103 | 내 일정 기능 — 프로필 팝업 > '📅 내 일정' 버튼, 일정 모달(경유지 저장/불러오기), 경유지 패널 날짜 선택 섹션 제거 |
| v104 | 방문일지.html localStorage 24h 캐시 추가 (fs_visitlogs_v_), 수정 저장 시 무효화, upload.html 방문일지 업로드 시 캐시 무효화 |
| v105 | index.html 인허가(fs_licenses_) 캐시 추가, 거래처·방문일지 지도용 캐시 sessionStorage→localStorage 24h, 지오코딩 키 maeil_geo_ 통일, 거래상태 변경 시 캐시 무효화 |
| v106 | upload.html: accounts 업로드 시 fs_accounts_ 캐시 무효화, visit_logs 업로드 시 fs_visitlogs_ (index.html용) 도 함께 무효화 |

---

## 현재 미해결 / 보류 항목

### 코드 품질 (2026-03-13 점검 결과 — 잠재적 버그)

| 항목 | 파일 | 심각도 | 비고 |
|------|------|--------|------|
| ~~`parts` 빈 배열 silent fail~~ | ~~`api/batch-briefings.js`~~ | ~~Medium~~ | **수정 완료** (2026-03-13) thought 필터링 추가 |
| `id` 파라미터 URL 인코딩 누락 | `api/update-visit-log.js` ~line 40 | Low | UUID는 현재 안전, 형식 변경 시 위험 |
| UUID 생성 포맷 오류 | `js/auth.js` ~line 157 | Low | 기능 동작엔 문제없음, 디버깅 불편 |
| CORS `ALLOWED_ORIGINS` 6개 파일 중복 | 여러 API 파일 | 유지보수 | 도메인 변경 시 하나라도 빠뜨리면 CORS 오류 |
| `window._mobToggleProfile` 등 전역 노출 | `js/nav-component.js` | Low | 타 스크립트 충돌 가능 |
| ~~위도 문자열 `'0'` truthy 처리~~ | ~~`index.html` ~line 2816~~ | ~~Low~~ | **수정 완료** (2026-03-13) parseFloat 기준 체크로 변경 |
| 공공 API 조회 중 날짜 변경 시 AbortController 없음 | `index.html` ~line 2861 | Low | 잘못된 결과 표시 가능 |
| 루트 최적화 버튼 스피너 없음 | `index.html` ~line 1975 | Low | OSRM 호출 중 무반응 |

### 기능 개발 보류

| 항목 | 상태 |
|------|------|
| 내 일정 달력 UI — 날짜 먼저 선택 후 경유지 추가하는 방식. 미니 캘린더 표시, 일정 있는 날 점 표시, 날짜 클릭 시 해당 일정 확인 + 현재 경유지 추가. 현재는 경유지 먼저 담고 날짜 선택하는 방식으로 구현됨. | 미구현 (보류) |
| 영업 메모 저장 (`store_memos` 테이블) | SQL 미실행, 코드 미완료 |
| `recipes` `main_products` 빈 항목 8건 | 수동 보완 필요 |
| 수도권FS지역사업부장 멀티지점 뷰 | 보류 |
| N8N + Gemini + Groq Agentic 자동화 | 기획 완료, 미구현 |
| GitHub Actions + Supabase 공공인허가 배치 | 보류 (data.go.kr API 접근 이슈) |
| proposal.html 제품DB Supabase 전환 | products 테이블 미생성, 보류 |
| naver-reviews.js `localSummary` 캐시 히트 시 0 반환 | **수정 완료** (2026-03-11) |
| proposal.html 레시피 매칭 항상 같은 2개 고정 | **수정 완료** (2026-03-10) → **2026-03-17 벡터 RAG + reason 생성으로 완전 교체** |
| 방문일지 방문우선순위 AI JSON 파싱 오류 | **수정 완료** (2026-03-10) |
| Mother Brain 배치 임베딩 자동화 | ✅ batch-briefings.js에 통합 완료 (매일 03:00 KST 자동 실행) |
| search_success_visits SQL 재실행 | ✅ 완료 (유사도 임계값 0.62 버전 적용) |
| recipes 테이블 pdf_url 컬럼 | ✅ supabase_setup.sql 반영 완료 |
| managers.region 컬럼 삭제 | ✅ Supabase 실행 완료 |
| visit_logs 중복 인덱스 교체 | ✅ Supabase 실행 완료 (복합키 버전) |
| ai_briefings RLS 적용 | ✅ Supabase 실행 완료 |
| quotes 한글 중복 정책 삭제 | ✅ Supabase 실행 완료 |
| 방안 3: DB현황 담당자 드롭다운 편집 | 미구현 (보류) |

### store_memos 테이블 SQL (미실행)
```sql
CREATE TABLE store_memos (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  business_unit text NOT NULL,
  store_name text NOT NULL,
  memo text DEFAULT '',
  updated_at timestamptz DEFAULT now(),
  UNIQUE(business_unit, store_name)
);
ALTER TABLE store_memos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "자기 사업부만 접근" ON store_memos
  FOR ALL USING (
    business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
  );
```

---

## 주요 환경변수 (Vercel)

```
GEMINI_API_KEY              Gemini API
SUPABASE_URL                Supabase 프로젝트 URL
SUPABASE_ANON_KEY           anon 키 (Recipe RAG RPC 호출용)
SUPABASE_SERVICE_ROLE_KEY   서비스 롤 키 (generate-briefing, batch-briefings, send-license-alert)
NAVER_CLIENT_ID/SECRET      네이버 검색 API
BREVO_API_KEY               이메일 발송 (Resend → Brevo 교체, 도메인 불필요)
BREVO_FROM_EMAIL            발신자 이메일 (기본값: 2raiwon67@gmail.com)
CRON_SECRET                 Vercel Cron 인증 헤더
PUBLIC_DATA_API_KEY         data.go.kr (미등록 상태)
```

## 주요 외부 서비스

| 서비스 | 용도 | 요금 |
|--------|------|------|
| Supabase Free | DB + Auth + pgvector | $0 |
| Vercel Hobby | API + Cron(2개) | $0 |
| Cloudflare R2 | 레시피 PDF 337개 호스팅 | $0 |
| Naver Search API | 지역검색 + 블로그 | 무료 한도 내 |
| Gemini 2.5 Flash Lite | AI 분석 (gemini.js/generate-briefing.js/batch-briefings.js) | 무료 |
| Gemini 2.5 Flash | 네이버 리뷰 분석 (naver-reviews.js) | 무료 |
| Brevo | 이메일 발송 (인허가 주간 알림) | 일 300건 무료, 도메인 불필요 |

---

## 2026-03-13 오후 작업 (4) — 코드 품질 개선 + UX 안정화

### 전체 코드 점검 (버그 리포트)
- 코드베이스 전수 분석 → 약 30개 잠재적 오류 발견 (심각도별 분류)
- Critical 2건, High 5건, Medium 5건, Low 다수, 아키텍처/보안 포함

### Race Condition 수정 (`index.html`)
- `window.onload`에서 `loadDataFromSheets` / `loadAccountsData` / `loadVisitLogCache` 3개 함수에 `await` 누락
- `Promise.all([...])` 로 묶어 3개 동시 실행 + 완료 대기 (데이터 미로드 상태에서 차트/지도 렌더링 방지)
- **커밋**: `cf48112`

### 이메일 알림 안정성 개선 (`api/send-license-alert.js`)
- `Promise.all` → `Promise.allSettled` 교체: Supabase 한쪽 실패해도 이메일 발송 계속 진행
- 실패 시 `console.error` 로그 추가
- Brevo 응답 필드 `messageId` 우선 체크 (기존 `id`는 항상 undefined)
- **커밋**: `cf48112`

### 데드코드 제거 + 오류 UX 개선 (`index.html`)
- `loadDataFromPublicAPI` 함수 삭제 (~203줄): UI 없는 미사용 함수
- 데이터 로드 실패 시 `showToast` 추가 (기존: 콘솔만 찍고 화면 무반응)
  - 인허가 데이터 / 거래처 데이터 / 방문일지 캐시 로드 실패
- `alert()` 팝업 10개 → `showToast` 전환 (상태변경 실패, 위치권한, 경로 최적화 등)
- **커밋**: `1d4dcde`

### SessionStorage 캐싱 (`index.html`)
- `loadAccountsData`: `fs_accounts_{businessUnit}` 키로 10분 TTL 캐싱
- `loadVisitLogCache`: `fs_visitlogs_{businessUnit}` 키로 10분 TTL 캐싱
- 어드민 모드는 캐시 완전 우회
- `updateAccountStatus` / `updateAccountStatusSheet`: 상태 변경 성공 시 캐시 즉시 무효화
- **커밋**: `fc1d577`

---

## 2026-03-13 오후 작업 (2) — upload.html DB 다운로드 컬럼 밀림 수정 + UX 개선

### 문제: DB 다운로드 시 컬럼 밀림
- **원인**: `downloadCurrentDb()`에서 `templateHeaders`를 `columnMap`으로 매핑 후 `.filter(Boolean)` 적용
  - `licenses`의 'NO'는 `columnMap`에 없어 제거됨 → headers 16개 / colKeys 15개 불일치 → 값이 한 칸씩 밀림
  - 방문일지·주요거래처도 `사업부`, `사업장`, `지점` 등 누락 컬럼 동일 문제
- **수정**: `filter(Boolean)` 제거 → null 유지 → 출력 시 헤더가 'NO'인 경우만 순번(1,2,3...) 채움, 나머지 null 키는 빈칸
- **커밋**: `fa3a1c4`, `f11645c`

### 방문일지 업로드 안내 수정
- NO 컬럼 설명: "중복 방지 기준 — 앱시트 원본 번호 그대로 유지" → "업로드 시 무시됨 — 임의 번호 입력 가능"
- 중복 방지 기준 안내: seq_no → 실제 기준인 **작성일 + 작성자 + 방문처(거래처) 조합**으로 수정
- ② 자주 발생하는 오류: "NO 컬럼 중복" 항목 제거, 중복 조합 건너뜀 동작 설명 추가
- 하단 강조문구: "앱시트에서 엑셀 내보내기 후 그대로 업로드" → "템플릿 컬럼에 맞춰 방문일지의 동일한 컬럼 내용을 채워 업로드"
- **커밋**: `f11645c`, `dfe74c7`

### 선택 행 삭제 UX 개선 — 체크박스 선택 모드
- **변경 전**: 행 클릭 → 핑크 하이라이트 → 삭제 버튼 표시 (수정/삭제 구분 불명확)
- **변경 후**: "선택 행 삭제" 버튼 클릭 → 체크박스 컬럼 등장 → 행 체크 → "삭제 확인(N건)" 클릭
  - 읽기전용 테이블(인허가·방문일지): 행 클릭 선택 방식 제거
  - 편집형 테이블(주요거래처·담당자관리): 행별 🗑️ 버튼 제거, 체크박스 모드로 통일
  - 전체선택 체크박스, 취소 버튼 추가
  - 페이지 이동 / 탭 전환 시 삭제 모드 자동 해제
- **커밋**: `7e85780`

### 편집형 테이블 버튼 정렬 수정
- `db-summary` 내 버튼들을 `margin-left:auto` flex 컨테이너로 묶어 우측 정렬
- **커밋**: `d865a62`

### 인허가 DB현황 편집형 전환 + 버튼 크기 통일 + 전체선택 해제 버그 수정
- `licenses` config: `editable: false → true` → 편집형 테이블로 전환
- `btn-db-action` CSS 클래스 추가, `btn-save-editable`의 `margin-left:auto` 제거 → 모든 버튼 동일 크기·정렬
- `chkAll` / `chkAllEditable` 렌더링 시 `${_allChecked ? 'checked' : ''}` HTML 반영 → 전체선택 해제 시 개별 체크도 함께 해제
- `indeterminate`는 innerHTML 이후 JS DOM 접근으로 별도 처리
- **커밋**: `abd0e2d`

## 2026-03-13 오후 작업 (5) — 버그 수정 + 코드 정리

### AI 브리핑 Thought 파트 필터링 (`api/batch-briefings.js`)
- 기존: `data.candidates?.[0]?.content?.parts?.[0]?.text` — thought 파트가 먼저 오면 thinking 텍스트가 브리핑으로 저장되는 버그
- 수정: `parts.find(p => !p.thought) || parts[0]` — `generate-briefing.js`와 동일한 패턴으로 통일
- **커밋**: `fb9b8ce`

### 위도 `'0'` 문자열 지오코딩 누락 버그 (`index.html`)
- 기존: `!d['위도'] || d['위도'] === 0 || d['위도'] === ''` — 문자열 `'0'`은 세 조건 모두 통과 못해 지오코딩 대상 누락
- 수정: `!parseFloat(d['위도'])` — 숫자 변환 기준으로 체크 (문자열 `'0'`, `''`, `null` 모두 처리)
- **커밋**: `fb9b8ce`

### 미사용 파일 삭제
- `api/naver-crm.js` 삭제 — 어느 HTML에서도 호출하지 않는 미사용 API (**커밋**: `fb9b8ce`)
- `server.js` 삭제 — 로컬 개발용 임시 정적 서버, Vercel+GitHub Pages 환경에서 불필요 (**커밋**: `32c3d10`)

### 대화파일 프로젝트 구조 최신화
- `auth.js` 위치 수정: 루트 → `js/auth.js`
- `common.css` 위치 수정: `js/common.css` → 루트 `common.css`
- 누락 파일 추가: `admin.html`, `login.html`, `confirm.html`, `pending.html`
- 누락 API 추가: `api/admin-all-data.js`, `api/admin-users.js`
- `db/supabase_setup.sql` 추가

---

## 2026-03-14 — AX 설계 + 방문 일정 저장 기능 (v82→v83)

### 오늘 가볼 곳 추천 플로팅 뱃지 (v84→v85)
- 오늘 `visit_plans` 없는 담당자에게만 주황색 플로팅 뱃지 `📍 오늘 추천 N곳` 표시
- 규칙 기반 추천: 방문이력 없음(priority 3) → 60일+ 미방문(2) → 30일+ 미방문(1)
- 우측 슬라이드 패널 — 지도 비차단
- ai_briefings 캐시 첫 줄 재활용, 추가 AI 비용 0원
- 오늘 일정 저장 시 뱃지 자동 미표시 (두 기능 자연 연결)
- **버그 수정**: `computeRecommendations` 미사용 `todayStr` 변수 제거 (v85)
- **커밋**: `2164faa` (v84), `a2df917` (v85)

### AX 설계 논의 핵심 결정사항
- Push(자동 발송) < Pull(on-demand) 방식이 현장에서 더 현실적
- 새 워크플로우 강요하는 기능은 AX가 아님 — 기존 행동에 녹아드는 것이 AX
- 오늘 일정 없는 담당자 → 추천, 있는 담당자 → 추천 불필요 (자연스러운 분기)
- index.html 5585줄 도달 → 추가 기능보다 실사용 검증 우선 판단

### Claude Code 최적화 (이전 세션 완료 항목)
- CLAUDE.md 생성 (프로젝트 루트) — 핵심 규칙, SW 버전, Gemini 모델 기준 등
- Memory 파일 세분화: `project_fs_miso.md`, `user_context.md`, `feedback_dev.md`
- macOS 알림 Hook 설정 (`~/.claude/settings.json`)
- vercel-react-best-practices 재설치 + `.agents/`, `.agent/` 폴더 정리

### AX 방향 논의
- 현재 상태: "DX + AI 부록" — 브리핑 버튼 클릭 후 결과 읽기 수동 패턴
- 진짜 AX 기준: **이미 하는 행동에 AI가 자연스럽게 끼어드는 것**
- batch-briefings 동작 확인: 어제 이후 새 방문일지가 있는 거래처만 처리 (전체 X)
- 레드팀 검토: 장바구니→달력→Outlook 연동은 과잉설계, 마커 클릭 즉시 브리핑이 최고 AX

### 장바구니 방문 일정 저장 기능 구현
**기능 흐름:**
1. 경유지 패널에서 날짜 선택 + 거래처 담기
2. "이날 방문 일정 저장" 클릭 → Supabase `visit_plans` 저장
3. 당일 앱 로드 시 자동 팝업 (하루 1회, sessionStorage 중복 방지)
4. 팝업에 각 거래처 ai_briefings 첫 줄 표시

**주요 결정:**
- localStorage → Supabase 전환 (PC/모바일 크로스 디바이스)
- `UNIQUE(business_unit, manager, visit_date)` — 날짜별 1개, 덮어쓰기
- 저장 시 지난 일정 자동 삭제 (`visit_date < today`)
- 브리핑 전체 → 첫 줄만 표시 (팝업 간소화)
- 추가 AI 비용 0원 (ai_briefings 캐시 재활용)

**Supabase 테이블:**
```sql
CREATE TABLE visit_plans (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    business_unit text,
    manager text,
    visit_date date NOT NULL,
    items jsonb NOT NULL DEFAULT '[]',
    created_at timestamptz DEFAULT now(),
    UNIQUE(business_unit, manager, visit_date)
);
-- RLS: business_unit 기반 격리
```

**커밋:** `573ea14` (v82 localStorage), `f0dc2d5` (v83 Supabase 전환)

---

## 2026-03-17 — 내 일정 UX 개편 (v103)

### 배경
- 경유지 패널 안에 날짜 선택 + 일정 저장이 묻혀있어 복잡하고 불편한 UX
- 오늘 추천 뱃지(📍)와 내가 저장한 일정의 개념 혼용 문제 → 각 역할 명확히 분리

### 두 기능 역할 정리
| 기능 | 조건 | 데이터 출처 |
|------|------|------------|
| 오늘 추천 📍 | 오늘 visit_plans 없을 때만 표시 | 방문이력 기반 규칙 추천 |
| 내 일정 📅 | 항상 접근 가능 (프로필 탭) | 내가 직접 저장한 visit_plans |

### 변경 내용
- **경유지 패널** (`index.html`): 날짜 선택 + "이날 방문 일정 저장" 섹션 완전 제거 → 루트/이동 전용 패널로 단순화
- **프로필 팝업** (`nav-component.js`): '📅 내 일정' 버튼 추가 → `window._openMyPlans()` 호출
- **내 일정 모달** (`index.html`): `window._openMyPlans` 함수 신규 구현
  - 경유지 담겨있으면 상단에 "현재 경유지 저장" 섹션 (날짜 선택 + 저장)
  - 저장된 일정 목록 날짜순 표시, 오늘 일정엔 주황 "오늘" 뱃지
  - "경유지 불러오기" → 해당 날짜 items 전체를 routeCart에 로드 후 루트 패널 오픈
- **common.css**: `.mob-profile-plan-btn` 스타일 추가
- **커밋**: `10e21ee` (v103)

---

## 2026-03-13 오후 작업 (3) — licenses 편집형 undefined 오류 수정

### 문제: 인허가 DB현황 "Cannot read properties of undefined (reading 'map')"
- **원인**: `renderEditableTable()`은 `cfg.columns`를 사용하나, `licenses` config에는 `columns`가 없고 `previewColumns`만 정의되어 있었음
  - 이전 읽기전용 시절에는 `renderReadonlyTable()`이 `previewColumns`를 사용해 문제 없었으나, `editable: true`로 전환 후 편집 경로로 진입하며 `cfg.columns`가 `undefined` → `.map()` 호출 시 에러
- **수정**: `const cols = cfg.columns ?? cfg.previewColumns;` 폴백 추가
- **커밋**: `80372db`
