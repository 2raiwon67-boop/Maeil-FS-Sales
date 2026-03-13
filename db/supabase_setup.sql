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

-- seq_no 기반 중복 방지 인덱스 (업로드 시 동일 seq_no 재업로드 차단)
-- ⚠️ 실행 전 기존 중복 seq_no 제거 필요: SELECT seq_no, business_unit, COUNT(*) FROM visit_logs GROUP BY seq_no, business_unit HAVING COUNT(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS visit_logs_bu_seq_unique
    ON visit_logs (business_unit, seq_no)
    WHERE seq_no IS NOT NULL;

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
    created_at      TIMESTAMPTZ  DEFAULT now()
);

-- 벡터 유사도 검색 인덱스 (ivfflat 근사 검색, lists는 rows/1000 기준)
CREATE INDEX IF NOT EXISTS recipes_embedding_idx
    ON recipes USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- 카테고리 필터용 인덱스
CREATE INDEX IF NOT EXISTS recipes_category_idx ON recipes (category);


-- ─────────────────────────────────────────────────────────────
-- Mother Brain: visit_logs 임베딩 컬럼 + 벡터 검색 함수
-- ─────────────────────────────────────────────────────────────

-- 1. embedding 컬럼 추가 (이미 있으면 무시)
ALTER TABLE visit_logs ADD COLUMN IF NOT EXISTS embedding vector(768);

-- 2. 벡터 인덱스
CREATE INDEX IF NOT EXISTS visit_logs_embedding_idx
    ON visit_logs USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);

-- 3. 개척완료 성공 사례 유사도 검색 함수
-- Service Role Key로만 호출 (브리핑 API에서 서버 사이드 호출)
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
        AND 1 - (v.embedding <=> query_embedding) > 0.62  -- 유사도 62% 미만 사례 제외
    ORDER BY v.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;

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

DROP POLICY IF EXISTS "ai_briefings_select_same_unit" ON ai_briefings;
CREATE POLICY "ai_briefings_select_same_unit" ON ai_briefings
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "ai_briefings_all_service" ON ai_briefings;
CREATE POLICY "ai_briefings_all_service" ON ai_briefings
    FOR ALL USING (true) WITH CHECK (true);
-- 참고: generate-briefing.js / batch-briefings.js는 Service Role Key로 호출 → RLS 우회


-- ─────────────────────────────────────────────────────────────
-- 7. naver_cache (네이버 지역/블로그 검색 캐시 — 240h)
-- RLS 미적용: 서버사이드 anon key 호출, store_name만 있음 (비민감 캐시)
-- ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS naver_cache (
    id          BIGSERIAL PRIMARY KEY,
    store_name  TEXT NOT NULL UNIQUE,
    local_data  JSONB,
    blog_data   JSONB,
    cached_at   TIMESTAMPTZ DEFAULT now()
);


-- ─────────────────────────────────────────────────────────────
-- 8. store_analysis_cache (네이버 매장 AI 분석 캐시 — 7일)
-- RLS 미적용: 서버사이드 anon key 호출 (비민감 캐시)
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
    id            BIGSERIAL PRIMARY KEY,
    business_unit TEXT NOT NULL,
    created_by    TEXT,
    customer_name TEXT,
    manager_name  TEXT,
    manager_phone TEXT,
    quote_mode    TEXT,
    items         JSONB DEFAULT '[]',
    total_amount  BIGINT DEFAULT 0,
    created_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quotes_select_same_unit" ON quotes;
CREATE POLICY "quotes_select_same_unit" ON quotes
    FOR SELECT USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "quotes_insert_own_unit" ON quotes;
CREATE POLICY "quotes_insert_own_unit" ON quotes
    FOR INSERT WITH CHECK (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));

DROP POLICY IF EXISTS "quotes_delete_own_unit" ON quotes;
CREATE POLICY "quotes_delete_own_unit" ON quotes
    FOR DELETE USING (business_unit = (auth.jwt() -> 'user_metadata' ->> 'business_unit'));


-- ── 벡터 유사도 검색 함수 ──
-- 사용 예: SELECT * FROM search_recipes('[0.1, 0.2, ...]'::vector, 5, '라떼');
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
    similarity    FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        r.id, r.name, r.name_en, r.description,
        r.main_products, r.ingredients, r.steps,
        r.category, r.tags, r.is_vegan,
        1 - (r.embedding <=> query_embedding) AS similarity
    FROM recipes r
    WHERE
        (filter_category IS NULL OR r.category = filter_category)
        AND r.embedding IS NOT NULL
    ORDER BY r.embedding <=> query_embedding
    LIMIT match_count;
END;
$$;
