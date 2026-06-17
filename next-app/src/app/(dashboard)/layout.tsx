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
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
      <MobileTabBar />
    </>
  );
}
