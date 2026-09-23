/**
 * MageClasses.js — the ONE source of truth for mage Disciplines (AT-L8).
 *
 * Owner decision 2026-09-23: four classes — **Novice** (default), **Pyromancer**,
 * **Cryomancer**, **Chronomancer** — used by the registration picker, the Mage
 * Profile picker, the Workshop tree and (AT-F10) the per-class PvP active.
 *
 * Why this file exists: the roster used to live in three places that disagreed
 * (registration offered Scholar/Pyromancer/Oracle, the Mage Profile offered
 * Novice/Pyromancer/Cryomancer/Chronomancer, the Workshop tree was *titled* with
 * the registration set), and NO route actually applied the pick — registration
 * sent it as signUp metadata nothing read back, and the profile `<select>` had
 * no change listener, so `Stats.setMageClass()` had zero callers and `mageClass`
 * stayed 'Novice' unless localStorage was hand-edited. Scholar and Oracle had no
 * code effects at all. Both dropdowns are now built from this list, and Stats
 * validates against it on load and on save.
 *
 * Imports of this module are safe from both `backend/` (Stats) and
 * `frontend/ui/` (AuthUI, ProfileUI) — it is plain data, no DOM.
 */

/**
 * @typedef {Object} MageClass
 * @property {string} id      canonical value stored in localStorage + profiles.mage_class
 * @property {string} title   display name
 * @property {string} tagline one-line fantasy role (also the Workshop branch subtitle)
 * @property {string} color   accent used by the Workshop branch + profile label
 * @property {string} blurb   the mechanical promise shown to the player
 */
export const MAGE_CLASSES = [
    {
        id: 'Novice',
        title: 'Novice',
        tagline: 'Balanced & Economy',
        color: '#4CAF50',
        blurb: 'No specialisation — a clean slate, and the balanced active in the Arena.'
    },
    {
        id: 'Pyromancer',
        title: 'Pyromancer',
        tagline: 'Destruction & Combo',
        color: '#FF5722',
        blurb: '+20% score from every word (which also feeds XP).'
    },
    {
        id: 'Cryomancer',
        title: 'Cryomancer',
        tagline: 'Control & Warding',
        color: '#4dd0e1',
        blurb: 'Words fall slower in Survival — a wider window to read and recover.'
    },
    {
        id: 'Chronomancer',
        title: 'Chronomancer',
        tagline: 'Time & Mana',
        color: '#d500f9',
        blurb: 'Casting the Nova refunds 50 mana, bending time back in your favour.'
    }
];

/** The class a fresh account (and any unknown/invalid value) resolves to. */
export const DEFAULT_MAGE_CLASS = 'Novice';

/** True when `id` is one of the canonical class ids. */
export function isMageClass(id) {
    return MAGE_CLASSES.some((c) => c.id === id);
}

/**
 * Coerce anything (cloud column, localStorage, signUp metadata, hand-edited
 * value) into a canonical class id. Unknown → DEFAULT_MAGE_CLASS, so a bad value
 * can never leave `mageClass` undefined and silently disable every class bonus.
 */
export function normalizeMageClass(id) {
    return isMageClass(id) ? id : DEFAULT_MAGE_CLASS;
}

/** Full record for a class id (normalised, so this never returns undefined). */
export function mageClassInfo(id) {
    const canonical = normalizeMageClass(id);
    return MAGE_CLASSES.find((c) => c.id === canonical);
}
