export const BUSINESS_UNITS = [
  '수도권지역사업부',
  '경기북부FS/특수지점',
  '서울FS/특수지점',
  '경기남부FS/특수지점',
  '강원지점',
] as const;

export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

// licenses 테이블 실제 스키마 (Supabase). 좌표(lat/lng)는 WGS84, 없는 행은 클라이언트 지오코딩.
export interface License {
  id: string; // uuid
  business_unit?: string;
  permit_date?: string; // 영업 허가일 (date)
  business_name: string; // 사업장명
  trade_status?: string; // 거래여부: 거래/미거래/인허가/공사중/DROP
  business_type?: string; // 업태구분명
  area?: string; // 평형
  road_address?: string; // 도로명전체주소
  address1?: string; // 주소1 (시도)
  address2?: string; // 주소2 (시군구)
  address3?: string; // 주소3
  priority?: string; // 순위 (1/2)
  manager?: string; // 담당자
  appsheet_date?: string;
  lat?: number | string;
  lng?: number | string;
  milk_type?: string; // 사용우유
  expected_revenue?: number | null; // 예상매출(월·천원) — 마커 상세에서 입력
  ai_tags?: string;
  open_detected_at?: string;
}

// accounts 테이블 실제 스키마. 좌표 컬럼 없음 → 주소 기반 지오코딩.
export interface Account {
  id: string; // uuid
  business_unit?: string;
  seq_no?: string;
  store_code?: string;
  customer_level?: string; // 고객등급
  account_id?: string;
  business_name: string; // 거래처명
  trade_status?: string; // 거래상태: 거래/미거래
  manager_name?: string; // 담당자명
  address?: string;
  // 클라이언트 지오코딩으로 채워지는 좌표 (DB에는 없음)
  lat?: number;
  lng?: number;
}

export interface VisitLog {
  id?: number;
  business_unit?: string | null;
  visit_date: string;
  manager?: string;
  business_name: string;
  visit_type?: string;
  // 구조화 결과(2026-06 재설계): 코칭·학습의 토대
  outcome?: string;          // 성공 | 보류 | 거절 | 일반
  reject_reason?: string;    // 가격 | 시기 | 기존거래 | needs부족 | 기타
  proposed_products?: string;
  next_action?: string;
  content?: string;
  created_at?: string;
}

export interface Manager {
  id: number;
  region1: string;
  region2: string;
  manager_name: string;
  is_branch_manager?: boolean;
}

export interface UserMetadata {
  full_name?: string;
  business_unit?: string;
  approved?: boolean;
}
