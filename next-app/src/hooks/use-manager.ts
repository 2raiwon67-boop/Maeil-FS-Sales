'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';

/** 현재 로그인 사용자의 담당자명(myManagerName)을 식별. 지점장/미등록은 null. */
export function useManager(): { myManagerName: string | null; loading: boolean } {
  const { user, metadata } = useAuth();
  const businessUnit = metadata?.business_unit ?? null;
  const email = user?.email ?? null;
  const [myManagerName, setMyManagerName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!businessUnit || !email) {
        // user는 로드됐지만 소속/이메일이 없으면 더 조회할 게 없음
        if (!cancelled && user) {
          setMyManagerName(null);
          setLoading(false);
        }
        return;
      }
      const supabase = createClient();
      try {
        const { data } = await supabase
          .from('managers')
          .select('manager_name, region2')
          .eq('business_unit', businessUnit)
          .eq('email', email)
          .neq('region2', '지점장')
          .neq('region2', '전체')
          .limit(1);
        if (!cancelled) setMyManagerName(data?.[0]?.manager_name ?? null);
      } catch {
        if (!cancelled) setMyManagerName(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessUnit, email, user]);

  return { myManagerName, loading };
}
