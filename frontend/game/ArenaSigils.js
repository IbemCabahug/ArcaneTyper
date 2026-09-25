
/**
 * ArenaSigils.js — procedural PvP active sigils.
 * The final enclosing ring gives each class a shared seal language; the
 * interior paths identify the active without relying on emoji/font glyphs.
 */
const EFFECTS = {
    'arcane-surge': { color: '#a855f7', accent: '#e9d5ff' },
    'cinder-brand': { color: '#ff6b35', accent: '#ffd166' },
    'glacial-ward': { color: '#4dd0e1', accent: '#c7f9ff' },
    'time-stop': { color: '#c084fc', accent: '#f3e8ff' },
    'blood-pact': { color: '#ff1744', accent: '#ff9aaa' },
    'crushing-gravity': { color: '#7c4dff', accent: '#d8ccff' },
    'event-horizon': { color: '#536dfe', accent: '#c5ceff' },
    'rift-tether': { color: '#8b5cf6', accent: '#ddd6fe' },
    'final-cut': { color: '#b00020', accent: '#ffb4ab' },
    'bloodletting': { color: '#e53935', accent: '#ffcdd2' }
};

/** `#rrggbb` + alpha -> an `rgba()` string, so a tint can be reused for both
 *  a strokeStyle and a translucent gradient stop instead of being duplicated. */
