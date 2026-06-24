'use client';

// Phase 5 — 마커 클릭 상세 (데스크탑 플로팅 카드 / 모바일 바텀시트)
// 인라인 거래여부·우유 수정 + 메모 + 장바구니/동선 버튼
import { useState } from 'react';
import type { License, Account } from '@/types';
import { getMemo, setMemo as saveMemoLS, deleteMemo as delMemoLS } from '@/lib/dashboard/memo';
import { openNaverMapApp } from '@/lib/dashboard/route';
import { VisitCoachPanel } from '@/components/dashboard/visit-coach-panel';

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
  businessUnit: string | null;
  onClose: () => void;
  onStatusChange: (newStatus: string) => Promise<boolean>;
  onMilkChange: (newMilk: string) => Promise<boolean>;
  onToggleCart: () => void;
  onRouteFrom: () => void;
}

export function StoreDetail({
  selected,
  mobile,
  inCart,
  businessUnit,
  onClose,
  onStatusChange,
  onMilkChange,
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

  // 부모가 selected 변경 시 key를 바꿔 remount하므로 초기값은 props에서 직접 산출
  const [status, setStatus] = useState(initialStatus);
  const [milk, setMilk] = useState(initialMilk);
  const [memo, setMemo] = useState(() => (selected ? getMemo(name) : ''));
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);

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

  const handleSaveMemo = () => {
    saveMemoLS(name, memo);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1500);
  };
  const handleDeleteMemo = () => {
    delMemoLS(name);
    setMemo('');
  };

  const statusColor = STATUS_COLORS[status] || '#8e8e93';
  const hasCoord = selected.lat && selected.lng;

  const body = (
    <>
      <div className="flex items-start justify-between gap-2 border-b border-gray-100 px-4 py-3">
        <h3 className="text-base font-bold text-gray-900">{name}</h3>
        <button onClick={onClose} className="-mr-1 text-2xl leading-none text-gray-400 hover:text-gray-600">
          ×
        </button>
      </div>

      <div className="space-y-3 px-4 py-3">
        {!isAccount && (
          <Row label="평형" value={`${lic?.area || '-'}평`} />
        )}
        <Row label="주소" value={address} small />
        <Row label="담당자" value={manager} bold />

        {/* 상태/우유 인라인 수정 */}
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

        {!isAccount && <Row label="허가일" value={lic?.permit_date || '-'} />}

        {/* 메모 */}
        <div>
          <div className="mb-1.5 text-[11px] font-semibold text-gray-500">📝 메모</div>
          <textarea
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="메모를 입력하세요..."
            className="h-16 w-full resize-none rounded-lg border border-gray-200 p-2 text-[13px] text-gray-900 outline-none focus:border-blue-400"
          />
          <div className="mt-1.5 flex gap-1.5">
            <button
              onClick={handleSaveMemo}
              className="rounded-md px-3.5 py-1.5 text-xs font-semibold text-white"
              style={{ background: savedFlash ? '#34C759' : '#0071e3' }}
            >
              {savedFlash ? '✓ 저장됨' : '저장'}
            </button>
            {memo.trim() && (
              <button onClick={handleDeleteMemo} className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-semibold text-white">
                삭제
              </button>
            )}
          </div>
        </div>

        {/* 방문 코칭 · 기록 */}
        <VisitCoachPanel
          businessName={name}
          businessType={lic?.business_type}
          tradeStatus={status}
          businessUnit={businessUnit}
        />
      </div>

      {/* 액션 버튼 */}
      <div className="flex gap-1.5 border-t border-gray-100 px-4 py-3">
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
    </>
  );

  if (mobile) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
        <div className="fixed inset-x-0 bottom-0 z-50 max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-2xl">
          {body}
        </div>
      </>
    );
  }

  return (
    <div className="absolute right-3 top-3 z-30 w-[340px] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/5">
      {body}
    </div>
  );
}

function Row({ label, value, small, bold }: { label: string; value: string; small?: boolean; bold?: boolean }) {
  return (
    <div className="flex gap-2 text-sm">
      <span className="shrink-0 text-gray-400">{label}:</span>
      <span className={`${small ? 'text-xs leading-relaxed' : ''} ${bold ? 'font-semibold text-gray-700' : 'text-gray-800'}`}>
        {value}
      </span>
    </div>
  );
}
