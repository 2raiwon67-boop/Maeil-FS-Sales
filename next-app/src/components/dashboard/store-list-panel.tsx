'use client';

// 우측 거래처 목록 패널 — 원본 #storePanel(spListView) 포팅
// 인허가/주요거래처 탭 + 검색 + 정렬, 항목 클릭 시 상세(StoreDetail) 열기
import { useMemo, useState } from 'react';
import type { License, Account } from '@/types';

const STATUS_COLORS: Record<string, string> = {
  인허가: '#8e8e93', 공사중: '#ff9500', 거래: '#34c759', 미거래: '#8e8e93', DROP: '#ff3b30',
};
const STATUS_ORDER = ['인허가', '공사중', '거래', '미거래', 'DROP'];

type SortBy = 'default' | 'name' | 'status';

interface Props {
  open: boolean;
  onClose: () => void;
  licenses: License[];
  accounts: Account[];
  onOpenStore: (item: License | Account, type: 'license' | 'account') => void;
}

export function StoreListPanel({ open, onClose, licenses, accounts, onOpenStore }: Props) {
  const [tab, setTab] = useState<'license' | 'account'>('license');
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('default');

  const items = useMemo(() => {
    const base = tab === 'license' ? licenses : accounts;
    const term = search.trim().toLowerCase();
    let list = term
      ? base.filter((it) => (it.business_name || '').toLowerCase().includes(term))
      : [...base];
    if (sortBy === 'name') {
      list = list.sort((a, b) => (a.business_name || '').localeCompare(b.business_name || '', 'ko'));
    } else if (sortBy === 'status') {
      list = list.sort((a, b) => {
        const as = (a as License).trade_status || '';
        const bs = (b as License).trade_status || '';
        const ai = STATUS_ORDER.indexOf(as);
        const bi = STATUS_ORDER.indexOf(bs);
        const ar = ai === -1 ? STATUS_ORDER.length : ai;
        const br = bi === -1 ? STATUS_ORDER.length : bi;
        if (ar !== br) return ar - br;
        return (a.business_name || '').localeCompare(b.business_name || '', 'ko');
      });
    }
    return list;
  }, [tab, search, sortBy, licenses, accounts]);

  return (
    <>
      {open && <div className="fixed inset-0 z-40 bg-black/30 md:hidden" onClick={onClose} />}
      <aside
        className={`fixed left-0 top-12 z-50 flex h-[calc(100dvh-3rem)] w-full flex-col bg-white shadow-2xl transition-transform duration-300 md:top-[88px] md:h-[calc(100dvh-88px)] md:w-[340px] ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <span className="text-base font-bold text-gray-900">거래처 목록</span>
          <button onClick={onClose} className="text-xl leading-none text-gray-400">✕</button>
        </div>

        <div className="px-3 pt-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="매장명 검색..."
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm outline-none focus:border-blue-400"
          />
        </div>

        <div className="flex gap-1 px-3 pt-2">
          {(['license', 'account'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-lg py-1.5 text-[13px] font-medium ${
                tab === t ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600'
              }`}
            >
              {t === 'license' ? '인허가' : '주요거래처'} (
              {t === 'license' ? licenses.length : accounts.length})
            </button>
          ))}
        </div>

        <div className="px-3 pt-2">
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as SortBy)}
            className="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-[13px] outline-none"
          >
            <option value="default">기본 정렬</option>
            <option value="name">거래처 이름순</option>
            <option value="status">거래여부 순</option>
          </select>
        </div>

        {/* 모바일 하단 탭바(약 55px)에 마지막 항목이 가리지 않도록 여유 */}
        <div className="mt-2 flex-1 overflow-y-auto px-3 pb-20 md:pb-4">
          {items.length === 0 ? (
            <div className="py-8 text-center text-sm text-gray-400">목록이 없습니다</div>
          ) : (
            <div className="space-y-1.5">
              {items.map((item) => {
                const status = (item as License).trade_status || '-';
                const mgr =
                  tab === 'license' ? (item as License).manager : (item as Account).manager_name;
                const addr = (
                  (item as License).road_address || (item as Account).address || ''
                ).substring(0, 18);
                const milk = (item as License).milk_type || '';
                return (
                  <button
                    key={item.id}
                    onClick={() => onOpenStore(item, tab)}
                    className="w-full rounded-lg border border-gray-100 px-3 py-2 text-left hover:bg-gray-50"
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-gray-800">{item.business_name}</span>
                      <span
                        className="rounded px-1.5 py-0.5 text-[10px] font-semibold text-white"
                        style={{ background: STATUS_COLORS[status] || '#8e8e93' }}
                      >
                        {status}
                      </span>
                      {milk && (
                        <span className="rounded bg-[#5856d6] px-1.5 py-0.5 text-[10px] font-semibold text-white">
                          {milk}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[11px] text-gray-400">
                      {mgr || '-'}
                      {addr && ` · ${addr}`}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
