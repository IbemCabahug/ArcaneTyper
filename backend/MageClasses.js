/**
 * MageClasses.js — the ONE source of truth for mage Disciplines (AT-L8).
 *
 * Owner decision 2026-09-25: the class roster is character-scoped. **Novice**
 * is the shared default; the Wizard family adds Pyromancer / Cryomancer /
 * Chronomancer, the Voidweaver family adds Singulist / Nullwarden / Riftbinder,
 * and the Bloodseeker family adds Hemomancer / Reaper / Bloodruner.
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
 * @property {'damage'|'combo_damage'|'mitigation'|'opponent_weaken'|'time_stop'|'lifesteal'|'execution'|'self_sacrifice'} kind what the active changes
 * @property {number} value damage/mitigation multiplier, freeze duration in ms,
 *   or a class-specific scalar (healing percentage, execution base, or self-cost)
 * @property {string} effect the owner-facing sentence (docs + guard fingerprint)
 */

/**
 * @typedef {Object} MageClass
 * @property {string} id      canonical value stored in localStorage + profiles.mage_class
 * @property {string} title   display name
 * @property {string} tagline one-line fantasy role (also the Workshop branch subtitle)
 * @property {string} color   accent used by the Workshop branch + profile label
 * @property {string} blurb   the mechanical promise shown to the player
 * @property {boolean} [workshop=false] whether the class has a Survival perk branch
 * @property {MageActive} active the PvP active this Discipline casts in the Arena
 */
export const MAGE_CLASSES = [
    {
        id: 'Novice',
        title: 'Novice',
        tagline: 'Balanced & Economy',
        color: '#4CAF50',
        // Owner decision 2026-09-26: the XP price of this Discipline's scroll in
        // the Workshop. 0 means the Discipline is free — Novice is the shared
        // default and must never be behind a paywall, or a fresh account has no
        // legal first pick.
        scroll: 0,
        workshop: true,
        characters: ['wizard', 'voidweaver', 'bloodseeker'],
        blurb: 'No specialisation — a clean slate. PvP-only Arena active: Arcane Surge.',
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
        scroll: 8000,
        workshop: true,
        characters: ['wizard'],
        blurb: '+20% score from every word (which also feeds XP). PvP-only Arena active: Cinder Brand.',
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
        scroll: 8000,
        workshop: true,
        characters: ['wizard'],
        blurb: 'Words fall slower in Survival. PvP-only Arena active: Glacial Ward.',
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
        scroll: 8000,
        workshop: true,
        characters: ['wizard'],
        blurb: 'Casting the Nova refunds 50 mana. PvP-only Arena active: Time Stop.',
        active: {
            id: 'time-stop',
            title: 'Time Stop',
            cost: 100,
            kind: 'time_stop',
            value: 3000,
            effect: 'Stops the shared Arena for 3 seconds. You can still type.'
        }
    },
    {
        id: 'Singulist',
        title: 'Singulist',
        tagline: 'Gravity & Momentum',
        scroll: 8000,
        // Owner decision 2026-09-26: the Voidweaver's three Disciplines all
        // wear the CHARACTER's identity colour (#536dfe, Characters.js
        // `voidweaver`) instead of three near-identical violets. They were
        // #7c4dff / #536dfe / #8b5cf6 — a spread of under 26 Delta-E across the
        // family, so a Voidweaver's own actives did not read as one character.
        color: '#536dfe',
        workshop: false,
        characters: ['voidweaver'],
        blurb: 'A collapsing point of gravity. PvP-only Arena active: Crushing Gravity.',
        active: {
            id: 'crushing-gravity',
            title: 'Crushing Gravity',
            cost: 60,
            kind: 'combo_damage',
            value: 1.5,
            effect: 'Your next won claim deals +50% damage, plus +1 per 20 live combo, capped at +4 damage.'
        }
    },
    {
        id: 'Nullwarden',
        title: 'Nullwarden',
        tagline: 'Event Horizon & Denial',
        scroll: 8000,
        color: '#536dfe',
        workshop: false,
        characters: ['voidweaver'],
        blurb: 'A hard boundary against incoming force. PvP-only Arena active: Event Horizon.',
        active: {
            id: 'event-horizon',
            title: 'Event Horizon',
            cost: 100,
            kind: 'mitigation',
            value: 0,
            effect: 'The next word you LOSE deals no damage to you.'
        }
    },
    {
        id: 'Riftbinder',
        title: 'Riftbinder',
        tagline: 'Space & Binding',
        scroll: 8000,
        color: '#536dfe',
        workshop: false,
        characters: ['voidweaver'],
        blurb: 'Binds the opponent to a weakened fold. PvP-only Arena active: Rift Tether.',
        active: {
            id: 'rift-tether',
            title: 'Rift Tether',
            cost: 60,
            kind: 'opponent_weaken',
            value: 0.75,
            effect: 'Win a word to bind the opponent: their next claim deals only 75% damage.'
        }
    },
    {
        id: 'Hemomancer',
        title: 'Hemomancer',
        tagline: 'Blood & Ruin',
        color: '#ff1744',
        scroll: 8000,
        workshop: false,
        characters: ['bloodseeker'],
        blurb: 'Turns won claims into health. PvP-only Arena active: Blood Pact.',
        active: {
            id: 'blood-pact',
            title: 'Blood Pact',
            cost: 60,
            kind: 'lifesteal',
            value: 0.25,
            effect: 'Your next won claim heals 25% of its damage, plus a capped streak bonus.'
        }
    },
    {
        id: 'Reaper',
        title: 'Reaper',
        tagline: 'Execution & Ruin',
        color: '#b00020',
        scroll: 8000,
        workshop: false,
        characters: ['bloodseeker'],
        blurb: 'A patient hunter that grows stronger as the opponent weakens. PvP-only Arena active: Final Cut.',
        active: {
            id: 'final-cut',
            title: 'Final Cut',
            cost: 80,
            kind: 'execution',
            value: 1.5,
            effect: 'Your next won claim deals +50% damage, plus +1 per 20 missing opponent HP, capped at +4 damage.'
        }
    },
    {
        id: 'Bloodruner',
        title: 'Bloodruner',
        tagline: 'Sacrifice & Fury',
        color: '#e53935',
        scroll: 8000,
        workshop: false,
        characters: ['bloodseeker'],
        blurb: 'Writes a dangerous contract into the body. PvP-only Arena active: Bloodletting.',
        active: {
            id: 'bloodletting',
            title: 'Bloodletting',
            cost: 60,
            kind: 'self_sacrifice',
            value: 5,
            effect: 'Pay 5 HP on cast. Your next won claim gains +4 damage, escalating with your missing HP.'
        }
    }
];

