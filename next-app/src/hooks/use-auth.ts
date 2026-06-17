'use client';

import { useEffect, useState, useCallback } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useRouter } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import type { UserMetadata } from '@/types';

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const supabase = createClient();
  const router = useRouter();

  useEffect(() => {
    const getUser = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      setUser(user);
      setLoading(false);
    };

    getUser();

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, [supabase]);

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
