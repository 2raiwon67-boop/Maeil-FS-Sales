// 전역 사용자 설정 — 색각 보정 모드 (localStorage + 같은 탭 내 변경 전파)
// 프로필▸설정 모달과 거래처 대시보드 사이드바가 같은 값을 공유한다.
const COLORBLIND_KEY = 'fs_colorblind';
const EVENT = 'fs-colorblind-change';

export function getColorblind(): boolean {
  try {
    return localStorage.getItem(COLORBLIND_KEY) === '1';
  } catch {
    return false;
  }
}

export function setColorblind(value: boolean): void {
  try {
    localStorage.setItem(COLORBLIND_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: value }));
  }
}

/** 색각 보정 값 변경 구독 (같은 탭). 해제 함수 반환. */
export function onColorblindChange(cb: (value: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = (e: Event) => cb((e as CustomEvent<boolean>).detail);
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
