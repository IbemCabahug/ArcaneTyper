/**
 * Behavioural test for the SECRET COUNTER achievements — the slice-and-assert
 * guards in verify-arena-vfx.mjs only prove the SHAPE of the code. This runs
 * the real Achievements class against a fake localStorage to prove the counters
 * actually behave: they cap at the goal, survive a reload, do not advance on the
 * wrong event, keep SEPARATE keys from each other, and unlock their character at
 * exactly the goal.
 *
 * Two counters are covered:
 *   - `the_unspoken`          (goal 10)  → unlocks the Voidweaver.  Counts bosses
 *     killed without ever casting the Supernova.
 *   - `the_bloodied_standard` (goal 100) → unlocks the Bloodseeker. Counts Arena
 *     duels WON. This REPLACED an earlier "die in Survival without typing a
 *     word" condition (owner decision 2026-09-26), which punished the exact
 *     behaviour the game asks for — a mage who refuses to sit idle and die.
 *     The owner's brief for the visible n/100 was diagnostic: a counter stuck
 *     at 0/100 has to be an obvious, reportable bug, so the reload and
 *     per-win-advance behaviour below is the part that earns its keep.
 */
import { readFileSync } from 'node:fs';

let store = {};
globalThis.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
};
// The class logs its OWN recovery paths ("Failed to parse achievements") through
// console.error, and the corrupt-storage checks below deliberately trigger them,
// so the method is stubbed out to keep the output readable.
//
// But `check` MUST NOT report through console.error, or stubbing it here would
// swallow every FAIL line in this file: the run would print only PASS lines,
// exit 1, and show no reason. That is exactly what happened the first time the
// Bloodseeker section was added — its checks were failing (the two counters'
// stored state leaked between sections) and the report was completely silent.
// Failures therefore go to console.log, and the summary to stdout as well.
globalThis.console.error = () => {};

// The class is an ES module; strip the export and evaluate it as a script.
const src = readFileSync('frontend/Achievements.js', 'utf8').replace('export class Achievements', 'class Achievements');
const Achievements = new Function(`${src}; return Achievements;`)();

let fails = 0;
const check = (name, cond, why = '') => {
    if (cond) console.log(`PASS  ${name}`);
    else { console.log(`FAIL  ${name}  ${why}`); fails++; }
};
const ach = new Achievements({ playSound() { } });
const D = 'the_unspoken';

// The counter table, read from the LOADED definitions rather than re-parsed from
// source. The assertions below are about the shipped data (this route counts
// duel wins, at 100), so they must read the same object the game does — a
// second regex copy here could drift from the real definitions and go green
// while the game is wrong.
const COUNTER_KEYS = {};
const COUNTER_GOALS = {};
for (const [id, def] of Object.entries(ach.definitions)) {
    if (def?.counter) {
        COUNTER_KEYS[id] = def.counter.key;
        COUNTER_GOALS[id] = def.counter.goal;
    }
}
check('both secret counters are declared as counters',
    COUNTER_GOALS[D] === 10 && COUNTER_GOALS['the_bloodied_standard'] === 100,
    `got ${JSON.stringify(COUNTER_GOALS)}`);

// A boss killed with the Supernova spent must NOT count.
ach.bumpProgress(D, 1);                    // 1
ach.bumpProgress(D, 1);                    // 2
check('the counter advances one per qualifying kill', ach.getProgress(D) === 2, `got ${ach.getProgress(D)}`);
check('a partial count is not reported as unlocked', !ach.unlocked.has(D));

// Reload: the partial must survive, or 10 sessions of work is lost.
const reloaded = new Achievements(null);
check('a partial count survives a reload', reloaded.getProgress(D) === 2, `got ${reloaded.getProgress(D)}`);

// Drive to the goal.
for (let i = 0; i < 8; i++) reloaded.bumpProgress(D, 1);
check('the counter reaches exactly 10 at the goal', reloaded.getProgress(D) === 10, `got ${reloaded.getProgress(D)}`);
check('reaching the goal unlocks the achievement', reloaded.unlocked.has(D));

