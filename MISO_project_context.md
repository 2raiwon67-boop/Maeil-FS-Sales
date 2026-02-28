# MISO 프로젝트 컨텍스트 (Claude Code용)

> 이 문서는 Claude Code가 프로젝트를 이어받아 작업하기 위한 컨텍스트 문서입니다.
> 반드시 이 문서를 먼저 읽고 작업을 시작하세요.

---

## 프로젝트 개요

- **프로젝트명:** MISO (Maeil AI 영업비서)
- **목적:** 매일유업 영업사원을 위한 AI 기반 영업 지원 시스템
- **현재 배포 URL:** https://maeilfs-sales.vercel.app/index.html
- **배포 플랫폼:** Vercel
- **현재 AI 엔진:** Gemini API 기반 챗봇

---

## 현재 시스템 기능 (기존 구현 완료)

- 거래처 현황 대시보드 (거래/미거래/인허가/DROP/공사중)
- 담당자별 / 지역별 현황
- 영업 루트 최적화 (네이버 지도 연동)
- RAW 파일 업로드 → 1차 가공 → Google Sheets 업로드
- MISO 챗봇 (현재 Gemini 기반, 고도화 예정)
- AI 인사이트 필터

---

## 앞으로 구축할 기능 (이 프로젝트의 핵심 목표)

### 목표
챗봇 방식이 아닌 **제품 DB + 레시피 연결 기반 추천 시스템**으로 발전

### 작동 흐름
```
거래처 정보 (카페 타입, 규모, 지역)
        ↓
매일유업 제품 DB에서 적합한 제품 필터링
        ↓
해당 제품의 레시피 추출
        ↓
트렌드 PDF 내용과 매칭 (근거 제시)
        ↓
MISO가 "이 카페엔 이 제품 + 이 레시피 추천" 출력
```

### 추천 출력 예시
```
🏪 홍대 A카페 (스페셜티 지향, 미거래)

📦 추천 제품: 매일 바리스타 오트밀크
☕ 추천 레시피: 오트 라떼, 오트 콜드브루
📈 추천 이유: 비건 음료 트렌드 상승 중 (월간커피 3월호 기반)
```

---

## 기술 스택

| 항목 | 선택 | 이유 |
|---|---|---|
| DB | Supabase | Vercel과 궁합 좋음, pgvector 지원 |
| 벡터 검색 | Supabase pgvector | 별도 서비스 불필요 |
| AI 엔진 | Gemini API | 기존 유지 |
| 배포 | Vercel | 기존 유지 |
| PDF 저장 | Google Drive → Supabase | 수시로 추가되는 구조 |

---

## Supabase DB 설계 (확정)

### 테이블 1: `documents`
```sql
create table documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text, -- '트렌드' | '제품카탈로그' | '뉴스'
  source text,   -- '월간커피' | '매일유업' | '신문'
  uploaded_at timestamp default now()
);
```

### 테이블 2: `document_chunks`
```sql
create extension if not exists vector;

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references documents(id),
  content text not null,
  embedding vector(768),
  page_number int
);
```

### 테이블 3: `products`
```sql
create table products (
  id uuid primary key default gen_random_uuid(),
  name text not null,              -- '바리스타 오트밀크'
  category text,                   -- '우유대체음료' | '우유' | '크림'
  description text,
  target_cafe_type text,           -- '스페셜티' | '프랜차이즈' | '일반'
  is_active boolean default true
);
```

### 테이블 4: `recipes`
```sql
create table recipes (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references products(id),
  name text not null,              -- '오트 아이스 라떼'
  trend_tag text,                  -- '비건' | '저당' | '고단백'
  difficulty text,                 -- '쉬움' | '보통'
  description text,
  pdf_url text,                    -- 레시피 카드 PDF 저장 경로 (Supabase Storage)
  ingredients jsonb                -- 재료 제품 목록 (견적 자동 추가용)
);
```

