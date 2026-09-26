/**
 * Rolling-WPM sample gate — owner bug report 2026-09-26.
 *
 * "even if you only typed the first word some of the achievement will become
 * unlockable as it is only about wpm and accuracy which can easily be obtained
 * while writing the first word."
 *
 * Correct, and worse than it sounds. `Stats.getWPM()` divided by
 * `Math.max(1000, now - oldest)` — a 1-second FLOOR added to stop `Infinity` when
 * two keystrokes landed in the same millisecond. A floor does not merely prevent
 * the divide-by-zero, it INFLATES every short window, so any burst of 9 correct
 * keystrokes inside one second computed as 100+ WPM. That unlocked `speed_demon`,
 * and because accuracy is likewise a 9-sample ratio, `celestial_focus` (100 WPM
 * AND 95%+ accuracy) fired from the same single word.
 *
 * The fix refuses to report a number the sample cannot support. This guard
 * proves the rule against the REAL `Stats` class — instantiated, not string-sliced
 * and rebuilt. An earlier version of this test reconstructed `getWPM()` with
 * `new Function` from a regex slice and silently disagreed with the shipped
 * method (NaN where the real class correctly returned 0); a guard that tests a
 * copy of the code is not a guard, so the class is imported and driven directly.
 *
 * Run:  node scripts/verify-wpm-sample-gate.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

// The module reaches for browser globals at construction time.
let mem = {};
globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
};
globalThis.window = { game: null, addEventListener() { }, removeEventListener() { } };
// Node 24 defines `navigator` as a getter-only global, so a plain assignment
// throws. Only Stats.js's own audio probe reads it, and it degrades on undefined,
// so the property is defined rather than replaced.
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

const { Stats } = await import('../backend/Stats.js');

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

/** Type `count` correct keystrokes `gap` ms apart, then read the rolling WPM. */
function sample(count, gap) {
    const s = new Stats(null);
    s.achievements = { fired: [], onEvent(n, d) { this.fired.push({ n, wpm: d.wpm }); } };
    s._keystrokeTimestamps = [];
    const t0 = 1_000_000;
    for (let i = 0; i < count; i++) s._keystrokeTimestamps.push(t0 + 1000 + i * gap);
    const frozen = t0 + 1000 + (count - 1) * gap;
    const realNow = Date.now;
    Date.now = () => frozen;
    try {
        const wpm = s.getWPM();
        return { wpm, events: s.achievements.fired };
    } finally {
        Date.now = realNow;
    }
}

// ── 1. the reported bug ──────────────────────────────────────────────────────
const fastWord = sample(9, 40);
check('a single fast word reports NO wpm (speed_demon cannot fire)',
    fastWord.wpm === 0, `reported ${fastWord.wpm} WPM from 9 keystrokes`);
check('a single fast word fires NO wpm_update event',
    fastWord.events.length === 0, `${fastWord.events.length} event(s)`);

// ── 2. neither half of the gate may be dropped on its own ────────────────────
// Time alone is fooled by a slow start; keystrokes alone by a burst.
const relaxed = sample(9, 120);
check('9 keystrokes at a relaxed pace (about 49 real WPM) reports NO wpm',
    relaxed.wpm === 0, `reported ${relaxed.wpm} WPM`);
const slowStart = sample(5, 700);
check('a long span with too few keystrokes reports NO wpm',
    slowStart.wpm === 0, `reported ${slowStart.wpm} WPM`);
// 9 keystrokes spread over 3.2s CLEARS the time half but not the keystroke one.
// This case is the only thing that exercises the keystroke half on its own: every
// other sample here is either a short burst (time half) or a long slow crawl.
// Without it, deleting `countInWindow < _wpmSampleKeystrokes` outright was a
// mutation no check noticed — the half would have rotted unnoticed.
const spreadThin = sample(9, 400);
check('a 3.2s span with only 9 keystrokes still reports NO wpm',
    spreadThin.wpm === 0, `reported ${spreadThin.wpm} WPM — the keystroke half is inert`);

// ── 3. the gate must not hold back an honest fast typist ─────────────────────
// 31 keystrokes at 100ms spans exactly 3.0s (the gate) and computes to 124 WPM,
// comfortably over the 100 both achievements ask for. An earlier draft used 30
// keys, which spans 2.9s and is correctly rejected — the boundary is real.
const real = sample(31, 100);
check('a genuine fast sample IS still reported',
    real.wpm >= 100, `reported ${real.wpm} WPM over 31 keystrokes in 3.0s`);
check('a qualifying sample fires exactly one wpm_update event',
    real.events.length === 1 && real.events[0].n === 'wpm_update',
    JSON.stringify(real.events.map((e) => e.n)));

// ── 4. the reason the old floor existed at all ───────────────────────────────
const burst = sample(20, 0);
check('same-millisecond keystrokes never yield Infinity or NaN',
    Number.isFinite(burst.wpm), `reported ${burst.wpm}`);

// ── 5. the floor must stay gone ──────────────────────────────────────────────
// Read from COMMENT-STRIPPED source: the note in Stats.js quotes the removed line
// to explain the fix, and a raw-source match would flag that very comment.
const live = read('backend/Stats.js');
const codeOf = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('the Math.max(1000, …) span floor is gone from getWPM()',
    !/Math\.max\(1000,\s*now\s*-\s*oldest\)/.test(codeOf(live)),
    'the floor inflates every short window — that was the bug');
check('the sample gate is present in the shipped method',
    /_wpmSampleKeystrokes/.test(codeOf(live)) && /_wpmSampleMs/.test(codeOf(live)));
check('getWPM() still fires wpm_update (AT-F12 depends on it)',
    /onEvent\('wpm_update'/.test(codeOf(live)),
    'guarding the call would silently break speed_demon forever');

// ── summary ──────────────────────────────────────────────────────────────────
console.log('');
if (failures) {
    console.error(`${failures} rolling-WPM sample check(s) FAILED.`);
    process.exit(1);
}
console.log('All rolling-WPM sample checks passed.');