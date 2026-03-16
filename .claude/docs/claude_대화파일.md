# FS MISO 대화 작업 이력

## 2026-03-16 (v102)

### 전체 탭 담당자·지역 합산 카운트

**문제**: 전체 탭에서 담당자·지역 패널이 인허가 데이터만 기준으로 카운트 표시

**수정** (`index.html` - updateDashboard else 브랜치):
- 인허가 카운트 집계 후, `currentSidebarTab === 'all'`이면 주요거래처 카운트도 합산
- 주요거래처: `currentManager` / `currentRegion` 활성 필터 적용 후 집계
- 주소에서 시군구 추출(`주소.split(' ')[1]`), 담당자(`담당자명`) 합산

---

## 2026-03-16 (v101)

### 사이드바 탭별 카운트 정확도 개선

**문제 1 — 전체 탭 콘텐츠 미표시**: `switchSidebarTab('all')` 시 `sidebarContentLicense`, `sidebarContentAccount` 둘 다 숨겨져 있어 거래현황/거래미거래 카드가 모두 보이지 않음

**수정** (`index.html` - switchSidebarTab):
```js
// 전: tab === 'license' / tab === 'account'
// 후:
sidebarContentLicense.classList.toggle('active', tab === 'all' || tab === 'license');
sidebarContentAccount.classList.toggle('active', tab === 'all' || tab === 'account');
```

**문제 2 — 주요거래처 탭 담당자·지역 카운트가 인허가 데이터 기준**: updateDashboard()의 regionList/managerList 렌더링이 항상 `filteredData`(인허가) 기준

**수정** (`index.html` - updateDashboard 담당자·지역 섹션):
- `currentSidebarTab === 'account'` 분기 추가
  - `accountsData`를 기준으로, `currentAccountFilter` / `currentManager` / `currentRegion` 활성 필터 순차 적용 후 카운트 계산
  - 주소에서 시군구 추출: `a['주소'].split(' ')[1]`
  - 담당자: `a['담당자명']`
- else 분기(전체/인허가 탭): 기존 `filteredData` 기준 유지

**효과**:
- 전체 탭: 거래현황(인허가) + 거래/미거래 현황(주요거래처) 모두 표시
- 주요거래처 탭: 담당자·지역 숫자가 주요거래처 데이터 기준
- 클릭 연동: 거래/미거래 클릭 → 담당자·지역 카운트 즉시 재계산

---

## 2026-03-16 (v96)

### 사이드바 탭 UI (인허가/주요거래처 분리) + 네비 '거래처' 변경

**요구사항**: 네비게이션 '인허가' → '거래처' 변경, 사이드바 필터를 인허가/주요거래처 탭으로 분리

**수정** (`js/nav-component.js`):
- PC 네비 + 모바일 탭바 라벨 '인허가' → '거래처'

**수정** (`index.html`):
- CSS: `.sidebar-tabs`, `.sidebar-tab`, `.sidebar-tab-content` 스타일 추가
- HTML: 사이드바 제목 "거래처 현황" → "거래처", 탭 버튼 2개 추가
  - 인허가 탭 전용: 거래현황 (`ddStatusCard`)
  - 주요거래처 탭 전용: 거래/미거래 현황 (`ddAccountCard`, 제목 변경)
  - 공통: 사용우유, 담당자·지역
- JS: `currentSidebarTab` 변수 + `switchSidebarTab(tab)` 함수 추가
  - 탭 전환 시 UI 토글 + 반대쪽 필터 초기화 + `updateMap()` 호출
- `filterMarkers()`: `currentAccountFilter !== null` 조건 → `currentSidebarTab === 'account'` 로 교체
- `filterAccountMarkers()`: 탭 기반 숨김 처리 추가 (`currentSidebarTab === 'license'`일 때 전체 숨김), 기존 cross-tab 중복 조건 제거

