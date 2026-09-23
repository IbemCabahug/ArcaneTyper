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
 *   3. the retired spelling appears in NO game source (index/style/main/Stats/…)
 *      — the guard may name it, the game may not;
 *   4. the unlock gate still says no: `isCharacterUnlocked` is sliced out of the
 *      REAL Stats source and executed — 'bloodseeker' must come back false for a
 *      normal player (wizard free, admin excepted), i.e. the rename did not
 *      sneak past the gate;
 *   5. the docs agree (AT-F16 marked RESOLVED, the Meta-progression row and the
 *      teaser list say Bloodseeker, the "name has to settle" phrasing is gone);
 *   6. `verify:skins` is wired into `npm run verify`.
 * Run:  node scripts/verify-skin-ids.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

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
    'backend/Stats.js', 'backend/Duel.js', 'backend/MageClasses.js', 'backend/Leaderboard.js'
];
const infested = gameSources.filter((p) => new RegExp(OLD_ID, 'i').test(strip(read(p))));
check('no game source still carries the retired id', infested.length === 0, infested.join(', '));
check(
    'no CSS selector references either retired id',
    !new RegExp('#' + OLD_ID, 'i').test(cssSrc) && !/skin-(runeseeker)/i.test(cssSrc)
);

// ── 4. the unlock gate, executed from the REAL Stats source ────────────────
/** A class method body WITH its closing brace, so `new Function` can take it. */
function classMethodBody(src, name) {
    const at = src.indexOf(`\n    ${name}(`);
    if (at < 0) return '';
    const end = src.indexOf('\n    }\n', at);
    if (end < 0) return '';
    return src.slice(at, end + '\n    }'.length);
}
const unlockSrc = classMethodBody(statsSrc, 'isCharacterUnlocked');
check('the unlock gate is sliced out of the shipped Stats.js', unlockSrc.length > 0);
let isUnlocked = () => { throw new Error('not built'); };
try {
    // The slice is a bare class member (`isCharacterUnlocked(charId) {...}`);
    // `new Function` needs a declaration, so the `function` keyword is restored.
    const asDeclaration = 'function ' + unlockSrc.trimStart();
    isUnlocked = new Function(`${asDeclaration}\nreturn isCharacterUnlocked;`)();
} catch (e) {
    check('the gate compiles as-is', false, `${e.message} :: ${unlockSrc.slice(0, 60)}`);
}
const asPlayer = { isAdmin: () => false };
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
    'the id has a home when it unlocks: the persistence key and setter exist',
    statsSrc.includes("'typerMaster_selectedCharacter'") &&
        statsSrc.includes('setSelectedCharacter(characterId)')
);

// ── 5. the docs agree (SKIP when the docs repo is not checked out) ────────
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

// ── 6. the guard is wired in ───────────────────────────────────────────────
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
console.log('All AT-F16 skin-id / Bloodseeker-rename checks passed.');
process.exit(0);

