/**
 * Regression guard for the AT-F16 naming decision — owner 2026-09-23:
 * the blood-glyph character is **Bloodseeker**, not Runeseeker.
 *
 * Why a guard for a rename: an id is an IDENTITY. The Forge card id, the
 * `data-char` value and the docs have to agree, because AT-F14's class attaches
 * to this character, `Stats.selectedCharacter` persists the id to
 * localStorage/profiles, and a half-renamed world (card renamed, docs not — or
 * the reverse) is exactly how the AT-L8 roster split happened. What it locks:
 *   1. the card is `#skin-bloodseeker` / `data-char="bloodseeker"` with the
 *      BLOODSEEKER label — and still `locked`/`IN FORGE` (a rename must not
 *      accidentally ship the character);
 *   2. the skin roster is exactly {wizard, voidweaver, bloodseeker};
 *   3. retired ids appear in NO game source (index/style/main/Stats/…): neither
 *      the old blood-glyph spelling nor the pre-AT-L8 roster's `gojo`/`sukuna` —
 *      the guard may name them, the game may not;
 *   4. the unlock gate still says no: `isCharacterUnlocked` is sliced out of the
 *      REAL Stats source and executed — 'bloodseeker' must come back false for a
 *      normal player (wizard free, admin excepted), i.e. the rename did not
 *      sneak past the gate;
 *   5. the docs agree (AT-F16 marked RESOLVED, the Meta-progression row and the
 *      teaser list say Bloodseeker, the "name has to settle" phrasing is gone);
 *   6. `verify:skins` is wired into `npm run verify`.
 *
 * The second half of AT-F16 (the Forge itself) moved three more invariants into
 * the same file, because each one is a promise the cards make to the player:
 *   7. `backend/Characters.js` is the ONLY roster: the cards' ids, labels,
 *      colours and prices must equal the table, and no price may live in markup;
 *   8. the price is enforced by the shipped `purchaseCharacter`, EXECUTED here —
 *      a mage one XP short buys nothing and is not charged, a funded mage is
 *      charged the table price and ends up owning the character;
 *   9. `CharacterRenderer.draw` branches on the id (it used to ignore it and
 *      always paint the wizard), every roster id renders without throwing, and
 *      each skin paints *different* art;
 *  10. the art stays procedural: no raster/SVG anywhere in the character art or
 *      the previews, and the Forge bodies are blitted from RenderCache;
 *  11. the Forge UI reads prices from the table, calls the real purchase and
 *      equip path, repaints the canvas previews with the arena's own draw call,
 *      and re-syncs when the profile panel opens.
 * Run:  node scripts/verify-skin-ids.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CHARACTERS, DEFAULT_CHARACTER, isCharacter, characterInfo, normalizeCharacter } from '../backend/Characters.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');

const htmlSrc = read('frontend/index.html');
const cssSrc = strip(read('frontend/style.css'));
const statsSrc = strip(read('backend/Stats.js'));
const pkgSrc = read('package.json');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

// The retired spelling, named once. Only the GAME sources below are searched
// for it: guards may name it to check, and the docs quote it as history.
const OLD_ID = 'runeseeker';

// ── 1. the card itself ─────────────────────────────────────────────────────
check(
    'the card is #skin-bloodseeker and carries data-char="bloodseeker"',
    count(htmlSrc, 'id="skin-bloodseeker"') === 1 &&
        count(htmlSrc, 'data-char="bloodseeker"') === 1 &&
        /id="skin-bloodseeker"[^>]*data-char="bloodseeker"/.test(htmlSrc)
);
check('the visible label reads BLOODSEEKER', count(htmlSrc, '>BLOODSEEKER</span>') === 1);
check(
    'the decision is recorded at the card itself',
    htmlSrc.includes('AT-F16: owner decision 2026-09-23') && htmlSrc.includes('Locked by verify:skins.')
);
check(
    'the rename did NOT unlock the character (stays locked, IN FORGE, teaser title intact)',
    count(htmlSrc, 'class="skin-card locked" id="skin-bloodseeker"') === 1 &&
        count(htmlSrc, 'IN FORGE') === 2 &&
        htmlSrc.includes('title="Coming Soon: Ancient Blood Runes & Netherblade"')
);

// ── 2. the skin roster is exactly the three expected characters ───────────
const dataChars = [...htmlSrc.matchAll(/data-char="([a-z]+)"/g)].map((m) => m[1]).sort();
check(
    'exactly three characters: bloodseeker, voidweaver, wizard',
    JSON.stringify(dataChars) === JSON.stringify(['bloodseeker', 'voidweaver', 'wizard']),
    dataChars.join(',')
);
const skinIds = [...htmlSrc.matchAll(/id="(skin-[a-z]+)"/g)].map((m) => m[1]).sort();
check(
    'exactly three skin cards with the matching ids',
    JSON.stringify(skinIds) === JSON.stringify(['skin-bloodseeker', 'skin-voidweaver', 'skin-wizard']),
    skinIds.join(',')
);
check(
    'the sibling card is untouched by the rename sweep',
    count(htmlSrc, 'id="skin-voidweaver"') === 1 && count(htmlSrc, '>VOIDWEAVER</span>') === 1
);
check(
    'wizard remains the one active, selectable skin',
    count(htmlSrc, 'class="skin-card active"') === 1 && count(htmlSrc, 'id="skin-wizard"') === 1
);

// ── 3. the retired spelling is gone from every game source ────────────────
const gameSources = [
    'frontend/index.html', 'frontend/style.css', 'frontend/main.js', 'frontend/Game.js',
    'frontend/ui/AuthUI.js', 'frontend/ui/ProfileUI.js', 'frontend/ui/MenuUI.js',
    'frontend/game/CharacterRenderer.js', 'backend/Stats.js', 'backend/Duel.js',
    'backend/MageClasses.js', 'backend/Characters.js', 'backend/Leaderboard.js'
];
const infested = gameSources.filter((p) => new RegExp(OLD_ID, 'i').test(strip(read(p))));
check('no game source still carries the retired id', infested.length === 0, infested.join(', '));
check(
    'no CSS selector references either retired id',
    !new RegExp('#' + OLD_ID, 'i').test(cssSrc) && !/skin-(runeseeker)/i.test(cssSrc)
);
// AT-F16: the same house rule for the retired ROSTER (the pre-AT-L8 skins). The
// roster table's `normalizeCharacter` is what heals such a value now, so the
// literals must not survive as a second, hand-written migration list.
const retiredRosterIds = ['gojo', 'sukuna'];
const rosterInfested = gameSources.filter((p) =>
    retiredRosterIds.some((id) => new RegExp(id, 'i').test(strip(read(p))))
);
check(
    'no game source still carries a pre-AT-L8 roster id',
    rosterInfested.length === 0,
    rosterInfested.join(', ')
);
check(
    'the stored selection is healed through the table, not a second list',
    /this\.selectedCharacter = normalizeCharacter\(/.test(statsSrc)
);

// ── 4. the unlock gate, executed from the REAL Stats source ────────────────
/**
 * A class method body WITH its closing brace, so `new Function` can take it.
 * AT-F16: the gate and the purchase read the real roster helpers, so those are
 * INJECTED (not stubbed) — what runs here is the shipped rule against the
 * shipped table.
 */
