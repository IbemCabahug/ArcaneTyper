-- =============================================================================
-- Arcane Typer — AT-F4 RLS hardening + leaderboard integrity (2026-09-28)
-- =============================================================================
-- WHY THIS FILE EXISTS
--
-- AT-F4 was open because `leaderboard` and `profiles` had never been inspected
-- from this repository. They have now been, with the Supabase Management API
-- (`SUPABASE_ACCESS_KEY` = an `sbp_` PAT, which reads `pg_policies` and executes
-- SQL — no dashboard required). The audit output is recorded in
-- docs/arcaneTyper-docs/PROJECT_STATUS.md §4. Findings:
--
--   leaderboard  RLS ON. Two INSERT + two SELECT policies, all PERMISSIVE with
--                `using (true)` / `with check (true)` for role `public` — i.e.
--                DUPLICATES. No UPDATE, no DELETE policy.
--   profiles     RLS ON. INSERT `auth.uid() = id`, UPDATE `using (auth.uid() =
--                id)` (no WITH CHECK, which Postgres correctly falls back to
--                USING for), SELECT `using (true)`, no DELETE.
--   run_history  RLS ON, already repaired 2026-09-23. Not touched by this file.
--
-- Two real problems, both proven live before this script was written:
--
--   1. ANY VISITOR COULD FORGE ANY SCORE. The anon key ships in the JavaScript
--      bundle, so `leaderboard` INSERT `with check (true)` for role `public`
--      meant a two-line console script could post any name/score/wpm/accuracy/
--      streak. Verified live: an anonymous insert of 2147483647 into every
--      numeric column returned HTTP 201.
--
--   2. `profiles` WAS WORLD-READABLE. SELECT `using (true)` published every
--      mage's account UUID, username, XP, level, unlocked skills and
--      achievements to anyone holding the public anon key. The client never
--      needs this: the only two readers (`AuthUI.js:308` and `:411`) both
--      filter `.eq('id', session.user.id)`, and the Hall of Fame reads
--      `leaderboard`, not `profiles`. Pure unintended exposure.
--
-- And the forgery had ALREADY HAPPENED. Measured maximums, straight from the
-- live table BEFORE this script ran:
--
--     difficulty  rows  max_score      max_wpm  max_streak
--     easy           6     110,395          29           75
--     hard          19  99,999,999          54        5,000   <- impossible
--     hell           5      14,760          46            0
--     normal        82  999,999,999         100          500   <- impossible
--     scribe        12          76          76            0
--
-- The two absurd rows (INJOKER 999,999,999 on 'normal' from 2026-03-03, and
-- Ibem 99,999,999 with streak 5000 on 'hard' from 2026-02-23) sat at the TOP of
-- the Adept and Archmage High Councils, making both boards meaningless for six
-- months. Judging by the names — and that the same accounts hold ordinary
-- September scores — these look like the OWNER's own debug rows from when the
-- write path was tested, not an attacker. Section 1 removes them; the effect
-- either way is the same.
--
-- WHAT THIS SCRIPT CHANGES (owner decision, 2026-09-28)
--
--   a. `leaderboard` INSERT becomes `TO authenticated`. Guests keep playing
--      Arcane Defense and the Scribe's Trial and keep their LOCAL scores; they
--      simply no longer submit to the cloud Hall of Fame. This mirrors the
--      AT-M9 guest gates already shipped for the Workshop, Arena and Forge.
--      Public READ is deliberately kept — a leaderboard nobody may look at is
--      not a leaderboard.
--   b. The duplicate policy pair is dropped; one policy per operation.
--   c. `profiles` SELECT is narrowed to the caller's own row.
--   d. Sanity caps are added as CHECK constraints (section 3).
--
-- HONEST LIMIT OF (a): signup is enabled with auto-confirm ON, so anyone can
-- obtain a free account in seconds. Requiring authentication raises the cost of
-- forging and makes a submission attributable to an account; it does NOT by
-- itself bound the damage. The CHECK constraints in section 3 are what actually
-- bound it, which is why they ship in the same pass.
--
-- This script is IDEMPOTENT and additive apart from section 1, which is the one
-- destructive statement and is fenced off on its own. No column is dropped,
-- renamed or rewritten. The 122 legitimate leaderboard rows are untouched.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this file -> Run.
--   Then re-run the queries in section 5 to verify.
--   On this machine it was applied with the Management API instead; the

-- -----------------------------------------------------------------------------
-- 2. RLS POLICIES
-- -----------------------------------------------------------------------------

