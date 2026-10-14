-- =============================================================================
-- Arcane Typer — write-rate throttle (2026-10-14)
-- =============================================================================
-- WHY THIS FILE EXISTS
--
-- Production forensics (docs/arcaneTyper-docs/SECURITY-TURNSTILE-RESEARCH.md
-- §2.5, queried read-only 2026-10-14) found the leaderboard flooded: 90 rows on
-- 2026-10-13 vs ~1-3/day normally, 60 of them inside a 4-minute burst
-- (11:58-12:02 UTC, ~15 rows/min) submitted by an ALREADY-AUTHENTICATED session.
--
-- This is a WRITE-RATE problem, not an authentication problem. Cloudflare Turnstile
-- / Supabase CAPTCHA gates the sign-up/sign-in handshake only; once a bot holds a
-- valid JWT it can loop INSERTs within the existing CHECK caps and CAPTCHA never
-- re-triggers per insert. A server-side per-user insert throttle is therefore the
-- PRIMARY control; CAPTCHA is complementary.
--
-- DESIGN (owner decision, 2026-10-14: "counter table / punch-card")
--   A separate private table `insert_throttle` counts successful inserts per
--   (user, table, clock-hour). A BEFORE INSERT trigger checks the counter and
--   RAISEs when over the per-hour limit. The `leaderboard` table itself is NOT
--   altered and gains NO user_id column, so public SELECT exposure is unchanged.
--
-- LIMITS (edit the constants inside enforce_insert_throttle() to tune):
--   leaderboard : 10 successful inserts / hour / user
--   run_history : 60 successful inserts / hour / user
--   (measured: flood = ~15 rows/min; busiest honest user = ~8 runs/hr)
--
-- SECURITY NOTES
--   - SECURITY DEFINER + pinned search_path so it can update the counter even
--     though clients have no rights on it.
--   - `insert_throttle` has RLS ON with ZERO policies and no grants to
--     anon/authenticated -> clients cannot read or write it directly.
--   - If auth.uid() is NULL the trigger returns NEW and lets existing RLS reject
--     the row (guests already cannot INSERT anywhere).
--   - A rejected attempt RAISEs, rolling back its own counter bump, so only
--     successful inserts count toward the limit.
--
-- KNOWN LIMITATION: the window is a fixed clock-hour (not a rolling 60 min), so a
-- user could do up to 2x the limit across an hour boundary. Still caps sustained
-- flooding at ~20/hr instead of ~90 in 4 min. Upgrade to a rolling window later
-- if that residual matters.
--
-- APPLY: run in the Supabase SQL Editor (or `supabase db push`). NOT auto-applied.
-- =============================================================================

-- 1. Counter table ("punch card")
create table if not exists public.insert_throttle (
    user_id      uuid        not null,
    scope        text        not null,
    window_start timestamptz not null,
    cnt          integer     not null default 0,
    primary key (user_id, scope, window_start)
);

-- 2. Lock it away from clients (RLS ON + no policies + no grants)
alter table public.insert_throttle enable row level security;
revoke all on public.insert_throttle from anon, authenticated;

-- 3. The throttle function
create or replace function public.enforce_insert_throttle()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
    uid        uuid := auth.uid();
    max_per_hr integer;
    win        timestamptz;
    cur        integer;
begin
    -- auth.uid() NULL = anon/guest: existing RLS already rejects them. Don't interfere.
    if uid is null then
        return new;
    end if;

    max_per_hr := case TG_TABLE_NAME
                    when 'leaderboard' then 10
                    when 'run_history' then 60
                    else 60
                  end;

    win := date_trunc('hour', now());

    insert into public.insert_throttle (user_id, scope, window_start, cnt)
    values (uid, TG_TABLE_NAME, win, 1)
    on conflict (user_id, scope, window_start)
    do update set cnt = public.insert_throttle.cnt + 1
    returning cnt into cur;

    if cur > max_per_hr then
        raise exception 'Rate limit exceeded: too many % inserts this hour. Try again later.',
            TG_TABLE_NAME
            using errcode = 'P0001';
    end if;

    return new;
end;
$$;

-- 4. Attach to both writable tables
drop trigger if exists leaderboard_throttle on public.leaderboard;
create trigger leaderboard_throttle
    before insert on public.leaderboard
    for each row execute function public.enforce_insert_throttle();

drop trigger if exists run_history_throttle on public.run_history;
create trigger run_history_throttle
    before insert on public.run_history
    for each row execute function public.enforce_insert_throttle();

-- 5. VERIFY (run after applying)
-- 5a. both triggers present
-- select tgname, tgrelid::regclass from pg_trigger
--  where tgname in ('leaderboard_throttle','run_history_throttle') and not tgisinternal;
-- 5b. counter table locked down (expect true, then 0)
-- select relrowsecurity from pg_class where oid = 'public.insert_throttle'::regclass;
-- select count(*) as policies_should_be_zero from pg_policies
--  where schemaname='public' and tablename='insert_throttle';

-- 6. ROLLBACK
-- drop trigger if exists leaderboard_throttle on public.leaderboard;
-- drop trigger if exists run_history_throttle on public.run_history;
-- drop function if exists public.enforce_insert_throttle();
-- drop table if exists public.insert_throttle;
