'use client';

// 서비스워커 등록 (PWA). 프로덕션에서만 등록해 개발 중 HMR 캐시 간섭 방지.
import { useEffect } from 'react';

export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((e) => console.warn('[pwa] SW 등록 실패', e));
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  return null;
}
