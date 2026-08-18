'use client';

import { createContext, useEffect, useMemo, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePathname, useRouter } from 'next/navigation';
import type { User, SupabaseClient } from '@supabase/supabase-js';
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
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const pathname = usePathname();

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

  const value = useMemo<AuthContextValue>(() => ({
    user,
    metadata: user?.user_metadata as UserMetadata | undefined,
    loading,
    signOut,
    supabase,
  }), [user, loading, signOut, supabase]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
