/**
 * Regression guard for AT-F10 — per-class arena actives. Owner sign-off
 * 2026-09-23: Arcane Surge / Cinder Brand / Glacial Ward / **Time Stop** (the
 * proposed 0.85x duration version and Mana Echo loop were replaced).
 *
 * What this locks in:
 *   1. the roster is still the ONE table: every class declares exactly one
 *      active, ids are unique + kebab-case, costs fit inside the arena pool, and
 *      no skill title is spelled anywhere else in the code;
 *   2. the owner's Chronomancer decision, as an invariant: NO active touches a
 *      measured duration, a race word, or the opponent's pool. `DuelRace._resolve`
 *      decides the winner by taking the LOWER self-measured duration, and the
 *      0.85x version would have rewritten that very input inside AT-F9's 75 ms
 *      fairness window;
 *   3. the cast surface is Survival's own — `Tab`/`Enter` -> `castUltimateSpell`
 *      -> `game.onDuelCast`, with `#mobile-nova-btn` riding the same call — and
 *      the arena's seal message survives for the presses the race does not own;
 *   4. host authority: a cast is announced with one `cast` frame (resolved
 *      against the roster, so a client cannot invent an effect), ONE buff per
 *      player, spent only inside `_resolve()`, and echoed in both `result` and
 *      the 1 Hz `state` heartbeat so a chip can never stay lit after the host
 *      spent it;
 *   5. behaviour, against the REAL DuelRace with stubbed transport/DOM: the cast
 *      costs mana, arms exactly once, doubles/halves damage exactly as the
 *      roster says, starts a host-authoritative 3-second Time Stop, survives a
 *      dead heat unspent, is honoured when the CHALLENGER is the caster, and
 *      refuses an unknown skill id.
 * Run:  node scripts/verify-class-actives.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

import {
    MAGE_CLASSES,
    MAGE_ACTIVE_KINDS,
    activeForClass,
    mageActiveById
} from '../backend/MageClasses.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const raceSrc = strip(read('frontend/game/DuelRace.js'));
const combatSrc = strip(read('frontend/game/CombatSystem.js'));
const inputSrc = strip(read('frontend/game/InputHandler.js'));
const mainSrc = strip(read('frontend/main.js'));
const duelSrc = strip(read('backend/Duel.js'));
const htmlSrc = read('frontend/index.html');
const cssSrc = strip(read('frontend/style.css'));

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

/** Source of a method declared with four-space indentation in DuelRace.js. */
function methodBody(name) {
    const at = raceSrc.indexOf(`\n    ${name}(`);
    if (at < 0) return '';
    const end = raceSrc.indexOf('\n    }\n', at);
    return raceSrc.slice(at, end < 0 ? raceSrc.length : end);
}

// ── 1. one roster, one active per class ────────────────────────────────────
const ALL = MAGE_CLASSES.flatMap((c) => (c.active ? [{ className: c.id, ...c.active }] : []));
check('every Discipline declares exactly one active', ALL.length === MAGE_CLASSES.length,
    `${ALL.length} active(s) for ${MAGE_CLASSES.length} class(es)`);
