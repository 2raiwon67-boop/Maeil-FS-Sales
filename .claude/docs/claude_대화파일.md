# Claude 대화 요약 — 경기북부 FS 인허가 대시보드

> 저장소: https://github.com/2raiwon67-boop/Maeil-FS-Sales
> 배포: https://2raiwon67-boop.github.io/Maeil-FS-Sales/

---

## 프로젝트 구조

```
index.html       메인 대시보드 (지도 + 필터 + 마커, ~6000줄)
방문일지.html     방문 기록 관리 + AI 브리핑
proposal.html    견적서 / 매장 맞춤 분석
upload.html      데이터 관리 (업로드 + DB현황 + 공공인허가 조회)
report.html      월별 보고서
admin.html       관리자 페이지 (사용자 관리 + 소속 변경)
login.html / confirm.html / pending.html  인증 흐름
common.css       디자인 토큰 + 공통 컴포넌트 (Toast, Spinner, Skeleton)
js/
  auth.js            Supabase 인증 + BUSINESS_UNITS 목록
  nav-component.js   상단 nav + 모바일 하단 탭바
api/
  gemini.js              Gemini 프록시 — gemini-2.5-flash-lite
  generate-briefing.js   AI 브리핑 온디맨드 — gemini-2.5-flash-lite
  batch-briefings.js     야간 배치 브리핑 + Mother Brain 임베딩 — gemini-2.5-flash-lite
  naver-reviews.js       네이버 검색 + Gemini 분석 — gemini-2.5-flash
  update-visit-log.js    방문일지 인라인 수정 (Service Role Key)
  send-license-alert.js  인허가 주간 알림 (Vercel Cron 월 09:15 KST)
  public-license.js      공공데이터 API 프록시
  admin-all-data.js      관리자 전체 지점 데이터 조회
  admin-users.js         관리자 사용자 관리
  recipe-recommend.js    레시피 RAG 추천 (proposal.html용)
db/supabase_setup.sql    Supabase 테이블/RLS/RPC 정의 (멱등성 보장)
```

---

## 데이터 소스 (전체 Supabase 전환 완료)

| 테이블 | 설명 | 비고 |
|--------|------|------|
| `licenses` | 인허가 데이터 | `business_name` 중복 기준 |
| `accounts` | 주요거래처 | `account_id` 중복 기준 |
| `visit_logs` | 방문일지 | `(business_unit, visit_date, manager, business_name)` 복합키 |
| `managers` | 담당자 설정 | region1(시도), region2(시군구), is_branch_manager |
| `recipes` | 레시피 RAG DB | 337건, pgvector(768차원) |
| `naver_cache` | 네이버 API 240h 캐시 | `store_name` UNIQUE |
| `ai_briefings` | 거래처 AI 브리핑 캐시 | `(account_name, business_unit)` UNIQUE |
| `store_analysis_cache` | 네이버 매장 분석 캐시 | `store_name` UNIQUE |
| `quotes` | 저장된 견적 | |
| `report_cache` | 월별 보고서 AI 분석 캐시 | `(business_unit, report_month, manager_name)` UNIQUE |
| `visit_plans` | 방문 일정 (캘린더) | `(business_unit, manager, visit_date)` UNIQUE |

---

## 개발 이력 요약 (압축)

### 2026-02-27~03-09 (v19~v52)
- Supabase 전환 (Google Sheets 의존성 제거), 디자인 시스템 구축
- 인허가 주간 알림 Cron, 레시피 RAG(337건), 공공인허가 조회 UI
- 경유지 장바구니, 마커 UI 개선, 상태변경 select, 모바일 하단 탭바
- 나만보기 기능, 거래처 바텀시트 거래상태 변경

### 2026-03-10~11 (v53~v75)
- AI 브리핑 온디맨드 전환 (버튼 클릭 시만), Supabase 캐시 7일
- Mother Brain: visit_logs 개척완료/연결완료 임베딩 332건, 야간 배치 자동화
- Gemini 모델 전환 전과정: 2.5-flash → 2.0-flash → 2.5-flash-lite
- Thinking 모델 parts 파싱 버그 수정: `parts.find(p => !p.thought)` 패턴 확립
- TO-DO AI 기능 삭제, send-todo-alert.js 삭제 (Cron 슬롯 확보)
- Brevo 이메일 교체 (Resend → 도메인 없이 발송 가능)
- 방문일지 인라인 수정 API (update-visit-log.js), RAG 유사도 임계값 0.62
- AI 브리핑 UI 라이트 테마 + ①②③④ 구조화 렌더링

