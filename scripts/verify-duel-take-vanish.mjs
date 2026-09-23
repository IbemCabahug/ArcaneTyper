/**
 * Regression guard for the AT-F9 P3 arena fixes (owner-reported 2026-09-23):
 *
 *  (1) VANISH — "when the word is already been typed by the other player, it
 *      should also vanish in the 2nd player screen". A claimed word used to
 *      keep falling on the loser's screen until the next issue landed (or
 *      shattered on their own mage), which read as a stolen word still being
 *      live. A claim now broadcasts `taken` and the loser dissolves it at once.
 *      Related hang: once the loser's word is gone they can never claim, so
 *      "resolve when both claims are in" would park the lane forever — the host
 *      now arbitrates inside CLAIM_WINDOW_MS of the first claim.
 *
 *  (2) TEAM IDENTITY — blue host (left slot A) / red challenger (right slot B)
 *      on BOTH clients. Canvas colour used to be keyed to the local viewer
 *      ("me = blue"), which swapped the two mages between screens and
 *      contradicted the score bar; per-player effect text was centred.
 *
 * DuelRace.js is transport-only (no DOM at import/construct time), so this
 * script drives the REAL class with stubbed game/duel/document objects rather
 * than re-implementing its logic, and greps the render paths for the identity
 * invariants. Run:  node scripts/verify-duel-take-vanish.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const raceSrc = read('frontend/game/DuelRace.js');
const gameSrc = read('frontend/Game.js');
const combatSrc = read('frontend/game/CombatSystem.js');
const teamsSrc = read('frontend/game/ArenaTeams.js');
const cssSrc = read('frontend/style.css');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

// Body-scoped lookup: a needle must live INSIDE the method, not merely
// somewhere after a reference to it (start() mentions every hook by name).
function methodBody(src, name) {
    const start = src.indexOf(`\n    ${name}(`);
    if (start < 0) return '';
    const end = src.indexOf('\n    }\n', start);
    return src.slice(start, end < 0 ? src.length : end);
}

globalThis.document = { getElementById: () => null };

// ── 1. the steal is announced, the forfeit is not ───────────────────────────
check(
    'a successful claim announces `taken` exactly once',
    count(raceSrc, "broadcastRace('taken'") === 1 &&
        methodBody(raceSrc, '_onTyped').includes("broadcastRace('taken'"),
    'the announcement must live in _onTyped'
);
check(
    'a forfeit does NOT announce `taken`',
    !methodBody(raceSrc, '_onMistake').includes("broadcastRace('taken'"),
    'the word is still live for the opponent after our mistake'
);
check(
    'both roles handle `taken` (no host-only guard)',
    raceSrc.includes("case 'taken': this._onTaken(p); break;")
);
check(
    'the receiver dissolves the word and locks its own input',
    methodBody(raceSrc, '_onTaken').includes('dissolveRaceWord(teamColorFor(taker))') &&
        methodBody(raceSrc, '_onTaken').includes('myDecided = true')
);
// AT-F10 added a third receiver of an opponent frame — the class-active `cast` —
// and it guards its echo exactly like the two race frames do. The count stays
// exact on purpose: the next receiver has to declare itself here.
check(
    'stale indices and our own echoes are ignored',
    raceSrc.includes('p.idx !== this.idx || this.myDecided') &&
        count(raceSrc, '// never self-echo') === 3
);

// ── 2. a decided word can never park the lane ──────────────────────────────
check('the arbitration window exists', raceSrc.includes('const CLAIM_WINDOW_MS = 600;'));
check(
    'the window is armed by an incoming claim',
    methodBody(raceSrc, '_onClaim').includes('this._armWindow();')
);
check(
    'the window is armed by our own claim',
    methodBody(raceSrc, '_onTyped').includes('this._armWindow();')
);
check(
    'a lost paired claim still resolves via the window',
    methodBody(raceSrc, '_onTaken').includes('this._armWindow();')
);
check(
    'every word lifecycle clears the window',
    count(raceSrc, '_clearWindow();') >= 4, // _spawnLocal, _resolve, _endMatch, stop
    `found ${count(raceSrc, '_clearWindow();')}`
);
check(
    'input hooks are locked once the word is decided',
    count(raceSrc, 'this.myResolved || this.myDecided) return;') === 2
);
check('_spawnLocal re-arms input for the next word', /myDecided = false;/.test(raceSrc));

// ── 3. team identity is keyed to the slot, never to the viewer ─────────────
check(
    'one palette module owns the team colours',
    teamsSrc.includes("export const TEAM_COLORS = { A: '#29b6f6', B: '#ff4b4b' };") &&
        /export function otherSlot\(slot\)/.test(teamsSrc) &&
        /export function slotX\(canvas, slot\)/.test(teamsSrc)
);
check(
    'the score bar CSS uses the same palette',
    cssSrc.includes('#sb-hp-fill-a { background: linear-gradient(90deg, #1565a0, #29b6f6);') &&
        cssSrc.includes('#sb-hp-fill-b { background: linear-gradient(90deg, #a02020, #ff4b4b);')
);
check(
    'both mages are coloured by their own slot',
    gameSrc.includes('teamColorFor(selfSlot), \'YOU\'') &&
        gameSrc.includes('teamColorFor(oppSlot), opp.name || \'Opponent\'')
);
check(
    'the duel block no longer hardcodes the viewer as blue',
    !/this\._drawTeamMage\([\s\S]{0,200}'#29b6f6'[\s\S]{0,80}'YOU'/.test(gameSrc)
);
check(
    'the opponent sprite is no longer mirrored',
    !/if \(mirror\) \{\s*\n\s*ctx\.translate\(x, 0\);/.test(gameSrc) &&
        count(gameSrc, 'ctx.scale(-1, 1)') === 0
);
check(
    'the sealed ultimate is anchored to the caster slot in team colour',
    /duelSlotX\(side\)[\s\S]*?teamColorFor\(side\)/.test(combatSrc)
);
check(
    'per-player race feedback is anchored to a slot',
    /_floatAtSlot\(this\.theirs, `OPPONENT −\$\{r\.dmg\} HP`/.test(raceSrc) &&
        /_floatAtSlot\(this\.mine, 'OPPONENT STRIKES!'/.test(raceSrc) &&
        /_floatAtSlot\(this\.mine, 'WORD FORFEITED!'/.test(raceSrc)
);

// ── 4. behavioural probe: the REAL DuelRace, stubbed transport/DOM ─────────
const { DuelRace } = await import(pathToFileURL(join(root, 'frontend', 'game', 'DuelRace.js')).href);

const WORD = 'aether';                 // 6 letters → 6 damage
const SLOT_X = { A: 360, B: 840 };     // stands in for Game.duelSlotX

function makeGame() {
    return {
        canvas: { width: 1200, height: 800 },
        words: [],
        floatingTexts: [],
        dissolved: [],
        dictionary: { getWordForDifficulty: () => WORD },
        duelSide: null,
        duelOpponent: null,
        duelSlotX(slot) { return SLOT_X[slot]; },
        spawnRaceWord(text, opts = {}) {
            const w = { text, x: typeof opts.x === 'number' ? opts.x : 600, y: -50, dying: false, isDead: false };
            this.words.push(w);
            return w;
        },
        // Mirrors Game.dissolveRaceWord: fade the live word, no expiry hook.
        dissolveRaceWord(color) {
            const w = this.words.find((x) => !x.dying && !x.isDead);
            if (!w) return false;
            w.dying = true;
            this.dissolved.push({ text: w.text, color });
            return true;
        }
    };
}

function makeDuel(isHost) {
    const sent = [];
    return {
        isHost,
        playerName: isHost ? 'HostMage' : 'GuestMage',
        presenceKey: isHost ? 'key-host' : 'key-guest',
        channel: { presenceState: () => ({}) },
        sent,
        broadcastRace(type, data = {}) { sent.push({ type, ...data }); return Promise.resolve('ok'); }
    };
}

function buildRace(isHost) {
    const game = makeGame();
    const duel = makeDuel(isHost);
    const ends = [];
    const race = new DuelRace({
        game, duel, isHost,
        opponentName: isHost ? 'GuestMage' : 'HostMage',
        onMatchEnd: (won, reason) => ends.push({ won, reason })
    });
    race.start();
    return { game, duel, race, ends };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const typesOf = (duel) => duel.sent.map((m) => m.type);

// (a) host screen: the challenger steals the word
{
    const { game, duel, race } = buildRace(true);
    check('the host opens the lane with word #1', race.idx === 1 && race.phase === 'word');
    race._onRace({ raceType: 'taken', idx: 1, player_key: 'key-guest' });
    check(
        'the stolen word is dissolved the instant it is taken',
        game.dissolved.length === 1 && game.words[0].dying === true,
        JSON.stringify(game.dissolved)
    );
    check(
        "the dissolve uses the TAKER's team colour (challenger red)",
        game.dissolved[0]?.color === '#ff4b4b',
        JSON.stringify(game.dissolved)
    );
    check('our keystrokes on that word are locked', race.myDecided === true);
    check(
        'the steal is announced over the taker slot',
        game.floatingTexts.some((f) => f.text === 'TAKEN!' && f.x === SLOT_X.B),
        JSON.stringify(game.floatingTexts.map((f) => [f.text, f.x]))
    );
    race._onTyped();
    check('a late keystroke cannot claim a stolen word', typesOf(duel).length === 1 && !race.myResolved);
    await sleep(2200);   // window (600) + result beat (700) + >=900 ms slack —
                          // the SLACK is what absorbs a loaded box; the checks
                          // below are unchanged (AT-F6 follow-up: a flake hit
                          // the old 150 ms slack once under parallel load)
    check('a no-claim steal still advances the lane', race.idx === 2 && race.phase === 'word');
    check('a no-claim steal scores nothing', race.hp.A === 100 && race.hp.B === 100);
    race.stop();
}

// (b) host screen: the only claim in is the challenger's → resolve inside the window
{
    const { duel, race } = buildRace(true);
    race._onRace({ raceType: 'claim', idx: 1, dur: 480, player_key: 'key-guest' });
    check('an incoming claim arms the arbitration window', race._windowTimer !== null);
    await sleep(1000);   // window (600) + >=400 ms slack
    check('the challenger takes the word inside the window', race.hp.A === 100 - WORD.length && race.wins.B === 1,
        `hpA=${race.hp.A} winsB=${race.wins.B}`);
    check('the host arbitrates exactly once', typesOf(duel).filter((t) => t === 'result').length === 1);
    check('the resolve clears the window timer', race._windowTimer === null);
    await sleep(800);
    check('the next word follows the arbitrated one', race.idx === 2 && race.phase === 'word');
    race.stop();
}

// (c) guest screen: same vanish, and the taker keeps the HOST blue
{
    const { game, race } = buildRace(false);
    race._onRace({ raceType: 'issue', idx: 1, text: WORD, x: 500, baseSpeed: 1 });
    check('the guest mirrors the issued word', race.idx === 1 && game.words.length === 1);
    race._onRace({ raceType: 'taken', idx: 1, player_key: 'key-host' });
    check('the guest dissolves the stolen word too', game.dissolved.length === 1 && game.words[0].dying === true);
    check(
        "the dissolve uses the HOST's blue, not the local viewer's colour",
        game.dissolved[0]?.color === '#29b6f6',
        JSON.stringify(game.dissolved)
    );
    check('the guest never arbitrates', race.isHost === false && race._windowTimer === null);
    race.stop();
}

// (d) our own claim announces the steal, then wins unanswered
{
    const { duel, race } = buildRace(true);
    race._onTyped();
    const taken = duel.sent.filter((m) => m.type === 'taken');
    check('our own claim announces exactly one `taken`', taken.length === 1 && taken[0].idx === 1,
        JSON.stringify(taken));
    check('the host does not broadcast a claim to itself', !typesOf(duel).includes('claim'));
    check('our own claim arms the window', race._windowTimer !== null);
    await sleep(1000);   // window (600) + >=400 ms slack
    check('an unanswered claim wins inside the window', race.hp.B === 100 - WORD.length && race.wins.A === 1,
        `hpB=${race.hp.B} winsA=${race.wins.A}`);
    await sleep(850);
    check('the next word follows our own claim', race.idx === 2 && race.phase === 'word');
    race.stop();
}

// (e) guest transport: announcement, then the arbitrated claim
{
    const { duel, race } = buildRace(false);
    race._onRace({ raceType: 'issue', idx: 1, text: WORD, x: 500, baseSpeed: 1 });
    race._onTyped();
    check('the guest announces the steal before claiming', typesOf(duel).join(',') === 'taken,claim',
        typesOf(duel).join(','));
    const claim = duel.sent.find((m) => m.type === 'claim');
    check('the claim carries our own measured duration',
        claim.idx === 1 && typeof claim.dur === 'number' && claim.dur >= 1, JSON.stringify(claim));
    race.stop();
}

// (f) a mistake forfeits the word but never takes it from the opponent
{
    const { game, duel, race } = buildRace(true);
    race._onMistake();
    check('a forfeit broadcasts no `taken`', !typesOf(duel).includes('taken'), typesOf(duel).join(','));
    check('the forfeited word keeps falling for the opponent',
        game.dissolved.length === 0 && game.words[0].dying === false);
    check('the forfeit never arms the window early', race._windowTimer === null);
    check(
        'the forfeit is shown over our own slot',
        game.floatingTexts.some((f) => f.text === 'WORD FORFEITED!' && f.x === SLOT_X.A)
    );
    race.stop();
}

// (g) guards: self-echo and stale announcements
{
    const { game, race } = buildRace(true);
    race._onRace({ raceType: 'taken', idx: 1, player_key: 'key-host' });
    check('our own `taken` echo is ignored', game.dissolved.length === 0 && race.myDecided === false);
    race._onRace({ raceType: 'taken', idx: 2, player_key: 'key-guest' });
    check('a stale-index announcement is ignored', game.dissolved.length === 0 && race.myDecided === false);
    race._onRace({ raceType: 'claim', idx: 2, dur: 10, player_key: 'key-guest' });
    check('a stale claim is ignored', race.oppResolved === false && race._windowTimer === null);
    race.stop();
}

console.log(
    failures === 0
        ? '\nAll AT-F9 P3 steal/vanish + team-identity checks passed.'
        : `\n${failures} check(s) failed — a stolen word can linger (or the lane can wedge) again.`
);
process.exit(failures === 0 ? 0 : 1);