### 주요거래처 마커 1회 생성 패턴 전환 + 3탭 UI (v98)

**문제**: `updateAccountMarkers()`가 호출될 때마다 전체 마커를 삭제·재생성 → 초기 로딩 및 탭 전환 시 느림

**수정**:
- `updateAccountMarkers()` → `initAccountMarkers()` (1회 생성 패턴)
  - `accountMarkers.length > 0`이면 `filterAccountMarkers()`만 재실행
- `_buildAccountMarkerIcon(dealStatus)` 헬퍼 함수 추출
- `refreshAccountMarkerForItem(name, newStatus)` 추가
  - 거래상태 변경 시 해당 마커 하나만 `setIcon()` + `_dealStatus` 갱신
- 클릭 핸들러: 클로저 `dealStatus` → `marker._dealStatus` 동적 참조 (상태 변경 후 재클릭 시 정확)
- 사이드바 탭 3개로 확장: 전체(기본, 양쪽 마커) | 인허가 | 주요거래처
- 기본 탭 `all` → 초기 진입 시 인허가·주요거래처 마커 모두 표시

### 필터 다중 선택 지원 (v100)

**변경**: 모든 필터 상태 변수를 `null | string` → `Set`으로 전환
- 대상: `currentRegion`, `currentManager`, `window.currentDealStatusFilter`, `currentAccountFilter`, `currentMilkFilter`
- 토글 함수 5개: `=== value` 단일 비교 → `Set.has/add/delete`
- `filterMarkers()` / `filterAccountMarkers()`: `Set.size > 0 && !Set.has()` 조건
- `updateDashboard()`: `filteredData` 필터링, `filteredAccounts` 필터링, active 클래스 5곳 모두 Set 기반
- `clearAllFilters()`: 각 변수 `.clear()`
- `toggleMyTarget()` / 초기화: `new Set([myManagerName])`
- 누락 검증: `=== null` / `=== value` 패턴 잔존 없음 확인

### 사이드바 '거래처' 제목 제거 (v99)
- 탭이 이미 문맥 제공 → 제목 중복 제거, 공간 확보

### 주요거래처 탭 사용우유 필터 제거 (v97)
- 사용우유(`ddMilkCard`)를 공통 영역에서 인허가 탭 전용으로 이동
- 주요거래처 탭: 거래/미거래 현황 + 담당자·지역만 표시

---

## 2026-03-16 (v92 → v95)

### 전체 앱 UI 일관성 점검 및 개선

#### 1. 모바일 지도 높이 수정 (v92) — `index.html`
**문제**: 모바일에서 `.main-layout` 높이가 `calc(100vh - 52px)` 고정이라 하단 탭바(60px)에 지도 영역이 가려짐

**수정**: 모바일 미디어쿼리 추가
```css
@media (max-width: 768px) {
    .main-layout {
        height: calc(100vh - 52px - 60px - env(safe-area-inset-bottom));
    }
}
```

#### 2. 미디어쿼리 기준점 통일 (v92) — `report.html`, `upload.html`
**문제**: `report.html`은 `700px`, `upload.html`은 `900px` 기준으로 레이아웃 전환 → 페이지마다 태블릿에서 다른 동작

**수정**: 전체 `768px` 기준으로 통일

#### 3. 테이블 호버 색상 개선 (v93) — `report.html`
**문제**: `.account-table tr:hover td { background: #fafafa }` — 흰색과 거의 구분 안 됨

**수정**: `#fafafa` → `#f0f4ff` (약한 파란톤)

#### 4. 월별 보고서 사용자 이름 표시 버그 수정 (v94) — `report.html`
**문제**: `setupLogoutButton()`이 "관리자님 (경기북부)" 형식으로 설정 후, 바로 아래 코드가 `textContent = name`으로 "관리자"만 덮어씌움

