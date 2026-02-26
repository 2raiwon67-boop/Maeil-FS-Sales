-- ============================================================
-- FS MISO — 멀티테넌트 테이블 생성 + RLS 설정
-- Supabase SQL Editor에서 전체 복붙 후 실행
-- ※ 이미 실행한 경우: 하단 ALTER TABLE 섹션만 실행하면 됩니다
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. licenses (인허가 데이터)
--    Google Sheets '인허가데이터' 시트 헤더와 1:1 대응
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,          -- 지점 구분 (예: 경기북부FS지점)

    permit_date     DATE,                   -- 영업 허가일   (B열)
    business_name   TEXT NOT NULL,          -- 사업장명      (C열)
    trade_status    TEXT,                   -- 거래여부(기입예정) (D열)
    business_type   TEXT,                   -- 업태구분명    (E열)
    area            TEXT,                   -- 평형          (F열)
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
    ai_tags         TEXT,                   -- AI 핵심태그   (별도 보관용)

    uploaded_by     UUID REFERENCES auth.users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "licenses_select_same_unit" ON licenses
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "licenses_insert_own_unit" ON licenses
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "licenses_update_same_unit" ON licenses
    FOR UPDATE USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "licenses_delete_own" ON licenses
    FOR DELETE USING (
        uploaded_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 2. accounts (주요거래처)
--    Google Sheets '주요거래처' 시트 헤더와 1:1 대응
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,          -- 지점 구분

    seq_no          TEXT,                   -- NO            (A열)
    store_code      TEXT,                   -- 사업장코드명  (E열)
    customer_level  TEXT,                   -- 고객레벨2     (F열)
    account_id      TEXT,                   -- 거래처ID      (G열)
    business_name   TEXT NOT NULL,          -- 거래처명      (H열)
    trade_status    TEXT,                   -- 거래상태      (I열)
    manager_name    TEXT,                   -- 담당자명      (K열)
    address         TEXT,                   -- 주소          (L열)
    -- 무시 컬럼: 사업부(B), 사업장(C), 지점(D), 주요거래처 여부(J), 도/광역시(M), 시/군/구(N), 면/동(O)

    uploaded_by     UUID REFERENCES auth.users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "accounts_select_same_unit" ON accounts
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "accounts_insert_own_unit" ON accounts
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "accounts_update_same_unit" ON accounts
    FOR UPDATE USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "accounts_delete_own" ON accounts
    FOR DELETE USING (
        uploaded_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 3. visit_logs (방문일지)
--    Google Sheets '방문일지' 시트 헤더와 1:1 대응
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,          -- 지점 구분

    seq_no          TEXT,                   -- NO                  (A열)
    store_code      TEXT,                   -- 사업장코드           (E열)
    visit_date      DATE,                   -- 작성일               (F열)
    manager         TEXT,                   -- 작성자               (G열)
    dealer_code     TEXT,                   -- 방문처(대리점 코드)  (H열)
    dealer_name     TEXT,                   -- 방문처(대리점)       (I열)
    account_code    TEXT,                   -- 방문처(거래처 코드)  (J열)
    business_name   TEXT,                   -- 방문처(거래처)       (K열)
    content         TEXT,                   -- 내용                 (L열)
    key_issue       TEXT,                   -- AI_핵심태그          (M열, 별도 보관)
    trade_status    TEXT,                   -- 거래상태 (파생값, 필요 시 사용)
    -- 무시 컬럼: 사업부(B), 사업장(C), 지점(D)

    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE visit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "visit_logs_select_same_unit" ON visit_logs
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "visit_logs_insert_own_unit" ON visit_logs
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "visit_logs_update_own" ON visit_logs
    FOR UPDATE USING (
        created_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "visit_logs_delete_own" ON visit_logs
    FOR DELETE USING (
        created_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 4. managers (담당자관리)
--    Google Sheets '담당자관리' 시트 헤더와 1:1 대응
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit     TEXT NOT NULL,        -- 지점 구분

    region            TEXT NOT NULL,        -- 지역   (A열)
    manager_name      TEXT NOT NULL,        -- 담당자  (B열) ※ 시트의 실제 헤더는 '담당자'
    email             TEXT,                 -- 이메일  (C열)
    is_branch_manager BOOLEAN DEFAULT false,-- 지점장 여부 (upload 시 Y/N → boolean 변환)

    uploaded_by       UUID REFERENCES auth.users(id),
    uploaded_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE managers ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "managers_select_same_unit" ON managers
    FOR SELECT USING (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "managers_insert_own_unit" ON managers
    FOR INSERT WITH CHECK (
        business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

CREATE POLICY IF NOT EXISTS "managers_delete_own" ON managers
    FOR DELETE USING (
        uploaded_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- ※ 이미 테이블이 존재하는 경우 — 아래 ALTER 만 실행
--   (ADD COLUMN IF NOT EXISTS 는 중복 실행해도 안전)
-- ─────────────────────────────────────────────────────────────
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS seq_no         TEXT,
    ADD COLUMN IF NOT EXISTS store_code     TEXT,
    ADD COLUMN IF NOT EXISTS customer_level TEXT,
    ADD COLUMN IF NOT EXISTS account_id     TEXT,
    ADD COLUMN IF NOT EXISTS manager_name   TEXT;

ALTER TABLE visit_logs
    ADD COLUMN IF NOT EXISTS seq_no       TEXT,
    ADD COLUMN IF NOT EXISTS store_code   TEXT,
    ADD COLUMN IF NOT EXISTS dealer_code  TEXT,
    ADD COLUMN IF NOT EXISTS dealer_name  TEXT,
    ADD COLUMN IF NOT EXISTS account_code TEXT;


-- ─────────────────────────────────────────────────────────────
-- 완료 확인
-- ─────────────────────────────────────────────────────────────
-- SELECT table_name, column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name IN ('licenses','accounts','visit_logs','managers')
-- ORDER BY table_name, ordinal_position;