check(
    'each active carries id/title/cost/kind/value/effect',
    ALL.every((a) =>
        typeof a.id === 'string' && a.id.length > 0 &&
        typeof a.title === 'string' && a.title.length > 0 &&
        Number.isInteger(a.cost) && a.cost > 0 &&
        MAGE_ACTIVE_KINDS.includes(a.kind) &&
        typeof a.value === 'number' && a.value > 0 &&
        typeof a.effect === 'string' && a.effect.length > 0
    ),
    ALL.map((a) => `${a.className}:${a.kind}`).join(' ')
);
const ids = ALL.map((a) => a.id);
check('skill ids are unique', new Set(ids).size === ids.length, ids.join(', '));
check('skill ids are kebab-case wire values', ids.every((id) => /^[a-z]+(-[a-z]+)*$/.test(id)), ids.join(', '));
check(
    'every declared kind is actually used (a new kind must join MAGE_ACTIVE_KINDS)',
    MAGE_ACTIVE_KINDS.every((k) => ALL.some((a) => a.kind === k)),
    MAGE_ACTIVE_KINDS.filter((k) => !ALL.some((a) => a.kind === k)).join(', ') || ''
);
check(
    'every cost fits the base arena pool (100 mana, no talent nodes in a duel)',
    ALL.every((a) => a.cost <= 100),
    ALL.map((a) => `${a.title} ${a.cost}`).join(', ')
);
check(
    'the actives are two damage buffs, one ward and one time stop',
    ALL.filter((a) => a.kind === 'damage').length === 2 &&
        ALL.filter((a) => a.kind === 'mitigation').length === 1 &&
        ALL.filter((a) => a.kind === 'time_stop').length === 1,
    ALL.map((a) => `${a.className}=${a.kind}`).join(' ')
);
check(
    'the ward belongs to Cryomancer and Time Stop to Chronomancer',
    MAGE_CLASSES.find((c) => c.id === 'Cryomancer')?.active.kind === 'mitigation' &&
        MAGE_CLASSES.find((c) => c.id === 'Chronomancer')?.active.kind === 'time_stop'
);
check(
    'Time Stop is the Chronomancer active, with a 100-mana, 3-second contract',
    mageActiveById('time-stop')?.title === 'Time Stop' &&
        mageActiveById('time-stop')?.cost === 100 &&
        mageActiveById('time-stop')?.value === 3000 &&
        mageActiveById('mana-echo') === null
);
check(
    'the lookups normalise: no class can hand the cast path an undefined active',
    activeForClass('nope')?.id === activeForClass('Novice')?.id &&
        activeForClass(null)?.id === activeForClass('Novice')?.id &&
        mageActiveById('orbital-nuke') === null
);

// ── 2. no second table, no second source of truth ──────────────────────────
const codeFiles = [
    'backend/Stats.js', 'backend/Duel.js', 'backend/Leaderboard.js',
    'frontend/main.js', 'frontend/game/CombatSystem.js', 'frontend/game/DuelRace.js',
    'frontend/Game.js', 'frontend/ui/ProfileUI.js', 'frontend/ui/AuthUI.js'
];
const strayTitles = codeFiles.filter((p) => {
    const src = strip(read(p));
    return ALL.some((a) => src.includes(`'${a.title}'`) || src.includes(`"${a.title}"`));
});
check('no skill title is hard-coded outside the roster', strayTitles.length === 0, strayTitles.join(', '));
check(
    'the arena resolves actives through the roster module, not a local table',
    raceSrc.includes("import { activeForClass, mageActiveById } from '../../backend/MageClasses.js';") &&
        count(raceSrc, 'activeForClass(') >= 3 && count(raceSrc, 'mageActiveById(') >= 4
);

