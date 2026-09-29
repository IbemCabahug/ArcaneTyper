/**
 * Regression guard for AT-F19 — rematch must be a MUTUAL agreement.
 *
 * Defect 1 (owner-reported): pressing REMATCH on the result screen opened the
 * Arena lobby on the clicker's machine alone. The handler sent no frame and
 * never referenced the opponent, so "REMATCH" actually meant "I would like
 * another match" while only the clicker acted on it.
 *
 * Defect 2 (found while fixing 1): `.duel-result-rematch` / `.duel-result-return`
 * each carried ONE class, tying with `.primary-btn`, which then won on source
 * order and overwrote their background/color/border — so the intended gold vs
 * grey contrast rendered as two identical outlined buttons.
 *
 * main.js is DOM-bound and cannot be imported, so this guard works in two halves
 * exactly like verify-duel-presence-guards.mjs:
 *   1. source invariants (the consent machine exists and is wired), and
 *   2. a behavioural probe that slices the real rematch state machine out of
 *      main.js and drives it against a stub Duel — proving neither player's
 *      press starts a match without the other's agreement.
 * Run:  node scripts/verify-rematch-consent.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(join(root, 'frontend', 'main.js'), 'utf8');
const duelSrc = readFileSync(join(root, 'backend', 'Duel.js'), 'utf8');
const html = readFileSync(join(root, 'frontend', 'index.html'), 'utf8');
const css = readFileSync(join(root, 'frontend', 'style.css'), 'utf8');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

console.log('--- AT-F19 part 1: the consent machine exists (source invariants) ---');

// The original bug: a handler that only ever opened the lobby locally.
check('the old local-only rematch handler is gone',
    !/rematchBtn\.addEventListener\('click'[\s\S]{0,400}openDuelLobby\(\)/.test(src) &&
    !/duel-rematch-btn'\)\.addEventListener[\s\S]{0,400}openDuelLobby\(\)/.test(src),
    'a REMATCH handler still calls openDuelLobby() without asking the opponent');

// A SECOND click listener on the same button re-introduces the original bug
// just as effectively: the lobby opens locally while the consent UI also runs.
// This is the hole a first version of this guard had — it verified the NEW
// handler was correct but never that it was the ONLY one, so appending the old
// handler alongside it turned the suite fully green.
check('REMATCH has exactly ONE click listener (a second one revives the bug)',
    (src.match(/rematchBtn\.addEventListener\('click'/g) || []).length === 1,
    `found ${(src.match(/rematchBtn\.addEventListener\('click'/g) || []).length} listeners`);
check('no REMATCH listener anywhere re-opens the lobby',
    !/addEventListener\('click'[\s\S]{0,400}openDuelLobby\(\)/.test(
        src.slice(src.indexOf('// Propose a rematch'))),
    'the consent block must not fall through to openDuelLobby()');

check('pressing REMATCH broadcasts a request frame',
    /rematchBtn\.addEventListener[\s\S]{0,600}?broadcastRematch\('request'\)/.test(src));

check('a request only shows a waiting state — it starts nothing',
    /showRematchPending\(\);[\s\S]{0,120}?broadcastRematch\('request'\)/.test(src) &&
    !/rematchBtn\.addEventListener[\s\S]{0,600}?startDuel\(/.test(src),
    'the REMATCH press handler calls startDuel() directly');

for (const [label, id] of [['accept', 'duel-rematch-accept-btn'], ['decline', 'duel-rematch-decline-btn']]) {
    check(`the ${label} control exists in the markup`, html.includes(`id="${id}"`));
    check(`the ${label} control is wired in main.js`, src.includes(`'${id}'`));
}

check('both answer buttons broadcast their action',
    /broadcastRematch\('accept'\)/.test(src) && /broadcastRematch\('decline'\)/.test(src));

// Authority: exactly one side may mint the room code, or the two players can end
// up in different rooms both believing they are rematching.
check('only the host mints the next room code',
    /if \(!link\.isHost\) return;[\s\S]{0,200}?newRoomCode\(\)/.test(src),
    'the accept path must refuse to mint for a non-host');
check('a guest ignores a `start` frame it should not follow',
    /case 'start':\s*\n\s*if \(link\.isHost\) return;/.test(src));
check('a `start` frame is the only thing that re-enters a room',
    /case 'start':[\s\S]{0,200}?enterRematchRoom\(payload\.roomCode, false/.test(src));
check('an offer cannot stack (a second request while negotiating is ignored)',
    /case 'request':[\s\S]{0,160}?if \(rematchState !== 'idle'\) return;/.test(src));


// Transport: the handshake is impossible without a retained channel.
check('endDuel RETAINS the channel instead of dropping it',
    /const retainable = reason !== 'disconnect';[\s\S]{0,300}?rematchLink = parting;/.test(src),
    'endDuel must keep a handle for the rematch handshake');
check('a disconnect-ended match still disconnects (no leaked channel)',
    /} else {\s*\n\s*parting\.disconnect\(\);/.test(src));
check('RETURN TO LIBRARY releases the retained channel',
    /duelResultCloseBtn\.addEventListener[\s\S]{0,900}?held\.disconnect\(\)/.test(src));
check('an opponent leaving the result screen drops the retained channel',
    /rematchOpponentConfirmedGone\(parting\)\.then/.test(src) &&
    /const wasAsking = rematchState === 'pending'/.test(src) &&
    /'Your opponent left before answering\.'/.test(src),
    'the leave path must confirm presence and tell the asker why the offer vanished');

// AT-F9's lesson, restated for the retained channel: Supabase emits a transient
// `leave` whenever a client re-tracks, and `refreshPresence()` fires on every
// visibilitychange. Acting on the raw event tore the channel down on a mere tab
// switch, so REMATCH then claimed the opponent had left while they sat there.
check('the leave path confirms presence STATE after a settle beat (AT-F9 rule)',
    /function rematchOpponentConfirmedGone\(watched\)/.test(src) &&
    /PRESENCE_SETTLE_MS\);/.test(src) &&
    /watched\.channel\.presenceState\(\)/.test(src),
    'acting on the raw leave EVENT re-introduces the AT-F9 countdown bug');
check('the confirmation ignores a handle that was replaced or promoted',
    /if \(rematchLink !== watched \|\| rematchState === 'starting'\) \{\s*\n\s*resolve\(false\);/.test(src),
    'a stale confirmation could tear down a NEWER rematch or a live match');
check('an offer cannot wait forever (a TTL lapses it)',
    /REMATCH_OFFER_TTL_MS/.test(src) && /rematchTimer = setTimeout/.test(src));

// The retained handle must NOT be the live `duel`, or a dozen `duel === null`
// guards would silently stop meaning "no match in progress".
check('the retained channel is kept OUT of the `duel` handle',
    /rematchLink = parting;/.test(src) && !/duel = parting;/.test(src),
    'assigning the retained channel to `duel` would revive the torn-down guards');
check('the rematch handler is bound at match start, not re-bound per rematch',
    /duel\.onRematch = \(payload\) => onRematchFrame\(payload\);/.test(src));

console.log('\n--- AT-F19 part 1b: Duel exposes the transport ---');
check('Duel broadcasts a rematch frame', /broadcastRematch\(action, data = \{\}\)/.test(duelSrc));
check('the rematch frame is namespaced as its own event',
    /type: 'broadcast',\s*\n\s*event: 'rematch'/.test(duelSrc));
check('a rematch frame carries the sender key (so echoes are ignorable)',
    /event: 'rematch',[\s\S]{0,200}?player_key: this\.presenceKey/.test(duelSrc));
check('Duel ignores its own rematch frames',
    /event: 'rematch'[\s\S]{0,220}?if \(payload\.player_key === this\.presenceKey\) return;/.test(duelSrc));
check('rehome() re-subscribes to a new room code', /async rehome\(newRoomCode, asHost\)/.test(duelSrc));
check('rehome() clears the stale room lock (a fresh code must accept its challenger)',
    /this\.inMatch = false;[\s\S]{0,120}?await this\._subscribe\(\)/.test(duelSrc));

// The original second defect: one class each, tying with .primary-btn, which
// then won on source order and flattened both.
check('the REMATCH/RETURN rules outrank .primary-btn (specificity fix)',
    /\.duel-result-actions \.duel-result-rematch/.test(css) &&
    /\.duel-result-actions \.duel-result-return/.test(css),
    'an unqualified single-class rule loses to .primary-btn on source order');
check('the REMATCH rule sets a colour .primary-btn would otherwise overwrite',
    /\.duel-result-actions \.duel-result-rematch[\s\S]{0,300}?color:/.test(css) &&
    /\.duel-result-actions \.duel-result-rematch[\s\S]{0,300}?background:/.test(css));
check('the RETURN rule is explicitly muted',
    /\.duel-result-actions \.duel-result-return[\s\S]{0,300}?color: var\(--text-muted\)/.test(css));
check('the two result buttons resolve to different colours',
    /\.duel-result-actions \.duel-result-rematch[\s\S]{0,300}?#ffd700/.test(css) &&
    !/\.duel-result-actions \.duel-result-rematch[\s\S]{0,300}?--text-muted/.test(css),
    'REMATCH and RETURN resolve to the same colour');

console.log('\n--- AT-F19 part 2: behaviour — no match starts without agreement ---');

// Slice the real state machine out of main.js and run it against a stub Duel
// and stub DOM, so this exercises shipped code rather than a restatement.
function slice(startNeedle, endNeedle) {
    const a = src.indexOf(startNeedle);
    if (a === -1) return null;
    const b = src.indexOf(endNeedle, a);
    if (b === -1) return null;
    return src.slice(a, b + endNeedle.length);
}

// Slice the whole rematch block — from `releaseRematchLink` (the first helper
// the block owns) to the end of the DECLINE listener — so the extracted source
// is syntactically complete AND self-contained.
//
// `lastIndexOf` matters: `broadcastRematch('decline')` also appears in the CANCEL
// handler, and the first match truncates the slice before accept/decline are
// even registered — the harness then silently binds no handlers at all.
const DECLINE_END = "if (link) link.broadcastRematch('decline');\n  });";
const machine = (() => {
    const a = src.indexOf('function releaseRematchLink()');
    if (a === -1) return null;
    const b = src.lastIndexOf(DECLINE_END);
    if (b === -1) return null;
    return src.slice(a, b + DECLINE_END.length);
})();
check('the rematch state machine could be sliced out of main.js', !!machine);
check('the slice is self-contained (it carries its own timer helper)',
    /function clearRematchTimer\(\)/.test(machine || ''));
// A truncated slice parses but binds nothing, so assert the handlers survived.
check('the slice carries all four consent listeners',
    ['rematchBtn', 'rematchCancelBtn', 'rematchAcceptBtn', 'rematchDeclineBtn']
        .every((b) => new RegExp(`${b}\\.addEventListener`).test(machine || '')),
    'a slice that ends early still parses, so this catches a silent truncation');

const el = () => ({ hidden: false, disabled: false, textContent: '', innerText: '' });
const mkNodes = () => ({
    rematchPending: el(), rematchInbound: el(), rematchConsent: el(),
    rematchAsker: el(), rematchPendingText: el(), rematchBtn: el(),
});
const mkCalls = () => ({ startDuel: 0, disconnect: 0, toast: [] });

// A button stand-in that records the click handler the machine registers, so a
// test can fire it exactly as a player would.
function mkButton() {
    const b = el();
    b.addEventListener = (evt, fn) => { if (evt === 'click') b.__press = fn; };
    b.press = () => b.__press && b.__press();
    return b;
}

/**
 * Build a harness around the REAL machine source.
 * `withLink: false` models the opponent already being gone — the case the
 * shipped button swallowed silently.
 */
