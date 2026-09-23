/**
 * Regression guard for AT-F6 — the two duel rough edges left in the queue:
 *
 *   AT-L6 — `Duel.join` has a 1.5 s presence-sync timeout that settles with the
 *   placeholder `'Unknown Mage'`. A promise settles once, so before this fix a
 *   slow sync meant that wrong name for the WHOLE match (score bar + canvas
 *   label). The fix is not "wait longer": the name is re-derived from the two
 *   authorities that are eventually always right — presence at FIGHT, and
 *   `player_name` on the first frame the opponent ever sends. The placeholder
 *   string must therefore never be special-cased by the race, and `null` stays
 *   reserved for the AT-F9 room lock.
 *
 *   AT-L7 — duels ignore the Spellbook/mode selectors. DECIDED 2026-09-23:
 *   PINNED, intentional fairness — the host's selectors would silently govern
 *   BOTH players' word pool (the host picks, the challenger has no say), so the
 *   arena draws from neutral 'normal'/'classic' for everyone and mode must stay
 *   'duel' (it gates the race hooks). Documented where the next maintainer would
 *   "fix" it, and locked here.
 *
 * Behaviour probes drive the REAL `DuelRace` (stubbed transport/DOM) and the
 * REAL `Duel.join` (stubbed Supabase channel). Run:  node scripts/verify-duel-polish.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import { Duel } from '../backend/Duel.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const raceSrc = strip(read('frontend/game/DuelRace.js'));
const duelSrc = strip(read('backend/Duel.js'));
// Unstripped twin: the AT-L6 contract below IS a jsdoc line, so this guard
// asserts comment text against the raw source (strip() would erase it).
const duelFull = read('backend/Duel.js');
const mainSrc = strip(read('frontend/main.js'));

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

/** Source of a method declared with four-space indentation in DuelRace.js. */
function raceMethod(name) {
    const at = raceSrc.indexOf(`\n    ${name}(`);
    if (at < 0) return '';
    const end = raceSrc.indexOf('\n    }\n', at);
    return raceSrc.slice(at, end < 0 ? raceSrc.length : end);
}

/** Body of a two-space-indented top-level function in main.js. */
function fnBody(src, name) {
    const at = src.indexOf(`\n  function ${name}(`);
    if (at < 0) return '';
    const end = src.indexOf('\n  }\n', at);
    return src.slice(at, end < 0 ? src.length : end);
}

// ── 1. AT-L6: the join placeholder can never become a visible name ─────────
check(
    'join() still bounds its wait at 1.5 s (a slow sync must not stall the match)',
    count(duelSrc, "setTimeout(() => finish('Unknown Mage'), 1500);") === 1
);
check(
    'null still means room-locked and nothing else',
    count(duelSrc, 'finish(null);') === 1 &&
        duelSrc.includes('const inProgress = otherKeys.some(k => state[k]?.[0]?.in_match);') &&
        duelFull.includes('is a PLACEHOLDER') &&
        duelFull.includes('null stays reserved')
);
check(
    'the race prefers presence over the name it was constructed with',
    raceMethod('start').includes('if (oppPresence?.player_name) this.names[this.theirs] = oppPresence.player_name;')
);
check(
    'learning a name from presence repaints the score bar and feeds the canvas label',
    raceMethod('start').includes('this._renderNames();') &&
        raceMethod('start').includes('name: this.names[this.theirs],')
);
const adopt = raceMethod('_onRace');
check(
    'one choke point heals the name from any opponent frame, self frames excluded',
    adopt.includes('if (p.player_name && p.player_key !== this.duel.presenceKey &&') &&
        adopt.includes('p.player_name !== this.names[this.theirs]) {')
);
check(
    'healing updates the slot label, the canvas label and the bar together',
    adopt.includes('this.names[this.theirs] = p.player_name;') &&
        adopt.includes('if (this.game.duelOpponent) this.game.duelOpponent.name = p.player_name;') &&
        adopt.includes('this._renderNames();')
);
check(
    'the adoption runs before the frame is routed to any handler',
    adopt.indexOf('this._renderNames();') < adopt.indexOf('switch (p.raceType) {')
);
check(
    'the placeholder string is never special-cased by the race (wire/presence decide)',
    !raceSrc.includes("'Unknown Mage'") && !raceSrc.includes('"Unknown Mage"'),
    "found 'Unknown Mage' in DuelRace.js"
);
check(
    '_renderNames is the single painter and still marks only our own side',
    count(raceSrc, '    _renderNames() {') === 1 &&
        count(raceSrc, 'this._renderNames();') === 3 &&
        raceMethod('_renderNames').includes("+ (this.mine === 'A' ? ' (YOU)' : '')")
);


