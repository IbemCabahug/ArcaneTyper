/**
 * AT-M10 — the coding dictionary's paragraphs held words no keyboard can type.
 *
 * The four `codingList.paragraphs` entries are real multi-line code snippets, so
 * they carry `\n` plus the double space of an indent. `Scribe._appendParagraphs`
 * split them on a single literal space, which produced two unplayable kinds of
 * word:
 *
 *   "timeout;\n" — the expected character is a newline, and `handleKeyDown`
 *                  discards every `e.key.length > 1` that is not Backspace, so
 *                  Enter can never satisfy it;
 *   ""           — the indent's double space produced an EMPTY word element.
 *
 * Neither is a soft block: pressing SPACE "completes" such a word, but
 * `_handleSpace` counts every untaken letter as a WRONG keystroke. So a coding
 * passage silently taxed the player's accuracy on text that was impossible to
 * type, and the DOM rendered a stray blank. Measured on the shipped data:
 * 110 of 201 tokens (55%) were empty or untypeable.
 *
 * THE FIX IS AT THE DRAW BOUNDARY. The paragraphs are valid code and are left
 * alone; they are merely not typeable as a typing game. Editing source prose to
 * suit a renderer is the wrong direction of dependency. The code is still read
 * in its original order, so flattening the line breaks costs nothing the player
 * could have typed.
 *
 * This guard imports the REAL `Scribe` and calls the REAL `tokenizeParagraph`.
 * An earlier guard in this repo reconstructed a method with `new Function` from
 * a regex slice and silently disagreed with the shipped code — a test of a copy
 * is not a test of the code, which is exactly the failure this file exists to
 * prevent repeating.
 *
 * Run:  node scripts/verify-scribe-dict.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// Scribe reaches for browser globals at construction; tokenizeParagraph is
// static and touches none of them, but the module still imports cleanly only
// if these exist.
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
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() { },
    createElement: () => ({
        style: {}, classList: { add() { }, remove() { }, toggle() { } },
        appendChild() { }, addEventListener() { }
    })
};

const { Scribe } = await import('../frontend/Scribe.js');
const { wordList, codingList } = await import('../frontend/WordDictionary.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

/** What a single `keydown` can actually satisfy, per Scribe.handleKeyDown. */
const typeable = (token) => token.length > 0 && [...token].every((c) => c >= ' ' && c <= '~');

// ── the shipped tokenizer behaves ──────────────────────────────────────────
check('Scribe.tokenizeParagraph is a static method on the real class',
    typeof Scribe?.tokenizeParagraph === 'function');
check('a paragraph with newlines and indent yields no untypeable token',
    Scribe.tokenizeParagraph('a {\n  b();\n  c;\n}').every(typeable));
check('tokenizeParagraph never yields an empty token',
    Scribe.tokenizeParagraph('a  \n\n  b').every((t) => t.length > 0));
check('tokenizeParagraph preserves reading order',
    Scribe.tokenizeParagraph('function debounce(func, wait) {\n  let timeout;\n}')
        .join(' ') === 'function debounce(func, wait) { let timeout; }',
    'the code must still read in its original order — only the line breaks go');
check('tokenizeParagraph handles an empty or whitespace-only paragraph',
    Scribe.tokenizeParagraph('').length === 0 && Scribe.tokenizeParagraph('   \n  ').length === 0);

// ── every shipped dictionary entry, checked with that same function ─────────
let entries = 0, tokens = 0, bad = 0;
const offenders = [];
for (const [dictName, dict] of Object.entries({ wordList, codingList })) {
    for (const [tier, list] of Object.entries(dict)) {
        if (!Array.isArray(list)) continue;
        entries++;
        for (const raw of list) {
            // Single-word tiers go through the same draw path.
            for (const token of Scribe.tokenizeParagraph(raw)) {
                tokens++;
                if (!typeable(token)) {
                    bad++;
                    if (offenders.length < 5) offenders.push(`${dictName}.${tier}: ${JSON.stringify(token)}`);
                }
            }
        }
    }
}
check(`every one of the ${entries} shipped dictionary entries yields only typeable tokens`,
    bad === 0, `${bad}/${tokens} bad — ${offenders.join(' ')}`);

// The regression, stated as a number, so a future change cannot quietly restore it.
const paras = codingList.paragraphs;
const oldSplit = paras.flatMap((p) => p.split(' '));
const newSplit = paras.flatMap((p) => Scribe.tokenizeParagraph(p));
const oldBad = oldSplit.filter((t) => !typeable(t)).length;
check('the original split-on-space really did produce unplayable words',
    oldBad > 0, 'if this is 0 the premise is wrong and the guard is testing nothing');
check('every coding paragraph is now fully playable',
    newSplit.length > 0 && newSplit.every(typeable),
    `${oldSplit.length} raw -> ${newSplit.length} playable, ${oldBad} were unplayable`);