### 2026-03-13 (v76~v81)
- 인허가 알림 이메일 business_unit별 분리 발송
- managers 테이블 region1/region2 컬럼 추가, 지역 칩 동적 로드
- 관리자 소속 변경(인사발령) 기능, 업로드 담당자 유효성 검사
- 데이터 정합성 점검 패널 (9가지 자동 검사)
- Race Condition 수정: `Promise.all([loadDataFromSheets(), loadAccountsData(), loadVisitLogCache()])`
- SessionStorage → localStorage 캐시 전환, 캐시 무효화 체계 구축
- alert() 10개 → showToast 일괄 교체

### 2026-03-14 (v82~v85)
- 방문 일정 저장 기능: localStorage → Supabase visit_plans 전환 (크로스 디바이스)
- 오늘 가볼 곳 추천 플로팅 뱃지 (방문이력 기반 규칙 추천, ai_briefings 캐시 재활용)
- CLAUDE.md 생성, Memory 세분화, macOS 알림 Hook 설정

### 2026-03-16 (v86~v102)
- 방문일지 업로드 unique constraint 3단계 해결 (normalizeToYMD 날짜 정규화)
- 방문일지 업로드 409 폴백: 충돌 시 행별 개별 INSERT 재시도
- report.html: 월 선택 pill→드롭다운, 담당자 필터, AI 분석 Supabase 캐시 4개월
- 담당자 드롭다운 지점장 제외 (region2='지점장' OR is_branch_manager)
- proposal.html: search_recipes RPC pdf_url 누락 수정, 레시피 카드 클릭 불가 해결
- 사이드바 탭 3개 (전체/인허가/주요거래처) + 1회 생성 마커 패턴
- 필터 변수 전체 Set 전환 (다중 선택 지원)
- UI 일관성: 모바일 높이 수정, 미디어쿼리 768px 통일, body margin 통일

### 2026-03-17 (v103~v116)
- 내 일정 UX 개편: 경유지 패널 날짜 섹션 제거 → 프로필 팝업 '내 일정' 버튼
- Recipe RAG 고도화: api/recipe-recommend.js 신규, 벡터 RAG + reason 생성, 30일 캐시
- PC 프로필 드롭다운 + 설정 모달 + 색각 보정 모드 (초록→청록, 빨강→마젠타)
- 사이드 필터 기본 접힘, 색각 보정 필터 색상 연동
- 캐시 TTL: 인허가·거래처 12h / 방문일지 24h / 지오코딩 영구
- 코드 점검: alert() 교체, report_cache await 수정

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

### 필터 변수 (모두 Set)
```javascript
currentManager          // 담당자 필터
currentRegion           // 지역 필터
currentMilkFilter       // 사용우유 필터
window.currentDealStatusFilter
currentFilter           // 순위 필터 ('all'|'1'|'2')
currentAccountFilter
mobileVisibleLayers / mobileStarLayers
myManagerName           // 로그인 사용자 담당자명 (지점장=null)
isMyTargetOnly
```

### Recipe RAG 흐름
```
[백엔드 — naver-reviews.js]
매장명 + 블로그 제목 → Gemini embedding-001(768차원)
    → search_recipes RPC → Gemini 분석 프롬프트 주입

[프론트 — proposal.html → api/recipe-recommend.js]
tags + signatureMenus + 추천제품명 + 계절 → Gemini embedding
    → search_recipes(match_count=2) → reason(25자) 생성
    → 카드 표시 (이름 + 카테고리 + reason + PDF 보기)
    캐시: localStorage recipe_cache_${storeName} 30일
```

### 공통 헬퍼
```javascript
showToast(msg, type, duration)  // 'success'|'error'|'warning'
isMobile()                      // window.innerWidth <= 768
getBusinessUnitForIndex()       // business_unit 캐시
```

---

## 캐시 구조

