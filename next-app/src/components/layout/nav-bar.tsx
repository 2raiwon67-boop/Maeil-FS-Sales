'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { SettingsModal } from '@/components/layout/settings-modal';

const NAV_ITEMS = [
  { href: '/', label: '거래처' },
  { href: '/proposal', label: '견적서' },
  { href: '/discover', label: '시장 분석', mobileHide: true },
  { href: '/upload', label: '데이터 관리', mobileHide: true },
];

export function NavBar() {
  const pathname = usePathname();
  const { metadata, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const displayName = metadata?.full_name
    ? metadata.business_unit
      ? `${metadata.full_name}님 (${metadata.business_unit})`
      : `${metadata.full_name}님`
    : '';

  return (
    <nav className="sticky top-0 z-50 flex items-center justify-between bg-[#1a1a2e] px-4 py-3 text-white shadow-md">
      <div className="flex items-center gap-4">
        <Link href="/" className="text-lg font-bold tracking-wide text-white">
          FS MISO
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-white/10',
                pathname === item.href
                  ? 'bg-white/15 font-medium text-white'
                  : 'text-gray-300',
                item.mobileHide && 'hidden lg:inline-flex',
              )}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </div>

      <div className="relative hidden md:block">
        <button
          className="text-sm text-gray-300 hover:text-white"
          onClick={() => setDropdownOpen(!dropdownOpen)}
        >
          {displayName}
        </button>
        {dropdownOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
            <div className="absolute right-0 top-full z-50 mt-2 w-48 rounded-md border bg-white py-1 shadow-lg">
              <button
                className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100"
                onClick={() => { setDropdownOpen(false); setSettingsOpen(true); }}
              >
                설정
              </button>
              <hr className="my-1" />
              <button
                className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-100"
                onClick={() => { setDropdownOpen(false); signOut(); }}
              >
                로그아웃
              </button>
            </div>
          </>
        )}
      </div>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </nav>
  );
}
