/**
 * AT-M6 — every word the game can spawn must be typeable.
 *
 *   npm run verify:wordmatch
 *
 * WHY THIS EXISTS. On 2026-09-08 the owner reported words that stayed
 * undestroyed after being typed in full, still falling (ROADMAP Bug #1D). The
 * cause the register credits is a case-folding defect fixed in `b521cf6`:
 * `InputHandler.processKeystroke` compared `word.untyped[0] === letter`, so a
 * word beginning with a capital could never match a lowercased keystroke. The
 * fix compares `.toLowerCase()` on both sides. The repair is real, but for six
 * weeks nothing prevented the same class of defect from returning, and the
 * trigger data is still in the game: the coding Spellbook ships 55 words that
 * start with a capital, including `Headers` and `XMLHttpRequest` — the exact
 * words the register names. The words were never removed; only the comparison
 * was repaired. That is a promise worth locking.
 *
 * WHAT IT LOCKS. It imports the REAL `InputHandler` and types EVERY word from
 * BOTH shipped dictionaries through the real `handleKeyDown`, feeding each
 * character in LOWERCASE (what a keyboard with no shift held sends), then
 * asserts the word actually reached `untyped === ''` with `dying === true`.
 * That is the whole contract: if a word can spawn, a player can complete it.
 *
 * This executes the shipped code rather than re-implementing the comparison. A
 * guard that recomputes the rule tests its own copy, not the game — the failure
 * this repo has already paid for once (see the header of verify-scribe-dict).
 *
 *   1. all 797 classic words are typeable;
 *   2. all 201 coding words are typeable, INCLUDING every capitalised one;
 *   3. the capitalised set is non-empty — if someone "fixed" the bug by
 *      deleting the trigger words, this goes red, because that would remove
 *      content rather than fix matching;
 *   4. the shipped comparison is case-insensitive on BOTH sides, so a
 *      regression to a one-sided `===` is caught by the source check even if a
 *      future dictionary happens to contain no capitals;
 *   5. a word the player MISTYPES does not silently complete, and the armored
 *      reset path is untouched;
 *   6. `verify:wordmatch` is wired into `npm run verify`.
 *
 * Run:  node scripts/verify-word-match.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// InputHandler pulls in FloatingText / Projectile / Particle, which reach for
// browser globals. The same shim verify-scribe-dict uses is enough.
let mem = {};
globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
};
globalThis.window = { game: null, addEventListener() { }, removeEventListener() { } };
if (!('navigator' in globalThis)) {
    Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node' }, configurable: true });
}
globalThis.document = {
    getElementById: () => null, querySelector: () => null, addEventListener() { },
    createElement: () => ({
        style: {}, classList: { add() { }, remove() { }, toggle() { } },
        appendChild() { }, addEventListener() { }
    })
};

const { InputHandler } = await import('../frontend/game/InputHandler.js');
const { wordList, codingList } = await import('../frontend/WordDictionary.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

const TIERS = ['easy', 'medium', 'hard', 'epic'];
const collect = (list) => [...new Set(TIERS.flatMap((t) => (list[t] || [])))];

/**
 * A Game stub carrying exactly the surface `handleKeyDown`/`processKeystroke`
 * touch. `hasSkill` returns false so the Combustion AoE branch is skipped —
 * it would otherwise destroy neighbouring words and mask the result.
 */
function makeGame() {
    return {
        isRunning: true,   // handleKeyDown returns immediately without it
        words: [], projectiles: [], floatingTexts: [], targetedWord: null,
        isBossPhase: false, boss: null, waveWordsTyped: 0, playerAnimTimer: 0,
        canvas: { width: 1280, height: 720 },
        ctx: { font: '', measureText: (s) => ({ width: String(s).length * 8 }) },
        stats: {
            combo: 0, selectedCharacter: 'wizard',
            recordStroke() { }, addScore() { }, hasSkill: () => false, updateHUD() { }
        },
        // Every audio method the keystroke path calls, including the armored
        // typo-reset branch (playShatter) and the combo-driven music ramp.
        audio: {
            playTypeSound() { }, playExplosion() { }, playErrorSound() { },
            playShatter() { }, setMusicIntensity() { }
        },
        combatSystem: {
            spawnHitSpark() { }, triggerShake() { }, spawnWordDefeat() { }
        },
        achievements: { onEvent() { } },
    };
}

const handler = new InputHandler(makeGame());
const game = handler.game;

/** A meteor carrying the fields the keystroke path reads. */
function makeWord(word, variant = 'normal') {
    return {
        text: word, typed: '', untyped: word, mistakesMade: 0,
        x: 0, y: 0, scale: 1, variant, isBossAttack: false,
        dying: false, isDead: false, isTargeted: true,
        elementColors: { particles: ['#00e5ff'] }
    };
}