**ingredients 데이터 형식 예시:**
```json
[
  { "product_id": "uuid-xxx", "name": "바리스타 오트밀크", "amount": "200ml" },
  { "product_id": "uuid-yyy", "name": "에스프레소 시럽", "amount": "10ml" }
]
```

### 테이블 연결 구조
```
거래처 (기존 데이터)
  └── target_cafe_type으로 매칭
        ↓
products
  └── product_id로 연결
        ↓
recipes
  └── trend_tag로 PDF 트렌드와 연결
        ↓
document_chunks (트렌드 PDF 벡터)
```

---

## 견적서 + 레시피 카드 PDF 연동 기능 (신규)

### 개요
견적서 웹앱은 이미 구현 완료. 아래 3가지 기능을 추가 연결해야 함.

### 레시피 카드 형태
- 메뉴별 1장짜리 카드형 PDF
- Supabase Storage에 업로드하여 관리
- recipes 테이블의 pdf_url 컬럼으로 경로 참조

### 구현할 기능 3가지

**① 메뉴 선택 시 재료 자동 추가**
```
견적서에서 메뉴 선택 (예: 오트 라떼)
→ recipes.ingredients에서 제품 목록 읽기
→ 견적 품목 테이블에 자동으로 행 추가
```

**② 레시피 카드 PDF 자동 첨부**
```
선택한 메뉴의 recipes.pdf_url 가져오기
→ 견적서 출력 시 뒤에 자동으로 붙여서 출력
```

**③ 최종 출력물 구성**
```
1페이지: 견적서 (기존 그대로)
2페이지~: 선택된 메뉴별 레시피 카드 PDF
```

### 출력물 예시
```
[견적서]
품목              수량    단가
바리스타 오트밀크  10박스  ₩xxx   ← ingredients에서 자동 추가
바리스타 우유      5박스   ₩xxx   ← ingredients에서 자동 추가

[첨부 레시피 카드]
📄 오트 라떼 레시피 카드 (1장)
📄 콜드브루 오트 레시피 카드 (1장)
```

### Supabase Storage 구조
```
supabase-storage/
  └── recipe-cards/
        ├── oat-latte.pdf
        ├── cold-brew-oat.pdf
        └── ...
```

---

## PDF 관련 사항

- **PDF 종류:** 매일유업 제품 카탈로그, 월간커피, 음료 트렌드 신문 등
- **업데이트 주기:** 수시로 추가
- **주의사항:** 스캔본(이미지형) PDF는 OCR 처리 필요 (Tesseract 무료 사용 가능)
- **청킹 단위:** 500자 단위로 쪼개서 document_chunks에 저장

---

## 비용 구조

| 항목 | 예상 비용 |
|---|---|
| Supabase | 무료 (500MB 이하 유지 시) |
| Gemini API | 월 1~3만원 (하루 100~200건 기준) |
| Vercel | 무료 |
| **합계** | **월 1만원 이하 목표** |

### 주의사항
- Supabase 무료 플랜: 2주 미접속 시 자동 일시정지 → 주 1회 접속 필수
- Gemini API 예산 한도 설정 필수 (Google Cloud Console에서 설정)

---

## 다음 작업 목록 (Claude Code가 이어서 할 일)

**[1단계] Supabase 세팅**
- [ ] Supabase 프로젝트 생성 및 위 SQL 전체 실행
- [ ] pgvector 확장 활성화
- [ ] Supabase Storage에 recipe-cards 버킷 생성

**[2단계] 데이터 입력**
- [ ] products 테이블에 매일유업 제품 초기 데이터 입력
- [ ] recipes 테이블에 메뉴별 데이터 입력 (ingredients JSON 포함)
- [ ] 레시피 카드 PDF를 Supabase Storage에 업로드 후 pdf_url 연결

**[3단계] 견적서 연동 (핵심)**
- [ ] 견적서 웹앱 GitHub 저장소 확인 (현재 미확인)
- [ ] 메뉴 선택 시 ingredients 자동으로 견적 품목에 추가하는 로직 구현
- [ ] 견적서 출력 시 레시피 카드 PDF 자동 첨부 기능 구현