function makeHarness({ isHost, withLink = true }) {
    const sent = [];
    const calls = mkCalls();
    const nodes = mkNodes();
    const link = {
        isHost,
        roomCode: 'AAAAAA',
        newRoomCode: () => 'NEWCODE',
        broadcastRematch: (action, data = {}) => sent.push({ action, ...data }),
        rehome: async (code, asHost) => { link.roomCode = code; link.isHost = asHost; },
        disconnect: () => { calls.disconnect++; },
    };

    // The machine references these by name; the stubs provide the scope it
    // expects. `calls` is captured so startDuel/ MagicalToast are observable.
    const body = `
      let rematchLink = ${withLink ? 'LINK' : 'null'};
      let rematchState = 'idle', rematchOpponentName = '', rematchTimer = null;
      const REMATCH_OFFER_TTL_MS = 20000;
      const rematchPending = N.rematchPending, rematchInbound = N.rematchInbound,
            rematchConsent = N.rematchConsent, rematchAsker = N.rematchAsker,
            rematchPendingText = N.rematchPendingText, rematchBtn = B.rematch,
            rematchCancelBtn = B.cancel, rematchAcceptBtn = B.accept,
            rematchDeclineBtn = B.decline;
      const MagicalToast = { show: (m) => calls.toast.push(m) };
      const nodes = N, buttons = B, sent = SENT;
      let duel = null;
      function startDuel() { calls.startDuel++; }
      ${machine}
      // enterRematchRoom is async and onRematchFrame does not await it, so a
      // test must let the microtask queue drain before asserting on startDuel.
      const settle = () => new Promise(r => setImmediate(r));
      return { nodes, sent, calls, buttons, settle, state: () => rematchState,
               link: () => rematchLink, duel: () => duel,
               frame: (p) => onRematchFrame(p) };
    `;

    const buttons = { rematch: mkButton(), cancel: mkButton(), accept: mkButton(), decline: mkButton() };
    const factory = new Function('LINK', 'N', 'B', 'calls', 'SENT', body);
    return factory(link, nodes, buttons, calls, sent);
}

