'use client';

import { useContext } from 'react';
import { AuthContext } from '@/components/auth-provider';

// 인증 상태는 루트 레이아웃의 AuthProvider가 1회만 조회·구독한다.
// 이 훅은 그 공유 값을 읽기만 하므로 몇 군데서 불러도 추가 요청이 없다.
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth는 AuthProvider 안에서만 사용할 수 있습니다');
  return ctx;
}
