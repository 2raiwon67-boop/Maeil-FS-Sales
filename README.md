# FS MISO — 경기북부 인허가 대시보드

매일유업 경기북부 FS팀의 인허가 현황 시각화 + 영업 지원 대시보드.

배포: [GitHub Pages](https://2raiwon67-boop.github.io/Maeil-FS-Sales/) | API: Vercel

---

## 페이지 구성

| 페이지 | 설명 |
|--------|------|
| `index.html` | 메인 지도 대시보드 (인허가 + 거래처 마커) |
| `방문일지.html` | 방문 기록 관리 + AI 브리핑 |
| `proposal.html` | 견적서 / 매장 맞춤 분석 |
| `upload.html` | 데이터 관리 (업로드 + DB 현황 + 공공인허가 조회) |
| `discover.html` | 시장 분석 (상권 인텔리전스) |
| `admin.html` | 관리자 페이지 (사용자 승인 + 소속 변경) |

---

## 로컬 개발 설정

### 1. 저장소 클론
```bash
git clone https://github.com/2raiwon67-boop/Maeil-FS-Sales.git
cd Maeil-FS-Sales
```

### 2. config.js 생성
`config.example.js`를 복사해서 `config.js`를 만들고 실제 값을 입력합니다.
```bash
cp config.example.js config.js
# config.js 열어서 SUPABASE_URL, SUPABASE_ANON_KEY 입력
```

### 3. 로컬 서버 실행
```bash
npx serve .
# 또는
python3 -m http.server 8000
```

---

## 배포 구조

- **프론트엔드**: GitHub Pages — `main` 브랜치 push 시 GitHub Actions 자동 배포
- **API**: Vercel Serverless Functions (`/api/*.js`)
- **DB**: Supabase (PostgreSQL + pgvector + RLS)

GitHub Actions가 배포 시 `SUPABASE_URL`, `SUPABASE_ANON_KEY` Secrets에서 `config.js`를 자동 생성합니다.
