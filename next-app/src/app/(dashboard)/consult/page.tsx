'use client';

// 상담 모드 — 영업사원이 매장에서 사장님께 레시피를 보여주며 제안하는 화면.
// · 모바일(<md): 폰 presenter — 카테고리 → flavor 칩 → 카드 → 담기 → 플로팅 바구니
// · PC(md+): 견적서와 같은 2컬럼 작업 화면 — 좌측 AI 매장 분석(네이버 리뷰→추천 레시피)+바구니,
//   우측 레시피 브라우징. 견적서 ↔ 메뉴 상담은 헤더 버튼으로 오간다.
// 담은 제품은 quotes 초안으로 저장 → 견적서 "불러오기"로 픽업.

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronRight, Search, FileText, Share2, Plus, Check,
  ShoppingBag, Trash2, X, Store, ExternalLink, Sparkles, ClipboardList, FolderDown,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { resolveRecipeProducts, deriveFlavors } from '@/lib/recipe-product';
import { PageHeader, headerBtn } from '@/components/layout/page-header';

// proposal과 동일한 제품 DB 시트 — 담기 시 SKU 스펙·설명 자동 채움 + AI 분석 API 입력
const PRODUCT_DB_SHEETS_URL =
  'https://docs.google.com/spreadsheets/d/1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI/export?format=csv&gid=1802773439';

const BASKET_STORAGE_KEY = 'consult_basket_v1';
const RATE_LIMIT_MS = 3000;
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // proposal과 캐시 키 공유(store_analysis_*)

// 카테고리 표시 순서·음료 재료 틴트 (사장님께 보이는 화면이라 이모지가 제일 빨리 읽힘)
// 2026-07 '기타' 85건 재분류 → 티·커피·슈페너·쉐이크·초코·우유·시그니처 신설 ('기타'는 빈 폴백으로 유지)
const CATEGORIES: { key: string; emoji: string; tint: string }[] = [
  { key: '라떼', emoji: '☕', tint: '#f5efe6' },
  { key: '커피·슈페너', emoji: '🫘', tint: '#ede7e0' },
  { key: '티', emoji: '🫖', tint: '#eef4ec' },
  { key: '에이드', emoji: '🍋', tint: '#eaf6ea' },
  { key: '블렌디드', emoji: '🧊', tint: '#eaf1fb' },
  { key: '쉐이크', emoji: '🥤', tint: '#fdf1e7' },
  { key: '슬러시', emoji: '🍧', tint: '#e9f5f8' },
  { key: '밀크티', emoji: '🧋', tint: '#f3ede4' },
  { key: '스무디', emoji: '🍓', tint: '#f9edf1' },
  { key: '초코·우유', emoji: '🍫', tint: '#f3ece8' },
  { key: '시그니처', emoji: '✨', tint: '#f1eef7' },
  { key: '기타', emoji: '🧉', tint: '#f1f2f5' },
];

// 매장 concept 필터 — 사장님 매장 성격에 맞춰 전체 레시피를 한 번에 좁힌다 (카테고리·검색과 AND 결합)
const CONCEPTS: { key: string; hint: string; match: (tags: string[], products: string[]) => boolean }[] = [
  {
    key: '비건·식물성',
    hint: '오트·두유·아몬드',
    match: (tags, products) =>
      tags.some((t) => ['식물성', '비건', 'vegan', '오트', '두유', '아몬드'].includes(t)) ||
      products.some((p) => p.includes('오트') || p.includes('두유') || p.includes('아몬드')),
  },
  {
    key: '크림·디저트',
    hint: '크림·폼 올린 메뉴',
    match: (tags) => tags.some((t) => t === '크림' || t === '폼'),
  },
  {
    key: 'HOT 가능',
    hint: '따뜻하게 내는 메뉴',
    match: (tags) => tags.includes('HOT') || tags.includes('핫'),
  },
];

