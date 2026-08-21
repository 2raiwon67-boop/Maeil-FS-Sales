'use client';

import { createContext, useEffect, useMemo, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePathname, useRouter } from 'next/navigation';
import type { User, SupabaseClient } from '@supabase/supabase-js';
import { HQ_UNIT, BRANCH_UNITS } from '@/types';
import type { UserMetadata } from '@/types';

// 앱 전체에서 인증 상태를 1회만 조회·구독해 공유한다.
// 이전에는 useAuth()를 부르는 훅마다(page + useDashboardData + useManager) getUser 요청과
// onAuthStateChange 구독이 각각 생겨 초기 로딩에 같은 왕복이 3번 발생했다.
export interface AuthContextValue {
  user: User | null;
  metadata: UserMetadata | undefined;
  loading: boolean;
  signOut: () => Promise<void>;
  supabase: SupabaseClient;
  /** 사업부(본부 조회 계정) 여부 — 지점을 골라 열람하고 쓰기는 막힌다 */
  isHq: boolean;
  /** 관리자 계정(app_metadata.is_admin) — 지점 소속을 유지한 채 전 지점 열람 가능 */
  isAdminAccount: boolean;
  /** 지점 드롭다운 노출 여부 (사업부 또는 관리자) */
  canSwitchUnit: boolean;
  /** 조회 전용 상태 — 사업부이거나, 관리자가 자기 지점이 아닌 곳을 보는 중 */
  isReadOnlyView: boolean;
  /** 데이터 조회 기준 지점. 일반 사용자는 자기 소속, 사업부·관리자는 선택한 지점 */
  viewUnit: string | null;
  setViewUnit: (unit: string) => void;
}

const VIEW_UNIT_KEY = 'fs_view_unit';

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  // 사업부 계정이 보고 있는 지점. SSR·하이드레이션 불일치를 피해 localStorage는 effect에서 복원.
  const [hqUnit, setHqUnit] = useState<string>(BRANCH_UNITS[0]);
  // 관리자가 열람 중인 다른 지점(null = 자기 지점). 세션 한정 — 재접속 시 자기 지점으로 복귀해
  // "내 화면이 남의 지점에 멈춰 있는" 혼란을 막는다.
  const [adminUnit, setAdminUnit] = useState<string | null>(null);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const t = setTimeout(() => {
      try {
        const saved = localStorage.getItem(VIEW_UNIT_KEY);
        if (saved && (BRANCH_UNITS as string[]).includes(saved)) setHqUnit(saved);
      } catch { /* ignore */ }
    }, 0);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    const getUser = async () => {
      const { data: { user }, error } = await supabase.auth.getUser();
      // 세션 만료(JWT expired)·무효인데 localStorage 잔존 세션 때문에 '로그인된 듯한'
      // 유령 상태가 되면 모든 RLS 조회가 조용히 빈 값이 됨 — 정리 후 재로그인 유도.
      // 네트워크 일시 오류(status 0 등)는 로그아웃 사유가 아니므로 제외.
      const authDead = !user && (!error || error.status === 401 || error.status === 403 || /expired|invalid/i.test(error.message));
      if (authDead && pathname !== '/login') {
        await supabase.auth.signOut({ scope: 'local' });
        router.replace('/login');
        return;
      }
      setUser(user);
      setLoading(false);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supabase, pathname]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/login');
  }, [supabase, router]);

  const setViewUnit = useCallback((unit: string) => {
    if (!(BRANCH_UNITS as string[]).includes(unit)) return;
    const meta = user?.user_metadata as UserMetadata | undefined;
    if (meta?.business_unit === HQ_UNIT) {
      setHqUnit(unit);
      try { localStorage.setItem(VIEW_UNIT_KEY, unit); } catch { /* ignore */ }
    } else {
      // 관리자: 자기 지점을 고르면 일반 모드(쓰기 가능)로 복귀
      setAdminUnit(unit === meta?.business_unit ? null : unit);
    }
  }, [user]);

  const value = useMemo<AuthContextValue>(() => {
    const metadata = user?.user_metadata as UserMetadata | undefined;
    const ownUnit = metadata?.business_unit ?? null;
    const isHq = ownUnit === HQ_UNIT;
    const isAdminAccount = user?.app_metadata?.is_admin === true;
    const viewUnit = isHq ? hqUnit : (isAdminAccount && adminUnit ? adminUnit : ownUnit);
    return {
      user,
      metadata,
      loading,
      signOut,
      supabase,
      isHq,
      isAdminAccount,
      canSwitchUnit: isHq || isAdminAccount,
      isReadOnlyView: isHq || (isAdminAccount && viewUnit !== ownUnit),
      viewUnit,
      setViewUnit,
    };
  }, [user, loading, signOut, supabase, hqUnit, adminUnit, setViewUnit]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
