-- ============================================================
-- FS MISO — 멀티테넌트 테이블 생성 + RLS 설정
-- Supabase SQL Editor에서 전체 복붙 후 실행 (재실행 안전)
-- 최종 업데이트: 2026-03-13
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
    embedding       vector(768),
    created_by      UUID REFERENCES auth.users(id),
    created_at      TIMESTAMPTZ DEFAULT now()
);

-- 중복 방지: 같은 지점 내 동일 날짜+담당자+거래처 재업로드 차단
-- ⚠️ 실행 전 기존 중복 확인:
-- SELECT business_unit, visit_date, manager, business_name, COUNT(*)
-- FROM visit_logs GROUP BY business_unit, visit_date, manager, business_name HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS visit_logs_natural_uq
    ON visit_logs (business_unit, visit_date, manager, business_name)
    WHERE visit_date IS NOT NULL AND manager IS NOT NULL AND business_name IS NOT NULL;

-- 벡터 인덱스 (Mother Brain 유사도 검색)
CREATE INDEX IF NOT EXISTS visit_logs_embedding_idx
    ON visit_logs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

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
-- region1: 시도, region2: 시군구 (지점장은 region2='지점장'), region3: 구 (선택, 시 내 구 단위 분리 시 사용)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS managers (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit     TEXT NOT NULL,
    region1           TEXT,
    region2           TEXT,
    region3           TEXT,
    manager_name      TEXT NOT NULL,
    email             TEXT,
    is_branch_manager BOOLEAN DEFAULT false,
    uploaded_by       UUID REFERENCES auth.users(id),
    uploaded_at       TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE managers ADD COLUMN IF NOT EXISTS region3 TEXT;
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


-- ─────────────────────────────────────────────────────────────
-- 5. recipes (레시피 RAG — 벡터 검색)
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS recipes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename        TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    name_en         TEXT,
    description     TEXT,
    main_products   TEXT[]       DEFAULT '{}',
    ingredients     JSONB        DEFAULT '[]',
    steps           TEXT[]       DEFAULT '{}',
    category        TEXT,
    tags            TEXT[]       DEFAULT '{}',
    is_vegan        BOOLEAN      DEFAULT false,
    embedding       vector(768),
    pdf_url         TEXT,
    created_at      TIMESTAMPTZ  DEFAULT now()
);

-- pdf_url 컬럼 추가 (이미 있으면 무시)
ALTER TABLE recipes ADD COLUMN IF NOT EXISTS pdf_url TEXT;

CREATE INDEX IF NOT EXISTS recipes_embedding_idx
    ON recipes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

CREATE INDEX IF NOT EXISTS recipes_category_idx ON recipes (category);


-- ─────────────────────────────────────────────────────────────
-- 6. ai_briefings (거래처 AI 브리핑 캐시)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ai_briefings (
    id              BIGSERIAL PRIMARY KEY,
    account_name    TEXT NOT NULL,
    business_unit   TEXT,
    briefing        TEXT NOT NULL,
    last_visit_date TEXT,
    visit_count     INT,
    generated_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (account_name, business_unit)
);

ALTER TABLE ai_briefings ENABLE ROW LEVEL SECURITY;

-- 조회: 내 지점 브리핑만 SELECT 가능
DROP POLICY IF EXISTS "ai_briefings_select_same_unit" ON ai_briefings;
CREATE POLICY "ai_briefings_select_same_unit" ON ai_briefings
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

-- 쓰기: generate-briefing.js / batch-briefings.js → SERVICE_ROLE_KEY로 RLS 우회


-- ─────────────────────────────────────────────────────────────
-- 7. naver_cache (네이버 지역/블로그 검색 캐시 — 240h)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS naver_cache (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    store_name  TEXT NOT NULL UNIQUE,
    local_data  JSONB,
    blog_data   JSONB,
    cached_at   TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE naver_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon_all" ON naver_cache;
CREATE POLICY "anon_all" ON naver_cache FOR ALL TO anon USING (true) WITH CHECK (true);


-- ─────────────────────────────────────────────────────────────
-- 8. store_analysis_cache (네이버 매장 AI 분석 캐시 — 7일)
-- RLS 미적용: 서버사이드 anon key 호출, 비민감 캐시
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS store_analysis_cache (
    id           BIGSERIAL PRIMARY KEY,
    store_name   TEXT NOT NULL UNIQUE,
    analysis     JSONB NOT NULL,
    review_count INT DEFAULT 0,
    cached_at    TIMESTAMPTZ DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────
-- 9. quotes (저장된 견적서)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS quotes (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit TEXT NOT NULL,
    created_by    TEXT NOT NULL,
    customer_name TEXT DEFAULT '',
    manager_name  TEXT DEFAULT '',
    manager_phone TEXT DEFAULT '',
    quote_mode    TEXT DEFAULT 'custom',
    items         JSONB NOT NULL DEFAULT '[]',
    total_amount  INTEGER DEFAULT 0,
    memo          TEXT DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT now(),
    updated_at    TIMESTAMPTZ DEFAULT now()
);
-- 기존 테이블에 컬럼 없으면 추가 (멱등성)
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS memo TEXT DEFAULT '';
ALTER TABLE quotes ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "select_same_unit" ON quotes;
CREATE POLICY "select_same_unit" ON quotes
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "insert_own_unit" ON quotes;
CREATE POLICY "insert_own_unit" ON quotes
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "delete_own" ON quotes;
CREATE POLICY "delete_own" ON quotes
    FOR DELETE USING (
        created_by = (auth.jwt() -> 'user_metadata' ->> 'full_name')
        AND business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit')
    );


-- ─────────────────────────────────────────────────────────────
-- 10. report_cache (월별보고서 AI 분석 캐시 — 4개월 TTL)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS report_cache (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit TEXT NOT NULL,
    report_month  TEXT NOT NULL,  -- 'YYYY-MM'
    manager_name  TEXT NOT NULL DEFAULT '',  -- '' = 전체
    ai_content    TEXT NOT NULL,
    generated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (business_unit, report_month, manager_name)
);

ALTER TABLE report_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "report_cache_select_same_unit" ON report_cache;
CREATE POLICY "report_cache_select_same_unit" ON report_cache
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "report_cache_insert_same_unit" ON report_cache;
CREATE POLICY "report_cache_insert_same_unit" ON report_cache
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "report_cache_update_same_unit" ON report_cache;
CREATE POLICY "report_cache_update_same_unit" ON report_cache
    FOR UPDATE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "report_cache_delete_same_unit" ON report_cache;
CREATE POLICY "report_cache_delete_same_unit" ON report_cache
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));


