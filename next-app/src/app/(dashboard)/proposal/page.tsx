'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  FolderOpen, Save, Printer, Search, Sparkles, Plus, LayoutGrid, Store,
  ChevronDown, X, Trash2, Copy,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { PageHeader, headerBtn } from '@/components/layout/page-header';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const PRODUCT_DB_SHEETS_URL =
  'https://docs.google.com/spreadsheets/d/1JnLQVr3JGqZPyvQ6bf8TSl0dNN6_oI05YH7d9zSgsKI/export?format=csv&gid=1802773439';
// 상품 이미지는 구 GitHub Pages가 아니라 배포 도메인의 로컬 public에서 서빙(도메인 비종속).
// 78개 이미지는 next-app/public/assets/images에 존재 — Pages 비활성화·주소 변경에도 안전.
const PRODUCT_IMAGE_BASE = '/assets/images/';

const PRODUCT_IMAGE_MANUAL_MAP: Record<string, string> = {
  '매일 멸균 오리지널 1L': '매일 멸균 우유 오리지널 1L×10.jpg',
  '상하목장 유기농우유 900ml': '상하목장 유기농 우유 900ml×12.jpg',
  '베이커리치즈 1.8kg(100매)': '베이커리치즈1.8kg(100매)×5.jpg',
  '베이커리치즈II 1.8kg(100매)': '베이커리치즈1.8kg(100매)×5.jpg',
  '매일 휘핑크림 골드 1L': '매일 휘핑크림골드 1L.jpg',
  '콰트로퐁듀 크림치즈 1kg': '콰트로퐁듀크림치즈1KG.jpg',
  '체다슬라이스III 100매 1.8kg': '체다슬라이스III 100매 .jpg',
  '테너 베이스 체리 1.2kg': '테너 베이스 체리.jpg',
  '테너 베이스 클레멘타인 1.2kg': '테너 베이스 클레멘타인.jpg',
  '매일 두유 99.9 950ml': '매일두유 99.9 950mL.jpg',
  '상하목장 요거트 소프트믹스 OM3 1L': '상하목장 요거트 소프트믹스 OM3.jpg',
  '상하목장 소프트믹스 OM10 1L': '상하목장소프트믹스OM10 1L.jpg',
  '상하목장 초콜릿믹스 1L': '상하목장 초콜릿 믹스 1L*10 .jpg',
  '테너 베이스 과육플러스 청포도 1kg': '테너베이스 과육 플러스 청포도 1kg.jpg',
};

const PICKER_CATS: [string, string][] = [
  ['all', '전체'],
  ['우유', '🥛 우유'],
  ['크림', '🧈 크림/버터'],
  ['오트', '🌾 오트/두유'],
  ['치즈', '🧀 치즈'],
  ['테너', '🫙 테너'],
  ['소프트', '🍦 소프트믹스'],
  ['연유', '🍯 연유'],
];

const PICKER_CAT_KEYWORDS: Record<string, string[]> = {
  '우유': ['우유'],
  '크림': ['크림', '생크림', '휘핑', '버터'],
  '오트': ['오트', '두유', '아몬드', '귀리'],
  '치즈': ['치즈'],
  '테너': ['테너'],
  '소프트': ['소프트믹스', '소프트 믹스', '초콜릿믹스', '초콜릿 믹스'],
  '연유': ['연유'],
};

const RATE_LIMIT_MS = 3000;
const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000;

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface Product {
  name: string;
  spec: string;
  price: number;
  taxFree: boolean;
  imageUrl: string | null;
  maxDc: number;
  desc: string;
  usage: string;
  expiryDate: string;
}

interface QuoteItem {
  id: string;
  name: string;
  spec: string;
  factoryPrice: number;
  dcRate: number;
  salesPrice: number;
  taxFree: boolean;
  desc: string;
  expiryDate: string;
}

interface AnalysisResult {
  success: boolean;
  tags: string[];
  description: string;
  items: Array<{ name: string; spec?: string; price?: number; image?: string; imageUrl?: string; taxFree?: boolean; maxDc?: number; expiryDate?: string }>;
  signatureMenus?: Array<{ name?: string; ingredients?: string }>;
  reviewLinks?: string[];
}

