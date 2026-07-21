# FS MISO — 인허가 대시보드

매일유업 FS팀의 인허가 현황 시각화 + 영업 지원 대시보드. **Next.js 16 앱(`next-app/`)** 단일 소스로 운영.

라이브: https://maeilfs-sales.vercel.app (Vercel `maeilfs-sales`, Root Directory=`next-app`)

---

## 페이지 구성

| 경로 | 설명 |
|------|------|
| `/` | 거래처 — Naver 지도 + 인허가/거래처 마커 |
| `/discover` | 시장 분석 — MapLibre 상권 인텔리전스 |
| `/proposal` | 견적서 / 매장 맞춤 분석 |
| `/consult` | 메뉴 상담 — 현장 레시피 컨설팅 → 견적 |
| `/upload` | 데이터 관리 |
| `/license-export` | 인허가 추출 (xlsx) |
| `/admin` | 관리자 (사용자 승인 + 소속 변경) |

---

## 로컬 개발

```bash
cd next-app
npm install
cp .env.local.example .env.local   # 없으면 CLAUDE.md의 env 목록 참고해 직접 작성
npm run dev
```

---

## 배포 구조

- **앱**: Vercel — `main` 브랜치 push 시 자동 배포 (Next.js Route Handlers가 API 포함)
- **DB**: Supabase (PostgreSQL + pgvector + RLS)
- **Cron**: Vercel Cron 2개 — 인허가 방문 알림 이메일(평일 09:15 KST), 시장 데이터 야간 갱신(매일 03:00 KST)

상세 규칙·이력은 `CLAUDE.md` 참고.
