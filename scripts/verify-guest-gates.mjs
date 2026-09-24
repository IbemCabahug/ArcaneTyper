/**
 * Regression guard for AT-M9 — the guest gates that were dead code.
 *
 * Root cause, worth stating once: `main.js` decided "is this visitor a guest?"
 * with `let isGuest = false;`. Four guards read it (the Workshop, the Arena
 * lobby, AT-F16's Forge, and the profile label) and NOTHING ever assigned it, so
 * every one of those guards was dead code. A visitor with no account could walk
 * into the Workshop, wait in the Arena lobby, and forge a 12,000 XP character
 * out of local Arcane XP — the exact opposite of what each of those branches
 * says on screen. `Stats.isAuthenticated` (maintained by AuthUI on password
 * login, registration and session restore, cleared on guest entry) was always
 * the truth; the app kept a second copy of it and let that copy rot.
 *
 * What this locks:
 *   1. the dead flag is gone from main.js and NOTHING gates on a cached boolean
 *      again — the guest answer is derived from `Stats.isAuthenticated` at use
 *      time, because a cache is what went stale;
 *   2. the gate delegates to a shipped rule, `Stats.requiresMageCard()`, and all
 *      three entitlement menus call it (a count, so a fourth menu cannot quietly
 *      skip it);
 *   3. that rule is SLICED OUT OF the real `backend/Stats.js` and executed for
 *      all four input combinations: a guest on a configured deployment is
 *      prompted, a signed-in mage passes, and an offline sandbox (no backend) is
 *      not locked out of its own features;
 *   4. each named gate still prompts and returns BEFORE it can spend anything —
 *      the Forge's `purchaseCharacter` call sits after the guard, not before;
 *   5. the class of bug, not just the instance: every app-scope `let x = <literal>`
 *      in main.js must be read somewhere. Dead state is what a later reader
 *      trusts, and that is the whole story of this bug;
 *   6. the auth contract the gate leans on: Stats starts unauthenticated, AuthUI
 *      sets it true only on the three real sign-in paths and explicitly false on
 *      guest entry, and Bug #1B's restricted admin bypass still requires it;
 *   7. `verify:guests` is wired into `npm run verify`.
 *
 * Run:  node scripts/verify-guest-gates.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '');
/**
 * Drop whole-line `//` comments. The file's own bug history quotes the very code
 * these checks ban (the AT-M9 note quotes the dead flag verbatim), and a comment
 * is not a read, a declaration or a gate — so the checks below run on code only.
 */
const codeOnly = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const mainSrc = strip(read('frontend/main.js'));
const mainCode = codeOnly(mainSrc);
const statsSrc = strip(read('backend/Stats.js'));
const authUiSrc = strip(read('frontend/ui/AuthUI.js'));
const pkgSrc = read('package.json');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}
const count = (src, needle) => src.split(needle).length - 1;

// ── 1. the dead flag, gone ─────────────────────────────────────────────────
check(
    'main.js no longer declares a cached guest flag',
    !/let\s+isGuest\b/.test(mainCode) && count(mainCode, 'isGuest = false') === 0,
    'a cached auth boolean is what rotted'
);
check(
    'the guest answer is derived from Stats.isAuthenticated at use time',
    mainSrc.includes('const isGuest = () => !game.stats.isAuthenticated;')
);
check(
    'the gate delegates to the shipped rule (no inline second copy)',
    mainSrc.includes('const needsMageCard = () => game.stats.requiresMageCard(!!supabase);')
);
check(
    'no site gates on a bare flag any more',
    count(mainSrc, 'if (isGuest)') === 0 && count(mainSrc, "isGuest() ? 'Wandering Guest'") === 1
);

// ── 2. all three entitlement menus are guarded ─────────────────────────────
check(
    'exactly three gates call needsMageCard()',
    count(mainSrc, 'if (needsMageCard()) {') === 3,
    `found ${count(mainSrc, 'if (needsMageCard()) {')}`
);

