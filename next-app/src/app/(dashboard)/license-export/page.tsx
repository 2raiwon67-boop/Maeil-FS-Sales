'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import * as XLSX from 'xlsx';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { BUSINESS_UNITS } from '@/types';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface LicenseItem {
  business_name: string;
  permit_date: string;
  business_type: string;
  area: string | number;
  road_address: string;
  address1: string;
  address2: string;
  address3: string;
  lat?: number | string;
  lng?: number | string;
  manager?: string;
}

interface RegionChip {
  region1: string;
  region2: string;
  region3?: string;
  filterRegion: string;
  label: string;
}

// ── 지역 정규화 ───────────────────────────────────────────────────────────────

const REGION1_MAP: Record<string, string> = {
  '서울특별시': '서울', '서울시': '서울', '서울': '서울',
  '인천광역시': '인천', '인천시': '인천', '인천': '인천',
  '경기도': '경기', '경기': '경기',
  '부산광역시': '부산', '부산시': '부산', '부산': '부산',
  '대구광역시': '대구', '대구시': '대구', '대구': '대구',
  '광주광역시': '광주', '광주시': '광주', '광주': '광주',
  '대전광역시': '대전', '대전시': '대전', '대전': '대전',
  '울산광역시': '울산', '울산시': '울산', '울산': '울산',
  '세종특별자치시': '세종', '세종시': '세종', '세종': '세종',
  '강원도': '강원', '강원특별자치도': '강원', '강원': '강원',
  '충청북도': '충북', '충북': '충북',
  '충청남도': '충남', '충남': '충남',
  '전라북도': '전북', '전북특별자치도': '전북', '전북': '전북',
  '전라남도': '전남', '전남': '전남',
  '경상북도': '경북', '경북': '경북',
  '경상남도': '경남', '경남': '경남',
  '제주특별자치도': '제주', '제주도': '제주', '제주': '제주',
};

function normalizeRegion1(r: string | undefined): string {
  return REGION1_MAP[r?.trim() ?? ''] ?? r?.trim() ?? '';
}

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────────────────

function getWeekRange(): { start: string; end: string } {
  const today = new Date();
  const day = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  };
  return { start: fmt(mon), end: fmt(sun) };
}

// ── 업종 목록 ─────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_CHIPS = [
  { code: 'general_restaurants', label: '일반음식점' },
  { code: 'rest_cafes', label: '휴게음식점' },
  { code: 'bakeries', label: '제과점영업' },
];

// ── 컴포넌트 ──────────────────────────────────────────────────────────────────