**[4단계] 인허가 자동화**
- [ ] data.go.kr API 키 발급 (휴게음식점 / 일반음식점 / 제과점영업)
- [ ] licenses 테이블 생성
- [ ] 초기 전체 데이터 bulk 업로드 (영업중 필터)
- [ ] Vercel Cron Job 설정 (매주 월요일 새벽 2시)
- [ ] MISO 대시보드 신규 업체 뱃지 표시 구현

**[5단계] 추천 시스템**
- [ ] 거래처 카페 타입 기반 자동 추천 UI 구현
- [ ] MISO 추천 로직 연결

---

## 공공 인허가 데이터 자동화 (신규)

### 개요
매주 수도권 3개 지역의 신규 인허가 업체를 자동으로 수집해 MISO 대시보드에 표시

### 데이터 소스
- **기존:** localdata.go.kr → **4월 15일 이후 data.go.kr로 통합** (데이터 동일, 주소만 변경)
- API 키는 data.go.kr에서 새로 발급 필요

### 수집 대상
| 업종 | 서울 | 경기 | 인천 | 소계 |
|---|---|---|---|---|
| 일반음식점 | ~15만 | ~20만 | ~5만 | ~40만건 |
| 휴게음식점 | ~8만 | ~12만 | ~3만 | ~23만건 |
| 제과점영업 | ~5천 | ~8천 | ~2천 | ~1.5만건 |
| **합계 (영업중만)** | | | | **~20~25만건** |

### 용량 판단
- 전체 누적: 약 200~300MB → Supabase 무료 500MB 이내 가능 ✅
- 주간 신규: 약 500~1,500건 → 매우 가벼움 ✅

### Supabase 테이블: `licenses`
```sql
create table licenses (
  id uuid primary key default gen_random_uuid(),
  store_name text,                  -- 업소명
  business_type text,               -- '휴게음식점' | '일반음식점' | '제과점영업'
  region text,                      -- '서울' | '경기' | '인천'
  district text,                    -- 구/시 (예: 강남구, 수원시)
  address text,                     -- 상세주소
  license_date date,                -- 인허가일자
  status text,                      -- '영업' | '폐업' | '휴업'
  is_new_this_week boolean default false,  -- 이번주 신규 여부
  matched_to_client uuid,           -- 기존 거래처 매칭 여부
  fetched_at timestamp default now()
);
```

### 2단계 운영 구조
```
[초기 1회 - 전체 bulk 업로드]
영업중인 업체 전체 → Supabase licenses 테이블 저장

[매주 자동 - 변동분만]
신규/변경 데이터만 API 호출 → 기존 데이터 비교 후 추가/수정만 반영
```

### 주간 자동화 흐름 (Vercel Cron)
```
매주 월요일 새벽 2시 자동 실행
        ↓
① data.go.kr API 호출 (지난 7일 신규/변경)
        ↓
② 영업 상태 필터 (폐업 자동 제거)
        ↓
③ 기존 거래처 DB와 대조
   - 이미 거래 중 → 스킵
   - 신규 업체 → is_new_this_week = true
        ↓
④ MISO 대시보드 "🆕 이번주 신규 N개" 표시
        ↓
⑤ 다음주 월요일: is_new_this_week 초기화
```

### API 주소 관리 (중요)
나중에 주소 변경에 대비해 환경변수로 분리해둘 것
```javascript
const API_BASE_URL = process.env.LICENSE_API_URL
// → .env 파일에서 관리, 코드 수정 없이 URL만 교체 가능
```

---

## 참고사항

- 코드 관리 위치: Vercel 연동 GitHub 저장소 (저장소명 미확인 → 먼저 확인 필요)
- 담당자는 코딩 초보자이므로 모든 코드는 주석과 함께 단계별로 제공할 것
- 영업팀 내부용 시스템이므로 외부 공개 최소화
