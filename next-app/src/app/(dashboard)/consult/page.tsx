'use client';

// 상담 모드 — 영업사원이 매장에서 사장님께 레시피를 보여주며 제안하는 presenter 화면.
// 폰 세로 기준(데스크톱은 중앙 520px). 카테고리 → flavor 칩 → 레시피 카드 → 담기 →
// quotes 초안 저장(데스크톱 견적서 "불러오기"로 픽업) + PDF 네이티브 공유.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Search, FileText, Share2, Plus, Check,
  ShoppingBag, Trash2, X, Store, ExternalLink,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { resolveRecipeProducts, deriveFlavors } from '@/lib/recipe-product';

// proposal과 동일한 제품 DB 시트 — 담기 시 SKU 스펙·설명 자동 채움용
const PRODUCT_DB_SHEETS_URL =
  'https://docs.google.com/spreadsheets/d/1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI/export?format=csv&gid=1802773439';

const BASKET_STORAGE_KEY = 'consult_basket_v1';

// 카테고리 표시 순서·음료 재료 틴트 (사장님께 보이는 화면이라 이모지가 제일 빨리 읽힘)
const CATEGORIES: { key: string; emoji: string; tint: string }[] = [
  { key: '라떼', emoji: '☕', tint: '#f5efe6' },
  { key: '에이드', emoji: '🍋', tint: '#eaf6ea' },
  { key: '블렌디드', emoji: '🧊', tint: '#eaf1fb' },
  { key: '슬러시', emoji: '🍧', tint: '#e9f5f8' },
  { key: '밀크티', emoji: '🧋', tint: '#f3ede4' },
  { key: '스무디', emoji: '🍓', tint: '#f9edf1' },
  { key: '기타', emoji: '✨', tint: '#f1f2f5' },
];

interface Recipe {
  name: string;
  category: string | null;
  pdf_url: string | null;
  main_products: string[] | null;
}

interface SheetProduct {
  spec: string;
  desc: string;
  expiryDate: string;
}

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const result: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols: string[] = [];
    let cur = '', inQ = false;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j];
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { cols.push(cur); cur = ''; }
      else cur += ch;
    }
    cols.push(cur);
    const obj: Record<string, string> = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] || '').trim(); });
    result.push(obj);
  }
  return result;
}

