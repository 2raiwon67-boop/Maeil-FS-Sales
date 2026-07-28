'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Bell, Check, Inbox } from 'lucide-react';

interface Notif {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const DOT: Record<string, string> = {
  license_new: '#16a34a',
  license_revisit: '#d97706',
  license_open: '#2563eb',
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return '방금';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}일 전`;
  return new Date(iso).toLocaleDateString('ko-KR');
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notif[]>([]);
  const [unread, setUnread] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/notifications');
        if (!res.ok || !active) return;
        const d = await res.json();
        if (!active) return;
        setItems(d.items || []);
        setUnread(d.unread || 0);
      } catch {
        // 무시 — 알림은 부가 기능
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const markAllRead = async () => {
    if (!unread) return;
    setUnread(0);
    setItems((prev) => prev.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })));
    try {
      await fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
    } catch {
      // 무시
    }
  };

  const openItem = (n: Notif) => {
    setOpen(false);
    if (!n.read_at) {
      setUnread((u) => Math.max(0, u - 1));
      setItems((prev) => prev.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)));
      fetch('/api/notifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [n.id] }),
      }).catch(() => {});
    }
    if (n.link) {
      const m = n.link.match(/[?&]focus=([^&]+)/);
      if (m) window.dispatchEvent(new CustomEvent('fs-focus-store', { detail: decodeURIComponent(m[1]) }));
      router.push(n.link);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        // 모바일 터치 타깃 확보(44px) — p-1.5만으론 30×30이라 손가락으로 놓치기 쉬웠다. 데스크톱은 기존 크기 유지
        className="relative inline-flex h-11 w-11 items-center justify-center rounded-md text-[#475569] transition-colors hover:bg-gray-100 md:h-auto md:w-auto md:p-1.5"
        aria-label="알림"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-[640]" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-[650] mt-2 w-[330px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border border-[#e8ebf0] bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-[#eef1f5] px-4 py-2.5">
              <span className="text-sm font-medium text-[#0f172a]">알림</span>
              {unread > 0 && (
                <button onClick={markAllRead} className="inline-flex items-center gap-1 text-xs text-[#2563eb] hover:underline">
                  <Check className="h-3.5 w-3.5" />모두 읽음
                </button>
              )}
            </div>

            {items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-xs text-[#94a3b8]">
                <Inbox className="h-7 w-7 text-[#cbd5e1]" strokeWidth={1.5} />
                새 알림이 없습니다
              </div>
            ) : (
              <div className="max-h-[360px] overflow-y-auto [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:rounded [&::-webkit-scrollbar-thumb]:bg-slate-200">
                {items.map((n) => (
                  <button
                    key={n.id}
                    onClick={() => openItem(n)}
                    className={`flex w-full items-start gap-2.5 border-b border-[#f3f5f8] px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                      n.read_at ? '' : 'bg-blue-50/40'
                    }`}
                  >
                    <span
                      className="mt-1.5 h-2 w-2 flex-shrink-0 rounded-full"
                      style={{ background: n.read_at ? '#cbd5e1' : DOT[n.type] || '#2563eb' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-medium text-[#0f172a]">{n.title}</span>
                        <span className="flex-shrink-0 text-[11px] text-[#94a3b8]">{timeAgo(n.created_at)}</span>
                      </span>
                      {n.body && <span className="mt-0.5 block truncate text-xs text-[#64748b]">{n.body}</span>}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