interface Recipe {
  name: string;
  category?: string | string[];
  pdf_url?: string;
  main_products?: string[];
  reason?: string;
}

interface SavedQuote {
  id: string;
  customer_name: string;
  created_by: string;
  total_amount: number;
  memo?: string;
  created_at: string;
  updated_at: string;
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

let _rowSeq = 0;
function newRowId(): string {
  _rowSeq += 1;
  return `row-${_rowSeq}`;
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

function rowCost(item: QuoteItem): number {
  const dcAmount = item.factoryPrice * (item.dcRate / 100);
  const supply = item.factoryPrice - dcAmount;
  const vat = item.taxFree ? 0 : Math.floor(supply * 0.1);
  return supply + vat;
}

function rowMargin(item: QuoteItem): number {
  const cost = rowCost(item);
  return item.salesPrice > 0 ? ((item.salesPrice - cost) / item.salesPrice) * 100 : 0;
}

// ════════════════════════════════════════════════════════════════════════════

export default function ProposalPage() {
  const { user, metadata } = useAuth();
  const supabase = createClient();

  // 제품 DB / 이미지
  const [productDB, setProductDB] = useState<Product[]>([]);
  const imageFilesRef = useRef<string[]>([]);

  const findProductImage = useCallback((name: string): string | null => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const manual = PRODUCT_IMAGE_MANUAL_MAP[trimmed];
    if (manual) return PRODUCT_IMAGE_BASE + encodeURIComponent(manual);
    const lower = trimmed.toLowerCase();
    const match = imageFilesRef.current.find((f) => f.toLowerCase().startsWith(lower));
    return match ? PRODUCT_IMAGE_BASE + encodeURIComponent(match) : null;
  }, []);

  // 견적 항목
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [quoteMode, setQuoteMode] = useState<'custom' | 'general'>('custom');
  const [customerName, setCustomerName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [managerPhone, setManagerPhone] = useState('');
  const [quoteMemo, setQuoteMemo] = useState('');
  const [loadedQuoteId, setLoadedQuoteId] = useState<string | null>(null);

  // 분석
  const [storeInput, setStoreInput] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const lastAnalysisRef = useRef(0);

  // 카탈로그 피커
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerCat, setPickerCat] = useState('all');
  const [analysisOpen, setAnalysisOpen] = useState(true);

  // 견적 불러오기
  const [quotePickerOpen, setQuotePickerOpen] = useState(false);
  const [savedQuotes, setSavedQuotes] = useState<SavedQuote[]>([]);
  const [savingQuote, setSavingQuote] = useState(false);

  // ── 초기 로드 ─────────────────────────────────────────────────────────────

  useEffect(() => {
    (async () => {
      // 이미지 매니페스트
      try {
        const res = await fetch('/assets/images/manifest.json?v=' + Date.now());
        if (res.ok) imageFilesRef.current = await res.json();
      } catch { /* ignore */ }

      // 제품 DB
      try {
        const res = await fetch(PRODUCT_DB_SHEETS_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const csv = await res.text();
        const rows = parseCSV(csv).filter((r) => r['품명'] && r['품명'].trim());
        const db: Product[] = rows.map((r) => {
          const name = r['품명'].trim();
          return {
            name,
            spec: r['내입량'] ? r['내입량'].trim() + '개입' : '',
            price: 0,
            taxFree: false,
            imageUrl: findProductImage(name),
            maxDc: 0,
            desc: (r['제품 상세 내용'] || '').trim(),
            usage: (r['사용용도'] || '').trim(),
            expiryDate: (r['소비기한'] || '').trim(),
          };
        });
        setProductDB(db);
      } catch (e) {
        console.warn('제품 DB 로드 실패:', (e as Error).message);
        toast.error('제품 DB 로드 실패 — 추천상품이 표시되지 않을 수 있습니다.');
      }
    })();
  }, [findProductImage]);

  function blankItem(data?: Partial<QuoteItem>): QuoteItem {
    return {
      id: newRowId(),
      name: data?.name ?? '',
      spec: data?.spec ?? '',
      factoryPrice: data?.factoryPrice ?? 0,
      dcRate: data?.dcRate ?? 0,
      salesPrice: data?.salesPrice ?? 0,
      taxFree: data?.taxFree ?? false,
      desc: data?.desc ?? '',
      expiryDate: data?.expiryDate ?? '',
    };
  }

  // 첫 행 1개 + 담당자 자동 채우기
  useEffect(() => {
    setItems([blankItem()]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const name = metadata?.full_name;
    if (name) setManagerName((prev) => prev || name);
  }, [metadata]);

  // ── 항목 조작 ─────────────────────────────────────────────────────────────

  const addItem = (data?: Partial<QuoteItem>) => {
    setItems((prev) => [...prev, blankItem(data)]);
  };

  const addProduct = (p: Product, salesPrice?: number) => {
    addItem({
      name: p.name, spec: p.spec, factoryPrice: p.price, salesPrice: salesPrice ?? p.price,
      taxFree: p.taxFree, desc: p.desc, expiryDate: p.expiryDate,
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const updateItem = (id: string, patch: Partial<QuoteItem>) => {
    setItems((prev) => prev.map((it) => {
      if (it.id !== id) return it;
      const next = { ...it, ...patch };
      // 품명이 제품 DB와 매칭되면 자동완성
      if (patch.name !== undefined) {
        const matched = productDB.find((p) => p.name === patch.name);
        if (matched) {
          next.spec = matched.spec;
          next.factoryPrice = matched.price;
          if (!next.salesPrice) next.salesPrice = matched.price;
          next.taxFree = matched.taxFree;
          next.desc = matched.desc;
          next.expiryDate = matched.expiryDate;
        }
      }
      return next;
    }));
  };

  // ── 합계 계산 ─────────────────────────────────────────────────────────────

  const totalSales = items.reduce((s, it) => s + it.salesPrice, 0);
  const totalCost = items.reduce((s, it) => s + rowCost(it), 0);
  const totalMargin = totalSales > 0 ? ((totalSales - totalCost) / totalSales) * 100 : 0;

  // ── AI 분석 ───────────────────────────────────────────────────────────────

  const loadRecipeRAG = useCallback(async (storeName: string, data: AnalysisResult) => {
    try {
      const res = await fetch('/api/recipe-recommend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          storeName,
          tags: data.tags || [],
          signatureMenus: data.signatureMenus || [],
          productNames: (data.items || []).map((i) => i.name),
        }),
      });
      if (!res.ok) return;
      const result = await res.json();
      setRecipes(result.recipes || []);
    } catch {
      setRecipes([]);
    }
  }, []);

  const analyzeStore = async () => {
    const keyword = storeInput.trim();
    if (!keyword) { toast.warning('매장명을 입력해주세요.'); return; }
    if (analyzing) return;

    const now = Date.now();
    if (now - lastAnalysisRef.current < RATE_LIMIT_MS) {
      toast(`${Math.ceil((RATE_LIMIT_MS - (now - lastAnalysisRef.current)) / 1000)}초 후 다시 시도해주세요.`);
      return;
    }
    if (productDB.length === 0) { toast.error('제품 DB 로딩 중입니다. 잠시 후 다시 시도해주세요.'); return; }

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
      void loadRecipeRAG(keyword, data);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  };

  // ── 견적 저장/불러오기 ────────────────────────────────────────────────────

  const saveQuote = async (forceNew = false) => {
    if (!user) { toast.error('로그인이 필요합니다.'); return; }
    const businessUnit = metadata?.business_unit;
    if (!businessUnit) { toast.error('사업부 정보가 없습니다.'); return; }

    setSavingQuote(true);
    try {
      const now = new Date().toISOString();
      const payload = {
        business_unit: businessUnit,
        created_by: metadata?.full_name || user.email,
        customer_name: customerName,
        manager_name: managerName,
        manager_phone: managerPhone,
        quote_mode: quoteMode,
        memo: quoteMemo,
        items: items.map((it) => ({
          name: it.name, spec: it.spec, factoryPrice: it.factoryPrice,
          dcRate: it.dcRate, salesPrice: it.salesPrice, desc: it.desc,
          taxFree: it.taxFree, expiryDate: it.expiryDate,
        })),
        total_amount: Math.floor(totalSales),
        updated_at: now,
      };
      let error;
      if (loadedQuoteId && !forceNew) {
        ({ error } = await supabase.from('quotes').update(payload).eq('id', loadedQuoteId).eq('business_unit', businessUnit));
      } else {
        setLoadedQuoteId(null);
        ({ error } = await supabase.from('quotes').insert(payload));
      }
      if (error) throw error;
      toast.success('견적서가 저장되었습니다.');
    } catch (e) {
      toast.error('저장 실패: ' + (e as Error).message);
    } finally {
      setSavingQuote(false);
    }
  };

  const openQuotePicker = async () => {
    setQuotePickerOpen(true);
    const businessUnit = metadata?.business_unit;
    if (!businessUnit) return;
    const { data, error } = await supabase.from('quotes')
      .select('id, customer_name, created_by, total_amount, memo, created_at, updated_at')
      .eq('business_unit', businessUnit)
      .order('updated_at', { ascending: false })
      .limit(20);
    if (error || !data) { setSavedQuotes([]); return; }
    setSavedQuotes(data as SavedQuote[]);
  };

  const loadQuote = async (id: string) => {
    const businessUnit = metadata?.business_unit;
    if (!businessUnit) { toast.error('사업부 정보가 없습니다.'); return; }
    const { data, error } = await supabase.from('quotes').select('*').eq('id', id).eq('business_unit', businessUnit).single();
    if (error || !data) { toast.error('불러오기 실패'); return; }
    setLoadedQuoteId(data.id);
    setCustomerName(data.customer_name || '');
    setManagerName(data.manager_name || '');
    setManagerPhone(data.manager_phone || '');
    setQuoteMemo(data.memo || '');
    setQuoteMode(data.quote_mode === 'general' ? 'general' : 'custom');
    const loaded: QuoteItem[] = (data.items || []).map((item: Partial<QuoteItem>) => blankItem({
      name: item.name, spec: item.spec, factoryPrice: item.factoryPrice || 0,
      dcRate: item.dcRate || 0, salesPrice: item.salesPrice || 0, desc: item.desc || '',
      taxFree: item.taxFree ?? false, expiryDate: item.expiryDate || '',
    }));
    setItems(loaded.length ? loaded : [blankItem()]);
    setQuotePickerOpen(false);
    toast.success(`"${data.customer_name}" 견적서를 불러왔습니다.`);
  };

  const deleteQuote = async (id: string) => {
    const businessUnit = metadata?.business_unit;
    if (!businessUnit) return;
    const { error } = await supabase.from('quotes').delete().eq('id', id).eq('business_unit', businessUnit);
    if (error) { toast.error('삭제 실패: ' + error.message); return; }
    setSavedQuotes((prev) => prev.filter((q) => q.id !== id));
  };

  // ── PDF 출력 ──────────────────────────────────────────────────────────────

  const generatePDF = () => {
    window.print();
  };

  // ── 카탈로그 피커 ─────────────────────────────────────────────────────────

  const pickerProducts = pickerCat === 'all'
    ? productDB
    : productDB.filter((p) => (PICKER_CAT_KEYWORDS[pickerCat] || [pickerCat]).some((kw) => p.name.includes(kw)));

  const showRecipient = quoteMode !== 'general';

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-full bg-[#f6f7f9]">
      <PageHeader
        title="견적서"
        subtitle="매장 분석 → 단가·마진 검토 → 맞춤 카탈로그"
        actions={
          <>
            <button onClick={openQuotePicker} className={headerBtn.outline}><FolderOpen size={15} />불러오기</button>
            <button onClick={() => saveQuote(false)} disabled={savingQuote} className={headerBtn.outline}><Save size={15} />저장</button>
            {loadedQuoteId && <button onClick={() => saveQuote(true)} className={headerBtn.outline}><Copy size={15} />복사본</button>}
            <button onClick={generatePDF} className={headerBtn.primary}><Printer size={15} />PDF 출력</button>
          </>
        }
      />

      <div className="mx-auto max-w-[1500px] px-4 pb-16 pt-5 md:px-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">

          {/* ── 좌측: 작업 패널 ── */}
          <div className="no-print flex flex-col gap-3.5">

            {/* 견적 설정 */}
            <div className="rounded-2xl border border-[#e8ebf0] bg-white p-4">
              <div className="mb-3 flex gap-1.5">
                <button onClick={() => setQuoteMode('custom')} className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${quoteMode === 'custom' ? 'bg-[#2563eb] text-white' : 'bg-gray-100 text-gray-500'}`}>맞춤형</button>
                <button onClick={() => setQuoteMode('general')} className={`flex-1 rounded-lg py-2 text-sm font-medium transition-colors ${quoteMode === 'general' ? 'bg-[#2563eb] text-white' : 'bg-gray-100 text-gray-500'}`}>범용</button>
              </div>
              {showRecipient && (
                <label className="mb-2.5 flex items-center gap-2 rounded-lg border border-[#e2e8f0] px-3 py-2.5 focus-within:border-[#2563eb]">
                  <Store size={15} className="shrink-0 text-[#94a3b8]" />
                  <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="거래처명 입력" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                </label>
              )}
              <div className="grid grid-cols-2 gap-2">
                <input value={managerName} onChange={(e) => setManagerName(e.target.value)} placeholder="담당자" className="rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]" />
                <input value={managerPhone} onChange={(e) => setManagerPhone(e.target.value)} placeholder="연락처" className="rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]" />
              </div>
              <input value={quoteMemo} onChange={(e) => setQuoteMemo(e.target.value)} placeholder="메모 (예: 초안, 최종확정)" className="mt-2 w-full rounded-lg border border-[#e2e8f0] px-3 py-2.5 text-sm outline-none focus:border-[#2563eb]" />
            </div>

            {/* 매장 분석 (접이식) */}
            <div className="overflow-hidden rounded-2xl border border-[#e8ebf0] bg-white">
              <button onClick={() => setAnalysisOpen((o) => !o)} className="flex w-full items-center justify-between px-4 py-3">
                <span className="flex items-center gap-2 text-sm text-[#475569]">
                  <Sparkles size={16} className="text-[#2563eb]" />AI 매장 분석
                  {analysis && <span className="text-[#2563eb]">· 추천 {analysis.items.length}개</span>}
                </span>
                <ChevronDown size={16} className={`text-[#cbd5e1] transition-transform ${analysisOpen ? '' : '-rotate-90'}`} />
              </button>
              {analysisOpen && (
                <div className="border-t border-[#eef1f5] p-4">
                  <div className="flex gap-2">
                    <label className="flex flex-1 items-center gap-2 rounded-lg border border-[#e2e8f0] px-3 py-2.5 focus-within:border-[#2563eb]">
                      <Search size={15} className="shrink-0 text-[#94a3b8]" />
                      <input value={storeInput} onChange={(e) => setStoreInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && analyzeStore()} placeholder="매장명·키워드" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
                    </label>
                    <button onClick={analyzeStore} disabled={analyzing} className="shrink-0 rounded-lg bg-[#2563eb] px-4 text-sm font-medium text-white disabled:opacity-50">{analyzing ? '분석 중' : '분석'}</button>
                  </div>

                  {analysis && (
                    <>
                      <div className="mt-3 rounded-xl bg-[#f0f4fa] p-3.5">
                        <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#1B3F82]"><Sparkles size={14} />AI 공략 포인트</div>
                        <div className="mb-2 flex flex-wrap gap-1.5">
                          {analysis.tags.map((t) => <span key={t} className="rounded-md bg-[#dde7f5] px-2 py-0.5 text-[11px] text-[#1B3F82]">#{t}</span>)}
                        </div>
                        <p className="text-xs leading-relaxed text-[#5b6675]">{analysis.description}</p>
                      </div>

                      {recipes.length > 0 && (
                        <div className="mt-3 rounded-xl border border-[#f3e3cf] bg-[#fdf6ec] p-3">
                          <div className="mb-1.5 text-xs font-medium text-[#9a6512]">자사 레시피 추천</div>
                          <div className="flex flex-col gap-1.5">
                            {recipes.map((r) => (
                              <div key={r.name} className={`rounded-md border-l-[3px] border-[#e0a04a] bg-white px-3 py-1.5 ${r.pdf_url ? 'cursor-pointer' : ''}`} onClick={() => r.pdf_url && window.open(r.pdf_url, '_blank')}>
                                <div className="text-xs font-medium text-[#0f172a]">{r.name}</div>
                                {r.reason && <div className="mt-0.5 text-[11px] text-[#2563eb]">{r.reason}</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mb-2 mt-3 text-[10px] uppercase tracking-wider text-[#94a3b8]">추천 상품 · 담으면 카탈로그에 추가</div>
                      <div className="flex flex-col gap-2">
                        {analysis.items.map((item, i) => {
                          const matched = productDB.find((p) => p.name === item.name);
                          const imgUrl = item.imageUrl || matched?.imageUrl || '';
                          return (
                            <button key={i} onClick={() => addProduct(matched ?? { name: item.name, spec: item.spec ?? '', price: item.price ?? 0, taxFree: item.taxFree ?? false, imageUrl: item.imageUrl ?? null, maxDc: item.maxDc ?? 0, desc: '', usage: '', expiryDate: item.expiryDate ?? '' })}
                              className="flex items-center gap-3 rounded-xl border border-[#eef1f5] p-2.5 text-left hover:bg-[#f5f9ff]">
                              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#eef2f7]">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {imgUrl ? <img src={imgUrl} alt={item.name} className="h-full w-full object-cover" /> : <LayoutGrid size={18} className="text-[#9aa7b6]" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium text-[#0f172a]">{item.name}</div>
                                <div className="truncate text-[11px] text-[#94a3b8]">{item.spec}</div>
                              </div>
                              <Plus size={16} className="shrink-0 text-[#1B3F82]" />
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* 품목 단가 · 마진 */}
            <div className="rounded-2xl border border-[#e8ebf0] bg-white p-4">
              <div className="mb-3 text-[10px] uppercase tracking-wider text-[#94a3b8]">품목 단가 · 마진</div>
              <div className="flex flex-col gap-2">
                {items.map((it, idx) => {
                  const margin = rowMargin(it);
                  const mColor = margin >= 20 ? '#0f8a5f' : margin >= 10 ? '#d97706' : '#dc2626';
                  return (
                    <div key={it.id} className="rounded-xl border border-[#eef1f5] p-3">
                      <div className="mb-2 flex items-center gap-1.5">
                        <span className="w-3 shrink-0 text-center text-[11px] text-[#cbd5e1]">{idx + 1}</span>
                        <input value={it.name} onChange={(e) => updateItem(it.id, { name: e.target.value })} list="proposal-products" placeholder="품명" className="h-7 min-w-0 flex-1 rounded-md border border-[#e2e8f0] px-2 text-[13px] outline-none focus:border-[#2563eb]" />
                        <input value={it.spec} onChange={(e) => updateItem(it.id, { spec: e.target.value })} placeholder="내입수" className="h-7 w-16 shrink-0 rounded-md border border-[#e2e8f0] px-1.5 text-xs outline-none focus:border-[#2563eb]" />
                        <button onClick={() => removeItem(it.id)} className="shrink-0 text-[#cbd5e1] hover:text-red-500"><X size={15} /></button>
                      </div>
                      <div className="flex items-end gap-2">
                        <label className="flex-1">
                          <div className="mb-1 text-[9px] text-[#94a3b8]">출고가</div>
                          <input type="number" value={it.factoryPrice} onChange={(e) => updateItem(it.id, { factoryPrice: parseFloat(e.target.value) || 0 })} className="h-7 w-full rounded-md border border-[#e2e8f0] px-1.5 text-[12px] font-medium tabular-nums outline-none focus:border-[#2563eb]" />
                        </label>
                        <label className="flex-1">
                          <div className="mb-1 text-[9px] text-[#94a3b8]">DC %</div>
                          <input type="number" value={it.dcRate} onChange={(e) => updateItem(it.id, { dcRate: parseFloat(e.target.value) || 0 })} className="h-7 w-full rounded-md border border-[#bcd3f5] bg-[#f5f9ff] px-1.5 text-[12px] font-medium tabular-nums text-[#2563eb] outline-none focus:border-[#2563eb]" />
                        </label>
                        <label className="flex-1">
                          <div className="mb-1 text-[9px] text-[#94a3b8]">판매가</div>
                          <input type="number" value={it.salesPrice} onChange={(e) => updateItem(it.id, { salesPrice: parseFloat(e.target.value) || 0 })} className="h-7 w-full rounded-md border border-[#e2e8f0] px-1.5 text-[12px] font-medium tabular-nums outline-none focus:border-[#2563eb]" />
                        </label>
                        <div className="w-[52px] shrink-0 pb-1 text-right">
                          <div className="mb-1 text-[9px] text-[#94a3b8]">마진</div>
                          <div className="text-[12px] font-medium tabular-nums" style={{ color: mColor }}>{margin.toFixed(1)}%</div>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center justify-between text-[10px] text-[#b6c0cc]">
                        <label className="flex cursor-pointer items-center gap-1">
                          <input type="checkbox" checked={it.taxFree} onChange={(e) => updateItem(it.id, { taxFree: e.target.checked })} className="h-3 w-3" /> 면세
                        </label>
                        <span>공급가 <span className="tabular-nums text-[#94a3b8]">{Math.floor(rowCost(it)).toLocaleString()}원</span></span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 flex gap-2">
                <button onClick={() => addItem()} className="flex-1 rounded-lg border border-dashed border-[#cbd5e1] py-2 text-xs font-medium text-[#64748b] hover:border-[#2563eb] hover:text-[#2563eb]"><Plus size={14} className="-mt-0.5 mr-1 inline" />품목 추가</button>
                <button onClick={() => setPickerOpen(true)} className="flex-1 rounded-lg border border-dashed border-[#93b4ef] bg-[#f5f9ff] py-2 text-xs font-medium text-[#2563eb] hover:bg-[#eaf2ff]"><LayoutGrid size={14} className="-mt-0.5 mr-1 inline" />카탈로그에서 선택</button>
              </div>

              <div className="mt-3 flex items-center justify-between border-t border-[#eef1f5] pt-3 text-[11px] text-[#94a3b8]">
                <span>합계 <span className="font-medium tabular-nums text-[#475569]">{Math.floor(totalSales).toLocaleString()}원</span></span>
                <span>평균 마진 <span className="font-medium tabular-nums" style={{ color: totalMargin >= 15 ? '#0f8a5f' : totalMargin >= 5 ? '#d97706' : '#dc2626' }}>{totalMargin.toFixed(1)}%</span></span>
              </div>
            </div>
          </div>

          {/* ── 우측: 카탈로그 (인쇄 대상) ── */}
          <div>
            <div id="proposal-paper" className="rounded-2xl border border-[#e8ebf0] bg-white p-5 print:rounded-none print:border-0 md:p-7">
              <div className="mb-4 border-b-2 border-[#1B3F82] pb-3.5 text-center">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/assets/images/logo.png" alt="매일유업" className="mx-auto mb-2 h-9 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                <div className="text-lg font-semibold tracking-wide text-[#1B3F82]">매일유업 푸드서비스</div>
                <div className="text-xs font-medium tracking-wide text-[#1B3F82]">Maeil Food Service</div>
                {showRecipient && (
                  <div className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1 border-t border-[#eef1f5] pt-2 text-[11px] text-[#64748b]">
                    <span>수신 <strong className="font-medium text-[#1B3F82]">{customerName || '—'}</strong></span>
                    <span>담당 <strong className="font-medium text-[#1B3F82]">{managerName || '—'}</strong></span>
                    <span>연락처 <strong className="font-medium text-[#1B3F82]">{managerPhone || '—'}</strong></span>
                  </div>
                )}
              </div>

              {items.filter((it) => it.name).length === 0 ? (
                <div className="flex flex-col items-center justify-center gap-2 py-20 text-center text-[#a7b4c4]">
                  <LayoutGrid size={26} />
                  <span className="text-sm">왼쪽에서 품목을 추가하면<br />여기에 카탈로그가 만들어집니다</span>
                </div>
              ) : (
                <div className="flex flex-col gap-2.5">
                  {items.filter((it) => it.name).map((it) => {
                    const img = findProductImage(it.name);
                    return (
                      <div key={it.id} className="flex break-inside-avoid gap-3.5 rounded-xl border border-[#e8ebf0] p-3">
                        <div className="flex h-[68px] w-[68px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-[#f4f6fa]">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          {img ? <img src={img} alt={it.name} className="h-full w-full object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} /> : <LayoutGrid size={26} className="text-[#9aa7b6]" />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="text-[13px] font-medium text-[#0f172a]">{it.name}</span>
                            <span className="shrink-0 text-[13px] font-semibold tabular-nums text-[#1B3F82]">{Math.floor(it.salesPrice).toLocaleString()}원</span>
                          </div>
                          <div className="mt-1 text-[11px] text-[#64748b]">
                            {it.spec}{it.spec && it.expiryDate ? ' · ' : ''}{it.expiryDate && <span className="text-[#1B3F82]">소비기한 {it.expiryDate}</span>}
                          </div>
                          {it.desc && <div className="mt-1 text-[11px] leading-relaxed text-[#94a3b8]">{it.desc}</div>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* 제품 자동완성 datalist */}
      <datalist id="proposal-products">
        {productDB.map((p) => <option key={p.name} value={p.name}>{p.spec}</option>)}
      </datalist>

      {/* ── 카탈로그 피커 모달 ── */}
      {pickerOpen && (
        <div className="fixed inset-0 z-[8999] flex items-center justify-center bg-black/45 p-4" onClick={() => setPickerOpen(false)}>
          <div className="flex h-[76vh] max-h-[720px] w-full max-w-[680px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="text-sm font-semibold text-[#0f172a]">상품 카탈로그</div>
              <button onClick={() => setPickerOpen(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="flex gap-1.5 overflow-x-auto border-b border-gray-200 px-4 py-2.5">
              {PICKER_CATS.map(([cat, label]) => (
                <button key={cat} onClick={() => setPickerCat(cat)} className={`flex-shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-semibold transition ${pickerCat === cat ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-200 bg-white text-gray-500'}`}>{label}</button>
              ))}
            </div>
            <div className="grid flex-1 grid-cols-2 content-start gap-2.5 overflow-y-auto bg-white p-4 sm:grid-cols-3">
              {pickerProducts.length === 0 ? (
                <div className="col-span-full py-8 text-center text-sm text-gray-400">제품 목록 로딩 중...</div>
              ) : pickerProducts.map((p) => {
                const img = findProductImage(p.name);
                return (
                  <div key={p.name} onClick={() => { addProduct(p); toast.success(`${p.name} 추가됨`); }}
                    className="flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-transparent bg-white p-2.5 shadow-sm hover:border-blue-500 hover:bg-blue-50/50">
                    <div className="flex h-[90px] w-full items-center justify-center overflow-hidden rounded-lg bg-white">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={p.name} loading="lazy" className="h-full w-full object-contain" />
                      ) : <LayoutGrid size={22} className="text-[#9aa7b6]" />}
                    </div>
                    <div className="line-clamp-2 text-center text-[11px] font-medium text-[#0f172a]">{p.name}</div>
                    {p.spec && <div className="text-center text-[10px] text-gray-400">{p.spec}</div>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── 견적 불러오기 모달 ── */}
      {quotePickerOpen && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 p-4" onClick={() => setQuotePickerOpen(false)}>
          <div className="flex max-h-[80vh] w-full max-w-[480px] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3.5">
              <span className="text-sm font-semibold text-[#0f172a]">저장된 견적 불러오기</span>
              <button onClick={() => setQuotePickerOpen(false)} className="rounded-full p-1 text-gray-400 hover:bg-gray-100"><X size={18} /></button>
            </div>
            <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
              {savedQuotes.length === 0 ? (
                <div className="py-5 text-center text-xs text-gray-400">저장된 견적이 없습니다</div>
              ) : savedQuotes.map((q) => (
                <div key={q.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold">
                      {q.customer_name || '(고객명 없음)'}
                      {q.memo && <span className="ml-1 rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">{q.memo}</span>}
                    </div>
                    <div className="text-[11px] text-gray-500">{q.created_by} · {new Date(q.updated_at || q.created_at).toLocaleDateString('ko-KR')} · {Number(q.total_amount).toLocaleString()}원</div>
                  </div>
                  <button onClick={() => loadQuote(q.id)} className="flex-shrink-0 rounded-md bg-[#2563eb] px-2.5 py-1 text-xs text-white hover:bg-[#1d4fd0]">불러오기</button>
                  <button onClick={() => deleteQuote(q.id)} className="flex-shrink-0 rounded-md border border-red-300 p-1.5 text-red-500 hover:bg-red-50" aria-label="삭제"><Trash2 size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
