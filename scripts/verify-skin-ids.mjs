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
const mainEarly = read('frontend/main.js');
const pkgSrc = read('package.json');

// Every secret counter's goal, read out of the REAL Achievements definitions
// rather than repeated here. Two locked skins now count different things
// (the Voidweaver at 10, the Bloodseeker at 100), so a guard that hard-coded
// "0/10" would be lying about the second card the moment it was added. The
// card's status text must equal the definition's own goal.
//
// The COUNTER_GOALS table is built HERE, but the checks that consume it run in
// the roster section below — not at this point in the file. `check` and
// `failures` are declared a few lines down, so calling them from up here throws
// "Cannot access 'failures' before initialization" and the whole guard file
// dies on its first line, printing nothing.
const achievementsSrc = read('frontend/Achievements.js');
const COUNTER_GOALS = {};
// Anchor on each `counter: { ... }` and walk BACK to the nearest definition id.
// Two wrong versions got here first, both worth recording:
//   1. `'id': {[\s\S]*?counter:` — non-greedy still runs forward past the end of
//      the opening definition, so the Voidweaver's id was filed with the
//      Bloodseeker's goal (100) and the Voidweaver appeared to have no counter.
//   2. `'id': {([^{}]*)}` — the counter's OWN nested braces are excluded by
//      [^{}], so the only two definitions that actually have a counter matched
//      nothing at all, and the table came back empty.
// Walking back from the counter to its id cannot span a definition boundary, so
// the key and the goal can never come from two different achievements.
for (const c of achievementsSrc.matchAll(/counter:\s*\{\s*key:\s*'([A-Za-z]+)',\s*goal:\s*(\d+)/g)) {
    const before = achievementsSrc.slice(0, c.index);
    const owners = [...before.matchAll(/^\s*'?([a-z_]+)'?:\s*\{/gm)];
    const owner = owners[owners.length - 1];
    if (owner) COUNTER_GOALS[owner[1]] = Number(c[2]);
}

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
// Owner decision 2026-09-26: the card's shipped LABEL is now `???`, because the
// Bloodseeker carries `secretIdentity` — it has a visible n/100 route but keeps
// its name hidden, so winning duels is the only thing that reveals the card.
// The rename is still guarded: the name must be exactly the one in
// `Characters.js`, and the retired spelling must stay out of the game.
// This used to assert a literal `>BLOODSEEKER</span>`, which is what the
// `secretIdentity` change made false.
check(
    'the visible label follows the roster (hidden when secretIdentity is set)',
    count(htmlSrc, `>${characterInfo('bloodseeker').secretIdentity ? '???' : 'BLOODSEEKER'}</span>`) === 1 &&
        // And the name it is hiding is the real one, from the one roster.
        characterInfo('bloodseeker').short === 'BLOODSEEKER' &&
        // A card that reveals its name must still show it in markup.
        count(htmlSrc, '>VOIDWEAVER</span>') === 1,
    'the shipped label no longer matches what the roster says the card should show'
);
check(
    'the decision is recorded at the card itself',
    htmlSrc.includes('AT-F16: owner decision 2026-09-23') && htmlSrc.includes('Locked by verify:skins.')
);
check(
    'the rename did NOT unlock the character (stays locked, reads ???, teaser title intact)',
    // The class/id are matched as two separate attributes, not one contiguous
    // string: the 2026-09-26 skin showcase dropped the `.carousel-slide` wrapper
    // the cards used to sit in, so the pairing order inside the tag is no longer
    // fixed by the markup but the attributes themselves are unchanged.
    // The teaser is compared HTML-ESCAPED: `&` is `&amp;` in an attribute.
    // "IN FORGE" is gone from the markup (owner decision 2026-09-26): a locked
    // card states its route, and a routeless one states nothing at all.
    // The shipped `title` is now "Locked" too (owner request 2026-09-26) — it
    // used to carry the full teaser, which for this card IS its identity.
    // NB: this reads the RAW html, comments included, so the explanatory
    // comment above the card deliberately does NOT quote the old title string
    // verbatim — otherwise "the teaser must not come back" would match the very
    // note explaining its removal.
    count(htmlSrc, 'class="skin-card locked"') === 2 &&
        count(htmlSrc, 'id="skin-bloodseeker" data-char="bloodseeker"') === 1 &&
        count(htmlSrc, '>IN FORGE</span>') === 0 &&
        count(htmlSrc, 'title="Locked"') === 2 &&
        // Neither locked card may ship a teaser in the DOM at all.
        !htmlSrc.includes('Ancient Blood Runes') &&
        !htmlSrc.includes('Astral Gravitation')
);
// The Bloodseeker is displayed as `???` while locked, but that happens at
// RUNTIME in updateForgeUI — the shipped markup keeps the real label, so the
// rename guard above still has something real to read. Checked in the Forge
// section below, where `mainSrc` is already in scope.
check('the skin row is a FLEX row of three cards, not a 3-column grid',
    // Regression: the id-scoped rule `#profile-menu #character-skin-grid` once kept
    // `display: grid !important` from the old 3-up layout. A grid cell would give
    // every card a third of the width, which cannot express the showcase's one
    // enlarged card beside two smaller ones.
    !/character-skin-grid\s*\{[^}]*display:\s*grid/.test(cssSrc) &&
    !/character-skin-grid[^}]*grid-template-columns/.test(cssSrc) &&
    cssSrc.includes('.skin-showcase-row {') &&
    /\.skin-showcase-row\s*\{[^}]*display:\s*flex/.test(cssSrc),
    'a grid track cannot make one card wider than its neighbours');
// The label-in-markup assertion used to live here as a second copy of
// `count(htmlSrc, '>BLOODSEEKER</span>') === 1`, existing only so "the rename
// guard above reads a real label". It is gone: the Bloodseeker now ships `???`
// (secretIdentity, owner 2026-09-26), so the literal is false by design, and the
// surviving check in section 1 asserts the label against the ROSTER instead —
// which is what actually keeps the rename honest. Two copies of the same
// assertion is one more place for a decision to contradict itself.

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
    'the default Wizard card is neutral in markup and selected at runtime',
    count(htmlSrc, 'class="skin-card active"') === 0 &&
        count(htmlSrc, 'id="skin-wizard"') === 1 &&
        mainEarly.includes("card.classList.toggle('active', equipped)") &&
        mainEarly.includes("card.style.borderColor = equipped ? info.color")
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
// `characterInfo` is injected because the shipped gate now reads the
// character's `unlockAchievement` from the roster to allow a second,
// achievement-based route into a skin. Without it the sliced method compiles
// against a name that does not exist in this sandbox and throws.
const isUnlocked = sliceMethodAsFunction(statsSrc, 'isCharacterUnlocked', { isCharacter, DEFAULT_CHARACTER, characterInfo });
check('the gate compiles and runs against the real roster helpers', typeof isUnlocked === 'function');

const asPlayer = { isAdmin: () => false, unlockedCharacters: [DEFAULT_CHARACTER] };
check(
    "bloodseeker is LOCKED for a normal player (the rename did not slip past the gate)",
    isUnlocked.call(asPlayer, 'bloodseeker') === false
);
check(
    'voidweaver likewise locked, wizard still the free default',
    isUnlocked.call(asPlayer, 'voidweaver') === false &&
        isUnlocked.call(asPlayer, 'wizard') === true,
    'the secret achievement is not unlocked in this stub, so the XP gate must still hold'
);
// The second route: owning nothing, but holding the granting achievement, must
// open the Voidweaver. This is the whole promise of `unlockAchievement`, and it
// is checked here because the real gate is executed above, not merely read.
const withAchievement = {
    isAdmin: () => false,
    unlockedCharacters: [DEFAULT_CHARACTER],
    achievements: { unlocked: new Set(['the_unspoken']) }
};
check(
    'the Voidweaver opens on its secret achievement alone, with no XP spent',
    isUnlocked.call(withAchievement, 'voidweaver') === true
);
check(
    'the achievement route is Voidweaver-specific — it must not open other skins',
    isUnlocked.call(withAchievement, 'bloodseeker') === false &&
        isUnlocked.call(withAchievement, 'wizard') === true,
    'the_unspoken granted the Bloodseeker, so the two secrets are not independent'
);
// The mirror of the block above, for the Bloodseeker's OWN route (owner decision
// 2026-09-26: 100 Arena wins). Executed, not read, because "the achievement opens
// the card" is the entire promise and it is the one thing a hand-edited roster
// could quietly break.
const withBloodAchievement = {
    isAdmin: () => false,
    unlockedCharacters: [DEFAULT_CHARACTER],
    achievements: { unlocked: new Set(['the_bloodied_standard']) }
};
check(
    'the Bloodseeker opens on its secret achievement alone, with no XP spent',
    isUnlocked.call(withBloodAchievement, 'bloodseeker') === true
);
check(
    'the two secret routes stay independent — neither opens the other\'s skin',
    isUnlocked.call(withBloodAchievement, 'voidweaver') === false,
    'the_bloodied_standard granted the Voidweaver');
check(
    'a Stats with no Achievements instance (guest) degrades instead of throwing',
    isUnlocked.call({ isAdmin: () => false, unlockedCharacters: [DEFAULT_CHARACTER] }, 'voidweaver') === false
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
// Every locked skin must point at a REAL counter, and the two must count
// DIFFERENT things. Both locked cards used to read 0/10 off a hard-coded
// literal; with the Bloodseeker on its own 100-duel counter that literal became
// a lie waiting to happen, so each card's status is asserted against the real
// goal from the Achievements definitions.
check(
    'every locked skin points at a REAL counter achievement',
    CHARACTERS.filter((c) => c.unlockPrice > 0)
        .every((c) => !!c.unlockAchievement && COUNTER_GOALS[c.unlockAchievement] > 0),
    `routes: ${CHARACTERS.filter((c) => c.unlockAchievement).map((c) => `${c.id}->${c.unlockAchievement}`).join(', ')} vs counters: ${Object.keys(COUNTER_GOALS).join(', ')}`
);
check(
    'the two locked skins count DIFFERENT things (a shared goal means a copy-paste)',
    new Set(CHARACTERS.filter((c) => c.unlockAchievement).map((c) => COUNTER_GOALS[c.unlockAchievement])).size ===
    CHARACTERS.filter((c) => c.unlockAchievement).length,
    'both locked skins read the same denominator'
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
        // Owner decision 2026-09-26: a locked card states its ROUTE, never a
        // price. BOTH locked skins now have a counter route — the Voidweaver at
        // 0/10 and the Bloodseeker at 0/100 — so the status is read from the
        // character's own achievement goal rather than hard-coded, which is the
        // only way one guard can stay true as the two counters diverge.
        //
        // The Bloodseeker's LABEL is `???` in markup now too (it gained
        // `secretIdentity`), so the label assertion below is conditional on the
        // flag rather than on "is it the Bloodseeker".
        const expectedStatus = c.unlockAchievement
            ? `0/${COUNTER_GOALS[c.unlockAchievement]}`
            : '???';
        const expectedLabel = c.secretIdentity ? '???' : c.short;
        check(
            `the ${c.id} card matches the table (label, colour, no teaser, and no price of its own)`,
            card.includes(`>${expectedLabel}</span>`) &&
                card.includes(`color: ${c.color};`) &&
                // Owner request 2026-09-26: a locked card ships `title="Locked"`.
                // The teaser (`c.blurb`) must NOT be in the markup for any locked
                // card — that string is the Bloodseeker's whole identity.
                card.includes('title="Locked"') &&
                !card.includes(c.blurb) &&
                statusText === expectedStatus &&
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
    count(rendererSrc, 'window.__atLowQuality') >= 4 &&
        rendererSrc.includes('const lowQ = window.__atLowQuality;') &&
        rendererSrc.includes('lowQ ? 0.72 : 1')
);

// ── 7. the Forge UI: table prices, the real purchase path, canvases ───────
const mainSrc = strip(read('frontend/main.js'));
/**
 * Code with whole-line `//` comments removed. The notes in these files quote the
 * legacy code they replaced (and name the very selectors this block forbids), so
 * ownership checks have to read code, not history.
 */
const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const mainCode = codeOnly(mainSrc);
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
    /profileUI\.updateMenuStats\(\);[\s\S]{0,160}?updateForgeUI\(\);/.test(mainCode)
);
// A guest must be told to sign in rather than left buying into a void. The
// wording moved into the shared `MagicalToast.locked` gate prompt
// (owner request 2026-09-26), so this now asserts the Forge routes through it.
check(
    'a guest is told to log in rather than buying into a void',
    mainCode.includes('if (needsMageCard()) {') &&
        mainCode.includes('MagicalToast.locked(') &&
        !mainCode.includes('The Forge needs a sealed Mage Card!')
);
check(
    'the cards are wired from the markup grid, not from a hard-coded list',
    mainSrc.includes("querySelectorAll('#character-skin-grid .skin-card')")
);

// ── 7b. ONE owner for the card surface (live-browser finding, 2026-09-24) ──
// A real Chrome pass caught what these source checks could not: ProfileUI still
// bound its own `.skin-card` click handler and rewrote `.skin-status` to
// UNLOCKED/LOCKED, so one click fired two handlers — the legacy one announced
// "IN FORGE: currently being forged!" (plus the error sound) *before* the real
// purchase ran — and the Forge's prices were wiped on every updateMenuStats().
const profileUiCode = codeOnly(strip(read('frontend/ui/ProfileUI.js')));
check(
    'ProfileUI no longer touches the character cards',
    !profileUiCode.includes('skin-card') && !profileUiCode.includes('skin-status') &&
        !profileUiCode.includes('setupSkinSelection') && !profileUiCode.includes('updateSkinCardsUI')
);
check(
    'the legacy "being forged" toast is gone (it raced the real purchase)',
    !mainCode.includes('This original class is currently being forged!') &&
        !profileUiCode.includes('currently being forged')
);
check(
    'the cards are bound exactly once, by the Forge',
    count(mainCode, "querySelectorAll('#character-skin-grid .skin-card')") === 1 &&
        count(mainCode, "card.addEventListener('click'") === 1
);
check(
    'exactly one writer of `.skin-status` in the frontend source',
    count(mainCode, "querySelector('.skin-status')") === 1
);

// ── 7c. the preview painter must be CALLED, not merely defined ────────────
// `paintSkinPreviews` shipped with ZERO callers: the cards rendered as three
// blank strips until the profile was opened, and no source-level check noticed,
// because the function itself was perfect. A definition is not a feature, so
// this asserts the call sites, not the implementation.
check(
    'paintSkinPreviews() is actually called (boot + panel open)',
    count(mainCode, 'paintSkinPreviews();') >= 2,
    `found ${count(mainCode, 'paintSkinPreviews();')} call(s)`
);
check(
    'the Forge paints and prices itself at boot, before a panel is opened',
    /paintSkinPreviews\(\);\s*\n\s*updateForgeUI\(\);/.test(mainCode)
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

// ── AT-F15: an unlocked-but-unpicked card must not stay visually dimmed ─────
// The cards ship a "coming soon" paint (dark plate + grey label) as INLINE
// styles. Ownership changes three things, not one: the `locked` class, the
// card's background, and the label colour. Repainting only the border left a
// purchased character looking locked forever, which is the reported bug.
// Built from `mainCode` (whole-line `//` comments already dropped), NOT
// `mainSrc`. updateForgeUI carries an explanatory comment that QUOTES the old
// `Coming Soon: ${info.blurb}` title in order to say why it is gone — reading
// the comment-bearing source made the "the teaser must not come back" check
// fail on the very note that documents its removal.
const forgeBody = (() => {
    const at = mainCode.indexOf('function updateForgeUI');
    if (at < 0) return '';
    const end = mainCode.indexOf('\n  }', at);
    return mainCode.slice(at, end < 0 ? mainCode.length : end);
})();
// The status colour has THREE states (owner decision 2026-09-26): a character
// with an achievement route prints n/goal in violet (alive), one with NO route
// prints `???` in the muted unrevealed violet, and owned prints gold. The
// ternary therefore reads owned → counterRoute → noRoute → price, in that order.
check('the Forge repaints every owned-state property, not just the border',
    forgeBody.includes("card.classList.toggle('available', owned && !equipped)") &&
    forgeBody.includes('card.style.background = owned') &&
    forgeBody.includes("status.style.color = owned ? '#ffd700' : counterRoute ? '#c7d2fe' : noRoute ? '#7c6b95' : '#64748b';") &&
    forgeBody.includes('counterRoute'),
    forgeBody ? '' : 'updateForgeUI not found');
// The Forge card shows the achievement route, not only the XP price
check('the Forge card shows the achievement route, not only the XP price',
    forgeBody.includes("const achId = info.unlockAchievement || null;") &&
    forgeBody.includes('game.achievements.getProgress(achId)') &&
    forgeBody.includes('counterRoute ? `${count}/${achDef.counter.goal}`'),
    'the card read the price alone, so an achievement owner saw FORGE 12,000 XP and a dead click');
// AT-F16 (owner decision 2026-09-26): a counter route shows n/goal from ZERO, and
// a routeless character shows `???` — never a price. The old code gated the
// counter on `count > 0`, so a fresh account saw "FORGE 12,000 XP" on BOTH
// locked cards: indistinguishable from each other, and advertising an XP route
// for a character whose real route is the silent counter.
check('a counter route reads n/goal from zero — never the XP price',
    forgeBody.includes('const counterRoute = !owned && !!achDef?.counter;') &&
    // The `count > 0` gate is the bug; it must not come back.
    !/achDef\?\.counter && count > 0/.test(forgeBody) &&
    !forgeBody.includes('secretRoute'),
    'count > 0 hid the counter until it was already started, so a fresh account saw FORGE 12,000 XP');
check('a routeless locked skin reads ??? in BOTH the label and the status',
    forgeBody.includes('const noRoute = !owned && !counterRoute;') &&
    forgeBody.includes("noRoute ? '???'") &&
    mainSrc.includes("card.classList.toggle('is-unrevealed', !revealed)"),
    '`???` over "FORGE 12,000 XP" contradicts the label one line lower');
// AT-F16 follow-up (owner decision 2026-09-26): the Bloodseeker now has a
// counter route but its NAME must stay `???` anyway — `secretIdentity` is what
// separates it from the Voidweaver, which reveals itself at n/10. This is the
// difference the owner asked for ("??? then 0/100, just like the Voidweaver"),
// so the flag is guarded rather than left to a hand-edited ternary.
check('a counter route reveals its name UNLESS the character hides its identity',
    mainSrc.includes('const revealed = owned || (!!info.unlockAchievement && !info.secretIdentity);') &&
    characterInfo('bloodseeker').secretIdentity === true &&
    // The Voidweaver must NOT hide: the counter is its only teaser.
    characterInfo('voidweaver').secretIdentity === undefined,
    'the two secrets differ exactly here, and the rule must be read from the roster');
// Owner request 2026-09-26: hovering ANY locked card says only "Locked".
//
// The tooltip used to be `Coming Soon: ${info.blurb}` — the full teaser — and
// was then overridden lower down with 'An unrecorded skin.' for the secret
// only. Two rules for one field, kept in agreement by hand, and the Bloodseeker's
// teaser ("Ancient Blood Runes & Netherblade") is its entire identity. Hovering
// a card is the most obvious way to ask "what is this?", so it must answer
// nothing. Owned cards keep their real tooltip.
check('every locked card hovers as exactly "Locked" (no teaser on hover)',
    forgeBody.includes(": 'Locked';") &&
    // The teaser must not be interpolated into a runtime title any more.
    !forgeBody.includes('Coming Soon: ${info.blurb}') &&
    !mainCode.includes("card.title = 'An unrecorded skin.';") &&
    // And nothing may re-assign card.title after the single rule above, or a
    // secret-only override creeps straight back in.
    count(mainCode, 'card.title =') === 1,
    `${count(mainCode, 'card.title =')} card.title assignment(s) — a second one could re-open the secret-only override`);
// The click handler is the OTHER half of the redaction. A `???` card that hides
// its name on the card, its status and its tooltip used to print "Not enough
// Arcane XP for Bloodseeker. 12,000 XP required." the instant it was clicked —
// because every toast interpolated `info.title` and `info.unlockPrice`
// unconditionally. A secret that leaks on click is not a secret.
check('clicking a secret card never names it or quotes its price in a toast',
    mainSrc.includes('const name = revealed ? info.title : \'???\';') &&
    // Scope the "no raw info.title" scan to the click handler ONLY. The bound is
    // the click block's own closing `});` — an earlier attempt used
    // `paintSkinPreview` as the end index, but that function is DEFINED BEFORE
    // the handler, so the slice came out empty and the check passed vacuously.
    // Bounding by "the next `skinCards.forEach`" is not enough either: there is
    // no later one, so the slice ran 27k chars into unrelated menus.
    (() => {
        const start = mainSrc.indexOf("card.addEventListener('click'");
        if (start < 0) return false;
        const end = mainSrc.indexOf('\n  });', start);
        if (end < 0) return false;
        const seg = mainSrc.slice(start, end);
        return seg.includes('${name}') && !/\$\{info\.title\}/.test(seg);
    })(),
    'the label/tooltip redaction is pointless if a click prints the real name');
check('the click refusal names the ROUTE (counter) rather than the XP price',
    mainSrc.includes('`${name} is not forged with XP.') &&
    mainSrc.includes('A hidden Discipline awaits — ${n}/${achDef.counter.goal}.') &&
    // A secret's refusal is BARE: just the `???` token, no sentence around it.
    // "Not enough Arcane XP for ???." used to claim the card IS XP-forgeable
    // (a hint), and the follow-up line then contradicted that claim while
    // spending a whole sentence on it. Neither may come back.
    (() => {
        // Strip LINE comments too: the bare-`???` branch carries an explanation
        // of why it is bare, and a regex that required `show(` immediately
        // after `else {` would trip over that prose.
        const a = mainSrc.indexOf('else if (revealed)');
        const b = mainSrc.indexOf('game.audio.playExplosion');
        if (a < 0 || b < 0) return false;
        const seg = mainSrc.slice(a, b).replace(/\/\/[^\n]*/g, '');
        return /else\s*\{\s*MagicalToast\.show\(name\);\s*\}/.test(seg);
    })() &&
    !mainSrc.includes('Some things are not forged at all.'),
    'owner decision 2026-09-26: Voidweaver gets the counter hint, ??? gets no hint at all');
// The showcase shows every skin at once, so the only interaction is CLICKING a
// card to equip it. There is no scroller, no arrow key handler and no dot strip
// left, and this guard keeps them from creeping back.
check('all three skins are visible at once, with no carousel chrome left over',
    // Every card is a DIRECT child of the row: nothing is a slide, nothing is
    // inside a scroller, and the nav/dot markup is gone.
    htmlSrc.includes('class="skin-showcase" id="character-skin-grid"') &&
    htmlSrc.includes('class="skin-showcase-row"') &&
    !htmlSrc.includes('carousel') &&
    !/data-carousel-step/.test(htmlSrc) &&
    !/class="carousel-nav/.test(htmlSrc) &&
    // The controller is gone too — not just its markup.
    !/setCarousel|carouselIndex|carouselViewport|carousel-slide/.test(mainSrc) &&
    // And so is the hover detector that had to be removed three times.
    !mainSrc.includes('const zoneFor = (x) =>') &&
    !/forgeCarousel\.addEventListener\('mousemove'/.test(mainSrc),
    'a carousel hides all but one of three skins and needs arrows, dots, a scroller and a scroll listener to maintain');
check('the EQUIPPED card is the enlarged, vertically-centred one',
    // The whole selection affordance. `.active` is toggled in updateForgeUI from
    // `game.stats.selectedCharacter`, so the big card always follows the
    // character the player actually has selected.
    mainSrc.includes("card.classList.toggle('active', equipped);") &&
    mainSrc.includes('const equipped = game.stats.selectedCharacter === id;') &&
    /\.skin-showcase \.skin-card\.active\s*\{[^}]*flex-basis:/.test(cssSrc) &&
    // `align-items: center` on the row is what pushes the two small cards onto
    // the big card's vertical midpoint, so it breaks out above and below them.
    /\.skin-showcase-row\s*\{[^}]*align-items:\s*center/.test(cssSrc),
    'without this the equipped skin is the same size as the two locked ones and nothing says which one you are playing');
check('the enlarged card does not squeeze its neighbours on a narrow window',
    // The 290px basis is more than half the row's width at small sizes, so a
    // media query has to drop back to three equal cards or the other two
    // collapse to slivers.
    /@media \(max-width: 720px\)/.test(cssSrc) &&
    /@media \(max-width: 720px\)[\s\S]*?\.skin-showcase \.skin-card\.active\s*\{[^}]*flex:\s*1 1 0/.test(cssSrc),
    'an oversized card on a 360px window leaves two unreadable slivers beside it');
check('the previews are painted once at boot and never re-baked',
    mainSrc.includes('skinCards.forEach(card => paintSkinPreview(') &&
    // Selecting a card repaints the FORGE STATE (classes, label, title) but must
    // not resize or redraw a canvas. Scope this to updateForgeUI's own BODY: an
    // unscoped scan reaches the card click handler further down, which is
    // allowed to call paintSkinPreviews() for a font-swap rebake.
    (() => {
        const start = mainSrc.indexOf('function updateForgeUI()');
        if (start < 0) return false;
        // Walk to the matching brace of the function body.
        let i = mainSrc.indexOf('{', start);
        let depth = 0;
        for (let j = i; j < mainSrc.length; j++) {
            if (mainSrc[j] === '{') depth++;
            else if (mainSrc[j] === '}' && --depth === 0) { i = j; break; }
        }
        return !/paintSkinPreview|skin-preview|\.width\s*=|\.height\s*=/.test(mainSrc.slice(start, i));
    })(),
    're-selecting a skin must not rebuild or resize a canvas per click');
check('the unlocked-unpicked state has its own CSS, distinct from .locked and .active',
    cssSrc.includes('.skin-card.available {') &&
    /\.skin-card\.available\s*\{[^}]*filter: none;/.test(cssSrc) &&
        /\.skin-card\.available\s*\{[^}]*opacity: 1;/.test(cssSrc) &&
        /\.skin-card\.available:hover\s*\{[^}]*filter: none;/.test(cssSrc));
check('the locked paint is unchanged: only an unowned card is desaturated',
    cssSrc.includes('.skin-card.locked {') &&
        /\.skin-card\.locked\s*\{[^}]*filter: grayscale/.test(cssSrc));

console.log('');
if (failures) {
    console.error(`${failures} skin-id check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-F16 Forge / skin-id checks passed.');
process.exit(0);