function classMethodBody(src, name) {
    const at = src.indexOf(`\n    ${name}(`);
    if (at < 0) return '';
    const end = src.indexOf('\n    }\n', at);
    if (end < 0) return '';
    return src.slice(at, end + '\n    }'.length);
}
function sliceMethodAsFunction(src, name, deps) {
    const body = classMethodBody(src, name);
    if (!body) return null;
    const names = Object.keys(deps);
    try {
        // The slice is a bare class member (`name(args) {...}`); `new Function`
        // needs a declaration, so the `function` keyword is restored.
        const asDeclaration = `function ${body.trimStart()}\nreturn ${name};`;
        return new Function(...names, asDeclaration)(...names.map((n) => deps[n]));
    } catch {
        return null;
    }
}
const unlockSrc = classMethodBody(statsSrc, 'isCharacterUnlocked');
check('the unlock gate is sliced out of the shipped Stats.js', unlockSrc.length > 0);
const isUnlocked = sliceMethodAsFunction(statsSrc, 'isCharacterUnlocked', { isCharacter, DEFAULT_CHARACTER });
check('the gate compiles and runs against the real roster helpers', typeof isUnlocked === 'function');

const asPlayer = { isAdmin: () => false, unlockedCharacters: [DEFAULT_CHARACTER] };
check(
    "bloodseeker is LOCKED for a normal player (the rename did not slip past the gate)",
    isUnlocked.call(asPlayer, 'bloodseeker') === false
);
check(
    'voidweaver likewise locked, wizard still the free default',
    isUnlocked.call(asPlayer, 'voidweaver') === false &&
        isUnlocked.call(asPlayer, 'wizard') === true
);
check(
    'an id the roster does not know is never "unlocked"',
    isUnlocked.call(asPlayer, 'skin-wizard') === false && isUnlocked.call(asPlayer, OLD_ID) === false
);
check(
    'owning a character satisfies the gate (what a purchase has to produce)',
    isUnlocked.call({ isAdmin: () => false, unlockedCharacters: ['wizard', 'bloodseeker'] }, 'bloodseeker') === true
);
check('the admin bypass is intact', isUnlocked.call({ isAdmin: () => true }, 'voidweaver') === true);

