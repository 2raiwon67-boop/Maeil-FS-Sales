'use client';

// Phase 5 — 마커 클릭 상세 (데스크탑 플로팅 카드 / 모바일 바텀시트)
// 인라인 거래여부·우유 수정 + 메모 + 장바구니/동선 버튼
import { useState } from 'react';
import type { License, Account } from '@/types';
import { openNaverMapApp } from '@/lib/dashboard/route';

const STATUS_COLORS: Record<string, string> = {
  인허가: '#34C759', 공사중: '#FF9500', 거래: '#007AFF', 미거래: '#FF9595', DROP: '#8E8E93',
};
const STATUSES = ['인허가', '공사중', '거래', '미거래', 'DROP'];
const MILKS = ['매일', '서울', '남양', '연세', '동원', '빙그레', '기타'];

export interface SelectedStore {
  item: License | Account;
  type: 'license' | 'account';
  lat: number;
  lng: number;
}

interface Props {
  selected: SelectedStore | null;
  mobile: boolean;
  inCart: boolean;
  onClose: () => void;
  onStatusChange: (newStatus: string) => Promise<boolean>;
  onMilkChange: (newMilk: string) => Promise<boolean>;
  onExpectedRevenueChange: (value: number | null) => Promise<boolean>;
  onToggleCart: () => void;
  onRouteFrom: () => void;
}