(async () => {
if (machine) {
    // ── the original defect, replayed ──
    const host = makeHarness({ isHost: true });
    host.buttons.rematch.press();
    await host.settle();

    check('pressing REMATCH does NOT start a match (the original defect)',
        host.calls.startDuel === 0, `startDuel ran ${host.calls.startDuel}x on one press`);
    check('pressing REMATCH asks the opponent instead',
        host.sent.some(f => f.action === 'request'));
    check('pressing REMATCH shows a waiting state',
        host.state() === 'pending' && host.nodes.rematchPending.hidden === false);
    check('REMATCH is disabled while an offer is out',
        host.nodes.rematchBtn.disabled === true || host.buttons.rematch.disabled === true);
    check('a second REMATCH press while waiting is ignored',
        (() => { const n = host.sent.length; host.buttons.rematch.press(); return host.sent.length === n; })(),
        'a double-click could stack a second offer');

    // ── the opponent accepts: the HOST mints, both re-enter ──
    const hostAccept = makeHarness({ isHost: true });
    hostAccept.buttons.rematch.press();
    await hostAccept.settle();
    hostAccept.frame({ player_key: 'peer', player_name: 'Rival', action: 'accept' });
    await hostAccept.settle();
    check('when the opponent accepts, the host mints a new room code',
        hostAccept.sent.some(f => f.action === 'start' && f.roomCode === 'NEWCODE'));
    check('the accepting host re-enters the match exactly once',
        hostAccept.calls.startDuel === 1, `startDuel ran ${hostAccept.calls.startDuel}x`);

    // ── decline ──
    const hostDecline = makeHarness({ isHost: true });
    hostDecline.buttons.rematch.press();
    hostDecline.frame({ player_key: 'peer', player_name: 'Rival', action: 'decline' });
    check('a declined offer starts nothing', hostDecline.calls.startDuel === 0);
    check('a declined offer returns the asker to a clean state',
        hostDecline.state() === 'idle' && hostDecline.nodes.rematchConsent.hidden === true);

    // ── inbound: they asked, we answer ──
    const guest = makeHarness({ isHost: false });
    guest.frame({ player_key: 'peer', player_name: 'Rival', action: 'request' });
    check('an inbound request shows the answer prompt, not a match',
        guest.state() === 'inbound' && guest.nodes.rematchInbound.hidden === false &&
        guest.calls.startDuel === 0);
    check('the inbound prompt names the asker',
        guest.nodes.rematchAsker.textContent === 'Rival');

    // A guest accepting must NOT mint — only the host may.
    const guestAccept = makeHarness({ isHost: false });
    guestAccept.frame({ player_key: 'peer', player_name: 'Rival', action: 'request' });
    await guestAccept.settle();
    guestAccept.buttons.accept.press();
    await guestAccept.settle();
    check('a guest accepting does NOT mint its own room',
        !guestAccept.sent.some(f => f.action === 'start'),
        'both sides minting would put them in different rooms');
    check('a guest accepting signals agreement and waits for the host',
        guestAccept.sent.some(f => f.action === 'accept') && guestAccept.calls.startDuel === 0);

    // A guest that receives `accept` must stay put (the host mints).
    const guestSawAccept = makeHarness({ isHost: false });
    guestSawAccept.frame({ player_key: 'peer', action: 'accept' });
    check('a guest that receives `accept` does not start anything',
        !guestSawAccept.sent.some(f => f.action === 'start') &&
        guestSawAccept.calls.startDuel === 0);

    // A guest that receives `start` follows it.
    const guestStart = makeHarness({ isHost: false });
    guestStart.frame({ player_key: 'peer', action: 'start', roomCode: 'NEWCODE' });
    await guestStart.settle();
    check('a guest follows the host `start` frame into the new room',
        guestStart.calls.startDuel === 1 && guestStart.duel().roomCode === 'NEWCODE');
    check('the guest is still the guest after rehoming',
        guestStart.duel().isHost === false, 'a swapped isHost would invert host arbitration');
    check('the retained handle is handed over, not duplicated',
        guestStart.link() === null && guestStart.duel() !== null,
        'a retained handle left behind would leak a second channel');

    // A host must never follow a `start` frame.
    const hostStart = makeHarness({ isHost: true });
    hostStart.frame({ player_key: 'peer', action: 'start', roomCode: 'OTHER' });
    check('a host ignores a `start` frame (it is the one who mints)',
        hostStart.calls.startDuel === 0 && hostStart.link().roomCode === 'AAAAAA');

    // Cancelling withdraws the offer.
    const cancel = makeHarness({ isHost: true });
    cancel.buttons.rematch.press();
    cancel.buttons.cancel.press();
    check('cancelling withdraws the offer and signals the opponent',
        cancel.state() === 'idle' && cancel.sent.some(f => f.action === 'decline'));

    // ── no retained channel: the button must not lie ──
    const orphan = makeHarness({ isHost: true, withLink: false });
    orphan.buttons.rematch.press();
    check('with no opponent connected, REMATCH starts nothing and says so',
        orphan.calls.startDuel === 0 && orphan.calls.toast.length > 0,
        'the button must explain itself rather than silently doing nothing');
}

    // ── the owner's scenario: P1 wants a rematch, P2 has already left ──
    // A leave is NOT trusted directly: a re-track (alt-tab back to the result
    // screen) emits a transient leave, so presence STATE decides.
    const confirmSrc = src.slice(
        src.indexOf('function rematchOpponentConfirmedGone(watched)'),
        src.indexOf('function onLobbyOpponentLeft()'));
    check('the presence confirmation helper could be sliced out', confirmSrc.length > 0);

    if (confirmSrc) {
        // Build a stub channel whose presenceState() returns the given keys.
        const linkWith = (others) => ({
            presenceKey: 'me',
            channel: { presenceState: () => others },
        });
        // NOTE: the generated function's own args are (PRESENCE_SETTLE_MS, LINK),
        // so it must be invoked with BOTH — wrapping it in a helper that only
        // forwards one silently leaves LINK undefined, which makes the helper
        // short-circuit to `true` and the test assert the wrong thing.
        const settlePresence = () => new Function('PRESENCE_SETTLE_MS', 'LINK', `
            let rematchLink = LINK, rematchState = 'idle';
            ${confirmSrc}
            return rematchOpponentConfirmedGone(LINK);
        `);

        // The alt-tab re-track case: `leave` fired, but the opponent is present.
        const stillHere = await settlePresence()(0, linkWith({ me: [{}], peer: [{}] }));
        check('a transient leave (opponent still present) does NOT drop the channel',
            stillHere === false,
            'a tab switch would tear down the rematch and wrongly report the opponent gone');

        // A real departure: the opponent's presence key is genuinely absent.
        const trulyGone = await settlePresence()(0, linkWith({ me: [{}] }));
        check('a real departure (opponent absent) DOES drop the channel',
            trulyGone === true);

        // A confirmation resolving after the handle was replaced must not act.
        const stale = await new Function('PRESENCE_SETTLE_MS', 'LINK', 'OTHER', `
            let rematchLink = OTHER, rematchState = 'idle';
            ${confirmSrc}
            return rematchOpponentConfirmedGone(LINK);
        `)(0, linkWith({ me: [{}] }), linkWith({ me: [{}] }));
        check('a confirmation for a replaced handle does not act',
            stale === false,
            'a stale confirmation could tear down a NEWER rematch');
    }

console.log(`\n${failures === 0
    ? 'All AT-F19 rematch-consent checks passed.'
    : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
})();

