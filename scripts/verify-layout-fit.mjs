/**
 * Regression guard for AT-M11 — the home screen that clipped itself.
 *
 * Root cause, worth stating once: `#game-container` is a FIXED 1000x600 box at
 * every desktop viewport (critical.css owns its geometry), but the overlay
 * chrome above it sized itself in `vh`. So a 1080p monitor asked for 730px of
 * start-menu content in a 598px frame; `.overlay-menu` centres its column, so
 * the overflow spilled BOTH ways equally — 66px off each end — and
 * `#game-container { overflow: hidden }` ate it. The owner saw it before any
 * guard did: in scratch/live-1-forge.png the title was cut in half at the top
 * and HALL OF FAME hung out of the bottom, unclickable. Same menu, same frame,
 * different monitor.
 *
 * The same menu's rhythm was ALSO unreachable from CSS, because it lived in
 * inline `style` attributes in index.html — which is why every mobile override
 * in this project needed `!important` to touch it, and why nothing could
 * compact the menu when the frame turned out to be short.
 *
 * What this locks (the numeric fit itself is proven in Chrome by
 * scratch/probe-layout-fit.mjs, which reports `fits` for start-menu at every
 * desktop viewport — 550px of content in a 598px frame, identical on all of
 * them):
 *   1. the frame declares itself a queryable container, so chrome can scale
 *      from the FRAME rather than the monitor;
 *   2. that fit block exists, is scoped to the desktop frame, and contains NO
 *      viewport units — a `vh` in there would put the monitor back in charge;
 *   3. it covers every vertical metric of the menu (a compacted row that is not
 *      listed would silently push the menu out of the frame again);
 *   4. it styles nothing the markup does not have — the AT-M9b lesson: a rule
 *      for an element nobody renders is not a feature;
 *   5. the menu's rhythm is CSS-owned (no inline font-size/gap left in the
 *      start menu's markup), so the next fix does not need `!important`;
 *   6. the no-clip net: an overlay centres safely and can scroll, so content
 *      can never again overflow above the frame where nothing can reach it;
 *   7. `verify:layout` is wired into `npm run verify`.
 *
 * Run:  node scripts/verify-layout-fit.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Normalise CRLF: the block slicers below count braces on normalised text.
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

const css = read('frontend/style.css');
const critical = read('frontend/critical.css');
const html = read('frontend/index.html');
const pkgSrc = read('package.json');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

/** Slice a brace-balanced block, given the index of its opening `{`. */
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

/** The body of a top-level block whose selector line matches `re`. */
function blockBySelector(src, re) {
    const m = re.exec(src);
    if (!m) return null;
    const open = src.indexOf('{', m.index);
    return open === -1 ? null : sliceBlock(src, open);
}

// ── 1. the frame is a queryable container ───────────────────────────────────
const frameBlock = blockBySelector(critical, /#game-container\s*\{/);
check('critical.css still owns the frame geometry (1000x600)',
    !!frameBlock && /width:\s*1000px/.test(frameBlock) && /height:\s*600px/.test(frameBlock));
check('the frame is a size container named `frame`',
    !!frameBlock && /container-type:\s*size/.test(frameBlock) && /container-name:\s*frame/.test(frameBlock),
    'overlay chrome must be able to scale from the FRAME, not the monitor');

// ── 2. the fit block exists, and the monitor is not in charge of it ─────────
const fitOpen = css.indexOf('@container frame (min-width: 900px)');
check('the frame-scaled fit block exists', fitOpen !== -1);
const fit = fitOpen === -1 ? '' : sliceBlock(css, css.indexOf('{', fitOpen));
check('the fit block uses no viewport units',
    fit.length > 0 && !/\d\s*(vh|vw|vmin|vmax)\b/.test(fit),
    'one `vh` in here puts the monitor back in charge of a fixed frame');

// ── 3. it covers every vertical metric of the menu ──────────────────────────
const covered = [
    '.menu-column',
    '#start-menu h1',
    '#start-menu .subtitle',
    '#menu-mage-name',
    '#menu-mage-title',
    '#start-menu .stats-overview',
    '#start-menu .selectors-container .difficulty-selector select',
    '#start-menu .button-group',
    '#start-menu .button-group .primary-btn',
    '#start-menu .menu-hint',
];
const uncovered = covered.filter((sel) => !fit.includes(sel));
check('the fit block compacts every vertical metric of the menu',
    uncovered.length === 0,
    uncovered.join(', '));

// ── 4. it styles nothing the markup does not have (the AT-M9b lesson) ───────
const styledTokens = [...new Set([...fit.matchAll(/[#.][A-Za-z][\w-]*/g)].map((m) => m[0]))];
const orphanSelectors = styledTokens.filter((t) => !html.includes(t.slice(1)));
check('every selector in the fit block is applied to real markup',
    orphanSelectors.length === 0,
    orphanSelectors.join(', '));

// ── 5. the menu's rhythm is CSS-owned, not inline ───────────────────────────
const menuMarkup = html.slice(html.indexOf('id="start-menu"'), html.indexOf('id="patch-board-menu"'));
check('no inline font-size survives in the start-menu markup',
    menuMarkup.length > 0 && !/font-size\s*:/.test(menuMarkup));
check('no inline gap survives in the start-menu markup',
    menuMarkup.length > 0 && !/[$\s{;"']gap\s*:/.test(menuMarkup),
    'inline rhythm is what forced !important everywhere and blocked the compact');
check('.menu-column owns the menu column rhythm',
    html.includes('class="menu-column"') && /\.menu-column\s*\{[^}]*gap:/.test(css));

// ── 6. the no-clip net ─────────────────────────────────────────────────────
const atM11 = css.slice(css.indexOf('AT-M11 — the start menu'));
check('the AT-M11 section exists in style.css', atM11.length > 0);
check('.overlay-menu centres SAFELY, so a too-tall column cannot overflow above the frame',
    /\.overlay-menu\s*\{[^}]*justify-content:\s*safe center/.test(atM11));
check('#start-menu scrolls instead of clipping',
    /#start-menu\s*\{[^}]*overflow-y:\s*auto/.test(atM11));

// ── 7. the bug, the fix and the numbers are recorded together ───────────────
const status = read('docs/arcaneTyper-docs/PROJECT_STATUS.md');
check('PROJECT_STATUS records AT-M11 with its measured numbers',
    status.includes('AT-M11') && /550px/.test(status));

// ── 8. wired into the chain ────────────────────────────────────────────────
check('verify:layout is a script and part of the chain',
    pkgSrc.includes('"verify:layout": "node scripts/verify-layout-fit.mjs"') &&
    pkgSrc.includes('&& npm run verify:layout'));

console.log('');
if (failures) {
    console.error(`${failures} layout-fit check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-M11 layout-fit checks passed.');
process.exit(0);
