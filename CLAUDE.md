# FS MISO — 경기북부 인허가 대시보드

매일유업 경기북부 FS팀의 인허가 현황 시각화 + 영업 지원 대시보드.
배포: GitHub Pages (프론트) + Vercel (API)

---

## 프로젝트 구조

```
index.html       메인 대시보드 (지도 + 필터 + 마커, ~5000줄)
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
api/                 Vercel Serverless Functions
  gemini.js              Gemini 프록시 (report.html용)
  generate-briefing.js   AI 브리핑 온디맨드 — gemini-2.5-flash-lite
  batch-briefings.js     야간 배치 브리핑 + Mother Brain 임베딩 — gemini-2.5-flash-lite
  naver-reviews.js       네이버 검색 + Gemini 분석 — gemini-2.5-flash
  update-visit-log.js    방문일지 인라인 수정 (Service Role Key)
  send-license-alert.js  인허가 주간 알림 (Vercel Cron 월 09:15 KST)
  public-license.js      공공데이터 API 프록시
  admin-all-data.js      관리자 전체 지점 데이터 조회
  admin-users.js         관리자 사용자 관리
db/supabase_setup.sql    Supabase 테이블/RLS/RPC 정의 (멱등성 보장)
```

---

## Supabase 테이블

| 테이블 | 설명 | 중복 기준 |
|--------|------|-----------|
| `licenses` | 인허가 데이터 | `business_name` |
| `accounts` | 주요거래처 | `account_id` |
| `visit_logs` | 방문일지 | `(business_unit, visit_date, manager, business_name)` 복합키 |
| `managers` | 담당자 설정 | region1(시도), region2(시군구), manager_name, email, is_branch_manager |
| `recipes` | 레시피 RAG DB (337건, pgvector 768차원) | |
| `naver_cache` | 네이버 API 240h 캐시 | `store_name` UNIQUE |
| `ai_briefings` | 거래처 AI 브리핑 캐시 | `(account_name, business_unit)` UNIQUE |
| `store_analysis_cache` | 네이버 매장 분석 캐시 | `store_name` UNIQUE |
| `quotes` | 저장된 견적 | |

RLS: 모든 테이블은 `business_unit` 기반 격리. `managers.region` 컬럼은 삭제됨 (region1/region2 사용).

---

## 핵심 규칙

### SW 버전 관리
기능 추가·수정 시 `sw.js` 상단의 버전 상수를 올려야 한다. 현재: **v81**

### Gemini 모델 사용 기준
- 일반 분석 (브리핑, 배치): `gemini-2.5-flash-lite`
- 복잡한 분석 (네이버 리뷰): `gemini-2.5-flash`
- JSON 응답이 필요한 경우 반드시 `responseMimeType: 'application/json'` + `responseSchema` 적용

### Thinking 모델 파트 파싱
```js
const parts = data.candidates?.[0]?.content?.parts || [];
const rawText = (parts.find(p => !p.thought) || parts[0])?.text?.trim() || '';
```
`parts[0]`만 쓰면 thought 파트가 먼저 와서 브리핑에 사고 과정이 저장되는 버그 발생.

### 에러 UX
`alert()` 사용 금지 — 반드시 `showToast(msg, type, duration)` 사용.
type: `'success'` | `'error'` | `'warning'`

### 데이터 로딩
`index.html` 초기화 시 `Promise.all([loadDataFromSheets(), loadAccountsData(), loadVisitLogCache()])` 패턴 유지. await 누락 시 Race Condition 발생.

### business_unit 격리
- 클라이언트: `getBusinessUnitForIndex()` 캐시 함수 사용
- API: Service Role Key 쓰는 경우 반드시 `business_unit` 검증 추가
- NULL 처리: `businessUnit || ''` 아닌 `businessUnit ?? null` 사용

### Vercel Cron (Hobby plan — 2개 한도)
현재 사용 중:
1. `send-license-alert` — `15 0 * * 1` (월 09:15 KST)
2. `batch-briefings` — `0 18 * * *` (매일 03:00 KST)

슬롯이 꽉 찼으므로 새 Cron 추가 전 기존 것 제거 필요.

### 이메일 발송
Brevo API 사용 (`BREVO_API_KEY`, `BREVO_FROM_EMAIL`). Resend는 본인 이메일만 발송 가능해서 교체함. 응답 성공 필드는 `messageId` (id 아님).

---

## 공통 헬퍼 (index.html)

```js
showToast(msg, type, duration)   // 토스트 알림
isMobile()                       // window.innerWidth <= 768
getBusinessUnitForIndex()        // business_unit 캐시
```

## 마커 구조 (index.html)

```js
marker._item      // 원본 데이터
marker._status    // 거래여부
marker._rank      // '1'|'2'
marker._region    // '의정부시'
marker._manager   // '이도현'
marker._milk      // '매일'
marker._origIcon  // 장바구니 담길 때 원본 저장
```

---

## 상세 작업 이력

`.claude/skills/claude_대화파일.md` 참고
