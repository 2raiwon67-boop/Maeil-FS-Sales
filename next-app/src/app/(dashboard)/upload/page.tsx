'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import {
  FileText, Store, Users, BookOpen, Crown, Download, RefreshCw, Trash2, X,
  UploadCloud, Plus, ChevronLeft, ChevronRight, Search, AlertTriangle,
} from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { createClient } from '@/lib/supabase/client';
import { BRANCH_UNITS } from '@/types';
import { PageHeader, headerBtn } from '@/components/layout/page-header';

// ── 타입 정의 ──────────────────────────────────────────────────────────────────

interface ColDef {
  key: string;
  label: string;
}

interface UploadTypeCfg {
  label: string;
  table: string;
  editable: boolean;
  scrollAll?: boolean;
  noBusinessUnit?: boolean;
  columns?: ColDef[];
  previewColumns?: ColDef[];
  templateHeaders?: string[];
  sampleRow?: string[];
  columnMap?: Record<string, string>;
  requiredCol?: string;
  dateFields?: string[];
  numericFields?: string[];
  mode?: string;
  deduplicateField?: string;
  transformRow?: (obj: Row, rawByHeader: Record<string, string>) => void; // 매핑 후 행 가공(접두 제거·business_unit 조합 등)
}

type Row = Record<string, unknown>;

interface SearchItem {
  business_name?: string;
  permit_date?: string;
  business_type?: string;
  area?: string;
  road_address?: string;
  address1?: string;
  address2?: string;
  address3?: string;
  lat?: string | number;
  lng?: string | number;
  manager?: string;
}

// ── 업로드 유형 설정 ────────────────────────────────────────────────────────────

const UPLOAD_TYPES: Record<string, UploadTypeCfg> = {
  licenses: {
    label: '인허가 데이터', table: 'licenses',
    editable: true, scrollAll: true,
    previewColumns: [
      { key: 'permit_date', label: '영업 허가일' },
      { key: 'business_name', label: '사업장명' },
      { key: 'trade_status', label: '거래여부' },
      { key: 'business_type', label: '업태구분명' },
      { key: 'area', label: '평형' },
      { key: 'road_address', label: '도로명전체주소' },
      { key: 'address1', label: '주소1' },
      { key: 'address2', label: '주소2' },
      { key: 'address3', label: '주소3' },
      { key: 'priority', label: '순위' },
      { key: 'manager', label: '담당자' },
      { key: 'appsheet_date', label: '앱시트등록일' },
      { key: 'lat', label: '위도' },
      { key: 'lng', label: '경도' },
      { key: 'milk_type', label: '사용우유' },
    ],
    columns: [
      { key: 'permit_date', label: '영업 허가일' },
      { key: 'business_name', label: '사업장명' },
      { key: 'trade_status', label: '거래여부' },
      { key: 'business_type', label: '업태' },
      { key: 'area', label: '평형' },
      { key: 'road_address', label: '도로명주소' },
      { key: 'address1', label: '주소1' },
      { key: 'address2', label: '주소2' },
      { key: 'address3', label: '주소3' },
      { key: 'priority', label: '순위' },
      { key: 'manager', label: '담당자' },
      { key: 'appsheet_date', label: '앱시트등록일' },
      { key: 'lat', label: '위도' },
      { key: 'lng', label: '경도' },
      { key: 'milk_type', label: '사용우유' },
    ],
    templateHeaders: ['NO', '영업 허가일', '사업장명', '거래여부(기입예정)', '업태구분명', '평형', '도로명전체주소', '주소1', '주소2', '주소3', '순위', '담당자', '앱시트등록일', '위도', '경도', '사용우유'],
    sampleRow: ['1', '2026-01-15', '행복카페', '인허가', '휴게음식점', '25', '경기도 포천시 소흘읍 죽엽산로 1', '경기도', '포천시', '소흘읍', '1', '홍길동', '2026-01-20', '37.894', '127.204', '매일'],
    columnMap: {
      '영업 허가일': 'permit_date', '사업장명': 'business_name', '거래여부(기입예정)': 'trade_status',
      '업태구분명': 'business_type', '평형': 'area', '도로명전체주소': 'road_address',
      '주소1': 'address1', '주소2': 'address2', '주소3': 'address3', '순위': 'priority',
      '담당자': 'manager', '앱시트등록일': 'appsheet_date', '위도': 'lat', '경도': 'lng', '사용우유': 'milk_type',
    },
    requiredCol: 'business_name', dateFields: ['permit_date', 'appsheet_date'], numericFields: ['lat', 'lng'],
    mode: 'add_new_only', deduplicateField: 'business_name',
  },
  accounts: {
    label: '주요거래처', table: 'accounts', editable: true,
    columns: [
      { key: 'seq_no', label: 'NO' },
      { key: 'store_code', label: '사업장코드명' },
      { key: 'customer_level', label: '고객레벨2' },
      { key: 'account_id', label: '거래처ID' },
      { key: 'business_name', label: '거래처명' },
      { key: 'trade_status', label: '거래상태' },
      { key: 'manager_name', label: '담당자명' },
      { key: 'address', label: '주소' },
    ],
    templateHeaders: ['NO', '사업부', '사업장', '지점', '사업장코드명', '고객레벨2', '거래처ID', '거래처명', '거래상태', '주요거래처 여부', '담당자명', '주소', '도/광역시', '시/군/구', '면/동'],
    sampleRow: ['1', '경기북부', '포천', '포천지점', 'K11P001', 'A', 'C00001', '행복카페', '거래', 'Y', '홍길동', '경기도 포천시 소흘읍 죽엽산로 1', '경기도', '포천시', '소흘읍'],
    columnMap: {
      'NO': 'seq_no', '사업장코드명': 'store_code', '고객레벨2': 'customer_level', '거래처ID': 'account_id',
      '거래처명': 'business_name', '거래상태': 'trade_status', '담당자명': 'manager_name', '주소': 'address',
    },
    requiredCol: 'business_name', dateFields: [], numericFields: [],
    mode: 'add_new_only', deduplicateField: 'account_id',
  },
  recipes: {
    label: '레시피 데이터', table: 'recipes', editable: false, scrollAll: true, noBusinessUnit: true,
    previewColumns: [
      { key: 'name', label: '레시피명' },
      { key: 'name_en', label: '영문명' },
      { key: 'category', label: '카테고리' },
      { key: 'main_products', label: '자사제품' },
      { key: 'tags', label: '태그' },
      { key: 'is_vegan', label: '비건' },
    ],
  },
  managers: {
    label: '담당자관리', table: 'managers', editable: true,
    columns: [
      { key: 'region1', label: '지역1' },
      { key: 'region2', label: '지역2' },
      { key: 'region3', label: '지역3' },
      { key: 'manager_name', label: '담당자' },
      { key: 'email', label: '이메일' },
    ],
    templateHeaders: ['지역1', '지역2', '지역3', '담당자', '이메일'],
    sampleRow: ['경기도', '화성시', '동탄구', '홍길동', 'hong@example.com'],
    columnMap: {
      '지역1': 'region1', '지역2': 'region2', '지역3': 'region3', '담당자': 'manager_name', '이메일': 'email',
    },
    requiredCol: 'manager_name', dateFields: [], numericFields: [],
  },
};