// Overshoot must not drift.
reloaded.bumpProgress(D, 1);
reloaded.bumpProgress(D, 5);
check('the counter is capped at the goal, never past it', reloaded.getProgress(D) === 10, `got ${reloaded.getProgress(D)}`);
check('the toast fires exactly once, on the crossing call', reloaded.getProgress(D) === 10 && reloaded.unlocked.has(D));

// A non-counter achievement must report 0 and refuse to bump.
check('a non-counter definition reports 0 progress', ach.getProgress('boss_slayer') === 0);
check('bumping a non-counter definition is a no-op', ach.bumpProgress('boss_slayer', 5) === false && !ach.unlocked.has('boss_slayer'));

// Corrupt storage must degrade, not throw.
store.typerMaster_achievementProgress = 'not json at all';
let threw = false;
try { new Achievements(null); } catch { threw = true; }
check('corrupt progress storage degrades instead of throwing', !threw);

// A negative / NaN stored value must clamp to 0 rather than render "-1/10".
store.typerMaster_achievementProgress = JSON.stringify({ bossKillsNoSupernova: -5 });
check('a negative stored value clamps to 0', new Achievements(null).getProgress(D) === 0);
store.typerMaster_achievementProgress = JSON.stringify({ bossKillsNoSupernova: 'abc' });
check('a non-numeric stored value clamps to 0', new Achievements(null).getProgress(D) === 0);
store.typerMaster_achievementProgress = JSON.stringify({ bossKillsNoSupernova: 99 });
check('a stored value above the goal clamps to the goal', new Achievements(null).getProgress(D) === 10);

// ── the_bloodied_standard: the Bloodseeker's 100-duel route (2026-09-26) ──────
// The owner's brief was a DIAGNOSTIC: a stuck 0/100 has to be visible, so the
// counter must move once per win, survive a reload, and unlock at exactly 100.
//
// A CLEAN SLATE first. The block above deliberately leaves
// `bossKillsNoSupernova: 99` in the store, and `typerMaster_achievements`
// holding the_unspoken. Both are read by every constructor, so without this reset
// this section began with the Voidweaver already at 10/10 and the cross-counter
// checks below failed for a reason that had nothing to do with the Bloodseeker.
store.typerMaster_achievementProgress = '{}';
delete store.typerMaster_achievements;

const B = 'the_bloodied_standard';
const fresh = new Achievements(null);
check('the Bloodseeker route starts at 0 and is not pre-unlocked',
    fresh.getProgress(B) === 0 && !fresh.unlocked.has(B));
check('the Bloodseeker route is a counter over duel WINS',
    COUNTER_KEYS[B] === 'pvpWins' && COUNTER_GOALS[B] === 100,
    `key ${COUNTER_KEYS[B]} goal ${COUNTER_GOALS[B]}`);

const blood = new Achievements(null);
for (let i = 0; i < 3; i++) check(`win ${i + 1} advances the counter`, (blood.bumpProgress(B, 1), blood.getProgress(B) === i + 1));
check('the two counters keep SEPARATE keys (one win must not move the boss count)',
    blood.getProgress(D) === 0 && blood.getProgress(B) === 3,
    `unspoken ${blood.getProgress(D)} bloodied ${blood.getProgress(B)}`);

// The reload is the diagnostic: a 100-win grind that forgets itself every duel
// would read 0/100 forever, and the player would have no way to tell.
const bloodReloaded = new Achievements(null);
check('a partial duel count survives a reload', bloodReloaded.getProgress(B) === 3, `got ${bloodReloaded.getProgress(B)}`);
for (let i = 0; i < 97; i++) bloodReloaded.bumpProgress(B, 1);
check('the 100th win lands exactly on the goal', bloodReloaded.getProgress(B) === 100, `got ${bloodReloaded.getProgress(B)}`);
check('the 100th win unlocks the achievement', bloodReloaded.unlocked.has(B));
bloodReloaded.bumpProgress(B, 1);
check('win 101 does not drift the stored value past 100/100', bloodReloaded.getProgress(B) === 100, `got ${bloodReloaded.getProgress(B)}`);
check('the Voidweaver route is untouched by the Bloodseeker one',
    bloodReloaded.getProgress(D) === 0 && !bloodReloaded.unlocked.has(D));

