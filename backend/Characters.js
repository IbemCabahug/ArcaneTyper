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
        // The Voidweaver has a SECOND way in: the secret `the_unspoken`
        // achievement. This is declared here, on the character, rather than
        // written into the roster by the achievement itself — so
        // Stats.isCharacterUnlocked stays the ONE place that decides ownership
        // and the Forge card can advertise both routes. A non-empty value means
        // the character is also free once that achievement is unlocked.
        unlockAchievement: 'the_unspoken',
        // Owner decision 2026-09-26: the Voidweaver's identity colour is the
        // Nullwarden indigo, #536dfe (MageClasses.js `Nullwarden`). It reads as
        // the same "deep space" family as its Disciplines instead of competing
        // with the Wizard's sky blue, and it is what CHARACTER_TINT mirrors in
        // ArenaSigils.js so the Novice sigil wears it too.
        color: '#536dfe',
        blurb: 'Astral Gravitation & Singularity Magic'
    },
    {
        id: 'bloodseeker',
        title: 'Bloodseeker',
        short: 'BLOODSEEKER',
        unlockPrice: 12000,
        // Second route (owner decision 2026-09-26): the secret
        // `the_bloodied_standard` counter, at 100 Arena wins. This REPLACED an
        // earlier idea — dying in Survival without typing a word — which
        // punished the behaviour the game actually wants. Declared here on the
        // character, exactly as the Voidweaver declares `the_unspoken`, so
        // Stats.isCharacterUnlocked stays the ONE place that decides ownership.
        unlockAchievement: 'the_bloodied_standard',
        // The card LABEL stays `???` even though this character now HAS a
        // visible n/100 route. The Voidweaver is revealed by its counter; the
        // Bloodseeker deliberately is not, so winning duels is the only thing
        // that teaches the player this card is the Bloodseeker at all. One
        // flag, read by main.js `revealed`, because the two secrets now differ
        // in exactly this way and the rule must not be re-derived per card.
        secretIdentity: true,
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