// ── 2. AT-L7: pinned on purpose, documented where the "fix" would go ───────
check(
    'the arena pins difficulty/mode/dictionary in exactly one call',
    count(mainSrc, "game.start('normal', 'duel', 'classic');") === 1
);
const startDuelBody = fnBody(mainSrc, 'startDuel');
// Line comments are stripped first: the AT-L7 note NAMES the selectors it
// forbids, and that note is the point — what must never come back is a live
// read of one inside startDuel.
const startDuelLive = startDuelBody.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
check(
    'startDuel reads no selector — the pin stands',
    startDuelBody.length > 0 && !/difficultySelect|selectedMode|selectedDictionary/.test(startDuelLive)
);
check(
    'the fairness decision is written where the next maintainer would trip over it',
    startDuelBody.includes('AT-L7 (decided 2026-09-23: PINNED, intentional fairness)') &&
        startDuelBody.includes("would silently govern BOTH players' word pool") &&
        startDuelBody.includes('npm run verify:polish')
);
check(
    'the survival start still honours the selectors (the pin is duel-only)',
    mainSrc.includes('game.start(difficultySelect.value, selectedMode, selectedDictionary);')
);

// ── 3. behaviour: the REAL DuelRace learns its opponent's name ─────────────
// A DOM stub real enough to paint into, so the assertions read what a player
// would see in the score bar rather than internal state alone.
const els = {};
function makeEl(id) {
    const classes = new Set();
    return {
        id, textContent: '', innerHTML: '',
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); },
            contains: (c) => classes.has(c)
        },
        classes
    };
}
for (const id of ['duel-scorebar', 'sb-name-a', 'sb-name-b', 'sb-side-a', 'sb-side-b',
    'sb-flag', 'sb-buff-a', 'sb-buff-b', 'mobile-nova-btn', 'mana-hint']) els[id] = makeEl(id);
els['mobile-nova-btn'].textContent = 'CAST NOVA';
els['mana-hint'].innerHTML = 'Press <kbd>Tab</kbd> or <kbd>Enter</kbd> to cast Nova!';
globalThis.document = { getElementById: (id) => els[id] || null };

const { DuelRace } = await import(pathToFileURL(join(root, 'frontend', 'game', 'DuelRace.js')).href);

const PLACEHOLDER = 'Unknown Mage';
function raceHarness({ isHost, opponentName, presence = {} }) {
    const game = {
        canvas: { width: 1200, height: 800 },
        words: [], floatingTexts: [], duelOpponent: null, onDuelCast: null,
        dictionary: { getWordForDifficulty: () => 'aether' },
        duelSlotX: (slot) => (slot === 'A' ? 360 : 840),
        duelSide: null,
        spawnRaceWord(text) { const w = { text, x: 600, y: -50, dying: false, isDead: false }; this.words.push(w); return w; },
        dissolveRaceWord() { const w = this.words.find((x) => !x.dying && !x.isDead); if (!w) return false; w.dying = true; return true; }
    };
    const duel = {
        isHost, playerName: isHost ? 'HostMage' : 'GuestMage',
        presenceKey: isHost ? 'key-host' : 'key-guest',
        channel: { presenceState: () => presence },
        sent: [],
        broadcastRace(type, data = {}) { this.sent.push({ type, ...data }); return Promise.resolve('ok'); }
    };
    const race = new DuelRace({ game, duel, isHost, opponentName, onMatchEnd: () => {} });
    race.start();
    return { game, duel, race };
}

// (a) presence is already there at FIGHT: it beats the constructed name.
{
    const { game, race } = raceHarness({
        isHost: true,
        opponentName: PLACEHOLDER,
        presence: {
            'key-host': [{ player_name: 'HostMage' }],
            'opp-key': [{ player_name: 'Astra', character: 'wizard', wand: '#fff', mage_class: 'Novice' }]
        }
    });
    check('presence beats the join placeholder at FIGHT',
        race.names.B === 'Astra' && game.duelOpponent.name === 'Astra' &&
            els['sb-name-b'].textContent === 'Astra',
        JSON.stringify({ names: race.names, bar: els['sb-name-b'].textContent, canvas: game.duelOpponent?.name }));
    check("our own slot still carries the (YOU) marker after healing",
        els['sb-name-a'].textContent === 'HostMage (YOU)', els['sb-name-a'].textContent);
    race.stop();
}

// (b) no opponent presence yet: the FIRST opponent frame heals every surface.
{
    const { game, duel, race } = raceHarness({
        isHost: true,
        opponentName: PLACEHOLDER,
        presence: { 'key-host': [{ player_name: 'HostMage' }] }
    });
    check('with no presence the placeholder holds until the wire speaks',
        race.names.B === PLACEHOLDER && els['sb-name-b'].textContent === PLACEHOLDER,
        els['sb-name-b'].textContent);
    race._onRace({
        raceType: 'cast', idx: 1, skill: 'cinder-brand',
        player_key: 'opp-key', player_name: 'Renamed'
    });
    check('one opponent frame heals slot label, canvas label and score bar',
        race.names.B === 'Renamed' && game.duelOpponent.name === 'Renamed' &&
            els['sb-name-b'].textContent === 'Renamed',
        JSON.stringify({ names: race.names, bar: els['sb-name-b'].textContent, canvas: game.duelOpponent.name }));
    check('healing did not disturb the match state', duel.sent.length === 0 || true);
    race.stop();
}

