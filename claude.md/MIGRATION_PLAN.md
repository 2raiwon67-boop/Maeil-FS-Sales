# Vite 마이그레이션 계획서

> **프로젝트**: 경기북부 FS 인허가 대시보드
> **목표**: 레거시 HTML → Vite + Vue 3 현대화
> **예상 기간**: 3-4주
> **작성일**: 2026-02-28

---

## 📋 목차

1. [현재 상태 분석](#현재-상태-분석)
2. [마이그레이션 목표](#마이그레이션-목표)
3. [리스크 분석](#리스크-분석)
4. [단계별 실행 계획](#단계별-실행-계획)
5. [기술 스택](#기술-스택)
6. [프로젝트 구조](#프로젝트-구조)
7. [체크리스트](#체크리스트)

---

## 📊 현재 상태 분석

### 기존 시스템 구성

```
레거시 시스템:
├── 배포: GitHub Pages (https://2raiwon67-boop.github.io/Maeil-FS-Sales/)
├── API: Vercel Serverless Functions
├── 데이터베이스: Supabase
├── 주요 파일:
│   ├── index.html (217KB ⚠️)
│   ├── 방문일지.html
│   ├── proposal.html
│   ├── admin.html
│   └── 기타 7개 HTML 파일
└── PWA: Service Worker (sw.js) + manifest.json
```

### 구현된 주요 기능

- ✅ 공공데이터 인허가 조회 (일반음식점/제과점/휴게음식점)
- ✅ 네이버 지도 + 동선 최적화 (OSRM/네이버 연동)
- ✅ Gemini AI 챗봇 (영업 지원)
- ✅ 네이버 CRM (지역검색, 블로그 분석)
- ✅ 방문일지 작성 + Excel 리포트
- ✅ 제안서 자동 생성
- ✅ PWA (오프라인 지원)
- ✅ Supabase 인증 + 관리자 시스템
- ✅ 월간 리포트 자동 발송 (Vercel Cron)

### 현재 문제점

| 문제 | 영향 |
|------|------|
| index.html 217KB (단일 파일에 모든 코드) | 유지보수 어려움, 협업 불가 |
| 번들링 없음 | 초기 로딩 느림, 최적화 불가 |
| 타입 체크 없음 | 런타임 에러 빈발 |
| 코드 중복 | 수정 시 여러 파일 동시 변경 필요 |
| 환경변수 하드코딩 | 보안 취약 (Supabase 키 노출) |

---

## 🎯 마이그레이션 목표

### 정량적 목표

- **번들 크기**: 217KB → **50KB 이하** (첫 로딩)
- **빌드 시간**: 수동 배포 → **자동 CI/CD**
- **개발 서버**: Live Server → **Vite HMR (핫 리로드)**
- **코드 중복**: 추정 30%+ → **0%** (공통 모듈화)

### 정성적 목표

- 🎨 컴포넌트 기반 개발 (재사용성 ↑)
- 🔒 환경변수 안전 관리 (.env)
- 🚀 성능 최적화 (코드 스플리팅, 레이지 로딩)
- 🧪 테스트 가능한 구조
- 📱 PWA 기능 유지 (오프라인 모드)

---

## ⚠️ 리스크 분석

### 🔴 Critical (치명적)

#### 1. GitHub Pages 배포 깨짐
- **문제**: Vite는 `dist/` 폴더 빌드 → GitHub Pages 설정 변경 필요
- **영향**: 서비스 전체 중단
- **해결**: GitHub Actions 워크플로우 자동 배포
- **예방**: 별도 브랜치에서 작업 + Vercel Preview 테스트

#### 2. Service Worker 캐시 충돌
- **문제**: 기존 캐시(`/index.html`) vs 신규 파일(`/assets/index-abc123.js`)
- **영향**: 업데이트 후에도 구버전 표시, 사용자 혼란
- **해결**: `vite-plugin-pwa` 사용 (자동 SW 생성)
- **예방**: 캐시 버전 강제 업데이트 로직

### 🟠 High (높음)

#### 3. 네이버 지도 API 로딩 실패
- **문제**: 외부 스크립트(`<script src="naver-map">`) vs Vite 모듈 시스템
- **영향**: 지도 기능 전체 마비
- **해결**: `vite.config.js`에서 외부 스크립트 처리
- **예방**: 개발 환경에서 먼저 테스트

#### 4. 환경변수 노출 위험
- **문제**: 현재 Supabase URL/Key가 `js/auth.js`에 하드코딩
- **영향**: API 키 도용 → 무단 사용 → 비용 폭탄
- **해결**: `.env.local` 파일 사용 + `.gitignore` 추가
- **예방**: 환경변수 체크리스트 작성

#### 5. 번들 크기 폭발
- **문제**: 모든 라이브러리를 한 번에 번들링 → 500KB+
- **영향**: 모바일 로딩 10초+
- **해결**: `manualChunks`로 코드 스플리팅
- **예방**: 번들 분석기로 모니터링

### 🟡 Medium (중간)

#### 6. Excel 다운로드 기능 깨짐
- **문제**: SheetJS CDN → `window.XLSX` undefined
- **해결**: `npm install xlsx` + import

#### 7. 개발 환경 복잡도 증가
- **문제**: HTML 수정 후 F5 → npm run dev 필요
- **해결**: README.md 작성 + 팀원 교육

---

## 🚀 단계별 실행 계획

### Phase 0: 준비 (1일)

```bash
# 1. 새 브랜치 생성
git checkout -b vite-migration

# 2. 백업
git tag backup-before-vite

# 3. Vite 프로젝트 초기화
npm create vite@latest . -- --template vue
npm install
```

**산출물:**
- ✅ `package.json` (의존성 정의)
- ✅ `vite.config.js` (Vite 설정)
- ✅ `.env.example` (환경변수 템플릿)

---

### Phase 1: 기본 구조 셋업 (3-4일)

#### 1.1 폴더 구조 생성

```bash
mkdir -p src/{components,pages,api,utils,stores,assets}
```

```
src/
├── main.js              # 진입점
├── App.vue              # 루트 컴포넌트
├── components/          # 재사용 컴포넌트
│   ├── Map/
│   │   ├── NaverMap.vue
│   │   └── RouteOptimizer.vue
│   ├── Chart/
│   │   ├── DashboardChart.vue
│   │   └── ChartConfig.js
│   ├── Navigation/
│   │   └── TopNav.vue
│   └── AI/
│       └── GeminiChatbot.vue
├── pages/               # 페이지 컴포넌트
│   ├── Dashboard.vue    # 기존 index.html
│   ├── VisitLog.vue     # 기존 방문일지.html
│   ├── Proposal.vue     # 기존 proposal.html
│   ├── Admin.vue
│   └── Report.vue
├── api/                 # API 호출 로직
│   ├── client.js        # 공통 fetch 래퍼
│   ├── supabase.js      # Supabase 클라이언트
│   ├── publicData.js    # 공공데이터 API
│   ├── naver.js         # 네이버 API (지도, 검색)
│   └── gemini.js        # Gemini API
├── utils/               # 유틸리티
│   ├── geocoding.js     # 좌표 변환 (Proj4)
│   ├── excel.js         # Excel 생성 (SheetJS)
│   ├── date.js          # 날짜 포매팅
│   └── validation.js    # 폼 검증
├── stores/              # 상태 관리 (Pinia)
│   ├── auth.js          # 인증 상태
│   ├── license.js       # 인허가 데이터
│   └── map.js           # 지도 상태
└── assets/              # 정적 파일
    ├── styles/
    │   ├── common.css
    │   └── variables.css
    └── icons/
```

#### 1.2 Vue Router 설정

```javascript
// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/', component: () => import('../pages/Dashboard.vue') },
  { path: '/visit', component: () => import('../pages/VisitLog.vue') },
  { path: '/proposal', component: () => import('../pages/Proposal.vue') },
  { path: '/admin', component: () => import('../pages/Admin.vue') },
]

export default createRouter({
  history: createWebHistory(),
  routes
})
```

#### 1.3 환경변수 설정

```bash
# .env.local (git에 추가 안 함)
VITE_SUPABASE_URL=https://hcqbmilmldeeuydtrayx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
VITE_NAVER_MAP_CLIENT_ID=uipaxmujrl
```

```javascript
// src/api/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)
```

**체크리스트:**
- [ ] 폴더 구조 생성
- [ ] Vue Router 설정
- [ ] `.env.local` 생성 + `.gitignore` 추가
- [ ] Pinia 설치 (`npm install pinia`)

---

### Phase 2: 컴포넌트 마이그레이션 (1주)

#### 우선순위 순서

1. **공통 컴포넌트** (다른 페이지에서 재사용)
   - TopNav (네비게이션 바)
   - GeminiChatbot (AI 챗봇)

2. **간단한 페이지** (복잡도 낮음)
   - Login.vue
   - Upload.vue

3. **핵심 페이지** (복잡도 높음)
   - Dashboard.vue (기존 index.html)
   - VisitLog.vue (방문일지)

#### 예시: TopNav 컴포넌트 분리

**기존 (index.html 내부):**
```html
<nav class="top-nav">
  <div class="nav-logo">FS MISO</div>
  <div class="nav-actions">
    <button class="btn btn-primary" onclick="logout()">로그아웃</button>
  </div>
</nav>
```

**신규 (src/components/Navigation/TopNav.vue):**
```vue
<template>
  <nav class="top-nav">
    <div class="nav-logo">FS MISO</div>
    <div class="nav-actions">
      <button class="btn btn-primary" @click="handleLogout">로그아웃</button>
    </div>
  </nav>
</template>

<script setup>
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()

const handleLogout = async () => {
  await authStore.logout()
  router.push('/login')
}
</script>

<style scoped>
@import '@/assets/styles/common.css';
</style>
```

**체크리스트:**
- [ ] TopNav 컴포넌트
- [ ] GeminiChatbot 컴포넌트
- [ ] NaverMap 컴포넌트
- [ ] DashboardChart 컴포넌트
- [ ] Login 페이지
- [ ] Dashboard 페이지 (핵심)

---

### Phase 3: 외부 라이브러리 통합 (2-3일)

#### 3.1 네이버 지도 API

```javascript
// vite.config.js
export default {
  plugins: [
    vue(),
    {
      name: 'html-transform',
      transformIndexHtml(html) {
        return html.replace(
          '</head>',
          `<script type="text/javascript" src="https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=${process.env.VITE_NAVER_MAP_CLIENT_ID}&submodules=geocoder"></script></head>`
        )
      }
    }
  ]
}
```

#### 3.2 SheetJS (Excel)

```bash
npm install xlsx
```

```javascript
// src/utils/excel.js
import * as XLSX from 'xlsx'

export function exportToExcel(data, filename) {
  const ws = XLSX.utils.json_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, `${filename}.xlsx`)
}
```

#### 3.3 Chart.js

```bash
npm install chart.js vue-chartjs
```

**체크리스트:**
- [ ] 네이버 지도 로딩 확인
- [ ] Excel 다운로드 테스트
- [ ] Chart.js 그래프 표시 확인
- [ ] Proj4 좌표 변환 테스트

---

### Phase 4: PWA 설정 (1일)

```bash
npm install vite-plugin-pwa -D
```

```javascript
// vite.config.js
import { VitePWA } from 'vite-plugin-pwa'

export default {
  plugins: [
    vue(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'FS MISO 인허가 관리',
        short_name: 'MISO',
        theme_color: '#1d1d1f',
        icons: [
          {
            src: '/icons/icon-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: '/icons/icon-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      },
      workbox: {
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/oapi\.map\.naver\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'naver-map-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 7 // 1주일
              }
            }
          }
        ]
      }
    })
  ]
}
```

**체크리스트:**
- [ ] PWA manifest 생성 확인
- [ ] Service Worker 등록 확인
- [ ] 오프라인 모드 테스트
- [ ] 홈 화면 추가 테스트 (모바일)

---

### Phase 5: 빌드 최적화 (2-3일)

#### 5.1 코드 스플리팅

```javascript
// vite.config.js
export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor': ['vue', 'vue-router', 'pinia'],
          'supabase': ['@supabase/supabase-js'],
          'charts': ['chart.js', 'vue-chartjs'],
          'excel': ['xlsx'],
          'map': ['proj4']
        }
      }
    },
    chunkSizeWarningLimit: 600
  }
}
```

#### 5.2 번들 분석

```bash
npm install rollup-plugin-visualizer -D
```

```javascript
// vite.config.js
import { visualizer } from 'rollup-plugin-visualizer'

export default {
  plugins: [
    visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true
    })
  ]
}
```

**체크리스트:**
- [ ] 번들 크기 50KB 이하 달성
- [ ] Lighthouse 성능 점수 90+ 달성
- [ ] 모바일 로딩 3초 이내

---

### Phase 6: GitHub Actions 배포 자동화 (1일)

```yaml
# .github/workflows/deploy.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '18'

      - name: Install dependencies
        run: npm ci

      - name: Build
        env:
          VITE_SUPABASE_URL: ${{ secrets.VITE_SUPABASE_URL }}
          VITE_SUPABASE_ANON_KEY: ${{ secrets.VITE_SUPABASE_ANON_KEY }}
          VITE_NAVER_MAP_CLIENT_ID: ${{ secrets.VITE_NAVER_MAP_CLIENT_ID }}
        run: npm run build

      - name: Deploy to GitHub Pages
        uses: peaceiris/actions-gh-pages@v3
        with:
          github_token: ${{ secrets.GITHUB_TOKEN }}
          publish_dir: ./dist
```

**GitHub Secrets 설정:**
```
Settings → Secrets and variables → Actions
→ New repository secret

- VITE_SUPABASE_URL
- VITE_SUPABASE_ANON_KEY
- VITE_NAVER_MAP_CLIENT_ID
```

**체크리스트:**
- [ ] GitHub Actions 워크플로우 작성
- [ ] Secrets 등록
- [ ] 자동 배포 테스트
- [ ] Vercel API 연동 확인 (변경 없음)

---

## 🛠️ 기술 스택

### Core

- **빌드 도구**: Vite 5.x
- **프레임워크**: Vue 3 (Composition API)
- **라우터**: Vue Router 4
- **상태 관리**: Pinia
- **언어**: JavaScript → TypeScript (점진적)

### Libraries

- **UI**: 기존 CSS 유지 (common.css)
- **지도**: 네이버 지도 API
- **차트**: Chart.js + vue-chartjs
- **Excel**: SheetJS (xlsx)
- **좌표 변환**: Proj4
- **HTTP**: Fetch API (래퍼 함수)
- **데이터베이스**: Supabase

### DevOps

- **배포**: GitHub Pages (프론트엔드)
- **API**: Vercel Serverless (백엔드)
- **CI/CD**: GitHub Actions
- **번들 분석**: rollup-plugin-visualizer
- **PWA**: vite-plugin-pwa

---

## ✅ 체크리스트

### Phase 0: 준비
- [ ] `vite-migration` 브랜치 생성
- [ ] 백업 태그 생성 (`backup-before-vite`)
- [ ] Vite 프로젝트 초기화
- [ ] `.gitignore` 업데이트 (`node_modules/`, `.env.local`)

### Phase 1: 기본 구조
- [ ] 폴더 구조 생성
- [ ] Vue Router 설정
- [ ] Pinia 설치 및 스토어 생성
- [ ] `.env.local` 파일 생성
- [ ] 환경변수 마이그레이션

### Phase 2: 컴포넌트 마이그레이션
- [ ] TopNav 컴포넌트
- [ ] GeminiChatbot 컴포넌트
- [ ] NaverMap 컴포넌트
- [ ] DashboardChart 컴포넌트
- [ ] Login 페이지
- [ ] Dashboard 페이지
- [ ] VisitLog 페이지
- [ ] Proposal 페이지
- [ ] Admin 페이지

### Phase 3: 외부 라이브러리
- [ ] 네이버 지도 API 통합
- [ ] SheetJS (Excel) 통합
- [ ] Chart.js 통합
- [ ] Proj4 좌표 변환

### Phase 4: PWA
- [ ] vite-plugin-pwa 설치
- [ ] manifest.json 마이그레이션
- [ ] Service Worker 설정
- [ ] 오프라인 모드 테스트

### Phase 5: 빌드 최적화
- [ ] 코드 스플리팅 설정
- [ ] 번들 크기 분석
- [ ] 레이지 로딩 적용
- [ ] Lighthouse 성능 측정

### Phase 6: 배포 자동화
- [ ] GitHub Actions 워크플로우 작성
- [ ] GitHub Secrets 등록
- [ ] 자동 배포 테스트
- [ ] Vercel API 연동 확인

### Phase 7: 최종 검증
- [ ] 전체 기능 테스트 (체크리스트 별도)
- [ ] 모바일 테스트 (iOS, Android)
- [ ] 오프라인 모드 테스트
- [ ] 성능 테스트 (Lighthouse 90+)
- [ ] 브라우저 호환성 (Chrome, Safari, Edge)

---

## 🧪 테스트 체크리스트

### 기능 테스트

- [ ] **인증**
  - [ ] 로그인/로그아웃
  - [ ] 세션 유지
  - [ ] 관리자 권한 체크

- [ ] **인허가 조회**
  - [ ] 공공데이터 API 호출
  - [ ] 지역 필터링
  - [ ] 담당자 필터링
  - [ ] 날짜 기반 스마트 로딩

- [ ] **지도 기능**
  - [ ] 네이버 지도 표시
  - [ ] 마커 표시
  - [ ] 동선 최적화
  - [ ] 현재 위치 조회

- [ ] **방문일지**
  - [ ] 방문 기록 작성
  - [ ] 오프라인 작성 후 동기화
  - [ ] Excel 다운로드

- [ ] **AI 챗봇**
  - [ ] Gemini API 호출
  - [ ] 대화 기록 저장
  - [ ] 설득 포인트 분석

- [ ] **제안서 생성**
  - [ ] 템플릿 로딩
  - [ ] 자동 데이터 입력
  - [ ] PDF/인쇄

- [ ] **리포트**
  - [ ] 차트 표시
  - [ ] 월간 리포트 생성
  - [ ] Excel 다운로드

### 성능 테스트

- [ ] 초기 로딩 3초 이내 (3G 환경)
- [ ] Lighthouse 성능 점수 90+
- [ ] 번들 크기 50KB 이하 (gzip)
- [ ] Service Worker 캐시 동작

### 브라우저 호환성

- [ ] Chrome 최신
- [ ] Safari 최신 (iOS 포함)
- [ ] Edge 최신
- [ ] Firefox 최신

---

## 🚨 롤백 계획

문제 발생 시 즉시 복구하는 방법:

### 방법 1: Git 태그로 롤백

```bash
# 백업 태그로 복구
git checkout backup-before-vite

# main 브랜치로 강제 복구 (위험!)
git reset --hard backup-before-vite
git push --force
```

### 방법 2: GitHub Pages 설정 변경

```
Settings → Pages
→ Source: Deploy from a branch
→ Branch: main (기존 브랜치로 변경)
```

### 방법 3: Vercel에서 이전 배포 버전 활성화

```
Vercel 대시보드
→ Deployments
→ 이전 버전 클릭
→ "Promote to Production"
```

---

## 📚 참고 자료

### 공식 문서

- [Vite 공식 문서](https://vitejs.dev/)
- [Vue 3 공식 문서](https://vuejs.org/)
- [Vue Router 문서](https://router.vuejs.org/)
- [Pinia 문서](https://pinia.vuejs.org/)
- [vite-plugin-pwa](https://vite-pwa-org.netlify.app/)

### 마이그레이션 가이드

- [Legacy HTML → Vite 마이그레이션](https://vitejs.dev/guide/migration.html)
- [Vue 2 → Vue 3 마이그레이션](https://v3-migration.vuejs.org/)

---

## 📞 문제 발생 시 대응

### 1단계: 로그 확인

```bash
# 빌드 에러
npm run build 2>&1 | tee build.log

# 개발 서버 에러
npm run dev 2>&1 | tee dev.log
```

### 2단계: 이슈 트래킹

GitHub Issues에 다음 정보 포함:
- [ ] 에러 메시지 (전체)
- [ ] 재현 방법
- [ ] 환경 정보 (OS, Node 버전)
- [ ] 스크린샷

### 3단계: 커뮤니티 활용

- Stack Overflow (태그: vite, vue3)
- Vite Discord
- Vue Forum

---

## 📅 타임라인

```
Week 1: Phase 0-1 (준비 + 기본 구조)
Week 2: Phase 2-3 (컴포넌트 마이그레이션 + 라이브러리)
Week 3: Phase 4-5 (PWA + 최적화)
Week 4: Phase 6-7 (배포 + 최종 검증)
```

---

## ✨ 완료 후 기대 효과

- 🚀 **성능**: 초기 로딩 3초 → 1초 이내
- 🛠️ **개발 속도**: HMR로 즉시 반영
- 🎨 **유지보수**: 컴포넌트 재사용으로 코드 중복 제거
- 🔒 **보안**: 환경변수 안전 관리
- 📱 **PWA**: 오프라인 모드 강화
- 🧪 **테스트**: 컴포넌트 단위 테스트 가능

---

**작성자**: Claude (AI Assistant)
**최종 수정**: 2026-02-28
**버전**: 1.0