// ── 4b. the price is enforced by the shipped purchaseCharacter, EXECUTED ───
const purchaseSrc = classMethodBody(statsSrc, 'purchaseCharacter');
check('purchaseCharacter is sliced out of the shipped Stats.js', purchaseSrc.length > 0);
const purchase = sliceMethodAsFunction(statsSrc, 'purchaseCharacter', {
    characterInfo, normalizeCharacter, DEFAULT_CHARACTER, isCharacter
});
check('the purchase compiles against the real roster helpers', typeof purchase === 'function');

/** The only parts of Stats a purchase touches, faked for the executed rule. */
function forgeAccount(xp, owned = [DEFAULT_CHARACTER]) {
    return {
        totalXP: xp,
        unlockedCharacters: owned.slice(),
        saves: 0,
        isCharacterUnlocked(id) { return this.unlockedCharacters.includes(id); },
        spendXP(cost) {
            if (cost > this.totalXP) return false;
            this.totalXP -= cost;
            return true;
        },
        saveProgression() { this.saves++; }
    };
}
const forgePrice = characterInfo('bloodseeker').unlockPrice;
check(
    'the roster prices both Forge characters (the card has no price of its own)',
    forgePrice > 0 && characterInfo('voidweaver').unlockPrice === forgePrice
);
const broke = forgeAccount(forgePrice - 1);
check(
    'one XP short: nothing is bought and nothing is charged',
    purchase.call(broke, 'bloodseeker') === false &&
        broke.totalXP === forgePrice - 1 &&
        !broke.unlockedCharacters.includes('bloodseeker') &&
        broke.saves === 0
);
const funded = forgeAccount(forgePrice);
check(
    'funded: charged the table price, owns the character, one save',
    purchase.call(funded, 'bloodseeker') === true &&
        funded.totalXP === 0 &&
        funded.unlockedCharacters.includes('bloodseeker') &&
        funded.saves === 1
);
check(
    'buying twice is refused (no double charge)',
    purchase.call(funded, 'bloodseeker') === false && funded.totalXP === 0
);
check(
    'an id the roster does not know cannot be bought (it normalises to the free default)',
    purchase.call(forgeAccount(1e6), 'skin-wizard') === false
);
check(
    'the id has a home when it unlocks: the persistence key and setter exist',
    statsSrc.includes("'typerMaster_selectedCharacter'") &&
        statsSrc.includes('setSelectedCharacter(characterId)')
);
check(
    'setSelectedCharacter is declared exactly once (a shadowing duplicate would silently win)',
    count(statsSrc, 'setSelectedCharacter(characterId)') === 1
);
check(
    'the bought roster is persisted and reloaded, so a skin survives a reload',
    statsSrc.includes('JSON.stringify(this.unlockedCharacters)') &&
        statsSrc.includes('this.unlockedCharacters = readStoredJSON(') &&
        count(statsSrc, 'this.unlockedCharacters') >= 4
);