function hexAlpha(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Character tint for the Novice mark. The Novice active is one shared
 * Discipline, but its sigil is per-character, so a Novice should also wear the
 * identity colour of the body it is painted on:
 *   voidweaver  — #00e5ff  (Characters.js `voidweaver`)
 *   bloodseeker — #ff1744  (Characters.js `bloodseeker`)
 * The wizard branch is untouched: it keeps the Arcane Surge violet, which is
 * the colour the class has always used and the one its Workshop branch wears.
 * `npm run verify:vfx` reads `backend/Characters.js` and fails if these drift.
 */
const CHARACTER_TINT = {
    voidweaver: { color: '#00e5ff', accent: '#c7f9ff' },
    bloodseeker: { color: '#ff1744', accent: '#ff9aaa' }
};

/**
 * The palette the WHOLE sigil is drawn in — glow, enclosing ring, companion
 * ring, expiry arc and interior alike.
 *
 * This exists because of a real bug: the Novice mark is character-aware, but
 * the frame around it was still read from `EFFECTS[skillId]`, so a Bloodseeker
 * Novice rendered as a red droplet inside a VIOLET frame. Resolving the
 * palette once, here, means a character can never be tinted on the inside and
 * left the class colour on the outside.
 *
 * Only `arcane-surge` is character-scoped. Every other active belongs to
 * exactly one character, so its class colour is already its character colour.
 */
function paletteFor(skillId, character = 'wizard') {
    const base = EFFECTS[skillId];
    if (!base) return null;
    if (skillId === 'arcane-surge') return CHARACTER_TINT[character] || base;
    return base;
}

function glow(ctx, color, blur) {
    if (!window.__atLowQuality) {
        ctx.shadowColor = color;
        ctx.shadowBlur = blur;
    }
}

function polygon(ctx, points, color, width) {
    ctx.beginPath();
    points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.closePath();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
}

/**
 * THE NOVICE — one Discipline, THREE different people.
 *
 * Novice is shared by Wizard, Voidweaver and Bloodseeker (it is the universal
 * starter, and duplicating its balance three times would be a balance bug
 * waiting to happen). But the OWNER'S POINT is right: a Novice under three
 * different characters is not the same person three times, so the SIGIL must
 * speak each character's language while the MECHANICS stay identical
 * (Arcane Surge: +50% on the next won claim, one shared wire id, no roster
 * change and nothing for the class-active guard to re-learn).
 *
 *   wizard     — four-point celestial burst. Ordered, balanced, and radiating.
 *   voidweaver — an inward vortex. A quiet, unformed collapse. The Novice has
 *                not learned to open space yet, only to bend it inward.
 *   bloodseeker— a single rising droplet. The first taste of power. It points
 *                UP, echoing the character's upward life-motes.
 *
 * A shared balance contract with three costumes is deliberate: same numbers,
 * three identities, and each is instantly attributable to its wearer.
 */
function drawNova(ctx, r, character = 'wizard') {
    const fx = paletteFor('arcane-surge', character);

    if (character === 'voidweaver') {
        // ── VOID NOVICE: four spiral arms falling inward to a dark core.
        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r * .96, Math.sin(a) * r * .96);
            ctx.quadraticCurveTo(
                Math.cos(a + 0.42) * r * .60, Math.sin(a + 0.42) * r * .60,
                Math.cos(a + 0.78) * r * .22, Math.sin(a + 0.78) * r * .22
            );
            ctx.strokeStyle = fx.color;
            ctx.lineWidth = 2.2;
            ctx.stroke();
        }
        // The dark centre the arms are falling into. The outer stop was a
        // hard-coded violet from when every Novice was arcane-shaded; it is
        // derived from the accent now so the well cannot disagree with the
        // character it is painted on.
        const well = ctx.createRadialGradient(0, 0, 0, 0, 0, r * .30);
        well.addColorStop(0, 'rgba(4, 2, 12, 0.95)');
        well.addColorStop(1, hexAlpha(fx.accent, 0.10));
        ctx.beginPath();
        ctx.arc(0, 0, r * .30, 0, Math.PI * 2);
        ctx.fillStyle = well;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, 0, r * .30, 0, Math.PI * 2);
        ctx.strokeStyle = fx.accent;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        return;
    }

    if (character === 'bloodseeker') {
        // ── BLOOD NOVICE: a droplet rising from nothing.
        //    An earlier "cradle arc" was drawn under the droplet as a partial
        //    sweep (PI*1.16 -> PI*1.84), and it never closed: on the spinning
        //    ring it read as a stray unfinished circle rather than part of the
        //    mark, so the mark is now the droplet alone. The upward point
        //    already carries the character's "life drawn up out of a wound".
        // The droplet: a teardrop, point up.
        ctx.beginPath();
        ctx.moveTo(0, -r * .70);
        ctx.quadraticCurveTo(r * .30, -r * .10, r * .22, r * .22);
        ctx.quadraticCurveTo(0, r * .46, -r * .22, r * .22);
        ctx.quadraticCurveTo(-r * .30, -r * .10, 0, -r * .70);
        ctx.closePath();
        ctx.fillStyle = fx.color;
        ctx.fill();
        ctx.strokeStyle = fx.accent;
        ctx.lineWidth = 1.6;
        ctx.stroke();
        // A small rising mote above it: the life that has not landed yet.
        ctx.beginPath();
        ctx.arc(0, -r * .86, r * .09, 0, Math.PI * 2);
        ctx.fillStyle = fx.accent;
        ctx.fill();
        return;
    }

    // ── CELESTIAL NOVICE (Wizard, and the safe default for an unknown id): the
    //    original four-point burst. Ordered and balanced — the Wizard is the
    //    baseline character, so this stays the fallback branch.
    polygon(ctx, [[0, -r], [r * .62, 0], [0, r], [-r * .62, 0]], fx.accent, 2);
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2;
        ctx.moveTo(Math.cos(a) * r * .28, Math.sin(a) * r * .28);
        ctx.lineTo(Math.cos(a) * r * .96, Math.sin(a) * r * .96);
    }
    ctx.strokeStyle = fx.color;
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * .18, 0, Math.PI * 2);
    ctx.fillStyle = fx.accent;
    ctx.fill();
}

function drawPyro(ctx, r) {
    polygon(ctx, [[0, -r], [r * .9, r * .72], [-r * .9, r * .72]], EFFECTS['cinder-brand'].accent, 2);
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
        const x = i * r * .42;
        ctx.moveTo(x, r * .48);
        ctx.quadraticCurveTo(x - r * .18, r * .12, x, -r * .2);
        ctx.quadraticCurveTo(x + r * .18, -r * .05, x, r * .48);
    }
    ctx.strokeStyle = EFFECTS['cinder-brand'].color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, r * .28, r * .14, 0, Math.PI * 2);
    ctx.fillStyle = '#fff3b0';
    ctx.fill();
}