**수정**: 중복 이름 설정 코드 제거 (setupLogoutButton에 위임)
```js
// 제거된 코드
if (currentUser) {
    const name = currentUser.user_metadata?.full_name || currentUser.email;
    document.getElementById('userNameDisplay').textContent = name;
}
```

#### 5. 네비게이션 상단 틈 제거 (v95) — `common.css`
**문제**: `common.css`의 body에 `margin: 0`이 없어 브라우저 기본 8px 마진으로 네비 상단에 틈 발생. `upload.html`에서 특히 두드러짐 (다른 페이지는 각자 body margin 설정으로 가려짐)

**수정**: `common.css` body 규칙에 `margin: 0; padding: 0;` 추가 → 전체 페이지 일괄 적용

---

## 2026-03-16 (v91)

### 견적서 불러오기 후 재저장 시 중복 생성 버그 수정 (v91)

**문제**: 저장된 견적서를 불러온 뒤 수정하고 저장하면 기존 행이 업데이트되지 않고 새 행이 INSERT되어 견적서가 중복 생성됨

**수정** (`proposal.html`):
- `_loadedQuoteId` 변수 추가 — 불러온 견적서 id 보관
- `loadQuote()` — `_loadedQuoteId = data.id` 저장
- `saveQuote()` — id 있으면 `.update()`, 없으면 `.insert()` 분기 처리
- business_unit 격리 조건 update에도 동일 적용

---

## 2026-03-16 (v86 → v90)

### 매장맞춤분석 중복 클릭 방지 + 로딩 스피너 (v90 / 08d7bc7)

**문제**: 분석 중 "진행중입니다" 텍스트만 표시되어 사용자가 버튼을 중복 클릭

**수정**:
- 분석 시작 시 버튼 `disabled` + 회전 스피너 `분석 중...` 표시
- `finally` 블록에서 성공/실패 무관하게 버튼 원복
- `alert()` 제거 → 결과 영역 인라인 경고 표시
- `.analyze-btn:disabled` + `@keyframes _spin` CSS 추가

---

### 방문일지 업로드 unique constraint 오류 수정 (3단계)

**문제**: `visit_logs_natural_uq` unique constraint 위반으로 업로드 실패

**1차 (c3b59a5)**: 파일 내부 중복 제거 + Supabase 조회 한도 1000 → 50000

**2차 (9bb67e6)**: conflictKey + upsert(ignoreDuplicates) 시도 → 실패
- DB unique index가 부분 인덱스(WHERE절 포함)라 PostgREST ON CONFLICT 미지원

**3차 (0353da3) — 최종**: 엑셀 파싱 시 `normalizeToYMD()` 날짜 정규화
- `2024-1-15` → `2024-01-15` 제로패딩 → dedup 문자열 비교 정확도 확보
- conflictKey 제거, plain INSERT 유지

```js
const normalizeToYMD = (val) => {
    const m = String(val).match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    ...
};
```

---

### 가입 승인 이메일 자동 발송 (e6d2c67)

- `admin.html` confirmApprove → `userEmail` 추가 전달
- `api/admin-users.js` approve 시 Brevo로 승인 완료 이메일 발송
- 이메일 실패 시 승인 처리는 정상 진행 (catch 격리)

---

### 편집형 테이블 저장 버튼 무반응 수정 (v87 / 359dbd4)

**원인**: `confirm()` 다이얼로그가 Edge에서 묵살됨

**수정**: 2단계 클릭 확인 패턴
- 1차 클릭: 버튼 → 주황색 `⚠️ 기존 데이터 교체됩니다. 다시 클릭` (3초 유효)
- 2차 클릭: 실제 저장 실행

---

### admin-all-data API 캐시 방지 (a1d4f68)

- `304 Not Modified` 방지: `Cache-Control: no-store` 헤더 추가
- admin-users.js와 동일한 no-cache 패턴 통일

---

### 모바일 레이어 필터 나만보기/전체보기 라벨 (v88 / 34331de)

