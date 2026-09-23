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
 * @typedef {Object} MageActive
 * @property {string} id     stable skill id — the ONLY thing sent over the wire
 * @property {string} title  display name (HUD chip, cast float, docs)
 * @property {number} cost   mana spent by the caster (`Stats.useMana`)
 * @property {'damage'|'mitigation'|'mana_refund'} kind what the buff changes
 * @property {number} value  damage/mitigation multiplier, or mana refunded
 * @property {string} effect the owner-facing sentence (docs + guard fingerprint)
 */

/**
 * @typedef {Object} MageClass
 * @property {string} id      canonical value stored in localStorage + profiles.mage_class
 * @property {string} title   display name
 * @property {string} tagline one-line fantasy role (also the Workshop branch subtitle)
 * @property {string} color   accent used by the Workshop branch + profile label
 * @property {string} blurb   the mechanical promise shown to the player
 * @property {MageActive} active the PvP active this Discipline casts in the Arena
 */
export const MAGE_CLASSES = [
    {
        id: 'Novice',
        title: 'Novice',
        tagline: 'Balanced & Economy',
        color: '#4CAF50',
        blurb: 'No specialisation — a clean slate, and the balanced active in the Arena. Arena active: Arcane Surge.',
        active: {
            id: 'arcane-surge',
            title: 'Arcane Surge',
            cost: 50,
            kind: 'damage',
            value: 1.5,
            effect: 'Your next won claim deals +50% damage.'
        }
    },
    {
        id: 'Pyromancer',
        title: 'Pyromancer',
        tagline: 'Destruction & Combo',
        color: '#FF5722',
        blurb: '+20% score from every word (which also feeds XP). Arena active: Cinder Brand.',
        active: {
            id: 'cinder-brand',
            title: 'Cinder Brand',
            cost: 60,
            kind: 'damage',
            value: 2,
            effect: 'Your next won claim deals +100% damage.'
        }
    },
    {
        id: 'Cryomancer',
        title: 'Cryomancer',
        tagline: 'Control & Warding',
        color: '#4dd0e1',
        blurb: 'Words fall slower in Survival — a wider window to read and recover. Arena active: Glacial Ward.',
        active: {
            id: 'glacial-ward',
            title: 'Glacial Ward',
            cost: 50,
            kind: 'mitigation',
            value: 0.5,
            effect: 'The next word you LOSE deals half damage to you.'
        }
    },
    {
        id: 'Chronomancer',
        title: 'Chronomancer',
        tagline: 'Time & Mana',
        color: '#d500f9',
        blurb: 'Casting the Nova refunds 50 mana, bending time back in your favour. Arena active: Mana Echo.',
        active: {
            id: 'mana-echo',
            title: 'Mana Echo',
            cost: 60,
            kind: 'mana_refund',
            value: 60,
            // Owner decision 2026-09-23 (AT-F10): the original 0.85x duration
            // multiplier was dropped — it rewrote the arbiter's OWN input
            // (DuelRace.resolve takes the lower self-measured duration), which
            // is the one thing AT-F9's fairness window must never grant. A
            // mana loop instead, matching this class's shipped Nova refund.
            effect: 'Your next won claim refunds 60 mana.'
        }
    }
];

/**
 * The three ways an active can act. Kept explicit (rather than free-form) so
 * the host can arbitrate anything the roster declares without a lookup table
 * living anywhere else — see AT-F10's "one roster" rule.
 */
export const MAGE_ACTIVE_KINDS = ['damage', 'mitigation', 'mana_refund'];

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

/**
 * AT-F10: the active this class casts in the shared arena. Normalised like
 * `mageClassInfo`, so a bad/absent class can never hand back `undefined.active`
 * to the cast path.
 */
export function activeForClass(id) {
    return mageClassInfo(id).active;
}

/**
 * AT-F10: resolve a skill id that arrived over the wire. The host arbitrates
 * from THIS lookup, so a client cannot invent an effect: an unknown id returns
 * null and the cast is dropped. This is also why the cast payload carries only
 * a skill id and never a cost or a multiplier.
 */
export function mageActiveById(id) {
    return MAGE_CLASSES.find((c) => c.active.id === id)?.active || null;
}