export default function ConsultPage() {
  const { user, metadata } = useAuth();
  const supabase = createClient();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Map<string, SheetProduct>>(new Map());
  const skuNames = useMemo(() => [...products.keys()], [products]);

  // 화면 상태 — category 미선택 = 카테고리 그리드
  const [category, setCategory] = useState<string | null>(null);
  const [flavor, setFlavor] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);

  // 바구니 — 레시피 이름 단위. 현장에서 실수로 이탈해도 남도록 localStorage 백업
  const [basket, setBasket] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(false);
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── 초기 로드 ──
  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem(BASKET_STORAGE_KEY);
        if (saved) setBasket(JSON.parse(saved));
      } catch { /* ignore */ }

      const { data, error } = await supabase
        .from('recipes')
        .select('name, category, pdf_url, main_products') // embedding(768차원) 절대 포함 금지
        .order('name');
      if (error) toast.error('레시피 로드 실패: ' + error.message);
      setRecipes((data as Recipe[]) || []);
      setLoading(false);

      try {
        const res = await fetch(PRODUCT_DB_SHEETS_URL);
        if (res.ok) {
          const rows = parseCSV(await res.text()).filter((r) => r['품명']);
          setProducts(new Map(rows.map((r) => [r['품명'].trim(), {
            spec: r['내입량'] ? r['내입량'].trim() + '개입' : '',
            desc: (r['제품 상세 내용'] || '').trim(),
            expiryDate: (r['소비기한'] || '').trim(),
          }])));
        }
      } catch { /* 제품 DB 없이도 브라우징은 동작 — 저장 시점에 재확인 */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try { localStorage.setItem(BASKET_STORAGE_KEY, JSON.stringify(basket)); } catch { /* ignore */ }
  }, [basket]);

  // ── 파생 데이터 ──
  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of recipes) {
      const c = r.category || '기타';
      m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [recipes]);

  const inCategory = useMemo(
    () => recipes.filter((r) => (r.category || '기타') === category),
    [recipes, category],
  );

  // 카테고리 내 flavor 칩 — 빈도순, 실제 있는 것만
  const flavorChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inCategory) {
      for (const f of deriveFlavors(r.name, r.main_products || [])) m.set(f, (m.get(f) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [inCategory]);

  const visible = useMemo(() => {
    const q = query.trim();
    let list = q
      ? recipes.filter((r) => r.name.includes(q) || (r.main_products || []).some((p) => p.includes(q)))
      : inCategory;
    if (!q && flavor) {
      list = list.filter((r) => deriveFlavors(r.name, r.main_products || []).includes(flavor));
    }
    return list;
  }, [recipes, inCategory, query, flavor]);

  const searching = query.trim().length > 0;

  // ── 담기 ──
  const inBasket = (name: string) => basket.includes(name);

  const toggleBasket = (recipe: Recipe) => {
    setBasket((prev) => {
      if (prev.includes(recipe.name)) return prev.filter((n) => n !== recipe.name);
      return [...prev, recipe.name];
    });
    if (!inBasket(recipe.name)) {
      toast.success(`"${recipe.name}" 담았습니다`);
      setBump(true);
      if (bumpTimer.current) clearTimeout(bumpTimer.current);
      bumpTimer.current = setTimeout(() => setBump(false), 350);
    }
  };

  const basketRecipes = useMemo(
    () => basket.map((n) => recipes.find((r) => r.name === n)).filter(Boolean) as Recipe[],
    [basket, recipes],
  );

  // 바구니의 레시피들 → SKU 목록 (중복 제품은 합침, 미해석은 원문 이름 유지)
  const basketProducts = useMemo(() => {
    const seen = new Map<string, { name: string; resolved: boolean; from: string[] }>();
    for (const r of basketRecipes) {
      for (const p of resolveRecipeProducts(r.name, r.main_products || [], skuNames)) {
        if (p.method === 'dedupe') continue;
        const key = p.sku ?? p.raw;
        const entry = seen.get(key) || { name: key, resolved: !!p.sku, from: [] };
        entry.from.push(r.name);
        seen.set(key, entry);
      }
    }
    return [...seen.values()];
  }, [basketRecipes, skuNames]);

  // ── 견적 초안 저장 (proposal의 quotes 포맷과 동일 → 견적서 "불러오기"로 픽업) ──
  const saveDraft = async () => {
    if (!user) { toast.error('로그인이 필요합니다.'); return; }
    const businessUnit = metadata?.business_unit;
    if (!businessUnit) { toast.error('사업부 정보가 없습니다.'); return; }
    if (basketProducts.length === 0) { toast.warning('담은 제품이 없습니다.'); return; }

    setSaving(true);
    try {
      const items = basketProducts.map((p) => {
        const sheet = products.get(p.name);
        return {
          name: p.name,
          spec: sheet?.spec || '',
          factoryPrice: 0, // 가격은 견적서에서 수기 입력 (시스템에 단가 없음)
          dcRate: 0,
          salesPrice: 0,
          desc: sheet?.desc || '',
          taxFree: false,
          expiryDate: sheet?.expiryDate || '',
        };
      });
      const { error } = await supabase.from('quotes').insert({
        business_unit: businessUnit,
        created_by: metadata?.full_name || user.email,
        customer_name: customerName || '(상담)',
        manager_name: metadata?.full_name || '',
        manager_phone: '',
        quote_mode: 'custom',
        memo: `상담 초안 · ${basketRecipes.map((r) => r.name).join(', ')}`.slice(0, 200),
        items,
        total_amount: 0,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;
      toast.success('견적 초안을 저장했습니다. 견적서 화면의 "불러오기"에서 확인하세요.');
      setBasket([]);
      setCustomerName('');
      setBasketOpen(false);
    } catch (e) {
      toast.error('저장 실패: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── PDF 네이티브 공유 (카톡/문자 — 사장님 leave-behind) ──
  const sharePdf = async (recipe: Recipe) => {
    if (!recipe.pdf_url) { toast.warning('이 레시피는 PDF가 없습니다.'); return; }
    const payload = { title: recipe.name, text: `[매일유업 레시피] ${recipe.name}`, url: recipe.pdf_url };
    try {
      if (navigator.share) {
        await navigator.share(payload);
      } else {
        await navigator.clipboard.writeText(recipe.pdf_url);
        toast.success('PDF 링크를 복사했습니다. 카톡·문자에 붙여넣어 보내세요.');
      }
    } catch { /* 사용자가 공유 시트를 닫음 — 조용히 무시 */ }
  };

  const activeCategory = CATEGORIES.find((c) => c.key === category);

  // ── 렌더 ──
  return (
    <div className="min-h-full bg-[#f6f7f9]">
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] max-w-[520px] flex-col px-4 pb-36 pt-4 md:min-h-[calc(100dvh-88px)]">

        {/* ── 헤더: 뒤로 + 타이틀 (몰입 화면이라 자체 헤더) ── */}
        <div className="mb-3 flex items-center gap-2">
          {category || searching ? (
            <button
              onClick={() => { setCategory(null); setFlavor(null); setQuery(''); }}
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#334155] shadow-sm"
              aria-label="카테고리로 돌아가기"
            >
              <ChevronLeft size={20} />
            </button>
          ) : (
            <Link
              href="/proposal"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#334155] shadow-sm"
              aria-label="견적서로 나가기"
            >
              <X size={18} />
            </Link>
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-bold text-[#0f172a]">
              {searching ? '검색' : category ? `${activeCategory?.emoji ?? ''} ${category}` : '메뉴 상담'}
            </h1>
            {!category && !searching && (
              <p className="text-[12px] text-[#94a3b8]">사장님과 함께 보는 레시피 제안</p>
            )}
          </div>
        </div>

        {/* ── 검색 (사장님이 말한 키워드 즉시 대응) ── */}
        <label className="mb-4 flex items-center gap-2 rounded-2xl border border-[#e8ebf0] bg-white px-3.5 py-3 focus-within:border-[#2563eb]">
          <Search size={17} className="shrink-0 text-[#94a3b8]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="메뉴·재료 검색 (예: 레몬, 흑임자)"
            className="min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-[#b6c0cc]"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[#cbd5e1]" aria-label="검색어 지우기">
              <X size={16} />
            </button>
          )}
        </label>

        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20 text-sm text-[#94a3b8]">
            레시피를 불러오는 중…
          </div>
        ) : !category && !searching ? (

          /* ── 화면 1: 카테고리 그리드 ── */
          <div className="grid grid-cols-2 gap-3">
            {CATEGORIES.filter((c) => (countByCategory.get(c.key) || 0) > 0).map((c) => (
              <button
                key={c.key}
                onClick={() => { setCategory(c.key); setFlavor(null); }}
                className="flex flex-col items-start gap-2 rounded-[22px] border border-black/[0.04] p-4 text-left transition-transform active:scale-[0.97]"
                style={{ background: c.tint }}
              >
                <span className="text-[30px] leading-none">{c.emoji}</span>
                <span className="mt-1 text-[16px] font-bold text-[#0f172a]">{c.key}</span>
                <span className="text-[12px] text-[#64748b]">{countByCategory.get(c.key)}가지 레시피</span>
              </button>
            ))}
          </div>

        ) : (

          /* ── 화면 2: 레시피 리스트 (+ flavor 칩) ── */
          <>
            {!searching && flavorChips.length > 0 && (
              <div className="sticky top-12 z-10 -mx-4 mb-3 px-4 py-2 backdrop-blur-xl [background:rgba(246,247,249,0.82)] md:top-[88px]">
                <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                  <button
                    onClick={() => setFlavor(null)}
                    className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${!flavor ? 'bg-[#0f172a] text-white' : 'bg-white text-[#475569] shadow-sm'}`}
                  >
                    전체
                  </button>
                  {flavorChips.map((f) => (
                    <button
                      key={f}
                      onClick={() => setFlavor(flavor === f ? null : f)}
                      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${flavor === f ? 'bg-[#0f172a] text-white' : 'bg-white text-[#475569] shadow-sm'}`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {visible.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#94a3b8]">
                조건에 맞는 레시피가 없습니다.<br />검색어나 필터를 바꿔보세요.
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                {visible.map((r) => {
                  const picked = inBasket(r.name);
                  const prods = (r.main_products || []).slice(0, 2);
                  const more = (r.main_products || []).length - prods.length;
                  return (
                    <button
                      key={r.name}
                      onClick={() => setDetail(r)}
                      className="flex items-center gap-3 rounded-[20px] border border-[#e8ebf0] bg-white p-4 text-left transition-transform active:scale-[0.98]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-[16px] font-semibold text-[#0f172a]">{r.name}</span>
                          {picked && <Check size={15} className="shrink-0 text-[#2563eb]" />}
                        </div>
                        {prods.length > 0 && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {prods.map((p) => (
                              <span key={p} className="rounded-md bg-[#eef3fb] px-1.5 py-0.5 text-[11px] font-medium text-[#1B3F82]">{p}</span>
                            ))}
                            {more > 0 && <span className="px-0.5 py-0.5 text-[11px] text-[#94a3b8]">+{more}</span>}
                          </div>
                        )}
                      </div>
                      <ChevronRight size={17} className="shrink-0 text-[#cbd5e1]" />
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── 시그니처: 플로팅 글래스 바구니 캡슐 ── */}
      {basket.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-6">
          <button
            onClick={() => setBasketOpen(true)}
            className={`flex w-full max-w-[440px] items-center gap-3 rounded-full border border-white/60 px-5 py-3.5 shadow-[0_8px_32px_rgba(15,23,42,0.18)] backdrop-blur-xl transition-transform [background:rgba(255,255,255,0.78)] ${bump ? 'motion-safe:animate-[consultBump_0.35s_ease]' : ''}`}
          >
            <span className="relative flex h-9 w-9 items-center justify-center rounded-full bg-[#2563eb] text-white">
              <ShoppingBag size={17} />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-[#0f172a] px-1 text-[11px] font-bold text-white">
                {basket.length}
              </span>
            </span>
            <span className="flex-1 text-left text-[14px] font-semibold text-[#0f172a]">
              담은 메뉴 {basket.length} · 제품 {basketProducts.length}
            </span>
            <span className="text-[13px] font-semibold text-[#2563eb]">견적 만들기</span>
          </button>
        </div>
      )}

      {/* ── 상세 바텀시트 ── */}
      {detail && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 md:items-center" onClick={() => setDetail(null)}>
          <div
            className="w-full max-w-[520px] rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 md:rounded-[28px] md:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#e2e8f0] md:hidden" />
            <div className="mb-1 flex flex-wrap gap-1">
              {deriveFlavors(detail.name, detail.main_products || []).map((f) => (
                <span key={f} className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#64748b]">#{f}</span>
              ))}
            </div>
            <h2 className="text-[22px] font-bold leading-snug text-[#0f172a]">{detail.name}</h2>
            <p className="mt-1 text-[13px] text-[#94a3b8]">
              누가 만들어도 같은 맛 — 자세한 조리법은 레시피 PDF에 있습니다
            </p>

            {(detail.main_products || []).length > 0 && (
              <div className="mt-4 rounded-2xl bg-[#f8fafc] p-3.5">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">들어가는 우리 제품</div>
                <div className="flex flex-col gap-1.5">
                  {resolveRecipeProducts(detail.name, detail.main_products || [], skuNames)
                    .filter((p) => p.method !== 'dedupe')
                    .map((p) => (
                      <div key={p.raw} className="flex items-center gap-2">
                        <Store size={13} className="shrink-0 text-[#1B3F82]" />
                        <span className="text-[13.5px] font-medium text-[#1B3F82]">{p.sku ?? p.raw}</span>
                      </div>
                    ))}
                </div>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              {detail.pdf_url && (
                <>
                  <button
                    onClick={() => window.open(detail.pdf_url!, '_blank')}
                    className="flex flex-1 items-center justify-center gap-1.5 rounded-2xl border border-[#d6dbe3] bg-white py-3 text-[14px] font-semibold text-[#334155]"
                  >
                    <FileText size={16} />레시피 보기<ExternalLink size={12} className="text-[#94a3b8]" />
                  </button>
                  <button
                    onClick={() => sharePdf(detail)}
                    className="flex h-[46px] w-[46px] items-center justify-center rounded-2xl border border-[#d6dbe3] bg-white text-[#334155]"
                    aria-label="레시피 PDF 공유"
                  >
                    <Share2 size={17} />
                  </button>
                </>
              )}
              <button
                onClick={() => { toggleBasket(detail); setDetail(null); }}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] font-semibold text-white ${inBasket(detail.name) ? 'bg-[#64748b]' : 'bg-[#2563eb]'}`}
              >
                {inBasket(detail.name) ? (<><X size={16} />담기 취소</>) : (<><Plus size={16} />담기</>)}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 바구니 바텀시트 ── */}
      {basketOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 md:items-center" onClick={() => setBasketOpen(false)}>
          <div
            className="flex max-h-[82dvh] w-full max-w-[520px] flex-col rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 md:rounded-[28px] md:pb-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#e2e8f0] md:hidden" />
            <h2 className="text-[19px] font-bold text-[#0f172a]">오늘 담은 제안</h2>
            <p className="mt-0.5 text-[12.5px] text-[#94a3b8]">저장하면 견적서 화면의 &quot;불러오기&quot;에서 이어서 작성할 수 있습니다</p>

            <div className="mt-4 flex-1 overflow-y-auto">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">메뉴 {basketRecipes.length}</div>
              <div className="flex flex-col gap-1.5">
                {basketRecipes.map((r) => (
                  <div key={r.name} className="flex items-center gap-2 rounded-xl bg-[#f8fafc] px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-[#0f172a]">{r.name}</span>
                    <button
                      onClick={() => setBasket((prev) => prev.filter((n) => n !== r.name))}
                      className="shrink-0 text-[#cbd5e1] hover:text-red-500"
                      aria-label={`${r.name} 빼기`}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">견적에 들어갈 제품 {basketProducts.length}</div>
              <div className="flex flex-col gap-1">
                {basketProducts.map((p) => (
                  <div key={p.name} className="flex items-center gap-2 px-1 py-0.5">
                    <Store size={13} className="shrink-0 text-[#1B3F82]" />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#1B3F82]">{p.name}</span>
                    {!p.resolved && <span className="shrink-0 rounded bg-[#fef3c7] px-1.5 py-0.5 text-[10px] text-[#92400e]">품명 확인 필요</span>}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-4 border-t border-[#eef1f5] pt-4">
              <label className="mb-2.5 flex items-center gap-2 rounded-xl border border-[#e2e8f0] px-3 py-2.5 focus-within:border-[#2563eb]">
                <Store size={15} className="shrink-0 text-[#94a3b8]" />
                <input
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  placeholder="거래처(매장)명 — 비우면 (상담)으로 저장"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                />
              </label>
              <button
                onClick={saveDraft}
                disabled={saving}
                className="w-full rounded-2xl bg-[#2563eb] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
              >
                {saving ? '저장 중…' : '견적 초안으로 저장'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 담기 순간 캡슐 bump 애니메이션 (reduced-motion 시 motion-safe로 비활성) */}
      <style>{`@keyframes consultBump{0%{transform:scale(1)}35%{transform:scale(1.05)}100%{transform:scale(1)}}`}</style>
    </div>
  );
}
