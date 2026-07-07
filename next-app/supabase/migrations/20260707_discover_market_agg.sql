-- discover(시장분석) 통계 집계 RPC — 2026-07-07 적용(원격 project hcqbmilmldeeuydtrayx)
-- 클라이언트가 market_store_records 전건(≈12만행)을 받아 dedup+집계하던 것을 서버로 이관.
-- discover/page.tsx의 '빠른 통계 경로'가 이 함수로 KPI/랭킹/시군구 지도를 즉시 렌더한다.
-- (지도 점·동채색·지오코딩은 여전히 원본 행을 백그라운드 로드해서 채움)
--
-- 반환: jsonb 배열 1행 (PostgREST 1000행 캡 우회) — 각 원소는 (시도|시군구|월) 순증 집계.
-- dedup 규칙 = 클라 dedupeStoreEvents와 동일:
--   (name|address|status) 키에서 '달력상 직전 달'이 존재하는 연속 등재는 제외하고
--   각 연속 구간의 시작 달만 1건으로 집계. (좌표 전파 케이스는 현재 데이터 0건 → 카운트 무영향)
-- 파리티: 36개월 윈도우에서 new=45,257 / closed=73,691 (= 클라 dedup 결과와 일치).
-- SECURITY INVOKER — 호출자 RLS 그대로 적용.
create or replace function public.discover_market_agg(p_min_month text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      name,
      coalesce(address, '') as addr,
      case when status = 'closed' then 'closed' else 'new' end as st,
      sido, sigungu, month
    from market_store_records
    where month >= p_min_month
    group by name, coalesce(address, ''),
             case when status = 'closed' then 'closed' else 'new' end,
             sido, sigungu, month
  ),
  seq as (
    select base.*,
      to_date(month || '-01', 'YYYY-MM-DD') as mdate,
      lag(to_date(month || '-01', 'YYYY-MM-DD'))
        over (partition by name, addr, st order by month) as prev_mdate
    from base
  ),
  kept as (  -- 각 연속 구간의 시작 달만 남김
    select sido, sigungu, month, st
    from seq
    where prev_mdate is null
       or prev_mdate <> (mdate - interval '1 month')
  ),
  agg as (
    select sido, sigungu, month,
      count(*) filter (where st = 'new') as new_count,
      count(*) filter (where st = 'closed') as closed_count
    from kept
    group by sido, sigungu, month
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'sido', sido, 'sigungu', sigungu, 'month', month,
        'new_count', new_count, 'closed_count', closed_count
      ) order by month, sido, sigungu
    ), '[]'::jsonb)
  from agg;
$$;
