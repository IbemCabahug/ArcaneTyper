/**
 * Regression guard for AT-F13 — "the Arena panel is still too laggy, even in
 * production" (owner-reported 2026-09-23).
 *
 * Diagnosis, verified in code before this guard existed: #start-menu is itself
 * an `.overlay-menu`, so opening the Arena stacked FOUR composite passes on one
 * sliding 45 vw layer — `.overlay-menu { backdrop-filter: blur(10px) }` on the
 * panel, sampling #start-menu's own `backdrop-filter: blur(10px)` (sampling the
 * canvas), which `openDuelLobby()` additionally pushed through
 * `filter: blur(4px)`, with `blur(15px)` + `blur(10px)` on the lobby cards — and
 * two spinning rings plus a pulsing caption ANIMATING inside one of the blurred
 * cards, so the whole stack re-rasterised every frame. That is a compositing
 * problem, which is exactly why it still janked on the deployed build.
 *
 * The fix is "one background layer, one animation surface": no blur anywhere in
 * an overlay, transform/opacity-only animation, promoted animation layers, and
 * a frozen canvas under a paused game. This script keeps all of that from
 * creeping back:
 *   1. CSS invariants (no blur in the overlay chain; only compositor-friendly
 *      transition properties; promoted rings; scrims opaque enough to replace
 *      the blurs they lost),
 *   2. JS invariants (the ancestor `filter` is gone with its Enter-guard
 *      replacement, and the paused frame is frozen),
 *   3. behavioural probes that run the REAL `setMenuBehind()` and the REAL
 *      `Game.gameLoop()` pause branch against stubbed DOM/glue.
 * Run:  node scripts/verify-arena-panel-perf.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// Normalise CRLF: the method/rule slicers look for `\n  }\n` boundaries.
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const cssRaw = read('frontend/style.css');
const htmlSrc = read('frontend/index.html');
const mainRaw = read('frontend/main.js');
const gameSrc = read('frontend/Game.js');

// Property checks must never be satisfied by an explanatory comment, and this
// codebase documents heavily — so assertions read the comment-free source.
const stripCssComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const stripJsComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');
const cssSrc = stripCssComments(cssRaw);
const mainSrc = stripJsComments(mainRaw);

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

/** Body of an exact top-level rule, e.g. `.overlay-menu { ... }` (not `.x.y`). */
function ruleBody(css, selector) {
    const start = css.indexOf(`\n${selector} {`);
    if (start < 0) return '';
    const end = css.indexOf('}', start);
    return end < 0 ? '' : css.slice(start, end);
}

/** Property names of a `transition:`/`animation:` shorthand, in order.
 *  Parenthesised timing functions are masked first, because their own arguments
 *  are comma-separated (`cubic-bezier(0.175, 0.885, 0.32, 1.1)`). */
function shorthandProps(body, prop) {
    const match = body.match(new RegExp(`${prop}:([^;]+);`));
    if (!match) return [];
    return match[1]
        .replace(/\([^)]*\)/g, '()')
        .split(',')
        .map((part) => part.trim().split(/\s+/)[0])
        .filter(Boolean);
}

/** Alphas of every rgba() in a string — used to prove a scrim can replace a blur. */
function alphas(text) {
    return [...text.matchAll(/rgba\([^)]*?,\s*([\d.]+)\s*\)/g)].map((m) => parseFloat(m[1]));
}

