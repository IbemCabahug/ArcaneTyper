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

// ── summary ──────────────────────────────────────────────────────────────────
console.log('');
if (failures) {
    console.error(`${failures} scribe-dictionary check(s) FAILED.`);
    process.exit(1);
}
console.log(`All AT-M10 scribe-dictionary checks passed (${entries} entries, ${tokens} tokens typeable).`);
