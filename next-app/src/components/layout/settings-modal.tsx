'use client';

import { useEffect, useState } from 'react';
import { getColorblind, setColorblind, onColorblindChange } from '@/lib/settings';

export function SettingsModal({ onClose }: { onClose: () => void }) {
  // 모달은 사용자가 연 뒤에만 렌더되므로(SSR 영향 없음) lazy init으로 현재 값 반영
  const [colorblind, setCb] = useState(() => getColorblind());

  // 외부 변경(대시보드 사이드바) 구독 — 콜백 내 setState라 effect 동기호출 아님
  useEffect(() => onColorblindChange(setCb), []);

  const toggle = () => {
    const next = !colorblind;
    setCb(next);
    setColorblind(next);
  };

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-sm rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="text-base font-bold text-gray-900">설정</h3>
          <button onClick={onClose} className="text-2xl leading-none text-gray-400 hover:text-gray-600">
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          <button onClick={toggle} className="flex w-full items-center justify-between py-2 text-left">
            <span>
              <span className="block text-sm font-medium text-gray-800">색각 보정 모드</span>
              <span className="mt-0.5 block text-xs text-gray-400">
                인허가 마커 색상을 구분이 쉬운 팔레트로 표시합니다
              </span>
            </span>
            <span
              className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
                colorblind ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              {/* left-0 기준점 필수 — 없으면 absolute 정적 위치가 어긋나 원이 알약 밖으로 빠져나간다 */}
              <span
                className={`absolute left-0 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  colorblind ? 'translate-x-[22px]' : 'translate-x-0.5'
                }`}
              />
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