function drawCryo(ctx, r) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.moveTo(Math.cos(a) * r * .18, Math.sin(a) * r * .18);
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        const side = a + Math.PI / 2;
        ctx.moveTo(Math.cos(a) * r * .58, Math.sin(a) * r * .58);
        ctx.lineTo(Math.cos(side) * r * .24, Math.sin(side) * r * .24);
        ctx.moveTo(Math.cos(a) * r * .58, Math.sin(a) * r * .58);
        ctx.lineTo(Math.cos(side + Math.PI) * r * .24, Math.sin(side + Math.PI) * r * .24);
    }
    ctx.strokeStyle = EFFECTS['glacial-ward'].accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, r * .28, 0, Math.PI * 2);
    ctx.strokeStyle = EFFECTS['glacial-ward'].color;
    ctx.lineWidth = 2;
    ctx.stroke();
}

function drawChronoMark(ctx, r) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.strokeStyle = EFFECTS['time-stop'].accent;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * (r + 8), Math.sin(a) * (r + 8));
        ctx.strokeStyle = i % 3 === 0 ? EFFECTS['time-stop'].accent : EFFECTS['time-stop'].color;
        ctx.stroke();
    }
    polygon(ctx, [[-r * .28, -r * .42], [r * .28, -r * .42], [-r * .28, r * .42], [r * .28, r * .42]], '#ffffff', 1.5);
}

function drawBloodMark(ctx, r) {
    // A restrained blood-oath mark: central wound diamond, two hooked veins,
    // and upward motes. It reads as a ward without adding a second full aura.
    polygon(ctx, [[0, -r * .58], [r * .28, 0], [0, r * .58], [-r * .28, 0]], EFFECTS['blood-pact'].accent, 2.2);
    ctx.beginPath();
    ctx.moveTo(-r * .48, r * .18);
    ctx.quadraticCurveTo(-r * .12, r * .02, 0, -r * .34);
    ctx.quadraticCurveTo(r * .12, r * .02, r * .48, r * .18);
    ctx.moveTo(-r * .46, r * .18);
    ctx.quadraticCurveTo(-r * .16, r * .42, 0, r * .62);
    ctx.quadraticCurveTo(r * .16, r * .42, r * .46, r * .18);
    ctx.strokeStyle = EFFECTS['blood-pact'].color;
    ctx.lineWidth = 1.8;
    ctx.stroke();
    for (let i = -1; i <= 1; i++) {
        ctx.beginPath();
        ctx.arc(i * r * .18, -r * .72, 2.1, 0, Math.PI * 2);
        ctx.fillStyle = EFFECTS['blood-pact'].accent;
        ctx.fill();
    }
}

/**
 * THE VOIDWEAVER FAMILY — three marks, each derived from its own mechanic.
 *
 * These three previously shared ONE generic "ring, three spokes, centre dot"
 * mark, so all three Voidweaver actives looked identical in the Arena. That is
 * the same class-identity failure the Reaper went through, so the same rules
 * applied: one idea per mark, read from what the skill DOES.
 *
 *   SINGULIST · Crushing Gravity — scales off the caster's OWN combo. The mark
 *     is mass falling inward toward a dense core: three closed rings collapsing
 *     to a black centre, so a bigger streak looks like a deeper well.
 *
 *   NULLWARDEN · Event Horizon — the next blow that would land is denied
 *     ENTIRELY. Nothing gets through, so the mark is a closed barrier with an
 *     incoming vector stopping dead against it and nothing on the far side.
 *
 *   RIFTBINDER · Rift Tether — a win binds the opponent's NEXT claim, i.e. a
 *     link stretched between two points across a tear. The mark is the tear
 *     itself with the tether running across it.
 *
 * All three COUNTER-ROTATE (like the Reaper) so gravity-dependent geometry —
 * things falling down, a barrier facing an incoming vector — stays upright
 * while the family ring turns.
 */