/** The eight active kinds across ten Disciplines. Kept explicit so the host
 * arbitrates from the roster rather than a second local effect table. */
export const MAGE_ACTIVE_KINDS = ['damage', 'combo_damage', 'mitigation', 'opponent_weaken', 'time_stop', 'lifesteal', 'execution', 'self_sacrifice'];

/**
 * Owner decision 2026-09-26: a Discipline costs a one-time scroll, but CHANGING
 * to a different one costs this much every time.
 *
 * A scroll is owned forever, so without a surcharge the optimal play is to buy
 * every scroll on the first run and then hop to whatever suits the current run
 * for free — which deletes the whole point of the tree. The surcharge is
 * deliberately small next to a scroll (1/8th) so an established mage can still
 * experiment freely; it taxes the cheap repetitive act, not the decision.
 */
export const DISCIPLINE_SWITCH_COST = 1000;

/** The scroll id for a Discipline, used in the `unlockedSkills` ledger. */
export function disciplineScrollId(classId) {
    return `discipline-scroll:${normalizeMageClass(classId)}`;
}

/** The XP cost of a Discipline's scroll. Normalised, so junk yields the free one. */
export function scrollCostFor(classId) {
    return mageClassInfo(classId).scroll || 0;
}

// AT-F14 migration: the old character name was also briefly used as the class
// id. Preserve the saved Blood Pact choice for existing Bloodseeker profiles.
const LEGACY_CLASS_ALIASES = { Bloodseeker: 'Hemomancer' };

/** The class a fresh account (and any unknown/invalid value) resolves to. */
export const DEFAULT_MAGE_CLASS = 'Novice';

/** True when `id` is one of the canonical class ids. */
export function isMageClass(id) {
    return MAGE_CLASSES.some((c) => c.id === id);
}

/** The selectable Disciplines for a character family. Novice is shared. */
export function classesForCharacter(characterId) {
    return MAGE_CLASSES.filter((c) => c.characters.includes(characterId));
}

/** True when `id` is canonical and belongs to this character family. */
export function isMageClassForCharacter(id, characterId) {
    return isMageClass(id) && mageClassInfo(id).characters.includes(characterId);
}

/** Resolve a class against a character, falling back to that character's Novice. */
export function normalizeMageClassForCharacter(id, characterId) {
    const mapped = LEGACY_CLASS_ALIASES[id] || id;
    return isMageClassForCharacter(mapped, characterId) ? mapped : 'Novice';
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
