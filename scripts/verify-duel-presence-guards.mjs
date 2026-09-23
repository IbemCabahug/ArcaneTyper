/**
 * Regression guard for the AT-F9 countdown/presence bug (owner-reported 2026-09-23).
 *
 * Symptom: `TypeError: Cannot read properties of null (reading 'isHost')` at
 * main.js's `new DuelRace({ isHost: duel.isHost })`, with the match already over
 * while 3..2..1 was still counting.
 *
 * Cause: Supabase presence emits `leave` (+ `join`) for the SAME key whenever a
 * client re-tracks it — `Duel.markInMatch()` re-sends our presence exactly when
 * FIGHT starts. The peer treated that transient `leave` as a departure, ran
 * `endDuel()` (which clears `duel`) while its own countdown was still running,
 * and the countdown's last tick then dereferenced the cleared `duel`.
 *
 * main.js is DOM-bound and cannot be imported here, so this script asserts the
 * source invariants that make the crash and the silent forfeit impossible.
 * Run:  node scripts/verify-duel-presence-guards.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'frontend', 'main.js'), 'utf8');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

const count = (needle) => src.split(needle).length - 1;
const at = (needle) => src.indexOf(needle);

// ── 1. the countdown can no longer outlive the duel ────────────────────────
const guard = 'if (!duel || !duelActive) return;';
check('countdown aborts when the duel ended mid-count', count(guard) === 1);
check(
    'the abort guard sits before the race is built',
    at(guard) > at('countdownOverlay.remove();') && at(guard) < at("isHost: duel.isHost"),
    'must run after the overlay teardown and before duel.isHost is read'
);
check(
    'the abort guard sits before game.start()',
    at(guard) < at("game.start('normal', 'duel', 'classic')"),
    'an aborted match must not start the game'
);
check(
    'the countdown handle is registered for endDuel',
    count('duelCountdown = { interval: countInterval, overlay: countdownOverlay };') === 1
);
check(
    'endDuel clears the interval and removes the overlay',
    count('clearInterval(duelCountdown.interval);') === 1 &&
        count('duelCountdown.overlay.remove();') === 1
);

// ── 2. a presence re-track is not a departure ─────────────────────────────
check(
    'the raw leave handler is gone',
    count('if (duelActive && !race) endDuel(true, \'disconnect\');') === 0,
    'pre-FIGHT leaves must go through the presence re-check'
);
check(
    'both lobby paths route leaves through onLobbyOpponentLeft',
    count('duel.onOpponentLeft = () => onLobbyOpponentLeft();') === 2
);
check(
    'the re-check reads presence state, not the event',
    src.includes('watched.channel.presenceState()') && src.includes('PRESENCE_SETTLE_MS')
);
check(
    'the re-check ignores a duel/match that took over while waiting',
    src.includes('if (duel !== watched || !duelActive || race)') &&
        src.includes('if (!duelActive || race) return;')
);
check(
    'the paired re-track join cannot re-fire startDuel on a torn-down duel',
    src.includes('if (!duel || duelActive) return;')
);

// ── 3. the survival death screen survives a duel ──────────────────────────
check(
    'startDuel preserves the survival game-over hook',
    count('if (!survivalGameOver) survivalGameOver = game.onGameOver;') === 1
);
check(
    'endDuel restores the survival game-over hook',
    count('if (survivalGameOver) game.onGameOver = survivalGameOver;') === 1
);

console.log(
    failures === 0
        ? '\nAll duel presence/countdown guards present.'
        : `\n${failures} guard(s) missing — the countdown crash can come back.`
);
process.exit(failures === 0 ? 0 : 1);
