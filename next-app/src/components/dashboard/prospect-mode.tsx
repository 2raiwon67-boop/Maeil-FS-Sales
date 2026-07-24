'use client';

// 개척 모드 — 인허가·주요거래처 밖에서 영업사원이 직접 발굴하는 거래처 활동 관리.
// 홈(거래처)의 '개척' 뷰로 전환되면 전체 화면을 차지하는 독립 오버레이 (기존 지도 로직 무접촉).
// 입력은 미니멀(거래처명/주소/담당자) — 주소는 저장 시 지오코딩해 지도에 즉시 마커.
// 단계: 타겟 → 방문 → 샘플·견적 → 최종타겟 → F/U대상  ·  개척가능성: 상/중/하/개척완료

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus, MapPin, Trash2, X, ChartBar, ListFilter } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import {
  loadNaverMaps,
  cachedGeocodeDetailed,
  cleanGeocodeQuery,
  type NaverMap,
  type NaverMarker,
} from '@/lib/naver/loader';
import { DEFAULT_CENTER, DEFAULT_ZOOM } from '@/lib/dashboard/constants';

export interface Prospect {
  id: string;
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

const PERIODS = [
  { key: '1m', label: '1개월', months: 1 },
  { key: '3m', label: '3개월', months: 3 },
  { key: '6m', label: '6개월', months: 6 },
  { key: 'all', label: '전체', months: null },
] as const;

function markerHtml(color: string, done: boolean): string {
  return `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.35);${done ? 'outline:2px solid ' + color + '55;outline-offset:2px;' : ''}"></div>`;
}

export function ProspectMode({ businessUnit, myManagerName }: { businessUnit: string | null; myManagerName: string | null }) {
  const supabase = createClient();

  const [rows, setRows] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'stats'>('list');
  const [period, setPeriod] = useState<(typeof PERIODS)[number]['key']>('3m');
  const [managerFilter, setManagerFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelId, setConfirmDelId] = useState<string | null>(null);

  // 등록 폼
  const [formOpen, setFormOpen] = useState(false);
  const [fName, setFName] = useState('');
  const [fAddr, setFAddr] = useState('');
  const [fManager, setFManager] = useState('');
  const [saving, setSaving] = useState(false);

  const mapElRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<NaverMap | null>(null);
  const markersRef = useRef<NaverMarker[]>([]);
  const [sdkReady, setSdkReady] = useState(false);

  // ── 데이터 로드 ──
  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('prospects')
        .select('id,name,address,manager_name,stage,potential,lat,lng,created_at')
        .order('created_at', { ascending: false });
      if (error) toast.error('개척 목록 로드 실패: ' + error.message);
      setRows((data as Prospect[]) || []);
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
          center: new naver.maps.LatLng(DEFAULT_CENTER.lat, DEFAULT_CENTER.lng),
          zoom: DEFAULT_ZOOM,
        });
        setSdkReady(true);
      })
      .catch(() => toast.error('지도 로드에 실패했습니다.'));
    return () => { cancelled = true; };
  }, []);

  // ── 필터 적용 목록 ──
  const filtered = useMemo(() => {
    const p = PERIODS.find((x) => x.key === period)!;
    let list = rows;
    if (p.months != null) {
      const cut = new Date();
      cut.setMonth(cut.getMonth() - p.months);
      const cutIso = cut.toISOString();
      list = list.filter((r) => r.created_at >= cutIso);
    }
    if (managerFilter) list = list.filter((r) => r.manager_name === managerFilter);
    return list;
  }, [rows, period, managerFilter]);

  const managerNames = useMemo(
    () => [...new Set(rows.map((r) => r.manager_name))].sort(),
    [rows],
  );

  // ── 마커 동기화 ──
  useEffect(() => {
    if (!sdkReady || !mapRef.current) return;
    const naver = window.naver;
    const map = mapRef.current;
    markersRef.current.forEach((m) => m.setMap(null));
    const bounds = new naver.maps.LatLngBounds();
    let n = 0;
    markersRef.current = filtered
      .filter((r) => r.lat != null && r.lng != null)
      .map((r) => {
        const pos = new naver.maps.LatLng(r.lat!, r.lng!);
        bounds.extend(pos); n++;
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
    if (n > 0) map.fitBounds(bounds);
  }, [filtered, sdkReady]);

  // 리스트에서 선택 시 지도 이동
  const focusRow = useCallback((r: Prospect) => {
    setSelectedId(r.id);
    if (r.lat != null && r.lng != null && mapRef.current) {
      const naver = window.naver;
      mapRef.current.panTo(new naver.maps.LatLng(r.lat, r.lng));
    }
  }, []);

  // ── 등록 ──
  const openForm = () => {
    setFManager((prev) => prev || myManagerName || '');
    setFormOpen(true);
  };

  const saveProspect = async () => {
    const name = fName.trim(), addr = fAddr.trim(), manager = fManager.trim();
    if (!name || !addr || !manager) { toast.warning('거래처명·주소·담당자를 모두 입력해주세요.'); return; }
    if (!businessUnit) { toast.error('소속 정보가 없습니다.'); return; }
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
        .insert({ business_unit: businessUnit, name, address: addr, manager_name: manager, lat, lng })
        .select('id,name,address,manager_name,stage,potential,lat,lng,created_at')
        .single();
      if (error) throw error;
      setRows((prev) => [data as Prospect, ...prev]);
      setFName(''); setFAddr(''); setFormOpen(false);
      toast.success(`"${name}" 개척 거래처로 등록했습니다`);
    } catch (e) {
      toast.error('등록 실패: ' + (e as Error).message);
    } finally {
      setSaving(false);
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
    toast('개척 거래처를 삭제했습니다');
  };

  // ── 통계 (필터 적용분 기준) ──
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
    `shrink-0 rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${active ? 'bg-[#0f172a] text-white' : 'bg-white text-[#475569] ring-1 ring-black/5'}`;

  return (
    <div className="flex h-full w-full flex-col bg-[#f6f7f9] md:flex-row">
      {/* ── 패널 ── */}
      <div className="order-2 flex min-h-0 flex-1 flex-col md:order-1 md:w-[380px] md:flex-none md:border-r md:border-[#e8ebf0]">
        {/* 필터 줄 */}
        <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2 pt-3 [scrollbar-width:none]">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => setPeriod(p.key)} className={chip(period === p.key)}>{p.label}</button>
          ))}
          <span className="mx-0.5 h-4 w-px shrink-0 bg-[#e2e8f0]" />
          <button onClick={() => setManagerFilter(null)} className={chip(!managerFilter)}>담당 전체</button>
          {managerNames.map((m) => (
            <button key={m} onClick={() => setManagerFilter(managerFilter === m ? null : m)} className={chip(managerFilter === m)}>{m}</button>
          ))}
        </div>

        {/* 목록/통계 탭 + 등록 버튼 */}
        <div className="flex items-center gap-2 px-3 pb-2">
          <div className="flex gap-1 rounded-lg bg-white p-0.5 ring-1 ring-black/5">
            <button onClick={() => setTab('list')} className={`flex items-center gap-1 rounded-md px-3 py-1 text-[12.5px] font-medium ${tab === 'list' ? 'bg-[#2563eb] text-white' : 'text-[#64748b]'}`}>
              <ListFilter size={13} />목록 {filtered.length}
            </button>
            <button onClick={() => setTab('stats')} className={`flex items-center gap-1 rounded-md px-3 py-1 text-[12.5px] font-medium ${tab === 'stats' ? 'bg-[#2563eb] text-white' : 'text-[#64748b]'}`}>
              <ChartBar size={13} />통계
            </button>
          </div>
          <button
            onClick={openForm}
            className="ml-auto flex items-center gap-1 rounded-lg bg-[#2563eb] px-3 py-1.5 text-[12.5px] font-semibold text-white"
          >
            <Plus size={14} />개척 등록
          </button>
        </div>

        {/* 본문 */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4">
          {loading ? (
            <div className="py-16 text-center text-sm text-[#94a3b8]">불러오는 중…</div>
          ) : tab === 'list' ? (
            filtered.length === 0 ? (
              <div className="py-16 text-center text-sm leading-relaxed text-[#94a3b8]">
                아직 개척 거래처가 없습니다.<br />&quot;개척 등록&quot;으로 첫 활동을 기록해보세요.
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {filtered.map((r) => (
                  <div
                    key={r.id}
                    className={`rounded-xl bg-white p-3 ring-1 transition-shadow ${selectedId === r.id ? 'ring-[#2563eb]' : 'ring-black/5'}`}
                    onClick={() => focusRow(r)}
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: POTENTIAL_COLOR[r.potential] }} />
                      <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-[#0f172a]">{r.name}</span>
                      <span className="shrink-0 text-[11px] text-[#94a3b8]">
                        {r.manager_name} · {new Date(r.created_at).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 pl-[18px] text-[12px] text-[#64748b]">
                      <MapPin size={11} className="shrink-0 text-[#cbd5e1]" />
                      <span className="truncate">{r.address}</span>
                      {r.lat == null && <span className="shrink-0 rounded bg-[#fef3c7] px-1 text-[10px] text-[#92400e]">지도 미표시</span>}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5 pl-[18px]" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={r.stage}
                        onChange={(e) => patchRow(r.id, { stage: e.target.value })}
                        className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-1.5 py-1 text-[12px] font-medium text-[#334155]"
                        aria-label="진행 단계"
                      >
                        {STAGES.map((s) => <option key={s} value={s}>{s}</option>)}
                      </select>
                      <select
                        value={r.potential}
                        onChange={(e) => patchRow(r.id, { potential: e.target.value })}
                        className="rounded-md border border-[#e2e8f0] bg-[#f8fafc] px-1.5 py-1 text-[12px] font-medium"
                        style={{ color: POTENTIAL_COLOR[r.potential] }}
                        aria-label="개척 가능성"
                      >
                        {POTENTIALS.map((p) => <option key={p} value={p}>{p === '개척완료' ? '개척완료' : `가능성 ${p}`}</option>)}
                      </select>
                      {confirmDelId === r.id ? (
                        <span className="ml-auto flex items-center gap-1">
                          <button onClick={() => deleteRow(r.id)} className="rounded-md bg-red-500 px-2 py-1 text-[11px] font-semibold text-white">삭제</button>
                          <button onClick={() => setConfirmDelId(null)} className="rounded-md bg-[#f1f5f9] px-2 py-1 text-[11px] text-[#64748b]">취소</button>
                        </span>
                      ) : (
                        <button
                          onClick={() => setConfirmDelId(r.id)}
                          className="ml-auto flex h-7 w-7 items-center justify-center rounded-md text-[#cbd5e1] hover:bg-red-50 hover:text-red-500"
                          aria-label={`${r.name} 삭제`}
                        >
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* ── 통계 ── */
            <div className="flex flex-col gap-4 pt-1">
              <section className="rounded-xl bg-white p-3.5 ring-1 ring-black/5">
                <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-[#94a3b8]">담당자별 개척 (기간 내)</h3>
                {stats.byManager.length === 0 ? (
                  <p className="text-xs text-[#94a3b8]">데이터 없음</p>
                ) : stats.byManager.map(([m, v]) => (
                  <div key={m} className="mb-2 last:mb-0">
                    <div className="mb-0.5 flex justify-between text-[12.5px]">
                      <span className="font-medium text-[#334155]">{m}</span>
                      <span className="text-[#64748b]">{v.total}건{v.done > 0 && <span className="text-[#2563eb]"> · 완료 {v.done}</span>}</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
                      <div className="h-full rounded-full bg-[#2563eb]" style={{ width: `${(v.total / stats.max) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </section>

              <section className="rounded-xl bg-white p-3.5 ring-1 ring-black/5">
                <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-[#94a3b8]">단계 퍼널</h3>
                {stats.byStage.map(([s, n]) => (
                  <div key={s} className="mb-2 last:mb-0">
                    <div className="mb-0.5 flex justify-between text-[12.5px]">
                      <span className="font-medium text-[#334155]">{s}</span>
                      <span className="text-[#64748b]">{n}건</span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-[#f1f5f9]">
                      <div className="h-full rounded-full bg-[#1B3F82]" style={{ width: `${(n / stats.stageMax) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </section>

              <section className="rounded-xl bg-white p-3.5 ring-1 ring-black/5">
                <h3 className="mb-2.5 text-[12px] font-semibold uppercase tracking-wide text-[#94a3b8]">개척 가능성 분포</h3>
                <div className="flex gap-2">
                  {stats.byPotential.map(([p, n]) => (
                    <div key={p} className="flex-1 rounded-lg bg-[#f8fafc] py-2.5 text-center">
                      <div className="text-[17px] font-bold" style={{ color: POTENTIAL_COLOR[p] }}>{n}</div>
                      <div className="mt-0.5 text-[11px] text-[#64748b]">{p}</div>
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
        {/* 범례 */}
        <div className="absolute bottom-3 left-3 z-10 flex items-center gap-2.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] text-[#475569] shadow ring-1 ring-black/5">
          {POTENTIALS.map((p) => (
            <span key={p} className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full" style={{ background: POTENTIAL_COLOR[p] }} />{p}
            </span>
          ))}
        </div>
      </div>

      {/* ── 등록 폼 (바텀시트/모달) ── */}
      {formOpen && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 md:items-center" onClick={() => setFormOpen(false)}>
          <div
            className="w-full max-w-[440px] rounded-t-[24px] bg-white px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-4 md:rounded-[24px] md:pb-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[17px] font-bold text-[#0f172a]">개척 거래처 등록</h2>
              <button onClick={() => setFormOpen(false)} className="flex h-8 w-8 items-center justify-center rounded-full text-[#94a3b8] hover:bg-gray-100" aria-label="닫기">
                <X size={17} />
              </button>
            </div>
            <div className="flex flex-col gap-2.5">
              <input
                value={fName} onChange={(e) => setFName(e.target.value)}
                placeholder="거래처(매장)명"
                className="rounded-xl border border-[#e2e8f0] px-3.5 py-3 text-[14.5px] outline-none focus:border-[#2563eb]"
              />
              <input
                value={fAddr} onChange={(e) => setFAddr(e.target.value)}
                placeholder="주소 (도로명 권장 — 지도에 자동 표시)"
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
                {saving ? '등록 중…' : '등록 (단계: 타겟 · 가능성: 중으로 시작)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