const press = (w, ch) => {
    game.words = [w];
    game.targetedWord = w;
    handler.handleKeyDown({
        key: ch, ctrlKey: false, altKey: false, metaKey: false, preventDefault() { }
    });
};

/** Type `word` in full, LOWERCASE, through the real handler. Returns the meteor. */
function typeWord(word, { mistypeFirst = false, variant = 'normal' } = {}) {
    const w = makeWord(word, variant);
    if (mistypeFirst) press(w, 'q');
    for (const ch of word) {
        press(w, ch.toLowerCase());
        if (!w.untyped || w.untyped.length === 0) break;
    }
    return w;
}

// ── the contract: every shipped word is typeable ───────────────────────────
for (const [name, list] of [['classic', wordList], ['coding', codingList]]) {
    const words = collect(list);
    const unfinishable = [];
    for (const word of words) {
        const w = typeWord(word);
        if (!(!w.untyped || w.untyped.length === 0) || !w.dying) {
            unfinishable.push(`${word} (untyped left: ${JSON.stringify(w.untyped)}, dying: ${w.dying})`);
        }
    }
    check(`all ${words.length} ${name} words are typeable end-to-end`,
        unfinishable.length === 0,
        unfinishable.length ? `${unfinishable.length} unfinishable: ${unfinishable.slice(0, 8).join('; ')}` : '');
}

// ── the capitalised trigger set is still present AND still typeable ────────
const caps = collect(codingList).filter((w) => /^[A-Z]/.test(w));
check('the coding Spellbook still ships capitalised words (the trigger class)',
    caps.length > 0,
    `${caps.length} capitalised words; if this is 0 the bug was hidden by DELETING content, not fixed`);
const capFails = caps.filter((w) => {
    const m = typeWord(w);
    return !(!m.untyped || m.untyped.length === 0);
});
check('every capitalised word is typeable in lowercase',
    capFails.length === 0, capFails.join(', '));
check('the two words the register names are covered',
    caps.includes('Headers') && caps.includes('XMLHttpRequest'),
    `Headers: ${caps.includes('Headers')}, XMLHttpRequest: ${caps.includes('XMLHttpRequest')}`);

// ── the comparison itself, so a regression is caught even without capitals ──
const handlerSrc = read('frontend/game/InputHandler.js');
check('processKeystroke lowercases BOTH sides of the comparison',
    /word\.untyped\[0\]\.toLowerCase\(\) === letter/.test(handlerSrc),
    'a one-sided `===` is the 2026-09-08 bug exactly; a future dictionary with no capitals would hide it');
check('re-acquiring a target also compares case-insensitively',
    /w\.untyped\[0\]\.toLowerCase\(\) === letter/.test(handlerSrc));
// Index arithmetic rather than a regex with a character budget: the assignment
// sits six lines below the branch, and a budget tuned by eye (200 was tried)
// goes stale silently the first time anyone adds a line in between.
const branchAt = handlerSrc.indexOf("if (word.untyped.length === 0)");
const dyingAt = handlerSrc.indexOf("word.dying = true;", branchAt);
check("a completed word is marked dying, never left falling",
    branchAt !== -1 && dyingAt > branchAt,
    "this is the AT-M6 invariant: fully typed must mean dying");

// ── a mistyped word must NOT complete ─────────────────────────────────────
// The wrong key ALONE must not complete the word, and the player must then be
// able to recover by typing it properly. Typing the whole word after the
// mistake (as a single call would) completes it by design and proves nothing.
const w1 = makeWord('Headers');
press(w1, 'q');
check('a wrong key does not silently complete a capitalised word',
    !!w1.untyped && w1.untyped.length > 0,
    );
check('the wrong key is recorded as a mistake', w1.mistakesMade > 0);
for (const ch of 'Headers') { press(w1, ch.toLowerCase()); if (!w1.untyped) break; }
check('the player can still recover and complete it', !w1.untyped && w1.dying);
const done = typeWord('Headers');
check('a clean capitalised word completes and dies', !done.untyped && done.dying);

// ── the armored typo-reset path is untouched by this change ───────────────
const armored = typeWord('Shield', { mistypeFirst: true, variant: 'armored' });
check('an armored word still records the mistake', armored.mistakesMade > 0);

check('verify:wordmatch is a script and part of the chain',
    read('package.json').includes('"verify:wordmatch": "node scripts/verify-word-match.mjs"') &&
    read('package.json').includes('&& npm run verify:wordmatch'));

console.log('');
if (failures) {
    console.error(`${failures} word-match check(s) FAILED.`);
    process.exit(1);
}
console.log(`All AT-M6 word-match checks passed (${collect(wordList).length} classic + ${collect(codingList).length} coding words typeable, ${caps.length} of them capitalised).`);
