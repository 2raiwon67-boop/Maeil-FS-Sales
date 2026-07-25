'use client';

// 개척 모드 — 인허가·주요거래처 밖에서 영업사원이 직접 발굴하는 거래처 활동 관리.
// 홈(거래처) 우상단 "개척 모드" 스위치로 켜면 전체 화면을 차지하는 독립 오버레이 (기존 지도 로직 무접촉).
//
// 구조: "개척 활동"(제목+기간)을 만들고 그 안에 타겟을 등록한다.
//  - 종료일이 지난 활동은 자동으로 '종료(이력)' — 드롭다운에서 골라 과거 활동을 돌아본다.
//  - 타겟 등록: 단건 폼(거래처명/주소/담당자) 또는 엑셀 일괄 업로드(컬럼 자동 인식).
//  - 단계: 타겟 → 방문 → 샘플·견적 → 최종타겟 → F/U대상  ·  개척가능성: 상/중/하/개척완료

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, MapPin, Trash2, X, ChartBar, ListFilter, CalendarRange, FileSpreadsheet, ChevronDown, Search } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  loadNaverMaps,
  cachedGeocodeDetailed,
  cleanGeocodeQuery,
  type NaverMap,
  type NaverMarker,
} from '@/lib/naver/loader';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/dashboard/constants';

export interface Campaign {
  id: string;
  title: string;
  start_date: string;
  end_date: string;
}

