-- market_snapshots 테이블
-- 공공인허가 API에서 집계한 카페/베이커리/음식점 신규·폐업 월별 스냅샷
-- batch-briefings 야간 배치가 매일 현재월·전월 갱신
-- market-backfill API로 2025-01부터 일회성 백필

create table if not exists market_snapshots (
    id           bigint generated always as identity primary key,
    sido         text        not null,   -- '경기도' | '서울' | '인천'
    sigungu      text        not null,   -- '의정부시' | '강남구' | '계양구'
    month        text        not null,   -- 'YYYY-MM'
    new_count    integer     not null default 0,
    closed_count integer     not null default 0,
    updated_at   timestamptz          default now(),
    unique(sido, sigungu, month)
);

create index if not exists market_snapshots_sigungu_idx on market_snapshots(sigungu);
create index if not exists market_snapshots_month_idx   on market_snapshots(month);
create index if not exists market_snapshots_sido_idx    on market_snapshots(sido);

-- RLS: 읽기 공개, 쓰기는 service role only
alter table market_snapshots enable row level security;

create policy "public select" on market_snapshots
    for select using (true);
