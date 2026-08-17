// 인라인 거래여부/우유/거래처 상태 변경 — Supabase 업데이트 + 캐시 무효화
import { createClient } from '@/lib/supabase/client';

function invalidateCache(businessUnit: string, table: 'licenses' | 'accounts') {
  try {
    localStorage.removeItem(`fs_${table}_${businessUnit}`);
    localStorage.removeItem(`fs_${table}_${businessUnit}_ts`);
  } catch {
    /* ignore */
  }
}

/** 인허가 거래여부 변경 */
export async function updateLicenseStatus(
  businessUnit: string,
  businessName: string,
  roadAddress: string | undefined,
  newStatus: string,
): Promise<void> {
  const supabase = createClient();
  let q = supabase
    .from('licenses')
    .update({ trade_status: newStatus })
    .eq('business_name', businessName)
    .eq('business_unit', businessUnit);
  if (roadAddress) q = q.eq('road_address', roadAddress);
  const { error } = await q;
  if (error) throw new Error(error.message);
  invalidateCache(businessUnit, 'licenses');
}

/** 인허가 예상매출(월·천원) 변경 — null이면 미입력으로 초기화 */
export async function updateLicenseExpectedRevenue(
  businessUnit: string,
  businessName: string,
  roadAddress: string | undefined,
  value: number | null,
): Promise<void> {
  const supabase = createClient();
  let q = supabase
    .from('licenses')
    .update({ expected_revenue: value })
    .eq('business_name', businessName)
    .eq('business_unit', businessUnit);
  if (roadAddress) q = q.eq('road_address', roadAddress);
  const { error } = await q;
  if (error) throw new Error(error.message);
  invalidateCache(businessUnit, 'licenses');
}

/** 인허가 사용우유 변경 */
export async function updateLicenseMilk(
  businessUnit: string,
  businessName: string,
  roadAddress: string | undefined,
  newMilk: string,
): Promise<void> {
  const supabase = createClient();
  let q = supabase
    .from('licenses')
    .update({ milk_type: newMilk || null })
    .eq('business_name', businessName)
    .eq('business_unit', businessUnit);
  if (roadAddress) q = q.eq('road_address', roadAddress);
  const { error } = await q;
  if (error) throw new Error(error.message);
  invalidateCache(businessUnit, 'licenses');
}

/** 주요거래처 거래상태 변경 */
export async function updateAccountStatus(
  businessUnit: string,
  businessName: string,
  newStatus: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from('accounts')
    .update({ trade_status: newStatus })
    .eq('business_name', businessName)
    .eq('business_unit', businessUnit);
  if (error) throw new Error(error.message);
  invalidateCache(businessUnit, 'accounts');
}
