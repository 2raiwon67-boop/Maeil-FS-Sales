export const BUSINESS_UNITS = [
  '수도권지역사업부',
  '경기북부FS/특수지점',
  '서울FS/특수지점',
  '경기남부FS/특수지점',
] as const;

export type BusinessUnit = (typeof BUSINESS_UNITS)[number];

export interface License {
  id: number;
  business_name: string;
  address: string;
  business_type?: string;
  license_date?: string;
  status?: string;
  region1?: string;
  region2?: string;
  lat?: number;
  lng?: number;
  business_unit?: string;
}

export interface Account {
  id: number;
  account_id: string;
  account_name: string;
  address?: string;
  milk_company?: string;
  trade_status?: string;
  rank?: string;
  region?: string;
  manager?: string;
  business_unit?: string;
  lat?: number;
  lng?: number;
}

export interface VisitLog {
  id: number;
  business_unit: string;
  visit_date: string;
  manager: string;
  business_name: string;
  visit_type?: string;
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

export interface DeviceInfo {
  id: string;
  type: 'mobile' | 'pc';
  name: string;
  registered_at: string;
  last_seen: string;
}

export interface UserMetadata {
  full_name?: string;
  business_unit?: string;
  approved?: boolean;
  registered_devices?: DeviceInfo[];
}
