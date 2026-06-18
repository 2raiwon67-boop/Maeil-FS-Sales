import type { MetadataRoute } from 'next';

// PWA 웹 앱 매니페스트 — 원본 manifest.json 포팅 (start_url은 Next 라우트 '/'로 변경)
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'FS MISO 인허가 관리',
    short_name: 'MISO',
    description: '매일유업 필드세일즈 인허가 및 영업 관리 앱',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#1d1d1f',
    theme_color: '#1d1d1f',
    lang: 'ko',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-192x192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512x512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: '인허가 지도',
        url: '/',
        description: '인허가 현황 지도',
      },
    ],
  };
}