- `myTargetToggle` 라벨 동적 변경
  - 비활성: `👥 전체보기` / 활성: `👤 나만보기`
- `_updateMyTargetToggleUI()` 에 라벨 텍스트 업데이트 추가

---

### 모바일 방문일지 모달 스크롤 + AI브리핑 레이아웃 (v89 / 8c690b5)

**스크롤 문제**: 데스크탑 `overflow:hidden`이 모바일에서 상속 → 스크롤 불가
- 모바일 `.modal-content` override에 `overflow-y:auto`, `-webkit-overflow-scrolling:touch`, `overscroll-behavior:contain` 추가

**AI브리핑 가로 확장**: `margin:0 32px` + word-break 미설정
- 모바일에서 `margin:0 16px !important`
- `#aiBriefingContent`에 `word-break:break-word; overflow-x:hidden` 추가

---

## 버전 이력 요약

| 버전 | 커밋 | 내용 |
|------|------|------|
| v90 | 08d7bc7 | 매장맞춤분석 중복 클릭 방지 + 로딩 스피너 |
| v89 | 8c690b5 | 모바일 모달 스크롤 + AI브리핑 레이아웃 수정 |
| v88 | 34331de | 모바일 나만보기/전체보기 라벨 개선 |
| v87 | 359dbd4 | 편집형 저장버튼 무반응 + admin-all-data 캐시 방지 |
| v86 | 0353da3 | 방문일지 업로드 날짜 정규화 최종 해결 |
| v85 | a2df917 | computeRecommendations 미사용 변수 제거 |
| v84 | 2164faa | 오늘 가볼 곳 추천 플로팅 뱃지 + 패널 |
| v83 | f0dc2d5 | 방문 일정 저장소 localStorage → Supabase 전환 |
| v82 | 573ea14 | 장바구니 방문 일정 저장 + 당일 AI 브리핑 팝업 |

---

## 주요 설계 결정 & 교훈

### DB 스키마
- `visit_logs_natural_uq`: 부분 인덱스(WHERE절) → PostgREST ON CONFLICT 사용 불가
- `managers.region` 컬럼 삭제됨 → `region1`(시도), `region2`(시군구) 사용
- `business_unit` NULL 처리: `?? null` 사용 (`|| ''` 아님)

### business_unit 연동
- Supabase `auth.users.user_metadata.business_unit`에 저장
- 관리자 승인 시 설정 (`admin-users.js`)
- `managers.email` (엑셀 업로드) ↔ `auth.users.email` (앱 가입) 은 별개 — 연결 안 됨
- 주간 인허가 알림은 `managers` 테이블 기준, 앱 계정 여부 무관
- 지점장: `region2='지점장'` 또는 `is_branch_manager=true` → `myManagerName=null` (나만보기 미표시)

### 이메일 시스템
- Brevo API (`BREVO_API_KEY`, `BREVO_FROM_EMAIL`)
- 발신자 폴백 하드코딩: `|| '2raiwon67@gmail.com'` (Vercel 환경변수 미설정 시)
- 주간 인허가 알림: `managers` 테이블 이메일 사용
- 승인 알림: `auth.users.email` 사용
- `confirm()`/`alert()` 사용 금지 → showToast 또는 인라인 UI 패턴

### Supabase 조회
- 기본 1000건 제한 → 대용량 dedup 시 `.limit(50000)` 필요
- 관리자 API 응답 캐시 방지: `Cache-Control: no-store` 필수

### Gemini 모델
- 일반 분석: `gemini-2.5-flash-lite`
- 복잡한 분석: `gemini-2.5-flash`
- Thinking 모델: `parts.find(p => !p.thought)` 로 thought 파트 제외

### Vercel Cron (Hobby — 2개 한도)
1. `send-license-alert` — `15 0 * * 1` (월 09:15 KST)
2. `batch-briefings` — `0 18 * * *` (매일 03:00 KST)
