export const PERF_KEY = 'miso_performance_v1';
export const PERF_ROUTES = ['/', '/discover', '/quotes', '/licenses', '/upload', '/admin', '/other'] as const;
export interface PerformanceSample {
  version: 1; at: string; route: string; mobile: boolean; pwa: boolean;
  platform: 'ios' | 'android' | 'other';
  durationMs: number; mapReadyMs: number | null; dataReadyMs: number | null;
  longTasks: number | null; blockingMs: number | null; maxInteractionMs: number | null;
  errors: number;
}
let active: { sample: PerformanceSample; started: number } | null = null;

export function markPerformance(name: 'mapReadyMs' | 'dataReadyMs') {
  if (!active || active.sample[name] !== null) return;
  active.sample[name] = Math.round(performance.now() - active.started);
}

export function readPerformanceSamples(): PerformanceSample[] {
  try { const value = JSON.parse(localStorage.getItem(PERF_KEY) || '[]'); return Array.isArray(value) ? value.slice(-30).map(validatePerformance).filter((s): s is PerformanceSample => s !== null) : []; }
  catch { return []; }
}

/** One bounded sample per route visit; no store names, URL parameters, user IDs or error text. */
export function observePerformance(pathname: string) {
  const supported = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver.supportedEntryTypes : [];
  const started = performance.now();
  const sample: PerformanceSample = {
    version: 1, at: new Date().toISOString(), route: PERF_ROUTES.includes(pathname as typeof PERF_ROUTES[number]) ? pathname : '/other',
    mobile: matchMedia('(max-width: 767px)').matches,
    pwa: matchMedia('(display-mode: standalone)').matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone),
    platform: /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'ios' : /Android/.test(navigator.userAgent) ? 'android' : 'other',
    durationMs: 0, mapReadyMs: null, dataReadyMs: null,
    longTasks: supported.includes('longtask') ? 0 : null, blockingMs: supported.includes('longtask') ? 0 : null,
    maxInteractionMs: null, errors: 0,
  };
  const current = { sample, started };
  active = current;
  const observers: PerformanceObserver[] = [];
  if (supported.includes('longtask')) {
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) { sample.longTasks!++; sample.blockingMs! += Math.round(Math.max(0, e.duration - 50)); }
    });
    try { observer.observe({ type: 'longtask' }); observers.push(observer); }
    catch { sample.longTasks = null; sample.blockingMs = null; }
  }
  if (supported.includes('event')) {
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) sample.maxInteractionMs = Math.max(sample.maxInteractionMs ?? 0, Math.round(e.duration));
    });
    try { observer.observe({ type: 'event', durationThreshold: 40 } as PerformanceObserverInit); observers.push(observer); }
    catch { /* Unsupported observer options must not interrupt the app. */ }
  }
  const onError = () => { sample.errors = Math.min(10000, sample.errors + 1); };
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    observers.forEach(o => o.disconnect());
    removeEventListener('error', onError); removeEventListener('unhandledrejection', onError);
    removeEventListener('pagehide', finish); document.removeEventListener('visibilitychange', onVisibility);
    sample.durationMs = Math.round(performance.now() - started);
    if (active === current) active = null;
    if (sample.durationMs < 500) return; // React development effect replay / immediate redirects
    try { localStorage.setItem(PERF_KEY, JSON.stringify([...readPerformanceSamples(), sample].slice(-30))); } catch { /* quota/private mode */ }
    void fetch('/api/performance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sample), keepalive: true }).catch(() => {});
  };
  const onVisibility = () => { if (document.visibilityState === 'hidden') finish(); };
  const timer = setTimeout(finish, 60000);
  addEventListener('error', onError); addEventListener('unhandledrejection', onError);
  addEventListener('pagehide', finish); document.addEventListener('visibilitychange', onVisibility);
  return finish;
}

/** Explicit allowlist: never log arbitrary request properties. */
export function validatePerformance(value: unknown): PerformanceSample | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const n = (key: string, nullable = false) => nullable && v[key] === null || typeof v[key] === 'number' && Number.isFinite(v[key]) && (v[key] as number) >= 0 && (v[key] as number) <= 3600000;
  if (v.version !== 1 || typeof v.at !== 'string' || !Number.isFinite(Date.parse(v.at)) || v.at.length > 30
    || !PERF_ROUTES.includes(v.route as typeof PERF_ROUTES[number]) || !['ios', 'android', 'other'].includes(String(v.platform))
    || typeof v.mobile !== 'boolean' || typeof v.pwa !== 'boolean'
    || !['durationMs', 'errors'].every(k => n(k)) || !['mapReadyMs', 'dataReadyMs', 'longTasks', 'blockingMs', 'maxInteractionMs'].every(k => n(k, true))) return null;
  return Object.fromEntries(['version', 'at', 'route', 'mobile', 'pwa', 'platform', 'durationMs', 'mapReadyMs', 'dataReadyMs', 'longTasks', 'blockingMs', 'maxInteractionMs', 'errors'].map(k => [k, v[k]])) as unknown as PerformanceSample;
}
