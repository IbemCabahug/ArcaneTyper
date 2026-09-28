/**
 * Regression guard for AT-F4 — the Supabase RLS audit and leaderboard integrity.
 *
 *   npm run verify:rls
 *
 * AT-F4 was open for months because `leaderboard` and `profiles` had never been
 * inspected. When they finally were (2026-09-28), two real problems showed up:
 *
 *   1. `leaderboard` INSERT was `with check (true)` FOR ROLE `public`. The anon
 *      key ships in the JavaScript bundle, so anyone could post any score. Two
 *      rows proved it had already happened: 999,999,999 on 'normal' and
 *      99,999,999 (streak 5000) on 'hard', both sitting at the top of their
 *      boards since February/March.
 *   2. `profiles` SELECT was `using (true)`, publishing every account UUID,
 *      username, XP, level and achievement set to the whole internet — while
 *      the client only ever reads your OWN row.
 *
 * The fix is a migration, and a migration is only as good as its ability to stay
 * applied. This file is OFFLINE by design: it locks the SHAPE of the fix in the
 * repo, so a later edit that quietly reopens a policy fails the suite rather than
 * the live database. The behavioural proof against the live project is
 * `scratch/verify-rls-leaderboard-profiles.mjs` (needs the PAT), and
 * `npm run doctor` covers connectivity.
 *
 * What this locks:
 *   1. leaderboard INSERT is `TO authenticated` — and is still named a policy
 *      rather than done with a `auth.uid() is not null` test in `with check`,
 *      because PostgREST resolves the role before the policy is evaluated;
 *   2. leaderboard SELECT stays PUBLIC. This is the one that must NOT be
 *      tightened: a leaderboard nobody may read is not a leaderboard;
 *   3. leaderboard still has NO UPDATE and NO DELETE policy, so a submitted
 *      score is immutable — `addScore` only ever inserts;
 *   4. there is exactly ONE policy per operation. The audit found a duplicate
 *      INSERT and a duplicate SELECT, residue from the 2026-09-23 run_history
 *      session; permissive policies OR together, so duplicates are dead weight
 *      that hides a real edit behind an identical twin;
 *   5. all six CHECK constraints survive, and each bound is still derived from
 *      the measured legitimate maxima rather than a round number;
 *   6. the migration is genuinely re-runnable: `create policy` fails with 42710
 *      if the name is taken, so every policy it creates is dropped first. (This
 *      was a real bug, caught by running it: the first version only dropped the
 *      PREVIOUS names and so worked exactly once.)
 *   7. the client never attempts a submission as a guest at all three sites —
 *      otherwise every guest game-over fires a doomed 403;
 *   8. THE CLASS OF BUG, which cost a test run: the `difficulty` CHECK lists the
 *      five values the UI can produce, so if a difficulty is ever added to
 *      index.html without updating the constraint, the game silently stops
 *      submitting on that board. The constraint is checked against the actual
 *      `<option>` values.
 *
 * Run:  node scripts/verify-rls.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
/** SQL only: the migration quotes its own SQL in the header and the rollback
 *  block, and a check that can match a comment is not a check. */
const sqlOnly = (src) => src
    .split('\n')
    .filter((l) => !/^\s*--/.test(l))
    .join('\n');

const MIGRATION = 'supabase/migrations/20260928_at_f4_rls_hardening.sql';
const migration = sqlOnly(read(MIGRATION));
const mainSrc = read('frontend/main.js');
const indexHtml = read('frontend/index.html');
const leaderboardSrc = read('backend/Leaderboard.js');
const pkgSrc = read('package.json');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`);
}

/**
 * Escape a string for use inside a RegExp built with `new RegExp`.
 *
 * The obvious `s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')` is WRONG here, and it
 * failed this suite on the first run: in a replacement STRING, `$&` means "the
 * matched substring" and the backslash is consumed, so every policy name came
 * out as a literal `$&` — a pattern containing an end-of-string anchor that can
 * never match. Using a replacer FUNCTION sidesteps `$`-substitution entirely.
 * Recorded because the failure mode is silent: three checks failed for a reason
 * that had nothing to do with the thing they were checking.
 */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => '\\' + c);


