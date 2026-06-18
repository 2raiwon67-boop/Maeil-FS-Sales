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
  const { metadata } = useAuth();
  const businessUnit = metadata?.business_unit ?? null;
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

    const licKey = `fs_licenses_${businessUnit}`;
    const accKey = `fs_accounts_${businessUnit}`;

    async function load() {
      setLoading(true);
      setError(null);

      // 캐시 우선 (force reload 시 무시)
      if (reloadKey === 0) {
        const cachedLic = readCache<License>(licKey);
        const cachedAcc = readCache<Account>(accKey);
        if (cachedLic && cachedAcc) {
          if (!cancelled) {
            setLicenses(cachedLic);
            setAccounts(cachedAcc);
            setLoading(false);
          }
          return;
        }
      }

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
          setError((e as Error).message);
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
