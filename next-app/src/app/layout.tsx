import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { PwaRegister } from '@/components/pwa-register';
import { AuthProvider } from '@/components/auth-provider';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'FS MISO',
  description: 'FS 영업사원을 위한 All-In-One 대시보드',
  appleWebApp: {
    capable: true,
    title: 'MISO',
    // Translucent status bars can offset standalone iOS content upward and leave
    // a bottom gap equal to the status-bar height (WebKit #236445 / #301994).
    statusBarStyle: 'default',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // Keep bottom/landscape safe areas, while iOS owns the default status bar.
  viewportFit: 'cover',
  themeColor: '#ffffff',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}
    >
      <head>
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        {/* Supabase(REST·Auth·Storage 이미지/PDF) 사전 연결 — 첫 데이터·이미지 요청의 DNS/TLS 왕복 절감 */}
        {process.env.NEXT_PUBLIC_SUPABASE_URL && (
          <link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="anonymous" />
        )}
        {/* dynamic-subset: 페이지에 실제 쓰인 유니코드 블록만 내려받음(전체 세트 대비 수십 KB 수준).
            globals.css의 @import 직렬 체인 대신 문서 head에서 앱 CSS와 병렬 로드. */}
        <link
          rel="stylesheet"
          precedence="default"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css"
        />
      </head>
      <body className="flex min-h-dvh flex-col">
        <AuthProvider>{children}</AuthProvider>
        <Toaster richColors position="top-center" />
        <PwaRegister />
      </body>
    </html>
  );
}
