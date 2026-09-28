/**
 * Regression guard for the mobile input bridge (AT-M6's residual risk).
 *
 *   npm run verify:input
 *
 * WHY THIS IS GUARDED RATHER THAN TRUSTED. The bridge turns soft-keyboard
 * `input` events on a hidden field into synthetic keydowns. Its fallback —
 * `value.slice(-1)` — was recorded in PROJECT_STATUS as returning the wrong
 * character under IME composition, iOS autocapitalise and autocomplete, and it
 * was explicitly annotated "derived from reading, not reproduced". That is the
 * weakest evidence this project accepts, so it was reproduced:
 * scratch/probe-mobile-input.mjs dispatches real InputEvents at the real build
 * and records the keys the game receives. Against the shipped build it found
 * three real defects:
 *
 *   IME mid-composition  the game received the PARTIAL character 'に'
 *   phantom space        the game received a SPACE the player never typed
 *   paste                the game received a single 'o' for a paste of "hello"
 *
 * The phantom space is the serious one — a space terminates a word in this game.
 * Its cause is the padding trick: soft keyboards only emit
 * `deleteContentBackward` when there is something to delete, so the field is
 * force-reset to a single space after every event, and `slice(-1)` on an event
 * that added nothing returns that padding.
 *
 * WHAT THIS LOCKS. This does not merely grep for the fixed strings: it SLICES
 * THE REAL LISTENER OUT OF main.js and executes it against a stub input element
 * and a stub game, then asserts what the game would have been sent — the same
 * technique verify:roster uses to run the real `purchaseCharacter`. A guard that
 * only pattern-matches would pass against a bridge that is correct in shape and
 * wrong in behaviour, which is precisely the failure this whole story is about.
 *
 *   1. all ten behavioural cases (ordinary char, uppercase, genuine space,
 *      backspace, data-null-but-value-grew, IME mid-composition, IME commit,
 *      autocomplete, phantom space, paste) execute against the shipped source;
 *   2. the padding invariant — the field holds exactly one space when idle,
 *      which is the reference the whole fallback depends on;
 *   3. the fallback requires the value to have GROWN past that padding
 *      (`length > 1`), not merely to be non-empty (`length > 0`) — the single
 *      character that regresses this is the one that reintroduces the phantom;
 *   4. composition and paste are explicitly excluded, not merely unreached;
 *   5. the padding is restored unconditionally, so an early `return` cannot be
 *      reintroduced above it (that bug let characters accumulate between runs);
 *   6. the hidden field keeps the attributes that suppress the very keyboards
 *      whose events caused the problem;
 *   7. `verify:input` is wired into `npm run verify`.
 *
 * Run:  node scripts/verify-mobile-input.mjs
 */


import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