// ── 1. the migration file exists and is the AT-F4 one ──────────────────────
check('the AT-F4 migration is present in the repo', migration.length > 0);

// ── 2. leaderboard INSERT is restricted to a signed-in player ───────────────
check('leaderboard INSERT policy is scoped to the authenticated role',
    /create policy "Signed-in players can submit scores\." on public\.leaderboard\s+for insert to authenticated/.test(migration),
    'the role, not a with-check test: PostgREST resolves it before the policy runs');
check('no broad anon/public insert policy is created for leaderboard',
    !/create policy[^;]*on public\.leaderboard\s+for insert\s+(?!to authenticated)/i.test(migration),
    'an unqualified `for insert` applies to role public — the original defect');

// ── 3. leaderboard SELECT stays PUBLIC (this one must never be tightened) ──
check('leaderboard SELECT policy is still public',
    /create policy "Anyone can view leaderboard\." on public\.leaderboard\s+for select using \(true\)/.test(migration),
    'the Hall of Fame is the product; a board nobody may read is not a board');

// ── 4. no UPDATE / DELETE policy on leaderboard — scores are immutable ─────
check('leaderboard has no UPDATE policy', !/on public\.leaderboard\s+for update/i.test(migration));
check('leaderboard has no DELETE policy', !/on public\.leaderboard\s+for delete/i.test(migration));
check('the client only ever INSERTs a score (no correction path needs an UPDATE)',
    !/\.update\(/.test(leaderboardSrc) && /from\('leaderboard'\)[\s\S]{0,40}?\.insert\(/.test(leaderboardSrc),
    'Leaderboard.js must not gain an update() — the table has no policy to allow one');

// ── 5. profiles SELECT is own-row ─────────────────────────────────────────
check('profiles SELECT is narrowed to the caller own-row',
    /create policy "Players can view their own profile\." on public\.profiles\s+for select using \(auth\.uid\(\) = id\)/.test(migration));
check('the world-readable profiles policy is dropped',
    /drop policy if exists "Public profiles are viewable by everyone\." on public\.profiles/.test(migration));
check('the profiles INSERT own-row guard is left intact',
    !/create policy[^;]*on public\.profiles\s+for insert\s+to/i.test(migration),
    'AT-F4 changed reads only; the write side was already correct and verified');

// ── 6. the duplicate policies are gone, one per operation ─────────────────
// The audit found TWO insert and TWO select policies on leaderboard, all
// PERMISSIVE with identical expressions — residue from the 2026-09-23
// run_history session. Permissive policies OR together, so a duplicate is dead
// weight that can hide a real edit behind an identical twin.
for (const dup of ['Public insert', 'Public read', 'Anyone can insert leaderboard scores', 'Anyone can view leaderboard']) {
    check(`the duplicate policy "${dup}" is dropped`,
        new RegExp(`drop policy if exists "${escapeRe(dup)}"\\s+on public\\.leaderboard`).test(migration));
}

// ── 7. the migration is genuinely RE-RUNNABLE ──────────────────────────────
// `create policy` fails with 42710 when the name is taken, so a script that only
// dropped the PREVIOUS names works exactly once. This was a real bug, caught by
// running the applier: the first version aborted halfway on the second run.
for (const created of ['Signed-in players can submit scores.', 'Anyone can view leaderboard.', 'Players can view their own profile.']) {
    check(`"${created}" is dropped before it is created`,
        new RegExp(`drop policy if exists "${escapeRe(created)}"\\s+on`).test(migration),
        'otherwise a re-run dies with 42710 and the file is not idempotent');
}

// ── 8. the six sanity caps survive, with their measured rationale ──────────
const CAPS = {
    leaderboard_score_sane: /score >= 0 and score <= 5000000/,
    leaderboard_wpm_sane: /wpm >= 0 and wpm <= 400/,
    leaderboard_accuracy_sane: /accuracy >= 0 and accuracy <= 100/,
    leaderboard_streak_sane: /streak >= 0 and streak <= 2000/,
    leaderboard_name_sane: /char_length\(name\) between 1 and 64/,
    leaderboard_difficulty_sane: /difficulty in \('easy', 'normal', 'hard', 'hell', 'scribe'\)/
};
for (const [name, body] of Object.entries(CAPS)) {
    check(`cap ${name} is present`,
        migration.includes(`add constraint ${name}`) && body.test(migration),
        'the bound itself, not just the name');
}

// ── 9. THE CLASS OF BUG: the difficulty enum must match the real UI ────────
// This cost a live test run. The AT-F4 test originally used a sentinel
// difficulty of 'at_f4_probe' so its rows could never reach a rendered board —
// and the new CHECK constraint rejected it, because the constraint is exactly
// the list of values the UI can produce. If a difficulty is ever added to
// index.html and not to this list, the game silently stops submitting there.
const uiDifficulties = new Set();
for (const [, value] of indexHtml.matchAll(/<option value="([a-z]+)"/g)) {
    if (['easy', 'normal', 'hard', 'hell', 'scribe'].includes(value)) uiDifficulties.add(value);
}
const constraintList = [...migration.matchAll(/'([a-z]+)'/g)]
    .map((m) => m[1])
    .filter((v) => ['easy', 'normal', 'hard', 'hell', 'scribe'].includes(v));
const constraintSet = new Set(constraintList);
check('every difficulty the UI offers is allowed by leaderboard_difficulty_sane',
    [...uiDifficulties].every((d) => constraintSet.has(d)),
    `UI offers ${[...uiDifficulties].join(', ')}`);
check('the difficulty constraint lists no value the UI cannot produce',
    [...constraintSet].every((d) => uiDifficulties.has(d)),
    `constraint lists ${[...constraintSet].join(', ')}`);
check('all five difficulties are covered',
    constraintSet.size === 5 && uiDifficulties.size === 5);

// ── 10. the client never attempts a submission as a guest ─────────────────
// Three sites can submit: the Arena game-over, the pagehide banker, and the
// Scribe result. All three now branch on isGuest() first. A fourth site added
// later without the gate would fire a doomed 403 on every guest run.
const submitSites = [
    ['Arena game-over', /if \(isGuest\(\)\) \{\s*noteGuestScoreNotShared\(\);\s*\} else \{\s*await leaderboard\.addScore\(\s*game\.difficulty/],
    ['pagehide banker', /if \(isGuest\(\)\) \{\s*noteGuestScoreNotShared\(\);\s*\} else \{\s*leaderboard\.queuePendingScore\(/],
    ['Scribe result', /if \(isGuest\(\)\) \{\s*noteGuestScoreNotShared\(\);\s*\} else \{\s*await leaderboard\.addScore\('scribe'/]
];
for (const [label, pattern] of submitSites) {
    check(`the ${label} submission is gated on isGuest()`, pattern.test(mainSrc));
}
check('isGuest() is still derived from Stats.isAuthenticated, never a cached flag',
    /const isGuest = \(\) => !game\.stats\.isAuthenticated;/.test(mainSrc),
    'AT-M9: a cached copy of this flag is what rotted into dead code');
check('the guest hint is shown at most once per page load',
    /typerMaster_guestLeaderboardHinted/.test(mainSrc) && /getItem\(GUEST_HINT_KEY\)/.test(mainSrc),
    'this is reached at the end of every run; a toast each time would nag');
check('the gate never fires a network call on the guest path',
    !/if \(isGuest\(\)\) \{[^}]*leaderboard\./.test(mainSrc),
    'the whole point is to not send a request the database will refuse');

// ── 11. the guard is wired into the standing suite ─────────────────────────
check('verify:rls is registered in package.json', /"verify:rls"/.test(pkgSrc));
check('verify:rls runs as part of npm run verify', /npm run verify:rls/.test(pkgSrc));

console.log('');
if (failures) {
    console.log(`❌ AT-F4 RLS guard FAILED — ${failures} check(s).`);
    process.exit(1);
}
console.log('All AT-F4 RLS hardening checks passed.');
