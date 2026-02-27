-- ============================================================
-- FS MISO — 멀티테넌트 테이블 생성 + RLS 설정
-- Supabase SQL Editor에서 전체 복붙 후 실행 (재실행 안전)
-- ============================================================


-- ─────────────────────────────────────────────────────────────
-- 1. licenses (인허가 데이터)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS licenses (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,
    permit_date     DATE,
    business_name   TEXT NOT NULL,
    trade_status    TEXT,
    business_type   TEXT,
    area            TEXT,
    road_address    TEXT,
    address1        TEXT,
    address2        TEXT,
    address3        TEXT,
    priority        TEXT,
    manager         TEXT,
    appsheet_date   DATE,
    lat             NUMERIC,
    lng             NUMERIC,
    milk_type       TEXT,
    ai_tags         TEXT,
    uploaded_by     UUID REFERENCES auth.users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE licenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "licenses_select_same_unit" ON licenses;
CREATE POLICY "licenses_select_same_unit" ON licenses
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "licenses_insert_own_unit" ON licenses;
CREATE POLICY "licenses_insert_own_unit" ON licenses
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "licenses_update_same_unit" ON licenses;
CREATE POLICY "licenses_update_same_unit" ON licenses
    FOR UPDATE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "licenses_delete_own" ON licenses;
CREATE POLICY "licenses_delete_own" ON licenses
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));


-- ─────────────────────────────────────────────────────────────
-- 2. accounts (주요거래처)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,
    seq_no          TEXT,
    store_code      TEXT,
    customer_level  TEXT,
    account_id      TEXT,
    business_name   TEXT NOT NULL,
    trade_status    TEXT,
    manager_name    TEXT,
    address         TEXT,
    uploaded_by     UUID REFERENCES auth.users(id),
    uploaded_at     TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounts_select_same_unit" ON accounts;
CREATE POLICY "accounts_select_same_unit" ON accounts
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "accounts_insert_own_unit" ON accounts;
CREATE POLICY "accounts_insert_own_unit" ON accounts
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "accounts_update_same_unit" ON accounts;
CREATE POLICY "accounts_update_same_unit" ON accounts
    FOR UPDATE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "accounts_delete_own" ON accounts;
CREATE POLICY "accounts_delete_own" ON accounts
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));


-- ─────────────────────────────────────────────────────────────
-- 3. visit_logs (방문일지)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit   TEXT NOT NULL,
    seq_no          TEXT,
    store_code      TEXT,
    visit_date      DATE,
    manager         TEXT,
    dealer_code     TEXT,
    dealer_name     TEXT,
    account_code    TEXT,
    business_name   TEXT,
    content         TEXT,
    key_issue       TEXT,
    trade_status    TEXT,
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE visit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_logs_select_same_unit" ON visit_logs;
CREATE POLICY "visit_logs_select_same_unit" ON visit_logs
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "visit_logs_insert_own_unit" ON visit_logs;
CREATE POLICY "visit_logs_insert_own_unit" ON visit_logs
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "visit_logs_update_own" ON visit_logs;
CREATE POLICY "visit_logs_update_own" ON visit_logs
    FOR UPDATE USING (
        created_by = auth.uid()
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );

DROP POLICY IF EXISTS "visit_logs_delete_own" ON visit_logs;
CREATE POLICY "visit_logs_delete_own" ON visit_logs
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));


-- ─────────────────────────────────────────────────────────────
-- 4. managers (담당자관리)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit     TEXT NOT NULL,
    region            TEXT NOT NULL,
    manager_name      TEXT NOT NULL,
    email             TEXT,
    is_branch_manager BOOLEAN DEFAULT false,
    uploaded_by       UUID REFERENCES auth.users(id),
    uploaded_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "managers_select_same_unit" ON managers;
CREATE POLICY "managers_select_same_unit" ON managers
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "managers_insert_own_unit" ON managers;
CREATE POLICY "managers_insert_own_unit" ON managers
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "managers_delete_own" ON managers;
CREATE POLICY "managers_delete_own" ON managers
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));
