/**
 * ArenaTeams.js — AT-F9 P3: fixed team identity for the shared arena canvas.
 *
 * Both clients must agree on WHO IS WHERE and WHO IS WHAT COLOUR:
 *   slot A = the HOST      → left mage  → blue (#29b6f6)
 *   slot B = the CHALLENGER → right mage → red  (#ff4b4b)
 * The same on both screens, so a mage never changes team when you switch
 * clients. This matches the Arena score bar, which has always painted
 * sb-side-a blue-left and sb-side-b red-right.
 *
 * Deriving the canvas colours from the local viewer instead ("me = blue,
 * them = red") silently swaps the two mages between clients: the challenger
 * saw themselves in blue on the canvas while the score bar called them red
 * (and the host red). Owner-reported confusion, fixed here by keying every
 * arena visual to the TEAM SLOT rather than to "self".
 */

/** Team colours — the single source of truth for arena identity. */
export const TEAM_COLORS = { A: '#29b6f6', B: '#ff4b4b' };

/** Horizontal slot ratios (fraction of canvas width) for each team slot. */
export const SLOT_RATIOS = { A: 0.30, B: 0.70 };

/**
 * Colour for a team slot ('A' host | 'B' challenger). Unknown slots fall back
 * to the host colour so a missing `duelSide` can never paint `undefined`.
 */
export function teamColorFor(slot) {
    return TEAM_COLORS[slot] || TEAM_COLORS.A;
}

/** The opposing team slot. */
export function otherSlot(slot) {
    return slot === 'A' ? 'B' : 'A';
}

/** Pixel x of a team slot's mage on the shared canvas. */
export function slotX(canvas, slot) {
    const ratio = SLOT_RATIOS[slot] || SLOT_RATIOS.A;
    return Math.round(canvas.width * ratio);
}
