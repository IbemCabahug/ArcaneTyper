/**
 * AT-F2 — the Mage Profile badge panel.
 *
 *   npm run verify:badges
 *
 * WHY THIS EXISTS. AT-F2 was filed in `future_feature.md` as an in-app promise
 * ("Badges & Achievements — Coming Soon in Phase 4") with the status "Blocked on
 * design decision", and it sat in the build order as item 7 for weeks. The
 * premise is stale. The panel SHIPPED inside the 2026-09-26 profile rebuild
 * (`d75dd01`): the hardcoded placeholder was replaced with `#profile-trophy-strip`,
 * rendered by `populateTrophyStrip()` from the SAME `game.achievements.definitions`
 * the full Trophy Room reads.
 *
 * So the feature is real, and the two things that were actually missing are the
 * ones this suite supplies:
 *
 *   1. THE RECORD. `future_feature.md` still describes a placeholder that no
 *      longer exists, and lists AT-F2 as blocked in the build order. A stale
 *      status is not cosmetic here: this register already carries one false
 *      "fully closed" claim, and a status that says "blocked" is the kind of
 *      thing that stops anyone from ever checking.
 *   2. THE GUARD. Every other shipped surface in this project has one. Nothing
 *      asserted that the badge panel stays wired, stays on the same source of
 *      truth as the Trophy Room, or keeps the SECRET contract — and the secret
 *      contract is the part with a real cost. A locked badge must print `???`
 *      and a bare count; printing the name would leak both the achievement and
 *      the character it unlocks, spoiling the exact reveal the locked Forge
 *      cards exist to protect.
 *
 * WHAT IT LOCKS.
 *   - the placeholder is gone from the shipped markup, and the strip element
 *     exists exactly once;
 *   - the strip is rendered INSIDE the Forge panel, not behind a tab of its own;
 *   - both surfaces iterate `game.achievements.definitions` — one source, two
 *     surfaces — so a badge can never disagree with the Trophy Room;
 *   - the strip is populated when the profile opens AND when the Forge tab is
 *     selected, so a counter earned since the last open is never shown stale;
 *   - a LOCKED badge prints `???` plus n/goal (counters) or LOCKED, and never
 *     the achievement name or its description — checked against the real
 *     Achievements definitions, executed, not regex-guessed;
 *   - an UNLOCKED badge does show its name, and the counter agrees with
 *     `getProgress`;
 *   - every `counter` definition renders a denominator at all, and no non-
 *     counter does (a n/goal on a stateless boolean is a meaningless number);
 *   - the panel is populated by the shipped function, invoked through a real
 *     DOM stub, so the assertions describe the game's behaviour.
 *
 * Run:  node scripts/verify-badges.mjs
 */
import { readFileSync } from 'node:fs';

// ── Reporting ───────────────────────────────────────────────────────────────
// Failures go to console.log, never console.error: this file stubs
// console.error while loading Achievements.js (the class logs its own recovery
// paths through it), and a check reporting through the stubbed channel would
// exit 1 having printed only PASS lines — silently, which is the failure mode
// verify-unspoken-counter.mjs already documented and was bitten by.
let failures = 0;
const check = (name, cond, why = '') => {
    if (cond) console.log(`PASS  ${name}`);
    else { console.log(`FAIL  ${name}${why ? `  — ${why}` : ''}`); failures++; }
};
const read = (p) => readFileSync(p, 'utf8');
const count = (src, needle) => src.split(needle).length - 1;

/**
 * Whole-line `//` comments are dropped, NOT the block comments.
 *
 * Several checks below assert that a string is ABSENT from the shipped source.
 * Both `main.js` and `index.html` explain the history in block comments that
 * QUOTE the removed placeholder ("the old markup here was a hardcoded 'Coming
 * Soon in Phase 4' placeholder"), so searching the comment-bearing source
 * fails on the very note documenting the removal — the same trap
 * verify-skin-ids.mjs records. Line comments are stripped as well so a
 * "// AT-F2: ..." marker cannot satisfy a presence check.
 */
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const htmlSrc = read('frontend/index.html');
const mainSrc = read('frontend/main.js');
const html = strip(htmlSrc);
const main = strip(mainSrc);
const cssSrc = read('frontend/style.css');

/** Slice between two needles, INCLUSIVE of the end needle. */
function slice(src, from, to) {
    const a = src.indexOf(from);
    if (a === -1) return '';
    const b = to ? src.indexOf(to, a) : -1;
    return src.slice(a, b === -1 ? src.length : b + to.length);
}
console.log('--- AT-F2 part 1: the panel is real, and the placeholder is gone ---');