// ── 3. no active may touch the arbiter, the words, or the opponent's pool ──
check('no duration multiplier survives anywhere', !/\b0\.85\b/.test(raceSrc), '0.85 found in DuelRace.js');
check(
    'the winner is still the lower self-measured duration',
    raceSrc.includes('const DEAD_HEAT_MS = 75;') &&
        raceSrc.includes('if (Math.abs(mineDur - oppDur) >= DEAD_HEAT_MS) {') &&
        raceSrc.includes('winner = mineDur < oppDur ? this.mine : this.theirs;')
);
const resolveBody = methodBody('_resolve');
check(
    'the winner is decided BEFORE any active is applied',
    resolveBody.indexOf('mineDur < oppDur') > 0 && resolveBody.indexOf('mineDur < oppDur') < resolveBody.indexOf('dmgRaw'),
    'actives must edit the outcome, never the input that decides it'
);
check(
    'every indexed HP read/write lives in the single arbitration path',
    count(raceSrc, 'this.hp[') === 3 && count(resolveBody, 'this.hp[') === 3 &&
        count(raceSrc, 'this.hp[loser] = Math.max(0, this.hp[loser] - dmg);') === 1,
    `${count(resolveBody, 'this.hp[')} of ${count(raceSrc, 'this.hp[')}`
);
for (const name of ['cast', '_onCast', '_applyResult']) {
    const body = methodBody(name);
    check(
        `${name}() never spawns, clears or mutates a race word`,
        !/(spawnRaceWord|dissolveRaceWord|game\.words)/.test(body)
    );
}
check(
    'the cast frame carries a skill id and an index — never a cost or a multiplier',
    raceSrc.includes("broadcastRace('cast', { idx: this.idx, skill: skill.id })") &&
        !/broadcastRace\([\s\S]{0,120}?mana/.test(raceSrc)
);
check(
    'mana is only ever spent through Stats',
    methodBody('cast').includes('this.game.stats.useMana(skill.cost)') &&
        !/stats\.mana\s*=/.test(raceSrc)
);


// ── 4. host authority: arm once, spend once, announce both ────────────────
check(
    'the host validates an arriving skill id against the roster',
    methodBody('_onCast').includes('if (!this.isHost || this.over) return;') &&
        methodBody('_onCast').includes('const skill = mageActiveById(p.skill);')
);
check(
    'one active per player: re-arming is refused on both sides',
    methodBody('cast').includes('if (this.buffs[this.mine]) {') &&
        methodBody('_onCast').includes('if (!skill) return;') &&
        methodBody('_onCast').includes('if (this.buffs[this.theirs]) return;')
);
check(
    'only _resolve() spends a buff',
    count(raceSrc, 'this.buffs[winner] = null') === 1 &&
        count(raceSrc, 'this.buffs[loser] = null') === 1 &&
        resolveBody.includes('this.buffs[winner] = null') &&
        resolveBody.includes('this.buffs[loser] = null')
);
check(
    'the winner of a word spends their buff, the loser keeps a waiting ward',
    resolveBody.includes("if (winnerBuff && winnerBuff.kind !== 'mitigation') {") &&
        resolveBody.includes('this.buffs[winner] = null;') &&
        resolveBody.includes("if (loserBuff && loserBuff.kind === 'mitigation') {") &&
        resolveBody.includes('this.buffs[loser] = null;')
);
check(
    'the resolve frame carries dmgRaw + amp + ward + the surviving armed map',
    raceSrc.includes('idx: this.idx, winner, dmg, dmgRaw, amp, ward,') &&
        count(raceSrc, 'armed: { A: this.buffs.A, B: this.buffs.B },') === 2
);
check(
    'the armed map also rides the heartbeat and is adopted by the guest',
    methodBody('_snapshot').includes('armed: { A: this.buffs.A, B: this.buffs.B },') &&
        methodBody('_onState').includes('this._adoptBuffs(p);') &&
        methodBody('_applyResult').includes('this._adoptAuras(r);') &&
        methodBody('_applyResult').includes('this._adoptTimeStop(r);') &&
        methodBody('_snapshot').includes('auras: { A: this.game.duelAuras.A, B: this.game.duelAuras.B },') &&
        methodBody('_snapshot').includes('timeStopUntil: this.timeStopUntil,') &&
        raceSrc.includes("case 'time_stop': this._onTimeStop(p); break;") &&
        methodBody('_activateTimeStop').includes("this.duel.broadcastRace('time_stop'")
);
check(
    'the cast is announced as its own frame, in both directions',
    raceSrc.includes("case 'cast': this._onCast(p); break;") &&
        methodBody('cast').includes("broadcastRace('cast'") &&
        methodBody('_onCast').includes('// never self-echo')
);
check(
    'an armed buff is announced over the caster\'s own slot, in team colour',
    methodBody('cast').includes('_floatAtSlot(this.mine, `${skill.title.toUpperCase()} ARMED!`, teamColorFor(this.mine)')
);

// ── 5. the cast surface is Survival's own, and it is handed back ──────────
check(
    'Tab/Enter still routes through castUltimateSpell (no second input surface)',
    inputSrc.includes("if (e.key === 'Tab' || e.key === 'Enter') {") &&
        count(inputSrc, 'castUltimateSpell();') === 1
);
check(
    'the arena branch hands the press to the race and keeps the seal as fallback',
    combatSrc.includes('if (this.game.onDuelCast && this.game.onDuelCast()) return;') &&
        combatSrc.includes("const text = 'THE ARENA SEALS YOUR ULTIMATE!';") &&
        combatSrc.indexOf('game.onDuelCast') < combatSrc.indexOf("const text = 'THE ARENA SEALS")
);
check(
    'the mobile button rides the same call',
    count(mainSrc, 'game.combatSystem.castUltimateSpell();') === 1 &&
        mainSrc.includes("mobileNovaBtn.addEventListener('click', castNovaMobile);")
);
check(
    'the race installs the hook at start and clears it at stop',
    methodBody('start').includes('this.game.onDuelCast = () => this.cast();') &&
        methodBody('stop').includes('this.game.onDuelCast = null;')
);
check(
    'main.js clears the hook too (a duel that ends before stop() must not eat Tab)',
    count(mainSrc, 'game.onDuelCast = null;') === 1
);
check(
    'the labels are applied at start and restored at stop',
    methodBody('start').includes('this._labelCastSurfaces();') &&
        methodBody('stop').includes('this._restoreCastSurfaces();') &&
        methodBody('_labelCastSurfaces').includes("this.$('mobile-nova-btn')") &&
        methodBody('_labelCastSurfaces').includes("this.$('mana-hint')") &&
        methodBody('_restoreCastSurfaces').includes("this.$('mobile-nova-btn')") &&
        methodBody('_restoreCastSurfaces').includes("this.$('mana-hint')")
);
check(
    'cast() reports "handled" for its own refusals, so the seal never lies',
    methodBody('cast').includes('if (this.over || !this.game.stats) return false;') &&
        count(methodBody('cast'), 'return true;') >= 4
);
check(
    "both mages' actives are visible — one chip per side, for player AND opponent",
    count(htmlSrc, 'class="sb-buff hidden"') === 2 &&
        htmlSrc.includes('id="sb-buff-a"') && htmlSrc.includes('id="sb-buff-b"') &&
        methodBody('_renderBuff').includes("this.$('sb-buff-' + suffix)")
);
check(
    'the chip CSS stays compositor-cheap (AT-F13: no blur/animation over the canvas)',
    cssSrc.includes('.sb-buff {') && cssSrc.includes('.sb-buff.sb-buff-armed {') &&
        !/\.sb-buff[\s\S]{0,400}(backdrop-filter|animation:|transition:)/.test(cssSrc)
);
check(
    'the Discipline is published with the other presence identity fields',
    duelSrc.includes('_presencePayload()') &&
        ['player_name: this.playerName', 'in_match: this.inMatch', 'character: this.character', 'wand: this.wandColor', 'mage_class: this.mageClass']
            .every((field) => duelSrc.includes(field)) &&
        count(duelSrc, 'this.channel.track(this._presencePayload())') === 3 &&
        duelSrc.includes('setCharacter(character, wandColor, mageClass)') &&
        count(mainSrc, 'game.stats.wandColor, game.stats.mageClass);') === 2
);


// ── 6. behaviour: the REAL DuelRace, stubbed transport + DOM ───────────────
// The DOM stub is real enough to paint into (textContent / classList), so the
// chip assertions below exercise `_renderBuff` itself rather than a copy.
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
for (const id of ['sb-buff-a', 'sb-buff-b', 'mobile-nova-btn', 'mana-hint']) els[id] = makeEl(id);
els['mobile-nova-btn'].textContent = 'CAST NOVA';
els['mana-hint'].innerHTML = 'Press <kbd>Tab</kbd> or <kbd>Enter</kbd> to cast Nova!';
globalThis.document = { getElementById: (id) => els[id] || null };

const { DuelRace } = await import(pathToFileURL(join(root, 'frontend', 'game', 'DuelRace.js')).href);

const WORD = 'aether';                 // 6 letters → 6 damage
const SLOT_X = { A: 360, B: 840 };

function makeGame(mageClass = 'Novice') {
    return {
        canvas: { width: 1200, height: 800 },
        words: [], floatingTexts: [], dissolved: [],
        dictionary: { getWordForDifficulty: () => WORD },
        duelSide: null, duelOpponent: null, onDuelCast: null,
        duelSlotX: (slot) => SLOT_X[slot],
        audio: { played: [], playMagicSpark() { this.played.push('spark'); }, playErrorSound() { this.played.push('error'); } },
        stats: {
            mageClass, mana: 100, maxMana: 100,
            useMana(cost) { if (this.mana >= cost) { this.mana -= cost; return true; } return false; },
            refundMana(amount) { const before = this.mana; this.mana = Math.min(this.maxMana, this.mana + amount); return this.mana - before; }
        },
        spawnRaceWord(text, opts = {}) {
            const w = { text, x: typeof opts.x === 'number' ? opts.x : 600, y: -50, dying: false, isDead: false };
            this.words.push(w);
            return w;
        },
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
        isHost, playerName: isHost ? 'HostMage' : 'GuestMage',
        presenceKey: isHost ? 'key-host' : 'key-guest',
        channel: { presenceState: () => ({}) },
        sent,
        broadcastRace(type, data = {}) { sent.push({ type, ...data }); return Promise.resolve('ok'); }
    };
}

function buildRace(isHost, mageClass = 'Novice') {
    const game = makeGame(mageClass);
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
const floats = (game) => game.floatingTexts.map((f) => f.text);
const floatAt = (game, text) => game.floatingTexts.find((f) => f.text === text);
const GUEST = { raceType: 'cast', idx: 1, player_key: 'key-guest' };
const guestClaim = (dur) => ({ raceType: 'claim', idx: 1, dur, player_key: 'key-guest' });


// (a) Novice — Arcane Surge: costs mana, arms once, multiplies a won claim.
{
    const { game, duel, race } = buildRace(true, 'Novice');
    check('the chip names the skill and its cost before anything is cast',
        els['sb-buff-a'].textContent === 'PVP ACTIVE · Arcane Surge · 50' && !els['sb-buff-a'].classList.contains('hidden'),
        els['sb-buff-a'].textContent);
    check('the opponent chip stays quiet when presence carried no class (harness)',
        els['sb-buff-b'].textContent === '' && els['sb-buff-b'].classList.contains('hidden'),
        els['sb-buff-b'].textContent);
    check('the cast surface carries the class label for the whole match',
        els['mobile-nova-btn'].textContent === 'ARCANE SURGE' &&
            els['mana-hint'].innerHTML.includes('to cast Arcane Surge!') &&
            typeof game.onDuelCast === 'function',
        els['mobile-nova-btn'].textContent);
    check('casting at full mana spends the roster cost', race.cast() === true && game.stats.mana === 50,
        `mana=${game.stats.mana}`);
    check('the buff is armed for this mage\'s slot', race.buffs.A === 'arcane-surge');
    const casts = duel.sent.filter((m) => m.type === 'cast');
    check('one cast frame went out, carrying only idx + skill id',
        casts.length === 1 && casts[0].idx === 1 && casts[0].skill === 'arcane-surge' && !('mana' in casts[0]),
        JSON.stringify(casts));
    check('the armed chip lights up for BOTH mages',
        els['sb-buff-a'].textContent === 'PVP ACTIVE · ARCANE SURGE ★' &&
            els['sb-buff-a'].classList.contains('sb-buff-armed') &&
            floats(game).includes('ARCANE SURGE ARMED!'));
    check('re-arming while armed is refused without spending',
        race.cast() === true && game.stats.mana === 50 &&
            duel.sent.filter((m) => m.type === 'cast').length === 1 &&
            floats(game).includes('SKILL ALREADY ARMED'),
        JSON.stringify(floats(game)));

    race._onTyped();                   // we win the word
    await sleep(650);                  // arbitration window (600) + slack
    check("Arcane Surge lands x1.5 on the host's arbitration (6 -> 9)", race.hp.B === 100 - 9,
        `hpB=${race.hp.B}`);
    const res = duel.sent.find((m) => m.type === 'result');
    check('the frame records raw damage, the skill and the spent map',
        res.dmgRaw === 6 && res.dmg === 9 && res.amp === 'arcane-surge' && res.ward === null &&
            res.armed.A === null,
        JSON.stringify(res));
    check('the chip falls back to "available" once the buff is spent',
        els['sb-buff-a'].textContent === 'PVP ACTIVE · Arcane Surge · 50' &&
            !els['sb-buff-a'].classList.contains('sb-buff-armed'));
    race.stop();
}

// (b) Pyromancer — Cinder Brand: the glass cannon at x2.
{
    const { game, duel, race } = buildRace(true, 'Pyromancer');
    check('Cinder Brand costs 60 mana', race.cast() === true && game.stats.mana === 40,
        `mana=${game.stats.mana}`);
    race._onTyped();
    await sleep(650);
    const res = duel.sent.find((m) => m.type === 'result');
    check('Cinder Brand doubles the damage (6 -> 12)', race.hp.B === 100 - 12 && res.dmg === 12,
        `hpB=${race.hp.B} dmg=${res.dmg}`);
    check('it is spent the moment it fired', race.buffs.A === null && res.amp === 'cinder-brand');
    race.stop();
}

// (c) Cryomancer — Glacial Ward: absorbs the NEXT word we LOSE (we forfeit it).
{
    const { game, duel, race } = buildRace(true, 'Cryomancer');
    check('Glacial Ward arms from a losing position too', race.cast() === true && race.buffs.A === 'glacial-ward' &&
        game.stats.mana === 50);
    race._onMistake();                 // we forfeit this word
    race._onRace(guestClaim(480));     // the challenger takes it
    await sleep(650);
    const res = duel.sent.find((m) => m.type === 'result');
    check('the ward halves the damage we took (6 -> 3)', race.hp.A === 100 - 3 && res.dmg === 3,
        `hpA=${race.hp.A} dmg=${res.dmg}`);
    check('the frame says which ward absorbed it', res.ward === 'glacial-ward' && res.dmgRaw === 6,
        JSON.stringify(res));
    check('the ward is spent after it absorbed a blow', race.buffs.A === null && res.armed.A === null);
    const strike = floatAt(game, 'OPPONENT STRIKES!');
    const warded = floatAt(game, 'WARDED −3');
    check('the ward line is announced above the strike it explains',
        !!strike && !!warded && strike.y - warded.y === 34,
        `strike=${strike?.y} warded=${warded?.y}`);
    race.stop();
}

// (d) Chronomancer — Time Stop: a 100-mana, host-authoritative 3-second freeze.
{
    const { game, duel, race } = buildRace(true, 'Chronomancer');
    const before = Date.now();
    check('Time Stop costs the full 100 mana', race.cast() === true && game.stats.mana === 0,
        `mana=${game.stats.mana}`);
    check('the host starts a 3-second shared freeze without arming a damage buff',
        race.timeStopUntil >= before + 2900 && race.timeStopUntil <= Date.now() + 3000 &&
            race.buffs.A === null && race.game.duelTimeStopUntil === race.timeStopUntil,
        `until=${race.timeStopUntil}`);
    check('the host announces the freeze with an absolute deadline',
        duel.sent.some((m) => m.type === 'time_stop' && m.skill === 'time-stop' && m.until === race.timeStopUntil),
        JSON.stringify(duel.sent));
    check('the caster receives a violet time-stop aura',
        race.game.duelAuras.A === 'time-stop' && floats(game).includes('TIME STOP!'),
        JSON.stringify(race.game.duelAuras));
    race.stop();
}


// (e) a word nobody wins spends NOTHING — both mages stay armed.
{
    const { game, duel, race } = buildRace(true, 'Novice');
    race.cast();
    race._onMistake();                       // we forfeit
    race._onRace({ raceType: 'claim', idx: 1, forfeited: true, player_key: 'key-guest' }); // so do they
    await sleep(650);
    const res = duel.sent.find((m) => m.type === 'result');
    check('a double forfeit deals no damage', race.hp.A === 100 && race.hp.B === 100,
        `hpA=${race.hp.A} hpB=${race.hp.B}`);
    check('with no winner, both buffs survive the word',
        res.winner === null && res.armed.A === 'arcane-surge' && race.buffs.A === 'arcane-surge',
        JSON.stringify(res.armed));
    check('the chip is still lit for the next word',
        els['sb-buff-a'].textContent === 'PVP ACTIVE · ARCANE SURGE ★');
    race.stop();
}

// (f) the HOST honours the CHALLENGER's cast — symmetry is the whole contract.
{
    const { game, duel, race } = buildRace(true, 'Novice');
    race._onRace({ ...GUEST, skill: 'cinder-brand' });
    check('the host records the challenger\'s buff and announces it to both sides',
        race.buffs.B === 'cinder-brand' && els['sb-buff-b'].textContent === 'PVP ACTIVE · CINDER BRAND ★' &&
            floats(game).includes('CINDER BRAND ARMED!'),
        JSON.stringify(race.buffs));
    race._onRace(guestClaim(480));           // they win the word, we never claim
    await sleep(650);
    const res = duel.sent.find((m) => m.type === 'result');
    check('their armed strike doubles OUR damage (6 -> 12)', race.hp.A === 100 - 12 && res.dmg === 12,
        `hpA=${race.hp.A} dmg=${res.dmg}`);
    check('the host spent THEIR buff, not ours',
        res.amp === 'cinder-brand' && res.armed.B === null && race.buffs.B === null,
        JSON.stringify(race.buffs));
    race.stop();
}

// (g) a skill id that is not in the roster cannot reach the arbiter.
{
    const { game, race } = buildRace(true, 'Novice');
    race._onRace({ ...GUEST, skill: 'orbital-nuke' });
    check('an unknown skill id is dropped without arming anything',
        race.buffs.B === null && !floats(game).some((t) => t.includes('ARMED')) &&
            els['sb-buff-b'].textContent === '',
        JSON.stringify(race.buffs));
    race.stop();
}

// (h) the challenger casts, the challenger never arbitrates.
{
    const { duel, race } = buildRace(false, 'Pyromancer');
    race._onRace({ raceType: 'issue', idx: 1, text: WORD, x: 500, baseSpeed: 1 });
    check('the challenger\'s own cast is local + announced, never arbitrated',
        race.cast() === true && race.buffs.B === 'cinder-brand' &&
            duel.sent.filter((m) => m.type === 'cast').length === 1 &&
            !duel.sent.some((m) => m.type === 'result') && race._windowTimer === null,
        JSON.stringify(duel.sent.map((m) => m.type)));
    race.stop();
}

// (i) a refused cast explains itself and spends nothing.
{
    const { game, duel, race } = buildRace(true, 'Novice');
    game.stats.mana = 30;
    check('a short pool is refused, announced and unchanged',
        race.cast() === true && game.stats.mana === 30 && race.buffs.A === null &&
            duel.sent.filter((m) => m.type === 'cast').length === 0 &&
            floats(game).includes('NOT ENOUGH MANA'),
        `mana=${game.stats.mana} ${JSON.stringify(floats(game))}`);
    race.stop();
}

// (j) the guest's chip heals itself from the host's heartbeat.
{
    const { race } = buildRace(false, 'Novice');
    race._onRace({
        raceType: 'state', hpA: 100, hpB: 100, winsA: 0, winsB: 0,
        timeLeft: 100, overtime: false, armed: { A: 'time-stop', B: null },
        auras: { A: 'time-stop', B: null }, timeStopUntil: 0, timeStopSlot: null
    });
    check('the guest adopts the host\'s armed map from a state frame',
        race.buffs.A === 'time-stop' && els['sb-buff-a'].textContent === 'PVP ACTIVE · TIME STOP ★',
        JSON.stringify(race.buffs));
    race.stop();
}

// (k) the endless combo aura is mirrored to the opponent without a HUD number.
{
    const { game, duel, race } = buildRace(true, 'Novice');
    race.phase = 'word';
    race._onCombo(27);
    const progress = duel.sent.find((m) => m.type === 'combo');
    check('a local combo updates the Arena slot and sends bounded progress',
        race.duelCombos.A === 27 && game.duelCombos.A === 27 && progress &&
            progress.combo === 27 && progress.idx === race.idx,
        JSON.stringify({ combo: race.duelCombos.A, progress }));
    race._onRace({ raceType: 'combo', idx: race.idx, combo: 41, player_key: 'key-guest' });
    check('the opponent combo frame updates the opponent slot only',
        race.duelCombos.B === 41 && race.duelCombos.A === 27,
        JSON.stringify(race.duelCombos));
    const state = race._snapshot({});
    check('the heartbeat and result snapshot carry both combo values',
        state.combos.A === 27 && state.combos.B === 41,
        JSON.stringify(state.combos));
    race.stop();
}

// (l) a duel leaves no trace: labels, chips and Tab all handed back.
{
    const { game, race } = buildRace(true, 'Novice');
    race.cast();
    race.stop();
    check('stop() restores the Survival wording and clears the hook',
        els['mobile-nova-btn'].textContent === 'CAST NOVA' &&
            els['mana-hint'].innerHTML === 'Press <kbd>Tab</kbd> or <kbd>Enter</kbd> to cast Nova!' &&
            game.onDuelCast === null,
        `${els['mobile-nova-btn'].textContent} | ${game.onDuelCast}`);
    check('stop() disarms both mages and blanks both chips',
        race.buffs.A === null && race.buffs.B === null &&
            els['sb-buff-a'].textContent === '' && els['sb-buff-a'].classList.contains('hidden') &&
            els['sb-buff-b'].textContent === '' && els['sb-buff-b'].classList.contains('hidden'));
    check('a stopped race ignores the press (Tab is the ultimate again)', race.cast() === false);
}

console.log('');
if (failures) {
    console.error(`${failures} AT-F10 class-active check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-F10 class-active roster, arbitration and behaviour checks passed.');
process.exit(0);

