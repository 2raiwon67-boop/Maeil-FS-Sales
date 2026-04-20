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
login.html / pending.html  인증 흐름 (confirm.html 삭제 — 이메일 인증 미사용)
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
  send-license-alert.js  인허가 알림 + 공사중 오픈 감지 (Vercel Cron 월~금 09:15 KST)
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

### 2026-04-20 (버그픽스, 버전 무관)
- **서울 등 광역시 공공인허가 조회 불가 버그 수정** (`api/public-license.js`)
  - **원인**: 공공 API가 주소를 약칭으로 저장 (`서울특별시` → `서울`, `인천광역시` → `인천`)하는데 managers 테이블은 정식명으로 저장 → LIKE 쿼리·지역 필터 모두 불일치로 결과 0건
  - 경기도는 API도 정식명(`경기도`) 그대로 → 과천시만 되던 이유
  - **fix 1**: `SIDO_SHORT` 맵 추가 — `fetchAllForType`에서 시도명을 API 약칭으로 변환 후 LIKE 쿼리 전송
  - **fix 2**: `applyBusinessLogic`에서 정식명·약칭 두 가지 변형(`regionVariants`)으로 양쪽 매칭
  - **fix 3**: managers에 `서울시`, `서울특별시`, `서울` 등 어떻게 입력해도 모두 정규화되도록 SIDO_SHORT 확장

### 2026-04-20 (v157~v163)

#### v157 — 상권 분석 Supabase 연동 + 라이트 UI
- discover.html: 팔란티어 다크 → 흰색/슬레이트 라이트 테마, CartoDB Positron 맵
- Supabase `market_snapshots` 테이블 신규 (sido, sigungu, month, new_count, closed_count, UNIQUE 복합키)
- 공공 API 실시간 호출 제거 → Supabase 읽기 (1초 이내 로딩)
- managers.region2(시군구) 기준 필터 → 본인 지점 담당 시군구만 표시 (횡성군 오표시 해결)
- api/market-stats.js: general_restaurants 3번째 엔드포인트 추가, EXCLUDE_KEYWORDS+TARGET_CATEGORIES 블랙리스트 통합, ?save=true upsert 지원
- api/market-backfill.js: 2025-01부터 현재까지 일회성 백필 엔드포인트 신규

#### v158 — market-stats.js 핵심 버그 2건 수정
- **saveToSupabase 저장 실패 수정**: Supabase REST upsert는 `?on_conflict=sido,sigungu,month` 쿼리 파라미터가 없으면 HTTP 409 반환 → URL에 추가 (기존 Prefer 헤더만으로는 부족)
- **sido LIKE 오염 수정**: 공공 API `cond[LOTNO_ADDR::LIKE]='인천'` 쿼리가 '강원도 횡성군 인천리' 같은 무관 주소에도 매칭됨 → `extract()` 함수에 시도 검증 추가 (`tokens[0]` 정규화 후 expectedSido 비교, 불일치 시 빈 값 반환)
- 시군구 오염 데이터 Supabase에서 직접 삭제 (MCP SQL)

#### v159 — 지역 선택 + 월별 비교 기능
- CENTROIDS 전국 ~250 시군구로 확장 (`'시도_시군구'` 복합 키로 동명 구 완전 분리)
- SIDO_NORM 정규화 맵 추가 (managers.region1 다양한 형식 대응)
- 다중 시도 지원: `sidoSigunguMap {sido:[sigungu]}` + `sigunguSidoMap {sigungu:sido}` 구조로 경기북부(경기도+인천) 같은 복수 시도 지점 대응
- 지역 칩: "내 지점" (기본) + market_snapshots 기준 sido 칩 동적 생성
- 월 네비게이터: ‹ [월] › + "전체 보기" 초기화
- 비교 strip: 월 선택 시 전년동월 | 전월 | 당월 3열 표시 (신규·폐업·순증 + 전월 대비 delta)
- `cachedSnaps` 패턴: 데이터 1회 로드 후 클라이언트 필터링 (재요청 없음)
- 차트 하이라이트: 당월(진함) / 전월·전년동월(중간) / 나머지(흐림) 막대 색상 배열