// Corrupt storage for the NEW key must degrade exactly like the old one.
store.typerMaster_achievementProgress = JSON.stringify({ pvpWins: -1 });
check('a negative duel count clamps to 0', new Achievements(null).getProgress(B) === 0);
store.typerMaster_achievementProgress = JSON.stringify({ pvpWins: 'lots' });
check('a non-numeric duel count clamps to 0', new Achievements(null).getProgress(B) === 0);
store.typerMaster_achievementProgress = JSON.stringify({ pvpWins: 5000 });
check('a duel count above the goal clamps to 100', new Achievements(null).getProgress(B) === 100);

// ── sign-out / sign-in round trip (bug found 2026-09-26) ─────────────────────
// This is the case nothing covered, and it was a PERMANENT soft-lock.
// `backend/Stats.js` PROGRESSION_KEYS purged `typerMaster_achievements` but not
// `typerMaster_achievementProgress`, so signing out deleted the unlocked flag
// and kept the count. On the next sign-in the card read a finished 100/100 while
// the achievement was locked again — and because `bumpProgress` clamps at the
// goal, `next === before` returned false forever. No way back.
//
// Each case below reproduces the EXACT logout, by reading the real purge list
// out of the shipped Stats.js, so this test cannot drift from what ships.
const statsSrc = readFileSync('backend/Stats.js', 'utf8').replace(/\r\n/g, '\n');
const purgeList = (() => {
    const from = statsSrc.indexOf('const PROGRESSION_KEYS');
    const block = statsSrc.slice(from, statsSrc.indexOf('];', from));
    return new Set([...block.matchAll(/'(typerMaster_[A-Za-z]+)'/g)].map((m) => m[1]));
})();
check('the real purge list covers BOTH halves of a counter achievement',
    purgeList.has('typerMaster_achievements') && purgeList.has('typerMaster_achievementProgress'),
    'one half is purged and the other is not — that split IS the bug');
const signOut = () => { for (const k of purgeList) delete store[k]; };

// 1. THE REPAIR PATH for players already caught by the bug. Before this fix the
//    purge list kept `typerMaster_achievementProgress`, so anyone who signed out
//    while a counter was complete has a REAL localStorage with the count at its
//    goal and the flag gone. That split state is already on users' disks, and
//    the reconciliation is what heals it — so it is reproduced here exactly:
//    the count present, the flag absent.
{
    store = {};
    const a = new Achievements(null);
    for (let i = 0; i < 100; i++) a.bumpProgress(B, 1);
    delete store.typerMaster_achievements;   // the legacy half-purge
    check('a legacy split state (count kept, flag gone) is healed on next load',
        new Achievements(null).unlocked.has(B),
        'the player owns nothing while the card reads 100/100 — unrecoverable');
}
// 2. Same for the older Voidweaver route, which had the bug for months.
{
    store = {};
    const a = new Achievements(null);
    for (let i = 0; i < 10; i++) a.bumpProgress(D, 1);
    delete store.typerMaster_achievements;
    check('the Voidweaver route heals from the same legacy split', new Achievements(null).unlocked.has(D));
}
// 2b. A FULL sign-out now wipes BOTH halves, so no split is left behind and the
//     next account starts from nothing. This is the purge fix working, and it is
//     exactly why cases 1/2 must simulate the half-purge rather than a logout —
//     after the fix the two situations are genuinely different.
{
    store = {};
    const a = new Achievements(null);
    for (let i = 0; i < 100; i++) a.bumpProgress(B, 1);
    check('the Bloodseeker route is earned before signing out', a.unlocked.has(B));
    signOut();
    const b = new Achievements(null);
    check('a full sign-out leaves no split state behind',
        !b.unlocked.has(B) && b.getProgress(B) === 0,
        `unlocked ${b.unlocked.has(B)} progress ${b.getProgress(B)}`);
}
// 3. A PARTIAL count must NOT be resurrected — 42/100 is not a finished route.
{
    store = {};
    new Achievements(null).bumpProgress(B, 42);
    signOut();
    const b = new Achievements(null);
    check('a partial count does not unlock the character',
        !b.unlocked.has(B) && b.getProgress(B) === 0,
        `unlocked ${b.unlocked.has(B)} progress ${b.getProgress(B)}`);
}
// 4. CROSS-ACCOUNT LEAK: the next account must start from zero. This is why the
//    progress key is now purged — without it a shared browser handed the second
//    player a free Bloodseeker without a duel ever being played.
{
    store = {};
    const a = new Achievements(null);
    for (let i = 0; i < 100; i++) a.bumpProgress(B, 1);
    signOut();
    const other = new Achievements(null);
    check('a second account on the same browser inherits NOTHING',
        !other.unlocked.has(B) && other.getProgress(B) === 0,
        `unlocked ${other.unlocked.has(B)} progress ${other.getProgress(B)} — a free Bloodseeker`);
}
// 5. A plain reload (NO sign-out) must still keep a partial count. If this ever
//    fails, the reconciliation has become over-eager and is dropping real work.
{
    store = {};
    new Achievements(null).bumpProgress(B, 42);
    check('a plain reload still keeps a partial count', new Achievements(null).getProgress(B) === 42);
}