// The bug this entry was filed for: the app promised badges and shipped a
// placeholder. The promise is now kept, so the placeholder must not return.
//
// `html` has its comments stripped above, but the historical note in
// index.html is an HTML comment (`<!-- ... -->`), which `strip()` does not
// touch — only JS block comments. It quotes the old placeholder verbatim, so
// the check has to drop HTML comments too or it fails on the very sentence
// explaining the removal.
const htmlLive = html.replace(/<!--[\s\S]*?-->/g, '');
check('the "Coming Soon in Phase 4" placeholder is gone from the markup',
    !/Coming Soon in Phase 4/.test(htmlLive),
    'the profile would again claim the trophy room does not exist');
check('the placeholder is not shipped in a live attribute or text node',
    !/Coming Soon/.test(htmlLive));
check('the badge panel still carries its heading',
    count(htmlLive, 'Badges &amp; Achievements') === 1);
check('the strip element exists exactly once',
    count(htmlLive, 'id="profile-trophy-strip"') === 1,
    `found ${count(htmlLive, 'id="profile-trophy-strip"')}`);

// It is rendered by JS into that element, so a second empty div would be
// dead markup and a missing one means the panel silently renders nothing.
check('main.js holds the element reference',
    count(main, "getElementById('profile-trophy-strip')") === 1);
check('the panel is INSIDE the Forge panel, not behind a tab of its own',
    (() => {
        const forge = htmlLive.indexOf('data-profile-panel="forge"');
        const stripAt = htmlLive.indexOf('id="profile-trophy-strip"');
        const record = htmlLive.indexOf('data-profile-panel="record"');
        return forge !== -1 && stripAt > forge && record !== -1 && stripAt < record;
    })(),
    'the strip must sit between the forge panel opening and the record panel');
check('there is no separate trophies tab left over',
    !/data-profile-tab="trophies"/.test(htmlLive));

console.log('\n--- AT-F2 part 2: one source, two surfaces ---');

// The whole reason the two surfaces can be trusted is that they read the same
// definitions object. A second hardcoded list would let a badge disagree with
// the Trophy Room, and the profile is where a player looks first.
//
// The two surfaces reach the table differently — the strip iterates
// `game.achievements.definitions` directly, while populateAchievements() binds
// it to a local `allDefs` first — so the check is that BOTH resolve to the one
// object, not that both use the same literal expression.
const roomSrc = slice(main, '  function populateAchievements()', '\n  }');
// Declared here, not in part 3: part 2 reads it too, and a `const` used before
// its declaration is a ReferenceError, not a false PASS.
const stripFn = slice(main, '  function populateTrophyStrip()', '\n  }');
check('the strip reads the shared definitions',
    stripFn.includes('game.achievements.definitions'));
check('the Trophy Room reads the same shared definitions',
    roomSrc.includes('game.achievements.definitions') && roomSrc.includes('allDefs'));
