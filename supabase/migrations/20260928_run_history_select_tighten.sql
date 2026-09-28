-- =============================================================================
-- Arcane Typer — run_history SELECT narrowed to own-row (2026-09-28)
-- =============================================================================
-- WHY THIS FILE EXISTS
--
-- The immediate follow-up to `20260928_at_f4_rls_hardening.sql`, which fixed the
-- same class of exposure on `profiles` and deliberately left this one alone: it
-- is a separate owner decision, not something to bundle into a change that was
-- already removing a capability. The owner has now made that call.
--
-- `run_history` SELECT was `using (true)` for role `public`, which publishes
-- EVERY user's `user_id` and their full run history — mode, WPM, accuracy and
-- score for every run they have ever finished — to anyone holding the anon key
-- that ships in the JavaScript bundle. On `profiles` the equivalent leak was
-- closed in the AT-F4 migration; this is the same one-line change, on the table
-- the AT-F4 write deliberately did not touch.
--
-- The client does not need the public read. There is exactly ONE reader:
--
--   backend/Stats.js:954   supabase.from('run_history')
--                            .select('mode, wpm, accuracy, score, created_at')
--                            .eq('user_id', session.user.id)      <-- own row
--                            .order('created_at', { ascending: false })
--                            .limit(limit)
--
-- i.e. the Mage Profile's "Recent Runs" panel, already scoped to the session
-- user. Nothing anywhere reads another mage's runs — the WPM History chart uses
-- its own in-memory ring buffer instead (that was AT-M2's original dead wiring).
--
-- The INSERT policy is deliberately NOT changed: `auth.uid() = user_id` was
-- verified on 2026-09-23 and is the reason run_history is not forgeable.
--
-- This script is IDEMPOTENT. It drops both the old and the new policy name
-- before creating, because `create policy` fails with 42710 on a name it
-- already holds — a script that only dropped the previous name works once.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> paste this file -> Run.
--   Then re-run the query in section 4 to verify.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ROLLBACK (not run — for reference)
-- -----------------------------------------------------------------------------
--   drop policy "Players can view their own runs." on public.run_history;
--   create policy "Anyone can view run history." on public.run_history
--       for select using (true);

-- -----------------------------------------------------------------------------
-- 2. narrow the SELECT
-- -----------------------------------------------------------------------------
drop policy if exists "Anyone can view run history."     on public.run_history;
drop policy if exists "Players can view their own runs." on public.run_history;

create policy "Players can view their own runs." on public.run_history
    for select using (auth.uid() = user_id);

-- -----------------------------------------------------------------------------
-- 3. why this cannot break the Recent Runs panel
-- -----------------------------------------------------------------------------
-- `getRunHistory` is only ever called with a live session, and it filters by
-- `session.user.id` — which is exactly the value `auth.uid()` returns for that
-- session. So every row the panel can see is still visible; it simply can no
-- longer see anyone else's. An ANONYMOUS read now correctly returns zero rows
-- instead of the whole table, and `scratch/verify-run-history-rls.mjs` asserts
-- both halves of that (its old "anon SELECT sees the run" check was the public
-- read, and has been replaced by a sessioned own-row read plus an anon
-- must-see-nothing check).

-- -----------------------------------------------------------------------------
-- 4. verify (run after applying) — expect exactly one SELECT policy
-- -----------------------------------------------------------------------------
select tablename, policyname, cmd, roles::text as roles,
       coalesce(qual, '') as using_expr, coalesce(with_check, '') as check_expr
  from pg_policies
 where schemaname = 'public' and tablename = 'run_history'
 order by cmd, policyname;

-- Row count is unchanged (67) — this script moves no data.
select count(*) as run_rows, count(distinct user_id) as users from public.run_history;
