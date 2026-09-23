/**
 * Regression guard for AT-L8 — "registration Discipline never reaches gameplay"
 * (owner-scoped 2026-09-23, fixed in game `1f3bc25`).
 *
 * What was wrong: THREE rosters disagreed. Registration offered
 * Scholar/Pyromancer/Oracle and sent the pick as signUp metadata nothing ever
 * read back; the Mage Profile offered Novice/Pyromancer/Cryomancer/Chronomancer
 * into `Stats.setMageClass()` — which had no callers, because the profile
 * `<select>` had no `change` listener either; and the Workshop tree was only
 * *titled* with the registration names. Scholar and Oracle had no code effects
 * anywhere. So a class pick reached gameplay by no route at all.
 *
 * The fix this keeps in place:
 *   1. the roster module itself (behavioural: the real module is imported),
 *   2. both pickers built from it, with no hard-coded `<option>` left behind AND
 *      the profile picker's `change` listener (the actual missing piece),
 *   3. the Workshop tree: one branch per roster class, matching headers, and the
 *      RECORDED 12-node id + XP-cost baseline — a rebalance may move a node, it
 *      may never drop one (a lost id silently disables a skill the player paid
 *      for, and `CombatSystem.js` still spends `echo` for Nova's mana refund).
 * Run:  node scripts/verify-class-roster.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { MAGE_CLASSES, DEFAULT_MAGE_CLASS, isMageClass, normalizeMageClass, mageClassInfo } from '../backend/MageClasses.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const htmlSrc = read('frontend/index.html');
const cssSrc = read('frontend/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const mainSrc = read('frontend/main.js').replace(/\/\*[\s\S]*?\*\//g, '');
const authSrc = read('frontend/ui/AuthUI.js').replace(/\/\*[\s\S]*?\*\//g, '');
const profileSrc = read('frontend/ui/ProfileUI.js').replace(/\/\*[\s\S]*?\*\//g, '');
const statsSrc = read('backend/Stats.js').replace(/\/\*[\s\S]*?\*\//g, '');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

/** The element body between `marker`'s opening tag and the next `</tag>`. */
function elementBody(html, marker, tag) {
    const at = html.indexOf(marker);
    if (at < 0) return null;
    const end = html.indexOf(`</${tag}>`, at);
    return html.slice(html.indexOf('>', at) + 1, end);
}

/**
 * The 12 nodes that existed before the AT-L8 re-grouping, as branch → { id:
 * XP cost }. Verified byte-for-byte against the previous revision of
 * index.html; this is a fingerprint, not a wish list.
 */
const RECORDED_TREE = {
    Novice: { mana: 1000, greed: 7000, philosopher: 18000 },
    Pyromancer: { combo: 5000, burst: 3000, combustion: 15000 },
    Cryomancer: { life: 2500, vision: 4000, precognition: 25000 },
    Chronomancer: { clairvoyance: 10000, siphon: 12000, echo: 20000 }
};