-- 2a. leaderboard — drop the duplicates left by the 2026-09-23 run_history
--     session, then recreate one INSERT and keep one public SELECT.
--
-- BOTH the old names and the new ones are dropped, so the whole file is
-- genuinely re-runnable: `create policy` fails with 42710 if its name is taken,
-- so a script that only dropped the previous names would work exactly once.
drop policy if exists "Public insert"        on public.leaderboard;
drop policy if exists "Public read"          on public.leaderboard;
drop policy if exists "Anyone can insert leaderboard scores" on public.leaderboard;
drop policy if exists "Anyone can view leaderboard"          on public.leaderboard;
drop policy if exists "Signed-in players can submit scores." on public.leaderboard;
drop policy if exists "Anyone can view leaderboard."          on public.leaderboard;

-- INSERT is now restricted to a real, signed-in player.
--
-- `TO authenticated` is the enforcement: PostgREST maps a request signed with
-- the ANON key to the `anon` database role, and one signed with a user's JWT to
-- `authenticated`. Naming the role in the policy is stronger than testing
-- `auth.uid() is not null` inside `with check`, because the role is resolved by
-- PostgREST before the policy is ever evaluated.
--
-- `with check (true)` then means "any shape an authenticated player may submit",
-- with the real value limits enforced by the CHECK constraints in section 3.
-- There is no `user_id` column on this table — a leaderboard entry is keyed by
-- display name, and guests historically posted under an alias — so the identity
-- of the submitter is deliberately not recorded. The policy's job is to make a
-- submission attributable in principle, not to bind it to a row.
create policy "Signed-in players can submit scores." on public.leaderboard
    for insert to authenticated with check (true);

-- SELECT stays public and role-less: the Hall of Fame is the product.
create policy "Anyone can view leaderboard." on public.leaderboard
    for select using (true);

-- No UPDATE and no DELETE policy on purpose. A submitted score is immutable:
-- verified live that a PATCH against an existing row changes nothing. There is
-- no client path that needs to correct a row either — `Leaderboard.addScore`
-- only ever INSERTs a new one.

-- 2b. profiles — narrow the world-readable SELECT to the caller's own row.
--
-- This drops the exposure of every account UUID, username, XP, level, unlocked
-- skills and achievement set to the public anon key. It is safe because both
-- client readers already filter by the session user's own id:
--   frontend/ui/AuthUI.js:308  .from('profiles').select('*').eq('id', data.user.id)
--   frontend/ui/AuthUI.js:411  .from('profiles').select('*').eq('id', session.user.id)
-- and `Stats._upsertProfile` (Stats.js:1079) is a write, governed separately.
drop policy if exists "Public profiles are viewable by everyone." on public.profiles;
drop policy if exists "Players can view their own profile." on public.profiles;

create policy "Players can view their own profile." on public.profiles
    for select using (auth.uid() = id);


-- -----------------------------------------------------------------------------
-- 3. SANITY CAPS — the part that actually bounds the damage
-- -----------------------------------------------------------------------------
-- Authentication alone does not stop a determined forger: signup is open and
-- auto-confirmed, so "you must be logged in" only means "you must have made an
-- account". These constraints are what put a ceiling on a forged row.
--
-- Every bound below is derived from the OWNER'S OWN measured data, not guessed.
-- The pre-migration maximums were: score 228,480 (legit) vs 999,999,999
-- (debug), wpm 100 (legit), streak 433 (legit, 'admin') vs 5,000 (debug). Each
-- cap sits far above the legitimate ceiling and far below the impossible value,
-- so no real run can ever be clipped — the failure mode of a cap set too low is
-- worse than having no cap at all, because it silently deletes honest players'
-- best runs.
--
-- Each is dropped first so the script is re-runnable.

-- score: survival scoring is `floor(wordLength * 10 * comboMultiplier)` with the
-- multiplier saturating at 10.0 and Pyromancer adding 20% — about 600 points for
-- a 5-letter word at maximum combo. 5,000,000 is >20x the best legitimate run
-- ever recorded here and ~20x below the debug row it replaces.
alter table public.leaderboard drop constraint if exists leaderboard_score_sane;
alter table public.leaderboard
    add constraint leaderboard_score_sane
    check (score >= 0 and score <= 5000000);

-- wpm: the documented player population is 35-120 WPM and the observed maximum
-- is 100. 400 is beyond any human ceiling while leaving the field uncapped.
alter table public.leaderboard drop constraint if exists leaderboard_wpm_sane;
alter table public.leaderboard
    add constraint leaderboard_wpm_sane
    check (wpm >= 0 and wpm <= 400);

-- accuracy is a percentage, so this is just the natural domain. The single
-- `accuracy: 7` row in the table is not impossible, merely a bad run, so the
-- floor stays at 0 rather than inventing a threshold.
alter table public.leaderboard drop constraint if exists leaderboard_accuracy_sane;
alter table public.leaderboard
    add constraint leaderboard_accuracy_sane
    check (accuracy >= 0 and accuracy <= 100);

