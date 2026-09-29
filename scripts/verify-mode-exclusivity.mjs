/**
 * Regression guard for AT-F20 — Survival/Practice and the Arena were never
 * mutually exclusive.
 *
 * Owner-reported sequence: open the Arena, create a room, wait for an opponent,
 * misclick Survival, let it run, leave it, come back to the Arena — and the
 * opponent never connected.
 *
 * The real mechanism was worse than "didn't connect": BOTH subsystems drive the
 * same `game` object, and nothing stopped a second run from starting. So the
 * survival loop and the duel loop were alive together. When the opponent
 * arrived, `onOpponentJoined` still fired and `startDuel` called
 * `game.start('normal','duel','classic')` — whose only defence was
 * `cancelAnimationFrame`, which cancels the old loop WITHOUT clearing its stats,
 * words or score. The match therefore DID start, on top of the abandoned run,
 * inheriting its numbers. The room also outlived the run: quitting a run only
 * called `game.stop()`, which never touched the lobby.
 *
 * Run:  node scripts/verify-mode-exclusivity.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'frontend', 'main.js'), 'utf8');
const gameSrc = readFileSync(join(root, 'frontend', 'Game.js'), 'utf8');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
// Slice from `from` up to (but not including) `to`. Both needles are FULL
// source lines — an earlier version of this file passed a single line as the
// end bound, which cut every slice to one line and made seven correct checks
// fail. A slice helper that silently truncates looks exactly like a real defect.
const slice = (text, from, to) => {
    const i = text.indexOf(from);
    if (i === -1) return '';
    const j = text.indexOf(to, i + from.length);
    return j === -1 ? text.slice(i) : text.slice(i, j);
};

console.log('--- AT-F20 part 1: the two modes cannot overlap ---');

// The signal must be the live CHANNEL, not the visible panel: the room
// survives the player navigating away, so a hidden-but-live room is exactly
// the state that has to block a new run.
// The Arena blocks a new run when EITHER half of "in play" is true. A first
// version of this guard only knew about the channel, which missed the exact
// case in the owner's screenshot: the panel open with NO room created, where
// `duel` is still null but the 45vw side panel is plainly on screen beside a
// live game.
check('an OPEN lobby panel blocks a new run even with no room yet',
    /function duelLobbyOpen\(\) \{[\s\S]{0,300}?classList\.contains\('active'\)/.test(src) &&
    /classList\.contains\('active'\) \|\|\s*\n\s*!duelLobbyMenu\.classList\.contains\('hidden'\)/.test(src),
    'a channel-only check reports "nothing live" while the Arena is on screen');
check('"in play" is the union of panel and channel',
    /function arenaInPlay\(\) \{\s*\n\s*return duelLobbyOpen\(\) \|\| liveDuelRoom\(\);/.test(src) &&
    /function blockedByLiveDuelRoom\(\) \{[\s\S]{0,120}?if \(!arenaInPlay\(\)\) return false;/.test(src),
    'blocking on only one of the two signals leaves the other path open');

// The reveal must be GATED, not merely followed by a guard. Revealing the panel
// and only then refusing to initialise it leaves the Arena visible and inert
// over a live run — which is precisely what the owner's screenshot showed.
const revealBlock = slice(src, "if (game.isRunning) {\n        MagicalToast.show(\n          '🔒 A run is already in progress',", 'duelLobbyMenu.classList.remove(\'hidden\');');
check('the Arena panel is not revealed while a run is live',
    /if \(game\.isRunning\)/.test(revealBlock) &&
    revealBlock.lastIndexOf('return;') > revealBlock.indexOf('if (game.isRunning)'),
    'the guard must sit BEFORE the remove(\'hidden\') that reveals the panel');
check('the reveal happens after the guard, never before it',
    src.indexOf("duelLobbyMenu.classList.remove('hidden');") >
        src.indexOf('// Gate the REVEAL.'),
    'revealing first and guarding second shows an inert panel over a live game');
check('openDuelLobby keeps its own guard as defence in depth',
    /function openDuelLobby\(\) \{[\s\S]{0,300}?if \(game\.isRunning\)/.test(src),
    'the single caller is guarded, but the function should not rely on that alone');

// A live duel room is detected from the channel too, since a room can outlive
// the panel that showed it.
check('a live duel room is detected from the channel, not the panel',
    /function liveDuelRoom\(\) \{\s*\n\s*return !!\(duel \|\| rematchLink\);/.test(src),
    'a panel-only check misses a room left waiting in the background');
check('the retained post-match link also counts as a live room',
    /rematchLink\)/.test(slice(src, 'function liveDuelRoom()', '}')));
check('the block reports a message rather than failing silently',
    /The Arena is already open/.test(src) && /blockedByLiveDuelRoom/.test(src) &&
    /Close it first/.test(src));

// A generous window: the guard sits below a multi-line comment, so a tight
// bound cuts the comment off and never reaches the check.
check('Survival refuses to start while a room is live',
    /function startGame\(\) \{[\s\S]{0,600}?if \(blockedByLiveDuelRoom\(\)\) return;/.test(src),
    'startGame is the path the owner took; it must be guarded');
check('Practice refuses to start while a room is live',
    /function startPractice\([\s\S]{0,600}?if \(blockedByLiveDuelRoom\(\)\) return;/.test(src),
    'Practice shares the same canvas and stats, so it needs the same guard');
check('the Arena refuses to open over a live run',
    /function openDuelLobby\(\) \{[\s\S]{0,300}?if \(game\.isRunning\) \{/.test(src),
    'the reverse direction stacks two loops just as badly');

console.log('\n--- AT-F20 part 2: Game.start cannot stack a second run ---');
// Include the end bound, so the ordering check can compare against the line the
// slice would otherwise stop short of.
const startFn = slice(gameSrc, '    start(difficulty =', '        this.difficulty = difficulty;')
    + '        this.difficulty = difficulty;';
check('start() stops a live run instead of only cancelling its frame',
    /if \(this\.isRunning\) \{\s*\n\s*this\.stop\(\);\s*\n\s*this\.reset\(\);/.test(startFn),
    'cancelAnimationFrame alone leaves the old run\'s stats, words and score in place');
check('the guard runs BEFORE the new run is configured',
    startFn.indexOf('this.isRunning') < startFn.indexOf('this.difficulty = difficulty'),
    'configuring first would let the new mode mutate a live run before stopping it');

console.log('\n--- AT-F20 part 3: a duel cannot inherit a live run ---');
const startDuelFn = slice(src, '  function startDuel(opponentName) {', '    duelActive = true;');
check('startDuel ends a leftover run before building the match',
    /if \(game\.isRunning && !duelActive\) \{[\s\S]{0,200}?game\.stop\(\);[\s\S]{0,120}?game\.reset\(\)/.test(startDuelFn),
    'defence in depth: the match must never inherit a survival run\'s state');
check('the leftover-run guard is not skipped once a duel is already active',
    /!duelActive/.test(startDuelFn),
    'without this, a rematch (duelActive already true) would be needlessly torn down');
check('the canvas is cleared so the old run leaves no drawing behind',
    /ctx\.clearRect\(0, 0, game\.canvas\.width, game\.canvas\.height\)/.test(startDuelFn));

console.log(`\n${failures === 0
    ? 'All AT-F20 mode-exclusivity checks passed.'
    : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