function drawSingulistMark(ctx, r, now = 0) {
    const effect = EFFECTS['crushing-gravity'];
    ctx.rotate(-now / 1200);

    // Three closed rings, each smaller than the last: a well with depth.
    for (const [rad, lw] of [[r * .98, 1], [r * .70, 1.5], [r * .44, 1.2]]) {
        ctx.beginPath();
        ctx.arc(0, 0, rad, 0, Math.PI * 2);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = lw;
        ctx.stroke();
    }

    // Mass falling inward: four short strokes angled down toward the core.
    for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * .92, Math.sin(a) * r * .92);
        ctx.lineTo(Math.cos(a) * r * .52, Math.sin(a) * r * .52);
        ctx.strokeStyle = effect.accent;
        ctx.lineWidth = 1.4;
        ctx.stroke();
    }

    // The dense core the space is falling into. Desaturated-black, because a
    // singularity is a hole, not a light source.
    const core = ctx.createRadialGradient(0, 0, 0, 0, 0, r * .34);
    core.addColorStop(0, 'rgba(0, 0, 0, 0.96)');
    core.addColorStop(1, hexAlpha(effect.color, 0.18));
    ctx.beginPath();
    ctx.arc(0, 0, r * .34, 0, Math.PI * 2);
    ctx.fillStyle = core;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, r * .34, 0, Math.PI * 2);
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 1.2;
    ctx.stroke();
}

function drawNullwardenMark(ctx, r, now = 0) {
    const effect = EFFECTS['event-horizon'];
    ctx.rotate(-now / 1200);

    // The horizon itself: a heavy closed ring. This is the wall.
    ctx.beginPath();
    ctx.arc(0, 0, r * .92, 0, Math.PI * 2);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 3;
    ctx.stroke();

    // An incoming vector from outside, and the point where it STOPS. The gap
    // between the arrowhead and the ring is the whole point of the class: the
    // blow never arrives, so nothing is drawn past the barrier.
    ctx.beginPath();
    ctx.moveTo(-r * 1.12, 0);
    ctx.lineTo(-r * .99, 0);
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-r * .99, 0);
    ctx.lineTo(-r * 1.14, -r * .13);
    ctx.lineTo(-r * 1.14, r * .13);
    ctx.closePath();
    ctx.fillStyle = effect.accent;
    ctx.fill();

    // The sealed interior: still, and empty. No inner geometry at all, because
    // "nothing gets through" is drawn by absence.
    ctx.beginPath();
    ctx.arc(0, 0, r * .30, 0, Math.PI * 2);
    ctx.fillStyle = hexAlpha(effect.color, 0.10);
    ctx.fill();
}

function drawRiftbinderMark(ctx, r, now = 0) {
    const effect = EFFECTS['rift-tether'];
    ctx.rotate(-now / 1200);

    // The tear: a vertical slit with space falling out of it.
    const slit = r * .92;
    ctx.beginPath();
    ctx.moveTo(0, -slit);
    ctx.lineTo(0, slit);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2.4;
    ctx.stroke();

    // Tearing lips — the two halves of space pulled apart.
    for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(dir * r * .10, -r * .58);
        ctx.quadraticCurveTo(dir * r * .40, 0, dir * r * .10, r * .58);
        ctx.strokeStyle = effect.accent;
        ctx.lineWidth = 1.6;
        ctx.stroke();
    }

    // THE TETHER: a taut link stretched across the tear, binding one side to
    // the other. This is the debuff — a claim crossing this line is weakened.
    ctx.beginPath();
    ctx.moveTo(-r * .70, 0);
    ctx.lineTo(r * .70, 0);
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // The two anchors it is tied to.
    for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(dir * r * .70, 0);
        ctx.lineTo(dir * r * .86, -r * .14);
        ctx.lineTo(dir * r * .86, r * .14);
        ctx.closePath();
        ctx.fillStyle = effect.color;
        ctx.fill();
    }
}