const gates = [
    { name: 'Forge (AT-F16)', toast: 'The Forge needs a sealed Mage Card!', spend: 'game.stats.purchaseCharacter(id)' },
    { name: 'Workshop', toast: 'The Workshop requires a sealed Mage Card!', spend: 'game.stats.spendXP' },
    { name: 'Arena lobby', toast: 'The Arena requires a sealed Mage Card!', spend: null },
];
for (const gate of gates) {
    const at = mainSrc.indexOf(gate.toast);
    check(`the ${gate.name} gate exists`, at > 0 && count(mainSrc, gate.toast) === 1);

    // The guard must be the branch that owns this toast, and it must bail out.
    const before = mainSrc.slice(Math.max(0, at - 400), at);
    const guardAt = before.lastIndexOf('if (');
    const guard = guardAt < 0 ? '' : before.slice(guardAt).split('\n')[0];
    check(
        `the ${gate.name} gate is a needsMageCard() branch`,
        guard.includes('needsMageCard()'),
        `found: ${guard.trim()}`
    );
    const after = mainSrc.slice(at, at + 600);
    check(`the ${gate.name} gate prompts and returns`, /return;/.test(after));
    if (gate.spend) {
        check(
            `the ${gate.name} gate returns before it can spend`,
            !after.includes(gate.spend) || after.indexOf('return;') < after.indexOf(gate.spend)
        );
    }
}

// ── 3. the rule itself, executed from the shipped source ───────────────────
const ruleAt = statsSrc.indexOf('requiresMageCard(hasBackend) {');
const ruleEnd = statsSrc.indexOf('\n    }', ruleAt);
const ruleSrc = ruleAt < 0 ? '' : statsSrc.slice(ruleAt, ruleEnd + '\n    }'.length);
check('requiresMageCard is sliced out of the shipped Stats.js', ruleSrc.length > 0);

if (ruleSrc.length > 0) {
    // The slice is a method declaration, so wrap it in an object literal to make
    // it a value, then bind `this` per case (exactly how Stats calls it).
    const rule = new Function(`return { ${ruleSrc} };`)().requiresMageCard;
    const run = (isAuthenticated, hasBackend) => rule.call({ isAuthenticated }, hasBackend);
    check('a guest on a configured deployment is prompted (the bug)', run(false, true) === true);
    check('a signed-in mage passes', run(true, true) === false);
    check('an offline sandbox is not locked out (no account exists to sign in as)', run(false, false) === false);
    check('offline + authenticated still passes', run(true, false) === false);
}

// ── 4. the class of bug: dead state in the app scope ──────────────────────
// Every `let x = <literal>;` at the top of main.js's app scope must be read
// somewhere. `isGuest` failed this test for months without anyone noticing.
const declRe = /^ {2}(?:let|var) ([A-Za-z_$][\w$]*) = (?:null|false|true|0|''|"");$/gm;
const dead = [];
for (const m of mainCode.matchAll(declRe)) {
    const name = m[1];
    const uses = mainCode.split(new RegExp(`\\b${name}\\b`)).length - 1;
    if (uses < 2) dead.push(name);
}
check(
    'no app-scope declaration in main.js is write-only',
    dead.length === 0,
    dead.length ? `unread: ${dead.join(', ')}` : ''
);

// ── 5. the auth contract the gate leans on ────────────────────────────────
check(
    'Stats starts unauthenticated (guests are the default, never the fallback)',
    statsSrc.includes('this.isAuthenticated = false;')
);
check(
    'AuthUI flips it true on exactly the three real sign-in paths',
    count(authUiSrc, 'isAuthenticated = true') === 3,
    `found ${count(authUiSrc, 'isAuthenticated = true')}`
);
check(
    'AuthUI clears it on guest entry',
    authUiSrc.includes('this.game.stats.isAuthenticated = false;')
);
check(
    "Bug #1B's restricted admin bypass still requires authentication",
    /isAdmin\(\)\s*\{[\s\S]{0,300}!this\.isAuthenticated/.test(statsSrc)
);

// ── 6. the guard is wired in ──────────────────────────────────────────────
check(
    'verify:guests is a script and part of the chain',
    pkgSrc.includes('"verify:guests": "node scripts/verify-guest-gates.mjs"') &&
        pkgSrc.includes('&& npm run verify:guests')
);

console.log('');
if (failures) {
    console.error(`${failures} guest-gate check(s) FAILED.`);
    process.exit(1);
}
console.log('All AT-M9 guest-gate checks passed.');
process.exit(0);

