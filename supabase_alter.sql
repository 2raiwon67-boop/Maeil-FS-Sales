-- ============================================================
-- FS MISO — 테이블 컬럼 추가 (STEP 1 이후 실행)
-- Supabase SQL Editor에서 실행
-- ============================================================

-- ── accounts (주요거래처) 컬럼 추가 ──────────────────────────
ALTER TABLE accounts
    ADD COLUMN IF NOT EXISTS seq_no         TEXT,   -- NO (원본 시퀀스)
    ADD COLUMN IF NOT EXISTS store_code     TEXT,   -- 사업장코드명
    ADD COLUMN IF NOT EXISTS customer_level TEXT,   -- 고객레벨2
    ADD COLUMN IF NOT EXISTS account_id     TEXT,   -- 거래처ID
    ADD COLUMN IF NOT EXISTS manager_name   TEXT;   -- 담당자명

-- ── visit_logs (방문일지) 컬럼 추가 ──────────────────────────
ALTER TABLE visit_logs
    ADD COLUMN IF NOT EXISTS seq_no       TEXT,   -- NO (원본 시퀀스)
    ADD COLUMN IF NOT EXISTS store_code   TEXT,   -- 사업장코드
    ADD COLUMN IF NOT EXISTS dealer_code  TEXT,   -- 방문처(대리점 코드)
    ADD COLUMN IF NOT EXISTS dealer_name  TEXT,   -- 방문처(대리점)
    ADD COLUMN IF NOT EXISTS account_code TEXT;   -- 방문처(거래처 코드)

-- 완료 확인
-- SELECT column_name FROM information_schema.columns
-- WHERE table_name IN ('accounts','visit_logs') AND table_schema = 'public'
-- ORDER BY table_name, ordinal_position;