check('neither surface hardcodes an achievement list of its own',
    !/definitions\s*=\s*\{/.test(stripFn) && !/definitions\s*=\s*\{/.test(roomSrc),
    'a second literal list is how the two surfaces would start to disagree');

console.log('\n--- AT-F2 part 3: the strip cannot go stale ---');

// populateTrophyStrip() is called in two places. The profile-open call is
// obvious; the Forge-TAB call is the one that matters, because the strip moved
// INTO that panel and a counter earned mid-session would otherwise show the
// value it had when the profile was last opened.
//
// `selectProfileTab` is an ARROW const, not a `function` declaration, so it is
// sliced by its own opening line and the `};` that closes it.
const tabSelect = slice(main, '  const selectProfileTab = (name) => {', '\n  };');
check('the strip refreshes when the Forge tab is selected',
    tabSelect.includes('populateTrophyStrip()'),
    'a counter earned since the profile was last opened would read stale');

// The profile is opened by the avatar background's click handler, which is
// where updateForgeUI() and paintSkinPreviews() are already called — the strip
// must sit with them, or the panel opens showing a previous session's pips.
const openProfile = slice(main, "  if (mageAvatarBg) {", "\n  }");
check('the strip is populated when the profile opens',
    openProfile.includes('populateTrophyStrip()'),
    'the panel would open empty on first ever open');
check('the strip refreshes alongside the rest of the Forge',
    openProfile.includes('updateForgeUI()') && openProfile.includes('paintSkinPreviews()'));
check('the strip is cleared before repopulating (no duplicate pips)',
    stripFn.includes("trophyStrip.innerHTML = ''"));
check('a missing strip element degrades instead of throwing',
    stripFn.includes('if (!trophyStrip) return;'));
console.log('\n--- AT-F2 part 4: the SECRET contract, executed ---');

// This is the part with a real cost. `the_unspoken` unlocks the Voidweaver and
// `the_bloodied_standard` unlocks the Bloodseeker, and BOTH cards ship as `???`
// in the Forge. A locked badge that printed def.name would hand the player the
// achievement's identity AND, through its description, the condition and the
// character — spoiling the reveal the locked cards exist to protect.
//
// The renderer is extracted from the shipped source and run against a stub DOM,
// then read back, so these are the game's real strings and not a
// re-statement of the rule the code is supposed to follow.
let mem = {};
globalThis.localStorage = {
    getItem: (k) => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: (k) => { delete mem[k]; }
};
globalThis.console.error = () => {};

const achSrc = read('frontend/Achievements.js').replace('export class Achievements', 'class Achievements');
const Achievements = new Function(`${achSrc}; return Achievements;`)();

/** A DOM stub just rich enough for createElement/innerHTML/appendChild. */
function makeEl() {
    return { className: '', innerHTML: '', children: [], appendChild(c) { this.children.push(c); } };
}

// `populateTrophyStrip` reaches for the global `document`, so the stub has to
// be installed as a global rather than passed in. Without it the function
// throws ReferenceError before a single assertion runs.
globalThis.document = { createElement: () => makeEl() };

// The function is lifted verbatim out of the RAW main.js and executed, so the
// assertions describe the game's real strings rather than a restatement of the
// rule the code is supposed to follow. Two earlier attempts used a needle slice
// and both broke on the game's braces, not on the game:
//
//   - a trailing `\}\s*$` regex ate the closing brace of the `for` loop nested
//     inside, which had become the last non-whitespace character once the
//     function's own brace was consumed (SyntaxError: Unexpected token ')');
//   - appending a `\n  }` instead unbalanced it the other way (SyntaxError:
//     Unexpected token '}').
//
// Brace counting from the opening line is immune to both, and to the function
// growing or losing a branch later. It walks the RAW source, not the
// comment-stripped copy, because `strip()` deletes block comments and would
// change the brace structure of any literal containing `/*`.
//
// One caveat, checked rather than assumed: a `}` inside a string or template
// literal would fool the counter. The extraction check below asserts the slice
// still ends exactly where the function does, so a future edit that introduces
// one turns this suite red instead of silently executing half a function.
function extractFunction(src, signature) {
    const start = src.indexOf(signature);
    if (start === -1) return '';
    const open = src.indexOf('{', start + signature.length - 1);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    return '';
}
const stripSrc = extractFunction(mainSrc, '  function populateTrophyStrip() {');

function renderStrip(ach) {
    const stripEl = makeEl();
    const trophyStrip = stripEl;
    const game = { achievements: ach };
    // The WHOLE function is compiled and then called, rather than having its
    // braces shaved off and the remainder used as a bare function body. That
    // unwrapping is what produced the two earlier SyntaxErrors: removing the
    // opening `{` leaves the function's own closing `}` unmatched (and doing it
    // with a regex instead additionally eats the nested `for` loop's brace).
    // Compiling the definition intact and invoking it has no such failure mode,
    // and it also keeps any `return` or hoisted helper the function may grow.
    //
    // A throw is CAUGHT and turned into a failure, never allowed to escape. An
    // earlier version let it propagate, so a mutation that made the renderer
    // crash (a second hardcoded list, whose entries have no `.counter`) killed
    // the whole suite with a stack trace — the run reported nothing, and a
    // reader could not tell a broken guard from a broken game. A guard that dies
    // on the defect it was written to catch is not reporting.
    // eslint-disable-next-line no-new-func
    new Function('trophyStrip', 'game', `${stripSrc}\npopulateTrophyStrip();`)(trophyStrip, game);
    return stripEl;
}

/** renderStrip, but a throw becomes an empty strip plus a recorded failure. */
function tryRender(ach, what) {
    try {
        return renderStrip(ach);
    } catch (e) {
        check(`${what}: the shipped renderer ran without throwing`, false, `${e.name}: ${e.message}`);
        return makeEl();
    }
}
check('the shipped populateTrophyStrip could be extracted for execution',
    stripSrc.includes('trophyStrip.appendChild') && stripSrc.includes('for (const id in') &&
    stripSrc.trimEnd().endsWith('}') &&
    // The extracted text must be the WHOLE function, not a prefix of it. If a
    // brace inside a string or template literal ever confuses the counter, the
    // slice stops early and the text after it would still be mid-function.
    // The next thing in the file is the AT-F16 comment block and then
    // `function populateAchievements`, so requiring the remainder to be
    // non-empty and to NOT open another function is the check.
    (() => {
        const rest = mainSrc.slice(mainSrc.indexOf(stripSrc) + stripSrc.length);
        return rest.trim().length > 0 && !/^\s*(export\s+)?(async\s+)?function\s/.test(rest);
    })(),
    `extraction ended early — the text right after it was: ` +
    `${JSON.stringify(mainSrc.slice(mainSrc.indexOf(stripSrc) + stripSrc.length, mainSrc.indexOf(stripSrc) + stripSrc.length + 90))}`);

/** Pip i, paired with the achievement id it was rendered from. */
const pairs = (ach, strip) => strip.children.map((pip, i) => ({ pip, id: Object.keys(ach.definitions)[i] }));

{
    mem = {};
    const ach = new Achievements(null);
    const strip = tryRender(ach, 'empty save');
    const total = Object.keys(ach.definitions).length;

    check('the strip renders one pip per achievement',
        strip.children.length === total && total > 0,
        `${strip.children.length} pip(s) for ${total} achievement(s)`);

    // Every locked badge must be anonymous.
    const nameLeaks = pairs(ach, strip)
        .filter(({ pip }) => !pip.className.includes('is-unlocked'))
        .filter(({ pip, id }) => pip.innerHTML.includes(ach.definitions[id].name))
        .map(({ id }) => id);
    check('no LOCKED badge prints its achievement name',
        nameLeaks.length === 0, `leaking: ${nameLeaks.join(', ')}`);

    const descLeaks = pairs(ach, strip)
        .filter(({ pip }) => !pip.className.includes('is-unlocked'))
        .filter(({ pip, id }) => ach.definitions[id].description &&
            pip.innerHTML.includes(ach.definitions[id].description))
        .map(({ id }) => id);
    check('no LOCKED badge prints its description (the spoiler)',
        descLeaks.length === 0, `leaking: ${descLeaks.join(', ')}`);

    // A locked badge must be recognisable as a badge, not an empty box.
    const unmarked = pairs(ach, strip)
        .filter(({ pip }) => !pip.className.includes('is-unlocked'))
        .filter(({ pip }) => !pip.innerHTML.includes('???'))
        .map(({ id }) => id);
    check('every locked badge prints the ??? marker',
        unmarked.length === 0, `unmarked: ${unmarked.join(', ')}`);
}
{
    // Counters: n/goal while locked, name once earned. The value must come
    // from getProgress, not from a second counter this guard owns.
    mem = {};
    const ach = new Achievements(null);
    const counters = Object.entries(ach.definitions).filter(([, d]) => d.counter);
    check('the game ships secret counter achievements to render',
        counters.length >= 2, `found ${counters.length}`);

    const strip = tryRender(ach, 'locked state');
    for (const [id, def] of counters) {
        // `find` returns undefined when the strip did not render a pip for this
        // id — which is exactly what happens if the renderer threw. The earlier
        // version destructured the result directly and took the whole suite
        // down with a TypeError, so a real defect still could not be reported.
        const found = pairs(ach, strip).find((p) => p.id === id);
        if (!found) {
            check(`${id} rendered a pip at all`, false, 'the strip produced no pip for it');
            continue;
        }
        check(`${id} shows a bare count and NO condition while locked`,
            found.pip.innerHTML.includes(`0/${def.counter.goal}`) &&
            !found.pip.innerHTML.includes(def.name),
            `got: ${found.pip.innerHTML}`);
    }

    // Advance the REAL counter and re-render: the pip must follow it.
    mem = {};
    const ach2 = new Achievements(null);
    const [cId, cDef] = counters[0];
    ach2.bumpProgress(cId, 3);
    const pip2 = pairs(ach2, tryRender(ach2, 'partly advanced')).find((p) => p.id === cId)?.pip;
    check('the pip count follows getProgress, not a hardcoded zero',
        !!pip2 && pip2.innerHTML.includes(`3/${cDef.counter.goal}`),
        `got: ${pip2 ? pip2.innerHTML : 'no pip rendered'}`);

    // At the goal the counter achievement unlocks and the pip flips to the name.
    mem = {};
    const ach3 = new Achievements(null);
    for (let n = 0; n < cDef.counter.goal; n++) ach3.bumpProgress(cId, 1);
    const pip3 = pairs(ach3, tryRender(ach3, 'at the goal')).find((p) => p.id === cId)?.pip;
    check('at the goal the badge flips to is-unlocked and shows its name',
        !!pip3 && ach3.unlocked.has(cId) && pip3.className.includes('is-unlocked') &&
        pip3.innerHTML.includes(cDef.name),
        `unlocked=${ach3.unlocked.has(cId)} pip: ${pip3 ? pip3.innerHTML : 'no pip rendered'}`);

    // A non-counter is a stateless boolean: n/goal on it would be a number
    // that can never move, which is worse than saying nothing at all.
    const statelessLeak = pairs(ach, strip)
        .filter(({ id }) => !ach.definitions[id].counter)
        .filter(({ pip }) => /\d+\/\d+/.test(pip.innerHTML))
        .map(({ id }) => id);
    check('a non-counter badge never shows a progress fraction',
        statelessLeak.length === 0, `leaking: ${statelessLeak.join(', ')}`);
}
{
    // A counter with a missing goal renders "0/undefined" on a card the player
    // is told to watch. Read the SHIPPED definitions, not a copy.
    mem = {};
    const ach = new Achievements(null);
    const badGoal = Object.entries(ach.definitions)
        .filter(([, d]) => d.counter && (!Number.isFinite(d.counter.goal) || d.counter.goal <= 0))
        .map(([id]) => id);
    check('every counter achievement has a usable goal',
        badGoal.length === 0, `broken: ${badGoal.join(', ')}`);
    const noKey = Object.entries(ach.definitions)
        .filter(([, d]) => d.counter && !d.counter.key)
        .map(([id]) => id);
    check('every counter achievement has a storage key',
        noKey.length === 0, `missing: ${noKey.join(', ')}`);
}

console.log('\n--- AT-F2 part 5: the pips are actually styled ---');

// A pip with no CSS rule is an unstyled run of bare text inheriting the card's
// font — the panel would look broken while every behavioural check above still
// passed. Shape only; the palette is the design's business.
for (const sel of ['.trophy-strip', '.trophy-pip', '.trophy-pip.is-unlocked', '.trophy-pip-name', '.trophy-pip-sub']) {
    check(`${sel} has a rule`, cssSrc.includes(`${sel} {`) || cssSrc.includes(`${sel},`) ||
        cssSrc.includes(`${sel}:`));
}
check('the strip is a grid, so pips do not stack as one column',
    /\.trophy-strip\s*\{[^}]*display:\s*grid/.test(cssSrc));
check('the unlocked pip is visually distinct from a locked one',
    /\.trophy-pip\.is-unlocked\s*\{[^}]*border-color/.test(cssSrc));

console.log('\n--- AT-F2 part 6: the record must not still call it blocked ---');

// A stale status is a real cost in this project, not a formatting nit: this
// register already carries one false "fully closed" claim. The entry stays (the
// never-delete rule) but it may not claim the panel is a placeholder, and the
// build order may not list it as open work.
{
    const ff = read('docs/arcaneTyper-docs/future_feature.md');
    const atF2 = slice(ff, '### AT-F2', '\n---');
    check('the AT-F2 entry exists (the never-delete rule)', atF2.length > 0);
    check('the entry carries a dated status update',
        /\*\*Status update \d{4}-\d{2}-\d{2}\.\*\*/.test(atF2),
        "the file convention is a dated '**Status update**' line, not an edit in place");
    check('that status update says SHIPPED',
        /\*\*Status update \d{4}-\d{2}-\d{2}\.\*\*\s*\**\s*SHIPPED/i.test(atF2),
        'the status is the whole point of this check');
    // The never-delete rule means the original "Status. Blocked on design
    // decision." line is STILL in the file verbatim. So the check is not "the
    // word Blocked is absent" — that would force the rule to be broken. It is
    // that no Blocked status is left STANDING, i.e. every one carries an
    // explicit supersession marker. An earlier version of this check simply
    // asserted the word was gone, and went red against a correctly-retained
    // entry — the guard was wrong, not the documentation.
    const blockedLines = atF2.split('\n').filter((l) => /\*\*Status\.\*\*\s*Blocked/i.test(l));
    check('every retained Blocked status is explicitly marked superseded',
        blockedLines.length > 0 && blockedLines.every((l) => /superseded/i.test(l)),
        `unmarked Blocked line(s): ${blockedLines.filter((l) => !/superseded/i.test(l)).join(' | ')}`);
    check('the build order no longer lists AT-F2 as open work',
        !/^\s*\d+\.\s*\*\*AT-F2\*\*/m.test(ff),
        'strike it through or move it, per the convention used for shipped items');
}

console.log(`\n${failures === 0
    ? 'All AT-F2 badge-panel checks passed.'
    : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