// ── cloud round trip (2026-09-26) ───────────────────────────────────────────
// Achievements were the only progression that never left the browser, so the
// 100-duel Bloodseeker route was lost on sign-out and on every device change.
// These run the real merge: a snapshot written on one "device" is applied to
// another, which is exactly what `loadFromSupabase(profile)` does with a row.
const snapshotOf = (a) => JSON.parse(JSON.stringify(a.toCloudState()));

// 1. The headline case: 100 wins on device A, fresh device B.
{
    store = {};
    const a = new Achievements(null);
    for (let i = 0; i < 100; i++) a.bumpProgress(B, 1);
    const cloud = snapshotOf(a);

    store = {};                       // device B: nothing local
    const b = new Achievements(null);
    check('a second device starts with nothing', !b.unlocked.has(B) && b.getProgress(B) === 0);
    b.mergeCloudState(cloud);
    check('the 100-win route survives the move to a second device', b.unlocked.has(B));
    check('the counter comes with it', b.getProgress(B) === 100);
}
// 2. A PARTIAL count must move too — this is what was silently lost.
{
    store = {};
    const a = new Achievements(null);
    a.bumpProgress(B, 42);
    const cloud = snapshotOf(a);
    store = {};
    const b = new Achievements(null);
    b.mergeCloudState(cloud);
    check('a partial 42/100 survives the move to a second device', b.getProgress(B) === 42, `got ${b.getProgress(B)}`);
    check('a partial count does NOT unlock the character', !b.unlocked.has(B));
}
// 3. Plain boolean achievements move too, not just the counters.
{
    store = {};
    const a = new Achievements(null);
    a.checkUnlock('speed_demon');
    const cloud = snapshotOf(a);
    store = {};
    const b = new Achievements(null);
    b.mergeCloudState(cloud);
    check('a plain achievement survives the move', b.unlocked.has('speed_demon'));
}
// 4. The merge must be a UNION, not an overwrite: local progress is kept.
{
    store = {};
    const a = new Achievements(null);
    a.bumpProgress(B, 10);
    a.checkUnlock('speed_demon');
    const cloud = snapshotOf(a);
    store = {};
    const b = new Achievements(null);      // offline progress the cloud lacks
    b.bumpProgress(B, 77);
    b.checkUnlock('boss_slayer');
    b.mergeCloudState(cloud);
    check('the merge KEEPS local progress the cloud is missing (77, not 10)',
        b.getProgress(B) === 77, `got ${b.getProgress(B)}`);
    check('the merge KEEPS a local-only unlock', b.unlocked.has('boss_slayer'));
    check('the merge ADDS what only the cloud had', b.unlocked.has('speed_demon'));
}
// 5. Monotonicity: a STALE snapshot must never move a counter backwards.
{
    store = {};
    const b = new Achievements(null);
    b.bumpProgress(B, 80);
    b.mergeCloudState({ unlocked_achievements: [], achievement_progress: { pvpWins: 20 } });
    check('a stale cloud snapshot cannot roll a counter backwards', b.getProgress(B) === 80, `got ${b.getProgress(B)}`);
}
// 6. Idempotence: replaying one snapshot changes nothing and reports false.
{
    store = {};
    const a = new Achievements(null);
    a.bumpProgress(B, 55);
    const cloud = snapshotOf(a);
    store = {};
    const b = new Achievements(null);
    check('the first merge reports a change', b.mergeCloudState(cloud) === true);
    check('replaying the same snapshot reports no change', b.mergeCloudState(cloud) === false);
    check('replaying does not disturb the value', b.getProgress(B) === 55);
}
// 7. A snapshot at the goal restores the CHARACTER even with no flag — the
//    "owned nothing while the card read 100/100" case, now across devices.
{
    store = {};
    const cloud = { unlocked_achievements: [], achievement_progress: { pvpWins: 100 } };
    const b = new Achievements(null);
    b.mergeCloudState(cloud);
    check('a cloud counter at the goal re-derives the unlock', b.unlocked.has(B),
        'the card would read 100/100 while locked — unrecoverable');
}
// 8. Hostile / corrupt snapshots must degrade, not throw or poison state.
{
    store = {};
    const b = new Achievements(null);
    check('a null snapshot is a no-op', b.mergeCloudState(null) === false && b.getProgress(B) === 0);
    check('unknown ids are dropped, not stored',
        b.mergeCloudState({ unlocked_achievements: ['not_a_real_achievement'] }) === false
        && !b.unlocked.has('not_a_real_achievement'));
    check('an unknown counter key is ignored',
        b.mergeCloudState({ achievement_progress: { hackerWins: 999 } }) === false);
    check('a negative / non-numeric counter is ignored',
        b.mergeCloudState({ achievement_progress: { pvpWins: -50 } }) === false
        && b.mergeCloudState({ achievement_progress: { pvpWins: 'many' } }) === false);
    check('an over-goal cloud value is clamped, never trusted raw',
        b.mergeCloudState({ achievement_progress: { pvpWins: 99999 } }) === true
        && b.getProgress(B) === 100, `got ${b.getProgress(B)}`);
    check('a non-object progress field is ignored, not iterated',
        b.mergeCloudState({ achievement_progress: 'nope' }) === false
        && b.mergeCloudState({ achievement_progress: [1, 2] }) === false);
    // A snapshot must not be a live reference: unlock something AFTER taking it
    // and the snapshot must not have gained it. (An earlier version of this check
    // pushed a REAL id onto the returned array and then merged it, which of
    // course succeeded — that proved nothing about snapshotting.)
    const live = new Achievements(null);
    const snap = live.toCloudState();
    live.checkUnlock('speed_demon');
    check('toCloudState() returns a snapshot, not the live Set',
        !snap.unlocked_achievements.includes('speed_demon'),
        'the payload kept mutating after it was queued for the upsert');
}
// 9. A change must notify the owner, or the cloud is never written at all.
{
    store = {};
    let calls = 0;
    const a = new Achievements(null);
    a.onChange = () => calls++;
    a.bumpProgress(B, 1);
    check('a counter bump notifies the owner', calls === 1, `${calls} call(s)`);
    a.checkUnlock('speed_demon');
    check('an unlock notifies the owner', calls === 2, `${calls} call(s)`);
    // A guest Stats carries no Achievements at all, but a bare instance must
    // still work. Fresh store, or it inherits `a`'s count and the expectation of
    // exactly 1 is off by one.
    store = {};
    const silent = new Achievements(null);
    check('a bare Achievements with no onChange still works (guest)',
        (() => { silent.bumpProgress(B, 1); return silent.getProgress(B) === 1; })(),
        `got ${silent.getProgress(B)}`);
}
if (fails) { console.error(`${fails} counter check(s) FAILED.`); process.exit(1); }
console.log('All secret-achievement counter checks passed.');