export function StoreDetail({
  selected,
  mobile,
  inCart,
  onClose,
  onStatusChange,
  onMilkChange,
  onExpectedRevenueChange,
  onToggleCart,
  onRouteFrom,
}: Props) {
  const isAccount = selected?.type === 'account';
  const lic = selected?.item as License | undefined;
  const acc = selected?.item as Account | undefined;

  const name = (isAccount ? acc?.business_name : lic?.business_name) || '정보 없음';
  const address = (isAccount ? acc?.address : lic?.road_address) || '-';
  const manager = (isAccount ? acc?.manager_name : lic?.manager) || '미지정';
  const initialStatus = isAccount
    ? acc?.trade_status || '미거래'
    : lic?.trade_status || '인허가';
  const initialMilk = isAccount ? '' : lic?.milk_type || '';
  const initialRevenue = !isAccount && lic?.expected_revenue != null ? String(lic.expected_revenue) : '';

  // 부모가 selected 변경 시 key를 바꿔 remount하므로 초기값은 props에서 직접 산출
  const [status, setStatus] = useState(initialStatus);
  const [milk, setMilk] = useState(initialMilk);
  const [revenue, setRevenue] = useState(initialRevenue);
  const [savedRevenue, setSavedRevenue] = useState(initialRevenue);
  const [saving, setSaving] = useState(false);

  if (!selected) return null;

  const handleStatus = async (v: string) => {
    const prev = status;
    setStatus(v);
    setSaving(true);
    const ok = await onStatusChange(v);
    setSaving(false);
    if (!ok) setStatus(prev);
  };

  const handleMilk = async (v: string) => {
    const prev = milk;
    setMilk(v);
    setSaving(true);
    const ok = await onMilkChange(v);
    setSaving(false);
    if (!ok) setMilk(prev);
  };

  // 예상매출 저장 — blur/Enter 시. 값이 그대로면 요청 생략, 실패 시 마지막 저장값으로 복원
  const handleRevenueSave = async () => {
    const trimmed = revenue.trim();
    if (trimmed === savedRevenue) return;
    const num = trimmed === '' ? null : Math.max(0, Math.round(Number(trimmed)));
    if (num !== null && !Number.isFinite(num)) { setRevenue(savedRevenue); return; }
    setSaving(true);
    const ok = await onExpectedRevenueChange(num);
    setSaving(false);
    if (ok) { setSavedRevenue(num === null ? '' : String(num)); setRevenue(num === null ? '' : String(num)); }
    else setRevenue(savedRevenue);
  };

  const statusColor = STATUS_COLORS[status] || '#8e8e93';
  const hasCoord = selected.lat && selected.lng;

  // 헤더 — 상태 배지 + 매장명 + 주소 + 메타 한 줄 (모바일에서 스크롤 없이 핵심이 다 보이게)
  const header = (
    <div className="border-b border-gray-100 px-4 py-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold text-white" style={{ background: statusColor }}>{status}</span>
            {!isAccount && milk && (
              <span className="rounded-full bg-[#5856d6]/10 px-2 py-0.5 text-[11px] font-bold text-[#5856d6]">{milk}우유</span>
            )}
          </div>
          <h3 className="text-base font-bold leading-snug text-gray-900">{name}</h3>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{address}</p>
        </div>
        <button
          onClick={onClose}
          aria-label="닫기"
          className="-mr-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full text-2xl leading-none text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          ×
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-400">
        {!isAccount && <span>평형 <b className="font-semibold text-gray-700">{lic?.area || '-'}평</b></span>}
        {!isAccount && <span>허가일 <b className="font-semibold text-gray-700">{lic?.permit_date || '-'}</b></span>}
        <span>담당 <b className="font-semibold text-gray-700">{manager}</b></span>
      </div>
    </div>
  );

  const content = (
    <div className="space-y-3 px-4 py-3">
      {isAccount ? (
          <div>
            <div className="mb-1.5 text-[11px] font-semibold text-gray-500">거래상태 변경</div>
            <div className="flex gap-1.5">
              {['거래', '미거래'].map((s) => (
                <button
                  key={s}
                  disabled={saving}
                  onClick={() => handleStatus(s)}
                  className={`flex-1 rounded-lg py-2 text-sm font-semibold transition-colors ${
                    status === s ? 'text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                  style={status === s ? { background: s === '거래' ? '#007AFF' : '#8e8e93' } : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex items-end gap-2">
            <label className="flex-1">
              <span className="mb-1.5 block text-[11px] font-semibold text-gray-500">상태 변경</span>
              <select
                value={status}
                disabled={saving}
                onChange={(e) => handleStatus(e.target.value)}
                className="w-full rounded-lg border-0 px-2.5 py-2 text-sm font-semibold text-white"
                style={{ background: statusColor }}
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s} className="bg-white text-gray-900">
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex-1">
              <span className="mb-1.5 block text-[11px] font-semibold text-gray-500">사용우유</span>
              <select
                value={milk}
                disabled={saving}
                onChange={(e) => handleMilk(e.target.value)}
                className="w-full rounded-lg border-0 bg-[#5856d6] px-2.5 py-2 text-sm font-semibold text-white"
              >
                <option value="" className="bg-white text-gray-900">미입력</option>
                {MILKS.map((m) => (
                  <option key={m} value={m} className="bg-white text-gray-900">
                    {m}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

      {!isAccount && (
        <label className="block">
          <span className="mb-1.5 block text-[11px] font-semibold text-gray-500">예상매출 (월)</span>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              value={revenue}
              disabled={saving}
              placeholder="미입력"
              onChange={(e) => setRevenue(e.target.value)}
              onBlur={handleRevenueSave}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
              className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-sm font-semibold text-gray-900 focus:border-blue-400 focus:outline-none"
            />
            <span className="shrink-0 text-xs font-semibold text-gray-500">천원</span>
          </div>
        </label>
      )}
    </div>
  );

  // 액션 버튼 — 시트가 스크롤돼도 항상 하단 고정
  const actions = (
    <div className="flex gap-1.5 border-t border-gray-100 bg-white px-4 py-3">
      <button
        onClick={() => openNaverMapApp(selected.lat, selected.lng, name)}
        className="flex-1 rounded-lg bg-[#03C75A] py-3 text-sm font-bold text-white"
      >
        네이버
      </button>
      {hasCoord && (
        <button
          onClick={onToggleCart}
          className="flex-1 rounded-lg py-3 text-sm font-bold text-white"
          style={{ background: inCart ? '#34C759' : '#5856d6' }}
        >
          {inCart ? '✓ 담겼음' : '담아두기'}
        </button>
      )}
      {hasCoord && (
        <button onClick={onRouteFrom} className="flex-1 rounded-lg bg-[#1d1d1f] py-3 text-sm font-bold text-white">
          지금 출발
        </button>
      )}
    </div>
  );

  if (mobile) {
    return (
      <>
        {/* 하단 탭바(z-50)보다 위 — 액션 버튼이 탭바에 가려지지 않게 */}
        <div className="fixed inset-0 z-[55] bg-black/30" onClick={onClose} />
        <div className="fixed inset-x-0 bottom-0 z-[60] flex max-h-[82dvh] flex-col rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-2xl">
          {/* 그랩 핸들 — 탭하면 닫힘 */}
          <button aria-label="닫기" onClick={onClose} className="flex w-full items-center justify-center pb-1.5 pt-2.5">
            <span className="h-1 w-9 rounded-full bg-gray-300" />
          </button>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {header}
            {content}
          </div>
          {actions}
        </div>
      </>
    );
  }

  // z-[60]: 영업동선 패널(z-50)보다 위 — 패널 열린 채 마커 클릭 시 카드가 가려져 '담아두기'가 눌리지 않던 문제
  return (
    <div className="absolute right-3 top-3 z-[60] flex max-h-[calc(100%-1.5rem)] w-[340px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {header}
        {content}
      </div>
      {actions}
    </div>
  );
}
