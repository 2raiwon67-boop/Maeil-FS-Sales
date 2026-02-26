-- ============================================================
-- FS MISO — STEP 1: 멀티테넌트 테이블 생성 + RLS 설정
-- Supabase SQL Editor에서 전체 복붙 후 실행
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. licenses (인허가 데이터)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,          -- 지점 구분 (예: 경기북부)

    -- 인허가 데이터 컬럼 (Google Sheets 인허가데이터 시트와 1:1 대응)
    permit_date     DATE,                   -- 영업 허가일   (B열)
    business_name   TEXT NOT NULL,          -- 사업장명      (C열)
    trade_status    TEXT,                   -- 거래여부      (D열)
    business_type   TEXT,                   -- 업태구분명    (E열)
    area            TEXT,                   -- 평형          (F열) TEXT: "30평" 형태 가능
    road_address    TEXT,                   -- 도로명전체주소 (G열)
    address1        TEXT,                   -- 주소1         (H열)
    address2        TEXT,                   -- 주소2         (I열) — 지역 분류 기준
    address3        TEXT,                   -- 주소3         (J열)
    priority        TEXT,                   -- 순위          (K열)
    manager         TEXT,                   -- 담당자        (L열)
    appsheet_date   DATE,                   -- 앱시트등록일  (M열)
    lat             NUMERIC,                -- 위도          (N열)
    lng             NUMERIC,                -- 경도          (O열)
    milk_type       TEXT,                   -- 사용우유      (P열)
    ai_tags         TEXT,                   -- AI 핵심태그   (별도 컬럼)

    -- 업로드 메타데이터
    uploaded_by     UUID REFERENCES auth.users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

-- 같은 지점만 조회
CREATE POLICY "licenses_select_same_unit" ON licenses
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

-- 같은 지점으로만 INSERT
CREATE POLICY "licenses_insert_own_unit" ON licenses
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

-- 거래상태 업데이트: 같은 지점 사용자 전체 허용
CREATE POLICY "licenses_update_same_unit" ON licenses
    FOR UPDATE USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

-- 삭제(재업로드 초기화): 업로더 본인 + 같은 지점
CREATE POLICY "licenses_delete_own" ON licenses
    FOR DELETE USING (
        uploaded_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 2. accounts (주요거래처)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,

    business_name   TEXT NOT NULL,          -- 거래처명
    trade_status    TEXT,                   -- 거래상태
    address         TEXT,                   -- 주소

    uploaded_by     UUID REFERENCES auth.users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "accounts_select_same_unit" ON accounts
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY "accounts_insert_own_unit" ON accounts
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY "accounts_update_same_unit" ON accounts
    FOR UPDATE USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY "accounts_delete_own" ON accounts
    FOR DELETE USING (
        uploaded_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 3. visit_logs (방문일지)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,

    visit_date      DATE,                   -- 작성일
    business_name   TEXT,                   -- 방문처(거래처)
    manager         TEXT,                   -- 작성자
    key_issue       TEXT,                   -- 주요이슈
    content         TEXT,                   -- 내용
    trade_status    TEXT,                   -- 거래상태

    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE visit_logs ENABLE ROW LEVEL SECURITY;

-- 같은 지점 전체 조회
CREATE POLICY "visit_logs_select_same_unit" ON visit_logs
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

-- 같은 지점으로만 INSERT
CREATE POLICY "visit_logs_insert_own_unit" ON visit_logs
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

-- 수정: 본인 작성분만
CREATE POLICY "visit_logs_update_own" ON visit_logs
    FOR UPDATE USING (
        created_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

-- 삭제: 본인 작성분만
CREATE POLICY "visit_logs_delete_own" ON visit_logs
    FOR DELETE USING (
        created_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 4. managers (담당자관리)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managers (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit       TEXT NOT NULL,

    region              TEXT NOT NULL,      -- 지역
    manager_name        TEXT NOT NULL,      -- 담당자명
    email               TEXT,               -- 이메일
    is_branch_manager   BOOLEAN DEFAULT false,  -- 지점장 여부 (이메일 전체 수신)

    uploaded_by         UUID REFERENCES auth.users(id),
    uploaded_at         TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers_select_same_unit" ON managers
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY "managers_insert_own_unit" ON managers
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY "managers_delete_own" ON managers
    FOR DELETE USING (
        uploaded_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 완료 확인 (실행 후 아래 쿼리로 테이블 생성 여부 확인)
-- ─────────────────────────────────────────────────────────────
-- SELECT table_name FROM information_schema.tables
-- WHERE table_schema = 'public'
-- AND table_name IN ('licenses', 'accounts', 'visit_logs', 'managers');
