import { NavBar } from '@/components/layout/nav-bar';
import { MobileTabBar } from '@/components/layout/mobile-tab-bar';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <NavBar />
      {/* 하단 여백은 탭바 실제 높이(안전영역 포함)와 묶는다 — pb-16 고정값은 홈 인디케이터 기기에서 모자랐다 */}
      <main className="flex-1 pb-[var(--app-tabbar-h)] md:pb-0">{children}</main>
      <MobileTabBar />
    </>
  );
}