interface Recipe {
  name: string;
  category: string | null;
  pdf_url: string | null;
  main_products: string[] | null;
  image_url: string | null;    // PDF에서 추출한 음료 누끼컷 (Supabase Storage)
  description: string | null;  // PDF 소개 문장 (Gemini로 띄어쓰기 복원)
  tags: string[] | null;       // 원천 태그(ICE/HOT/크림/식물성…) — concept 필터 재료
  flavors: string[] | null;    // 정식 flavor 태그(DB 백필) — 없으면 deriveFlavors 폴백
  hero_rank: number | null;    // 홈 히어로 큐레이션 순서(NULL=비노출)
}

interface ConsultPrep {
  id: string;
  store_name: string;
  recipe_names: string[];
  created_at: string;
}

interface SheetProduct {
  spec: string;
  desc: string;
  usage: string;
  expiryDate: string;
}

interface AnalysisResult {
  success: boolean;
  tags: string[];
  description: string;
  items: Array<{ name: string }>;
  signatureMenus?: Array<{ name?: string; ingredients?: string }>;
}

interface AiRecipe {
  name: string;
  reason?: string;
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

// AI 분석 description은 강조용 HTML을 담아 옴 — 화이트리스트만 남기고 제거 (proposal과 동일)
function sanitizeAnalysisHtml(input: string): string {
  if (!input) return '';
  return input.replace(/<\/?([a-zA-Z]+)[^>]*>/g, (full, rawName: string) => {
    const name = rawName.toLowerCase();
    const closing = full.startsWith('</');
    if (name === 'strong' || name === 'b') return closing ? '</strong>' : '<strong>';
    if (name === 'span') return closing ? '</span>' : '<span style="color:#0071e3;font-weight:700">';
    return '';
  });
}

export default function ConsultPage() {
  const { user, metadata } = useAuth();
  const supabase = createClient();
  const router = useRouter();

  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState<Map<string, SheetProduct>>(new Map());
  const skuNames = useMemo(() => [...products.keys()], [products]);

  // 화면 상태 — category 미선택 = 카테고리 그리드
  const [category, setCategory] = useState<string | null>(null);
  const [flavor, setFlavor] = useState<string | null>(null);
  const [concept, setConcept] = useState<string | null>(null); // 매장 concept — 화면 전환에도 유지
  const [query, setQuery] = useState('');
  const [detail, setDetail] = useState<Recipe | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);

  // 내근 준비목록 — 방문 전 PC에서 매장별로 찜해두고 현장(폰)에서 불러온다
  const [preps, setPreps] = useState<ConsultPrep[]>([]);
  const [prepsOpen, setPrepsOpen] = useState(false);
  const [prepSaving, setPrepSaving] = useState(false);