| 키 | 저장소 | TTL | 무효화 시점 |
|---|---|---|---|
| `fs_licenses_${bu}` | localStorage | 12h | 거래상태/사용우유 변경, licenses 업로드/삭제 |
| `fs_accounts_${bu}` | localStorage | 12h | 거래상태 변경, accounts 업로드/삭제 |
| `fs_visitlogs_${bu}` | localStorage | 24h | visit_logs 업로드/삭제 (index.html 지도용) |
| `fs_visitlogs_v_${bu}` | localStorage | 24h | 수정 저장, visit_logs 업로드/삭제 (방문일지.html용) |
| `maeil_geo_${address}` | localStorage | 영구 | 없음 (주소 변경 시 수동 삭제 필요) |

- accounts에 `_lat`/`_lng` 포함 저장 → 재진입 시 지오코딩 루프 건너뜀
- 지오코딩: 5개씩 병렬 처리 (`Promise.all` 배치, Naver Maps JS SDK)

---

## SW 캐시 버전 히스토리

| 버전 | 내용 |
|------|------|
| v19 | Supabase 전환 |
| v29 | 경유지 장바구니, proposal + upload 개선 |
| v38 | 레시피 연계 추천, PDF 뷰어 |
| v48 | #map touch-action:none (마커 터치 수신) |
| v51 | 장바구니 담긴 마커 보라색 표시 |
| v52 | 모바일 내 타겟만 보기 기능 |
| v61 | proposal 레시피 매칭 개선 + 랜덤 폴백 |
| v63 | AI 브리핑 온디맨드 전환 |
| v64 | Mother Brain 구현 |
| v65 | Mother Brain 고도화 (연결완료 포함, 배치 자동화) |
| v67 | 방문일지 TO-DO AI 기능 완전 삭제 |
| v71 | Gemini 모델 전환 → 2.5-flash-lite |
| v74 | AI 브리핑 UI 라이트 테마 + ①②③ 구조화 렌더링 |
| v75 | 방문일지 인라인 수정 + RAG 유사도 임계값 0.62 |
| v76 | 인허가 알림 이메일 business_unit 분리 |
| v78 | region→region2 수정 + 방문일지 중복 복합키 |
| v81 | 데이터 정합성 점검 패널 |
| v82 | 장바구니 방문 일정 저장 (localStorage) |
| v83 | visit_plans → Supabase 전환 |
| v84 | 오늘 가볼 곳 추천 플로팅 뱃지 |
| v86 | 방문일지 업로드 normalizeToYMD 날짜 정규화 |
| v103 | 내 일정 모달 (경유지 저장/불러오기) |
| v105 | 전체 localStorage 캐시 체계 구축 |
| v107 | accountsData _lat/_lng 포함 저장 → 지오코딩 건너뜀 |
| v109 | PC 프로필 드롭다운 + 설정 모달 + 색각 보정 |
| v110 | 사이드 필터 개선 + 색각 보정 연동 |
| v111 | 방문일지 업로드 409 폴백 (행별 개별 INSERT) |
| v112~114 | report.html 월/담당자 필터 + AI 캐시 |
| v115 | proposal 레시피 카드 클릭 불가 수정 |
| v116 | 코드 점검: alert()→showToast, await 수정 |
| v117 | 내 일정 캘린더 UI (달력 뷰, 플로팅 뱃지, 과거 일정 자동 삭제) |
| v118 | 주요거래처 geocoding 5개씩 병렬 처리 (최대 5배 속도) |
| v119 | 견적서 저장 개선 (메모 필드, 저장 피드백, 덮어쓰기/복사 선택, 수정일 정렬) |
| v120 | AI 브리핑 구조화 응답 + 컴팩트 UI (형식 불일치·공간 과점유 해결) |
| v121 | 지도 현재위치 과녁 버튼 추가 — 지도 이동 + 동선최적화 출발지 자동 설정 |

---

## 현재 미해결 / 보류 항목

### 코드 품질 (잔존 Low)

| 항목 | 파일 | 비고 |
|------|------|------|
| `id` 파라미터 URL 인코딩 누락 | `api/update-visit-log.js` ~line 40 | UUID는 현재 안전 |
| UUID 생성 포맷 오류 | `js/auth.js` ~line 157 | 기능 동작엔 문제없음 |
| CORS `ALLOWED_ORIGINS` 6개 파일 중복 | 여러 API 파일 | 도메인 변경 시 위험 |
| 공공 API 조회 중 AbortController 없음 | `index.html` | 날짜 변경 시 잘못된 결과 가능 |
| 루트 최적화 버튼 스피너 없음 | `index.html` ~line 1975 | OSRM 호출 중 무반응 |

