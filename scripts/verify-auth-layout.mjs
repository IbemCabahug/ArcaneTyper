/**
 * Regression guard for Auth / Mage Recognition Popup & Cloudflare Turnstile Integration.
 *
 * Verifies:
 * 1. CSS layout rules for #character-creation-menu (.auth-card-shell, .auth-card, .auth-turnstile-container)
 * 2. CLS reservation: .auth-turnstile-container reserves min-height: 65px (standard Turnstile dimensions)
 * 3. No-clip invariant: #character-creation-menu has overflow-y: auto and justify-content: safe center
 * 4. DOM Hierarchy & traversal contracts expected by AuthUI.js:
 *    - cc-username-label.parentElement is the auth-field container
 *    - cc-password.parentElement.parentElement is the auth-field container
 *    - cc-password.parentElement is the auth-password-wrap
 * 5. All 18 functional element IDs are strictly preserved in index.html
 * 6. Responsive mobile/short media query exists for auth popup
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8').replace(/\r\n/g, '\n');

const css = read('frontend/style.css');
const html = read('frontend/index.html');

let failures = 0;
function check(name, condition, detail = '') {
    if (!condition) failures++;
    console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition || !detail ? '' : `  (${detail})`}`);
}

// ── 1. CSS Rules & Layout Invariants ──────────────────────────────────────────
check(
    '#character-creation-menu has overflow-y: auto',
    /#character-creation-menu\s*\{[^}]*overflow-y:\s*auto/s.test(css)
);
check(
    '#character-creation-menu has justify-content: safe center',
    /#character-creation-menu\s*\{[^}]*justify-content:\s*safe center/s.test(css)
);
check(
    '#character-creation-menu has gold custom scrollbar',
    css.includes('#character-creation-menu::-webkit-scrollbar-thumb')
);
check(
    '.auth-turnstile-container reserves min-height: 65px for Turnstile CLS prevention',
    /\.auth-turnstile-container\s*\{[^}]*min-height:\s*65px/s.test(css)
);
check(
    '.auth-card has max/min width constraint',
    /\.auth-card\s*\{[^}]*width:\s*min\(390px,\s*92vw\)/s.test(css)
);
check(
    'Responsive mobile/short media query exists for auth popup',
    css.includes('@media (max-height: 680px), (max-width: 400px)')
);

// ── 2. Element IDs in index.html ─────────────────────────────────────────────
const requiredIds = [
    'character-creation-menu',
    'cc-title',
    'cc-subtitle',
    'cc-username-label',
    'cc-username',
    'cc-email-container',
    'cc-email',
    'cc-nickname-container',
    'cc-name',
    'cc-password',
    'toggle-password-btn',
    'cc-turnstile',
    'cc-class-container',
    'cc-class',
    'cc-error-msg',
    'cc-create-btn',
    'cc-guest-btn',
    'cc-toggle-mode',
    'cc-guest-cancel-mode'
];

for (const id of requiredIds) {
    check(`index.html contains element id="${id}"`, html.includes(`id="${id}"`));
}

// ── 3. DOM Traversal Contracts Expected by AuthUI.js ─────────────────────────
// AuthUI relies on cc-username-label.parentElement
check(
    'cc-username-label parent is an auth-field container',
    /<div[^>]*class="auth-field"[^>]*>\s*<label id="cc-username-label"/s.test(html)
);

// AuthUI relies on cc-password.parentElement.parentElement
check(
    'cc-password is nested in auth-password-wrap inside auth-field',
    /<div[^>]*class="auth-field"[^>]*>\s*<label[^>]*>[^<]*<\/label>\s*<div[^>]*class="auth-password-wrap"[^>]*>\s*<input[^>]*id="cc-password"/s.test(html)
);

// Container element for turnstile has auth-turnstile-container class
check(
    'cc-turnstile has class="auth-turnstile-container"',
    /<div id="cc-turnstile" class="auth-turnstile-container"/s.test(html)
);

// Card shell container wraps title, card, and links
check(
    'auth-card-shell wraps auth components',
    html.includes('<div class="auth-card-shell">')
);

// ── 4. Absence of inline sizing spaghetti ────────────────────────────────────
// Ensure the inline styles on the card, title, input, and labels were cleaned up
check(
    'no inline style on cc-title',
    !/<h2 id="cc-title"[^>]*style=/s.test(html)
);
check(
    'no inline style on cc-username',
    !/<input[^>]*id="cc-username"[^>]*style=/s.test(html)
);
check(
    'no inline style on cc-password',
    !/<input[^>]*id="cc-password"[^>]*style=/s.test(html)
);

if (failures > 0) {
    console.error(`\n${failures} check(s) FAILED.`);
    process.exit(1);
} else {
    console.log('\nAll Auth & Turnstile layout checks passed successfully.');
}