const mainSrc = read('frontend/main.js');
const html = read('frontend/index.html');
const pkgSrc = read('package.json');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? `  → ${detail}` : ''}`);
}

/** Brace-matched body, given the index of an opening `{`. */
function sliceBlock(src, openIndex) {
    let depth = 0;
    for (let i = openIndex; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(openIndex + 1, i);
        }
    }
    return '';
}

// ── slice the REAL listener out of main.js and run it ───────────────────────
const anchor = mainSrc.indexOf("mobileInput.addEventListener('input'");
check('the mobile input bridge exists in main.js', anchor !== -1);
const body = anchor === -1 ? '' : sliceBlock(mainSrc, mainSrc.indexOf('{', anchor));
check('the bridge listener body was sliced out', body.length > 40, `${body.length} chars`);

// Build a function over the real body with its closed-over names injected. The
// sliced text is the arrow's INNER block, so `e` is that arrow's parameter and
// must be declared here; `mobileInput` is the hidden field, and `game`/`scribe`
// are the two consumers.
let runBridge = null;
try {
    runBridge = new Function('e', 'mobileInput', 'game', 'scribe', body);
} catch (err) {
    check('the sliced bridge compiles as a function', false, err.message);
}
if (runBridge) check('the sliced bridge compiles as a function', true);

/** Drive the real bridge with one synthetic input event. Returns the keys sent. */
function send({ inputType, data = null, value, isComposing = false }, running = true) {
    const sent = [];
    const mobileInput = { value: value === undefined ? ' ' : value };
    const game = { isRunning: running, inputHandler: { handleKeyDown: (e) => sent.push(e.key) } };
    const scribe = { isRunning: false, handleKeyDown: (e) => sent.push(e.key) };
    runBridge({ inputType, data, isComposing }, mobileInput, game, scribe);
    return { keys: sent, valueAfter: mobileInput.value };
}

/**
 * The ten behaviours a soft keyboard actually produces. `value` is the field's
 * state when the event FIRES — always at least the one padding space, because
 * the bridge restores it after every event.
 */
const CASES = [
    { name: 'an ordinary character is forwarded',        ev: { inputType: 'insertText', data: 'a', value: ' a' }, expect: ['a'] },
    { name: 'an uppercase character is lowercased',      ev: { inputType: 'insertText', data: 'A', value: ' A' }, expect: ['a'] },
    { name: 'a genuine space is forwarded as a space',   ev: { inputType: 'insertText', data: ' ', value: '  ' }, expect: [' '] },
    { name: 'backspace is forwarded as Backspace',       ev: { inputType: 'deleteContentBackward', data: null, value: '' }, expect: ['Backspace'] },
    { name: 'e.data null but the value GREW is trusted', ev: { inputType: 'insertText', data: null, value: ' x' }, expect: ['x'] },
    { name: 'IME mid-composition types NOTHING',         ev: { inputType: 'insertCompositionText', data: 'に', value: ' に', isComposing: true }, expect: [] },
    { name: 'a committed composition types its last char', ev: { inputType: 'insertCompositionText', data: '日本', value: ' 日本' }, expect: ['本'] },
    { name: 'an autocomplete expansion types its last char', ev: { inputType: 'insertText', data: ' wo', value: '  wo' }, expect: ['o'] },
    { name: 'NO PHANTOM SPACE when the event added nothing', ev: { inputType: 'insertText', data: null, value: ' ' }, expect: [] },
    { name: 'a paste types NOTHING',                     ev: { inputType: 'insertFromPaste', data: 'hello', value: ' hello' }, expect: [] },
];

for (const c of CASES) {
    const got = send(c.ev);
    check(c.name, JSON.stringify(got.keys) === JSON.stringify(c.expect),
        `sent ${JSON.stringify(got.keys)}, expected ${JSON.stringify(c.expect)}`);
}

// ── the padding invariant, which the whole fallback rests on ────────────────
for (const [label, ev] of [
    ['ordinary character', CASES[0].ev],
    ['a rejected phantom event', CASES[8].ev],
    ['backspace', CASES[3].ev],
]) {
    const got = send(ev);
    check(`the padding is restored after ${label}`, got.valueAfter === ' ',
        `field left as ${JSON.stringify(got.valueAfter)}`);
}
// The idle case must start from a DIRTY field. Seeding it with the padding
// space it is supposed to end up holding would let a bridge that never restores
// it pass — which is exactly the bug an early `return` above the restore causes.
const idleRun = send({ inputType: 'insertText', data: null, value: 'z' }, false);
check('the padding is restored even while NO run is active',
    idleRun.valueAfter === ' ' && idleRun.keys.length === 0,
    `a non-running run left the field as ${JSON.stringify(idleRun.valueAfter)}; the old handler returned before restoring it, so characters accumulated between runs`);

// ── source invariants: the shapes that would undo the behaviour above ───────
check('the fallback requires the value to have GROWN past the padding (length > 1)',
    /mobileInput\.value\.length > 1/.test(body),
    '`length > 0` is the exact shape that produced the phantom space');
check('no fallback compares against length > 0 any more',
    !/mobileInput\.value\.length > 0/.test(body));
check('IME composition is explicitly excluded, not merely unreached',
    /e\.isComposing === true/.test(body));
check('paste is explicitly excluded',
    /e\.inputType === 'insertFromPaste'/.test(body));
check('multi-character inserts are handled deliberately, not by accident',
    /e\.data\.slice\(-1\)/.test(body),
    'a committed composition or autocomplete expansion takes its last character');
check('the dispatch is gated on a run being active',
    /char && \(game\.isRunning \|\| scribe\.isRunning\)/.test(body));

// The padding restore must be the LAST statement in the bridge. An earlier
// `return` above it reintroduces the accumulate-between-runs bug, and an
// assertion built on `lastIndexOf('return')` would MISS that: the early return
// sits BEFORE the restore, so a last-index comparison still looks correct.
// This is checked by stripping comments off everything after the restore and
// requiring nothing to remain, which is what actually pins it to the end.
const restore = "mobileInput.value = ' '";
const restoreAt = body.lastIndexOf(restore);
const tail = body.slice(restoreAt + restore.length)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/;\s*$/, '')   // the restore's own statement terminator is not trailing content
    .trim();
check('the padding restore is the LAST statement in the bridge',
    restoreAt !== -1 && tail === '',
    `trailing content after the restore: ${JSON.stringify(tail.slice(0, 60))}`);
check('there is exactly one padding restore, so no path skips it',
    body.split(restore).length - 1 === 1,
    `${body.split(restore).length - 1} occurrences`);

// ── the hidden field keeps suppressing the keyboards that caused this ───────
const field = html.match(/<input[^>]*id="mobile-input"[^>]*>/);
check('#mobile-input is still in the markup', !!field);
if (field) {
    for (const attr of ['autocomplete="off"', 'autocorrect="off"', 'autocapitalize="off"', 'spellcheck="false"']) {
        check(`#mobile-input keeps ${attr}`, field[0].includes(attr),
            'iOS autocapitalise is one of the events that produced a wrong character');
    }
}

// ── wired into the chain ────────────────────────────────────────────────────
check('verify:input is a script and part of the chain',
    pkgSrc.includes('"verify:input": "node scripts/verify-mobile-input.mjs"') &&
    pkgSrc.includes('&& npm run verify:input'));

console.log('');
if (failures) {
    console.error(`${failures} mobile-input check(s) FAILED.`);
    process.exit(1);
}
console.log('All mobile input-bridge checks passed.');
