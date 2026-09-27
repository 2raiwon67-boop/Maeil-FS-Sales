'use client';
import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { observePerformance } from '@/lib/performance-diagnostics';

export function PerformanceMonitor() {
  const pathname = usePathname();
  useEffect(() => observePerformance(pathname), [pathname]);
  return null;
}
