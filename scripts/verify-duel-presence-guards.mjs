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
 * main.js is DOM-bound and cannot be imported here, so this script works in two
 * halves:
 *   1. source invariants (the guards exist in the right order), and
 *   2. a behavioural probe that slices the real `opponentConfirmedGone` /
 *      `onLobbyOpponentLeft` source out of main.js and drives it through a
 *      stubbed duel/presence scope — a re-track must not end the duel, a real
 *      departure still must.
 * Run:  node scripts/verify-duel-presence-guards.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'frontend', 'main.js'), 'utf8');
const duelSrc = readFileSync(join(root, 'backend', 'Duel.js'), 'utf8');
const raceSrc = readFileSync(join(root, 'frontend', 'game', 'DuelRace.js'), 'utf8');

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
check(
    'the in-match grace re-checks settled presence before forfeiting',
    raceSrc.includes('if (this._opponentIsPresent())') &&
        raceSrc.includes("this._endMatch(this.mine, 'disconnect');")
);
check(
    'the in-match presence check ignores the local key and handles a torn channel',
    raceSrc.includes('key !== this.duel.presenceKey') &&
        raceSrc.includes('this.duel.channel?.presenceState?.() || {}') &&
        raceSrc.includes('return false;')
);
check(
    'visibility re-track is installed and removed with the channel',
    duelSrc.includes("document.addEventListener('visibilitychange'") &&
        duelSrc.includes('this._removeVisibilityHandler();') &&
        duelSrc.includes("document.removeEventListener('visibilitychange'")
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

// ── 4. behaviour: a re-track must survive, a departure must still count ────
// The helper block is sliced out of the live source and given a stubbed scope
// via `with` (sloppy-mode function body), so these cases exercise the shipped
// code rather than a copy of it.
const helperBlock = src.slice(
    src.indexOf('  // ── AT-F9 presence hardening'),
    src.indexOf('  // Global State')
);
check(
    'the presence helper block is discoverable in main.js',
    helperBlock.includes('function opponentConfirmedGone') &&
        helperBlock.includes('function onLobbyOpponentLeft')
);

function presenceHarness() {
    const state = { duel: null, duelActive: false, race: null };
    const calls = { endDuel: [] };
    let pending = null;
    const scope = {
        setTimeout: (fn) => { pending = fn; },
        endDuel: (won, reason) => calls.endDuel.push(reason)
    };
    Object.defineProperty(scope, 'duel', { get: () => state.duel });
    Object.defineProperty(scope, 'duelActive', { get: () => state.duelActive });
    Object.defineProperty(scope, 'race', { get: () => state.race });

    const factory = new Function(
        'scope',
        `with (scope) { ${helperBlock}; return { opponentConfirmedGone, onLobbyOpponentLeft }; }`
    );
    return {
        api: factory(scope),
        state,
        calls,
        fire: () => { const fn = pending; pending = null; if (fn) fn(); },
        hasPending: () => !!pending
    };
}

function presenceDuel(keys) {
    const presence = {};
    for (const k of keys) presence[k] = [{ player_name: k }];
    return { presenceKey: 'me', channel: { presenceState: () => presence } };
}

const settlePromises = async () => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

{
    const h = presenceHarness();
    h.state.duelActive = true;
    h.state.duel = presenceDuel(['me', 'opp']); // opp re-tracked within the beat
    h.api.onLobbyOpponentLeft();
    check('a leave schedules a presence confirmation', h.hasPending());
    h.fire();
    await settlePromises();
    check(
        'a re-tracked opponent does NOT end the duel mid-countdown',
        h.calls.endDuel.length === 0,
        JSON.stringify(h.calls.endDuel)
    );
}

{
    const h = presenceHarness();
    h.state.duelActive = true;
    h.state.duel = presenceDuel(['me']); // really gone
    h.api.onLobbyOpponentLeft();
    h.fire();
    await settlePromises();
    check(
        'a genuine departure still ends the duel as a disconnect',
        h.calls.endDuel.length === 1 && h.calls.endDuel[0] === 'disconnect',
        JSON.stringify(h.calls.endDuel)
    );
}

{
    const h = presenceHarness();
    h.state.duelActive = true;
    h.state.race = { over: false }; // FIGHT already happened
    h.api.onLobbyOpponentLeft();
    check('in-match leaves stay with DuelRace (no timer, no endDuel)',
        !h.hasPending() && h.calls.endDuel.length === 0);
}

{
    const h = presenceHarness();
    h.state.duelActive = true;
    h.state.duel = presenceDuel(['me']);
    h.api.onLobbyOpponentLeft();
    h.state.duel = presenceDuel(['me', 'someone-else']); // rematch took over
    h.fire();
    await settlePromises();
    check('a duel that took over while waiting is left alone', h.calls.endDuel.length === 0);
}

{
    const h = presenceHarness();
    h.api.onLobbyOpponentLeft();
    check('an idle client ignores the leave', !h.hasPending() && h.calls.endDuel.length === 0);
}

{
    const h = presenceHarness();
    h.state.duelActive = true;
    h.state.duel = { presenceKey: 'me', channel: null }; // channel already gone
    h.api.onLobbyOpponentLeft();
    h.fire();
    await settlePromises();
    check('a torn-down channel ends cleanly instead of wedging',
        h.calls.endDuel.length === 1 && h.calls.endDuel[0] === 'disconnect');
}

{
    const h = presenceHarness();
    h.state.duelActive = true;
    h.state.duel = {
        presenceKey: 'me',
        channel: { presenceState: () => { throw new Error('socket closed'); } }
    };
    h.api.onLobbyOpponentLeft();
    h.fire();
    await settlePromises();
    check('a throwing presenceState never wedges the match', h.calls.endDuel.length === 1);
}

console.log(
    failures === 0
        ? '\nAll duel presence/countdown guards and behaviours verified.'
        : `\n${failures} check(s) failed — the countdown crash can come back.`
);
process.exit(failures === 0 ? 0 : 1);
