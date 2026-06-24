'use client';

// 오늘 가볼 곳 추천 — 내 담당 주요거래처 중 미거래/거래상태 미확인을
// 1순위 거래처 기준 20km 이내·최대 3곳으로 추천 → 영업동선 cart에 담기.
import { Sparkles, X, Check } from 'lucide-react';
import { cartKey } from '@/lib/dashboard/route';

export interface RecItem {
  id: string;
  name: string;
  dealStatus: string; // '미거래' | '' 등
  reason: string;
  lat: number;
  lng: number;
  address: string;
}

interface RecommendPanelProps {
  open: boolean;
  onClose: () => void;
  recs: RecItem[];
  cartKeys: Set<string>;
  onToggle: (r: RecItem) => void;
  onAddAll: () => void;
}

export function RecommendPanel({ open, onClose, recs, cartKeys, onToggle, onAddAll }: RecommendPanelProps) {
  if (!open) return null;

  return (
    <div className="absolute bottom-6 right-4 z-30 w-[min(320px,calc(100vw-2rem))] overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-black/10">
      <div className="flex items-center justify-between bg-[#ff9f0a] px-4 py-3 text-white">
        <h3 className="flex items-center gap-1.5 text-sm font-bold">
          <Sparkles size={15} />오늘 가볼 곳 추천
        </h3>
        <button onClick={onClose} className="rounded-full p-0.5 hover:bg-white/20" aria-label="닫기">
          <X size={16} />
        </button>
      </div>

      <div className="max-h-[min(420px,60vh)] overflow-y-auto p-3">
        {recs.length === 0 ? (
          <div className="px-1 py-6 text-center text-xs text-gray-400">주변 20km 내 추천 없음</div>
        ) : (
          <>
            <button
              onClick={onAddAll}
              className="mb-2.5 w-full rounded-lg bg-[#5856d6] py-2.5 text-[13px] font-bold text-white transition-colors hover:bg-[#4744c0]"
            >
              전부 담기
            </button>
            <div className="flex flex-col gap-2">
              {recs.map((r) => {
                const inCart = cartKeys.has(cartKey(r.lat, r.lng));
                return (
                  <button
                    key={r.id}
                    onClick={() => onToggle(r)}
                    className={`flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-colors ${
                      inCart ? 'border-green-300 bg-green-50' : 'border-gray-100 bg-gray-50 hover:bg-gray-100'
                    }`}
                  >
                    <div className="flex w-full items-center gap-1.5">
                      <span className="flex-1 truncate text-[13px] font-bold text-gray-900">{r.name}</span>
                      <span
                        className={`rounded px-1.5 py-px text-[10px] font-bold text-white ${
                          r.dealStatus === '거래' ? 'bg-[#007AFF]' : 'bg-gray-400'
                        }`}
                      >
                        {r.dealStatus === '거래' ? '거래' : '미거래'}
                      </span>
                      {inCart && <Check size={15} className="text-green-600" />}
                    </div>
                    <span className="text-[11px] text-gray-500">{r.reason}</span>
                    {r.address && <span className="w-full truncate text-[11px] text-gray-400">{r.address}</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