// ── 5. the roster table is the single source the cards promise from ────────
const rosterIds = CHARACTERS.map((c) => c.id);
// The grid slice ends where the next panel starts, so a card check can never
// accidentally read the run-history numbers below it.
const gridHtml = htmlSrc.slice(
    htmlSrc.indexOf('id="character-skin-grid"'),
    htmlSrc.indexOf('<!-- Run History Graph -->')
);
function skinCardHtml(id) {
    const at = gridHtml.indexOf(`id="skin-${id}"`);
    if (at < 0) return '';
    const next = gridHtml.indexOf('id="skin-', at + 10);
    return gridHtml.slice(at, next < 0 ? gridHtml.length : next);
}
check(
    'the table and the markup roster the same three ids',
    JSON.stringify([...rosterIds].sort()) === JSON.stringify([...dataChars].sort()),
    `${rosterIds.join(',')} vs ${dataChars.join(',')}`
);
check(
    'the default character is the free one (price 0, the only id a guest gets)',
    characterInfo(DEFAULT_CHARACTER).unlockPrice === 0 && isCharacter(DEFAULT_CHARACTER)
);
check(
    'an unknown id normalises to the default instead of resolving to nothing',
    normalizeCharacter('skin-wizard') === DEFAULT_CHARACTER &&
        normalizeCharacter(undefined) === DEFAULT_CHARACTER &&
        normalizeCharacter(OLD_ID) === DEFAULT_CHARACTER
);

for (const c of CHARACTERS) {
    const card = skinCardHtml(c.id);
    const statusAt = card.indexOf('class="skin-status"');
    const statusText = statusAt < 0 ? '' : card.slice(statusAt).replace(/^[^>]*>/, '').split('<')[0].trim();

    if (c.unlockPrice === 0) {
        check(
            `the ${c.id} card matches the table (label, priced as the free default)`,
            card.includes(`>${c.short}</span>`) && statusText === 'Unlocked' &&
                card.includes('color: white;')                       // the flagship keeps its white label
        );
    } else {
        check(
            `the ${c.id} card matches the table (label, colour, teaser, and no price of its own)`,
            card.includes(`>${c.short}</span>`) &&
                card.includes(`color: ${c.color};`) &&
                card.includes(`title="Coming Soon: ${c.blurb}"`) &&
                statusText === 'IN FORGE' &&
                !card.includes(String(c.unlockPrice)) &&                 // no typed price,
                !card.includes(c.unlockPrice.toLocaleString('en-US'))    // in either form
        );
    }
}
check(
    'every card preview is a renderer-painted canvas (no hand-drawn SVG stand-ins)',
    count(gridHtml, 'class="skin-preview"') === rosterIds.length && !/<svg/i.test(gridHtml)
);
check(
    'the canvases carry no data-char of their own (the card owns the id)',
    count(gridHtml, 'data-char=') === rosterIds.length
);