export interface Prospect {
  id: string;
  campaign_id: string | null;
  name: string;
  address: string;
  manager_name: string;
  stage: string;
  potential: string;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export const STAGES = ['타겟', '방문', '샘플·견적', '최종타겟', 'F/U대상'] as const;
export const POTENTIALS = ['상', '중', '하', '개척완료'] as const;

// 마커·차트 공용 색 — 개척가능성이 한눈에 읽히는 게 핵심이라 가능성 기준 채색
const POTENTIAL_COLOR: Record<string, string> = {
  상: '#16a34a',
  중: '#f59e0b',
  하: '#94a3b8',
  개척완료: '#2563eb',
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function campaignStatus(c: Campaign): '진행중' | '예정' | '종료' {
  const t = todayStr();
  if (t < c.start_date) return '예정';
  if (t > c.end_date) return '종료';
  return '진행중';
}

function fmtPeriod(c: Campaign): string {
  const f = (s: string) => s.slice(2).replace(/-/g, '.');
  return `${f(c.start_date)}~${f(c.end_date)}`;
}

function markerHtml(color: string, done: boolean): string {
  return `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);${done ? 'outline:2px solid ' + color + '55;outline-offset:2px;' : ''}"></div>`;
}

// 엑셀 헤더 자동 인식 — 컬럼명에 아래 키워드가 포함되면 해당 필드로 매핑
const XLS_KEYS = {
  name: ['거래처', '매장', '상호', '업소', '업체'],
  address: ['주소', '소재지'],
  manager: ['담당'],
};

export function ProspectMode({ businessUnit, myManagerName, initialView }: {
  businessUnit: string | null;
  myManagerName: string | null;
  /** 홈 지도에서 보던 시점 — 개척 지도가 그대로 이어받는다 (null이면 기본값) */
  initialView?: { lat: number; lng: number; zoom: number } | null;
}) {
  const supabase = createClient();

  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [campaignId, setCampaignId] = useState<string | null>(null);
  const [campOpen, setCampOpen] = useState(false);       // 활동 선택 드롭다운
  const [campFormOpen, setCampFormOpen] = useState(false); // 활동 만들기 모달
  const [rows, setRows] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [managerFilter, setManagerFilter] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  // 활동 만들기 폼
  const [cTitle, setCTitle] = useState('');
  const [cStart, setCStart] = useState(todayStr());
  const [cEnd, setCEnd] = useState('');
  const [cSaving, setCSaving] = useState(false);

  // 타겟 등록 (단건/엑셀)
  const [formOpen, setFormOpen] = useState(false);
  const [formTab, setFormTab] = useState<'one' | 'excel'>('one');
  const [fName, setFName] = useState('');
  const [fAddr, setFAddr] = useState('');
  const [fManager, setFManager] = useState('');
  const [saving, setSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | null>(null);
  const markersRef = useRef<NaverMarker[]>([]);
  const [sdkReady, setSdkReady] = useState(false);

  // ── 데이터 로드 ──
  useEffect(() => {
    (async () => {
      const [{ data: camps, error: e1 }, { data: pros, error: e2 }] = await Promise.all([
        supabase.from('prospect_campaigns').select('id,title,start_date,end_date').order('start_date', { ascending: false }),
        supabase.from('prospects').select('id,campaign_id,name,address,manager_name,stage,potential,lat,lng,created_at').order('created_at', { ascending: false }),
      ]);
      if (e1 || e2) toast.error('개척 데이터 로드 실패: ' + (e1 || e2)!.message);
      const cs = (camps as Campaign[]) || [];
      setCampaigns(cs);
      setRows((pros as Prospect[]) || []);
      // 기본 선택: 진행중 활동 우선, 없으면 최신
      const active = cs.find((c) => campaignStatus(c) === '진행중') || cs[0];
      setCampaignId(active?.id ?? null);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 지도 초기화 (기존 홈 지도와 별개 인스턴스 — 오버레이 전용) ──
  useEffect(() => {
    let cancelled = false;
    loadNaverMaps()
      .then(() => {
        if (cancelled || !mapElRef.current) return;
        const naver = window.naver;
        mapRef.current = new naver.maps.Map(mapElRef.current, {
          center: new naver.maps.LatLng(initialView?.lat ?? DEFAULT_CENTER.lat, initialView?.lng ?? DEFAULT_CENTER.lng),
          zoom: initialView?.zoom ?? DEFAULT_ZOOM,
        });
        setSdkReady(true);
      })
      .catch(() => toast.error('지도 로드에 실패했습니다.'));
    return () => { cancelled = true; };
  }, []);

  const campaign = useMemo(() => campaigns.find((c) => c.id === campaignId) ?? null, [campaigns, campaignId]);

  // ── 선택 활동의 타겟 목록 (+담당 필터) ──
  const inCampaign = useMemo(
    () => rows.filter((r) => r.campaign_id === campaignId),
    [rows, campaignId],
  );
  const filtered = useMemo(() => {
    let list = managerFilter ? inCampaign.filter((r) => r.manager_name === managerFilter) : inCampaign;
    const q = query.trim().normalize('NFC');
    if (q) list = list.filter((r) => r.name.includes(q) || r.address.includes(q) || r.manager_name.includes(q));
    return list;
  }, [inCampaign, managerFilter, query]);
  const managerNames = useMemo(
    () => [...new Set(inCampaign.map((r) => r.manager_name))].sort(),
    [inCampaign],
  );

  // ── 마커 동기화 ──
  useEffect(() => {
    if (!sdkReady || !mapRef.current) return;
    const naver = window.naver;
    const map = mapRef.current;
    // 시점은 사용자가 보던 그대로 유지 — 자동 fitBounds로 화면을 옮기지 않는다 (행 탭 시에만 panTo)
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = filtered
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => {
        const pos = new naver.maps.LatLng(r.lat!, r.lng!);
        const marker = new naver.maps.Marker({
          position: pos,
          map,
          icon: {
            content: markerHtml(POTENTIAL_COLOR[r.potential] ?? '#94a3b8', r.potential === '개척완료'),
            anchor: new naver.maps.Point(9, 9),
          },
        });
        marker._id = r.id;
        naver.maps.Event.addListener(marker, 'click', () => {
          setSelectedId(r.id);
          setTab('list');
        });
        return marker;
      });
  }, [filtered, sdkReady]);

  const focusRow = useCallback((r: Prospect) => {
    setSelectedId(r.id);
    if (r.lat != null && r.lng != null && mapRef.current) {
      const naver = window.naver;
      mapRef.current.panTo(new naver.maps.LatLng(r.lat, r.lng));
    }
  }, []);

  // ── 활동 만들기 ──
  const saveCampaign = async () => {
    const title = cTitle.trim();
    if (!title || !cStart || !cEnd) { toast.warning('활동명과 기간을 입력해주세요.'); return; }
    if (cEnd < cStart) { toast.warning('종료일이 시작일보다 빠릅니다.'); return; }
    if (!businessUnit) { toast.error('소속 정보가 없습니다.'); return; }
    setCSaving(true);
    try {
      const { data, error } = await supabase
        .from('prospect_campaigns')
        .insert({ business_unit: businessUnit, title, start_date: cStart, end_date: cEnd })
        .select('id,title,start_date,end_date')
        .single();
      if (error) throw error;
      const c = data as Campaign;
      setCampaigns((prev) => [c, ...prev].sort((a, b) => b.start_date.localeCompare(a.start_date)));
      setCampaignId(c.id);
      setCampFormOpen(false);
      setCTitle(''); setCEnd('');
      toast.success(`"${title}" 활동을 시작합니다 (${fmtPeriod(c)})`);
    } catch (e) {
      toast.error('활동 생성 실패: ' + (e as Error).message);
    } finally {
      setCSaving(false);
    }
  };

  // ── 타겟 등록 (단건) ──
  const openForm = () => {
    if (!campaign) { toast.warning('먼저 개척 활동(기간)을 만들어주세요.'); setCampFormOpen(true); return; }
    setFManager((prev) => prev || myManagerName || '');
    setFormTab('one');
    setFormOpen(true);
  };

  const saveProspect = async () => {
    const name = fName.trim(), addr = fAddr.trim(), manager = fManager.trim();
    if (!name || !addr || !manager) { toast.warning('거래처명·주소·담당자를 모두 입력해주세요.'); return; }
    if (!businessUnit || !campaign) return;
    setSaving(true);
    try {
      let lat: number | null = null, lng: number | null = null;
      try {
        const { coords, noMatch } = await cachedGeocodeDetailed(cleanGeocodeQuery(addr));
        if (coords) { lat = coords.lat; lng = coords.lng; }
        else if (noMatch) toast.warning('주소를 지도에서 찾지 못했습니다 — 목록에는 저장됩니다.');
      } catch { /* 지오코딩 실패해도 저장은 진행 */ }
      const { data, error } = await supabase
        .from('prospects')
        .insert({ business_unit: businessUnit, campaign_id: campaign.id, name, address: addr, manager_name: manager, lat, lng })
        .select('id,campaign_id,name,address,manager_name,stage,potential,lat,lng,created_at')
        .single();
      if (error) throw error;
      setRows((prev) => [data as Prospect, ...prev]);
      setFName(''); setFAddr(''); setFormOpen(false);
      toast.success(`"${name}" 타겟으로 등록했습니다`);
    } catch (e) {
      toast.error('등록 실패: ' + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  // ── 타겟 등록 (엑셀 일괄) ──
  const handleExcel = async (file: File) => {
    if (!businessUnit || !campaign) return;
    setBulkProgress('파일 읽는 중…');
    try {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(await file.arrayBuffer());
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
      // 헤더 행 탐색(상위 5행) — 거래처/주소 키워드가 함께 있는 행
      let headIdx = -1;
      const colOf: { name: number; address: number; manager: number } = { name: -1, address: -1, manager: -1 };
      for (let i = 0; i < Math.min(5, grid.length); i++) {
        const cells = grid[i].map((c) => String(c));
        const found = { name: -1, address: -1, manager: -1 };
        cells.forEach((c, j) => {
          if (found.name < 0 && XLS_KEYS.name.some((k) => c.includes(k))) found.name = j;
          if (found.address < 0 && XLS_KEYS.address.some((k) => c.includes(k))) found.address = j;
          if (found.manager < 0 && XLS_KEYS.manager.some((k) => c.includes(k))) found.manager = j;
        });
        if (found.name >= 0 && found.address >= 0) { headIdx = i; Object.assign(colOf, found); break; }
      }
      if (headIdx < 0) {
        toast.error('헤더를 찾지 못했습니다 — 거래처명·주소(·담당자) 컬럼이 있는 엑셀인지 확인해주세요.');
        setBulkProgress(null);
        return;
      }
      const items = grid.slice(headIdx + 1)
        .map((r) => ({
          name: String(r[colOf.name] ?? '').trim(),
          address: String(r[colOf.address] ?? '').trim(),
          manager_name: (colOf.manager >= 0 ? String(r[colOf.manager] ?? '').trim() : '') || myManagerName || '미지정',
        }))
        .filter((x) => x.name && x.address);
      if (!items.length) { toast.warning('등록할 행이 없습니다.'); setBulkProgress(null); return; }

      // 지오코딩(주소 중복은 1회만) → 일괄 insert
      const coordByAddr = new Map<string, { lat: number; lng: number } | null>();
      const payload = [];
      for (let i = 0; i < items.length; i++) {
        setBulkProgress(`주소 확인 중… (${i + 1}/${items.length})`);
        const q = cleanGeocodeQuery(items[i].address);
        if (!coordByAddr.has(q)) {
          try { coordByAddr.set(q, (await cachedGeocodeDetailed(q)).coords); }
          catch { coordByAddr.set(q, null); }
        }
        const c = coordByAddr.get(q) ?? null;
        payload.push({
          business_unit: businessUnit, campaign_id: campaign.id,
          ...items[i], lat: c?.lat ?? null, lng: c?.lng ?? null,
        });
      }
      setBulkProgress('저장 중…');
      const inserted: Prospect[] = [];
      for (let i = 0; i < payload.length; i += 100) {
        const { data, error } = await supabase.from('prospects').insert(payload.slice(i, i + 100))
          .select('id,campaign_id,name,address,manager_name,stage,potential,lat,lng,created_at');
        if (error) throw error;
        inserted.push(...(data as Prospect[]));
      }
      setRows((prev) => [...inserted, ...prev]);
      const noGeo = inserted.filter((r) => r.lat == null).length;
      toast.success(`${inserted.length}건 타겟 등록 완료${noGeo ? ` (지도 미표시 ${noGeo}건)` : ''}`);
      setFormOpen(false);
    } catch (e) {
      toast.error('엑셀 등록 실패: ' + (e as Error).message);
    } finally {
      setBulkProgress(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ── 단계·가능성 변경 / 삭제 ──
  const patchRow = async (id: string, patch: Partial<Pick<Prospect, 'stage' | 'potential'>>) => {
    const prev = rows;
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    const { error } = await supabase.from('prospects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) { setRows(prev); toast.error('변경 실패: ' + error.message); }
  };

  const deleteRow = async (id: string) => {
    const { error } = await supabase.from('prospects').delete().eq('id', id);
    if (error) { toast.error('삭제 실패: ' + error.message); return; }
    setRows((rs) => rs.filter((r) => r.id !== id));
    setConfirmDelId(null);
    toast('타겟을 삭제했습니다');
  };

  // ── 통계 (선택 활동 + 담당 필터 기준) ──
  const stats = useMemo(() => {
    const byManager = new Map<string, { total: number; done: number }>();
    const byStage = new Map<string, number>();
    const byPotential = new Map<string, number>();
    for (const r of filtered) {
      const m = byManager.get(r.manager_name) || { total: 0, done: 0 };
      m.total++; if (r.potential === '개척완료') m.done++;
      byManager.set(r.manager_name, m);
      byStage.set(r.stage, (byStage.get(r.stage) || 0) + 1);
      byPotential.set(r.potential, (byPotential.get(r.potential) || 0) + 1);
    }
    return {
      byManager: [...byManager.entries()].sort((a, b) => b[1].total - a[1].total),
      byStage: STAGES.map((s) => [s, byStage.get(s) || 0] as const),
      byPotential: POTENTIALS.map((p) => [p, byPotential.get(p) || 0] as const),
      max: Math.max(1, ...[...byManager.values()].map((v) => v.total)),
      stageMax: Math.max(1, ...STAGES.map((s) => byStage.get(s) || 0)),
    };
  }, [filtered]);

  // ── 렌더 ──
  const chip = (active: boolean) =>
    `shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${active ? 'bg-[#0f172a] text-white' : 'bg-[#f1f5f9] text-[#475569]'}`;
  const statusBadge = (s: '진행중' | '예정' | '종료') =>
    s === '진행중' ? 'bg-[#dcfce7] text-[#15803d]' : s === '예정' ? 'bg-[#e0e7ff] text-[#4338ca]' : 'bg-[#f1f5f9] text-[#64748b]';

  return (
    <div className="flex h-full w-full flex-col bg-[#f6f7f9] md:flex-row">
      {/* ── 패널 ── */}
      <div className="order-2 flex min-h-0 flex-1 flex-col md:order-1 md:w-[300px] md:flex-none md:border-r md:border-[#e8ebf0]">

        {/* 컨트롤 묶음 — 흰 블록 하나로 (요소가 흩어져 보이지 않게) */}
        <div className="border-b border-[#e8ebf0] bg-white pb-2 shadow-sm">

        {/* 활동 선택 줄 */}
        <div className="flex items-center gap-1.5 px-2.5 pb-1 pt-2">
          <div className="relative min-w-0 flex-1">
            <button
              onClick={() => setCampOpen((o) => !o)}
              className="flex w-full items-center gap-1.5 rounded-lg bg-[#f8fafc] px-2.5 py-1.5 text-left ring-1 ring-black/5"
            >
              <CalendarRange size={13} className="shrink-0 text-[#2563eb]" />
              {campaign ? (
                <>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[#0f172a]">{campaign.title}</span>
                  <span className={`shrink-0 rounded px-1 py-0.5 text-[9.5px] font-semibold ${statusBadge(campaignStatus(campaign))}`}>
                    {campaignStatus(campaign)}
                  </span>
                  <span className="shrink-0 text-[10px] text-[#94a3b8]">{fmtPeriod(campaign)}</span>
                </>
              ) : (
                <span className="flex-1 text-[12px] text-[#94a3b8]">활동 선택</span>
              )}
              <ChevronDown size={12} className="shrink-0 text-[#94a3b8]" />
            </button>
            {campOpen && (
              <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 max-h-64 overflow-y-auto rounded-lg bg-white py-1 shadow-lg ring-1 ring-black/5">
                {campaigns.length === 0 && (
                  <div className="px-2.5 py-2 text-[11.5px] text-[#94a3b8]">아직 활동이 없습니다</div>
                )}
                {campaigns.map((c) => {
                  const s = campaignStatus(c);
                  const cnt = rows.filter((r) => r.campaign_id === c.id).length;
                  return (
                    <button
                      key={c.id}
                      onClick={() => { setCampaignId(c.id); setCampOpen(false); setManagerFilter(null); setQuery(''); }}
                      className={`flex w-full items-center gap-1.5 px-2.5 py-1.5 text-left hover:bg-[#f8fafc] ${c.id === campaignId ? 'bg-[#eff6ff]' : ''}`}
                    >
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-[#0f172a]">{c.title}</span>
                      <span className={`shrink-0 rounded px-1 py-0.5 text-[9.5px] font-semibold ${statusBadge(s)}`}>{s === '종료' ? '이력' : s}</span>
                      <span className="shrink-0 text-[10px] text-[#94a3b8]">{fmtPeriod(c)} · {cnt}건</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <button
            onClick={() => { setCampFormOpen(true); setCampOpen(false); }}
            className="flex h-[30px] shrink-0 items-center gap-0.5 rounded-lg bg-[#f1f5f9] px-2 text-[11px] font-semibold text-[#2563eb]"
            title="새 개척 활동(기간) 만들기"
          >
            <Plus size={12} />활동
          </button>
        </div>

        {/* 검색 줄 */}
        <label className="mx-2.5 mb-1 flex items-center gap-1.5 rounded-lg bg-[#f1f5f9] px-2 py-1.5">
          <Search size={12} className="shrink-0 text-[#94a3b8]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="거래처 검색"
            className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#b6c0cc]"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-[#cbd5e1]" aria-label="검색어 지우기">
              <X size={12} />
            </button>
          )}
        </label>

        {/* 담당 필터 줄 */}
        <div className="flex items-center gap-1 overflow-x-auto px-2.5 pb-1.5 pt-1 [scrollbar-width:none]">
          <button onClick={() => setManagerFilter(null)} className={chip(!managerFilter)}>담당 전체</button>
          {managerNames.map((m) => (
            <button key={m} onClick={() => setManagerFilter(managerFilter === m ? null : m)} className={chip(managerFilter === m)}>{m}</button>
          ))}
        </div>

        {/* 목록/통계 탭 + 타겟 등록 */}
        <div className="flex items-center gap-1.5 px-2.5">
          <div className="flex gap-0.5 rounded-lg bg-[#f1f5f9] p-0.5">
            <button onClick={() => setTab('list')} className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${tab === 'list' ? 'bg-[#2563eb] text-white' : 'text-[#64748b]'}`}>
              <ListFilter size={11} />목록 {filtered.length}
            </button>
            <button onClick={() => setTab('stats')} className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${tab === 'stats' ? 'bg-[#2563eb] text-white' : 'text-[#64748b]'}`}>
              <ChartBar size={11} />통계
            </button>
          </div>
          <button
            onClick={openForm}
            className="ml-auto flex items-center gap-0.5 rounded-lg bg-[#2563eb] px-2 py-1 text-[11px] font-semibold text-white"
          >
            <Plus size={12} />타겟 등록
          </button>
        </div>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2.5">
          {loading ? (
            <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
          ) : !campaign ? (
            <div className="py-16 text-center text-sm text-[#94a3b8]">개척 활동이 없습니다</div>
          ) : tab === 'list' ? (
            filtered.length === 0 ? (
              <div className="py-16 text-center text-sm text-[#94a3b8]">등록된 타겟이 없습니다</div>
            ) : (
              <div className="flex flex-col gap-1">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-lg bg-white p-2 ring-1 transition-shadow ${selectedId === r.id ? 'ring-[#2563eb]' : 'ring-black/5'}`}
                    onClick={() => focusRow(r)}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: POTENTIAL_COLOR[r.potential] }} />
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-[#0f172a]">{r.name}</span>
                      <span className="shrink-0 text-[10px] text-[#94a3b8]">
                        {r.manager_name} · {new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 pl-[14px] text-[11px] text-[#64748b]">
                      <MapPin size={10} className="shrink-0 text-[#cbd5e1]" />
                      <span className="truncate">{r.address}</span>
                      {r.lat == null && <span className="shrink-0 rounded bg-[#fef3c7] px-1 text-[9.5px] text-[#92400e]">지도 미표시</span>}
                    </div>
                    <div className="mt-1 flex items-center gap-1 pl-[14px]" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={r.stage}
                        onChange={(e) => patchRow(r.id, { stage: e.target.value })}
                        className="rounded border border-[#e2e8f0] bg-[#f8fafc] px-1 py-0.5 text-[11px] font-medium text-[#334155]"
                        aria-label="진행 단계"
                      >
                        {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select
                        value={r.potential}
                        onChange={(e) => patchRow(r.id, { potential: e.target.value })}
                        className="rounded border border-[#e2e8f0] bg-[#f8fafc] px-1 py-0.5 text-[11px] font-medium"
                        style={{ color: POTENTIAL_COLOR[r.potential] }}
                        aria-label="개척 가능성"
                      >
                        {POTENTIALS.map((p) => <option key={p} value={p}>{p === '개척완료' ? '개척완료' : `가능성 ${p}`}</option>)}
                      </select>
                      {confirmDelId === r.id ? (
                        <span className="ml-auto flex items-center gap-1">
                          <button onClick={() => deleteRow(r.id)} className="rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">삭제</button>
                          <button onClick={() => setConfirmDelId(null)} className="rounded bg-[#f1f5f9] px-1.5 py-0.5 text-[10px] text-[#64748b]">취소</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelId(r.id)}
                          className="ml-auto flex h-6 w-6 items-center justify-center rounded text-[#cbd5e1] hover:bg-red-50 hover:text-red-500"
                          aria-label={`${r.name} 삭제`}
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* ── 통계 ── */
            <div className="flex flex-col gap-2.5 pt-1">
              <section className="rounded-lg bg-white p-2.5 ring-1 ring-black/5">
                <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#94a3b8]">담당자별 개척 ({campaign.title})</h3>
                {stats.byManager.length === 0 ? (
                  <p className="text-xs text-[#94a3b8]">데이터 없음</p>
                ) : stats.byManager.map(([m, v]) => (
                  <div key={m} className="mb-1.5 last:mb-0">
                    <div className="mb-0.5 flex justify-between text-[11.5px]">
                      <span className="font-medium text-[#334155]">{m}</span>
                      <span className="text-[#64748b]">{v.total}건{v.done > 0 && <span className="text-[#2563eb]"> · 완료 {v.done}</span>}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f5f9]">
                      <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${(v.total / stats.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </section>

              <section className="rounded-lg bg-white p-2.5 ring-1 ring-black/5">
                <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#94a3b8]">단계 퍼널</h3>
                {stats.byStage.map(([s, n]) => (
                  <div key={s} className="mb-1.5 last:mb-0">
                    <div className="mb-0.5 flex justify-between text-[11.5px]">
                      <span className="font-medium text-[#334155]">{s}</span>
                      <span className="text-[#64748b]">{n}건</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-[#f1f5f9]">
                      <div className="h-full rounded-full bg-[#1B3F82]" style={{ width: `${(n / stats.stageMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </section>

              <section className="rounded-lg bg-white p-2.5 ring-1 ring-black/5">
                <h3 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wide text-[#94a3b8]">개척 가능성 분포</h3>
                <div className="flex gap-2">
                  {stats.byPotential.map(([p, n]) => (
                    <div key={p} className="flex-1 rounded-lg bg-[#f8fafc] py-1.5 text-center">
                      <div className="text-[14px] font-bold" style={{ color: POTENTIAL_COLOR[p] }}>{n}</div>
                      <div className="mt-0.5 text-[10px] text-[#64748b]">{p}</div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </div>

      {/* ── 지도 ── */}
      <div className="relative order-1 h-[38dvh] shrink-0 md:order-2 md:h-auto md:flex-1">
        <div ref={mapElRef} className="h-full w-full" />
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-[#475569] shadow ring-1 ring-black/5">
          {POTENTIALS.map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: POTENTIAL_COLOR[p] }} />{p}
            </span>
          ))}
        </div>
      </div>

      {/* ── 활동 만들기 모달 ── */}
      {campFormOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 md:items-center" onClick={() => setCampFormOpen(false)}>
          <div
            className="w-full max-w-[440px] rounded-t-[24px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 md:rounded-[24px] md:pb-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-[#0f172a]">개척 활동 만들기</h2>
              <button onClick={() => setCampFormOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-[#94a3b8] hover:bg-gray-100" aria-label="닫기">
                <X size={17} />
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <input
                value={cTitle} onChange={(e) => setCTitle(e.target.value)}
                placeholder="활동명"
                className="rounded-xl border border-[#e2e8f0] px-3.5 py-3 text-[14.5px] outline-none focus:border-[#2563eb]"
              />
              <div className="flex items-center gap-2">
                <input
                  type="date" value={cStart} onChange={(e) => setCStart(e.target.value)}
                  className="flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-[14px] outline-none focus:border-[#2563eb]"
                  aria-label="시작일"
                />
                <span className="text-[#94a3b8]">~</span>
                <input
                  type="date" value={cEnd} onChange={(e) => setCEnd(e.target.value)} min={cStart}
                  className="flex-1 rounded-xl border border-[#e2e8f0] px-3 py-2.5 text-[14px] outline-none focus:border-[#2563eb]"
                  aria-label="종료일"
                />
              </div>
              <button
                onClick={saveCampaign}
                disabled={cSaving}
                className="mt-1 rounded-xl bg-[#2563eb] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
              >
                {cSaving ? '만드는 중…' : '활동 시작'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 타겟 등록 모달 (단건/엑셀) ── */}
      {formOpen && campaign && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 md:items-center" onClick={() => !bulkProgress && setFormOpen(false)}>
          <div
            className="w-full max-w-[460px] rounded-t-[24px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 md:rounded-[24px] md:pb-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-[#0f172a]">타겟 등록</h2>
              <button onClick={() => !bulkProgress && setFormOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-[#94a3b8] hover:bg-gray-100" aria-label="닫기">
                <X size={17} />
              </button>
            </div>
            <p className="mb-3 text-[12px] text-[#94a3b8]">활동: {campaign.title} ({fmtPeriod(campaign)})</p>

            <div className="mb-3 flex gap-1 rounded-lg bg-[#f1f5f9] p-0.5">
              <button onClick={() => setFormTab('one')} className={`flex-1 rounded-md py-1.5 text-[13px] font-medium ${formTab === 'one' ? 'bg-white text-[#0f172a] shadow-sm' : 'text-[#64748b]'}`}>직접 입력</button>
              <button onClick={() => setFormTab('excel')} className={`flex-1 rounded-md py-1.5 text-[13px] font-medium ${formTab === 'excel' ? 'bg-white text-[#0f172a] shadow-sm' : 'text-[#64748b]'}`}>엑셀 업로드</button>
            </div>

            {formTab === 'one' ? (
              <div className="flex flex-col gap-2.5">
                <input
                  value={fName} onChange={(e) => setFName(e.target.value)}
                  placeholder="거래처(매장)명"
                  className="rounded-xl border border-[#e2e8f0] px-3.5 py-3 text-[14.5px] outline-none focus:border-[#2563eb]"
                />
                <input
                  value={fAddr} onChange={(e) => setFAddr(e.target.value)}
                  placeholder="주소"
                  className="rounded-xl border border-[#e2e8f0] px-3.5 py-3 text-[14.5px] outline-none focus:border-[#2563eb]"
                />
                <input
                  value={fManager} onChange={(e) => setFManager(e.target.value)}
                  placeholder="담당자"
                  className="rounded-xl border border-[#e2e8f0] px-3.5 py-3 text-[14.5px] outline-none focus:border-[#2563eb]"
                />
                <button
                  onClick={saveProspect}
                  disabled={saving}
                  className="mt-1 rounded-xl bg-[#2563eb] py-3.5 text-[15px] font-semibold text-white disabled:opacity-60"
                >
                  {saving ? '등록 중…' : '등록'}
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleExcel(f); }}
                />
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={!!bulkProgress}
                  className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-[#cbd5e1] py-6 text-[14px] font-medium text-[#475569] hover:border-[#2563eb] hover:text-[#2563eb] disabled:opacity-60"
                >
                  <FileSpreadsheet size={18} />
                  {bulkProgress ?? '엑셀 파일 선택'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