export default function LicenseExportPage() {
  const { user, metadata, loading: authLoading } = useAuth();
  const supabase = createClient();

  // 날짜
  const { start: defaultStart, end: defaultEnd } = getWeekRange();
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);

  // 업종 칩
  const [activeTypes, setActiveTypes] = useState<Set<string>>(
    new Set(BUSINESS_TYPE_CHIPS.map((t) => t.code)),
  );

  // 지역 칩
  const [regionChips, setRegionChips] = useState<RegionChip[]>([]);
  const [activeRegions, setActiveRegions] = useState<Set<string>>(new Set());
  const [regionLoading, setRegionLoading] = useState(false);
  const [regionError, setRegionError] = useState('');

  // 관리자 모드
  const isAdmin = typeof window !== 'undefined' &&
    sessionStorage.getItem('fs_admin_access') === 'true';
  const adminCode = typeof window !== 'undefined' ?
    (sessionStorage.getItem('admin_code') ?? '') : '';
  const [adminTargetBU, setAdminTargetBU] = useState<string>('');

  // 담당자 맵
  const managerMapRef = useRef<Record<string, string>>({});

  // 검색 결과
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<LicenseItem[] | null>(null);
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  const [truncatedWarning, setTruncatedWarning] = useState<string>('');
  const [searchError, setSearchError] = useState('');

  // 유효한 business_unit 취득
  const getBusinessUnit = useCallback(async (): Promise<string | null> => {
    if (isAdmin) return adminTargetBU || null;
    return metadata?.business_unit ?? null;
  }, [isAdmin, adminTargetBU, metadata]);

  // ── 담당자 맵 로드 ────────────────────────────────────────────────────────

  const loadManagerMap = useCallback(async (bu: string) => {
    try {
      let rows: Array<{ region1: string; region2: string; region3?: string; manager_name: string }> = [];

      if (isAdmin) {
        const res = await fetch(
          `/api/admin-all-data?table=managers&business_unit=${encodeURIComponent(bu)}`,
          { headers: { 'x-admin-key': adminCode } },
        );
        if (!res.ok) return;
        rows = ((await res.json()).data ?? []);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const token = session?.access_token ?? anonKey;
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/managers?business_unit=eq.${encodeURIComponent(bu)}&select=region1,region2,region3,manager_name`;
        const res = await fetch(url, {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;
        rows = await res.json();
      }

      const map: Record<string, string> = {};
      for (const r of rows) {
        if (!r.region2 || r.region2 === '지점장') continue;
        const base = normalizeRegion1(r.region1) + '|' + r.region2;
        if (r.region3) {
          map[base + '|' + r.region3] = r.manager_name;
          if (!r.region1) map['|' + r.region2 + '|' + r.region3] = r.manager_name;
        } else {
          map[base] = r.manager_name;
          if (!map['~' + r.region2]) map['~' + r.region2] = r.manager_name;
        }
      }
      managerMapRef.current = map;
    } catch (e) {
      console.warn('담당자 맵 로드 실패:', e);
    }
  }, [isAdmin, adminCode, supabase]);

  // ── 지역 칩 로드 ──────────────────────────────────────────────────────────

  const loadRegionChips = useCallback(async (bu: string) => {
    setRegionLoading(true);
    setRegionError('');
    setRegionChips([]);

    try {
      let rows: Array<{ region1: string; region2: string; region3?: string }> = [];

      if (isAdmin) {
        const res = await fetch(
          `/api/admin-all-data?table=managers&business_unit=${encodeURIComponent(bu)}`,
          { headers: { 'x-admin-key': adminCode } },
        );
        if (!res.ok) throw new Error('관리자 API 오류');
        rows = ((await res.json()).data ?? []).filter(
          (r: { is_branch_manager?: boolean }) => !r.is_branch_manager,
        );
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const token = session?.access_token ?? anonKey;
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/managers?business_unit=eq.${encodeURIComponent(bu)}&is_branch_manager=eq.false&select=region1,region2,region3&order=region2`;
        const res = await fetch(url, {
          headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error('조회 실패');
        rows = await res.json();
      }

      const seen = new Set<string>();
      const chips: RegionChip[] = [];
      for (const r of rows) {
        if (!r.region2 || r.region2 === '지점장' || r.region2 === '전체') continue;
        const dedupKey = `${r.region1 ?? ''}|${r.region2}|${r.region3 ?? ''}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);
        const filterRegion = `${r.region1 ?? ''} ${r.region2}`.trim();
        const label = r.region3 ? `${r.region2} ${r.region3}` : r.region2;
        chips.push({ region1: r.region1, region2: r.region2, region3: r.region3, filterRegion, label });
      }

      if (chips.length === 0) throw new Error('지역 없음');

      setRegionChips(chips);
      setActiveRegions(new Set(chips.map((c) => c.filterRegion)));
    } catch {
      setRegionError('지역 로드 실패 — 담당자 관리에서 시도/시군구를 입력해주세요.');
    } finally {
      setRegionLoading(false);
    }
  }, [isAdmin, adminCode, supabase]);

  // ── 초기 로드 ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (authLoading) return;
    if (isAdmin) return; // 관리자는 수동으로 지점 선택
    const bu = metadata?.business_unit;
    if (!bu) return;
    loadManagerMap(bu);
    loadRegionChips(bu);
  }, [authLoading, isAdmin, metadata, loadManagerMap, loadRegionChips]);

  // ── 관리자 지점 변경 ──────────────────────────────────────────────────────

  const handleAdminBranchChange = (bu: string) => {
    setAdminTargetBU(bu);
    managerMapRef.current = {};
    setRegionChips([]);
    setActiveRegions(new Set());
    setResults(null);
    if (!bu) return;
    loadManagerMap(bu);
    loadRegionChips(bu);
  };

  // ── 칩 토글 ──────────────────────────────────────────────────────────────

  const toggleType = (code: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      return next;
    });
  };

  const toggleRegion = (filterRegion: string) => {
    setActiveRegions((prev) => {
      const next = new Set(prev);
      next.has(filterRegion) ? next.delete(filterRegion) : next.add(filterRegion);
      return next;
    });
  };

  // ── 검색 ─────────────────────────────────────────────────────────────────

  const handleSearch = async () => {
    if (!startDate || !endDate) {
      toast.warning('조회 기간을 선택해주세요.');
      return;
    }
    if (activeTypes.size === 0) {
      toast.warning('업종을 하나 이상 선택해주세요.');
      return;
    }
    if (activeRegions.size === 0) {
      toast.warning('지역을 하나 이상 선택해주세요.');
      return;
    }

    setSearching(true);
    setResults(null);
    setSearchError('');
    setTruncatedWarning('');

    try {
      const types = [...activeTypes].join(',');
      const regions = [...activeRegions].join(',');
      const sd = startDate.replace(/-/g, '');
      const ed = endDate.replace(/-/g, '');
      const params = new URLSearchParams({ types, regions, startDate: sd, endDate: ed });
      const res = await fetch(`/api/public-license?${params}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error ?? '조회 실패');

      const items: LicenseItem[] = data.items.map((item: LicenseItem) => {
        const key = normalizeRegion1(item.address1) + '|' + item.address2;
        const manager =
          (item.address3 ? managerMapRef.current[key + '|' + item.address3] : undefined) ??
          managerMapRef.current[key] ??
          managerMapRef.current['~' + item.address2] ??
          '';
        return { ...item, manager };
      });

      setResults(items);
      setSelectedIndices(new Set(items.map((_, i) => i)));

      if (data.truncated?.length) {
        const msg = (data.truncated as Array<{ sido: string; total: number }>)
          .map((t) => `${t.sido}(${t.total.toLocaleString()}건)`)
          .join(', ');
        setTruncatedWarning(`데이터 누락 가능성: ${msg} — 2,000건 상한 초과. 조회 기간을 나눠서 재조회하세요.`);
      }

      if (data.failedRegions?.length) {
        toast.warning(`일부 지역 조회 실패 (재시도 권장): ${data.failedRegions.join(', ')}`, {
          duration: 5000,
        });
      }
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : '조회 중 오류 발생');
    } finally {
      setSearching(false);
    }
  };

  // ── 선택 토글 ────────────────────────────────────────────────────────────

  const toggleItem = (i: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const toggleAll = (selectAll: boolean) => {
    if (!results) return;
    setSelectedIndices(selectAll ? new Set(results.map((_, i) => i)) : new Set());
  };

  // ── 엑셀 다운로드 ────────────────────────────────────────────────────────

  const handleDownload = () => {
    if (!results || selectedIndices.size === 0) return;
    const selected = [...selectedIndices].sort((a, b) => a - b).map((i) => results[i]);
    const headers = [
      'NO', '영업 허가일', '사업장명', '거래여부(기입예정)', '업태구분명',
      '평형', '도로명전체주소', '주소1', '주소2', '주소3',
      '순위', '담당자', '앱시트등록일', '위도', '경도', '사용우유',
    ];
    const rows = selected.map((item, idx) => [
      idx + 1,
      item.permit_date ?? '',
      item.business_name ?? '',
      '인허가',
      item.business_type ?? '',
      item.area ?? '',
      item.road_address ?? '',
      item.address1 ?? '',
      item.address2 ?? '',
      item.address3 ?? '',
      '1',
      item.manager ?? '',
      '',
      item.lat ?? '',
      item.lng ?? '',
      '',
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, '인허가데이터');
    XLSX.writeFile(wb, `인허가_공공데이터_${startDate}_${endDate}.xlsx`);
    toast.success(`${selected.length}건 다운로드 완료`);
  };

  // ── 렌더 ─────────────────────────────────────────────────────────────────

  const allSelected = results !== null && selectedIndices.size === results.length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-5 pb-28">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">인허가 추출</h1>
      <p className="mb-5 text-sm leading-relaxed text-gray-500">
        공공데이터(data.go.kr) 기준 신규 인허가 업소를 조회하고 엑셀(.xlsx)로 내려받습니다.
        모바일에서도 그대로 추출할 수 있습니다.
      </p>

      {/* 관리자 지점 선택 배너 */}
      {isAdmin && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl border border-yellow-300 bg-yellow-50 px-4 py-3">
          <span className="text-sm font-semibold text-yellow-800">사업부 모드</span>
          <span className="text-sm text-gray-600">추출할 지점:</span>
          <select
            value={adminTargetBU}
            onChange={(e) => handleAdminBranchChange(e.target.value)}
            className="min-w-[160px] rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-1.5 text-sm focus:outline-none"
          >
            <option value="">— 지점을 선택해주세요 —</option>
            {BUSINESS_UNITS.map((bu) => (
              <option key={bu} value={bu}>{bu}</option>
            ))}
          </select>
          {adminTargetBU && (
            <span className="text-xs text-gray-500">({adminTargetBU} 기준 추출)</span>
          )}
        </div>
      )}

      {/* 조회 조건 카드 */}
      <div className="mb-4 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3.5 text-sm font-bold">조회 조건</div>
        <div className="p-4">

          {/* 조회 기간 */}
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-gray-400">조회 기간</p>
          <div className="flex gap-2.5">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500">시작일</span>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-[15px] outline-none focus:border-blue-500"
              />
            </label>
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-semibold text-gray-500">종료일</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-gray-200 px-3 py-2.5 text-[15px] outline-none focus:border-blue-500"
              />
            </label>
          </div>

          {/* 업종 */}
          <p className="mb-2 mt-[18px] text-[11px] font-bold uppercase tracking-wide text-gray-400">업종</p>
          <div className="flex flex-wrap gap-2">
            {BUSINESS_TYPE_CHIPS.map((t) => (
              <button
                key={t.code}
                onClick={() => toggleType(t.code)}
                className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-all active:scale-95 ${
                  activeTypes.has(t.code)
                    ? 'border-blue-500 bg-blue-500 text-white'
                    : 'border-gray-200 bg-white text-gray-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* 지역 */}
          <p className="mb-2 mt-[18px] text-[11px] font-bold uppercase tracking-wide text-gray-400">지역</p>
          <div className="flex flex-wrap gap-2">
            {regionLoading ? (
              <span className="text-xs text-gray-400">지역 로딩 중...</span>
            ) : regionError ? (
              <span className="text-xs text-red-600">{regionError}</span>
            ) : isAdmin && !adminTargetBU ? (
              <span className="text-xs text-gray-400">위에서 지점을 선택하면 지역이 표시됩니다.</span>
            ) : regionChips.length === 0 ? (
              <span className="text-xs text-gray-400">지역 로딩 중...</span>
            ) : (
              regionChips.map((chip) => (
                <button
                  key={chip.filterRegion}
                  onClick={() => toggleRegion(chip.filterRegion)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-all active:scale-95 ${
                    activeRegions.has(chip.filterRegion)
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-gray-200 bg-white text-gray-700'
                  }`}
                >
                  {chip.label}
                </button>
              ))
            )}
          </div>

          {/* 조회 버튼 */}
          <button
            onClick={handleSearch}
            disabled={searching}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-md bg-blue-500 py-3.5 text-[15px] font-bold text-white transition hover:bg-blue-600 active:scale-[0.99] disabled:cursor-default disabled:bg-gray-300"
          >
            {searching ? (
              <>
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                조회 중...
              </>
            ) : (
              '인허가 조회'
            )}
          </button>
        </div>
      </div>

      {/* 결과 영역 */}
      <div className="mt-1">
        {/* 초기 상태 */}
        {results === null && !searching && !searchError && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-sm text-gray-400">
            <span className="text-[34px] opacity-55">📋</span>
            <span>기간·업종·지역을 선택하고 조회하세요.</span>
          </div>
        )}

        {/* 로딩 */}
        {searching && (
          <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-sm text-gray-400">
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-blue-400 border-t-transparent" />
            <span>공공데이터 조회 중...</span>
          </div>
        )}

        {/* 오류 */}
        {searchError && (
          <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            ❌ {searchError}
          </div>
        )}

        {/* 결과 */}
        {results !== null && !searching && (
          <>
            {/* 누락 경고 */}
            {truncatedWarning && (
              <div className="mb-3 rounded-md border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
                ⚠️ <strong>데이터 누락 가능성:</strong> {truncatedWarning}
              </div>
            )}

            {results.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-center text-sm text-gray-400">
                <span className="text-[34px] opacity-55">🔍</span>
                <span>해당 기간·지역의 신규 인허가 데이터가 없습니다.</span>
              </div>
            ) : (
              <>
                {/* 툴바 */}
                <div className="sticky top-0 z-20 mb-3 flex items-center justify-between gap-2.5 rounded-xl border border-gray-200 bg-white/90 px-4 py-3 backdrop-blur-md">
                  <span className="text-sm font-semibold">
                    총 <span className="text-blue-500">{results.length}</span>건 · {selectedIndices.size}건 선택
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => toggleAll(!allSelected)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                        allSelected
                          ? 'border-blue-400 bg-blue-50 text-blue-600'
                          : 'border-gray-200 bg-white text-gray-700'
                      }`}
                    >
                      {allSelected ? '전체 해제' : '전체 선택'}
                    </button>
                    <button
                      onClick={handleDownload}
                      disabled={selectedIndices.size === 0}
                      className="flex items-center gap-1.5 rounded-full bg-green-600 px-3.5 py-2 text-sm font-bold text-white transition active:scale-97 disabled:cursor-default disabled:bg-gray-300"
                    >
                      ⬇ 엑셀 ({selectedIndices.size})
                    </button>
                  </div>
                </div>

                {/* 카드 목록 */}
                <div className="flex flex-col gap-2.5">
                  {results.map((item, i) => {
                    const selected = selectedIndices.has(i);
                    return (
                      <button
                        key={i}
                        onClick={() => toggleItem(i)}
                        className={`flex w-full items-start gap-3 rounded-xl border p-3.5 text-left transition-colors ${
                          selected
                            ? 'border-blue-400 bg-blue-50'
                            : 'border-gray-200 bg-white'
                        }`}
                      >
                        {/* 체크박스 */}
                        <span
                          className={`mt-0.5 flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[7px] border-2 text-[13px] text-white transition-colors ${
                            selected ? 'border-blue-500 bg-blue-500' : 'border-gray-300'
                          }`}
                        >
                          {selected && '✓'}
                        </span>

                        {/* 내용 */}
                        <div className="min-w-0 flex-1">
                          <p className="mb-1.5 break-all text-[15px] font-bold leading-snug">
                            {item.business_name || '(상호 미상)'}
                          </p>
                          <div className="mb-2 flex flex-wrap gap-1.5">
                            <span className="rounded-md bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
                              {item.permit_date || '허가일 미상'}
                            </span>
                            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-600">
                              {item.business_type || '-'}
                            </span>
                            {item.area && (
                              <span className="rounded-md bg-orange-50 px-2 py-0.5 text-[11px] font-semibold text-orange-700">
                                {item.area}평
                              </span>
                            )}
                            {item.manager ? (
                              <span className="rounded-md bg-green-50 px-2 py-0.5 text-[11px] font-semibold text-green-700">
                                {item.manager}
                              </span>
                            ) : (
                              <span className="rounded-md bg-red-50 px-2 py-0.5 text-[11px] font-semibold text-red-600">
                                담당 미지정
                              </span>
                            )}
                          </div>
                          <p className="break-all text-[12.5px] leading-snug text-gray-500">
                            {item.road_address || '주소 미상'}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