/**
 * THE EXECUTIONER'S MARK — Reaper · Final Cut.
 *
 * Research-driven, not decorative. Late-medieval hangmen were identified by
 * their INSTRUMENT rather than by gore, and the executioner's axe was
 * distinguished from a carpenter's or butcher's by silhouette alone: a broad
 * forged crescent on a long haft (Royal Armouries). A silhouette is what
 * survives at Arena size, so that is what is drawn.
 *
 * The kill tally is deliberately IRREGULAR. A symmetric arrangement reads as
 * decoration; uneven spacing reads as a RECORD of kills, which is the entire
 * point of this class. Per the Diablo III Necromancer VFX panel, the core is
 * desaturated rather than hot — a lethal class whose effect looks "happy" is a
 * known VFX failure. One committed cut, not a flurry: the restraint is the
 * threat.
 */
/**
 * THE RETICLE — Reaper (Final Cut).
 *
 * RESEARCH RATIONALE (five rejected shapes are recorded here on purpose, because
 * each one taught the constraint that produced this mark):
 *   1. upright crescent axe  -> read as a SPEEDOMETER (the spin laid the haft
 *      on its side, so a gravity-dependent shape cannot survive this renderer)
 *   2. spoked cutting wheel  -> read as a CLOCK FACE (even teeth + a cross =
 *      hands and ticks)
 *   3. three-blade shuriken  -> unambiguous, but the owner called it "worse":
 *      a spinning blade has no GAZE, and a stare is what a murderer projects
 *   4. Amaterasu eye         -> reversed by the owner; too much face for a
 *      compact sigil
 *   5. the faceless hood     -> owned the gaze and the stillness, but the
 *      owner's call was a crosshair, and a reticle says the same thing in a
 *      shape every player already reads instantly
 *
 * WHY A RETICLE. This class is not a swing. It is the moment BEFORE the swing:
 * one committed cut that lands only because the target was already measured.
 * Final Cut scales off the opponent's MISSING HP, so its fantasy is a wound that
 * has already been located and ranged. A sight is exactly that idea, and unlike
 * every weapon silhouette tried above it needs no legend to decode.
 *
 * The mark CANCELS the caller's spin (`ctx.rotate(-now / 1200)`), so the scope
 * sits dead level while the rest of the family turns — a reticle that is level
 * and unwavering is the threat, and the stillness also lets the mark keep true
 * sniper proportions (a long main post, a shorter fine cross) instead of being
 * flattened into four-fold symmetry to survive the rotation.
 *
 * Restraint is the point: a fine cross, an OPEN centre, a stadia ladder and four
 * scope arcs. One line of sight, not a flurry.
 */
