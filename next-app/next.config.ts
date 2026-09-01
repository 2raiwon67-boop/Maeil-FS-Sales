import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 자동 메모이제이션 — discover 등 대형 클라 컴포넌트의 렌더당 대량 재계산을 컴파일 타임에 제거.
  // 코드베이스는 이미 react-compiler 린트 규칙을 지키며 작성돼 있음.
  reactCompiler: true,
  turbopack: {
    root: __dirname,
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'hcqbmilmldeeuydtrayx.supabase.co',
      },
    ],
  },
  async redirects() {
    return [
      // 구 정적사이트 시절 PWA(manifest start_url='./index.html')로 설치한 사용자는
      // 홈 화면 아이콘 → /index.html 을 여는데 Next엔 그 라우트가 없어 404가 났음.
      // 재설치 없이 복구되도록 앱 홈('/')으로 리다이렉트.
      { source: '/index.html', destination: '/', permanent: true },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        // 행정경계 지오데이터(3.3MB)는 사실상 불변(2013 경계) — 세션마다 재다운로드 방지.
        // 경계 파일을 교체할 일이 생기면 파일명을 바꿔서 배포할 것(캐시 무효화).
        source: '/geojson/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=2592000, stale-while-revalidate=86400' },
        ],
      },
      {
        // 상품 이미지·로고 등 정적 자산 — 변경 빈도 낮음
        source: '/assets/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=604800, stale-while-revalidate=86400' },
        ],
      },
      {
        // 서비스워커는 항상 최신본을 받도록 캐시 금지
        source: '/sw.js',
        headers: [
          { key: 'Content-Type', value: 'application/javascript; charset=utf-8' },
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        ],
      },
    ];
  },
};

export default nextConfig;
