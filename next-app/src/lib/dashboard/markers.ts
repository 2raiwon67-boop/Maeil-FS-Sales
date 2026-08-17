// 마커 아이콘 빌더 — 원본 index.html _buildMarkerIcon / _buildAccountMarkerIcon 포팅
import {
  STATUS_COLORS,
  STATUS_COLORS_CB,
  ACCOUNT_COLORS,
  CART_COLOR,
  NEW_PERMIT_DAYS,
} from './constants';
import type { License } from '@/types';

interface NaverIcon {
  content: string;
  anchor: unknown;
}

/** 영업허가일이 NEW_PERMIT_DAYS 이내인지 (신규 glow 표시용) */
function isNewPermit(permitDate?: string): boolean {
  if (!permitDate) return false;
  const dateStr = permitDate.replace(/-/g, '');
  if (dateStr.length !== 8) return false;
  const d = new Date(
    parseInt(dateStr.substring(0, 4)),
    parseInt(dateStr.substring(4, 6)) - 1,
    parseInt(dateStr.substring(6, 8)),
  );
  return Math.ceil(Math.abs(Date.now() - d.getTime()) / 86400000) >= NEW_PERMIT_DAYS;
}

/** 인허가 마커 아이콘. DROP 등 색상 없으면 null 반환. */
export function buildMarkerIcon(
  status: string,
  license: Pick<License, 'permit_date'>,
  colorblind = false,
): NaverIcon | null {
  const color = (colorblind ? STATUS_COLORS_CB : STATUS_COLORS)[status];
  if (!color) return null;

  let glow = false;
  if (status === '인허가' || status === '') {
    glow = isNewPermit(license.permit_date);
  }
  const glowClass = glow ? 'marker-glow' : '';
  // 테두리 없는 미니 도트 (2026-08-17 사용자 확정: 현행 모양 유지 + 흰 테두리 제거 + 크기 축소)
  return {
    content: `<div class="${glowClass}" style="width:12px;height:12px;background:${color};border-radius:50%;box-shadow:0 2px 5px rgba(0,0,0,0.4);"></div>`,
    anchor: new window.naver.maps.Point(6, 6),
  };
}

/** 장바구니 담김 마커 (보라색) — 일반 도트와 동일 스타일, 한 단계 큼 */
export function buildCartMarkerIcon(): NaverIcon {
  return {
    content: `<div style="width:16px;height:16px;background:${CART_COLOR};border-radius:50%;box-shadow:0 2px 7px rgba(88,86,214,0.6);"></div>`,
    anchor: new window.naver.maps.Point(8, 8),
  };
}

/** 선택된 마커 강조 링 (파란 펄스, 중앙 투명 → 아래 마커가 비침) */
export function buildSelectionRingIcon(): NaverIcon {
  return {
    content: `<div class="marker-sel-ring"></div>`,
    anchor: new window.naver.maps.Point(15, 15),
  };
}

/** 주요거래처 마커 아이콘 (별 모양, 거래상태별 색상) */
export function buildAccountMarkerIcon(dealStatus: string): NaverIcon {
  const color = ACCOUNT_COLORS[dealStatus] ?? ACCOUNT_COLORS['미거래'];
  return {
    content: `<div style="width:0;height:0;position:relative;">
      <svg width="24" height="24" viewBox="0 0 24 24" style="position:absolute;left:-12px;top:-12px;filter:drop-shadow(0 1px 2px rgba(0,0,0,0.4));">
        <path d="M12 2l2.9 6.3 6.9.7-5.2 4.6 1.5 6.8L12 17.8 5.9 20.4l1.5-6.8L2.2 9l6.9-.7z"
              fill="${color}" stroke="white" stroke-width="1.2"/>
      </svg></div>`,
    anchor: new window.naver.maps.Point(0, 0),
  };
}