// ── the call site actually uses it ──────────────────────────────────────────
const live = read('frontend/Scribe.js');
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('BOTH draw paths call Scribe.tokenizeParagraph (timed buffer AND the one-shot path)',
    (codeOf(live).match(/Scribe\.tokenizeParagraph\(/g) || []).length === 2,
    'this guard caught a second, identical split in the non-timed path when the fix was first written — count the call sites, do not grep one line');
check('no split-on-a-single-space survives anywhere in Scribe.js',
    !/\.split\(' '\)/.test(codeOf(live)),
    'any surviving split would reintroduce the untypeable tokens');

// ── AT-L9: one canonical Scribe score ────────────────────────────────────────
// The identical run used to record a score 10x apart in two places:
// `Scribe.finishTrial` wrote `floor(wpm * accuracy/100) * 10` to `run_history`,
// while `main.js` recomputed the same quantity WITHOUT the *10 and submitted
// that to the Hall of Fame. So a player's own Recent Runs and the public board
// disagreed about the same run by a factor of ten.
//
// This executes the REAL `Scribe.prototype.finishTrial` (imported, not
// reconstructed — the header of this file records what a `new Function` slice
// cost this repo once) against stubbed getters and a recording Stats, then
// reads back all three numbers the method hands out: the XP award, the
// `run_history` score, and the score passed to `onTrialComplete` for the board.
// The bug is precisely that these disagree, so the guard asserts they are the
// same value.
function runRealFinishTrial({ wpm, accuracy }) {
    const calls = { xp: [], runs: [], trial: null };
    const el = () => ({ innerText: '', classList: { add() { }, remove() { } } });
    const s = Object.create(Scribe.prototype);
    s.stats = {
        addXP: (n) => calls.xp.push(n),
        logRunToSupabase: (mode, w, a, score) => calls.runs.push({ mode, wpm: w, accuracy: a, score })
    };
    s.stop = () => { };
    s.getWPM = () => wpm;
    s.getRawWPM = () => wpm;
    s.getAccuracy = () => accuracy;
    s.getConsistency = () => 90;
    s.resWpm = el(); s.resRawWpm = el(); s.resAcc = el(); s.resConsistency = el();
    s.resultsMenu = el();
    s.wpmSamples = [10, 20, 30];
    s.maxStreak = 7;
    s.onTrialComplete = (w, r, a, c, samples, streak, score) => { calls.trial = { score, streak }; };
    s.finishTrial();
    return calls;
}

const CANONICAL = (wpm, accuracy) => Math.floor(wpm * (accuracy / 100));
// What the OLD code awarded, spelled out from the shipped source: the score
// carried a *10 and XP divided by 10, so the two cancelled.
const LEGACY_XP = (wpm, accuracy) => Math.floor((Math.floor(wpm * (accuracy / 100)) * 10) / 10);

for (const { wpm, accuracy } of [{ wpm: 60, accuracy: 100 }, { wpm: 83, accuracy: 96.4 }, { wpm: 0, accuracy: 100 }]) {
    const r = runRealFinishTrial({ wpm, accuracy });
    const want = CANONICAL(wpm, accuracy);
    const tag = `(wpm ${wpm}, acc ${accuracy})`;

    check(`AT-L9 ${tag}: run_history and the Hall of Fame record the SAME score`,
        r.runs.length === 1 && r.trial && r.runs[0].score === r.trial.score,
        `run_history ${r.runs[0]?.score} vs leaderboard ${r.trial?.score}`);
    check(`AT-L9 ${tag}: that score is the canonical un-multiplied value`,
        r.runs[0]?.score === want, `got ${r.runs[0]?.score}, expected ${want}`);
    check(`AT-L9 ${tag}: the run is logged as a 'scribe' run`,
        r.runs[0]?.mode === 'scribe' && r.runs[0]?.wpm === wpm && r.runs[0]?.accuracy === accuracy);
    // The non-regression that matters most. Removing the *10 while leaving the
    // /10 in place would look like a tidy-up and would cut Scribe XP tenfold.
    check(`AT-L9 ${tag}: XP is UNCHANGED from the pre-fix award`,
        r.xp.length === 1 && r.xp[0] === LEGACY_XP(wpm, accuracy),
        `got ${r.xp[0]}, legacy award was ${LEGACY_XP(wpm, accuracy)}`);
    check(`AT-L9 ${tag}: the streak still reaches the board callback`,
        r.trial?.streak === 7);
}

// The score must be defined in exactly ONE place. Two copies are what drifted,
// so a second copy is the regression even when both happen to agree today.
const mainLive = codeOf(read('frontend/main.js'));
const scribeLive = codeOf(live);
const formula = 'Math.floor(wpm * (accuracy / 100))';
check('AT-L9 the Scribe score formula exists exactly ONCE in the game source',
    (mainLive.split(formula).length - 1) + (scribeLive.split(formula).length - 1) === 1,
    `${scribeLive.split(formula).length - 1} in Scribe.js, ${mainLive.split(formula).length - 1} in main.js`);
check('AT-L9 no x10 multiplier survives in the Scribe score path',
    !/const scribeScore = Math\.floor\(wpm \* \(accuracy \/ 100\)\) \* 10;/.test(scribeLive));
check('AT-L9 XP is not silently divided by 10 any more',
    !/addXP\(Math\.floor\(scribeScore \/ 10\)\)/.test(scribeLive),
    'the /10 only ever cancelled the *10; keeping it alone would cut XP tenfold');
check('AT-L9 finishTrial hands its score to the board callback',
    /onTrialComplete\([^)]*this\.maxStreak,\s*scribeScore\)/.test(scribeLive));
check('AT-L9 the main.js handler accepts the passed score instead of recomputing it',
    /onTrialComplete = async \([^)]*scribeScore\)/.test(mainLive));
check('AT-L9 a missing score skips submission loudly rather than inventing one',
    /Number\.isFinite\(scribeScore\)/.test(mainLive) &&
        /onTrialComplete received no score/.test(mainLive));

console.log('');
if (failures) {
    console.error(`${failures} scribe-dictionary check(s) FAILED.`);
    process.exit(1);
}
console.log(`All AT-M10 scribe-dictionary checks passed (${entries} entries, ${tokens} tokens typeable).`);