#### v160 — discover.html 완전 재설계 (미니멀 전문 디자인)
- CSS 전면 재작성: 컴팩트 헤더, KPI 좌측 컬러 바, 툴바 1줄 통합, 비교 strip 블루 배경
- **버그 수정**: sido 모드 지도 중심 `viewSido` 기준으로 수정 (기존 경기도 고정 오류)
- **버그 수정**: branch ↔ sido 전환 시 `sigunguSidoMap` managers 데이터로 리셋 (sido 오염 방지)
- 오류 처리 강화: Supabase 연결 실패 / 데이터 오류 시 UI 메시지 표시
- discover.html STATIC_ASSETS에 추가

#### v161 — 페이지 투명 버그 수정 (긴급)
- **원인**: `common.css body { opacity: 0 }` → `body.loaded { opacity: 1 }` 패턴인데, discover.html만 `document.body.classList.add('loaded')` 누락 → 페이지 전체 투명 (아무것도 안 보임)
- DOMContentLoaded 시점에 `body.loaded` 추가로 해결

#### v162 — 코드 오류 3건 수정
- `setupLogoutButton()` 호출 추가 → 우상단 사용자명·로그아웃 버튼 표시
- `map.invalidateSize()` 추가 → 비교 strip 토글 시 Leaflet 지도 타일 공백 방지
- `netRate` 수정: 신규 0건·폐업 있을 때 -100% 표시 (기존 0% 오기재)
- `loadDashboard(force)` 미사용 파라미터 제거

#### v163 — UX·가시성 전면 개선
- 폰트 크기: 9~11px → 11~14px 전체 상향
- KPI 숫자: 22px → 28px, 여백 11px → 14px
- 헤더: 46px → 52px, 새로고침 버튼 텍스트 "↺ 새로고침" 추가
- 툴바: 36px → 46px, 지역 칩 22px → 30px, 월 화살표 20px → 28px
- 비교 strip: 숫자 15px → 18px, 여백 9px → 12px
- 사이드바: 252px → 272px, 행 폰트·여백 전반 상향
- 차트: 185px → 200px, 범례·축 폰트 10px → 12px
- 차트 툴팁 제목/본문 폰트 13px 명시
- 지도 팝업: 12px → 13px, 범례 도트 8px → 10px

### 2026-04-20 (v164~v166)

