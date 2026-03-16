# FS MISO 대화 작업 이력

## 2026-03-16 (v86 → v87)

### 방문일지 업로드 unique constraint 오류 수정 (3단계)

**문제**: `visit_logs_natural_uq` unique constraint 위반으로 업로드 실패

**1차 수정 (c3b59a5)**
- 파일 내부 중복 행 제거 (Set 기반)
- Supabase 기존 데이터 조회 한도 1000 → 50000

**2차 수정 (9bb67e6) — 근본 원인**
- `visit_date` 날짜 포맷 불일치: 엑셀 파싱 `2024-1-15` vs DB `2024-01-15`
- `conflictKey` 추가 + `upsert(ignoreDuplicates: true)` 적용 시도

**3차 수정 (0353da3) — 최종 해결**
- `conflictKey` 방식 실패: DB unique index가 부분 인덱스(WHERE절 포함)라 ON CONFLICT 미지원
  - `visit_logs_natural_uq`: `WHERE visit_date IS NOT NULL AND manager IS NOT NULL AND business_name IS NOT NULL`
- 해결: 엑셀 파싱 단계에서 `normalizeToYMD()` 함수로 날짜 정규화 → 비교 정확도 확보 → plain INSERT 유지
- `dateFields` 컬럼은 파싱 시 `YYYY-MM-DD` 제로패딩 보장

```js
const normalizeToYMD = (val) => {
    const m = String(val).match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
    ...
};
```

---

### 가입 승인 이메일 자동 발송 (e6d2c67)

**문제**: 관리자가 신규 가입자 승인 시 가입자에게 알림 없음

**수정**:
- `admin.html` confirmApprove: `userEmail` 파라미터 추가 전달
- `api/admin-users.js` approve 액션: Brevo API로 승인 완료 이메일 발송
  - 이름, 소속, 로그인 링크 포함
  - 이메일 발송 실패 시 승인 처리는 정상 진행 (catch 격리)

---

### 편집형 테이블 저장 버튼 무반응 수정 (v87)

**문제**: "변경사항 저장" 클릭 시 아무 반응 없음

**원인**: `confirm()` 브라우저 다이얼로그가 Edge에서 보이지 않거나 묵살됨
- CLAUDE.md 규칙: `alert()` 사용 금지 → `confirm()`도 동일 문제

**수정**: 2단계 클릭 확인 패턴으로 교체
- 1차 클릭: 버튼이 `⚠️ 기존 데이터 교체됩니다. 다시 클릭` 으로 변경 (주황색, 3초 유효)
- 2차 클릭(3초 내): 실제 저장 실행
- 3초 경과 시 버튼 원복

---

## 이전 작업 이력 (v82 ~ v85)

| 버전 | 커밋 | 내용 |
|------|------|------|
| v85 | a2df917 | computeRecommendations 미사용 변수 제거 |
| v84 | 2164faa | 오늘 가볼 곳 추천 플로팅 뱃지 + 패널 |
| v83 | f0dc2d5 | 방문 일정 저장소 localStorage → Supabase 전환 |
| v82 | 573ea14 | 장바구니 방문 일정 저장 + 당일 AI 브리핑 팝업 |

---

## 주요 설계 결정 & 교훈

### DB 스키마
- `visit_logs_natural_uq`: 부분 인덱스 (WHERE절) → PostgREST ON CONFLICT 사용 불가
- `managers.region` 컬럼 삭제됨 → `region1`(시도), `region2`(시군구) 사용
- `business_unit` NULL 처리: `?? null` 사용 (`|| ''` 아님)

### Supabase 조회 한도
- 기본 1000건 제한 → 대용량 테이블 dedup 시 `.limit(50000)` 필요

### 이메일
- Brevo API 사용 (`BREVO_API_KEY`, `BREVO_FROM_EMAIL`)
- 성공 응답 필드: `messageId` (id 아님)
- `confirm()`/`alert()` 사용 금지 → showToast 또는 인라인 UI 패턴 사용

### Gemini 모델
- 일반 분석: `gemini-2.5-flash-lite`
- 복잡한 분석: `gemini-2.5-flash`
- Thinking 모델: `parts.find(p => !p.thought)` 로 thought 파트 제외

### Vercel Cron (Hobby — 2개 한도)
1. `send-license-alert` — `15 0 * * 1` (월 09:15 KST)
2. `batch-briefings` — `0 18 * * *` (매일 03:00 KST)
