import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import { PwaRegister } from '@/components/pwa-register';
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
    statusBarStyle: 'black-translucent',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  // iOS에서 env(safe-area-inset-*)이 실제 값을 갖게 하는 유일한 스위치.
  // 이게 없으면 탭바의 pb-[env(safe-area-inset-bottom)]이 항상 0으로 계산돼 죽은 코드가 된다.
  // statusBarStyle이 'black-translucent'라 콘텐츠가 상태바 아래로 파고드는데(위 metadata),
  // cover + safe-area 패딩이 짝을 이뤄야 헤더가 노치에 가려지지 않는다.
  viewportFit: 'cover',
  themeColor: '#1d1d1f',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        {children}
        <Toaster richColors position="top-center" />
        <PwaRegister />
      </body>
    </html>
  );
}