#### v164 — discover.html Apple 디자인 시스템 통일
- `:root` CSS 토큰을 common.css 기준으로 통일 (--color-primary #0071e3 등)
- KPI 카드: 상단 3px 컬러 보더 + hover lift 효과, border-top-color 계열별 구분
- 툴바: white card 스타일, margin 12px, border-radius 적용
- 새로고침 버튼, 칩, 화살표 전부 common.css hover 패턴 적용

#### v165 — 드릴다운 + GeoJSON 폴리곤 지도 전환
- **사이드바 드릴다운**: #sbListView / #sbDrillView 전환 구조, 탭(전체/신규/폐업/100평+)
- **GeoJSON 코로플레스**: Leaflet + southkorea-maps GeoJSON으로 시군구 경계 폴리곤 색상 렌더링
  - 순증 > 2 → 초록, 순감 < -2 → 빨강, 보합 → 회색, 미보유 시군구 → 연회색
  - 호버: 테두리 파란색 + 툴팁(신규/폐업/순증), 클릭: 드릴다운 진입
- **market_store_records 테이블**: Supabase에 MCP로 직접 생성 (sido, sigungu, month, name, category, area_m2, pyeong, address, status, license_date)
- **market-stats.js `?detail=true` 모드**: 기존 집계와 별개로 개별 매장 records 반환 (market-detail.js 신규 파일 없이 통합 — Vercel 12파일 한도)
- **market-stats.js storeRecords 수집**: `tally()` 함수에서 매장명·업종·면적·주소 추출, saveToSupabase()에서 100건 배치 upsert
- **batch-briefings.js 파이프라인 확인**: 이미 매일 새벽 3시 market-stats?save=true 호출 → market_store_records 자동 누적 (upload.html 의존 없음)
- **차트 접기/펼치기**: toggleChart() + map.invalidateSize() 재계산

#### v166 — 지도 Leaflet → 카카오맵 전환
- Leaflet.js 완전 제거, 카카오맵 JavaScript SDK 적용 (appkey: 178d3ee35f67ded1f5d2411aa3cee010)
- GeoJSON 경계 데이터를 kakao.maps.Polygon으로 변환하여 시군구별 코로플레스 렌더링
- 마우스 호버: kakao.maps.CustomOverlay 툴팁 (시군구 centroid 기준 위치)
- 클릭: 드릴다운 진입 유지
- kakao.maps.load(autoload=false) + mapReady 플래그로 비동기 init race condition 방지
- SIDO_CENTER zoom → Kakao level로 전환 (경기도 level:9, 광역시 level:7 등)
- map.invalidateSize() → map.relayout() 전환

### 2026-04-16 (v155 → v156)
- **discover.html 전면 재설계**: 카카오 로컬 API 검색 → 팔란티어 스타일 상권 인텔리전스 대시보드로 교체 (v155 초안 → v156 완성)
  - 데이터 소스: **공공인허가 API 실시간** (Supabase licenses 테이블 아님 — 시장 전체 규모 파악 목적)
  - 폐업 데이터는 discover.html에서만 사용, DB 저장 안 함
  - `api/market-stats.js` 신규 생성: GET /api/market-stats?sido=경기도&months=12
    - `rest_cafes` + `bakeries` 두 엔드포인트 병렬 조회
    - 신규: `LCPMT_YMD` + `SALS_STTS_CD::EQ=01` / 폐업: `CLSBIZ_YMD`
    - 시군구×월 집계 → `{ summary, monthly:[{month,new,closed,net}], regions:[...] }` 반환
  - Leaflet + CartoDB 다크 타일 지도, 경기도(31)·서울(25)·인천(9) CENTROIDS 하드코딩
  - 버블맵: 크기=신규오픈 건수(6~30px), 색상=순증가(초록)/순감소(빨강)/중립(회색)
  - KPI 스트립: 신규오픈(초록), 폐업(빨강), 순증가(파랑), 성장률%(노랑)
  - 우측 패널: 시군구 순위 리스트 (신규↓ 정렬)
  - 하단 Chart.js 막대+선 복합 차트: 신규/폐업/순증 12개월 트렌드
  - 시도 칩 선택: managers 테이블 region1 기준 지점별 자동 감지 (경기도/서울/인천)
  - localStorage 6h 캐시 (`discover_${sido}_${months}` 키)
- **블랙리스트 확장** (`api/public-license.js`): 곱창, 닭, 이자카야, 라멘, 라면, 우동, 스시, 카츠, 돈까스, 야끼 추가 (기존: 초밥, 숯불)

### 2026-04-11 (v149~v154)
- **discover.html 매장 검색 탭**: 카카오 로컬 API + 엑셀 다운로드, XSS 수정, 렌더 블로킹 수정
- **공공인허가 API 신규 스키마 대응**: 2026-03-23 이후 API 필드명 변경 대응
- **공공인허가 지역 칩 개선**: 중복 시군구명 오필터 해결, 지점장 제외, region3 지원, 담당자 자동 매핑
- **공공인허가 API 성능 개선**: 지역별 개별 요청 → 시도별 묶음 쿼리로 요청 수 최소화
- **주소 분리 로직 일반화**: 고양시 하드코딩 제거, 모든 시에 일반 적용
- **RAW 전처리 경고 보강 (v152)**: 레이스 방지, 미매핑 경고, 조회 담당자 컬럼 추가
- **upload.html 섹션 순서 변경**: DB 현황 → 공공인허가 조회 순서를 공공인허가 조회 → DB 현황으로 변경 (조회→확인 흐름)
- **RAW 전처리 카드 제거 (v153)**: 수동 파일 다운로드 → 전처리 → 업로드 3단계 워크플로우 삭제. 모든 필터 로직은 `api/public-license.js`의 `applyBusinessLogic()`에 이미 통합되어 있어 완전 대체 가능
- **공공인허가 2000건 상한 경고 (v154)**: 시도×업종당 최대 2000건 제한, 초과 시 결과 테이블 상단에 경고 배너 표시 (`truncated` 응답 필드 추가)
  - 일주일 단위 조회 시 실질적 위험 없음; 장기 조회 시 안내 목적

### 2026-04-01
- **공사중 거래처 오픈 감지 자동화**:
  - `licenses.open_detected_at` 컬럼 추가 (Supabase migration)
  - Vercel Cron 스케줄 월요일 → 월~금 매일 09:15 KST 변경
  - 화~금: 공사중 전체 네이버 지역 검색 API 폴링 → 새로 감지된 매장만 담당자 이메일
  - 월요일: 기존 D+14/D+28 알림 유지 + 오픈예상 뱃지(초록) 표시 + 검색결과 버튼
  - 지점장은 오픈예상 미표시 (공사중 그대로) — 불필요한 잡도리 방지
  - `open_detected_at` 저장으로 중복 알림 방지; trade_status 변경 시 자동 제외
  - 오픈 감지 후 담당자 미업데이트 시 → 월요일 섹션2에 계속 오픈예상 리마인드
  - 네이버 검색 5개씩 배치 처리 (300ms 간격), PATCH Promise.allSettled로 부분 실패 방지
  - 이메일 스타일 상수 모듈 레벨 추출, 6-B 그룹핑 로직 unitManagers 재사용

### 2026-03-25 (v133~v148)
- **성능 개선**: 미사용 XLSX 라이브러리 제거 → FCP 4.9s→3.3s (Lighthouse 53→58점)
- **렌더 블로킹 해소**: chart.js·supabase-js·auth.js 전부 `defer` 처리
- **영업동선 UX 전면 개편**: 루트→동선, 경유지→담아두기, 동선최적화→지금 출발, 네이버지도 연결
- **모바일 바텀시트**: 상태버튼/메모버튼 컴팩트화, 네비 버튼 확대 (핵심 액션 우선)
- **담아두기 토글**: 이미 담긴 경유지 재클릭 시 제거 (장바구니 패널 불필요한 이동 제거)
- **InfoWindow 초기 상태**: 3개 진입점(인허가 IW, 거래처 IW, 바텀시트) 모두 담김 여부 반영
- **패널 연동**: 루트 패널/추천 패널 열릴 때 InfoWindow 자동 닫기; 지도 클릭 시 추천 패널 닫기
- **방문 추천 시스템 전면 개편**:
  - 데이터 소스: licenses(allData) → accounts(accountsData), 내 담당 거래처만
  - 수량: 5→3개
  - 거리 필터: 1순위 거래처 앵커 기준 20km 이내
  - 좌표: accountMarkers._lat/_lng 에서 조회 (지오코딩 추가 없음)
  - 클릭 토글: `toggleRecItem(idx)` — 패널 항목 클릭으로 담기/취소, 상태 즉시 반영
  - 전부 담기 버튼 유지
  - 뱃지: "오늘 추천 N곳" → "방문 추천" (숫자 제거)
- **날짜 유지**: `_savedVisitPlanDate` 변수 — 루트 패널 닫아도 날짜 유지
- **바텀시트 id 유일성**: `sheetCartBtn_${sheetMemoUid}` (기존 단일 id 버그 수정)
- 코드 점검: 버그 4개 수정 (id 중복, 데이터 소스 불일치 등)

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
| v121 | 지도 현재위치 과녁 버튼 추가 — 지도 이동 + 동선최적화 출발지 자동 설정, 동그라미 모양, 플로팅 버튼 위 배치 |
| v133 | 색각 보정 모드 즉시 적용 (새로고침 없이 CSS 변수 교체) |
| v134 | 미사용 XLSX 라이브러리 제거 (FCP 4.9s → 3.3s) |
| v135 | chart.js·supabase-js·auth.js defer 처리 (렌더 블로킹 해소) |
| v136 | 루트 버튼 텍스트 개선 + 방문 날짜 패널 재진입 시 유지 |
| v137 | 영업동선 텍스트 통일 (루트→동선, 경유지→담아두기, 동선최적화→지금 출발) |
| v138 | 모바일 바텀시트 상태버튼·메모버튼 컴팩트, 네비 버튼 확대 |
| v139 | 루트 패널 열릴 때 InfoWindow 자동 닫기 |
| v140 | 담아두기 토글: 이미 담긴 경유지 재클릭 시 제거 |
| v141 | 방문 추천 패널 전부 담기 버튼 추가 |
| v142 | addAllRecsToCart 이름 비교 trim 통일 + 토스트 정확도 개선 |
| v143 | 추천 3개로 축소, 현재위치 기준 20km 거리 필터 |
| v144 | 추천 대상 licenses→accountsData 전환, 1순위 기준 20km 앵커 필터 |
| v145 | 추천 패널 항목 클릭으로 담기/취소 토글, 뱃지 텍스트 "방문 추천" |
| v146 | 코드 점검 — 버그 4개 수정 (addAllRecsToCart·id 중복 등) |
| v147 | 지도 클릭 시 방문 추천 패널 자동 닫기 |
| v148 | 방문 추천 패널 열릴 때 InfoWindow 자동 닫기 |
| v149~154 | discover.html 카카오 검색 탭 기능 개선, 공공인허가 API 필드명·성능·경고 배너 |
| v155 | discover.html 팔란티어 스타일 상권 인텔리전스 대시보드 전면 재설계 (Leaflet·Chart.js·인구데이터) |
| v156 | discover.html 공공인허가 API 실시간 상권 인텔리전스 대시보드 완성 + api/market-stats.js 신규 |
| v157 | discover.html Supabase market_snapshots 연동, 라이트 테마, market-backfill.js 신규 |
| v158 | market-stats.js saveToSupabase ?on_conflict 수정 + sido LIKE 오염 수정 |
| v159 | discover.html 전국 CENTROIDS 확장, 다중 시도 지원, 지역 칩·월 네비게이터·비교 strip |
| v160 | discover.html 완전 재설계 (미니멀 전문 디자인), sido 지도 중심 수정, branch 모드 sigunguSidoMap 리셋 |
| v161 | discover.html body.loaded 누락으로 페이지 투명 버그 긴급 수정 |
| v162 | discover.html setupLogoutButton 추가, map.invalidateSize 추가, netRate -100% 수정 |
| v163 | discover.html UX 전면 개선 (폰트·여백·컴포넌트 크기 전반 상향) |

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

### AX 로드맵 (2026-04-11 기획)

| 순위 | 항목 | 핵심 | 상태 |
|------|------|------|------|
| 1 | **영업 코파일럿 챗봇** | FAB + 채팅 패널, Mother Brain·브리핑·방문일지·리뷰 조합 답변. 방문일지.html → index.html 확장 | 미구현 |
| 2 | **1분 브리핑 카드** | 기존 ai_briefings → 구조화 카드 UI (핵심상태/지난약속/제안포인트/주의). 장바구니 스와이프. 비용 0 | 미구현 |
| 3 | **마커 클릭 즉시 브리핑** | 마커 탭 → 바텀시트에 ai_briefings 캐시 즉시 표시. 캐시 미스면 버튼만. 비용 0 | 미구현 |

> AX 원칙: "이미 하는 행동에 AI가 끼어드는 것" — 새 워크플로우 강요 금지

### 기능 개발 보류

| 항목 | 상태 |
|------|------|
| 영업 메모 저장 (`store_memos`) | SQL 미실행, 코드 미완료 |
| 수도권FS지역사업부장 멀티지점 뷰 | 감시 도구 우려로 보류 |
| N8N + Gemini + Groq Agentic 자동화 | 기획 완료, 미구현 |
| GitHub Actions + 공공인허가 자동 배치 | data.go.kr API 접근 이슈 |
| 내 일정 달력 UI 고도화 (달력에서 날짜 먼저 선택) | ✅ v117에서 구현 완료 |
| managers region1/region2 기존 24개 행 수동 입력 | ✅ 완료 (2026-03-18) |
| **지역 카테고리 트렌드 패널** | 기획 완료, 미구현 — 아래 상세 참고 |

### 지역 카테고리 트렌드 패널 (미구현)

**목적**: 케이스영업 지원 — "우리 지역에서 어떤 카테고리/업종이 활발한지" 파악 → recipes RAG와 연결해 거래처마다 전파

**흐름**:
```
사업부별 카테고리 5개 설정 (예: 크루아상, 소금빵, 라떼, 브런치카페, 베이커리)
    ↓
N8N 주 1회: 네이버 블로그 검색 "의정부 크루아상 카페" 등
    ↓
Gemini: 언급 많은 매장명 + 카테고리 추출
    ↓
regional_trending_stores 테이블 저장
    ↓
index.html 지도 옆 패널에 표시
    ↓
recipes RAG 자동 매칭 → 케이스영업 토킹포인트 생성
```

**필요 DB 테이블**:
```sql
-- 사업부별 카테고리 설정 (담당자·지점장 모두 설정 가능)
business_unit_categories (
  business_unit TEXT PRIMARY KEY,
  categories JSONB  -- ['크루아상', '소금빵', ...]  max 5개
)

-- 지역별 카테고리 트렌드 수집 결과
regional_trending_stores (
  id BIGSERIAL,
  business_unit TEXT,
  category TEXT,
  store_name TEXT,
  mention_count INT,
  region TEXT,        -- managers.region2 기반 (담당자 지역 자동 매핑)
  collected_at DATE
)
```

**UI**: index.html 지도 옆 패널 내 별도 섹션

**한계점**:
- 인기 매장 = 오래된 유명 매장 (트렌딩 ≠ 신규 급부상)
- 소도시(연천·동두천)는 블로그 데이터 자체가 부족
- 매장명 AI 추출 정확도 한계 (흔한 상호명 혼동 가능)
- 카테고리 키워드는 직접 업데이트 필요 (자동 아님)
- N8N 자체 서버 안정 운영 전제

**선행 조건**: N8N 자체 서버 운영 안정화 후 구현

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

### 회원가입 rate limit 해결 + 승인 후 자동 이동 (82b227c)

- **문제 1**: 회원가입 시 "email rate limit exceeded" 에러 → Supabase 무료 플랜 이메일 발송 시간당 4건 제한
  - **해결**: Supabase Dashboard → Authentication → Sign In / Providers → Email → "Confirm email" 비활성화
  - 관리자 승인이 이미 접근 통제 역할을 하므로 이메일 인증 불필요
- **문제 2**: 관리자가 승인해도 `pending.html` 사용자가 메인으로 자동 이동하지 않음
  - 원인: 페이지 로드 시 1회만 승인 여부 확인, JWT 토큰 자동 갱신 없음
  - **해결**: `setInterval` 30초 폴링 → `client.auth.refreshSession()` 호출 → `approved !== false` 확인 시 `index.html` 이동

### managers 테이블 region3 추가 + 안내 UI 개선 (e19450c → 0a9654a)

- **배경**: 경기남부처럼 시(市)가 넓어 구(區) 단위로 담당자가 다른 경우 처리 필요
- **DB**: `managers` 테이블 `region3 TEXT` 컬럼 추가 (멱등성 ALTER TABLE 포함)
- **upload.html `loadRawManagerMap()`**:
  - region3 포함 select
  - region3 있으면 `region1|region2|region3` 키 등록, 없으면 `region1|region2` 키 등록
- **upload.html 매칭 로직**: `region1|region2|region3` 우선 → `region1|region2` 폴백
- **고양시 기존 데이터 영향 없음**: region2="고양시 덕양구" compound 방식 유지
- **컬럼명 변경**: 시도→지역1, 시군구→지역2, 지역3 신규 추가 (templateHeaders/columnMap/label 모두 반영)
- **담당자 등록 안내 / 방문일지 업로드 안내**: 컴팩트 리디자인 (font 13→12px, 줄간격 1.8→1.6, 셀패딩 축소), 지역3 선택입력 설명 추가

### 인허가 자동 알림 점검 및 개선 (b906f83 → 717ae66)

- **문제**: 서울FS지점 담당자들이 월요일 자동 알림을 못 받음
- **원인**: 순위 컬럼 값이 `'1순위'` 형식으로 저장된 경우 `=== '1'` 비교에서 탈락
- **fix**: `p.replace(/[^0-9]/g, '')` 로 숫자만 추출해서 비교 — '1순위','1위' 등 모두 허용
- **dry-run 모드 추가**: `?dryRun=true` 파라미터로 이메일 발송 없이 대상 목록 확인 가능
- **diagByUnit 진단 정보**: dry-run 시 지점별 total/noRank/noDate/statusMap 반환 (영구 유지)
- **Supabase 조회 한도**: 기본 1000건 → `limit=10000` 으로 증가 (무료)
- **이메일 발송 간격**: 600ms → 200ms (Brevo 초당 10건 제한 내, 5개 지점 ~35초로 안전)
- **타임아웃 여유**: vercel.json maxDuration=60s, 5개 지점 35명 기준 약 35초 소요

---

## 2026-04-20 — discover.html 전면 리디자인 (v164)

### 목적
기존 discover.html 상권 분석 페이지를 common.css Apple 디자인 시스템과 통일하고 더 현대적인 UI로 개선.

### 변경사항

**색상 토큰 전환** — `:root` 자체 변수를 common.css 기반으로 교체
- `--blue: #3b82f6` → `--color-primary: #0071e3`
- `--green: #16a34a` → `--color-success: #34c759`
- `--red: #dc2626` → `--color-danger: #ff3b30`
- `--amber: #d97706` → `--color-warning: #ff9500`
- `--bg: #f1f4f8` → `--color-bg: #f5f5f7`
- `--r: 8px` → `--radius-md: 12px`

**KPI 카드 개선**
- 왼쪽 4px 세로 바 → 상단 3px 가로 컬러 바
- `border-radius: 12px`, `box-shadow` 카드 형태로 전환
- 카드 사이 `gap: 12px`, 패딩 `16px`으로 여백 확보
- 호버 시 `translateY(-2px)` + shadow 강화 효과 추가

**필터 툴바 개선**
- 단순 회색 바 → 흰색 카드 (radius 12px, margin 12px)
- 칩(`.chip`) active 색상 → `--color-primary` 블루
- 월 네비게이션 버튼 크기 28px → 32px

**기타 통일**
- 사이드바 항목 신규/폐업 색상 → common.css 변수
- 지도 마커 색상 → `#34c759`/`#ff3b30`/`#a1a1a6`
- Chart.js 색상 → 동일 팔레트
- Leaflet 팝업 radius 10px → 12px
- 비교 strip primary blue 기반 배경으로 통일