-- ─────────────────────────────────────────────────────────────
-- visit_plans (방문 일정 — 경유지 저장, 달력 UI)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS visit_plans (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    business_unit TEXT NOT NULL,
    manager       TEXT,                          -- 지점장은 NULL 가능
    visit_date    DATE NOT NULL,
    items         JSONB NOT NULL DEFAULT '[]',
    created_at    TIMESTAMPTZ DEFAULT now(),
    UNIQUE (business_unit, manager, visit_date)
);

ALTER TABLE visit_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "visit_plans_select" ON visit_plans;
CREATE POLICY "visit_plans_select" ON visit_plans
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "visit_plans_insert" ON visit_plans;
CREATE POLICY "visit_plans_insert" ON visit_plans
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "visit_plans_update" ON visit_plans;
CREATE POLICY "visit_plans_update" ON visit_plans
    FOR UPDATE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "visit_plans_delete" ON visit_plans;
CREATE POLICY "visit_plans_delete" ON visit_plans
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));


-- ─────────────────────────────────────────────────────────────
-- 함수 1. search_success_visits (Mother Brain — 개척완료 유사도 검색)
-- Service Role Key로만 호출 (브리핑 API 서버사이드)
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_success_visits(
    query_embedding  vector(768),
    p_business_unit  TEXT,
    match_count      INT DEFAULT 2
)
RETURNS TABLE(
    business_name  TEXT,
    visit_date     DATE,
    manager        TEXT,
    content        TEXT,
    similarity     FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN QUERY
    SELECT
        v.business_name,
        v.visit_date,
        v.manager,
        v.content,
        1 - (v.embedding <=> query_embedding) AS similarity
    FROM visit_logs v
    WHERE
        v.business_unit = p_business_unit
        AND v.embedding IS NOT NULL
        AND (
            v.content ILIKE '%개척완료%'
            OR v.content ILIKE '%개척 완료%'
            OR v.content ILIKE '%연결완료%'
        )
        AND 1 - (v.embedding <=> query_embedding) > 0.62
    ORDER BY v.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 함수 2. search_recipes (레시피 벡터 유사도 검색)
-- 사용 예: SELECT * FROM search_recipes('[0.1, 0.2, ...]'::vector, 5, '라떼');
-- ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION search_recipes(
    query_embedding vector(768),
    match_count     INT     DEFAULT 5,
    filter_category TEXT    DEFAULT NULL
)
RETURNS TABLE(
    id            UUID,
    name          TEXT,
    name_en       TEXT,
    description   TEXT,
    main_products TEXT[],
    ingredients   JSONB,
    steps         TEXT[],
    category      TEXT,
    tags          TEXT[],
    is_vegan      BOOLEAN,
    pdf_url       TEXT,
    similarity    FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id, r.name, r.name_en, r.description,
        r.main_products, r.ingredients, r.steps,
        r.category, r.tags, r.is_vegan, r.pdf_url,
        1 - (r.embedding <=> query_embedding) AS similarity
    FROM recipes r
    WHERE
        (filter_category IS NULL OR r.category = filter_category)
        AND r.embedding IS NOT NULL
    ORDER BY r.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;


-- ─────────────────────────────────────────────────────────────
-- 상권 분석 테이블 (discover.html)
-- ─────────────────────────────────────────────────────────────

-- market_snapshots: 시군구별 월간 집계
CREATE TABLE IF NOT EXISTS market_snapshots (
    id           BIGSERIAL PRIMARY KEY,
    sido         TEXT NOT NULL,
    sigungu      TEXT NOT NULL,
    month        TEXT NOT NULL,
    new_count    INT  NOT NULL DEFAULT 0,
    closed_count INT  NOT NULL DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(sido, sigungu, month)
);
ALTER TABLE market_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename='market_snapshots' AND policyname='snapshots_read'
    ) THEN
        CREATE POLICY snapshots_read ON market_snapshots
            FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
END $$;

-- market_store_records: 시군구별 개별 매장 (드릴다운용)
CREATE TABLE IF NOT EXISTS market_store_records (
    id           BIGSERIAL PRIMARY KEY,
    sido         TEXT NOT NULL,
    sigungu      TEXT NOT NULL,
    month        TEXT NOT NULL,
    name         TEXT NOT NULL,
    category     TEXT,
    area_m2      NUMERIC,
    pyeong       NUMERIC,
    address      TEXT,
    status       TEXT NOT NULL CHECK (status IN ('new','closed')),
    license_date DATE,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS market_store_records_uix
    ON market_store_records(sido, sigungu, month, name, status);
ALTER TABLE market_store_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename='market_store_records' AND policyname='store_records_read'
    ) THEN
        CREATE POLICY store_records_read ON market_store_records
            FOR SELECT USING (auth.role() = 'authenticated');
    END IF;
END $$;
