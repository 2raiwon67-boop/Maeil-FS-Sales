'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { CACHE_TTL_MS } from '@/lib/dashboard/constants';
import type { License, Account } from '@/types';

interface DashboardData {
  licenses: License[];
  accounts: Account[];
  loading: boolean;
  error: string | null;
  reload: () => void;
  /** 좌표가 채워진 라이선스/거래처를 갱신할 때 사용 (지오코딩 후) */
  setLicenses: React.Dispatch<React.SetStateAction<License[]>>;
  setAccounts: React.Dispatch<React.SetStateAction<Account[]>>;
}

function readCache<T>(key: string): T[] | null {
  try {
    const raw = localStorage.getItem(key);
    const ts = Number(localStorage.getItem(key + '_ts') || 0);
    if (raw && Date.now() - ts < CACHE_TTL_MS) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return null;
}

function writeCache<T>(key: string, data: T[]) {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(key + '_ts', Date.now().toString());
  } catch {
    /* quota — ignore */
  }
}

export function useDashboardData(): DashboardData {
  // viewUnit: 일반 사용자는 자기 소속, 사업부 계정은 네비에서 선택한 지점
  const { viewUnit } = useAuth();
  const businessUnit = viewUnit;
  const supabase = createClient();

  const [licenses, setLicenses] = useState<License[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    if (!businessUnit) return;
    let cancelled = false;

    // v2: 구 정적사이트와 origin이 같아 옛 캐시가 남아 마커가 옛 데이터로 고정되던 문제 → 키 분리
    const licKey = `fs_licenses_v2_${businessUnit}`;
    const accKey = `fs_accounts_v2_${businessUnit}`;

    async function load() {
      setError(null);

      // 캐시는 "즉시 표시"용으로만 쓰고, 항상 DB로 재검증한다(stale-while-revalidate).
      // 예전엔 캐시가 있으면 return해서 DB를 안 읽어 → 옛/불완전 캐시로 마커·카운트가 고정됐음.
      let hadCache = false;
      if (reloadKey === 0) {
        const cachedLic = readCache<License>(licKey);
        const cachedAcc = readCache<Account>(accKey);
        if (cachedLic && cachedAcc) {
          hadCache = true;
          if (!cancelled) {
            setLicenses(cachedLic);
            setAccounts(cachedAcc);
            setLoading(false);
          }
        }
      }
      if (!hadCache && !cancelled) setLoading(true);

      try {
        const [licRes, accRes] = await Promise.all([
          supabase.from('licenses').select('*').eq('business_unit', businessUnit),
          supabase.from('accounts').select('*').eq('business_unit', businessUnit),
        ]);
        if (licRes.error) throw licRes.error;
        if (accRes.error) throw accRes.error;

        const lic = (licRes.data ?? []).filter(
          (r: License) => r.business_name && String(r.business_name).trim() !== '',
        );
        const acc = (accRes.data ?? []).filter(
          (r: Account) => r.business_name && String(r.business_name).trim() !== '',
        );

        if (!cancelled) {
          setLicenses(lic);
          setAccounts(acc);
          writeCache(licKey, lic);
          writeCache(accKey, acc);
          setLoading(false);
        }
      } catch (e) {
        if (!cancelled) {
          if (!hadCache) setError((e as Error).message); // 캐시라도 떠 있으면 에러로 덮지 않음
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessUnit, reloadKey]);

  return { licenses, accounts, loading, error, reload, setLicenses, setAccounts };
}
