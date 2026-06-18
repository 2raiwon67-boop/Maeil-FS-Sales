// 매장 메모 — localStorage (원본 maeil_memo_ prefix)
const PREFIX = 'maeil_memo_';

export function getMemo(name: string): string {
  try {
    return localStorage.getItem(PREFIX + name) || '';
  } catch {
    return '';
  }
}

export function setMemo(name: string, value: string): void {
  try {
    if (value.trim()) localStorage.setItem(PREFIX + name, value);
    else localStorage.removeItem(PREFIX + name);
  } catch {
    /* ignore */
  }
}

export function deleteMemo(name: string): void {
  try {
    localStorage.removeItem(PREFIX + name);
  } catch {
    /* ignore */
  }
}
