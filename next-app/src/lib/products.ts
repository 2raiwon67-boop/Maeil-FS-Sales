import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * 제품 DB(products 테이블) 공통 로더 — 견적서·메뉴 상담이 같은 형태로 소비한다.
 * 2026-09-02 구글 스프레드시트(CSV export)에서 Supabase로 이관. 편집은 데이터 관리 ▸ 상품 관리 탭.
 */
export interface ProductRow {
  name: string;
  /** 내입량 → '12개입' 형태 (기존 시트 시절 표시 규칙 유지) */
  spec: string;
  desc: string;
  usage: string;
  expiryDate: string;
}

export async function loadProducts(supabase: SupabaseClient): Promise<ProductRow[]> {
  const { data, error } = await supabase
    .from('products')
    .select('name, pack_qty, description, usage, expiry, sort_order')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? [])
    .filter((r) => r.name && String(r.name).trim())
    .map((r) => ({
      name: String(r.name).trim(),
      spec: r.pack_qty ? String(r.pack_qty).trim() + '개입' : '',
      desc: (r.description ?? '').toString().trim(),
      usage: (r.usage ?? '').toString().trim(),
      expiryDate: (r.expiry ?? '').toString().trim(),
    }));
}
