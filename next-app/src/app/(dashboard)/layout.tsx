'use client';

import { usePathname } from 'next/navigation';
import { NavBar } from '@/components/layout/nav-bar';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const mapScreen = pathname === '/' || pathname === '/discover';
  return (
    <>
      <NavBar />
      {/* 지도는 홈 인디케이터까지 이어지고, 일반 문서는 탭바 공간을 따로 확보한다. */}
      <main className={mapScreen ? 'min-h-0 flex-1' : 'flex-1 pb-[var(--app-tabbar-h)] md:pb-0'}>{children}</main>
      <MobileTabBar />
    </>
  );
}