function drawReaperMark(ctx, r, now = 0) {
    const effect = EFFECTS['final-cut'];
    ctx.rotate(-now / 1200);   // cancel the caller's spin; see the header
    const breathe = Math.sin(now / 1100);

    // The reticle's open centre. A cross that reached its own middle would
    // read as a plus sign, and the gap is what makes it a SIGHT.
    const gap = r * .12;

    // ── THE SCOPE RING. Four arcs broken by four gaps, aligned to the arms.
    const ringR = r * .98;
    for (let q = 0; q < 4; q++) {
        const a = q * (Math.PI / 2) + 0.22;
        ctx.beginPath();
        ctx.arc(0, 0, ringR, a, a + (Math.PI / 2) - 0.44);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 2.6;
        ctx.stroke();
    }

    // ── THE MAIN POST. Long, vertical, and stopping short of the centre.
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 1.6;
    for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(0, dir * gap);
        ctx.lineTo(0, dir * r * .92);
        ctx.stroke();
    }

    // ── THE FINE CROSS. Shorter, because a rifle scope's horizontal stadia
    //    sits closer in than the main post.
    ctx.lineWidth = 1.2;
    for (const dir of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(dir * gap, 0);
        ctx.lineTo(dir * r * .58, 0);
        ctx.stroke();
    }

    // ── THE STADIA LADDER. Four range marks up each half of the post: this is
    //    the part that says "measured", and it is what a murderer is really
    //    carrying. They breathe very slightly, like a held breath.
    const tickW = r * .10;
    for (const dir of [-1, 1]) {
        for (let i = 1; i <= 4; i++) {
            const y = dir * (gap + (r * .92 - gap) * (i / 5));
            const long = i % 2 === 1;
            const w = long ? tickW : tickW * .55 + breathe * r * .008;
            ctx.beginPath();
            ctx.moveTo(-w, y);
            ctx.lineTo(w, y);
            ctx.strokeStyle = effect.color;
            ctx.lineWidth = long ? 1.4 : 1;
            ctx.stroke();
        }
    }

    // ── THE RANGE MARKS. Two short bars down the horizontal arms, so the
    //    cross is not the only measured part of the scope.
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 1;
    for (const dir of [-1, 1]) {
        for (let i = 1; i <= 2; i++) {
            const x = dir * (gap + (r * .58 - gap) * (i / 3));
            const h = r * .07;
            ctx.beginPath();
            ctx.moveTo(x, -h);
            ctx.lineTo(x, h);
            ctx.stroke();
        }
    }

    // ── THE FIXED POINT. One small dot at the very centre: the shot that has
    //    already been taken, and the last thing the opponent sees.
    ctx.beginPath();
    ctx.arc(0, 0, r * .045, 0, Math.PI * 2);
    ctx.fillStyle = effect.accent;
    ctx.fill();
}

/**
 * VEIN SEVERED — Bloodruner · Bloodletting.
 *
 * The deliberate mirror of the Reaper: that one cuts outward at the opponent,
 * this one turns the blade INWARD at the caster's own heart. Blood falls
 * away from the wound, which is the exact inverse of Hemomancer's motes
 * rising into a ward. One cut outward, one cut inward — the two Bloodseeker
 * actives should never be mistakable for each other.
 */