// ── 6. the renderer branches on the id (AT-F16's core fix) ────────────────
const rendererRaw = read('frontend/game/CharacterRenderer.js');
const rendererSrc = strip(rendererRaw);
check(
    'draw() dispatches on the normalised id',
    /switch \(normalizeCharacter\(characterId\)\)/.test(rendererSrc)
);
const caseIds = [...rendererSrc.matchAll(/case '([a-z]+)':/g)].map((m) => m[1]).sort();
check(
    'one renderer branch per non-default roster character',
    JSON.stringify(caseIds) ===
        JSON.stringify(rosterIds.filter((id) => id !== DEFAULT_CHARACTER).sort()),
    `cases: ${caseIds.join(',')}`
);
check(
    'the fallback branch is still the wizard (an unknown id never paints nothing)',
    /default:\s*\n\s*CharacterRenderer\.drawWizard\(/.test(rendererSrc)
);
check(
    'the explicit wizard case is gone (it is the default, not a special case)',
    !caseIds.includes(DEFAULT_CHARACTER)
);
check(
    // Scanned with comments stripped: this file's own header NAMES the banned
    // constructs (that is how the house rule is documented), so only live code
    // may fail here — see the comment-twin check below.
    'the character art stays procedural: no raster, no SVG, no pattern fills',
    !/<img|url\(|\.png|\.jpe?g|\.webp|\.gif|createPattern/i.test(rendererSrc)
);
check(
    'the raster ban is a documented house rule, not just an accident of the code',
    /<img/.test(rendererRaw) && /url\(http/.test(rendererRaw)
);
check(
    'the Forge bodies are baked through RenderCache and then blitted',
    /RenderCache\.bake\('char_body_/.test(rendererSrc) && /ctx\.drawImage\(body,/.test(rendererSrc)
);
check(
    'the renderers honour the low-quality switch like the wizard does',
    count(rendererSrc, 'window.__atLowQuality') === 3
);

// ── 7. the Forge UI: table prices, the real purchase path, canvases ───────
const mainSrc = strip(read('frontend/main.js'));
check(
    'the Forge reads its labels and prices from the roster table',
    mainSrc.includes('characterInfo(id)') && mainSrc.includes('info.unlockPrice')
);
check(
    'a card click goes through the real purchase and equip path',
    mainSrc.includes('game.stats.purchaseCharacter(id)') &&
        mainSrc.includes('game.stats.setSelectedCharacter(id)')
);
check(
    "the card previews are painted by the arena's own draw call",
    /CharacterRenderer\.draw\(ctx, 0, 0, characterId/.test(mainSrc)
);
check(
    'the Forge re-syncs every time the profile panel opens',
    /profileUI\.updateMenuStats\(\);\s*\n\s*updateForgeUI\(\);/.test(mainSrc)
);
check(
    'a guest is told to log in rather than buying into a void',
    mainSrc.includes('The Forge needs a sealed Mage Card!')
);
check(
    'the cards are wired from the markup grid, not from a hard-coded list',
    mainSrc.includes("querySelectorAll('#character-skin-grid .skin-card')")
);
check(
    'each equipped id owns its border colour in CSS',
    rosterIds.every((id) => cssSrc.includes(`#skin-${id}.active`))
);
check(
    'the canvas previews are sized in CSS and float with the other previews',
    /\.skin-preview\s*\{[\s\S]{0,160}height: 38px/.test(cssSrc) &&
        /\.skin-avatar-preview canvas/.test(cssSrc)
);


// ── 6b. executed: every character actually paints (recording 2D context) ──
// The renderer is imported FOR REAL (its only browser dependency is
// `document.createElement('canvas')` inside a bake and `window.__atLowQuality`),
// so this is the shipped draw path running, not a description of it.
const { CharacterRenderer } = await import('../frontend/game/CharacterRenderer.js');

const gradientStub = { addColorStop: () => {} };
function recordingCtx(calls) {
    return new Proxy({}, {
        get(target, prop) {
            if (prop in target) return target[prop];
            if (typeof prop !== 'string') return undefined;
            return (...args) => {
                calls.push(prop);
                if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return gradientStub;
                return undefined;
            };
        },
        set(target, prop, value) { target[prop] = value; return true; }
    });
}
/** Runs one draw of `id` and returns the recorded calls (or the throw). */
function renderCharacter(id, opts = {}) {
    const calls = [];
    globalThis.window = { __atLowQuality: !!opts.lowQ };
    globalThis.document = {
        createElement: () => ({ width: 0, height: 0, getContext: () => recordingCtx(calls) })
    };
    const ctx = recordingCtx(calls);
    const stats = { combo: opts.combo || 0, wandColor: '#ffd700', hasSkill: () => false };
    let error = null;
    try {
        CharacterRenderer.draw(ctx, 120, 120, id, 0, stats, 4242);
    } catch (e) {
        error = e;
    }
    return { calls, error };
}
const opsOf = (id, opts) => {
    const r = renderCharacter(id, opts);
    return r.error ? [`THREW: ${r.error.message}`] : [...new Set(r.calls)].sort();
};

const rendered = {};
for (const id of rosterIds) {
    const r = renderCharacter(id);
    rendered[id] = r;
    check(
        `the ${id} renders without throwing`,
        !r.error && r.calls.length > 20,
        r.error ? r.error.message : `${r.calls.length} draw ops`
    );
}
check(
    'the three skins are different art, not one wizard repainted three times',
    JSON.stringify(opsOf('wizard')) !== JSON.stringify(opsOf('voidweaver')) &&
        JSON.stringify(opsOf('voidweaver')) !== JSON.stringify(opsOf('bloodseeker'))
);
check(
    'the two Forge bodies are blitted from the RenderCache bake (not re-pathed per frame)',
    rendered.voidweaver.calls.includes('drawImage') && rendered.bloodseeker.calls.includes('drawImage')
);
check(
    'an id the roster does not know paints exactly the wizard (no blank arena)',
    JSON.stringify(opsOf('skin-wizard')) === JSON.stringify(opsOf('wizard')) &&
        JSON.stringify(opsOf(OLD_ID)) === JSON.stringify(opsOf('wizard'))
);
// The first draw of a character ALSO pays for its RenderCache bake, so a tier
// comparison has to warm the cache first — otherwise `combo 150` would look
// smaller than a cold `combo 0` (which recorded the whole bake as calls).
function warmedOps(id, opts) {
    renderCharacter(id, opts);
    return renderCharacter(id, opts).calls.length;
}
check(
    'combo tiers add layers on both Forge skins (150 paints more than 0)',
    warmedOps('voidweaver', { combo: 150 }) > warmedOps('voidweaver') &&
        warmedOps('bloodseeker', { combo: 150 }) > warmedOps('bloodseeker')
);
const lowQ = renderCharacter('voidweaver', { lowQ: true });
check('the low-quality path still paints', !lowQ.error && lowQ.calls.length > 10);

// ── 8. the docs agree (SKIP when the docs repo is not checked out) ────────
let ff = null;
let ps = null;
try { ff = read('docs/arcaneTyper-docs/future_feature.md'); } catch { /* skip */ }
try { ps = read('docs/arcaneTyper-docs/PROJECT_STATUS.md'); } catch { /* skip */ }
if (!ff || !ps) {
    console.log('SKIP  docs repo not checked out — doc agreement not cross-checked');
} else {
    const f16 = ff.slice(ff.indexOf('### AT-F16'), ff.indexOf('## Build order'));
    check(
        'AT-F16 records the new id and the resolution',
        f16.includes('#skin-bloodseeker') && f16.includes('data-char="bloodseeker"') &&
            f16.includes('Naming — RESOLVED 2026-09-23: Bloodseeker')
    );
    check(
        'the AT-F16 entry keeps the old spelling only as recorded history',
        f16.includes('recorded history') && f16.includes('renamed from')
    );
    check(
        'the Meta-progression row says Bloodseeker',
        ps.includes('Voidweaver & Bloodseeker In Forge')
    );
    check(
        'the teaser list says Bloodseeker',
        ps.includes('**Bloodseeker**: Ancient blood-glyph')
    );
    check(
        'the unresolved "name has to settle" phrasing is gone',
        !ps.includes('Bloodseeker vs Runeseeker') &&
            count(ps, 'the name (settled: Bloodseeker)') === 2
    );
    check(
        'the session log records the resolution where the conflict was logged',
        ps.includes('RESOLVED 2026-09-23 — Bloodseeker wins')
    );
}

// ── 9. the guard is wired in ───────────────────────────────────────────────
check(
    'verify:skins is a script and part of the chain',
    pkgSrc.includes('"verify:skins": "node scripts/verify-skin-ids.mjs"') &&
        pkgSrc.includes('&& npm run verify:skins')
);

console.log('');
if (failures) {
    console.error(`${failures} skin-id check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-F16 Forge / skin-id checks passed.');
process.exit(0);

