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

import { MAGE_CLASSES, DEFAULT_MAGE_CLASS, isMageClass, normalizeMageClass, mageClassInfo, classesForCharacter, isMageClassForCharacter, normalizeMageClassForCharacter, DISCIPLINE_SWITCH_COST, disciplineScrollId, scrollCostFor } from '../backend/MageClasses.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
/** Drop whole-line `//` comments, so a note quoting the old code cannot satisfy a check. */
const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
const htmlSrc = read('frontend/index.html');
const cssSrc = read('frontend/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
const mainSrc = read('frontend/main.js').replace(/\/\*[\s\S]*?\*\//g, '');
const mainCode = codeOnly(mainSrc);
const authSrc = read('frontend/ui/AuthUI.js').replace(/\/\*[\s\S]*?\*\//g, '');
const profileSrc = read('frontend/ui/ProfileUI.js').replace(/\/\*[\s\S]*?\*\//g, '');
const profileCode = codeOnly(profileSrc);
const statsSrc = read('backend/Stats.js').replace(/\/\*[\s\S]*?\*\//g, '');
const statsCode = codeOnly(statsSrc);

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
 * The 12 nodes, as branch → { id: XP cost }.
 *
 * ── REBALANCED 2026-09-26 (deliberate) ──────────────────────────────────────
 * The original values were a FINGERPRINT, not a target: the old set ran
 * 1,000–25,000 XP, which at the modelled median income (~40,968 XP/hour) is
 * 1 MINUTE to 37 minutes — the cheapest node cost less than one boss fight.
 *
 * The pricing problem inside it was `greed`: +25% XP, permanently, and XP buys
 * the 60,000 XP Discipline scrolls. Earning back its own 7,000 XP took 212,000 XP
 * of base income — 5.2 hours — while it was priced as the 5th CHEAPEST node at
 * 10 minutes. The most economically valuable node was the second cheapest thing
 * to buy.
 *
 * The tree is now priced in median-MINUTES by measured play impact, and the two
 * ECONOMY nodes are priced against the income they generate rather than against
 * their description. New band: 15,000–120,000 XP = 22 to 176 minutes, an 8x
 * spread. A 60,000 XP scroll (88 min) lands mid-ladder at `siphon`, so scrolls
 * compete with the tree rather than dwarfing or hiding it.
 *
 * The ids are unchanged and every one is still live in code — a node may be
 * repriced, it may never be DROPPED (a lost id silently disables a skill the
 * player paid for, and `CombatSystem.js` still spends `echo` for Nova's mana
 * refund). The checks below assert both.
 */
const RECORDED_TREE = {
    Novice: { mana: 15000, greed: 100000, philosopher: 40000 },
    Pyromancer: { combo: 20000, burst: 30000, combustion: 70000 },
    Cryomancer: { life: 25000, vision: 35000, precognition: 120000 },
    Chronomancer: { clairvoyance: 50000, siphon: 60000, echo: 80000 }
};

/** The pre-rebalance costs, kept so a revert is deliberate and reviewable. */
const PRE_REBALANCE_TREE = {
    Novice: { mana: 1000, greed: 7000, philosopher: 18000 },
    Pyromancer: { combo: 5000, burst: 3000, combustion: 15000 },
    Cryomancer: { life: 2500, vision: 4000, precognition: 25000 },
    Chronomancer: { clairvoyance: 10000, siphon: 12000, echo: 20000 }
};

// ── 1. the roster module (real import, real behaviour) ─────────────────────
const ids = MAGE_CLASSES.map((c) => c.id);
check(
    'the roster holds three character families with one shared Novice',
    ids.length === 10 && ids.filter((id) => id === 'Novice').length === 1 &&
        ['wizard', 'voidweaver', 'bloodseeker'].every((character) => classesForCharacter(character).length === 4),
    ids.join(', ')
);
check('the character families expose Novice plus three unique Disciplines',
    JSON.stringify(classesForCharacter('wizard').map((c) => c.id)) === JSON.stringify(['Novice', 'Pyromancer', 'Cryomancer', 'Chronomancer']) &&
        JSON.stringify(classesForCharacter('voidweaver').map((c) => c.id)) === JSON.stringify(['Novice', 'Singulist', 'Nullwarden', 'Riftbinder']) &&
        JSON.stringify(classesForCharacter('bloodseeker').map((c) => c.id)) === JSON.stringify(['Novice', 'Hemomancer', 'Reaper', 'Bloodruner']));
check('every Discipline is assigned to at least one character and active',
    MAGE_CLASSES.every((c) => c.characters?.length > 0 && c.active));
check('an incompatible class falls back to the character Novice',
    normalizeMageClassForCharacter('Pyromancer', 'voidweaver') === 'Novice' &&
        normalizeMageClassForCharacter('Reaper', 'wizard') === 'Novice' &&
        isMageClassForCharacter('Hemomancer', 'bloodseeker'));
check('the retired Bloodseeker Discipline migrates to Hemomancer on a Bloodseeker character',
    normalizeMageClassForCharacter('Bloodseeker', 'bloodseeker') === 'Hemomancer' &&
        normalizeMageClassForCharacter('Bloodseeker', 'wizard') === 'Novice');
check(
    'the new class families keep their shared Novice, unique actives and characters',
    MAGE_CLASSES.filter((c) => c.characters.includes('voidweaver')).map((c) => c.active.id).join('|') === 'arcane-surge|crushing-gravity|event-horizon|rift-tether' &&
        MAGE_CLASSES.filter((c) => c.characters.includes('bloodseeker')).map((c) => c.active.id).join('|') === 'arcane-surge|blood-pact|final-cut|bloodletting'
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
        authSrc.includes("classesForCharacter('wizard').forEach") && authSrc.includes('appendChild')
);
check(
    'the profile picker finally has a change listener (the AT-L8 root cause)',
    profileSrc.includes("from '../../backend/MageClasses.js'") &&
        profileSrc.includes('classesForCharacter(this.game.stats.selectedCharacter).forEach') &&
        /addEventListener\('change'/.test(profileSrc) &&
        profileSrc.includes('setMageClass(')
);
check(
    'a rejected/duplicate pick does not toast (setMageClass returns a boolean)',
    statsSrc.includes('if (!isMageClassForCharacter(chosen, this.selectedCharacter) || chosen === this.mageClass) return false;') && statsSrc.includes('return true;')
);
check(
    'Stats validates on load and on save, against the roster',
    count(statsSrc, 'normalizeMageClassForCharacter(') >= 3 && count(statsSrc, 'DEFAULT_MAGE_CLASS') >= 2,
    `${count(statsSrc, 'normalizeMageClassForCharacter(')} normalise-for-character call(s)`
);
check(
    'the class a picker shows is re-read after a cloud load',
    profileSrc.includes('applyClassAccent()') && count(profileSrc, 'applyClassAccent()') >= 3
);

// ── 2c. every Discipline paints in ITS OWN colour (owner report 2026-09-26) ──
// The symptom: with the Wizard equipped the three classes first looked the same
// colour, and picking Pyromancer turned Cryomancer and Chronomancer orange too.
//
// The roster was never at fault — Pyro/Cryo/Chrono have carried distinct
// hexes all along. The <option> elements were simply never given a colour, so
// each one INHERITED `color` from the parent <select> — and `applyClassAccent`
// paints that parent with the SELECTED class. Hence: all green on Novice, all
// orange on Pyromancer. The single-class families hid the bug because one
// colour looks like a design choice.
{
    const wizardColours = classesForCharacter('wizard').map((c) => c.color);
    check(
        'the Wizard family really does have three DISTINCT roster colours (the bug was in the UI, not the data)',
        new Set(wizardColours).size === wizardColours.length,
        `${wizardColours.join(' ')}`
    );
    // Both pickers must set the colour per option. Asserting on the comment-stripped
    // source keeps this about behaviour rather than prose.
    check(
        'the profile picker colours each OPTION from the roster (so a pick cannot repaint its siblings)',
        (profileSrc.match(/opt\.style\.color = cls\.color;/g) || []).length === 1
    );
    check(
        'the registration picker colours each OPTION from the roster too',
        (authSrc.match(/opt\.style\.color = cls\.color;/g) || []).length === 1
    );
}

// ── 2b. the Discipline survives a CHARACTER SWITCH (AT-F16) ─────────────────
// The bug this guards: each character owns a disjoint class family, so
// `setSelectedCharacter` used to normalise the single `mageClass` against the
// incoming character. Wizard/Pyromancer → Voidweaver forced 'Novice', and
// switching BACK could not restore Pyromancer because it had already been
// destroyed. The player re-picked their Discipline on every skin change.
//
// This runs the REAL Stats class against a localStorage stub, so it exercises
// the actual persistence path rather than asserting on source text.
{
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    // `Stats.bindDOM()` runs in the constructor and caches HUD elements. They are
    // irrelevant to the class logic, and every read is already null-guarded
    // downstream, so a stub that always misses is enough to construct an instance.
    globalThis.document = { getElementById: () => null };
    const { Stats } = await import('../backend/Stats.js');
    const s = new Stats({ definitions: {}, unlocked: new Set(), onUnlockCallback: () => {} });

    // Own the whole roster so the equip guard lets both characters through.
    s.unlockedCharacters = ['wizard', 'voidweaver', 'bloodseeker'];
    // Owner decision 2026-09-26: binding is gated behind scrolls, so this test
    // has to EARN its picks now. Buying through the real API (rather than poking
    // `unlockedSkills`) means this block also exercises the purchase path.
    //
    // Each scroll is bought while its OWN character is equipped, because
    // `buyDisciplineScroll` refuses a class that does not belong to the
    // currently equipped character. Singulist is a Voidweaver Discipline, so it
    // cannot be bought here — it has to wait until the switch below.
    s._totalXP = 999999;
    s.buyDisciplineScroll('Pyromancer');

    s.setMageClass('Pyromancer');
    s.setSelectedCharacter('voidweaver');
    s.buyDisciplineScroll('Singulist');
    const onVoidweaver = s.mageClass;
    s.setMageClass('Singulist');
    s.setSelectedCharacter('wizard');
    const backOnWizard = s.mageClass;
    // And a second round trip, to prove it is a memory and not a fluke.
    s.setSelectedCharacter('voidweaver');
    const secondVoidweaver = s.mageClass;

    check(
        'switching character no longer RESETS the Discipline (it is remembered per character)',
        onVoidweaver === 'Novice' &&          // Pyromancer is not a Voidweaver class
            backOnWizard === 'Pyromancer' &&  // …and comes back on the Wizard
            secondVoidweaver === 'Singulist', // …and the Voidweaver kept its own pick
        `voidweaver=${onVoidweaver} wizard=${backOnWizard} voidweaver2=${secondVoidweaver}`
    );
    check(
        'the per-character class memory is persisted and purged with the account',
        statsSrc.includes("'typerMaster_classByCharacter'") &&
            statsSrc.includes("localStorage.setItem('typerMaster_classByCharacter'") &&
            count(statsSrc, '_rememberClassFor(') >= 3,
        'the map must survive a reload and a logout'
    );
    check(
        'setSelectedCharacter banks the outgoing class instead of overwriting it',
        statsSrc.includes('this._rememberClassFor(this.selectedCharacter, this.mageClass);') &&
            statsSrc.includes('this.mageClass = this._classFor(id);') &&
            // The old line, which flattened the pick, must be gone from it.
            !/setSelectedCharacter\(characterId\)\s*\{[\s\S]{0,600}?this\.mageClass = normalizeMageClassForCharacter/.test(statsSrc),
        'normalising the outgoing class against the INCOMING character is what destroyed it'
    );
}

// ── 3. the Workshop tree matches the roster and the recorded node baseline ──
const WORKSHOP_DISCIPLINES = MAGE_CLASSES.filter((c) => c.workshop !== false);
const WORKSHOP_BRANCH_COUNT = WORKSHOP_DISCIPLINES.length;
const branchChunks = htmlSrc.split('<div class="talent-branch"').slice(1);
check('the tree has one branch per Workshop Discipline', branchChunks.length === WORKSHOP_BRANCH_COUNT, `${branchChunks.length} branch(es) for ${WORKSHOP_BRANCH_COUNT} Workshop Discipline(s)`);

const tree = {};
for (const chunk of branchChunks) {
    const cls = (chunk.match(/data-class="([A-Za-z]+)"/) || [])[1];
    const nodes = [...chunk.matchAll(/id="skill-([a-z-]+)-btn"[^>]*data-cost="(\d+)"/g)];
    if (cls) tree[cls] = Object.fromEntries(nodes.map((m) => [m[1], Number(m[2])]));
}
check('every branch names a canonical class', Object.keys(tree).every(isMageClass), Object.keys(tree).join(', '));
check('each branch head is an element for buildTalentTree() to fill', count(htmlSrc, 'class="talent-branch-head"') === WORKSHOP_BRANCH_COUNT);
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
    'the four Workshop branches preserve the recorded node ids and costs',
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

// ── 2d. the scroll GATE on class selection (owner decision 2026-09-26) ─────
// The Wizard could bind any Discipline for free. A Discipline now costs a
// one-time scroll bought in the Workshop; owning a scroll lets you bind it
// forever, but each CHANGE costs a surcharge — without it, the optimal play is
// to buy every scroll once and then hop freely, which deletes the tree.
check(
    'every Discipline has a scroll price, and only Novice is free',
    MAGE_CLASSES.every((c) => Number.isFinite(c.scroll)) &&
        MAGE_CLASSES.filter((c) => c.scroll === 0).length === 1 &&
        scrollCostFor(DEFAULT_MAGE_CLASS) === 0,
    MAGE_CLASSES.map((c) => `${c.id}=${c.scroll}`).join(' ')
);
check(
    'a free Discipline exists in every character family (a fresh account has a legal first pick)',
    ['wizard', 'voidweaver', 'bloodseeker'].every((ch) =>
        classesForCharacter(ch).some((c) => scrollCostFor(c.id) === 0))
);
check(
    'the switch surcharge is strictly cheaper than a scroll (it taxes hopping, not choosing)',
    DISCIPLINE_SWITCH_COST > 0 &&
        MAGE_CLASSES.filter((c) => c.scroll > 0).every((c) => c.scroll > DISCIPLINE_SWITCH_COST),
    `surcharge=${DISCIPLINE_SWITCH_COST}`
);
// ── the economy must stay MEANINGFUL, not merely well-formed ────────────────
// The check above is satisfiable by any positive numbers, and that is exactly
// how the economy went wrong on 2026-09-26: at 8,000 XP a scroll cost the
// modelled median player 12 MINUTES and a 1,000 XP switch cost about 1 MINUTE.
// Both passed every structural check while being worth nothing in play.
//
// XP is floor(score * 0.1) and score carries a combo multiplier up to 10.0, so
// income is sharply skill-dependent. These bounds are pinned to the MODELLED
// median and are why the prices are 60,000 and 8,000. If income ever changes,
// update these with the constants — they exist to make that coupling impossible
// to miss.
//
// The arithmetic this constant encodes, because I got it wrong the first time:
// the model measured ~3,414 XP per 5-MINUTE run, and an hour holds TWELVE of
// them, so the median is ~40,968 XP/HOUR. A first version wrote 410 — off by
// 100x — so an 8,000 XP scroll computed as 19 HOURS and every price ever tried
// passed. The tell was that reverting to the old 8,000 did not fail this check.
// Thresholds below are stated in hours and divided, so the unit lives in one
// place rather than being re-derived per line.
const MEDIAN_XP_PER_HOUR = 3414 * 12;   // modelled median; see DISCIPLINE_SWITCH_COST
const paidScrolls = MAGE_CLASSES.filter((c) => c.scroll > 0);
const cheapestScroll = Math.min(...paidScrolls.map((c) => c.scroll));
const scrollHours = cheapestScroll / MEDIAN_XP_PER_HOUR;
const switchHours = DISCIPLINE_SWITCH_COST / MEDIAN_XP_PER_HOUR;
check(
    'a scroll is a real commitment at the modelled median (>= 45 minutes)',
    scrollHours >= 0.75,
    `cheapest scroll ${cheapestScroll} XP = ${(scrollHours * 60).toFixed(0)} min — under 45 means the gate is a rounding error`
);
check(
    'a switch actually taxes something at the median (>= 10 minutes)',
    switchHours >= 10 / 60,
    `${DISCIPLINE_SWITCH_COST} XP = ${(switchHours * 60).toFixed(1)} min — a tax this cheap lets a scroll-holder hop freely`
);
check(
    'the switch stays a fraction of a scroll (>= 5x cheaper) so choice is never blocked',
    cheapestScroll >= DISCIPLINE_SWITCH_COST * 5,
    `scroll ${cheapestScroll} vs switch ${DISCIPLINE_SWITCH_COST} — the ratio decides whether switching is viable`
);
check(
    'the switch is neither noise nor a wall (5%-50% of a scroll)',
    DISCIPLINE_SWITCH_COST >= cheapestScroll * 0.05 && DISCIPLINE_SWITCH_COST <= cheapestScroll * 0.5,
    `${DISCIPLINE_SWITCH_COST} is outside 5-50% of a ${cheapestScroll} XP scroll`
);


// ── the talent tree, by the same median-minute yardstick ─────────────────────
// Repriced 2026-09-26. The old tree spanned 1 minute to 37 minutes of median
// income, and its `greed` node — +25% XP permanently, in a game where XP buys
// 60,000-XP scrolls — was priced as the 5th CHEAPEST node while taking 5.2
// hours of income to earn back. These guards stop the tree quietly compressing
// into irrelevance again, and stop the ECONOMY nodes drifting back under-priced.
const allNodeCosts = Object.values(RECORDED_TREE).flatMap((b) => Object.values(b));
const cheapestNode = Math.min(...allNodeCosts);
const dearestNode = Math.max(...allNodeCosts);
const nodeMinutes = (xp) => (xp / MEDIAN_XP_PER_HOUR * 60).toFixed(0);
check(
    'the cheapest node is still a reachable goal (>= 15 minutes at the median)',
    cheapestNode / MEDIAN_XP_PER_HOUR >= 15 / 60,
    `${cheapestNode} XP = ${nodeMinutes(cheapestNode)} min`
);
check(
    'the dearest node is a real milestone (>= 2 hours at the median)',
    dearestNode / MEDIAN_XP_PER_HOUR >= 2,
    `${dearestNode} XP = ${nodeMinutes(dearestNode)} min — the top of the tree is a rounding error`
);
check(
    'the tree has a real price gradient (dearest >= 4x cheapest)',
    dearestNode >= cheapestNode * 4,
    `${cheapestNode} -> ${dearestNode} is a ${(dearestNode / cheapestNode).toFixed(1)}x spread`
);
check(
    'greed is no longer one of the cheapest nodes — it multiplies the whole economy',
    RECORDED_TREE.Novice.greed >= dearestNode * 0.5,
    `greed ${RECORDED_TREE.Novice.greed} vs dearest ${dearestNode} — a permanent +25% XP is not a cheap node`
);
check(
    'a Discipline scroll competes with the tree rather than dwarfing it',
    cheapestScroll >= cheapestNode && cheapestScroll <= dearestNode,
    `cheapest scroll ${cheapestScroll} vs tree ${cheapestNode}-${dearestNode}`
);
check(
    'no two nodes share a price (a tie reads as coincidence, not decision)',
    new Set(allNodeCosts).size === allNodeCosts.length,
    allNodeCosts.join(','));
check(
    'the whole tree is a long tail, not a single afternoon',
    allNodeCosts.reduce((a, b) => a + b, 0) / MEDIAN_XP_PER_HOUR >= 8,
    `total ${(allNodeCosts.reduce((a, b) => a + b, 0) / MEDIAN_XP_PER_HOUR).toFixed(1)} h at the median`
);
check(
    'the pre-rebalance costs are retained so a revert is deliberate',
    PRE_REBALANCE_TREE.Novice.mana === 1000 && PRE_REBALANCE_TREE.Cryomancer.precognition === 25000,
    'PRE_REBALANCE_TREE was edited instead of left as history');

check(
    'scroll ids are namespaced so they can never collide with a skill id',
        !MAGE_CLASSES.some((c) => c.active.id === disciplineScrollId(c.id)) &&
        disciplineScrollId('nope') === `discipline-scroll:${DEFAULT_MAGE_CLASS}`
);
check(
    'setMageClass is gated on the scroll AND charges the surcharge',
    statsCode.includes("this.lastClassRefusal = 'no-scroll';") &&
        statsCode.includes("this.lastClassRefusal = 'insufficient-xp';") &&
        statsCode.includes('if (!this.spendXP(DISCIPLINE_SWITCH_COST)) {')
);
check(
    'a scroll is SPENT before it is granted (never the other way round)',
    statsCode.indexOf('if (!this.spendXP(scrollCostFor(canonical))) return false;') <
        statsCode.indexOf('this.unlockedSkills.push(disciplineScrollId(canonical));')
);
check(
    'a pre-gate account keeps its Discipline — the migration grants the scroll for free',
    statsCode.includes('this._grantLegacyDisciplineScrolls();') &&
        statsCode.includes('for (const claim of [this.mageClass, ...Object.values(this.classByCharacter || {})])')
);
check(
    'the Workshop is where a scroll is actually bought, from the same roster',
    mainCode.includes('game.stats.buyDisciplineScroll(id)') &&
        mainCode.includes('classesForCharacter(game.stats.selectedCharacter).forEach') &&
        htmlSrc.includes('id="discipline-scroll-list"')
);
check(
    'the profile picker states the price instead of failing silently',
    profileCode.includes('scrollCostFor(cls.id).toLocaleString') &&
        profileCode.includes("lastClassRefusal === 'no-scroll'")
);

// ── 2e. the gate's ECONOMY, executed (owner decision 2026-09-26) ───────────
// The checks above prove the rules are WIRED. These run the real Stats against
// a localStorage stub and assert the money actually moves correctly — the class
// of bug a source scan cannot see is "the surcharge is charged but the scroll
// is granted anyway", and that would silently hand out free Disciplines.
{
    const store = new Map();
    globalThis.localStorage = {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k)
    };
    globalThis.document = { getElementById: () => null };
    const { Stats } = await import('../backend/Stats.js');

    const fresh = () => {
        store.clear();
        const s = new Stats({ definitions: {}, unlocked: new Set(), onUnlockCallback: () => {} });
        s._totalXP = 0;
        s.isAuthenticated = false;
        s.mageName = null;   // never let the isAdmin() bypass satisfy a gate
        return s;
    };

    const pyroScroll = scrollCostFor('Pyromancer');

    // 1. The gate holds: no scroll, no bind — and NO XP is spent trying.
    let s = fresh();
    s._totalXP = pyroScroll;                    // can afford the scroll exactly
    check(
        'a Discipline with no scroll cannot be bound, and the attempt costs nothing',
        s.setMageClass('Pyromancer') === false &&
            s.lastClassRefusal === 'no-scroll' &&
            s.mageClass === 'Novice' &&
            s.totalXP === pyroScroll,
        `refusal=${s.lastClassRefusal} class=${s.mageClass} xp=${s.totalXP}`
    );

    // 2. Novice is free, so a fresh account always has a legal first pick.
    s = fresh();
    check(
        'the free Discipline is always bindable',
        s.ownsDiscipline('Novice') && scrollCostFor('Novice') === 0
    );

    // 3. Buying spends exactly the scroll price, once, and is idempotent.
    s = fresh();
    s._totalXP = pyroScroll * 2;
    const bought = s.buyDisciplineScroll('Pyromancer');
    const afterBuy = s.totalXP;
    const rebought = s.buyDisciplineScroll('Pyromancer');
    check(
        'buying a scroll costs exactly its price, once',
        bought === true && afterBuy === pyroScroll && rebought === false && s.totalXP === afterBuy,
        `bought=${bought} afterBuy=${afterBuy} rebought=${rebought} xp=${s.totalXP}`
    );

    // 4. Binding an OWNED scroll works, and charges the surcharge exactly once.
    s = fresh();
    s._totalXP = pyroScroll + DISCIPLINE_SWITCH_COST;
    s.buyDisciplineScroll('Pyromancer');
    const beforeBind = s.totalXP;
    const bound = s.setMageClass('Pyromancer');
    check(
        'binding an owned scroll costs the surcharge exactly once',
        bound === true && s.mageClass === 'Pyromancer' &&
            beforeBind - s.totalXP === DISCIPLINE_SWITCH_COST,
        `bound=${bound} spent=${beforeBind - s.totalXP} (want ${DISCIPLINE_SWITCH_COST})`
    );

    // 5. A scroll is per character family: a Wizard cannot buy a Voidweaver scroll.
    s = fresh();
    s.unlockedCharacters = ['wizard', 'voidweaver', 'bloodseeker'];
    s._totalXP = 999999;
    check(
        'a scroll can only be bought for the equipped character\'s family',
        s.buyDisciplineScroll('Singulist') === false && !s.ownsDiscipline('Singulist')
    );

    // 6. A broke mage cannot switch, and KEEPS the class it already had. Both
    //    scrolls are owned first, so this is a pure "cannot afford the hop" case —
    //    a refusal that quietly dropped the bound class would be worse than the bug.
    s = fresh();
    s._totalXP = pyroScroll * 2 + DISCIPLINE_SWITCH_COST * 2;
    s.buyDisciplineScroll('Pyromancer');
    s.buyDisciplineScroll('Cryomancer');
    s.setMageClass('Pyromancer');
    s._totalXP = DISCIPLINE_SWITCH_COST - 1;   // one XP short
    const broke = s.setMageClass('Cryomancer');
    check(
        'a mage who cannot pay the surcharge cannot switch, and keeps their class',
        broke === false && s.mageClass === 'Pyromancer' &&
            s.lastClassRefusal === 'insufficient-xp',
        `class=${s.mageClass} refusal=${s.lastClassRefusal}`
    );

    // 7. THE MIGRATION: an account that bound Pyromancer BEFORE the gate keeps it,
    //    and is not charged or taxed to keep it.
    {
        const m = new Map();
        globalThis.localStorage = {
            getItem: (k) => (m.has(k) ? m.get(k) : null),
            setItem: (k, v) => m.set(k, String(v)),
            removeItem: (k) => m.delete(k)
        };
        m.set('typerMaster_mageClass', 'Pyromancer');
        m.set('typerMaster_xp', '12345');
        const legacy = new Stats({ definitions: {}, unlocked: new Set(), onUnlockCallback: () => {} });
        check(
            'a pre-gate account keeps its Discipline (and its XP) on reload',
            legacy.mageClass === 'Pyromancer' &&
                legacy.ownsDiscipline('Pyromancer') &&
                legacy.totalXP === 12345,
            `class=${legacy.mageClass} xp=${legacy.totalXP}`
        );
    }
}

// ── summary ────────────────────────────────────────────────────────────────
console.log('');
if (failures) {
    console.error(`${failures} AT-L8 roster/tree check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-L8 roster and workshop-tree checks passed.');