// ── 1. the roster module (real import, real behaviour) ─────────────────────
const ids = MAGE_CLASSES.map((c) => c.id);
check(
    'the roster holds the owner\'s four Disciplines, in order',
    JSON.stringify(ids) === JSON.stringify(['Novice', 'Pyromancer', 'Cryomancer', 'Chronomancer']),
    ids.join(', ')
);
check(
    'every roster record is complete (title, tagline, colour, blurb)',
    MAGE_CLASSES.every((c) => c.title && c.tagline && /^#[0-9a-f]{6}$/i.test(c.color) && c.blurb)
);
check(
    'the retired registration classes normalise to the default',
    normalizeMageClass('Scholar') === DEFAULT_MAGE_CLASS && normalizeMageClass('Oracle') === DEFAULT_MAGE_CLASS,
    `${normalizeMageClass('Scholar')} / ${normalizeMageClass('Oracle')}`
);
check(
    'junk can never leave mageClass undefined (it would kill every class bonus)',
    ['', 'undefined', 'null', null, undefined, 42, {}].every((bad) => isMageClass(normalizeMageClass(bad)) === true)
);
check('mageClassInfo never returns undefined', mageClassInfo('nope').id === DEFAULT_MAGE_CLASS && mageClassInfo('Cryomancer').id === 'Cryomancer');

// ── 2. both pickers are built from the roster, and both now actually work ──
// Registration keeps ONE documented fallback option (wiped by AuthUI at init);
// the profile picker must carry no roster at all. A second list in markup is
// exactly how the registration picker drifted to Scholar/Pyromancer/Oracle.
{
    const regBody = elementBody(htmlSrc, 'id="cc-class"', 'select');
    const regOptions = [...(regBody || '').matchAll(/value="([A-Za-z]+)"/g)].map((m) => m[1]);
    check('registration has a picker in index.html', regBody !== null);
    check(
        'registration hard-codes at most a fallback, never a roster',
        regOptions.length <= 1 && regOptions.every((v) => v === DEFAULT_MAGE_CLASS),
        `static option value(s): ${regOptions.join(', ') || 'none'}`
    );
    check('AuthUI wipes the fallback before filling from the roster', authSrc.includes('this.ccClass.innerHTML = \'\';'));
}
{
    const profBody = elementBody(htmlSrc, 'id="mage-class-select"', 'select');
    check('the Mage Profile has a picker in index.html', profBody !== null);
    check(
        'the Mage Profile hard-codes no roster (options come from MageClasses.js)',
        profBody !== null && !profBody.includes('<option'),
        `${count(profBody || '', '<option')} static option(s) left`
    );
}
check(
    'AuthUI builds the registration options by iterating the roster',
    authSrc.includes("from '../../backend/MageClasses.js'") &&
        authSrc.includes('MAGE_CLASSES.forEach') && authSrc.includes('appendChild')
);
check(
    'the profile picker finally has a change listener (the AT-L8 root cause)',
    profileSrc.includes("from '../../backend/MageClasses.js'") &&
        profileSrc.includes('MAGE_CLASSES.forEach') &&
        /addEventListener\('change'/.test(profileSrc) &&
        profileSrc.includes('setMageClass(')
);
check(
    'a rejected/duplicate pick does not toast (setMageClass returns a boolean)',
    statsSrc.includes('if (next === this.mageClass) return false;') && statsSrc.includes('return true;')
);
check(
    'Stats validates on load and on save, against the roster',
    count(statsSrc, 'normalizeMageClass(') >= 3 && count(statsSrc, 'DEFAULT_MAGE_CLASS') >= 2,
    `${count(statsSrc, 'normalizeMageClass(')} normalise call(s)`
);
check(
    'the class a picker shows is re-read after a cloud load',
    profileSrc.includes('applyClassAccent()') && count(profileSrc, 'applyClassAccent()') >= 3
);

// ── 3. the Workshop tree matches the roster and the recorded node baseline ──
const branchChunks = htmlSrc.split('<div class="talent-branch"').slice(1);
check('the tree has one branch per Discipline', branchChunks.length === MAGE_CLASSES.length, `${branchChunks.length} branch(es)`);

const tree = {};
for (const chunk of branchChunks) {
    const cls = (chunk.match(/data-class="([A-Za-z]+)"/) || [])[1];
    const nodes = [...chunk.matchAll(/id="skill-([a-z-]+)-btn"[^>]*data-cost="(\d+)"/g)];
    if (cls) tree[cls] = Object.fromEntries(nodes.map((m) => [m[1], Number(m[2])]));
}
check('every branch names a canonical class', Object.keys(tree).every(isMageClass), Object.keys(tree).join(', '));
check('each branch head is an element for buildTalentTree() to fill', count(htmlSrc, 'class="talent-branch-head"') === MAGE_CLASSES.length);
check(
    'every branch holds three nodes',
    Object.values(tree).every((nodes) => Object.keys(nodes).length === 3),
    Object.entries(tree).map(([c, n]) => `${c}=${Object.keys(n).length}`).join(' ')
);

// Branch assignment is free to change (that IS the re-grouping); the id→cost
// fingerprint is not: a dropped id silently kills a skill the player paid for.
const fingerprint = (map) => Object.values(map).flatMap((nodes) => Object.entries(nodes)).sort().join('|');
const recorded = fingerprint(RECORDED_TREE);
const found = fingerprint(tree);
check(
    'the 12 recorded node ids survive at their recorded XP cost',
    recorded === found,
    recorded === found ? '' : `recorded ${recorded.split('|').length} pairs vs found ${found.split('|').length}`
);
check('echo is still a node (CombatSystem spends it for Nova\'s mana refund)', 'echo' in (tree.Chronomancer || {}));

// The doc's §11 table is the owner-facing version of the same tree.
let docSrc = null;
try {
    docSrc = read('docs/arcaneTyper-docs/game-design.md');
} catch {
    console.log('SKIP  docs repo not checked out — game-design.md §11 not cross-checked');
}
if (docSrc) {
    const docRows = [...docSrc.matchAll(/^\| (Novice|Pyromancer|Cryomancer|Chronomancer) \| [^|\n]*\(([a-z-]+)\) \| (\d+) \|/gm)]
        .map((m) => `${m[1]}:${m[2]}:${m[3]}`)
        .sort()
        .join('|');
    const markupRows = Object.keys(tree)
        .flatMap((cls) => Object.keys(tree[cls]).map((id) => `${cls}:${id}:${tree[cls][id]}`))
        .sort()
        .join('|');
    check('game-design.md §11 lists exactly this tree', docRows === markupRows, docRows === markupRows ? '' : 'doc table drifted from index.html');
}

// ── 4. the tree is painted from the roster, at a safe point in startup ─────
check('buildTalentTree is defined once', count(mainSrc, 'function buildTalentTree(') === 1);
check(
    'the tree re-paints on every workshop open and once at startup',
    count(mainSrc, 'buildTalentTree();') === 2 &&
        mainSrc.includes('updateWorkshopUI()') &&
        mainSrc.slice(mainSrc.indexOf('function updateWorkshopUI(')).includes('buildTalentTree();')
);
const startupPaint = mainSrc.lastIndexOf('  buildTalentTree();');
check(
    'the startup paint runs after the game (bound class) and after the branch query (no TDZ)',
    startupPaint > mainSrc.indexOf('new Game(') && startupPaint > mainSrc.indexOf('const talentBranches ='),
    `call@${startupPaint} game@${mainSrc.indexOf('new Game(')} branches@${mainSrc.indexOf('const talentBranches =')}`
);
check(
    'the headers are written from the roster (accent, tagline, blurb, bound mark)',
    mainSrc.includes('--branch-accent') && mainSrc.includes('--branch-glow') &&
        mainSrc.includes("classList.toggle('bound'") && mainSrc.includes('branch.title = info.blurb')
);
check(
    'the CSS consumes the per-class accent/glow and styles the bound branch',
    cssSrc.includes('var(--branch-accent') && cssSrc.includes('var(--branch-glow') &&
        cssSrc.includes('.talent-branch.bound .talent-branch-head') && cssSrc.includes('.talent-branch-title')
);

// ── summary ────────────────────────────────────────────────────────────────
console.log('');
if (failures) {
    console.error(`${failures} AT-L8 roster/tree check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-L8 roster and workshop-tree checks passed.');
