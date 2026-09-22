'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Home, TrendingUp, FileText, ClipboardList, User, Settings, LogOut } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { SettingsModal } from '@/components/layout/settings-modal';

const TABS = [
  { href: '/', label: '거래처', icon: Home },
  { href: '/discover', label: '시장분석', icon: TrendingUp },
  { href: '/proposal', label: '견적서', icon: FileText },
  { href: '/license-export', label: '인허가', icon: ClipboardList },
];

export function MobileTabBar() {
  const pathname = usePathname();
  const { metadata, signOut } = useAuth();
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 상담 모드는 사장님께 보여주는 presenter 화면 — 탭바를 숨겨 몰입 유지
  if (pathname === '/consult') return null;

  return (
    <>
      {profileOpen && (
        <div className="fixed inset-0 z-[800] bg-black/40 md:hidden" onClick={() => setProfileOpen(false)} />
      )}
      {profileOpen && (
        <div className="fixed bottom-[calc(var(--app-tabbar-h)+0.5rem)] left-4 right-4 z-[810] rounded-2xl bg-white p-4 shadow-xl md:hidden">
          <p className="mb-3 text-center font-semibold">
            {metadata?.full_name
              ? metadata.business_unit
                ? `${metadata.full_name}님 (${metadata.business_unit})`
                : `${metadata.full_name}님`
              : '사용자'}
          </p>
          <div className="flex flex-col gap-2">
            <Button
              variant="outline"
              className="justify-start gap-2"
              onClick={() => { setProfileOpen(false); setSettingsOpen(true); }}
            >
              <Settings className="h-4 w-4" />설정
            </Button>
            <Separator />
            <Button variant="destructive" className="gap-2" onClick={() => { setProfileOpen(false); signOut(); }}>
              <LogOut className="h-4 w-4" />로그아웃
            </Button>
          </div>
        </div>
      )}

      {/* 홈 제스처 영역은 투명하게 남겨 지도가 이어 보이게 한다. */}
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-50 h-[var(--app-tabbar-h)] px-2 pb-[calc(var(--safe-bottom)+6px)] md:hidden">
      <nav aria-label="하단 메뉴" className="mobile-glass pointer-events-auto relative flex h-12 items-center justify-around rounded-2xl border border-slate-200/70 bg-white">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              onClick={() => setProfileOpen(false)}
              className={cn(
                'flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[11px] leading-4 transition-colors duration-100 active:bg-blue-50',
                active ? 'text-blue-700 font-semibold' : 'text-slate-600',
              )}
            >
              <Icon className="h-[18px] w-[18px]" />
              <span>{tab.label}</span>
            </Link>
          );
        })}

        <button
          className="flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-xl py-1 text-[11px] leading-4 text-slate-600 active:bg-blue-50"
          onClick={() => setProfileOpen(!profileOpen)}
          aria-expanded={profileOpen}
        >
          <User className="h-[18px] w-[18px]" />
          <span>프로필</span>
        </button>
      </nav>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