/** Alphas of just a rule's/tag's `background` value (not its shadows/borders). */
function backgroundAlphas(text) {
    const match = text.match(/background:([^;"]+)/);
    return match ? alphas(match[1]) : [];
}

/** The opening tag containing `marker` (e.g. an id), for inline-style checks. */
function tagOf(html, marker) {
    const at = html.indexOf(marker);
    if (at < 0) return '';
    const open = html.lastIndexOf('<', at);
    const close = html.indexOf('>', at);
    return close < 0 ? '' : html.slice(open, close + 1);
}

// ── 1. no blur may exist anywhere in an overlay chain ──────────────────────
const overlayBody = ruleBody(cssSrc, '.overlay-menu');
check('the .overlay-menu base rule no longer blurs its backdrop', !overlayBody.includes('backdrop-filter'));
check(
    'no backdrop-filter is declared anywhere in style.css',
    count(cssSrc, 'backdrop-filter:') === 0,
    `${count(cssSrc, 'backdrop-filter:')} declaration(s) left`
);
check(
    'no inline backdrop-filter is left in index.html',
    count(htmlSrc, 'backdrop-filter:') === 0,
    `${count(htmlSrc, 'backdrop-filter:')} inline declaration(s) left`
);
check(
    'the start menu — which is itself an .overlay-menu — is the depth-1 case',
    tagOf(htmlSrc, 'id="start-menu"').includes('overlay-menu')
);

// ── 2. one opaque background layer, pre-baked (not a live blur) ────────────
const menuAlphas = backgroundAlphas(overlayBody);
check(
    'the overlay scrim is opaque enough to replace the 10px blur it lost',
    menuAlphas.length > 0 && Math.min(...menuAlphas) >= 0.9,
    `alphas: ${menuAlphas.join(', ') || 'none'}`
);
for (const id of ['id="duel-lobby-idle"', 'id="duel-lobby-waiting"']) {
    const tagAlphas = backgroundAlphas(tagOf(htmlSrc, id));
    check(
        `${id} stayed solid after losing its nested blur`,
        tagAlphas.length > 0 && Math.min(...tagAlphas) >= 0.8,
        `alphas: ${tagAlphas.join(', ') || 'none'}`
    );
}

// ── 3. the arena panel animates only compositor-friendly properties ────────
const panelBody = ruleBody(cssSrc, '#duel-lobby-menu');
const panelTrans = shorthandProps(panelBody, 'transition');
check(
    'the arena panel transitions only opacity and transform',
    panelTrans.length === 2 && panelTrans.every((p) => p === 'opacity' || p === 'transform'),
    panelTrans.join(', ') || 'no transition found'
);
check(
    'the arena panel is promoted to its own layer',
    panelBody.includes('will-change: transform') && panelBody.includes('opacity')
);
check(
    'the arena panel is NOT paint-contained (that would clip its box-shadow)',
    panelBody.includes('box-shadow') && !panelBody.includes('contain: paint') && panelBody.includes('contain: layout style'),
    'contain: paint would cut the 50px shadow that gives the panel depth'
);
const menuBaseTrans = shorthandProps(overlayBody, 'transition');
check(
    'the shared overlay transition is compositor-friendly too',
    menuBaseTrans.length === 2 && menuBaseTrans.every((p) => p === 'opacity' || p === 'transform'),
    menuBaseTrans.join(', ')
);


// ── 4. the spinning rings are their own layers, animated by transform ──────
const ringBody = ruleBody(cssSrc, '.arena-ring');
check('the rings are promoted and paint-contained', ringBody.includes('will-change: transform') && ringBody.includes('contain: paint'));
check(
    'the rings are driven by classes, not inline styles',
    count(htmlSrc, 'class="arena-ring fast"') === 1 && count(htmlSrc, 'class="arena-ring slow"') === 1
);
check(
    'no ring is left as an inline-styled div',
    count(htmlSrc, 'animation: spin') === 0 && count(htmlSrc, 'animation: spinReverse') === 0
);
const spinBody = ruleBody(cssSrc, '@keyframes spin');
const spinRevBody = ruleBody(cssSrc, '@keyframes spinReverse');
check(
    'both ring keyframes animate transform only',
    spinBody.includes('transform:') && !/opacity:|filter:/.test(spinBody) &&
        spinRevBody.includes('transform:') && !/opacity:|filter:/.test(spinRevBody)
);

// ── 5. the in-match overlays over the live canvas are blur-free ────────────
for (const selector of ['.sb-side', '.magical-toast', '.pause-card', '#patch-board-menu']) {
    check(`no blur on ${selector} (it sits over a redrawing canvas)`, !ruleBody(cssSrc, selector).includes('backdrop-filter'));
}

// ── 6. the ancestor filter is gone, and its guard replacement exists ───────
check(
    'main.js never writes an ancestor blur filter again',
    count(mainSrc, "startMenu.style.filter = 'blur(4px)';") === 0 && count(mainRaw, 'filter: blur(4px)') <= 1,
    'the only allowed mention is the documented guard NOTE'
);
check('main.js clears any stale inline filter', count(mainSrc, "startMenu.style.filter = '';") === 1);
check('setMenuBehind is defined once', count(mainSrc, 'function setMenuBehind(') === 1);
check(
    'every path that dims the menu also restores it',
    count(mainSrc, 'setMenuBehind(true)') === 2 && count(mainSrc, 'setMenuBehind(false)') === 4,
    `true=${count(mainSrc, 'setMenuBehind(true)')} false=${count(mainSrc, 'setMenuBehind(false)')}`
);
check(
    'the Enter quick-start guard knows a submenu is open',
    mainSrc.includes("!startMenu.classList.contains('menu-behind')") && mainSrc.includes("startMenu.style.filter !== 'blur(4px)'")
);
const behindBody = ruleBody(cssSrc, '.menu-behind');
check(
    'the dimming treatment is compositor-only (no filter)',
    behindBody.includes('opacity') && !behindBody.includes('filter')
);

// ── 7. a paused frame is frozen, not redrawn ──────────────────────────────
const pauseGuard = 'if (this.isPaused) {';
check(
    'Game.gameLoop returns early while paused',
    gameSrc.includes(pauseGuard) && gameSrc.includes('// --- AT-F13: a paused frame is frozen, not redrawn ---')
);
check(
    'the paused branch sits before update() and draw()',
    gameSrc.indexOf(pauseGuard) < gameSrc.indexOf("this._reportError(err, 'update')") &&
        gameSrc.indexOf(pauseGuard) < gameSrc.indexOf("this._reportError(err, 'draw')")
);

// ── 8. behaviour: setMenuBehind() driven through a stubbed menu element ────
/** Source of a function declared with two-space indentation in main.js. */
function functionSource(src, signature) {
    const start = src.indexOf(`  ${signature}`);
    if (start < 0) return '';
    const end = src.indexOf('\n  }\n', start);
    return src.slice(start, end < 0 ? src.length : end + 4); // `end` + `\n  }`
}

function makeStubMenu() {
    const classes = new Set(['overlay-menu', 'active']);
    const style = { pointerEvents: 'stale', opacity: 'stale', filter: 'blur(4px)' };
    return {
        style,
        classList: {
            add: (c) => classes.add(c),
            remove: (c) => classes.delete(c),
            contains: (c) => classes.has(c),
            toggle: (c, on) => (on ? classes.add(c) : classes.delete(c))
        },
        _classes: classes
    };
}

const stubMenu = makeStubMenu();
const setMenuBehindSource = functionSource(mainSrc, 'function setMenuBehind(behind) {');
check('setMenuBehind has a body to probe', setMenuBehindSource.length > 0);

if (setMenuBehindSource) {
    const setMenuBehind = new Function('startMenu', `${setMenuBehindSource}; return setMenuBehind;`)(stubMenu);

    setMenuBehind(true);
    check(
        'opening a submenu dims without a filter',
        stubMenu._classes.has('menu-behind') && stubMenu.style.filter === '' &&
            stubMenu.style.pointerEvents === 'none' && stubMenu.style.opacity === '0.5',
        `filter="${stubMenu.style.filter}" pe="${stubMenu.style.pointerEvents}" opacity="${stubMenu.style.opacity}"`
    );

    setMenuBehind(false);
    check(
        'closing a submenu fully restores the menu',
        !stubMenu._classes.has('menu-behind') && stubMenu.style.filter === '' &&
            stubMenu.style.pointerEvents === 'auto' && stubMenu.style.opacity === '',
        `filter="${stubMenu.style.filter}" pe="${stubMenu.style.pointerEvents}" opacity="${stubMenu.style.opacity}"`
    );
}

// ── 9. behaviour: the real gameLoop() must not draw a paused frame ─────────
/** Source of a Game.js method (four-space indentation). */
function methodSource(src, signature) {
    const start = src.indexOf(`    ${signature}`);
    if (start < 0) return '';
    const end = src.indexOf('\n    }\n', start);
    return src.slice(start, end < 0 ? src.length : end + 6); // `end` + `\n    }`
}

const loopSource = methodSource(gameSrc, 'gameLoop(currentTime) {');
check('gameLoop has a body to probe', loopSource.length > 0);

if (loopSource) {
    let frames = 0;
    let updates = 0;
    let draws = 0;
    globalThis.window = globalThis;
    globalThis.document = { getElementById: () => null };
    const raf = () => { frames++; return frames; };

    const body = loopSource.slice(loopSource.indexOf('{') + 1, loopSource.lastIndexOf('}'));
    const gameLoop = new Function('document', 'requestAnimationFrame', `return function gameLoop(currentTime) { ${body} };`)(document, raf);

    const makeGame = (paused) => ({
        isRunning: true,
        isPaused: paused,
        lastTime: 0,
        _frameTicked: false,
        _fpsAccum: 0,
        _fpsFrames: 0,
        lastHudUpdate: 0,
        animationFrameId: null,
        update: () => { updates++; },
        draw: () => { draws++; },
        _reportError: () => {},
        stats: { updateHUD: () => {} },
        gameLoop
    });

    const pausedGame = makeGame(true);
    pausedGame.gameLoop(16);
    check(
        'a paused frame neither updates nor draws, but stays scheduled',
        draws === 0 && updates === 0 && frames === 1,
        `draws=${draws} updates=${updates} rafFrames=${frames}`
    );

    const runningGame = makeGame(false);
    runningGame.gameLoop(32);
    check(
        'a running frame still updates and draws (watchdog heartbeated)',
        draws === 1 && updates === 1 && frames === 2 && runningGame._frameTicked === true,
        `draws=${draws} updates=${updates} rafFrames=${frames}`
    );
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('');
if (failures) {
    console.error(`${failures} AT-F13 arena-panel perf check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-F13 arena-panel perf checks passed.');

