-- =============================================================================
-- Arcane Typer — schema repair (2026-09-23)
-- =============================================================================
-- WHY THIS FILE EXISTS
--
-- The client (backend/Stats.js, backend/Leaderboard.js) has been talking to a
-- database that never received the columns those modules write. Probed against
-- the live project on 2026-09-23 (anon key, read-only requests):
--
--   GET /rest/v1/leaderboard?select=streak        -> 400  42703 "column
--                                                    leaderboard.streak does not exist"
--   GET /rest/v1/profiles?select=unlocked_skills  -> 400  42703
--   GET /rest/v1/profiles?select=wand_color       -> 400  42703
--   GET /rest/v1/profiles?select=mage_class       -> 400  42703
--   GET /rest/v1/profiles?select=best_score       -> 400  42703
--   GET /rest/v1/profiles?select=best_wpm         -> 400  42703
--   GET /rest/v1/profiles?select=created_at       -> 400  42703
--
-- Consequences that the owner reported as four separate bugs:
--   1. Account progress never persisted  — the whole `profiles` upsert was
--      rejected (PostgREST 400), so not even total_xp was written. Only three
--      legacy rows exist and new accounts have no row at all.
--   2. Hall of Fame never showed global data — the SELECT included `streak`,
--      so it always fell back to the per-browser localStorage cache.
--   3. Workshop XP / unlocks reset on refresh — same rejected upsert.
--   4. (Secondary) The "The Unbroken" streak board had no data to read.
--
-- This script is IDEMPOTENT and ADDITIVE: it only adds columns, indexes and an
-- optional row-bootstrap trigger. It never drops, renames or rewrites data.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this file -> Run.
--   Then re-run the queries in section 5 to verify.
--
-- The client is ALSO hardened (see backend/Stats.js `_upsertProfile` and
-- backend/Leaderboard.js `_fetchTop`) so it degrades to the supported column
-- set instead of failing wholesale. Running this script is still required to
-- restore global leaderboards, cloud progress and the streak board.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. leaderboard — add the streak column the client reads and writes
-- -----------------------------------------------------------------------------
alter table public.leaderboard
    add column if not exists streak integer not null default 0;

-- Ordering columns are queried as "difficulty = X order by <col> desc limit 10"
create index if not exists leaderboard_difficulty_score_idx    on public.leaderboard (difficulty, score desc);
create index if not exists leaderboard_difficulty_wpm_idx      on public.leaderboard (difficulty, wpm desc);
create index if not exists leaderboard_difficulty_accuracy_idx on public.leaderboard (difficulty, accuracy desc);
create index if not exists leaderboard_difficulty_streak_idx   on public.leaderboard (difficulty, streak desc);

-- -----------------------------------------------------------------------------
-- 2. profiles — add the progression columns the client syncs
-- -----------------------------------------------------------------------------
alter table public.profiles
    add column if not exists unlocked_skills jsonb        not null default '[]'::jsonb;
alter table public.profiles
    add column if not exists wand_color      text         not null default '#ff00ff';
alter table public.profiles
    add column if not exists mage_class      text         not null default 'Novice';
alter table public.profiles
    add column if not exists best_score      integer      not null default 0;
alter table public.profiles
    add column if not exists best_wpm        integer      not null default 0;
alter table public.profiles
    add column if not exists created_at      timestamptz  not null default now();
alter table public.profiles
    add column if not exists updated_at      timestamptz  not null default now();

-- `run_history` was verified complete (user_id, mode, wpm, accuracy, score) —
-- no changes needed. It is currently EMPTY, which is why the account has no
-- score history at all. See the note in section 4.

-- -----------------------------------------------------------------------------
-- 3. OPTIONAL — bootstrap a profiles row on signup
-- -----------------------------------------------------------------------------
-- OFF BY DEFAULT ON PURPOSE. This trigger runs inside the auth schema and, if
-- it raises, the signup itself fails. Enable it only after confirming the
-- profiles table has no other NOT NULL columns you know about:
--
--     select column_name, is_nullable, column_default
--     from information_schema.columns
--     where table_schema = 'public' and table_name = 'profiles'
--     order by ordinal_position;
--
-- Uncomment the block below to enable it.
--
-- create or replace function public.arcane_typer_bootstrap_profile()
-- returns trigger
-- language plpgsql
-- security definer
-- set search_path = public
-- as $$
-- begin
--     insert into public.profiles (id, username, total_xp, player_level)
--     values (
--         new.id,
--         coalesce(split_part(new.email, '@', 1), 'Anonymous Mage'),
--         0,
--         1
--     )
--     on conflict (id) do nothing;
--     return new;
-- end;
-- $$;
--
-- drop trigger if exists arcane_typer_on_signup on auth.users;
-- create trigger arcane_typer_on_signup
--     after insert on auth.users
--     for each row execute function public.arcane_typer_bootstrap_profile();

-- Keep updated_at honest once the column exists.
create or replace function public.arcane_typer_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    return new;
end;
$$;

drop trigger if exists arcane_typer_profiles_touch on public.profiles;
create trigger arcane_typer_profiles_touch
    before update on public.profiles
    for each row execute function public.arcane_typer_touch_updated_at();



-- -----------------------------------------------------------------------------
-- 4. AUDIT — read-only diagnostics (safe to run, changes nothing)
-- -----------------------------------------------------------------------------
-- The repository holds no migration history, so the live RLS state has never
-- been recorded. Run these and keep the output in the docs before changing any
-- policy (see AT-F4 "Supabase RLS audit" in arcaneTyper-docs/future_feature.md).

-- select tablename, rowsecurity
--   from pg_tables
--  where schemaname = 'public'
--    and tablename in ('leaderboard', 'profiles', 'run_history');

-- select schemaname, tablename, policyname, cmd, roles, qual, with_check
--   from pg_policies
--  where schemaname = 'public'
--  order by tablename, cmd;

-- Was anything ever written to run_history? (0 rows when checked 2026-09-23 —
-- that is the "no score history" half of the persistence bug.)
-- select count(*) as runs from public.run_history;

-- -----------------------------------------------------------------------------
-- 5. VERIFY — every one of these 8 rows must come back
-- -----------------------------------------------------------------------------
select table_name, column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name in ('leaderboard', 'profiles')
   and column_name in ('streak', 'unlocked_skills', 'wand_color', 'mage_class',
                       'best_score', 'best_wpm', 'created_at', 'updated_at')
 order by table_name, column_name;