-- streak: this is the run's max combo, and the combo multiplier stops scaling at
-- combo 200 (see Stats.getComboMultiplier). 433 is the best legitimate value on
-- record; 2000 keeps ~4.6x headroom and still rejects the 5000 debug row.
alter table public.leaderboard drop constraint if exists leaderboard_streak_sane;
alter table public.leaderboard
    add constraint leaderboard_streak_sane
    check (streak >= 0 and streak <= 2000);

-- name: bounds a display name so the table cannot be filled with megabyte-long
-- strings. The longest real name on record is far below this.
alter table public.leaderboard drop constraint if exists leaderboard_name_sane;
alter table public.leaderboard
    add constraint leaderboard_name_sane
    check (char_length(name) between 1 and 64);

-- difficulty: the only five values the UI can ever produce — easy, normal, hard
-- and hell from `#difficulty-select`, plus 'scribe' from the Hall of Fame filter
-- (index.html:144-151, 329-335). The daily challenge submits as 'normal'
-- (main.js:603). Anything else is a hand-crafted row.
alter table public.leaderboard drop constraint if exists leaderboard_difficulty_sane;
alter table public.leaderboard
    add constraint leaderboard_difficulty_sane
    check (difficulty in ('easy', 'normal', 'hard', 'hell', 'scribe'));

-- -----------------------------------------------------------------------------
-- 4. ROLLBACK
-- -----------------------------------------------------------------------------
-- Everything here is reversible. To restore the previous (open) state:
--
--   alter table public.leaderboard
--     drop constraint leaderboard_score_sane,
--                 leaderboard_wpm_sane,
--                 leaderboard_accuracy_sane,
--                 leaderboard_streak_sane,
--                 leaderboard_name_sane,
--                 leaderboard_difficulty_sane;
--   drop policy "Signed-in players can submit scores." on public.leaderboard;
--   create policy "Anyone can insert leaderboard scores" on public.leaderboard
--       for insert with check (true);
--   drop policy "Players can view their own profile." on public.profiles;
--   create policy "Public profiles are viewable by everyone." on public.profiles
--       for select using (true);
--
-- The two purged rows in section 1 are NOT restorable — re-insert them only if
-- you have the values, and they were debug data, so there is no reason to.

-- -----------------------------------------------------------------------------
-- 5. VERIFY — run after applying
-- -----------------------------------------------------------------------------

-- 5a. exactly one INSERT policy (to authenticated) and one SELECT (public),
--     and no UPDATE/DELETE policy on leaderboard.
select tablename, policyname, cmd, roles::text, coalesce(qual, '') as using_expr,
       coalesce(with_check, '') as check_expr
  from pg_policies
 where schemaname = 'public' and tablename in ('leaderboard', 'profiles')
 order by tablename, cmd, policyname;

-- 5b. all six constraints present.
select conname, pg_get_constraintdef(oid) as definition
  from pg_constraint
 where conrelid = 'public.leaderboard'::regclass and contype = 'c'
 order by conname;

-- 5c. the purge worked and the caps are satisfied by every surviving row.
select count(*) as total_rows,
       max(score) as max_score, max(wpm) as max_wpm, max(streak) as max_streak
  from public.leaderboard;

-- 5d. the two probe artefacts from the audit are gone.
select count(*) as should_be_zero
  from public.leaderboard
 where difficulty = 'at_f4_probe' or score > 5000000;

-- The write side is already correct and is deliberately NOT changed here:
--   INSERT  with check (auth.uid() = id)   — verified: a forged foreign id is
--                                           rejected 403/42501.
--   UPDATE  using (auth.uid() = id)       — verified: a foreign row is untouched,
--                                           and because Postgres falls back to
--                                           the USING expression when WITH
--                                           CHECK is omitted, rewriting your own
--                                           `id` to a victim's is rejected too
--                                           (403). Worth stating because a
--                                           missing WITH CHECK reads like a bug.
--   DELETE  no policy at all              — nobody can delete, not even their own
--                                           row; verified: the row survives.

--   statements are identical, executed one at a time (the API's /database/query
--   endpoint takes a single statement, so the SQL Editor is the easier path).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PURGE — the only destructive statement in this file
-- -----------------------------------------------------------------------------
-- PREVIEW FIRST (this changes nothing):
--
--   select id, name, difficulty, score, wpm, streak, created_at
--     from public.leaderboard
--    where score > 5000000 or streak > 2000 or wpm > 400
--    order by score desc;
--
-- The bounds above are the caps this script is about to enforce, so this
-- selects exactly the rows the new constraints would reject — which is why the
-- delete must run BEFORE section 3 or the ALTER TABLE would fail.
--
-- Exactly 2 rows match today. Both are the debug rows described in the header.
-- Run the preview and confirm it returns those two before running the delete.
delete from public.leaderboard
 where score > 5000000 or streak > 2000 or wpm > 400;
