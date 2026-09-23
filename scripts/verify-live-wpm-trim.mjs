/**
 * Regression guard for AT-F12 — live WPM out of Survival and PvP (owner
 * direction 2026-09-23: "in our pvp and our survival, the wpm never mattered…
 * remove that… put it in the scribe").
 *
 * Live WPM never influences a decision mid-run (score, combo and HP do), so the
 * SPEED box is gone: the PvP half landed with AT-F9 Phase 2 (`84b858a`, the box
 * was merely hidden for a match) and this guard covers the Survival half, where
 * `#wpm-display` / `.stat-wpm` were deleted outright.
 *
 * The trap this guard exists for is NOT the deletion, it is the side effect:
 * `Stats.getWPM()` also fires `wpm_update`, which unlocks the `speed_demon`
 * achievement. "Delete the SPEED box" read naively is "stop calling getWPM()",
 * which would silently break an achievement nobody would miss until a player
 * typed 100 WPM and got nothing. So the invariants are:
 *   1. no live-WPM box exists in the markup or the CSS,
 *   2. the after-run / Scribe surfaces that replace it all survive,
 *   3. `updateHUD()` computes WPM unconditionally and only the PRINT is
 *      guarded,
 *   4. behaviour: the REAL `updateHUD()` body runs against a stub with no
 *      `wpmEl` — it must not throw, must still call `getWPM()`, must still
 *      write score/ACC, and must still print when a box is present.
 * Run:  node scripts/verify-live-wpm-trim.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// CRLF-normalised: the method slicer looks for `\n    }\n` boundaries.
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const htmlRaw = read('frontend/index.html');
const cssRaw = read('frontend/style.css');
const mainRaw = read('frontend/main.js');
const statsRaw = read('backend/Stats.js');
const achievementsSrc = read('frontend/Achievements.js');
const scribeSrc = read('frontend/Scribe.js');

// Assertions must not be satisfied by an explanatory comment, and this codebase
// documents heavily — my own AT-F12 notes name the very things that must be
// gone, so every check reads comment-free source.
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const htmlSrc = htmlRaw.replace(/<!--[\s\S]*?-->/g, '');
const cssSrc = stripCssComments(cssRaw);
const mainSrc = stripJsComments(mainRaw);
const statsSrc = stripJsComments(statsRaw);

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

/** Body of an exact CSS rule, e.g. `.stat-box.stat-acc { ... }` (indent-agnostic). */
function ruleBody(css, selector) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = css.match(new RegExp(`(?:^|\\n)[ \\t]*${escaped}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : '';
}

/** Source of a `Stats.js` method (four-space indentation, top-level in class). */
function methodSource(src, signature) {
    const start = src.indexOf(`    ${signature}`);
    if (start < 0) return '';
    const end = src.indexOf('\n    }\n', start);
    return src.slice(start, end < 0 ? src.length : end + 6); // `end` + `\n    }`
}

// ── 1. no live-WPM box anywhere ────────────────────────────────────────────
check(
    'the HUD no longer carries a live SPEED box',
    count(htmlSrc, 'id="wpm-display"') === 0 && count(htmlSrc, 'stat-wpm') === 0,
    `${count(htmlSrc, 'id="wpm-display"')} #wpm-display / ${count(htmlSrc, 'stat-wpm')} .stat-wpm left`
);
check('the SPEED label is gone with it', count(htmlSrc, '>SPEED<') === 0);
check(
    'no CSS rule targets the deleted box',
    count(cssSrc, '.stat-wpm') === 0,
    `${count(cssSrc, '.stat-wpm')} selector(s) left`
);
check(
    'the ACC box survived the trim (it is not a rate)',
    count(htmlSrc, 'id="acc-display"') === 1 && ruleBody(cssSrc, '.stat-box.stat-acc').includes('display: none'),
    'ACC stays, and stays hidden on narrow mobile'
);
check(
    'the duel path no longer toggles a box that does not exist',
    count(mainSrc, 'stat-wpm') === 0
);
check(
    'the duel path still hides/restores the boxes that DO exist',
    count(mainSrc, "querySelector('.stat-barriers')?.classList.add('hidden')") === 1 &&
        count(mainSrc, "querySelector('.stat-barriers')?.classList.remove('hidden')") === 1 &&
        count(mainSrc, "getElementById('wave-stat')?.classList.add('hidden')") === 1 &&
        count(mainSrc, "getElementById('wave-stat')?.classList.remove('hidden')") === 1
);

