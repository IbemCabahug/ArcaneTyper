/**
 * Characters.js — the ONE roster of playable characters (AT-F16).
 *
 * Why this file exists (and why it is not MageClasses.js): characters and
 * Disciplines are different axes — `selectedCharacter` is WHO you appear as on
 * the shared canvas and in the Forge, `mageClass` is what you play. Both used to
 * have no table at all: the Forge cards were static markup with no prices, and
 * `CharacterRenderer.draw` ignored `characterId` outright, so the ids in
 * `data-char` were decorative. AT-F16 gives them one source of truth: the cards,
 * the purchase flow in `Stats`, the renderer switch and `verify:skins` all read
 * THIS list, and the guard fails if a card id and the table ever disagree.
 *
 * Prices are owner decisions, not derivations: 12,000 XP sits in the middle of
 * the Workshop's recorded node band (500-18,000) and mirrors its spend rule
 * (`Stats.spendXP`, deductive). One line each to reprice.
 *
 * Imports of this module are safe from both `backend/` (Stats) and
 * `frontend/` (CharacterRenderer, main.js) — plain data, no DOM.
 */

/**
 * @typedef {Object} Character
 * @property {string} id          the `data-char` / `selectedCharacter` value
 * @property {string} title       full display name
 * @property {string} short       card label (all-caps, as shipped in the markup)
 * @property {number} unlockPrice XP cost (0 = free default)
 * @property {string} color       identity colour (matches the card's palette)
 * @property {string} blurb       the teaser promise shown on the card
 */
export const CHARACTERS = [
    {
        id: 'wizard',
        title: 'Grand Chrono-Archmage',
        short: 'WIZARD',
        unlockPrice: 0,
        color: '#29b6f6',
        blurb: 'The flagship — rear-view archmage with the combo-scaling ascendant aura.'
    },
    {
        id: 'voidweaver',
        title: 'Voidweaver',
        short: 'VOIDWEAVER',
        unlockPrice: 12000,
        color: '#00e5ff',
        blurb: 'Astral Gravitation & Singularity Magic'
    },
    {
        id: 'bloodseeker',
        title: 'Bloodseeker',
        short: 'BLOODSEEKER',
        unlockPrice: 12000,
        color: '#ff1744',
        blurb: 'Ancient Blood Runes & Netherblade'
    }
];

/** The character every account starts with (and falls back to). */
export const DEFAULT_CHARACTER = 'wizard';

/** True when `id` is one of the canonical character ids. */
export function isCharacter(id) {
    return CHARACTERS.some((c) => c.id === id);
}

/**
 * Coerce anything (localStorage, presence payload, hand-edited value) into a
 * canonical character id. Unknown → DEFAULT_CHARACTER, so a bad value can never
 * reach the renderer or the profile as an id that resolves to nothing.
 */
export function normalizeCharacter(id) {
    return isCharacter(id) ? id : DEFAULT_CHARACTER;
}

/** Full record for a character id (normalised, so this never returns undefined). */
export function characterInfo(id) {
    return CHARACTERS.find((c) => c.id === normalizeCharacter(id));
}
