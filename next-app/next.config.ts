import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
