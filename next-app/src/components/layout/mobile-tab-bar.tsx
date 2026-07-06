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

  return (
    <>
      {profileOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setProfileOpen(false)} />
      )}
      {profileOpen && (
        <div className="fixed bottom-16 left-4 right-4 z-50 rounded-2xl bg-white p-4 shadow-xl md:hidden">
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

      <div className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = pathname === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'flex flex-1 flex-col items-center gap-0.5 py-2 text-xs transition-colors',
                active ? 'text-blue-600' : 'text-gray-500',
              )}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </Link>
          );
        })}

        <button
          className="flex flex-1 flex-col items-center gap-0.5 py-2 text-xs text-gray-500"
          onClick={() => setProfileOpen(!profileOpen)}
        >
          <User className="h-5 w-5" />
          <span>프로필</span>
        </button>
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