// ── 2. what replaces live WPM must all survive ─────────────────────────────
check(
    'the game-over row survives',
    count(htmlSrc, 'id="go-wpm"') === 1
);
check(
    'the menu Max WPM survives',
    count(htmlSrc, 'id="menu-best-wpm"') === 1
);
check(
    'the leaderboard WPM column survives',
    count(htmlSrc, 'class="col-wpm"') === 1 && mainSrc.includes('col-wpm ${category') && mainSrc.includes('${entry.wpm}')
);
check(
    'the Scribe keeps the live WPM crown',
    count(htmlSrc, 'id="practice-wpm"') === 1 && count(htmlSrc, 'id="practice-res-raw-wpm"') === 1 &&
        scribeSrc.includes('this.wpmDisplay.innerText = this.getWPM();'),
    "live WPM is the Scribe's mode identity — never trim it there"
);

// ── 3. updateHUD computes WPM, only the print is guarded ───────────────────
check(
    'updateHUD still computes WPM unconditionally',
    statsSrc.includes('const wpm = this.getWPM();')
);
check(
    'and prints it only when the box exists',
    statsSrc.includes('if (this.wpmEl) this.wpmEl.innerText = wpm;')
);
check(
    'the unguarded print is gone (it threw once the element was deleted)',
    !statsSrc.includes('this.wpmEl.innerText = this.getWPM();')
);
const getWpmSource = methodSource(statsSrc, 'getWPM() {');
check('getWPM() has a body to inspect', getWpmSource.length > 0);
check(
    'getWPM() still fires the wpm_update event the achievement listens to',
    getWpmSource.includes("this.achievements.onEvent('wpm_update'")
);
check(
    'speed_demon is still keyed to wpm_update',
    achievementsSrc.includes("'speed_demon'") && achievementsSrc.includes("eventName === 'wpm_update'"),
    'deleting the SPEED box must never cost a player this unlock'
);

// ── 4. behaviour: run the REAL updateHUD() against stubbed DOM ─────────────
const hudSource = methodSource(statsSrc, 'updateHUD() {');
check('updateHUD has a body to probe', hudSource.length > 0);

if (hudSource) {
    const body = hudSource.slice(hudSource.indexOf('{') + 1, hudSource.lastIndexOf('}'));
    const updateHUD = new Function(`return function updateHUD() { ${body} };`)();

    /** A Stats-shaped stub. `wpmEl` is the variable under test. */
    const makeStub = (wpmEl) => ({
        score: 4200,
        combo: 0,
        mana: 0,
        maxMana: 100,
        scoreEl: { innerText: '' },
        accEl: { innerText: '' },
        wpmEl,
        // The optional HUD parts: null is the real state outside a run.
        comboEl: null,
        multiplierEl: null,
        manaFillEl: null,
        manaTextEl: null,
        calls: { wpm: 0, accuracy: 0 },
        getWPM() { this.calls.wpm++; return 88; },
        getAccuracy() { this.calls.accuracy++; return 97; }
    });

    const gone = makeStub(null);
    let threw = '';
    try {
        updateHUD.call(gone);
    } catch (e) {
        threw = e.message;
    }
    check('with no SPEED box, updateHUD() does not throw', threw === '', threw || 'threw');
    check(
        'it still calls getWPM() — the speed_demon path',
        gone.calls.wpm === 1,
        `getWPM() ran ${gone.calls.wpm} time(s)`
    );
    check(
        'it still paints score and ACC',
        gone.scoreEl.innerText === 4200 && gone.accEl.innerText === '97%',
        `score="${gone.scoreEl.innerText}" acc="${gone.accEl.innerText}"`
    );

    const present = makeStub({ innerText: '' });
    updateHUD.call(present);
    check(
        'if the box ever comes back, the value is printed again',
        present.wpmEl.innerText === 88 && present.calls.wpm === 1,
        `wpm-display="${present.wpmEl.innerText}"`
    );

    // The fully-populated HUD (in-run state) must be unaffected by the guard.
    const full = makeStub(null);
    full.combo = 55;
    full.mana = 100;
    const classes = new Set();
    full.comboEl = {
        innerText: '',
        classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) }
    };
    full.multiplierEl = { innerText: '', style: {} };
    full.manaFillEl = { style: {}, classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    full.manaTextEl = { innerText: '' };
    full.manaHintEl = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c) } };
    full.getComboMultiplier = () => 2.5;
    let fullThrew = '';
    try {
        updateHUD.call(full);
    } catch (e) {
        fullThrew = e.message;
    }
    check(
        'a full in-run HUD still updates combo, multiplier and mana',
        fullThrew === '' && full.comboEl.innerText === 55 && full.multiplierEl.innerText === 'x2.5' &&
            classes.has('epic-combo') && classes.has('full') && !classes.has('hidden') &&
            full.manaTextEl.innerText === '100 / 100',
        fullThrew || `combo="${full.comboEl.innerText}" mult="${full.multiplierEl.innerText}" mana="${full.manaTextEl.innerText}"`
    );
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('');
if (failures) {
    console.error(`${failures} AT-F12 live-WPM trim check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-F12 live-WPM trim checks passed.');
