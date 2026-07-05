'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePathname, useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { UserMetadata } from '@/types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
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

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    return { data, error };
  }, [supabase]);

  const signUp = useCallback(async (
    email: string,
    password: string,
    metadata: Partial<UserMetadata> = {},
  ) => {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { ...metadata, approved: false } },
    });
    return { data, error };
  }, [supabase]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.push('/login');
  }, [supabase, router]);

  const metadata = user?.user_metadata as UserMetadata | undefined;

  return {
    user,
    metadata,
    loading,
    signIn,
    signUp,
    signOut,
    supabase,
  };
}