  // 바구니 — 레시피 이름 단위. 현장에서 실수로 이탈해도 남도록 localStorage 백업
  const [basket, setBasket] = useState<string[]>([]);
  const [customerName, setCustomerName] = useState('');
  const [saving, setSaving] = useState(false);
  const [bump, setBump] = useState(false);
  const bumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // PC 전용 — AI 매장 분석 (네이버 리뷰 → 공략 포인트 + 추천 레시피)
  const [storeInput, setStoreInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [aiRecipes, setAiRecipes] = useState<AiRecipe[]>([]);
  const lastAnalysisRef = useRef(0);

  // ── 초기 로드 ──
  useEffect(() => {
    (async () => {
      try {
        const saved = localStorage.getItem(BASKET_STORAGE_KEY);
        // 과거 바구니는 NFD(자소분리) 이름일 수 있음 — DB가 NFC로 정규화돼 NFC로 맞춰 읽는다
        if (saved) setBasket((JSON.parse(saved) as string[]).map((n) => n.normalize('NFC')));
      } catch { /* ignore */ }

      const { data, error } = await supabase
        .from('recipes')
        .select('name, category, pdf_url, main_products, image_url, description, tags, flavors, hero_rank') // embedding(768차원) 절대 포함 금지
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
            usage: (r['사용용도'] || '').trim(),
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

  // 내근 준비목록 로드 (내 것만 — RLS)
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase
        .from('consult_preps')
        .select('id, store_name, recipe_names, created_at')
        .order('created_at', { ascending: false })
        .limit(30);
      setPreps((data as ConsultPrep[]) || []);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // ── 파생 데이터 ──
  // 정식 flavor 태그(DB) 우선, 구버전 캐시·미백필 행은 라이브 파생 폴백
  const flavorsOf = (r: Recipe) => r.flavors ?? deriveFlavors(r.name, r.main_products || []);

  const conceptDef = CONCEPTS.find((c) => c.key === concept);

  // concept 적용된 전체 풀 — 그리드 카운트·리스트·히어로 모두 이 기준
  const pool = useMemo(
    () => (conceptDef ? recipes.filter((r) => conceptDef.match(r.tags || [], r.main_products || [])) : recipes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [recipes, concept],
  );

  const countByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of pool) {
      const c = r.category || '기타';
      m.set(c, (m.get(c) || 0) + 1);
    }
    return m;
  }, [pool]);

  // 히어로 큐레이션 — hero_rank 낮은 순 (concept 필터 존중)
  const heroes = useMemo(
    () => pool.filter((r) => r.hero_rank != null).sort((a, b) => (a.hero_rank ?? 99) - (b.hero_rank ?? 99)),
    [pool],
  );

  const inCategory = useMemo(
    () => pool.filter((r) => (r.category || '기타') === category),
    [pool, category],
  );

  // 카테고리 내 flavor 칩 — 빈도순, 실제 있는 것만
  const flavorChips = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of inCategory) {
      for (const f of r.flavors ?? deriveFlavors(r.name, r.main_products || [])) m.set(f, (m.get(f) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([f]) => f);
  }, [inCategory]);

  const visible = useMemo(() => {
    const q = query.trim().normalize('NFC');
    let list = q
      ? pool.filter((r) => r.name.includes(q) || (r.main_products || []).some((p) => p.includes(q)))
      : inCategory;
    if (!q && flavor) {
      list = list.filter((r) => (r.flavors ?? deriveFlavors(r.name, r.main_products || [])).includes(flavor));
    }
    return list;
  }, [pool, inCategory, query, flavor]);

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

  // ── PC: AI 매장 분석 (proposal과 동일 API·캐시 공유) ──
  const analyzeStore = async () => {
    const keyword = storeInput.trim();
    if (!keyword) { toast.warning('매장명을 입력해주세요.'); return; }
    if (analyzing) return;
    if (products.size === 0) { toast.error('제품 DB 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return; }

    const now = Date.now();
    if (now - lastAnalysisRef.current < RATE_LIMIT_MS) {
      toast(`${Math.ceil((RATE_LIMIT_MS - (now - lastAnalysisRef.current)) / 1000)}초 후 다시 시도해주세요.`);
      return;
    }

    setAnalyzing(true);
    try {
      const cacheKey = `store_analysis_${keyword}`;
      const cached = typeof window !== 'undefined' ? localStorage.getItem(cacheKey) : null;
      let data: AnalysisResult | null = null;
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (now - parsed.timestamp < CACHE_EXPIRY_MS) data = parsed.result;
        } catch { /* ignore */ }
      }

      if (!data) {
        const productDB = [...products.entries()].map(([name, p]) => ({
          name, spec: p.spec, price: 0, taxFree: false, imageUrl: null,
          maxDc: 0, desc: p.desc, usage: p.usage, expiryDate: p.expiryDate,
        }));
        const response = await fetch('/api/naver-reviews', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ storeName: keyword, productDB, previousReviewLinks: [] }),
        });
        const result = await response.json();
        if (!result.success) throw new Error(result.error || '분석에 실패했습니다.');
        data = result as AnalysisResult;
        localStorage.setItem(cacheKey, JSON.stringify({ timestamp: now, result }));
        lastAnalysisRef.current = now;
      }

      setAnalysis(data);

      // 분석 결과로 레시피 RAG 추천
      try {
        const res = await fetch('/api/recipe-recommend', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeName: keyword,
            tags: data.tags || [],
            signatureMenus: data.signatureMenus || [],
            productNames: (data.items || []).map((i) => i.name),
          }),
        });
        if (res.ok) {
          const result = await res.json();
          setAiRecipes(result.recipes || []);
        }
      } catch { setAiRecipes([]); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

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
      toast.success('견적 초안을 저장했습니다. 견적서의 "불러오기"에서 확인하세요.', {
        action: { label: '견적서 열기', onClick: () => router.push('/proposal') },
      });
      setBasket([]);
      setCustomerName('');
      setBasketOpen(false);
    } catch (e) {
      toast.error('저장 실패: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── 내근 준비목록: 저장·불러오기·삭제 ──
  const savePrep = async () => {
    if (!user) { toast.error('로그인이 필요합니다.'); return; }
    if (basket.length === 0) { toast.warning('담은 메뉴가 없습니다.'); return; }
    const store = customerName.trim();
    if (!store) { toast.warning('어느 매장 준비인지 거래처(매장)명을 먼저 입력해주세요.'); return; }
    setPrepSaving(true);
    try {
      const { data, error } = await supabase
        .from('consult_preps')
        .insert({ store_name: store, recipe_names: basket })
        .select('id, store_name, recipe_names, created_at')
        .single();
      if (error) throw error;
      setPreps((prev) => [data as ConsultPrep, ...prev]);
      toast.success(`"${store}" 준비목록으로 저장했습니다. 현장에서 불러올 수 있어요.`);
    } catch (e) {
      toast.error('준비목록 저장 실패: ' + (e as Error).message);
    } finally {
      setPrepSaving(false);
    }
  };

  const loadPrep = (prep: ConsultPrep) => {
    const known = prep.recipe_names.filter((n) => recipes.some((r) => r.name === n));
    const missing = prep.recipe_names.length - known.length;
    setBasket(known);
    setCustomerName(prep.store_name);
    setPrepsOpen(false);
    setBasketOpen(false);
    toast.success(
      `"${prep.store_name}" 준비목록을 불러왔습니다 (메뉴 ${known.length}개${missing > 0 ? `, ${missing}개는 레시피 변경으로 제외` : ''})`,
    );
  };

  const deletePrep = async (prep: ConsultPrep) => {
    const { error } = await supabase.from('consult_preps').delete().eq('id', prep.id);
    if (error) { toast.error('삭제 실패: ' + error.message); return; }
    setPreps((prev) => prev.filter((p) => p.id !== prep.id));
    toast(`"${prep.store_name}" 준비목록을 삭제했습니다`);
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

  // 바구니 내용(패널·시트 공용) — 메뉴/제품 목록 + 거래처명 + 저장
  const basketBody = (
    <>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">메뉴 {basketRecipes.length}</div>
      <div className="flex flex-col gap-1.5">
        {basketRecipes.map((r) => (
          <div key={r.name} className="flex items-center gap-2 rounded-xl bg-[#f8fafc] py-1 pl-3 pr-1">
            <span className="min-w-0 flex-1 truncate py-1.5 text-[13.5px] font-medium text-[#0f172a]">{r.name}</span>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setBasket((prev) => prev.filter((n) => n !== r.name)); }}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-red-50 hover:text-red-500"
              aria-label={`${r.name} 빼기`}
            >
              <Trash2 size={16} />
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
        <div className="flex gap-2">
          <button
            onClick={savePrep}
            disabled={prepSaving}
            className="flex shrink-0 items-center gap-1.5 rounded-2xl border border-[#d6dbe3] bg-white px-3.5 py-3.5 text-[13px] font-semibold text-[#334155] disabled:opacity-60"
            title="방문 전 미리 담아두기 — 현장에서 준비목록으로 불러옵니다"
          >
            <ClipboardList size={15} />{prepSaving ? '저장 중…' : '준비목록'}
          </button>
          <button
            onClick={saveDraft}
            disabled={saving}
            className="flex-1 rounded-2xl bg-[#2563eb] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
          >
            {saving ? '저장 중…' : '견적 초안으로 저장'}
          </button>
        </div>
      </div>
    </>
  );

  // 준비목록 목록(PC 패널·모바일 시트 공용) — 탭하면 바구니로 불러오기
  const prepsBody = preps.length === 0 ? (
    <p className="text-xs text-[#94a3b8]">준비목록이 없습니다</p>
  ) : (
    <div className="flex flex-col gap-1.5">
      {preps.map((p) => (
        <div key={p.id} className="flex items-center gap-1 rounded-xl bg-[#f8fafc] py-1 pl-3 pr-1">
          <button type="button" onClick={() => loadPrep(p)} className="min-w-0 flex-1 py-1.5 text-left">
            <div className="flex items-center gap-1.5">
              <FolderDown size={13} className="shrink-0 text-[#2563eb]" />
              <span className="truncate text-[13.5px] font-semibold text-[#0f172a]">{p.store_name}</span>
            </div>
            <div className="mt-0.5 pl-[19px] text-[11px] text-[#94a3b8]">
              메뉴 {p.recipe_names.length}개 · {new Date(p.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
            </div>
          </button>
          <button
            type="button"
            onClick={() => deletePrep(p)}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#94a3b8] hover:bg-red-50 hover:text-red-500"
            aria-label={`${p.store_name} 준비목록 삭제`}
          >
            <Trash2 size={15} />
          </button>
        </div>
      ))}
    </div>
  );

  // ── 렌더 ──
  return (
    <div className="min-h-full bg-[#f6f7f9]">
      {/* PC 헤더 — 견적서와 같은 작업화면 틀, 버튼으로 견적서와 오간다 */}
      <div className="hidden md:block">
        <PageHeader
          title="메뉴 상담"
          actions={<Link href="/proposal" className={headerBtn.primary}><FileText size={15} />견적서 전환</Link>}
        />
      </div>

      <div className="mx-auto max-w-[520px] px-4 pb-36 pt-4 md:max-w-[1500px] md:px-6 md:pb-8 md:pt-5">
        {/* PC: 두 컬럼을 뷰포트 높이에 맞추고 각자 내부 스크롤 — 좌우 시선 이동 최소화 */}
        <div className="md:grid md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-start md:gap-4 md:[&>*]:max-h-[calc(100dvh-190px)] md:[&>*]:overflow-y-auto">

          {/* ── PC 좌측: AI 매장 분석 + 바구니 ── */}
          <aside className="hidden md:flex md:flex-col md:gap-3.5 md:pr-0.5">
            <div className="rounded-2xl border border-[#e8ebf0] bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-[#475569]">
                <Sparkles size={16} className="text-[#2563eb]" />AI 매장 분석
                <span className="text-xs text-[#94a3b8]">네이버 리뷰 기반</span>
              </div>
              <div className="flex gap-2">
                <label className="flex flex-1 items-center gap-2 rounded-lg border border-[#e2e8f0] px-3 py-2.5 focus-within:border-[#2563eb]">
                  <Search size={15} className="shrink-0 text-[#94a3b8]" />
                  <input
                    value={storeInput}
                    onChange={(e) => setStoreInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && analyzeStore()}
                    placeholder="매장명 (예: 연남동 ○○카페)"
                    className="min-w-0 flex-1 bg-transparent text-sm outline-none"
                  />
                </label>
                <button
                  onClick={analyzeStore}
                  disabled={analyzing}
                  className="shrink-0 rounded-lg bg-[#2563eb] px-4 text-sm font-medium text-white disabled:opacity-50"
                >
                  {analyzing ? '분석 중' : '분석'}
                </button>
              </div>

              {analysis && (
                <div className="mt-3 rounded-xl bg-[#f0f4fa] p-3.5">
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {analysis.tags.map((t) => (
                      <span key={t} className="rounded-md bg-[#dde7f5] px-2 py-0.5 text-[11px] text-[#1B3F82]">#{t}</span>
                    ))}
                  </div>
                  <p
                    className="text-xs leading-relaxed text-[#5b6675]"
                    dangerouslySetInnerHTML={{ __html: sanitizeAnalysisHtml(analysis.description) }}
                  />
                </div>
              )}

              {aiRecipes.length > 0 && (
                <div className="mt-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#94a3b8]">이 매장에 추천하는 레시피</div>
                  <div className="flex flex-col gap-1.5">
                    {aiRecipes.map((ar) => {
                      const recipe = recipes.find((r) => r.name === ar.name);
                      const picked = inBasket(ar.name);
                      return (
                        <div key={ar.name} className="flex items-center gap-2 rounded-xl border border-[#f3e3cf] bg-[#fdf6ec] px-3 py-2">
                          <button
                            className="min-w-0 flex-1 text-left"
                            onClick={() => recipe && setDetail(recipe)}
                            disabled={!recipe}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="truncate text-[13px] font-semibold text-[#0f172a]">{ar.name}</span>
                              {picked && <Check size={13} className="shrink-0 text-[#2563eb]" />}
                            </div>
                            {ar.reason && <div className="mt-0.5 text-[11px] leading-snug text-[#9a6512]">{ar.reason}</div>}
                          </button>
                          {recipe && (
                            <button
                              onClick={() => toggleBasket(recipe)}
                              className={`shrink-0 rounded-lg p-1.5 ${picked ? 'bg-[#e2e8f0] text-[#64748b]' : 'bg-[#2563eb] text-white'}`}
                              aria-label={picked ? `${ar.name} 담기 취소` : `${ar.name} 담기`}
                            >
                              {picked ? <X size={14} /> : <Plus size={14} />}
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            </div>

            {/* 바구니 패널 */}
            <div className="rounded-2xl border border-[#e8ebf0] bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-[#475569]">
                <ShoppingBag size={16} className="text-[#2563eb]" />오늘 담은 제안
              </div>
              {basketRecipes.length === 0 ? (
                <p className="text-xs text-[#94a3b8]">담은 메뉴가 없습니다</p>
              ) : basketBody}
            </div>

            {/* 내근 준비목록 패널 — 사무실에서 찜해두고 현장에서 연다 */}
            <div className="rounded-2xl border border-[#e8ebf0] bg-white p-4">
              <div className="mb-3 flex items-center gap-2 text-sm text-[#475569]">
                <ClipboardList size={16} className="text-[#2563eb]" />내근 준비목록
                {preps.length > 0 && <span className="text-xs text-[#94a3b8]">{preps.length}건</span>}
              </div>
              {prepsBody}
            </div>
          </aside>

          {/* ── 공통(모바일 전체 / PC 우측): 레시피 브라우징 ── */}
          <div>
            {/* 모바일 헤더 */}
            <div className="mb-3 flex items-center gap-2 md:hidden">
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
              {/* 준비목록 열기 — 현장 도착 직후 첫 동작이라 헤더 상시 노출 */}
              <button
                onClick={() => setPrepsOpen(true)}
                className="relative flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#334155] shadow-sm"
                aria-label="내근 준비목록 열기"
              >
                <ClipboardList size={18} />
                {preps.length > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#2563eb] px-1 text-[9.5px] font-bold text-white">
                    {preps.length}
                  </span>
                )}
              </button>
            </div>

            {/* PC에서 리스트 상단 뒤로가기 */}
            {(category || searching) && (
              <button
                onClick={() => { setCategory(null); setFlavor(null); setQuery(''); }}
                className="mb-3 hidden items-center gap-1 text-[13px] font-medium text-[#64748b] hover:text-[#334155] md:inline-flex"
              >
                <ChevronLeft size={15} />전체 카테고리
              </button>
            )}

            {/* 검색 (사장님이 말한 키워드 즉시 대응) */}
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
              <div className="flex items-center justify-center py-20 text-sm text-[#94a3b8]">
                레시피를 불러오는 중…
              </div>
            ) : !category && !searching ? (

              /* 화면 1: 매장 컨셉 칩 + 히어로 큐레이션 + 카테고리 그리드 */
              <>
                {/* 매장 concept — 사장님 매장 성격에 맞춰 전체 레시피를 좁힘 (전 화면 유지) */}
                <div className="mb-4 flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                  {CONCEPTS.map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setConcept(concept === c.key ? null : c.key)}
                      className={`shrink-0 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${concept === c.key ? 'bg-[#1B3F82] text-white' : 'bg-white text-[#475569] shadow-sm'}`}
                      title={c.hint}
                    >
                      {concept === c.key ? '✓ ' : ''}{c.key}
                    </button>
                  ))}
                </div>

                {/* 히어로 큐레이션 — 시즌 대표 메뉴, 탭하면 바로 상세 */}
                {heroes.length > 0 && (
                  <div className="mb-5">
                    <div className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-[#475569]">
                      <Sparkles size={14} className="text-[#2563eb]" />이번 시즌 추천
                    </div>
                    {/* 모바일만 풀블리드 — PC 내부 스크롤 컬럼에선 음수 마진이 첫 카드를 잘라먹음 */}
                    <div className="-mx-4 flex snap-x snap-mandatory gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
                      {heroes.map((r) => {
                        const tint = CATEGORIES.find((c) => c.key === (r.category || '기타'))?.tint ?? '#f1f2f5';
                        return (
                          <button
                            key={r.name}
                            onClick={() => setDetail(r)}
                            className="w-[150px] shrink-0 snap-start overflow-hidden rounded-[20px] border border-black/[0.04] bg-white text-left transition-transform active:scale-[0.97]"
                          >
                            <div className="flex h-[130px] items-end justify-center px-3" style={{ background: tint }}>
                              {r.image_url ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={r.image_url} alt="" loading="lazy" className="max-h-[112px] w-auto object-contain drop-shadow-md" />
                              ) : (
                                <span className="pb-8 text-[40px]">{CATEGORIES.find((c) => c.key === (r.category || '기타'))?.emoji ?? '✨'}</span>
                              )}
                            </div>
                            <div className="px-3 py-2.5">
                              <div className="truncate text-[13.5px] font-semibold text-[#0f172a]">{r.name}</div>
                              <div className="mt-0.5 text-[11px] text-[#94a3b8]">{r.category}</div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
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
              </>

            ) : (

              /* 화면 2: 레시피 리스트 (+ flavor 칩) */
              <>
                {!searching && (flavorChips.length > 0 || concept) && (
                  // PC에선 우측 내부 스크롤 컨테이너 기준으로 상단 고정(md:top-0)
                  <div className="sticky top-12 z-10 -mx-4 mb-3 px-4 py-2 backdrop-blur-xl [background:rgba(246,247,249,0.82)] md:top-0">
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none]">
                      {concept && (
                        <button
                          onClick={() => setConcept(null)}
                          className="flex shrink-0 items-center gap-1 rounded-full bg-[#1B3F82] px-3 py-1.5 text-[13px] font-medium text-white"
                          aria-label={`${concept} 컨셉 해제`}
                        >
                          {concept}<X size={13} />
                        </button>
                      )}
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
                  <div className="flex flex-col gap-2.5 md:grid md:grid-cols-2">
                    {visible.map((r) => {
                      const picked = inBasket(r.name);
                      const prods = (r.main_products || []).slice(0, 2);
                      const more = (r.main_products || []).length - prods.length;
                      const tint = CATEGORIES.find((c) => c.key === (r.category || '기타'))?.tint ?? '#f1f2f5';
                      return (
                        <button
                          key={r.name}
                          onClick={() => setDetail(r)}
                          className="flex items-center gap-3 rounded-[20px] border border-[#e8ebf0] bg-white p-3 pr-4 text-left transition-transform active:scale-[0.98]"
                        >
                          {/* 썸네일 — 누끼컷(lazy), 없으면 카테고리 이모지 */}
                          <div
                            className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl"
                            style={{ background: tint }}
                          >
                            {r.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={r.image_url} alt="" loading="lazy" className="h-14 w-14 object-contain drop-shadow-sm" />
                            ) : (
                              <span className="text-[22px]">{CATEGORIES.find((c) => c.key === (r.category || '기타'))?.emoji ?? '✨'}</span>
                            )}
                          </div>
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
        </div>
      </div>

      {/* ── 모바일 시그니처: 플로팅 글래스 바구니 캡슐 ── */}
      {basket.length > 0 && (
        <div className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-6 md:hidden">
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

      {/* ── 상세 바텀시트(모바일) / 대형 2단 모달(PC: 좌 음료컷 · 우 정보) ── */}
      {detail && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 md:items-center md:p-6" onClick={() => setDetail(null)}>
          <div
            className={`relative w-full max-w-[520px] rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3 md:rounded-[28px] md:p-6 md:pb-6 ${detail.image_url ? 'md:max-w-[860px]' : 'md:max-w-[560px]'}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#e2e8f0] md:hidden" />
            {/* PC는 backdrop 외에 명시적 닫기 버튼 제공 */}
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="absolute right-4 top-4 z-10 hidden h-8 w-8 items-center justify-center rounded-full text-[#94a3b8] hover:bg-gray-100 md:flex"
              aria-label="닫기"
            >
              <X size={18} />
            </button>

            <div className="md:flex md:items-stretch md:gap-6">
              {/* PC 좌측: 음료 누끼컷 — 카테고리 틴트 배경 위에 크게 */}
              {detail.image_url && (
                <div
                  className="hidden shrink-0 items-center justify-center rounded-[22px] md:flex md:w-[350px] md:p-8"
                  style={{ background: CATEGORIES.find((c) => c.key === (detail.category || '기타'))?.tint ?? '#f1f2f5' }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={detail.image_url}
                    alt={detail.name}
                    className="max-h-[400px] w-auto object-contain drop-shadow-[0_16px_24px_rgba(15,23,42,0.18)]"
                  />
                </div>
              )}

              <div className="min-w-0 flex-1 md:flex md:flex-col md:py-1">
                {/* 모바일: 이미지 상단 중앙(작게) */}
                {detail.image_url && (
                  <div className="mb-3 flex justify-center md:hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={detail.image_url} alt={detail.name} className="h-44 w-auto object-contain drop-shadow-lg" />
                  </div>
                )}

                <div className="mb-1 flex flex-wrap gap-1 md:mt-1">
                  {flavorsOf(detail).map((f) => (
                    <span key={f} className="rounded-full bg-[#f1f5f9] px-2 py-0.5 text-[11px] font-medium text-[#64748b]">#{f}</span>
                  ))}
                </div>
                <h2 className="text-[22px] font-bold leading-snug text-[#0f172a] md:text-[26px]">{detail.name}</h2>
                <p className="mt-1.5 text-[13px] leading-relaxed text-[#64748b] md:text-[14.5px]">
                  {detail.description || '누가 만들어도 같은 맛 — 자세한 조리법은 레시피 PDF에 있습니다'}
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

                <div className="mt-4 flex gap-2 md:mt-auto md:pt-4">
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
          </div>
        </div>
      )}

      {/* ── 모바일 준비목록 바텀시트 ── */}
      {prepsOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 md:hidden" onClick={() => setPrepsOpen(false)}>
          <div
            className="flex max-h-[70dvh] w-full max-w-[520px] flex-col rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#e2e8f0]" />
            <h2 className="text-[19px] font-bold text-[#0f172a]">내근 준비목록</h2>
            <p className="mt-0.5 text-[12.5px] text-[#94a3b8]">방문 전 미리 담아둔 매장별 제안 — 탭하면 바구니로 불러옵니다</p>
            <div className="mt-4 flex-1 overflow-y-auto">{prepsBody}</div>
          </div>
        </div>
      )}

      {/* ── 모바일 바구니 바텀시트 ── */}
      {basketOpen && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 md:hidden" onClick={() => setBasketOpen(false)}>
          <div
            className="flex max-h-[82dvh] w-full max-w-[520px] flex-col rounded-t-[28px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-[#e2e8f0]" />
            <h2 className="text-[19px] font-bold text-[#0f172a]">오늘 담은 제안</h2>
            <p className="mt-0.5 text-[12.5px] text-[#94a3b8]">저장하면 견적서 화면의 &quot;불러오기&quot;에서 이어서 작성할 수 있습니다</p>
            <div className="mt-4 flex-1 overflow-y-auto">{basketBody}</div>
          </div>
        </div>
      )}

      {/* 담기 순간 캡슐 bump 애니메이션 (reduced-motion 시 motion-safe로 비활성) */}
      <style>{`@keyframes consultBump{0%{transform:scale(1)}35%{transform:scale(1.05)}100%{transform:scale(1)}}`}</style>
    </div>
  );
}
