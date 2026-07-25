'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import {
  Store,
  FileText,
  Map as MapIcon,
  Database,
  Search,
  MapPin,
  ChevronDown,
  Settings,
  ShieldCheck,
  LogOut,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';
import { SettingsModal } from '@/components/layout/settings-modal';
import { NotificationBell } from '@/components/layout/notification-bell';

// PC는 4탭 유지 — 메뉴 상담은 견적서 화면의 버튼으로 오가는 보조 플로우
const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: '/', label: '거래처', icon: Store },
  { href: '/proposal', label: '견적서', icon: FileText },
  { href: '/discover', label: '시장 분석', icon: MapIcon },
  { href: '/upload', label: '데이터 관리', icon: Database },
];

const NAVY = '#1B3F82';

function LogoLockup() {
  return (
    <Link href="/" className="flex items-center gap-2.5">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/images/logo.png" alt="Maeil" className="h-[19px] w-auto" />
      <span
        className="text-[17px] font-medium leading-none tracking-[0.04em]"
        style={{ color: NAVY }}
      >
        MISO
      </span>
    </Link>
  );
}

export function NavBar() {
  const pathname = usePathname();
  const { metadata, signOut } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const fullName = metadata?.full_name ?? '';
  const unit = metadata?.business_unit ?? '';
  const initials = fullName ? fullName.slice(0, 2) : '∙';

  return (
    <>
      {/* 데스크톱 — 화이트 2단 셸바 */}
      <nav className="sticky top-0 z-50 hidden h-[88px] flex-col border-b border-[#e8ebf0] bg-white md:flex">
        {/* 상단 유틸 행 */}
        <div className="flex h-12 items-center gap-4 px-5">
          <LogoLockup />

          <button
            type="button"
            onClick={() => toast('전역 검색은 곧 제공됩니다')}
            className="flex max-w-[320px] flex-1 items-center gap-2 rounded-lg bg-[#f3f5f8] px-3 py-2 text-left text-xs text-[#94a3b8] transition-colors hover:bg-[#eceff4]"
          >
            <Search className="h-4 w-4 shrink-0" />
            <span className="truncate">거래처·인허가·매장 검색</span>
          </button>

          <div className="flex-1" />

          {unit && (
            <span
              className="hidden items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium lg:inline-flex"
              style={{ background: '#eef3fb', color: NAVY }}
            >
              <MapPin className="h-3.5 w-3.5" />
              {unit}
            </span>
          )}

          <NotificationBell />

          <div className="relative border-l border-[#e8ebf0] pl-3">
            <button
              type="button"
              className="flex items-center gap-2"
              onClick={() => setDropdownOpen((o) => !o)}
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-medium text-white"
                style={{ background: NAVY }}
              >
                {initials}
              </span>
              <span className="text-[13px] text-[#0f172a]">{fullName || '사용자'}</span>
              <ChevronDown className="h-3.5 w-3.5 text-[#94a3b8]" />
            </button>
            {dropdownOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setDropdownOpen(false)} />
                <div className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-xl border border-[#e8ebf0] bg-white py-1 shadow-lg">
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#334155] hover:bg-gray-50"
                    onClick={() => {
                      setDropdownOpen(false);
                      setSettingsOpen(true);
                    }}
                  >
                    <Settings className="h-4 w-4" />
                    설정
                  </button>
                  <Link
                    href="/admin"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-[#334155] hover:bg-gray-50"
                    onClick={() => setDropdownOpen(false)}
                  >
                    <ShieldCheck className="h-4 w-4" />
                    관리자
                  </Link>
                  <hr className="my-1 border-[#eef1f5]" />
                  <button
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-red-600 hover:bg-gray-50"
                    onClick={() => {
                      setDropdownOpen(false);
                      signOut();
                    }}
                  >
                    <LogOut className="h-4 w-4" />
                    로그아웃
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 하단 모듈 행 */}
        <div className="flex flex-1 items-stretch gap-1 border-t border-[#eef1f5] bg-[#f8fafc] px-5">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-1.5 border-b-2 px-3 text-[13px] transition-colors',
                  active
                    ? 'font-medium'
                    : 'border-transparent text-[#64748b] hover:text-[#334155]',
                )}
                style={active ? { borderColor: NAVY, color: NAVY } : undefined}
              >
                <Icon className="h-[15px] w-[15px]" />
                {item.label}
              </Link>
            );
          })}
          {/* 페이지 전용 컨트롤 슬롯 (예: 홈의 '개척 모드' 스위치) — 각 페이지가 포털로 채움 */}
          <div id="nav-right-slot" className="ml-auto flex items-center" />
        </div>
      </nav>

      {/* 모바일 — 슬림 로고 바 (네비게이션은 하단 탭바가 담당) */}
      <header className="sticky top-0 z-40 flex h-12 items-center gap-2 border-b border-[#e8ebf0] bg-white px-4 md:hidden">
        <LogoLockup />
        <div className="ml-auto flex items-center gap-2">
          <div id="nav-right-slot-mobile" className="flex items-center" />
          {unit && (
            <span
              className="inline-flex max-w-[108px] items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium"
              style={{ background: '#eef3fb', color: NAVY }}
            >
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{unit}</span>
            </span>
          )}
          <NotificationBell />
        </div>
      </header>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </>
  );
}