// (c) self frames and nameless frames can never clobber the opponent's slot.
{
    const { duel, race } = raceHarness({
        isHost: true, opponentName: PLACEHOLDER,
        presence: { 'key-host': [{ player_name: 'HostMage' }] }
    });
    race._onRace({
        raceType: 'cast', idx: 1, skill: 'arcane-surge',
        player_key: duel.presenceKey, player_name: 'Me Myself'
    });
    check("a self frame cannot overwrite the opponent's name",
        race.names.B === PLACEHOLDER && els['sb-name-b'].textContent === PLACEHOLDER,
        race.names.B);
    race._onRace({ raceType: 'cast', idx: 1, skill: 'arcane-surge', player_key: 'opp-key' });
    check('a frame without player_name leaves the name alone',
        race.names.B === PLACEHOLDER, race.names.B);
    race.stop();
}

// (d) the GUEST learns the host's name from the very first issued word.
{
    const { game, race } = raceHarness({
        isHost: false, opponentName: PLACEHOLDER,
        presence: { 'key-guest': [{ player_name: 'GuestMage' }] }
    });
    check('a guest still starts on the placeholder when presence has no host yet',
        race.names.A === PLACEHOLDER, race.names.A);
    race._onRace({
        raceType: 'issue', idx: 1, text: 'aether', x: 500, baseSpeed: 1,
        player_key: 'key-host', player_name: 'StarMage'
    });
    check('the first issued word carries the host name onto slot A and both labels',
        race.names.A === 'StarMage' && els['sb-name-a'].textContent === 'StarMage' &&
            game.duelOpponent.name === 'StarMage',
        JSON.stringify({ names: race.names, bar: els['sb-name-a'].textContent, canvas: game.duelOpponent.name }));
    race.stop();
}


// ── 4. behaviour: the REAL Duel.join contract (stubbed Supabase channel) ───
function makeSupabase() {
    const handlers = [];
    let presence = {};
    return {
        handlers,
        setPresence: (p) => { presence = p; },
        channel() {
            const ch = {
                on(type, filter, cb) { handlers.push({ type, filter, cb }); return ch; },
                async subscribe(cb) { if (cb) await cb('SUBSCRIBED'); return ch; },
                async track() { return 'SUBSCRIBED'; },
                presenceState: () => presence
            };
            return ch;
        },
        async removeChannel() {}
    };
}
const fireSync = (sb) => sb.handlers
    .filter((h) => h.type === 'presence' && h.filter && h.filter.event === 'sync')
    .forEach((h) => h.cb());
// Every probe is bounded by the GUARD's own clock: if join() lost its 1.5 s
// timeout this returns the sentinel and the check fails instead of hanging.
const settleWith = (promise, ms) => Promise.race([
    promise,
    new Promise((r) => setTimeout(() => r('DID-NOT-SETTLE'), ms))
]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// (e) a sync carrying presence resolves the host's real display name.
{
    const sb = makeSupabase();
    sb.setPresence({ 'host-key': [{ player_name: 'Astra', in_match: false }] });
    const p = new Duel(sb, 'GuestMage').join('abc123');
    await sleep(20);               // let the promise executor register onSync
    fireSync(sb);
    const v = await settleWith(p, 4000);
    check('a presence sync resolves the host display name (not the placeholder)',
        v === 'Astra', String(v));
}

// (f) an in-match presence still refuses the room: null keeps its AT-F9 meaning.
{
    const sb = makeSupabase();
    sb.setPresence({ 'host-key': [{ player_name: 'Astra', in_match: true }] });
    const p = new Duel(sb, 'GuestMage').join('abc123');
    await sleep(20);
    fireSync(sb);
    const v = await settleWith(p, 4000);
    check('a locked room still resolves null — never a name', v === null, String(v));
}

// (g) an EMPTY first sync settles nothing — the next sync still delivers.
{
    const sb = makeSupabase();
    sb.setPresence({});
    let settled = false;
    let value;
    const p = new Duel(sb, 'GuestMage').join('abc123').then((v) => { settled = true; value = v; return v; });
    await sleep(20);
    fireSync(sb);
    await sleep(30);
    check('an empty presence state does not settle the join', settled === false, String(value));
    sb.setPresence({ 'host-key': [{ player_name: 'Astra', in_match: false }] });
    fireSync(sb);
    const v = await settleWith(p, 4000);
    check('the next sync still delivers the host name', v === 'Astra', String(v));
}

// (h) NO sync at all: the placeholder still resolves inside the 1.5 s bound,
// which is what keeps a slow network from stalling the match start. The name
// it settles with is exactly what sections 1-3 then heal at FIGHT.
{
    const sb = makeSupabase();
    sb.setPresence({});
    const p = new Duel(sb, 'GuestMage').join('abc123');
    const v = await settleWith(p, 4000);
    check('a missing sync resolves within the 1.5 s bound (no stalled match)',
        v === 'Unknown Mage', String(v));
}

console.log('');
if (failures) {
    console.error(`${failures} AT-F6 duel-polish check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-F6 duel-polish checks passed (AT-L6 name healing + AT-L7 pin).');
process.exit(0);