const PREVIEW_PAGE_SIZE = 5;

// ── 시도명 정규화 ──────────────────────────────────────────────────────────────

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
function normalizeRegion1(r?: string): string {
  return REGION1_MAP[(r ?? '').trim()] ?? (r ?? '').trim();
}

function normalizeToYMD(val: unknown): string | null {
  if (!val) return null;
  const s = String(val);
  const m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return s.trim();
}

function fmtCell(v: unknown): string {
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? '✓' : '';
  return String(v ?? '');
}

function getWeekRange(): { start: string; end: string } {
  const today = new Date();
  const day = today.getDay();
  const mon = new Date(today);
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { start: fmt(mon), end: fmt(sun) };
}

interface RegionChip {
  filterRegion: string;
  label: string;
}

// ════════════════════════════════════════════════════════════════════════════

export default function UploadPage() {
  const { metadata, loading: authLoading } = useAuth();
  const supabase = createClient();

  const isAdmin = typeof window !== 'undefined' && sessionStorage.getItem('fs_admin_access') === 'true';
  const adminCode = typeof window !== 'undefined' ? (sessionStorage.getItem('admin_code') ?? '') : '';

  const [selectedType, setSelectedType] = useState<string>('licenses');
  const [adminTargetBU, setAdminTargetBU] = useState<string>('');

  const [currentDbData, setCurrentDbData] = useState<Row[]>([]);
  const [dbTotal, setDbTotal] = useState<number>(0);
  const [dbLoading, setDbLoading] = useState(false);
  const [dbError, setDbError] = useState('');
  const [previewPage, setPreviewPage] = useState(0);

  const [deleteMode, setDeleteMode] = useState(false);
  const [checkedRows, setCheckedRows] = useState<Set<string | number>>(new Set());

  // 업로드
  const [parsedData, setParsedData] = useState<Row[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [uploadBanner, setUploadBanner] = useState<{ cls: string; html: string } | null>(null);
  const [uploadDisabled, setUploadDisabled] = useState(false);
  const [uploading, setUploading] = useState(false);
  // 교체(파괴적) 업로드 확인 모달
  const [replaceConfirm, setReplaceConfirm] = useState<{ label: string; existing: number; incoming: number } | null>(null);
  const [dropAck, setDropAck] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  // 공공인허가 조회
  const [srchStart, setSrchStart] = useState('');
  const [srchEnd, setSrchEnd] = useState('');
  const [typeChips, setTypeChips] = useState<Set<string>>(new Set(['general_restaurants', 'rest_cafes', 'bakeries']));
  const [regionChips, setRegionChips] = useState<RegionChip[]>([]);
  const [activeRegions, setActiveRegions] = useState<Set<string>>(new Set());
  const [regionMsg, setRegionMsg] = useState('지역 로딩 중...');
  const [searching, setSearching] = useState(false);
  const [srchResults, setSrchResults] = useState<SearchItem[]>([]);
  const [srchSelected, setSrchSelected] = useState<Set<number>>(new Set());
  const managerMapRef = useRef<Record<string, string>>({});

  const cfg = UPLOAD_TYPES[selectedType];

  const getBusinessUnit = useCallback((): string | null => {
    if (isAdmin) return adminTargetBU || null;
    return metadata?.business_unit ?? null;
  }, [isAdmin, adminTargetBU, metadata]);

  // ── DB 현황 로드 ──────────────────────────────────────────────────────────

  const loadCurrentData = useCallback(async () => {
    setCheckedRows(new Set());
    setDbError('');
    const c = UPLOAD_TYPES[selectedType];
    const bu = c.noBusinessUnit ? null : getBusinessUnit();

    if (!c.noBusinessUnit && !bu) {
      setCurrentDbData([]);
      setDbTotal(0);
      setDbError(isAdmin ? '👑 위에서 조회할 지점을 선택해주세요.' : '소속 정보를 불러오지 못했습니다.');
      return;
    }

    setDbLoading(true);
    try {
      // 관리자: admin-all-data API 사용
      if (isAdmin && bu && c.table) {
        const resp = await fetch(
          `/api/admin-all-data?table=${c.table}&business_unit=${encodeURIComponent(bu)}`,
          { headers: { 'x-admin-key': adminCode } },
        );
        if (!resp.ok) throw new Error(`관리자 API 오류: ${resp.status}`);
        let rows: Row[] = (await resp.json()).data ?? [];
        if (c.table === 'licenses') {
          rows = [...rows].sort((a, b) => (String(b.permit_date ?? '') > String(a.permit_date ?? '') ? 1 : -1));
        }
        setDbTotal(rows.length);
        if (c.editable) setCurrentDbData(rows);
        else setCurrentDbData(rows.slice(previewPage * PREVIEW_PAGE_SIZE, (previewPage + 1) * PREVIEW_PAGE_SIZE));
        setDbLoading(false);
        return;
      }

      // 일반 사용자
      let countQuery = supabase.from(c.table).select('*', { count: 'exact' }).limit(1);
      if (bu) countQuery = countQuery.eq('business_unit', bu);
      const { count, error: countErr } = await countQuery;
      if (countErr) throw countErr;
      setDbTotal(count ?? 0);

      if (!count) {
        setCurrentDbData([]);
        setDbLoading(false);
        return;
      }

      let query = supabase.from(c.table).select('*');
      if (bu) query = query.eq('business_unit', bu);
      if (c.table === 'licenses') query = query.order('permit_date', { ascending: false, nullsFirst: false });
      else if (c.table === 'recipes') query = query.order('name', { ascending: true });

      if (c.editable) {
        query = query.limit(1000);
      } else {
        const from = previewPage * PREVIEW_PAGE_SIZE;
        query = query.range(from, from + PREVIEW_PAGE_SIZE - 1);
      }
      const { data, error } = await query;
      if (error) throw error;
      setCurrentDbData((data as Row[]) ?? []);
    } catch (e) {
      setDbError(`데이터 로드 실패: ${(e as Error).message}`);
      setCurrentDbData([]);
    } finally {
      setDbLoading(false);
    }
  }, [selectedType, getBusinessUnit, isAdmin, adminCode, supabase, previewPage]);

  // ── 담당자 맵 + 지역 칩 (공공인허가 조회용) ───────────────────────────────

  const loadManagerMap = useCallback(async (bu: string) => {
    try {
      let rows: Array<{ region1: string; region2: string; region3?: string; manager_name: string }> = [];
      if (isAdmin) {
        const res = await fetch(`/api/admin-all-data?table=managers&business_unit=${encodeURIComponent(bu)}`,
          { headers: { 'x-admin-key': adminCode } });
        if (!res.ok) return;
        rows = (await res.json()).data ?? [];
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const token = session?.access_token ?? anonKey;
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/managers?business_unit=eq.${encodeURIComponent(bu)}&select=region1,region2,region3,manager_name`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
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

  const loadRegionChips = useCallback(async (bu: string) => {
    setRegionMsg('지역 로딩 중...');
    setRegionChips([]);
    try {
      let rows: Array<{ region1: string; region2: string; region3?: string; is_branch_manager?: boolean }> = [];
      if (isAdmin) {
        const res = await fetch(`/api/admin-all-data?table=managers&business_unit=${encodeURIComponent(bu)}`,
          { headers: { 'x-admin-key': adminCode } });
        if (!res.ok) throw new Error('관리자 API 오류');
        rows = ((await res.json()).data ?? []).filter((r: { is_branch_manager?: boolean }) => !r.is_branch_manager);
      } else {
        const { data: { session } } = await supabase.auth.getSession();
        const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
        const token = session?.access_token ?? anonKey;
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/managers?business_unit=eq.${encodeURIComponent(bu)}&is_branch_manager=not.is.true&select=region1,region2,region3&order=region2`,
          { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
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
        chips.push({
          filterRegion: `${r.region1 ?? ''} ${r.region2}`.trim(),
          label: r.region3 ? `${r.region2} ${r.region3}` : r.region2,
        });
      }
      if (chips.length === 0) throw new Error('지역 없음');
      setRegionChips(chips);
      setActiveRegions(new Set(chips.map((c) => c.filterRegion)));
      setRegionMsg('');
    } catch {
      setRegionMsg('지역 로드 실패 — 담당자 관리에서 시도/시군구를 입력해주세요.');
    }
  }, [isAdmin, adminCode, supabase]);

  // ── 초기화 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const w = getWeekRange();
    setSrchStart(w.start);
    setSrchEnd(w.end);
  }, []);

  useEffect(() => {
    if (authLoading) return;
    loadCurrentData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, selectedType, previewPage, adminTargetBU]);

  useEffect(() => {
    if (authLoading || isAdmin) return;
    const bu = metadata?.business_unit;
    if (!bu) return;
    loadManagerMap(bu);
    loadRegionChips(bu);
  }, [authLoading, isAdmin, metadata, loadManagerMap, loadRegionChips]);

  const handleAdminBranchChange = (bu: string) => {
    setAdminTargetBU(bu);
    setPreviewPage(0);
    managerMapRef.current = {};
    setRegionChips([]);
    setActiveRegions(new Set());
    if (!bu) return;
    loadManagerMap(bu);
    loadRegionChips(bu);
  };

  const selectType = (t: string) => {
    setSelectedType(t);
    setParsedData(null);
    setFileName('');
    setUploadBanner(null);
    setPreviewPage(0);
    setDeleteMode(false);
    setCheckedRows(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ── 파일 파싱 ─────────────────────────────────────────────────────────────

  const processFile = (file: File) => {
    const c = UPLOAD_TYPES[selectedType];
    if (!c.columnMap) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      try {
        const XLSX = await import('xlsx');
        const wb = XLSX.read(ev.target?.result, { type: 'array', cellDates: true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, dateNF: 'YYYY-MM-DD' });
        if (raw.length < 2) { toast.error('데이터가 없습니다. 헤더 외 1행 이상 필요합니다.'); return; }

        const fileHeaders = (raw[0] as unknown[]).map((h) => String(h ?? '').trim());
        const dataRows = raw.slice(1).filter((row) => (row as unknown[]).some((cell) => cell !== '' && cell != null));

        const requiredHeader = Object.entries(c.columnMap!).find(([, dbCol]) => dbCol === c.requiredCol)?.[0];
        if (requiredHeader && !fileHeaders.includes(requiredHeader)) {
          toast.error(`필수 컬럼 "${requiredHeader}"이 파일에 없습니다.`);
          return;
        }

        const parsed: Row[] = dataRows.map((row) => {
          const obj: Row = {};
          const rawByHeader: Record<string, string> = {};
          fileHeaders.forEach((header, i) => {
            const cell = (row as unknown[])[i] != null ? String((row as unknown[])[i]).trim() : '';
            rawByHeader[header] = cell;
            const dbCol = c.columnMap![header];
            if (!dbCol) return;
            let val: unknown = cell;
            if ((c.numericFields ?? []).includes(dbCol)) val = val ? parseFloat(val as string) : null;
            else if ((c.dateFields ?? []).includes(dbCol)) val = normalizeToYMD(val);
            else if (val === '') val = null;
            obj[dbCol] = val;
          });
          c.transformRow?.(obj, rawByHeader);
          return obj;
        }).filter((row) => row[c.requiredCol!] && row[c.requiredCol!] !== '[예시]');

        if (parsed.length === 0) { toast.error('유효한 데이터가 없습니다. 필수 컬럼을 확인해주세요.'); return; }

        setFileName(`${file.name} — ${parsed.length}건 인식`);
        setParsedData(parsed);

        // 거래여부 유효성 (인허가)
        let hasErr = false;
        if (selectedType === 'licenses') {
          const VALID = new Set(['거래', '미거래', '인허가', '공사중', 'DROP']);
          const invalid = parsed.filter((r) => r.trade_status && !VALID.has(r.trade_status as string));
          if (invalid.length > 0) {
            const vals = [...new Set(invalid.map((r) => `"${r.trade_status}"`))].join(', ');
            hasErr = true;
            setUploadBanner({ cls: 'bg-red-50 border-red-200 text-red-900', html: `❌ 유효하지 않은 거래여부 값 ${invalid.length}건: ${vals} (허용: 거래/미거래/인허가/공사중/DROP)` });
          }
        }
        if (!hasErr) {
          const isAddNew = c.mode === 'add_new_only';
          setUploadBanner({
            cls: 'bg-amber-50 border-amber-200 text-amber-900',
            html: isAddNew
              ? `➕ ${c.label} ${parsed.length}건을 추가합니다. 이미 존재하는 항목은 자동으로 건너뜁니다.`
              : `⚠️ 기존 ${c.label} 데이터가 모두 삭제되고 새 데이터 ${parsed.length}건으로 교체됩니다.`,
          });
        }
        setUploadDisabled(hasErr);
      } catch (err) {
        toast.error('파일 파싱 오류: ' + (err as Error).message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  // ── 업로드 실행 ───────────────────────────────────────────────────────────

  // 버튼 핸들러: 교체(파괴적) 모드는 확인 모달을 띄우고, 그 외(추가/관리자)는 바로 실행
  const confirmUpload = () => {
    if (!parsedData || parsedData.length === 0) return;
    const c = UPLOAD_TYPES[selectedType];
    const isReplace = c.mode !== 'add_new_only' && !isAdmin;
    if (isReplace) {
      setDropAck(false);
      setReplaceConfirm({ label: c.label, existing: dbTotal, incoming: parsedData.length });
      return;
    }
    void runUpload();
  };

  const runUpload = async () => {
    if (!parsedData || parsedData.length === 0) return;
    const c = UPLOAD_TYPES[selectedType];
    setUploading(true);
    try {
      // 관리자 중앙 업로드
      if (isAdmin) {
        if (!adminTargetBU) throw new Error('상단에서 업로드할 지점을 먼저 선택해주세요.');
        if (c.table !== 'licenses') throw new Error('인허가만 중앙 업로드를 지원합니다.');
        const resp = await fetch('/api/admin-upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-admin-key': adminCode },
          body: JSON.stringify({ table: c.table, business_unit: adminTargetBU, mode: c.mode, rows: parsedData }),
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || '업로드 실패');
        const msg = `✅ ${c.label} ${result.inserted}건 신규 추가 완료${result.skipped ? ` (중복 ${result.skipped}건 건너뜀)` : ''}`;
        setUploadBanner({ cls: 'bg-green-50 border-green-200 text-green-900', html: msg });
        toast.success(msg);
        setParsedData(null);
        setPreviewPage(0);
        await loadCurrentData();
        return;
      }

      const { data: userData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userData?.user) throw new Error('로그인 정보를 가져올 수 없습니다.');
      const user = userData.user;
      const bu = user.user_metadata?.business_unit;
      if (!bu) throw new Error('소속(business_unit)이 설정되지 않은 계정입니다.');

      const isAddNew = c.mode === 'add_new_only';
      let toInsert = [...parsedData];

      // add_new_only: 중복 제거
      if (isAddNew && c.deduplicateField) {
        const f = c.deduplicateField;
        const { data: existing, error: exErr } = await supabase.from(c.table).select(f).eq('business_unit', bu);
        if (exErr) throw new Error('기존 데이터 확인 실패: ' + exErr.message);
        const existingSet = new Set((existing ?? []).map((r) => (r as unknown as Row)[f]).filter(Boolean));
        const before = toInsert.length;
        toInsert = toInsert.filter((row) => !existingSet.has(row[f]));
        const skipped = before - toInsert.length;
        if (toInsert.length === 0) {
          setUploadBanner({ cls: 'bg-amber-50 border-amber-200 text-amber-900', html: `ℹ️ ${before}건 모두 이미 존재하는 데이터입니다.` });
          setUploading(false);
          return;
        }
        if (skipped > 0) toast(`중복 ${skipped}건 건너뜀, ${toInsert.length}건 신규 추가`);
      }

      const BATCH = 500;
      const now = new Date().toISOString();

      // 전체 교체 모드: 삭제 前에 기존 데이터를 스냅샷해 둔다.
      // 삽입 도중 실패하면 스냅샷을 되돌려 '삭제만 되고 삽입은 실패 → 전멸'을 방지한다.
      let snapshot: Row[] = [];
      if (!isAddNew) {
        const { data: snap, error: snapErr } = await supabase.from(c.table).select('*').eq('business_unit', bu);
        if (snapErr) throw new Error('기존 데이터 확인 실패: ' + snapErr.message);
        snapshot = (snap as Row[]) ?? [];
        const { error: delErr } = await supabase.from(c.table).delete().eq('business_unit', bu);
        if (delErr) throw new Error('기존 데이터 삭제 실패: ' + delErr.message);
      }

      let inserted = 0;
      try {
        for (let i = 0; i < toInsert.length; i += BATCH) {
          const batch = toInsert.slice(i, i + BATCH).map((row) => ({
            ...row,
            business_unit: (row.business_unit as string) || bu, // 활동노트가 사업장+지점을 지정하면 그 값, 아니면 업로더 소속
            uploaded_by: user.id, uploaded_at: now,
          }));
          const { error } = await supabase.from(c.table).insert(batch);
          if (error && error.code === '23505') {
            for (const row of batch) {
              const { error: rowErr } = await supabase.from(c.table).insert([row]);
              if (!rowErr) inserted++;
              else if (rowErr.code !== '23505') throw new Error('업로드 실패: ' + rowErr.message);
            }
          } else if (error) {
            throw new Error(`업로드 실패: ${error.message}`);
          } else {
            inserted += batch.length;
          }
        }
      } catch (insErr) {
        // 삽입 실패 → 삭제했던 기존 데이터를 복원(전체 교체 모드에 한함)
        if (snapshot.length) {
          for (let i = 0; i < snapshot.length; i += BATCH) {
            await supabase.from(c.table).insert(snapshot.slice(i, i + BATCH));
          }
          throw new Error((insErr as Error).message + ' — 기존 데이터는 자동 복원했습니다.');
        }
        throw insErr;
      }
      const doneMsg = `✅ ${c.label} ${inserted}건 ${isAddNew ? '신규 추가' : '업로드'} 완료!`;
      setUploadBanner({ cls: 'bg-green-50 border-green-200 text-green-900', html: doneMsg });
      toast.success(doneMsg);
      setParsedData(null);
      setPreviewPage(0);
      await loadCurrentData();
    } catch (e) {
      setUploadBanner({ cls: 'bg-red-50 border-red-200 text-red-900', html: '❌ ' + (e as Error).message });
      toast.error((e as Error).message);
    } finally {
      setUploading(false);
    }
  };

  // ── 템플릿/DB 다운로드 ────────────────────────────────────────────────────

  const downloadTemplate = async () => {
    const c = UPLOAD_TYPES[selectedType];
    if (!c.templateHeaders || !c.sampleRow) return;
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();
    const sample = ['[예시]', ...c.sampleRow.slice(1)];
    const ws = XLSX.utils.aoa_to_sheet([c.templateHeaders, sample]);
    ws['!cols'] = c.templateHeaders.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, c.label);
    XLSX.writeFile(wb, `FS_MISO_템플릿_${c.label}.xlsx`);
  };

  const downloadCurrentDb = async () => {
    const c = UPLOAD_TYPES[selectedType];
    const cols = c.columns ?? c.previewColumns ?? [];
    if (!currentDbData.length) { toast('다운로드할 데이터가 없습니다.'); return; }
    const XLSX = await import('xlsx');
    const headers = cols.map((col) => col.label);
    const rows = currentDbData.map((row) => cols.map((col) => fmtCell(row[col.key])));
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    XLSX.utils.book_append_sheet(wb, ws, c.label);
    const today = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `FS_MISO_${c.label}_${today}.xlsx`);
  };

  // ── 편집 테이블 조작 ──────────────────────────────────────────────────────

  const updateCell = (rowIdx: number, key: string, value: string) => {
    setCurrentDbData((prev) => {
      const next = [...prev];
      next[rowIdx] = { ...next[rowIdx], [key]: value || null };
      return next;
    });
  };

  const addEditableRow = () => {
    const c = UPLOAD_TYPES[selectedType];
    const empty: Row = {};
    (c.columns ?? []).forEach((col) => { empty[col.key] = ''; });
    setCurrentDbData((prev) => [...prev, empty]);
  };

  const saveEditableData = async () => {
    const c = UPLOAD_TYPES[selectedType];
    const bu = getBusinessUnit();
    if (!bu) { toast.error('소속 정보가 없습니다.'); return; }
    const toSave = currentDbData.filter((row) => (c.columns ?? []).some((col) => row[col.key] && String(row[col.key]).trim()));
    if (toSave.length === 0) { toast('저장할 데이터가 없습니다.'); return; }
    try {
      const { data: userData, error: authErr } = await supabase.auth.getUser();
      if (authErr || !userData?.user) throw new Error('로그인 정보를 가져올 수 없습니다.');
      const now = new Date().toISOString();

      // 안전 교체(insert-first): 기존 데이터를 지우기 前에 새 데이터를 먼저 넣는다.
      // 과거엔 delete→insert 순서라 insert가 한 번이라도 실패하면 이미 지운 데이터가
      // 통째로 유실됐다(담당자 전멸 사고). 이제는 삽입이 성공한 뒤에만 기존 행을 지운다.
      const { data: existing, error: exErr } = await supabase.from(c.table).select('id').eq('business_unit', bu);
      if (exErr) throw new Error('기존 데이터 확인 실패: ' + exErr.message);
      const oldIds = (existing ?? []).map((r) => (r as Row).id).filter(Boolean) as string[];

      // 기존 행과 PK 충돌을 피하려 id는 버리고 새로 발급받는다(삽입-우선 순서를 위해 필수).
      const rows = toSave.map((row) => {
        const rest: Row = { ...row };
        delete rest.id;
        return { ...rest, business_unit: bu, uploaded_by: userData.user.id, uploaded_at: now };
      });
      const BATCH = 500;
      const newIds: string[] = [];
      for (let i = 0; i < rows.length; i += BATCH) {
        // defaultToNull:false — 편집 그리드의 새 행은 is_branch_manager 같은 숨은 컬럼이 없어서
        // 기존 행과 섞인 일괄 insert 시 null로 저장됨(기본값 false가 무시됨) → DB 기본값을 쓰게 강제
        const { data: ins, error } = await supabase.from(c.table).insert(rows.slice(i, i + BATCH), { defaultToNull: false }).select('id');
        if (error) {
          // 이번 저장에서 새로 넣은 행만 되돌리고 기존 데이터는 보존 → 유실 0
          if (newIds.length) await supabase.from(c.table).delete().in('id', newIds);
          throw new Error('저장 실패(기존 데이터는 보존됨): ' + error.message);
        }
        (ins ?? []).forEach((r) => { const id = (r as Row).id; if (id) newIds.push(id as string); });
      }
      // 삽입이 전부 성공한 뒤에만 기존 행 제거
      for (let i = 0; i < oldIds.length; i += BATCH) {
        const { error: delErr } = await supabase.from(c.table).delete().in('id', oldIds.slice(i, i + BATCH));
        if (delErr) throw new Error('새 데이터는 저장됐으나 기존 행 정리에 실패했습니다(중복 가능): ' + delErr.message);
      }
      toast.success(`✅ ${c.label} ${toSave.length}건 저장 완료!`);
      setPreviewPage(0);
      await loadCurrentData();
    } catch (e) {
      toast.error((e as Error).message);
      await loadCurrentData(); // 화면을 DB 실제 상태와 재동기화
    }
  };

  const deleteCheckedRows = async () => {
    if (checkedRows.size === 0) { toast('삭제할 행을 선택해주세요.'); return; }
    const c = UPLOAD_TYPES[selectedType];
    try {
      if (c.editable) {
        const indices = [...checkedRows].map(Number).sort((a, b) => b - a);
        const ids = indices.map((i) => currentDbData[i]?.id).filter(Boolean);
        if (ids.length > 0) {
          const { error } = await supabase.from(c.table).delete().in('id', ids);
          if (error) throw error;
        }
        setCurrentDbData((prev) => prev.filter((_, i) => !checkedRows.has(i)));
      } else {
        const { error } = await supabase.from(c.table).delete().in('id', [...checkedRows]);
        if (error) throw error;
        await loadCurrentData();
      }
      toast.success(`✅ ${checkedRows.size}건 삭제되었습니다.`);
      setDeleteMode(false);
      setCheckedRows(new Set());
    } catch (e) {
      toast.error('삭제 실패: ' + (e as Error).message);
    }
  };

  const toggleCheck = (key: string | number) => {
    setCheckedRows((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ── 공공인허가 조회 ───────────────────────────────────────────────────────

  const searchPublicLicense = async () => {
    const start = srchStart.replace(/-/g, '');
    const end = srchEnd.replace(/-/g, '');
    if (!start || !end) { toast('조회 기간을 선택해주세요.'); return; }
    const types = [...typeChips].join(',');
    const regions = [...activeRegions].join(',');
    if (!types) { toast('업종을 하나 이상 선택해주세요.'); return; }
    if (!regions) { toast('지역을 하나 이상 선택해주세요.'); return; }

    setSearching(true);
    setSrchResults([]);
    setSrchSelected(new Set());
    try {
      const params = new URLSearchParams({ types, regions, startDate: start, endDate: end });
      const res = await fetch(`/api/public-license?${params}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || '조회 실패');
      const map = managerMapRef.current;
      const results: SearchItem[] = (data.items as SearchItem[]).map((item) => {
        const key = normalizeRegion1(item.address1) + '|' + item.address2;
        const manager = (item.address3 ? map[key + '|' + item.address3] : null)
          || map[key] || map['~' + (item.address2 ?? '')] || '';
        return { ...item, manager };
      });
      setSrchResults(results);
      // 0건도 반드시 알린다 — 게이트웨이 개편(2026-08) 때 "성공인데 0건"이 6일간 조용히 지나갔다.
      // 모바일 추출엔 빈 상태 UI가 있지만 이 화면은 결과 영역이 접혀 있어 무반응처럼 보인다.
      if (results.length === 0 && !data.failedRegions?.length) {
        toast('조회 결과가 없습니다.');
      }
      if (data.failedRegions?.length) {
        toast.warning(`일부 지역 조회 실패: ${data.failedRegions.join(', ')}`);
      }
      // 2,000건 상한으로 잘린 조회 — 이 화면은 결과를 DB에 그대로 올리므로 반드시 알려야 한다
      // (모바일 인허가 추출엔 있고 여기만 빠져 있어, 누락된 데이터가 조용히 업로드됐다)
      if (data.truncated?.length) {
        const msg = (data.truncated as Array<{ sido: string; total: number }>)
          .map((t) => `${t.sido}(${t.total.toLocaleString()}건)`)
          .join(', ');
        toast.warning(`데이터 누락 가능성: ${msg} — 2,000건 상한 초과. 조회 기간을 나눠서 재조회하세요.`, { duration: 8000 });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSearching(false);
    }
  };

  const downloadSrchResults = async () => {
    if (!srchSelected.size) return;
    const XLSX = await import('xlsx');
    const selected = [...srchSelected].map((i) => srchResults[i]);
    const headers = ['NO', '영업 허가일', '사업장명', '거래여부(기입예정)', '업태구분명', '평형', '도로명전체주소', '주소1', '주소2', '주소3', '순위', '담당자', '앱시트등록일', '위도', '경도', '사용우유'];
    const rows = selected.map((item, idx) => [
      idx + 1, item.permit_date || '', item.business_name || '', '인허가', item.business_type || '',
      item.area || '', item.road_address || '', item.address1 || '', item.address2 || '', item.address3 || '',
      '1', item.manager || '', '', item.lat || '', item.lng || '', '',
    ]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws['!cols'] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, ws, '인허가데이터');
    XLSX.writeFile(wb, `인허가_공공데이터_${srchStart}_${srchEnd}.xlsx`);
    toast.success(`✅ ${selected.length}건 다운로드 완료`);
  };

  // ── 렌더 ──────────────────────────────────────────────────────────────────

  const dbCols = cfg.editable ? (cfg.columns ?? cfg.previewColumns ?? []) : (cfg.previewColumns ?? []);
  const allChecked = currentDbData.length > 0 && (cfg.editable
    ? currentDbData.every((_, i) => checkedRows.has(i))
    : currentDbData.every((r) => checkedRows.has(r.id as string)));
  const totalPages = Math.ceil(dbTotal / PREVIEW_PAGE_SIZE);

  // 사업부(본부 조회 계정)는 지점 데이터를 소유하지 않는다 — 데이터 관리는 지점·관리자 전용
  if (!authLoading && !isAdmin && metadata?.business_unit === '사업부') {
    return (
      <div className="min-h-full bg-[#f6f7f9]">
        <PageHeader />
        <div className="mx-auto max-w-[1500px] px-6 py-16 text-center text-sm text-[#64748b]">
          사업부 계정은 조회 전용이라 데이터 관리를 사용할 수 없습니다.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full bg-[#f6f7f9]">
      <PageHeader
        actions={isAdmin ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-700"><Crown size={13} />관리자</span>
            <select value={adminTargetBU} onChange={(e) => handleAdminBranchChange(e.target.value)} className="rounded-lg border border-[#d6dbe3] px-2.5 py-1.5 text-xs text-[#334155] outline-none">
              <option value="">조회할 지점 선택</option>
              {BRANCH_UNITS.map((bu) => <option key={bu} value={bu}>{bu}</option>)}
            </select>
          </div>
        ) : undefined}
      />

      <div className="mx-auto max-w-[1500px] px-4 pb-16 pt-5 md:px-6">

        {/* 유형 탭 — 모바일은 2열 균등 그리드 (불규칙 줄바꿈 방지) */}
        <div className="mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-[#eef1f5] p-1 max-md:grid max-md:w-full max-md:grid-cols-2 max-md:[&>*]:justify-center">
          {([['licenses', FileText, '인허가 데이터'], ['accounts', Store, '주요거래처'], ['managers', Users, '담당자관리'], ...(isAdmin ? [['recipes', BookOpen, '레시피 데이터']] : [])] as [string, typeof FileText, string][]).map(([t, Icon, label]) => (
            <button key={t} onClick={() => selectType(t)} className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${selectedType === t ? 'bg-white text-[#0f172a] shadow-sm' : 'text-[#64748b] hover:text-[#0f172a]'}`}>
              <Icon size={15} />{label}
            </button>
          ))}
        </div>

        {/* 상단: 공공조회(인허가) + 엑셀 업로드 */}
        <div className={`mb-4 grid grid-cols-1 gap-4 ${selectedType === 'licenses' ? 'lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]' : ''}`}>

          {/* 공공인허가 조회 (인허가 탭만) */}
          {selectedType === 'licenses' && (
            <section className="rounded-2xl border border-[#e8ebf0] bg-white p-4 md:p-5">
              <div className="mb-3 text-[10px] uppercase tracking-wider text-[#94a3b8]">공공인허가 데이터 조회 · data.go.kr</div>
              <div className="mb-3 flex flex-wrap items-end gap-2.5">
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-[11px] text-[#94a3b8]">시작일</label>
                  <input type="date" value={srchStart} onChange={(e) => setSrchStart(e.target.value)} className="rounded-lg border border-[#e2e8f0] px-2.5 py-2 text-sm outline-none focus:border-[#2563eb]" />
                </div>
                <div className="flex flex-1 flex-col gap-1">
                  <label className="text-[11px] text-[#94a3b8]">종료일</label>
                  <input type="date" value={srchEnd} onChange={(e) => setSrchEnd(e.target.value)} className="rounded-lg border border-[#e2e8f0] px-2.5 py-2 text-sm outline-none focus:border-[#2563eb]" />
                </div>
                <button onClick={searchPublicLicense} disabled={searching} className="inline-flex items-center gap-1.5 rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4fd0] disabled:bg-gray-300">
                  <Search size={15} />{searching ? '조회 중' : '조회'}
                </button>
              </div>

              <div className="mb-1.5 text-[11px] text-[#94a3b8]">업종</div>
              <div className="mb-3 flex flex-wrap gap-1.5">
                {([['general_restaurants', '일반음식점'], ['rest_cafes', '휴게음식점'], ['bakeries', '제과점영업']] as [string, string][]).map(([code, label]) => (
                  <button key={code} onClick={() => setTypeChips((prev) => { const n = new Set(prev); n.has(code) ? n.delete(code) : n.add(code); return n; })}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${typeChips.has(code) ? 'bg-[#2563eb] text-white' : 'bg-[#f1f5f9] text-[#64748b] hover:text-[#2563eb]'}`}>
                    {label}
                  </button>
                ))}
              </div>

              <div className="mb-1.5 text-[11px] text-[#94a3b8]">지역</div>
              <div className="flex flex-wrap gap-1.5">
                {regionChips.length === 0 ? (
                  <span className="text-xs text-[#94a3b8]">{regionMsg}</span>
                ) : regionChips.map((chip) => (
                  <button key={chip.filterRegion + chip.label} onClick={() => setActiveRegions((prev) => { const n = new Set(prev); n.has(chip.filterRegion) ? n.delete(chip.filterRegion) : n.add(chip.filterRegion); return n; })}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition ${activeRegions.has(chip.filterRegion) ? 'bg-[#2563eb] text-white' : 'bg-[#f1f5f9] text-[#64748b] hover:text-[#2563eb]'}`}>
                    {chip.label}
                  </button>
                ))}
              </div>

              {/* 검색 결과 */}
              {srchResults.length > 0 && (
                <div className="mt-4">
                  <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs font-medium text-[#475569]">총 {srchResults.length}건</span>
                      {srchSelected.size > 0 && <span className="rounded-full bg-[#e6f1fb] px-2.5 py-1 text-xs font-medium text-[#185fa5]">{srchSelected.size}건 선택</span>}
                    </div>
                    <button onClick={downloadSrchResults} disabled={srchSelected.size === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d6dbe3] px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-gray-50 disabled:opacity-50">
                      <Download size={14} />선택 다운로드 ({srchSelected.size})
                    </button>
                  </div>
                  <div className="max-h-[360px] overflow-auto rounded-lg border border-[#e8ebf0]">
                    <table className="w-max min-w-full text-xs">
                      <thead className="sticky top-0 bg-[#f8fafc]">
                        <tr>
                          <th className="w-9 px-2 py-2"><input type="checkbox" checked={srchSelected.size === srchResults.length} onChange={(e) => setSrchSelected(e.target.checked ? new Set(srchResults.map((_, i) => i)) : new Set())} /></th>
                          {['영업 허가일', '사업장명', '업태구분명', '평형', '도로명전체주소', '담당자'].map((h) => <th key={h} className="whitespace-nowrap px-3 py-2 text-left font-medium text-[#64748b]">{h}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {srchResults.map((item, i) => (
                          <tr key={i} className="border-b border-[#f1f5f9]">
                            <td className="px-2 py-2 text-center"><input type="checkbox" checked={srchSelected.has(i)} onChange={() => setSrchSelected((prev) => { const n = new Set(prev); n.has(i) ? n.delete(i) : n.add(i); return n; })} /></td>
                            <td className="whitespace-nowrap px-3 py-2">{item.permit_date || '-'}</td>
                            <td className="whitespace-nowrap px-3 py-2">{item.business_name}</td>
                            <td className="whitespace-nowrap px-3 py-2">{item.business_type}</td>
                            <td className="whitespace-nowrap px-3 py-2">{item.area || '-'}</td>
                            <td className="whitespace-nowrap px-3 py-2">{item.road_address || '-'}</td>
                            <td className="whitespace-nowrap px-3 py-2">{item.manager || <span className="text-amber-600">미지정</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </section>
          )}

          {/* 엑셀 업로드 */}
          {!cfg.noBusinessUnit && (
            <section className="rounded-2xl border border-[#e8ebf0] bg-white p-4 md:p-5">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#94a3b8]">엑셀 업로드 · 대량 추가</span>
                <button onClick={downloadTemplate} className="inline-flex items-center gap-1 text-xs font-medium text-[#2563eb] hover:underline"><Download size={13} />템플릿</button>
              </div>
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); }}
                className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm transition ${dragOver ? 'border-[#2563eb] bg-[#f5f9ff] text-[#2563eb]' : fileName ? 'border-[#34c759] bg-[#f0fdf4] text-[#0f172a]' : 'border-[#cbd5e1] bg-[#fbfcfe] text-[#64748b] hover:border-[#2563eb]'}`}
              >
                <UploadCloud size={26} className={dragOver ? 'text-[#2563eb]' : 'text-[#94a3b8]'} />
                <div>{fileName ? <strong className="font-medium">{fileName}</strong> : '파일을 끌어다 놓거나 클릭'}</div>
                <div className="text-[11px] text-[#b6c0cc]">.xlsx · .xls 지원</div>
              </div>
              <input ref={fileInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => { if (e.target.files?.[0]) processFile(e.target.files[0]); }} />
            </section>
          )}
        </div>

        {/* 데이터 미리보기 + 업로드 확인 */}
        {parsedData && parsedData.length > 0 && (
          <section className="mb-4 rounded-2xl border border-[#e8ebf0] bg-white p-4 md:p-5">
            <div className="mb-3 text-[10px] uppercase tracking-wider text-[#94a3b8]">데이터 미리보기 · 상위 5행 · 총 {parsedData.length}건 인식</div>
            <div className="overflow-x-auto rounded-lg border border-[#e8ebf0]">
              <table className="w-max min-w-full text-xs">
                <thead className="bg-[#f8fafc]">
                  <tr>{Object.keys(parsedData[0]).map((k) => <th key={k} className="whitespace-nowrap px-3 py-2 text-left font-medium text-[#64748b]">{k}</th>)}</tr>
                </thead>
                <tbody>
                  {parsedData.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-b border-[#f1f5f9]">
                      {Object.keys(parsedData[0]).map((k) => <td key={k} className="max-w-[160px] truncate px-3 py-2" title={fmtCell(row[k])}>{fmtCell(row[k])}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {uploadBanner && <div className={`mt-3 rounded-lg border px-4 py-3 text-xs ${uploadBanner.cls}`}>{uploadBanner.html}</div>}
            <button onClick={confirmUpload} disabled={uploadDisabled || uploading} className="mt-3 w-full rounded-lg bg-[#2563eb] py-3 text-sm font-medium text-white hover:bg-[#1d4fd0] disabled:bg-gray-300">
              {uploading ? '업로드 중...' : uploadDisabled ? '업로드 불가 — 값 오류' : cfg.mode === 'add_new_only' ? `업로드 확인 (최대 ${parsedData.length}건 추가)` : `업로드 확인 (${parsedData.length}건 교체)`}
            </button>
          </section>
        )}
        {replaceConfirm && (() => {
          const sharpDrop = replaceConfirm.existing > 0 && replaceConfirm.incoming < replaceConfirm.existing * 0.5;
          return (
            <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/45 p-4" onClick={() => setReplaceConfirm(null)}>
              <div className="w-full max-w-[440px] overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-4">
                  <AlertTriangle size={18} className="text-red-500" />
                  <span className="text-sm font-semibold text-[#0f172a]">{replaceConfirm.label} 전체 교체</span>
                </div>
                <div className="space-y-3 px-5 py-4 text-sm leading-relaxed text-[#475569]">
                  <p>
                    현재 <b className="text-[#0f172a]">{replaceConfirm.existing.toLocaleString()}건</b>을 모두 삭제하고 파일 <b className="text-[#0f172a]">{replaceConfirm.incoming.toLocaleString()}건</b>으로 교체합니다. <span className="font-medium text-red-600">되돌릴 수 없습니다.</span>
                  </p>
                  {sharpDrop && (
                    <div className="rounded-lg bg-red-50 px-3 py-2.5 text-[13px] text-red-700">
                      <div className="mb-1 font-semibold">⚠️ 기존보다 {Math.round((1 - replaceConfirm.incoming / replaceConfirm.existing) * 100)}% 감소</div>
                      파일이 잘못되었거나 일부만 업로드된 게 아닌지 확인하세요.
                      <label className="mt-2 flex cursor-pointer items-center gap-2 font-medium">
                        <input type="checkbox" checked={dropAck} onChange={(e) => setDropAck(e.target.checked)} className="h-3.5 w-3.5" />
                        데이터 감소를 확인했습니다
                      </label>
                    </div>
                  )}
                </div>
                <div className="flex gap-2 border-t border-gray-100 px-5 py-3.5">
                  <button onClick={() => setReplaceConfirm(null)} className="flex-1 rounded-lg bg-gray-100 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-200">취소</button>
                  <button onClick={() => { setReplaceConfirm(null); void runUpload(); }} disabled={sharpDrop && !dropAck} className="flex-1 rounded-lg bg-red-500 py-2.5 text-sm font-medium text-white hover:bg-red-600 disabled:bg-gray-300">교체 실행</button>
                </div>
              </div>
            </div>
          );
        })()}
        {uploadBanner && (!parsedData || parsedData.length === 0) && (
          <div className={`mb-4 rounded-lg border px-4 py-3 text-xs ${uploadBanner.cls}`}>{uploadBanner.html}</div>
        )}

        {/* DB 현황 — 전체 너비 */}
        <section className="rounded-2xl border border-[#e8ebf0] bg-white">
          <div className="flex items-center justify-between border-b border-[#eef1f5] px-5 py-3.5">
            <span className="text-[10px] uppercase tracking-wider text-[#94a3b8]">현재 DB 현황 · {dbLoading ? '…' : `${dbTotal}건`}</span>
            <button onClick={() => loadCurrentData()} title="새로고침" className="text-[#94a3b8] hover:text-[#475569]"><RefreshCw size={15} /></button>
          </div>
          <div className="p-4 md:p-5">
              {dbLoading ? (
                <div className="py-7 text-center text-sm text-gray-500">데이터 로딩 중...</div>
              ) : dbError ? (
                <div className="py-7 text-center text-sm text-gray-400">{dbError}</div>
              ) : currentDbData.length === 0 ? (
                <div className="py-7 text-center text-sm text-gray-400">아직 업로드된 데이터가 없습니다.</div>
              ) : (
                <>
                  <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-[#f1f5f9] px-2.5 py-1 text-xs font-medium text-[#475569]">{dbTotal}건</span>
                    <div className="ml-auto flex flex-wrap items-center gap-1.5">
                      {cfg.table !== 'recipes' && (deleteMode ? (
                        <>
                          <button onClick={deleteCheckedRows} className="inline-flex items-center gap-1.5 rounded-lg bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600"><Trash2 size={14} />삭제 확인 ({checkedRows.size})</button>
                          <button onClick={() => { setDeleteMode(false); setCheckedRows(new Set()); }} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-200"><X size={14} />취소</button>
                        </>
                      ) : (
                        <>
                          {cfg.editable && <button onClick={saveEditableData} className="rounded-lg bg-[#2563eb] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#1d4fd0]">변경사항 저장</button>}
                          <button onClick={() => { setDeleteMode(true); setCheckedRows(new Set()); }} className="inline-flex items-center gap-1.5 rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"><Trash2 size={14} />선택 행 삭제</button>
                          <button onClick={downloadCurrentDb} className="inline-flex items-center gap-1.5 rounded-lg border border-[#d6dbe3] px-3 py-1.5 text-xs font-medium text-[#334155] hover:bg-gray-50"><Download size={14} />DB 다운로드</button>
                        </>
                      ))}
                    </div>
                  </div>

                  <div className="max-h-[400px] overflow-auto rounded-md border border-gray-200">
                    <table className="w-max min-w-full text-xs">
                      <thead className="sticky top-0 bg-gray-50">
                        <tr>
                          {deleteMode && (
                            <th className="w-9 px-2 py-2">
                              <input type="checkbox" checked={allChecked} onChange={(e) => {
                                if (e.target.checked) setCheckedRows(new Set<string | number>(cfg.editable ? currentDbData.map((_, i) => i) : currentDbData.map((r) => r.id as string)));
                                else setCheckedRows(new Set());
                              }} />
                            </th>
                          )}
                          {dbCols.map((c) => <th key={c.key} className="whitespace-nowrap px-3 py-2 text-left font-semibold">{c.label}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {currentDbData.map((row, ri) => {
                          const rowKey: string | number = cfg.editable ? ri : (row.id as string);
                          return (
                            <tr key={ri} className={`border-b border-gray-50 ${checkedRows.has(rowKey) ? 'bg-red-50' : ''}`}>
                              {deleteMode && <td className="px-2 py-1 text-center"><input type="checkbox" checked={checkedRows.has(rowKey)} onChange={() => toggleCheck(rowKey)} /></td>}
                              {dbCols.map((c) => (
                                <td key={c.key} className="px-1.5 py-1">
                                  {cfg.editable && !deleteMode ? (
                                    <input value={fmtCell(row[c.key])} onChange={(e) => updateCell(ri, c.key, e.target.value)} className="w-full rounded bg-transparent px-1 py-0.5 outline-none focus:bg-blue-50" />
                                  ) : (
                                    <span className="block max-w-[200px] truncate px-1" title={fmtCell(row[c.key])}>{fmtCell(row[c.key])}</span>
                                  )}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {cfg.editable && !deleteMode && (
                    <button onClick={addEditableRow} className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#cbd5e1] py-2.5 text-sm font-medium text-[#64748b] hover:border-[#2563eb] hover:text-[#2563eb]"><Plus size={15} />행 추가</button>
                  )}

                  {!cfg.editable && totalPages > 1 && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-[#64748b]">
                      <button onClick={() => setPreviewPage((p) => Math.max(0, p - 1))} disabled={previewPage === 0} className="inline-flex items-center gap-1 rounded-lg border border-[#d6dbe3] px-2.5 py-1 disabled:opacity-40"><ChevronLeft size={13} />이전</button>
                      <span className="tabular-nums">{previewPage + 1} / {totalPages}페이지 · 총 {dbTotal}건</span>
                      <button onClick={() => setPreviewPage((p) => Math.min(totalPages - 1, p + 1))} disabled={previewPage >= totalPages - 1} className="inline-flex items-center gap-1 rounded-lg border border-[#d6dbe3] px-2.5 py-1 disabled:opacity-40">다음<ChevronRight size={13} /></button>
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
      </div>
    </div>
  );
}