### 기능 개발 보류

| 항목 | 상태 |
|------|------|
| 영업 메모 저장 (`store_memos`) | SQL 미실행, 코드 미완료 |
| 마커 클릭 즉시 브리핑 | 미구현 (AX 효과 높음) |
| 수도권FS지역사업부장 멀티지점 뷰 | 감시 도구 우려로 보류 |
| N8N + Gemini + Groq Agentic 자동화 | 기획 완료, 미구현 |
| GitHub Actions + 공공인허가 자동 배치 | data.go.kr API 접근 이슈 |
| 내 일정 달력 UI 고도화 (달력에서 날짜 먼저 선택) | ✅ v117에서 구현 완료 |
| managers region1/region2 기존 24개 행 수동 입력 | ✅ 완료 (2026-03-18) |

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
SUPABASE_ANON_KEY           anon 키
SUPABASE_SERVICE_ROLE_KEY   서비스 롤 키
NAVER_CLIENT_ID/SECRET      네이버 검색 API
BREVO_API_KEY               이메일 발송 (도메인 불필요, 일 300건 무료)
BREVO_FROM_EMAIL            발신자 이메일 (기본값: 2raiwon67@gmail.com)
CRON_SECRET                 Vercel Cron 인증 헤더
ADMIN_CODE                  관리자 API 인증 (= 532753)
```

## 주요 외부 서비스

| 서비스 | 용도 | 요금 |
|--------|------|------|
| Supabase Free | DB + Auth + pgvector | $0 |
| Vercel Hobby | API + Cron(2개 한도) | $0 |
| Cloudflare R2 | 레시피 PDF 337개 호스팅 | $0 |
| Naver Maps JS SDK | 지도 + geocoding | 무료 한도 내 |
| Naver Search API | 지역검색 + 블로그 | 무료 한도 내 |
| Gemini 2.5 Flash Lite | AI 분석 (브리핑/배치) | 무료 |
| Gemini 2.5 Flash | 네이버 리뷰 분석 | 무료 |
| Brevo | 이메일 발송 | 일 300건 무료 |

---

## 주요 설계 결정 & 교훈

### DB 스키마
- `visit_logs_natural_uq`: 부분 인덱스(WHERE절) → PostgREST ON CONFLICT 사용 불가
- `managers.region` 컬럼 삭제됨 → `region1`(시도), `region2`(시군구) 사용
- `business_unit` NULL 처리: `?? null` 사용 (`|| ''` 아님)
- 지점장: `region2='지점장'` or `is_branch_manager=true` → `myManagerName=null`

### 이메일
- Brevo API (`BREVO_API_KEY`, `BREVO_FROM_EMAIL`)
- 응답 성공 필드: `messageId` (`id` 아님)
- Resend는 본인 이메일만 발송 가능 → 교체됨

### Gemini
- 일반: `gemini-2.5-flash-lite` / 복잡한 분석: `gemini-2.5-flash`
- Thinking 모델 parts 파싱: `parts.find(p => !p.thought) || parts[0]`
- JSON 응답: `responseMimeType: 'application/json'` + `responseSchema` 필수

### Vercel Cron (Hobby — 2개 한도)
1. `send-license-alert` — `15 0 * * 1` (월 09:15 KST)
2. `batch-briefings` — `0 18 * * *` (매일 03:00 KST)

### AX 원칙
- 진짜 AX: "이미 하는 행동에 AI가 끼어드는 것". 새 워크플로우 강요 = AX 아님
- Push < Pull. 복잡한 연동보다 기존 흐름 삽입

---

## 2026-03-18 — 내 일정 캘린더 UI (v117) + geocoding 병렬화 (v118)

### 내 일정 캘린더 UI (v117, be30bb2, f02a888)

- 내 일정 모달: 리스트 뷰 → 미니 캘린더로 전면 교체
  - `_buildCalendarHtml`: 7열 그리드, 이번달/다음달 이동 (`‹ ›`)
  - 일정 있는 날 보라색 점(●), 오늘 파란 원, 선택 날 검정 원
  - 과거 날짜 클릭 → "이전 날짜는 계획 수립이 불가합니다" warning 토스트
- `_buildPlanDetailHtml`: 날짜 클릭 시 하단 상세 패널
  - 일정 없는 날: "이 날 일정 만들기" 버튼 → `_startPlanMode`
  - 일정 있는 날: 경유지 목록 + [경유지 불러오기 + 동선 최적화] / [삭제]
- `_startPlanMode(dateStr)`: 우측 상단 플로팅 뱃지 (`top:60px right:12px`)
  - "📅 3월 25일 | [완료] [✕]" → 완료 클릭 시 saveVisitPlan → _cancelPlanMode → clearCart
- `showVisitPlanPopup` "시작하기" → 경유지 자동 로드 + 루트 패널 오픈
- 모달 열 때 과거 일정 Supabase DB에서 자동 삭제
- 코드 점검 수정: JSON.stringify onclick 취약점 → `_loadPlanDatePlan(dateStr)` / `window._todayPlanItems` 참조 방식, 지점장 null early return, `_calNav` 경계 체크 강화, `db/supabase_setup.sql` visit_plans 추가 ✅ Supabase 실행 완료

### geocoding 병렬화 (v118, 1a8ab60)

- `initAccountMarkers` 3단계 분리:
  - Phase 1: 좌표 분류 (이미 있음 skip / localStorage 히트 즉시 반영 / 없는 것 수집)
  - Phase 2: `Promise.all` 5개씩 병렬 geocoding (Naver Maps JS SDK)
  - Phase 3: 좌표 확보된 계정만 마커 생성 (기존 로직 동일)
- 100건 기준: 100회 순차 대기 → 20회 배치 대기 (최대 5배 속도)
- 2회차 이후: 캐시 즉시 반환으로 차이 없음

---

## 2026-03-18 — 이메일 개선 + 견적서 저장 개선 (v119)

### 인허가 알림 이메일 개선 (c51a046)

- 오늘의 추천 동선 섹션 제거 (`optimizeRoute`, `calculateDistance`, `buildNaverRouteUrl` 삭제)
- 푸터 "경기북부 FS 영업팀" → "FS MISO" 변경 (지역 한정 표현 제거)
- 이메일 구조: 인사말 → 신규 대상(D+14) → 재확인 대상(D+28) → 푸터

### 견적서 저장 개선 (v119, df8fb6e)

- **메모 필드** 추가 (`edit-quoteMemo`): 거래처명 아래, 버전 구분용 (초안/최종확정/2차방문)
- **저장 버튼 피드백**: 클릭 시 disabled + "⏳ 저장 중..." → 완료 후 복원 + 성공 토스트
- **저장 방식 선택 다이얼로그** (`_showSaveChoiceDialog`): 불러온 견적 수정 저장 시
  - "덮어쓰기 (현재 버전 갱신)" / "새 견적으로 저장 (복사본 생성)" / 취소
  - forceNew=true 시 `_loadedQuoteId` 초기화 후 INSERT
- **목록 개선**: `updated_at` 기준 내림차순 정렬, 메모 파란 뱃지 표시, "수정 N일" 표기
- **DB**: `quotes` 테이블 `memo TEXT`, `updated_at TIMESTAMPTZ` 컬럼 추가
  - `ALTER TABLE quotes ADD COLUMN IF NOT EXISTS` (멱등성) ✅ Supabase 실행 완료

### AI 브리핑 구조화 응답 + 컴팩트 UI (v120, c2e26dc)

- **문제**: responseSchema가 `{briefing: string}`이라 Gemini가 형식을 제멋대로 씀 → ①②③④ 불일치, ④ 생략 시 파싱 실패, 블록 UI 공간 과점유
- **generate-briefing.js**:
  - responseSchema → `{keyman, hurdles, approach, product}` 구조화
  - product 없으면 빈 문자열 (생략 오류 제거)
  - `briefing = JSON.stringify(structured)` 으로 Supabase 저장
- **방문일지.html** `formatBriefingText`:
  - JSON 파싱 우선 → 구조화 렌더링
  - 구버전 텍스트(①②③④) 폴백 유지 (기존 캐시 7일 후 자동 전환)
  - UI: 블록 → 인라인 행 형식 (`briefing-row`: 아이콘 + 라벨 + 내용)
  - product 빈 문자열이면 행 숨김