function drawBloodlettingMark(ctx, r) {
    const effect = EFFECTS['bloodletting'];

    // 1. The blade turned inward, tip driven toward the caster's own core.
    ctx.beginPath();
    ctx.moveTo(-r * .12, -r * .78);
    ctx.quadraticCurveTo(r * .26, -r * .26, r * .06, r * .12);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    // 2. A cross-cut binding the vein — the incision itself.
    ctx.beginPath();
    ctx.moveTo(-r * .46, -r * .50);
    ctx.quadraticCurveTo(0, -r * .30, r * .44, -r * .52);
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // 3. The wound, pooling where the blade landed.
    ctx.beginPath();
    ctx.ellipse(r * .06, r * .18, r * .13, r * .09, 0, 0, Math.PI * 2);
    ctx.fillStyle = effect.color;
    ctx.fill();

    // 4. Blood FALLING away — the exact inverse of Hemomancer's rising motes.
    for (const [dx, dy, s] of [[-.34, .40, 2.4], [-.10, .58, 2.0], [.20, .44, 1.7]]) {
        ctx.beginPath();
        ctx.moveTo(dx * r, dy * r - s * .5);
        ctx.quadraticCurveTo(dx * r + s * .7, dy * r, dx * r, dy * r + s);
        ctx.strokeStyle = effect.color;
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}

export function drawCasterSigil(ctx, skillId, x, y, radius, now, alpha = 1, remainingMs = 3000, character = 'wizard') {
    // Resolved through paletteFor so the frame wears the same colour as the
    // interior (see its header for the violet-frame bug this fixes).
    const effect = paletteFor(skillId, character);
    if (!effect) return;
    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    glow(ctx, effect.color, skillId === 'time-stop' ? 18 : 10);
    ctx.save();
    ctx.rotate(now / (skillId === 'time-stop' ? -900 : 1200));
    const inner = radius * .64;
    // Novice is one Discipline shared by three characters, so its mark is
    // character-aware. Every other active belongs to exactly one character and
    // is dispatched on its skill id alone.
    if (skillId === 'arcane-surge') drawNova(ctx, inner, character);
    else if (skillId === 'cinder-brand') drawPyro(ctx, inner);
    else if (skillId === 'glacial-ward') drawCryo(ctx, inner);
    else if (skillId === 'blood-pact') drawBloodMark(ctx, inner);
    // The Reaper eye and all three Voidweaver marks COUNTER-ROTATE (see their
    // headers), so they need `now` to cancel the spin applied above. Every
    // other mark is spin-tolerant and is called without it.
    else if (skillId === 'final-cut') drawReaperMark(ctx, inner, now);
    else if (skillId === 'bloodletting') drawBloodlettingMark(ctx, inner);
    else if (skillId === 'crushing-gravity') drawSingulistMark(ctx, inner, now);
    else if (skillId === 'event-horizon') drawNullwardenMark(ctx, inner, now);
    else if (skillId === 'rift-tether') drawRiftbinderMark(ctx, inner, now);
    else drawChronoMark(ctx, inner);
    ctx.restore();
    // Final layer: the enclosing circle seals every class sigil.
    // The companion ring is a COMPLETE dashed circle. It used to be a 1.35-pi
    // arc, which left ~117 degrees missing and read as a ring that failed to
    // draw rather than as a deliberate border. Dashes keep it decorative and
    // visually subordinate to the solid outer ring.
    ctx.save();
    ctx.globalAlpha = alpha * .45;
    ctx.setLineDash([3, 5]);
    ctx.beginPath();
    ctx.arc(0, 0, radius - 8, 0, Math.PI * 2);
    ctx.strokeStyle = effect.accent;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 2.2;
    ctx.stroke();
    if (skillId !== 'time-stop') {
        const progress = Math.max(0, Math.min(1, remainingMs / 3000));
        ctx.beginPath();
        ctx.arc(0, 0, radius + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
        ctx.strokeStyle = effect.accent;
        ctx.lineWidth = 2;
        ctx.stroke();
    }
    ctx.restore();
}

export function drawTimeStopSeal(ctx, width, height, remainingMs, now) {
    const cx = width / 2, cy = height / 2;
    const scale = Math.min(1.2, Math.max(.82, height / 750));
    const r = Math.round(Math.min(width, height) * .42 * scale);
    const effect = EFFECTS['time-stop'];
    const progress = Math.max(0, Math.min(1, remainingMs / 3000));
    const pulse = .5 + .5 * Math.sin(now / 260);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalAlpha = .18 + pulse * .08;
    glow(ctx, effect.color, 18);
    ctx.strokeStyle = effect.color;
    ctx.lineWidth = 1;
    for (const ring of [r * .55, r * .78, r]) {
        ctx.beginPath(); ctx.arc(0, 0, ring, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = .78;
    ctx.lineWidth = 2;
    ctx.save();
    ctx.rotate(now / -1100);
    ctx.beginPath();
    for (let i = 0; i < 12; i++) {
        const a = i * Math.PI / 6;
        ctx.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a) * (r - (i % 3 === 0 ? 17 : 9)), Math.sin(a) * (r - (i % 3 === 0 ? 17 : 9)));
    }
    ctx.strokeStyle = effect.accent;
    ctx.stroke();
    ctx.restore();
    ctx.rotate(-now / 1600);
    polygon(ctx, [[-22, -34], [22, -34], [-22, 34], [22, 34]], effect.accent, 2);
    ctx.rotate(now / 1600);
    // Final layer: the bright arc is the Chronomancer's expiry counter.
    ctx.beginPath(); ctx.arc(0, 0, r + 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(192,132,252,.18)'; ctx.lineWidth = 5; ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r + 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * progress);
    ctx.strokeStyle = effect.accent; ctx.lineWidth = 5;
    ctx.shadowColor = effect.accent; ctx.shadowBlur = window.__atLowQuality ? 0 : 14; ctx.stroke();
    ctx.restore();
}

