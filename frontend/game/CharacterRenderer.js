/**
 * CharacterRenderer — Procedural Sprite & Animation Engine
 *
 * Renders high-fidelity animated character sprites for ArcaneTyper — one branch
 * per `Characters.js` id:
 * - The Grand Chrono-Archmage (Wizard): Levitation hover, flowing hooded robes with gold embroidery,
 *   starlight celestial eyes, rotating astrological dial & runic pedestal, combo-scaling ascendant auras,
 *   and dynamic casting staff with player-attuned elemental gem.
 * - The Voidweaver (AT-F16): astral gravitation — a singularity event horizon behind the cowl, a mote
 *   stream that falls *inward* every frame, and a collapsing well under the hem.
 * - The Bloodseeker (AT-F16): ancient blood runes — a rotating circle of code-drawn glyphs, a
 *   netherblade held point-down, and droplets drawn *upward* against gravity into the ring.
 *
 * AT-F16: `draw` used to ignore `characterId` and paint the wizard unconditionally,
 * so the Forge ids were decorative. It now switches on the same roster the Forge
 * sells from, and an unknown id still degrades to the wizard.
 *
 * House rule: procedural vector work or RenderCache-baked bitmaps only — never
 * raster assets (no <img>, no url(http...) anywhere in this file).
 */
import { normalizeCharacter } from '../../backend/Characters.js';
import { RenderCache } from '../RenderCache.js';

export class CharacterRenderer {
    /** Shared bake box for the AT-F16 bodies: 120×90px, anchored at (60, 62). */
    static BODY_W = 120;
    static BODY_H = 90;
    static BODY_ANCHOR_X = 60;
    static BODY_ANCHOR_Y = 62;

    /**
     * Main entry point for drawing the selected character.
     * @param {string} characterId a Characters.js id (unknown → the wizard)
     */
    static drawStreakOverlay(ctx, cx, cy, characterId, combo, now, arenaSkillActive = false) {
        if (combo < 10) return;
        const lowQ = window.__atLowQuality;
        const tier = combo >= 200 ? 5 : combo >= 150 ? 4 : combo >= 100 ? 3 : combo >= 50 ? 2 : combo >= 20 ? 1 : 0;
        const pulse = 0.5 + 0.5 * Math.sin(now / (combo >= 150 ? 250 : 360));
        const alpha = (0.30 + tier * 0.07) * (lowQ ? 0.72 : 1) * (arenaSkillActive ? 0.48 : 1);
        ctx.save();
        ctx.translate(cx, cy - 8);
        ctx.globalAlpha = alpha;
        ctx.lineCap = 'round';
        if (characterId === 'voidweaver') {
            CharacterRenderer._drawVoidStreak(ctx, combo, tier, pulse, lowQ, now);
        } else if (characterId === 'bloodseeker') {
            CharacterRenderer._drawBloodStreak(ctx, combo, tier, pulse, lowQ, now);
        }
        // The Wizard deliberately has NO streak overlay: its combo identity is
        // already carried by the complete astrological mandala, dials, armillary
        // and runic pedestal drawn inside drawWizard(). A second open path here
        // read as a stray unfinished diamond laid over that circle.
        ctx.restore();
    }

    static _drawVoidStreak(ctx, combo, tier, pulse, lowQ, now) {
        // One persistent event horizon, then a restrained sequence of gravity
        // cues. The state grows brighter and more concentrated instead of
        // merely stacking unrelated rings.
        const r = 54 + tier * 10 + pulse * 2;
        const spin = now * (tier >= 4 ? 0.0012 : 0.00045);
        const cyan = tier >= 4 ? '#d8faff' : '#00e5ff';

        // Dark center reads as an event horizon, while a bright rim supplies
        // the classic lensing cue: darkness framed by distorted light.
        const core = ctx.createRadialGradient(0, 0, 2, 0, 0, r * 0.72);
        core.addColorStop(0, 'rgba(0,0,4,0.92)');
        core.addColorStop(0.42, `rgba(124,77,255,${0.12 + tier * 0.025})`);
        core.addColorStop(0.72, `rgba(0,229,255,${0.10 + tier * 0.018})`);
        core.addColorStop(1, 'rgba(0,0,8,0)');
        ctx.fillStyle = core;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
        ctx.fill();

        // Full boundary remains present from the first streak tier.
        ctx.strokeStyle = cyan;
        ctx.lineWidth = tier >= 4 ? 2 : 1.35;
        if (!lowQ) {
            ctx.shadowColor = '#7c4dff';
            ctx.shadowBlur = 6 + tier * 2;
        }
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        // Counter-rotating inner orbit and fixed cardinal ticks make the circle
        // feel engineered rather than like a generic aura.
        ctx.strokeStyle = `rgba(124,77,255,${0.55 + tier * 0.06})`;
        ctx.lineWidth = 1.1;
        ctx.setLineDash([7, 6]);
        ctx.beginPath();
        ctx.arc(0, 0, r - 10, spin, spin + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);

        const ticks = tier >= 3 ? 12 : 8;
        for (let i = 0; i < ticks; i++) {
            const a = -spin * 0.7 + i * Math.PI * 2 / ticks;
            const major = i % 2 === 0;
            ctx.strokeStyle = major ? cyan : 'rgba(124,77,255,0.8)';
            ctx.lineWidth = major ? 1.4 : 0.8;
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4));
            ctx.lineTo(Math.cos(a) * (r + (major ? 7 : 4)), Math.sin(a) * (r + (major ? 7 : 4)));
            ctx.stroke();
        }

        // 20+: two elliptic accretion bands travel in opposite directions.
        if (tier >= 1) {
            for (let band = 0; band < 2; band++) {
                ctx.save();
                ctx.rotate(band ? -spin * 0.65 : spin * 0.42);
                ctx.strokeStyle = band ? `rgba(124,77,255,${0.42 + tier * 0.07})` : `rgba(0,229,255,${0.50 + tier * 0.06})`;
                ctx.lineWidth = band ? 1.1 : 1.7;
                ctx.setLineDash(band ? [4, 8] : [13, 7]);
                ctx.beginPath();
                ctx.ellipse(0, 0, r * 0.78, r * (band ? 0.31 : 0.23), band ? Math.PI / 7 : -Math.PI / 9, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.restore();
            }
        }

        // 50+: complete inward-pointing spokes show space falling toward the
        // core without leaving detached open curves in the silhouette.
        if (tier >= 2) {
            ctx.strokeStyle = `rgba(124,77,255,${0.36 + tier * 0.06})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.58, 0, Math.PI * 2);
            ctx.stroke();
            for (let i = 0; i < 12; i++) {
                const a = i * Math.PI / 6 + spin * 0.4;
                const inner = r * 0.22;
                const outer = r * 0.64;
                ctx.strokeStyle = i % 3 === 0 ? '#d8faff' : (i % 2 === 0 ? '#00e5ff' : '#7c4dff');
                ctx.lineWidth = i % 3 === 0 ? 1.4 : 0.9;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * outer, Math.sin(a) * outer * 0.72);
                ctx.lineTo(Math.cos(a) * inner, Math.sin(a) * inner * 0.72);
                ctx.stroke();
            }
        }

        // 100+: complete concentric lens rings keep the geometry balanced and
        // remove detached crescent fragments from the silhouette.
        if (tier >= 3) {
            ctx.strokeStyle = `rgba(124,77,255,${0.38 + tier * 0.06})`;
            ctx.lineWidth = 1.1;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = `rgba(216,250,255,${0.30 + tier * 0.07})`;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.40, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 150+: bright photon ring. 200+: an eclipse core, the concentrated
        // maximum payoff rather than a larger collection of effects.
        if (tier >= 4) {
            ctx.strokeStyle = '#d8faff';
            ctx.lineWidth = tier >= 5 ? 2.2 : 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.48, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (tier >= 5) {
            ctx.fillStyle = '#000006';
            ctx.beginPath();
            ctx.arc(0, 0, r * 0.31, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 2.4 + pulse * 2.2, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(0,229,255,${0.45 + pulse * 0.3})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.ellipse(0, 0, r + 9 + pulse * 4, (r + 9 + pulse * 4) * 0.38, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    static _drawBloodStreak(ctx, combo, tier, pulse, lowQ, now) {
        // A persistent oath circle, a moon that develops through every tier,
        // and upward life-flow. All five visual recommendations share this one
        // ritual instead of becoming unrelated circles and particle bursts.
        const r = 56 + tier * 10 + pulse * 2;
        const spin = now * (tier >= 4 ? 0.0011 : 0.00042);
        // AT-F15 palette separation. The four netherblades are DARK steel with a
        // thin `#ff1744` edge, so a streak painted in that same saturated
        // crimson sat at the same value and hue and read as one red mass — the
        // weapon appeared to overpower the circle. The streak is therefore moved
        // into a LIGHTER, pinker blood-rose with a white-hot core, so the two
        // occupy different value ranges (light aura vs dark blade + hot edge)
        // and the eye separates them. The blade keeps its own crimson; nothing
        // about the weapon changed.
        const crimson = tier >= 4 ? '#ffffff' : '#ffa8b8';
        const rose = '#ffdde3';
        const hot = '#ffffff';
        const moonY = -r * 0.46;
        const moonR = 11 + tier * 3.2 + pulse * 0.7;

        // Blood Moon phase behind the cowl: crescent → half → gibbous → eclipse.
        const moon = ctx.createRadialGradient(0, moonY, moonR * 0.35, 0, moonY, moonR * 1.45);
        moon.addColorStop(0, `rgba(255,235,240,${0.42 + tier * 0.09})`);
        moon.addColorStop(0.55, `rgba(255,110,140,${0.30 + tier * 0.07})`);
        moon.addColorStop(1, 'rgba(74,0,16,0)');
        ctx.fillStyle = moon;
        ctx.beginPath();
        ctx.arc(0, moonY, moonR * 1.45, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = tier >= 3 ? hot : rose;
        ctx.beginPath();
        ctx.arc(0, moonY, moonR, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255,128,149,${0.70 + tier * 0.06})`;
        ctx.lineWidth = tier >= 4 ? 1.8 : 1.1;
        ctx.stroke();

        // A dark offset disc increases through the tiers, creating the familiar
        // blood-eclipse crescent without copying any specific character shot.
        const shadowX = moonR * (0.18 + tier * 0.10);
        ctx.fillStyle = `rgba(38,0,10,${0.48 + tier * 0.08})`;
        ctx.beginPath();
        ctx.arc(shadowX, moonY - moonR * 0.05, moonR * 0.88, 0, Math.PI * 2);
        ctx.fill();

        // Full Blood Oath boundary persists for the whole streak. Brighter and
        // thicker than the first pass: at a pale-but-thin value the circle read
        // as a faint hairline against the dark arena, so the streak never
        // registered as the character's power even once the hue was right.
        ctx.strokeStyle = crimson;
        ctx.lineWidth = tier >= 4 ? 2.8 : 1.9;
        if (!lowQ) {
            ctx.shadowColor = '#ffb3c0';
            ctx.shadowBlur = 10 + tier * 3;
        }
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();

        // Counter-rotating ritual boundary and six procedural oath glyphs.
        ctx.strokeStyle = `rgba(255,221,227,${0.62 + tier * 0.07})`;
        ctx.lineWidth = 1.3;
        ctx.setLineDash([8, 7]);
        ctx.beginPath();
        ctx.arc(0, 0, r - 10, -spin, -spin + Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        for (let i = 0; i < 6; i++) {
            const a = spin * 0.55 + i * Math.PI / 3;
            ctx.save();
            ctx.translate(Math.cos(a) * (r - 12), Math.sin(a) * (r - 12));
            ctx.rotate(a + Math.PI / 2);
            CharacterRenderer._strokeBloodGlyph(ctx, i, tier >= 2);
            ctx.restore();
        }

        // The oath triangle is the ritual's centre, not a separate aura.
        ctx.strokeStyle = tier >= 3 ? '#ffd0d5' : crimson;
        ctx.lineWidth = tier >= 4 ? 1.8 : 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.55);
        ctx.lineTo(r * 0.46, r * 0.34);
        ctx.lineTo(-r * 0.46, r * 0.34);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(0, r * 0.34, r * 0.48, r * 0.13, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Blood rises from the hem through the oath and into the moon. Motion
        // opposes the Voidweaver's inward gravity, keeping silhouettes distinct.
        const drops = tier >= 4 ? 12 : tier >= 2 ? 8 : 5;
        for (let i = 0; i < drops; i++) {
            const p = ((now * (0.00075 + tier * 0.00012)) + i / drops) % 1;
            const x = Math.sin(i * 2.7 + tier) * r * 0.42;
            const y = r * 0.42 - p * r * 1.25;
            ctx.fillStyle = i % 3 === 0 ? '#ffffff' : (i % 3 === 1 ? rose : '#ffa8b8');
            ctx.beginPath();
            ctx.arc(x, y, (tier >= 3 ? 1.9 : 1.3) * (1 - p * 0.28), 0, Math.PI * 2);
            ctx.fill();
        }

        // 100+: complete nested execution rings replace detached crescents so
        // the blade motif remains a deliberate, centered seal.
        if (tier >= 3) {
            ctx.strokeStyle = `rgba(255,168,184,${0.50 + tier * 0.07})`;
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.ellipse(0, -r * 0.08, r * 0.42, r * 0.76, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = `rgba(255,235,240,${0.34 + tier * 0.07})`;
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.ellipse(0, -r * 0.08, r * 0.29, r * 0.57, 0, 0, Math.PI * 2);
            ctx.stroke();
        }

        // 150+: eclipse corona; 200+: concentrated execution core and wide
        // harvest ring. Maximum tier is brighter, not an extra pile of layers.
        if (tier >= 4) {
            ctx.strokeStyle = `rgba(255,221,227,${0.68 + pulse * 0.22})`;
            ctx.lineWidth = tier >= 5 ? 2.1 : 1.4;
            ctx.beginPath();
            ctx.arc(0, moonY, moonR * 1.32, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (tier >= 5) {
            ctx.fillStyle = '#4a0010';
            ctx.beginPath();
            ctx.arc(0, 0, 7 + pulse * 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#ffffff';
            ctx.beginPath();
            ctx.arc(0, 0, 2.1 + pulse * 1.7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(255,168,184,${0.62 + pulse * 0.3})`;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.ellipse(0, r * 0.18, r + 9 + pulse * 4, (r + 9 + pulse * 4) * 0.30, 0, 0, Math.PI * 2);
            ctx.stroke();
        }
    }

    static draw(ctx, x, y, characterId, animProgress, stats, now = performance.now()) {
        ctx.save();
        if (!stats?.skipStreakOverlay) {
            CharacterRenderer.drawStreakOverlay(
                ctx, x, y, normalizeCharacter(characterId), stats?.combo || 0, now,
                !!stats?.arenaSkillActive
            );
        }
        switch (normalizeCharacter(characterId)) {
            case 'voidweaver':
                CharacterRenderer.drawVoidweaver(ctx, x, y, animProgress, stats, now);
                break;
            case 'bloodseeker':
                CharacterRenderer.drawBloodseeker(ctx, x, y, animProgress, stats, now);
                break;
            default:
                CharacterRenderer.drawWizard(ctx, x, y, animProgress, stats, now);
                break;
        }
        ctx.restore();
    }

    // =========================================================================
    // 1. THE ARCHMAGE (WIZARD) — GRAND CHRONO-ARCHMAGE (REAR PERSPECTIVE)
    // =========================================================================
    static drawWizard(ctx, cx, cy, animProgress, stats, now) {
        // Idle levitation hover
        const hoverY = Math.sin(now / 420) * 3.5;
        const wizX = cx;
        const wizY = cy + hoverY;
        const wandColor = (stats && stats.wandColor) ? stats.wandColor : '#00e5ff';
        const rawCombo = stats ? (stats.combo || 0) : 0;
        // An armed class active owns the focal space around the mage. The real
        // combo remains intact for gameplay, but the Arena renderer caps only
        // its visual escalation so the sigil stays dominant at high streaks.
        const combo = stats && stats.arenaSkillActive ? Math.min(rawCombo, 100) : rawCombo;
        const lowQ = window.__atLowQuality;

        ctx.save();

        // ---------------------------------------------------------------------
        // Layer 0: Astrological Chrono-Halo (Framing Upper Back & Cowl)
        // ---------------------------------------------------------------------
        ctx.save();
        const haloY = wizY - 22;
        const haloRadius = combo >= 100 ? 28 : 22;
        const haloRot = now * 0.0006;
        ctx.translate(wizX, haloY);
        ctx.rotate(haloRot);

        // Outer celestial dial ring
        ctx.beginPath();
        ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
        ctx.strokeStyle = combo >= 100 ? '#ffd700' : 'rgba(255, 215, 0, 0.38)';
        ctx.lineWidth = combo >= 100 ? 1.5 : 1.0;
        if (!lowQ && combo >= 50) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = 8;
        }
        ctx.stroke();

        // 8 Dial Ticks with 4 Cardinal Starlight Points
        for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            const isCardinal = i % 2 === 0;
            const r1 = haloRadius - (isCardinal ? 3.5 : 2.0);
            const r2 = haloRadius + (isCardinal ? 3.5 : 2.0);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * r1, Math.sin(a) * r1);
            ctx.lineTo(Math.cos(a) * r2, Math.sin(a) * r2);
            ctx.strokeStyle = isCardinal ? wandColor : 'rgba(255, 255, 255, 0.45)';
            ctx.lineWidth = isCardinal ? 1.4 : 0.8;
            ctx.stroke();
        }

        // Combo >= 100: Inner Reverse-Rotating Dashed Celestial Dial
        if (combo >= 100) {
            ctx.beginPath();
            ctx.arc(0, 0, 18, 0, Math.PI * 2);
            ctx.strokeStyle = wandColor;
            ctx.lineWidth = 1.0;
            ctx.setLineDash([3, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 1: Grand Arcane Mandala & Celestial Armillary (Option 1 & 4)
        // ---------------------------------------------------------------------
        const mandalaX = wizX;
        const mandalaY = wizY - 14;

        if (combo >= 10) {
            ctx.save();
            ctx.translate(mandalaX, mandalaY);

            const speedMult = 1.0 + Math.min(2.5, combo * 0.012);
            const rotClockwise = now * 0.0008 * speedMult;
            const rotCounter = -now * 0.0012 * speedMult;
            const pulse = Math.sin(now / 320) * 1.5;

            // --- Tier 1 (10+ Combo): Inner Sacred Rune Ring ---
            ctx.save();
            ctx.rotate(rotClockwise);
            ctx.strokeStyle = combo >= 50 ? '#ffd700' : 'rgba(255, 215, 0, 0.45)';
            ctx.lineWidth = combo >= 50 ? 1.5 : 1.0;
            if (!lowQ && combo >= 25) {
                ctx.shadowColor = wandColor;
                ctx.shadowBlur = combo >= 50 ? 10 : 6;
            }
            ctx.beginPath();
            ctx.arc(0, 0, 24 + pulse * 0.5, 0, Math.PI * 2);
            ctx.stroke();

            // 4 Cardinal Starlight Needles on Inner Ring
            for (let i = 0; i < 4; i++) {
                const a = (i * Math.PI) / 2;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * 20, Math.sin(a) * 20);
                ctx.lineTo(Math.cos(a) * 28, Math.sin(a) * 28);
                ctx.strokeStyle = wandColor;
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
            ctx.restore();

            // --- Tier 2 (25+ Combo): Dashed Counter-Rotating Astrolabe Dial ---
            if (combo >= 25) {
                ctx.save();
                ctx.rotate(rotCounter);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)';
                ctx.lineWidth = 1.2;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.arc(0, 0, 36 + pulse * 0.8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);

                // 8 Astrological Tick Marks
                for (let i = 0; i < 8; i++) {
                    const a = (i * Math.PI) / 4;
                    ctx.fillStyle = (i % 2 === 0) ? '#ffd700' : '#00e5ff';
                    ctx.beginPath();
                    ctx.arc(Math.cos(a) * 36, Math.sin(a) * 36, 1.4, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            }

            // --- Tier 3 (50+ Combo): The Grand Arcane Mandala (Sacred Hexagram) ---
            if (combo >= 50) {
                const alpha50 = Math.min(0.95, 0.55 + (combo - 50) * 0.008);
                ctx.save();
                ctx.globalAlpha = alpha50;

                // Ethereal Radial Aether Bloom
                const bloomRadius = 54 + pulse * 2;
                const bloom = ctx.createRadialGradient(0, 0, 10, 0, 0, bloomRadius);
                bloom.addColorStop(0, 'rgba(0, 229, 255, 0.22)');
                bloom.addColorStop(0.5, 'rgba(213, 0, 249, 0.12)');
                bloom.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = bloom;
                ctx.beginPath();
                ctx.arc(0, 0, bloomRadius, 0, Math.PI * 2);
                ctx.fill();

                // Outer Runic Boundary Wheel (52px)
                ctx.save();
                ctx.rotate(rotClockwise * 0.6);
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 1.8;
                if (!lowQ) {
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 12;
                }
                ctx.beginPath();
                ctx.arc(0, 0, 52 + pulse, 0, Math.PI * 2);
                ctx.stroke();

                // Concentric inner companion ring
                ctx.beginPath();
                ctx.arc(0, 0, 48 + pulse, 0, Math.PI * 2);
                ctx.lineWidth = 0.9;
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.6)';
                ctx.stroke();

                // 8 Compass Rays extending outward from wheel
                for (let r = 0; r < 8; r++) {
                    const ra = (r * Math.PI) / 4;
                    const isMajor = r % 2 === 0;
                    const rLen = isMajor ? (62 + pulse) : (56 + pulse);
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(ra) * 48, Math.sin(ra) * 48);
                    ctx.lineTo(Math.cos(ra) * rLen, Math.sin(ra) * rLen);
                    ctx.strokeStyle = isMajor ? '#ffd700' : 'rgba(0, 229, 255, 0.7)';
                    ctx.lineWidth = isMajor ? 1.5 : 1.0;
                    ctx.stroke();
                }
                ctx.restore();

                // Sacred Hexagram (Interlocking Equilateral Triangles, R=42px)
                ctx.save();
                ctx.rotate(rotCounter * 0.8);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.75)';
                ctx.lineWidth = 1.2;
                if (!lowQ) {
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = 8;
                }
                for (let t = 0; t < 2; t++) {
                    const offset = (t * Math.PI) / 3;
                    ctx.beginPath();
                    for (let p = 0; p < 3; p++) {
                        const pa = offset + (p * Math.PI * 2) / 3;
                        const px = Math.cos(pa) * 42;
                        const py = Math.sin(pa) * 42;
                        if (p === 0) ctx.moveTo(px, py);
                        else ctx.lineTo(px, py);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }

                // Hexagram Vertex Glyphs (6 Golden Star Points)
                for (let v = 0; v < 6; v++) {
                    const va = (v * Math.PI) / 3;
                    ctx.fillStyle = '#ffd700';
                    ctx.beginPath();
                    ctx.arc(Math.cos(va) * 42, Math.sin(va) * 42, 1.8, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
                ctx.restore();
            }

            // --- Tier 4 (75+ Combo): 12-Segment Zodiac Astrolabe Matrix ---
            if (combo >= 75) {
                ctx.save();
                ctx.rotate(rotClockwise * 1.2);
                ctx.strokeStyle = 'rgba(213, 0, 249, 0.65)';
                ctx.lineWidth = 1.0;
                ctx.beginPath();
                ctx.arc(0, 0, 60 + pulse * 1.2, 0, Math.PI * 2);
                ctx.stroke();

                for (let z = 0; z < 12; z++) {
                    const za = (z * Math.PI) / 6;
                    ctx.beginPath();
                    ctx.moveTo(Math.cos(za) * 56, Math.sin(za) * 56);
                    ctx.lineTo(Math.cos(za) * 60, Math.sin(za) * 60);
                    ctx.strokeStyle = '#d500f9';
                    ctx.lineWidth = 1.0;
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- Tier 5 (100+ Combo): Ascendant Dodecagram (12-Pointed Star Matrix) ---
            if (combo >= 100) {
                ctx.save();
                ctx.rotate(rotCounter * 0.5);
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 1.4;
                if (!lowQ) {
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 14;
                }

                // Outer Celestial Dial Ring (68px)
                ctx.beginPath();
                ctx.arc(0, 0, 68 + pulse * 1.5, 0, Math.PI * 2);
                ctx.stroke();

                // 4 Interlocking Equilateral Triangles forming 12-pointed Star
                for (let s = 0; s < 4; s++) {
                    const sOffset = (s * Math.PI) / 6;
                    ctx.beginPath();
                    for (let sp = 0; sp < 3; sp++) {
                        const spa = sOffset + (sp * Math.PI * 2) / 3;
                        const spx = Math.cos(spa) * 66;
                        const spy = Math.sin(spa) * 66;
                        if (sp === 0) ctx.moveTo(spx, spy);
                        else ctx.lineTo(spx, spy);
                    }
                    ctx.closePath();
                    ctx.stroke();
                }
                ctx.restore();
            }

            // --- Tier 6 (150+ Combo): 3D Gyroscopic Armillary Rings ---
            if (combo >= 150) {
                ctx.save();
                const gyroRotX = now * 0.0018;
                const gyroRotY = now * 0.0022;

                // Equatorial Armillary Ring (horizontal perspective ellipse)
                ctx.save();
                ctx.rotate(gyroRotX);
                ctx.strokeStyle = 'rgba(0, 229, 255, 0.8)';
                ctx.lineWidth = 1.6;
                if (!lowQ) {
                    ctx.shadowColor = '#00e5ff';
                    ctx.shadowBlur = 10;
                }
                ctx.beginPath();
                ctx.ellipse(0, 0, 76 + pulse * 2, 22 + pulse * 0.5, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();

                // Polar Armillary Ring (vertical perspective ellipse)
                ctx.save();
                ctx.rotate(gyroRotY + Math.PI / 3);
                ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
                ctx.lineWidth = 1.6;
                if (!lowQ) {
                    ctx.shadowColor = '#ffd700';
                    ctx.shadowBlur = 10;
                }
                ctx.beginPath();
                ctx.ellipse(0, 0, 76 + pulse * 2, 22 + pulse * 0.5, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                ctx.restore();
            }

            // --- Tier 7 (200+ Combo): Cosmic Singularity Core (Infinite Escalation) ---
            if (combo >= 200) {
                ctx.save();
                const bonusR = Math.min(24, Math.floor((combo - 200) / 50) * 5);
                const singR = 82 + bonusR + pulse * 2.5;

                // Blinding Singularity Halo
                const singGrad = ctx.createRadialGradient(0, 0, 5, 0, 0, singR);
                singGrad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
                singGrad.addColorStop(0.4, 'rgba(0, 229, 255, 0.25)');
                singGrad.addColorStop(0.8, 'rgba(213, 0, 249, 0.15)');
                singGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                ctx.fillStyle = singGrad;
                ctx.beginPath();
                ctx.arc(0, 0, singR, 0, Math.PI * 2);
                ctx.fill();

                // Outermost Singularity Ring
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1.8;
                if (!lowQ) {
                    ctx.shadowColor = '#ffffff';
                    ctx.shadowBlur = 16;
                }
                ctx.beginPath();
                ctx.arc(0, 0, singR, 0, Math.PI * 2);
                ctx.stroke();

                ctx.restore();
            }

            ctx.restore(); // Restore from translate(mandalaX, mandalaY)
        }

        // --- Ethereal Orbiting Lexicon: Background Leaves (Math.sin(angle) < 0) ---
        const numLeaves = combo >= 200 ? 12 : (combo >= 150 ? 10 : (combo >= 100 ? 8 : (combo >= 50 ? 6 : (combo >= 25 ? 4 : (combo >= 10 ? 2 : 0)))));
        const leafSpeedMult = 1.0 + Math.min(2.5, combo * 0.01);
        const leafOrbitRx = 46 + (combo >= 100 ? 10 : 0);
        const leafOrbitRy = 20 + (combo >= 100 ? 6 : 0);

        if (numLeaves > 0) {
            for (let l = 0; l < numLeaves; l++) {
                const lAngle = (now * 0.0016 * leafSpeedMult) + (l * Math.PI * 2) / numLeaves;
                if (Math.sin(lAngle) < 0) {
                    const lx = wizX + Math.cos(lAngle) * leafOrbitRx;
                    const ly = (wizY - 14) + Math.sin(lAngle) * leafOrbitRy;
                    CharacterRenderer._drawLexiconLeaf(ctx, lx, ly, lAngle, now, l, false, wandColor, lowQ);
                }
            }
        }

        // ---------------------------------------------------------------------
        // Layer 2: Ascendant Runic Ground Pedestal (Combo-Scaling)
        // ---------------------------------------------------------------------
        const pedestalY = cy + 22;
        ctx.save();
        ctx.translate(wizX, pedestalY);
        ctx.scale(1, 0.35); // Flatten to perspective ellipse

        const pPulse = Math.sin(now / 350) * 0.15;
        const pAlpha = combo >= 10 ? (0.65 + pPulse) : (0.42 + pPulse);

        // Primary outer arcane circle
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.strokeStyle = wandColor;
        ctx.lineWidth = combo >= 10 ? 2.0 : 1.4;
        ctx.globalAlpha = pAlpha;
        if (!lowQ && combo >= 10) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = 10;
        }
        ctx.stroke();

        // Combo >= 10: Secondary Inner Circle with Counter-Spinning Glyphs
        if (combo >= 10) {
            ctx.beginPath();
            ctx.arc(0, 0, 17, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.2;
            ctx.globalAlpha = pAlpha * 0.85;
            ctx.stroke();

            const innerAngle = -now * 0.0016;
            for (let t = 0; t < 6; t++) {
                const a = innerAngle + (t / 6) * Math.PI * 2;
                ctx.beginPath();
                ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.4, 0, Math.PI * 2);
                ctx.fillStyle = '#ffd700';
                ctx.fill();
            }
        }

        // Rotating outer glyph ticks
        const speedMult = combo >= 10 ? 2.4 : 1.0;
        const tickCount = 8;
        const glyphAngle = now * 0.0008 * speedMult;
        for (let t = 0; t < tickCount; t++) {
            const a = glyphAngle + (t / tickCount) * Math.PI * 2;
            ctx.beginPath();
            ctx.arc(Math.cos(a) * 26, Math.sin(a) * 26, 1.8, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();
        }
        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 3: Floating Astral Grimoire (Left Side)
        // ---------------------------------------------------------------------
        ctx.save();
        const bookHover = Math.sin(now / 320) * 2.0;
        const bookX = wizX - 22;
        const bookY = wizY - 6 + bookHover;
        const bookAngle = -0.16 + Math.sin(now / 400) * 0.05;

        ctx.translate(bookX, bookY);
        ctx.rotate(bookAngle);

        // Grimoire Tome Binding & Leather Cover
        ctx.fillStyle = '#21101e';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.roundRect(-13, -11, 26, 22, 2.5);
        ctx.fill();
        ctx.stroke();

        // Open Fluttering Parchment Pages
        const flutter = Math.sin(now / 160) * 0.8;
        // Left Page
        ctx.fillStyle = '#f4eedb';
        ctx.beginPath();
        ctx.moveTo(-1, -8);
        ctx.lineTo(-10, -9 + flutter * 0.4);
        ctx.lineTo(-10, 8 + flutter * 0.4);
        ctx.lineTo(-1, 9);
        ctx.closePath();
        ctx.fill();

        // Right Page
        ctx.fillStyle = '#eadebe';
        ctx.beginPath();
        ctx.moveTo(1, -8);
        ctx.lineTo(10, -9 - flutter * 0.4);
        ctx.lineTo(10, 8 - flutter * 0.4);
        ctx.lineTo(1, 9);
        ctx.closePath();
        ctx.fill();

        // Spine Inlay
        ctx.strokeStyle = '#c5a059';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(0, -9);
        ctx.lineTo(0, 9);
        ctx.stroke();

        // Hovering Runic Glyph above Pages
        const glyphGlow = Math.sin(now / 220) * 2.5 + 4;
        ctx.fillStyle = wandColor;
        ctx.font = 'bold 8px serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (!lowQ) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = glyphGlow;
        }
        ctx.fillText('✦', 0, -4);

        // Typing Spark Emissions from Grimoire
        if (animProgress > 0) {
            ctx.save();
            ctx.fillStyle = '#ffd700';
            ctx.globalAlpha = animProgress;
            for (let s = 0; s < 3; s++) {
                const sx = (s - 1) * 5;
                const sy = -12 - animProgress * 14 - s * 3;
                ctx.beginPath();
                ctx.arc(sx, sy, 1.2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 4: Upward Resonance Staff (Right Side)
        // ---------------------------------------------------------------------
        ctx.save();
        const staffRecoil = animProgress > 0 ? (animProgress * 0.22) : 0;
        const staffAngle = 0.24 - staffRecoil + Math.sin(now / 550) * 0.03;
        const staffBaseX = wizX + 15;
        const staffBaseY = wizY - 4;

        ctx.translate(staffBaseX, staffBaseY);
        ctx.rotate(staffAngle);

        // Staff Shaft (Obsidian duskwood with golden spiral inlays)
        ctx.fillStyle = '#221515';
        ctx.fillRect(-2, -44, 4.2, 50);
        ctx.strokeStyle = '#432924';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-2, -44, 4.2, 50);

        // Golden spiral filigree bindings
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.0;
        for (let b = 0; b < 3; b++) {
            const by = -10 - b * 12;
            ctx.beginPath();
            ctx.moveTo(-2, by);
            ctx.lineTo(2, by - 3);
            ctx.stroke();
        }

        // Twin Golden Crescent Prongs
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 2.0;
        ctx.beginPath();
        ctx.arc(0, -46, 7.5, Math.PI * 0.2, Math.PI * 0.8, true);
        ctx.stroke();

        // Gyroscopic Orbital Ring
        const ringAngle = now * 0.003;
        ctx.save();
        ctx.translate(0, -50);
        ctx.rotate(ringAngle);
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.7)';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.ellipse(0, 0, 7, 2.5, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();

        // Floating Faceted Prism Crystal
        const gemHover = Math.sin(now / 240) * 1.5;
        const gemGlow = 10 + Math.sin(now / 260) * 6 + animProgress * 22;
        ctx.save();
        ctx.translate(0, -50 + gemHover);
        ctx.rotate(now * 0.002);

        // Faceted Diamond Geometry
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(5.5, 0);
        ctx.lineTo(0, 8);
        ctx.lineTo(-5.5, 0);
        ctx.closePath();

        ctx.fillStyle = wandColor;
        if (!lowQ) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = gemGlow;
        }
        ctx.fill();
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.0;
        ctx.stroke();

        // Internal facet highlight
        ctx.beginPath();
        ctx.moveTo(0, -8);
        ctx.lineTo(2.5, 0);
        ctx.lineTo(0, 8);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
        ctx.stroke();

        // Combo >= 25: Radial Starlight Flare Rays from Crystal
        if (combo >= 25) {
            const flareLen = 8 + Math.sin(now / 180) * 3;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
            ctx.lineWidth = 1.2;
            for (let f = 0; f < 4; f++) {
                const fa = (f * Math.PI) / 2 + now * 0.002;
                ctx.beginPath();
                ctx.moveTo(Math.cos(fa) * 6, Math.sin(fa) * 6);
                ctx.lineTo(Math.cos(fa) * (6 + flareLen), Math.sin(fa) * (6 + flareLen));
                ctx.stroke();
            }
        }
        ctx.restore();

        // Attack Spell Discharge Flare & Upward Lance
        if (animProgress > 0) {
            ctx.save();
            ctx.translate(0, -50);

            // Radiant burst core
            ctx.beginPath();
            ctx.arc(0, 0, 14 * animProgress, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(255, 255, 255, ${animProgress * 0.85})`;
            if (!lowQ) {
                ctx.shadowColor = wandColor;
                ctx.shadowBlur = 25;
            }
            ctx.fill();

            // Upward starlight lance shooting into cosmos
            const lanceLength = 45 * animProgress;
            ctx.beginPath();
            ctx.moveTo(-3 * animProgress, 0);
            ctx.lineTo(0, -lanceLength);
            ctx.lineTo(3 * animProgress, 0);
            ctx.fillStyle = wandColor;
            ctx.fill();
            ctx.restore();
        }

        ctx.restore();

        // ---------------------------------------------------------------------
        // Layer 5: Rear-View Archmage Silhouette & Constellation Cloak
        // ---------------------------------------------------------------------
        const hemWave = Math.sin(now / 380) * 2.8;

        // Robe Undershadow Depth
        ctx.fillStyle = '#090312';
        ctx.beginPath();
        ctx.moveTo(wizX - 18, wizY + 18);
        ctx.lineTo(wizX - 13, wizY - 14);
        ctx.lineTo(wizX + 13, wizY - 14);
        ctx.lineTo(wizX + 18, wizY + 18);
        ctx.closePath();
        ctx.fill();

        // Cascading Velvet/Obsidian Cloak Body (Seen from Behind)
        ctx.fillStyle = '#140824';
        ctx.strokeStyle = '#321f4c';
        ctx.lineWidth = 1.3;

        ctx.beginPath();
        ctx.moveTo(wizX, wizY - 22);
        ctx.lineTo(wizX - 17 + hemWave * 0.4, wizY + 19);
        ctx.quadraticCurveTo(wizX, wizY + 23 + hemWave, wizX + 17 + hemWave * 0.4, wizY + 19);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cloak Velvet Depth Shading Folds
        ctx.strokeStyle = '#221138';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(wizX - 5, wizY - 10);
        ctx.lineTo(wizX - 7 + hemWave * 0.3, wizY + 18);
        ctx.moveTo(wizX + 5, wizY - 10);
        ctx.lineTo(wizX + 7 + hemWave * 0.3, wizY + 18);
        ctx.stroke();

        // Golden Embroidered Hem Trim with Runic Edge
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(wizX - 16 + hemWave * 0.4, wizY + 18);
        ctx.quadraticCurveTo(wizX, wizY + 22 + hemWave, wizX + 16 + hemWave * 0.4, wizY + 18);
        ctx.stroke();

        // Secondary inner gold hem thread
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.45)';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(wizX - 15 + hemWave * 0.4, wizY + 15.5);
        ctx.quadraticCurveTo(wizX, wizY + 19.5 + hemWave, wizX + 15 + hemWave * 0.4, wizY + 15.5);
        ctx.stroke();

        // ---------------------------------------------------------------------
        // Golden Astrological Constellation Tree (Embroidered on Cloak Back)
        // ---------------------------------------------------------------------
        const starNodes = [
            { x: wizX, y: wizY + 12 },          // Root Lumbar Star
            { x: wizX - 6.5, y: wizY + 6 },     // Lower-Left Star
            { x: wizX + 6.5, y: wizY + 6 },     // Lower-Right Star
            { x: wizX, y: wizY + 1 },           // Center Spine Star
            { x: wizX - 6.0, y: wizY - 4 },     // Mid-Left Star
            { x: wizX + 6.0, y: wizY - 4 },     // Mid-Right Star
            { x: wizX, y: wizY - 9 }            // Upper Nexus Star
        ];

        // Constellation Connecting Lines
        ctx.strokeStyle = 'rgba(255, 215, 0, 0.65)';
        ctx.lineWidth = 0.9;
        ctx.beginPath();
        // Spine line
        ctx.moveTo(starNodes[0].x, starNodes[0].y);
        ctx.lineTo(starNodes[3].x, starNodes[3].y);
        ctx.lineTo(starNodes[6].x, starNodes[6].y);
        // Lower branch
        ctx.moveTo(starNodes[1].x, starNodes[1].y);
        ctx.lineTo(starNodes[3].x, starNodes[3].y);
        ctx.lineTo(starNodes[2].x, starNodes[2].y);
        // Upper branch
        ctx.moveTo(starNodes[4].x, starNodes[4].y);
        ctx.lineTo(starNodes[6].x, starNodes[6].y);
        ctx.lineTo(starNodes[5].x, starNodes[5].y);
        ctx.stroke();

        // Pulsing Star Nodes
        for (let s = 0; s < starNodes.length; s++) {
            const node = starNodes[s];
            const pulse = 0.8 + Math.sin(now / 280 + s * 0.8) * 0.35;
            ctx.fillStyle = '#fff8e1';
            ctx.beginPath();
            ctx.arc(node.x, node.y, 1.2 * pulse, 0, Math.PI * 2);
            ctx.fill();

            // Tiny cross-glint on key nodes
            if (s === 0 || s === 3 || s === 6) {
                ctx.strokeStyle = '#ffd700';
                ctx.lineWidth = 0.8;
                ctx.beginPath();
                ctx.moveTo(node.x - 2.5, node.y);
                ctx.lineTo(node.x + 2.5, node.y);
                ctx.moveTo(node.x, node.y - 2.5);
                ctx.lineTo(node.x, node.y + 2.5);
                ctx.stroke();
            }
        }

        // Combo >= 25: Upward Drifting Starlight Embers from Cloak
        if (combo >= 25) {
            ctx.save();
            ctx.fillStyle = wandColor;
            for (let e = 0; e < 3; e++) {
                const emberCycle = ((now * 0.001 + e * 0.33) % 1.0);
                const emberX = wizX - 12 + e * 12 + Math.sin(now / 200 + e) * 3;
                const emberY = (wizY + 16) - emberCycle * 32;
                ctx.globalAlpha = (1 - emberCycle) * 0.8;
                ctx.beginPath();
                ctx.arc(emberX, emberY, 1.1, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // High Mantle & Pauldron Drapes (Upper Back Shoulders)
        ctx.fillStyle = '#1c0c32';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(wizX - 14, wizY - 14);
        ctx.quadraticCurveTo(wizX, wizY - 8, wizX + 14, wizY - 14);
        ctx.lineTo(wizX + 12, wizY - 21);
        ctx.quadraticCurveTo(wizX, wizY - 17, wizX - 12, wizY - 21);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Spine Brooch / Clasp
        ctx.fillStyle = '#ffd700';
        ctx.beginPath();
        ctx.arc(wizX, wizY - 14, 2.2, 0, Math.PI * 2);
        ctx.fill();

        // ---------------------------------------------------------------------
        // Layer 6: Sculpted Rear Cowl / Hood (Strictly Back Perspective)
        // ---------------------------------------------------------------------
        // Main Hood Curve (Back of Head)
        ctx.fillStyle = '#190a2c';
        ctx.strokeStyle = '#3d255c';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.arc(wizX, wizY - 23, 9.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Tall Sculpted Cowl Peak (Extending upward/back)
        ctx.fillStyle = '#120622';
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.1;
        ctx.beginPath();
        ctx.moveTo(wizX - 9.5, wizY - 22);
        ctx.quadraticCurveTo(wizX, wizY - 19, wizX + 9.5, wizY - 22);
        ctx.lineTo(wizX + 2, wizY - 44);
        ctx.lineTo(wizX - 2, wizY - 44);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Hood Fold Shadow (Spine Crease of Hood)
        ctx.strokeStyle = '#0a0214';
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(wizX, wizY - 42);
        ctx.quadraticCurveTo(wizX - 1, wizY - 30, wizX, wizY - 19);
        ctx.stroke();

        // Golden Cowl Border Trim
        ctx.fillStyle = '#ffd700';
        ctx.fillRect(wizX - 8, wizY - 23, 16, 2.4);

        // ---------------------------------------------------------------------
        // Layer 7: Ascendant Archmage Crown & Lightning (Combo >= 100)
        // ---------------------------------------------------------------------
        if (combo >= 100) {
            ctx.save();
            const crownY = wizY - 48 + Math.sin(now / 280) * 1.5;

            // Celestial Constellation Diadem (5 Golden Floating Stars)
            const crownStars = [
                { x: wizX - 12, y: crownY + 2 },
                { x: wizX - 6, y: crownY - 2 },
                { x: wizX, y: crownY - 6 },      // Apex Star
                { x: wizX + 6, y: crownY - 2 },
                { x: wizX + 12, y: crownY + 2 }
            ];

            // Crown Filigree Connecting Arcs
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.2;
            if (!lowQ) {
                ctx.shadowColor = '#ffd700';
                ctx.shadowBlur = 12;
            }
            ctx.beginPath();
            ctx.moveTo(crownStars[0].x, crownStars[0].y);
            for (let c = 1; c < crownStars.length; c++) {
                ctx.lineTo(crownStars[c].x, crownStars[c].y);
            }
            ctx.stroke();

            // Crown Star Nodes
            for (let c = 0; c < crownStars.length; c++) {
                const cs = crownStars[c];
                const isApex = c === 2;
                ctx.fillStyle = isApex ? '#ffffff' : '#ffd700';
                ctx.beginPath();
                ctx.arc(cs.x, cs.y, isApex ? 2.5 : 1.8, 0, Math.PI * 2);
                ctx.fill();
            }

            // Starlight Electricity Micro-Arcs
            ctx.strokeStyle = wandColor;
            ctx.lineWidth = 1.0;
            ctx.globalAlpha = 0.75;
            const arcSeed = Math.floor(now / 80);
            if (arcSeed % 2 === 0) {
                // Arc between Grimoire and Halo
                ctx.beginPath();
                ctx.moveTo(bookX, bookY - 6);
                ctx.lineTo(wizX - 12, wizY - 28);
                ctx.lineTo(wizX - 6, wizY - 36);
                ctx.stroke();

                // Arc between Staff and Crown
                ctx.beginPath();
                ctx.moveTo(staffBaseX, staffBaseY - 44);
                ctx.lineTo(wizX + 10, wizY - 38);
                ctx.lineTo(wizX + 4, crownY);
                ctx.stroke();
            }
            ctx.restore();
        }

        // ---------------------------------------------------------------------
        // Layer 8: Transcendent & Godlike Singularity Auras (Combo >= 150 & 200)
        // ---------------------------------------------------------------------
        // Ethereal Orbiting Lexicon: Foreground Leaves (Math.sin(angle) >= 0)
        if (numLeaves > 0) {
            for (let l = 0; l < numLeaves; l++) {
                const lAngle = (now * 0.0016 * leafSpeedMult) + (l * Math.PI * 2) / numLeaves;
                if (Math.sin(lAngle) >= 0) {
                    const lx = wizX + Math.cos(lAngle) * leafOrbitRx;
                    const ly = (wizY - 14) + Math.sin(lAngle) * leafOrbitRy;
                    CharacterRenderer._drawLexiconLeaf(ctx, lx, ly, lAngle, now, l, true, wandColor, lowQ);
                }
            }
        }

        if (combo >= 150) {
            ctx.save();
            const orbitRot = now * 0.002;
            const orbitCount = combo >= 200 ? 6 : 4;
            const orbitRadius = 38 + Math.sin(now / 180) * 4;

            // Orbiting Starlight Motes
            for (let o = 0; o < orbitCount; o++) {
                const angle = orbitRot + (o * Math.PI * 2) / orbitCount;
                const ox = wizX + Math.cos(angle) * orbitRadius;
                const oy = (wizY - 14) + Math.sin(angle) * (orbitRadius * 0.45); // Isometric elliptical orbit

                ctx.fillStyle = (o % 2 === 0) ? '#00e5ff' : '#ffd700';
                if (!lowQ) {
                    ctx.shadowColor = ctx.fillStyle;
                    ctx.shadowBlur = combo >= 200 ? 14 : 8;
                }
                ctx.beginPath();
                ctx.arc(ox, oy, combo >= 200 ? 3.0 : 2.0, 0, Math.PI * 2);
                ctx.fill();
            }

            // Combo >= 200: Godlike Singularity Radial Pulse
            if (combo >= 200) {
                const pulseR = 48 + ((now % 600) / 600) * 24;
                const pulseAlpha = Math.max(0, 1.0 - (now % 600) / 600) * 0.4;
                ctx.beginPath();
                ctx.ellipse(wizX, wizY - 14, pulseR, pulseR * 0.5, 0, 0, Math.PI * 2);
                ctx.strokeStyle = `rgba(255, 255, 255, ${pulseAlpha})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
            ctx.restore();
        }

        ctx.restore();
    }

    // =========================================================================
    // 2. THE VOIDWEAVER (AT-F16) — ASTRAL GRAVITATION & SINGULARITY MAGIC
    // =========================================================================
    /**
     * The card promises "Astral Gravitation & Singularity Magic", so the sprite
     * *shows* gravity rather than asserting it: the mote stream shrinks its orbit
     * every frame (falling inward, never outward), the well under the hem
     * collapses, and the head is framed by a horizon drawn as absence — a black
     * disc rimmed by light. Same anchor as the wizard: hem ≈ cy+19, cowl ≈ cy-42.
     */
    static drawVoidweaver(ctx, cx, cy, animProgress, stats, now) {
        const hoverY = Math.sin(now / 380) * 3.0;      // slower, heavier drift
        const vy = cy + hoverY;
        const combo = stats ? (stats.combo || 0) : 0;
        const lowQ = window.__atLowQuality;
        const coreY = vy - 30;                          // the singularity sits behind the cowl
        const coreR = combo >= 150 ? 13 : combo >= 50 ? 11 : 9;
        const fast = combo >= 150 ? 1.8 : combo >= 50 ? 1.25 : 1;
        const wellY = vy + 19;

        // AT-F15: the streak palette is brighter and cooler than the wells'
        // own photon rings, so the event-horizon magic circle reads as the
        // character's AURA rather than as more black holes. The wells keep
        // their exact deep cyan/violet + #01010a cores (the owner calls those
        // perfect); only the surrounding streak layers move to these lighter,
        // higher-value tints. Separation by VALUE is what stops the four
        // singularities from swallowing the streak.
        const hot = combo >= 50 ? '#7cf0ff' : '#4fd8f0';   // bright aqua
        const warm = combo >= 50 ? '#c4a6ff' : '#9d7cff';  // lit violet

        ctx.save();

        // --- Layer 0: the singularity (absence, rimmed by light) --------------
        ctx.save();
        ctx.translate(cx, coreY);
        ctx.beginPath();
        ctx.arc(0, 0, coreR, 0, Math.PI * 2);
        ctx.fillStyle = '#01010a';
        ctx.fill();
        const rings = combo >= 50 ? 2 : 1;
        for (let r = 0; r < rings; r++) {
            ctx.save();
            ctx.rotate((r ? -1 : 1) * now * 0.0009 * fast);
            ctx.beginPath();
            // COMPLETE rings (2π, never a partial arc): an open arc read as an
            // unfinished circle floating in the cowl rather than as a bounded
            // event horizon, which is the whole point of the silhouette.
            ctx.arc(0, 0, coreR + 2 + r * 2.6, 0, Math.PI * 2);
            ctx.strokeStyle = r ? 'rgba(124, 77, 255, 0.6)' : 'rgba(0, 229, 255, 0.9)';
            ctx.lineWidth = r ? 1.0 : 1.4;
            if (!lowQ && combo >= 50) {
                ctx.shadowColor = r ? '#7c4dff' : '#00e5ff';
                ctx.shadowBlur = 10;
            }
            ctx.stroke();
            ctx.restore();
        }
        // Photon ring — the bright thin edge where light bends around the void.
        ctx.beginPath();
        ctx.arc(0, 0, coreR + 0.6, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
        ctx.lineWidth = 0.7;
        ctx.stroke();
        ctx.restore();

        // --- Layer 1: the well the caster stands in (rings collapsing inward) --
        for (let w = 0; w < 3; w++) {
            const phase = ((now * 0.00035 * fast) + w / 3) % 1;
            const wr = 30 * (1 - phase);
            ctx.beginPath();
            ctx.ellipse(cx, wellY, wr, wr * 0.34, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(124, 77, 255, ${0.5 * phase + 0.08})`;
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.ellipse(cx, wellY, 6, 2.2, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.fill();

        // --- Layer 2: the body (baked once — see _bakeVoidBody) ---------------
        const body = CharacterRenderer._bakeVoidBody();
        ctx.drawImage(body, cx - CharacterRenderer.BODY_ANCHOR_X, vy - CharacterRenderer.BODY_ANCHOR_Y);

        // --- Layer 3: the pull (motes fall *toward* the core) -----------------
        const motes = combo >= 150 ? 7 : 5;
        for (let m = 0; m < motes; m++) {
            const p = ((now * 0.0011 * fast) + m / motes) % 1;   // 0 = far, 1 = core
            const ang = (m * 2.399) + Math.sin(now / 900 + m) * 0.25;
            const radius = 44 + (coreR - 44) * p;
            ctx.globalAlpha = Math.sin(p * Math.PI) * 0.9;
            ctx.fillStyle = m % 3 === 0 ? '#ffffff' : (m % 3 === 1 ? hot : warm);
            ctx.beginPath();
            ctx.arc(cx + Math.cos(ang) * radius * 0.75, coreY + Math.sin(ang) * radius * 0.42,
                1.4 - p * 0.5, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        // --- Layer 3.5: FOUR ARMED SINGULARITIES -----------------------------
        // The caster is not one black hole — it is four, held AROUND itself: two
        // tight inner wells and two wider outer ones, anchored at FIXED positions
        // (the owner's call — they are levitating in place, not orbiting, which
        // keeps the silhouette stable instead of continuously rearranging itself
        // during a streak). Every well is a COMPLETE photon ring around an
        // absence and keeps a slow breath so it never looks like a dead decal.
        const wellArm = [
            { dx: -21, dy: -7, size: 4.6, tilt: 0.55, phase: 0.0 },
            { dx: 21, dy: -7, size: 4.6, tilt: 0.55, phase: Math.PI },
            { dx: -37, dy: 2, size: 6.4, tilt: 0.34, phase: Math.PI / 2 },
            { dx: 37, dy: 2, size: 6.4, tilt: 0.34, phase: Math.PI * 1.5 }
        ];
        const armY = vy - 13;
        for (const w of wellArm) {
            const breath = 1 + Math.sin(now / 900 + w.phase) * 0.07;
            const size = w.size * breath;
            const wx = cx + w.dx;
            const wy = armY + w.dy;

            // Drifting specks falling INTO the well (still animated: the wells are
            // stationary, the matter they pull is not).
            for (let t = 1; t <= 2; t++) {
                const drift = ((now * 0.0009 + w.phase * 0.3) + t * 0.5) % 1;
                const r = (1 + t * 0.5) * (1 - drift);
                ctx.globalAlpha = 0.3 * drift;
                ctx.fillStyle = t % 2 ? hot : warm;
                ctx.beginPath();
                ctx.arc(wx + Math.cos(w.tilt + t) * size * r, wy + Math.sin(w.tilt + t) * size * r * 0.6,
                    0.7, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // The well itself: pure absence, rimmed by bent light.
            ctx.beginPath();
            ctx.arc(wx, wy, size, 0, Math.PI * 2);
            ctx.fillStyle = '#01010a';
            ctx.fill();

            // Photon ring — a complete circle, always.
            ctx.save();
            if (!lowQ) {
                ctx.shadowColor = '#00e5ff';
                ctx.shadowBlur = 7;
            }
            ctx.strokeStyle = w.size > 5 ? 'rgba(124, 77, 255, 0.95)' : 'rgba(0, 229, 255, 0.92)';
            ctx.lineWidth = w.size > 5 ? 1.2 : 0.9;
            ctx.beginPath();
            ctx.arc(wx, wy, size, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();

            // A tilted accretion sliver gives each well a spin direction.
            ctx.beginPath();
            ctx.ellipse(wx, wy, size * 1.7, size * 0.5, w.tilt, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(124, 77, 255, 0.5)';
            ctx.lineWidth = 0.6;
            ctx.stroke();
        }

        // --- Layer 4: combo tiers ---------------------------------------------
        if (combo >= 150) {
            // Lensed halo: two offset crescents of bent light around the horizon.
            ctx.save();
            ctx.translate(cx, coreY);
            for (let l = 0; l < 2; l++) {
                ctx.beginPath();
                ctx.arc(l ? 2.5 : -2.5, 0, coreR + 6.5, 0, Math.PI * 2);
                ctx.strokeStyle = l ? 'rgba(124, 240, 255, 0.55)' : 'rgba(196, 166, 255, 0.55)';
                ctx.lineWidth = 1.2;
                ctx.stroke();
            }
            ctx.restore();
            // Horizon pulse, collapsing outward from the caster's feet.
            const pulse = (now % 700) / 700;
            ctx.beginPath();
            ctx.ellipse(cx, wellY, 10 + pulse * 34, (10 + pulse * 34) * 0.34, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(124, 240, 255, ${(1 - pulse) * 0.6})`;
            ctx.lineWidth = 1.6;
            ctx.stroke();
        } else if (combo >= 50) {
            ctx.beginPath();
            ctx.arc(cx, coreY, coreR + 9, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(124, 240, 255, 0.38)';
            ctx.lineWidth = 1.1;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Bakes the Voidweaver's cloth body once. Everything expensive here
     * (gradients, the baked hem glow, the starfield cowl) becomes a plain
     * bitmap, so the live layers above stay cheap paths and never re-pay it.
     */
    static _bakeVoidBody() {
        return RenderCache.bake('char_body_voidweaver', CharacterRenderer.BODY_W, CharacterRenderer.BODY_H, (ctx) => {
            const x = CharacterRenderer.BODY_ANCHOR_X;
            const y = CharacterRenderer.BODY_ANCHOR_Y;

            // Cloth undershadow
            ctx.fillStyle = '#02030a';
            ctx.beginPath();
            ctx.moveTo(x - 19, y + 19);
            ctx.lineTo(x - 13, y - 15);
            ctx.lineTo(x + 13, y - 15);
            ctx.lineTo(x + 19, y + 19);
            ctx.closePath();
            ctx.fill();

            // Void-touched robe (rear view)
            const robe = ctx.createLinearGradient(x - 18, y - 22, x + 18, y + 20);
            robe.addColorStop(0, '#0a0e2c');
            robe.addColorStop(0.5, '#141c52');
            robe.addColorStop(1, '#070a20');
            ctx.fillStyle = robe;
            ctx.strokeStyle = '#1d2a6b';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(x, y - 24);
            ctx.lineTo(x - 17, y + 19);
            ctx.quadraticCurveTo(x, y + 23, x + 17, y + 19);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Collapsing fold lines down the spine
            ctx.strokeStyle = 'rgba(124, 77, 255, 0.5)';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(x - 5, y - 10);
            ctx.lineTo(x - 7, y + 18);
            ctx.moveTo(x + 5, y - 10);
            ctx.lineTo(x + 7, y + 18);
            ctx.stroke();

            // Cyan data-piping along the hem (glow paid once, here)
            ctx.save();
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 7;
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(x - 16, y + 18);
            ctx.quadraticCurveTo(x, y + 22, x + 16, y + 18);
            ctx.stroke();
            ctx.restore();

            // Shoulder mantle
            ctx.fillStyle = '#101542';
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(x - 14, y - 14);
            ctx.quadraticCurveTo(x, y - 8, x + 14, y - 14);
            ctx.lineTo(x + 12, y - 21);
            ctx.quadraticCurveTo(x, y - 17, x - 12, y - 21);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Orbital sash — the ring the caster is caught in.
            ctx.strokeStyle = 'rgba(124, 77, 255, 0.8)';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.ellipse(x, y - 4, 11, 3.2, 0, 0, Math.PI * 2);
            ctx.stroke();

            // Cowl: bent-light rim around a starfield (absence, not a face).
            ctx.fillStyle = '#050a24';
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y - 23, 9.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
            for (const star of [[-4, -2], [2, 1], [4, -4], [-1, 3], [0, -6], [-5, 4]]) {
                ctx.beginPath();
                ctx.arc(x + star[0], y - 23 + star[1], 0.7, 0, Math.PI * 2);
                ctx.fill();
            }
            // Tall cowl peak
            ctx.fillStyle = '#030614';
            ctx.beginPath();
            ctx.moveTo(x - 9.5, y - 22);
            ctx.quadraticCurveTo(x, y - 19, x + 9.5, y - 22);
            ctx.lineTo(x + 2, y - 42);
            ctx.lineTo(x - 2, y - 42);
            ctx.closePath();
            ctx.fill();
        });
    }

    // =========================================================================
    // 3. THE BLOODSEEKER (AT-F16) — ANCIENT BLOOD RUNES & NETHERBLADE
    // =========================================================================
    /**
     * The card promises "Ancient Blood Runes & Netherblade": the sprite carries a
     * code-drawn rune circle (six stroke glyphs — no glyph fonts, no rasters) that
     * wakes at 50 combo, the netherblade is held point-down in the baked body, and
     * the droplets travel *upward* out of the hem into the ring — the same arcane
     * pull the Voidweaver's motes obey, running the other way.
     */
    static drawBloodseeker(ctx, cx, cy, animProgress, stats, now) {
        const hoverY = Math.sin(now / 520) * 2.0;      // heavier: the hem barely clears the ground
        const by = cy + hoverY;
        const combo = stats ? (stats.combo || 0) : 0;
        const lowQ = window.__atLowQuality;
        const runeR = combo >= 150 ? 26 : combo >= 50 ? 23 : 20;
        const spin = now * 0.0005 * (combo >= 150 ? 2.0 : combo >= 50 ? 1.4 : 1);
        const sigY = by + 19;

        // AT-F15: the streak palette is deliberately NOT the blade's #ff1744.
        // Same hue at the same value made the aura and the weapon merge into a
        // single red mass, so the four netherblades appeared to overpower the
        // magic circle. The streak is a LIGHTER, pinker blood-rose — higher
        // value, lower saturation — so the eye reads it as light/aura and the
        // blade as dark metal. The blade keeps its own deep crimson; that
        // contrast is the fix, and moving the streak is cheaper (and less
        // disruptive) than repainting four weapons.
        const streak = combo >= 50 ? 'rgba(255, 141, 150, 0.95)' : 'rgba(255, 141, 150, 0.62)';
        const streakHot = '#ffd0d5';

        ctx.save();

        // --- Layer 0: the rune circle (dashed ring + six riding glyphs) -------
        ctx.save();
        ctx.translate(cx, by - 12);
        ctx.rotate(spin);
        ctx.beginPath();
        ctx.arc(0, 0, runeR, 0, Math.PI * 2);
        ctx.strokeStyle = streak;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        if (!lowQ && combo >= 50) {
            ctx.shadowColor = streakHot;
            ctx.shadowBlur = 11;
        }
        ctx.stroke();
        ctx.setLineDash([]);
        for (let g = 0; g < 6; g++) {
            const a = (g * Math.PI) / 3;
            ctx.save();
            ctx.translate(Math.cos(a) * runeR, Math.sin(a) * runeR);
            ctx.rotate(a + Math.PI / 2);
            CharacterRenderer._strokeBloodGlyph(ctx, g, combo >= 50);
            ctx.restore();
        }
        ctx.restore();

        // --- Layer 1: the oath sigil on the ground (the card's triangle) ------
        ctx.beginPath();
        ctx.moveTo(cx, sigY - 13);
        ctx.lineTo(cx + 13, sigY + 9);
        ctx.lineTo(cx - 13, sigY + 9);
        ctx.closePath();
        ctx.strokeStyle = streak;
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, sigY + 9, 13, 3.4, 0, 0, Math.PI * 2);
        ctx.stroke();

        // --- Layer 2: body + netherblade (baked once) -------------------------
        const body = CharacterRenderer._bakeBloodBody();
        ctx.drawImage(body, cx - CharacterRenderer.BODY_ANCHOR_X, by - CharacterRenderer.BODY_ANCHOR_Y);

        // --- Layer 3: droplets drawn *upward* into the ring -------------------
        const drops = combo >= 50 ? 7 : 5;
        for (let d = 0; d < drops; d++) {
            const p = ((now * 0.00105) + d / drops) % 1;
            const dy = (by + 17) - p * 34;
            const dx = cx - 9 + d * 3.6 + Math.sin(now / 260 + d) * 2.4;
            ctx.globalAlpha = Math.max(0, 1 - p) * 0.85;
            ctx.fillStyle = d % 3 === 0 ? streakHot : '#ff8d96';
            ctx.beginPath();
            ctx.arc(dx, dy, 1.3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
        // --- Layer 3.5: FOUR FLOATING NETHERBLADES -----------------------------
        // The hunter is surrounded, not armed with a single blade: four blades
        // hover AROUND him, all point-down (the orientation the held blade had,
        // so the card promise survives), two riding close and short, two riding
        // wide and long. Stationary like the Voidweaver's wells (owner's call),
        // which keeps the silhouette steady during a streak; the life-mote above
        // each blade still rises, so the harvest never looks frozen.
        // Sized off the body box (90 tall) using the owner's placement guide:
        // the inner pair reads ~46% of body height at the cowl, the outer ~63%
        // sitting wide and low, while the horizontal spread stays where the
        // guide put it (a hair past the robe on each side).
        const bladeArm = [
            // Inner pair: HIGH, at the cowl, riding clear of the robe.
            { dx: -38, dy: -13, len: 32, tilt: 0.13, phase: 0.0 },
            { dx: 38, dy: -13, len: 32, tilt: 0.13, phase: Math.PI },
            // Outer pair: WIDE and LOWER, with the longer blades.
            { dx: -60, dy: 4, len: 45, tilt: 0.17, phase: Math.PI / 2 },
            { dx: 60, dy: 4, len: 45, tilt: 0.17, phase: Math.PI * 1.5 }
        ];
        const bladeY = by - 12;
        // AT-F15: a leased blade is out of formation. `stats.bladeSlash.leases[i]`
        // is the Game-side lease (a blade in flight cannot be leased again, and
        // the cursor makes the four rotate 1→2→3→4), so the renderer only has to
        // read progress and lerp the blade to the boss.
        const leases = (stats && stats.bladeSlash && stats.bladeSlash.leases) || null;
        for (let bi = 0; bi < bladeArm.length; bi++) {
            const b = bladeArm[bi];
            const bx = cx + b.dx;
            const bpy = bladeY + b.dy;
            const breath = 1 + Math.sin(now / 1000 + b.phase) * 0.06;
            // The blades slant INWARD, so their points aim back at the hunter
            // from both sides instead of lying parallel like a picket fence.
            // Canvas +theta is clockwise and the tip is drawn below the origin,
            // so a blade LEFT of centre needs a negative angle to swing its tip
            // right, and vice versa. Deriving the sign from dx is what keeps the
            // pair mirrored — a hand-written lean per blade is exactly how one
            // side silently ends up parallel to (or splaying away from) the other.
            const lean = Math.sign(b.dx) * b.tilt;

            // Flight path, in four beats so the strike READS instead of
            // blinking past. The hover is the longest leg, because that
            // suspended moment in front of the boss is the whole point — the
            // blade arrives, overshoots into station like a rocket reaching
            // orbit, hangs trembling with its edge charging, then cuts. Launch
            // is a quick ejection and the recall is the shortest leg, so a fast
            // typist still cycles 1→2→3→4.
            //   0→0.24   LAUNCH  (ease-out acceleration off the anchor)
            //   0.24→0.60 HOVER   (overshoot past the boss, tremble, charge)
            //   0.60→0.76 SLASH   (the damage beat)
            //   0.76→1    RECALL  (quick snap home)
            let drawX = bx, drawY = bpy, drawRot = lean, alpha = 1, trailing = false;
            let charging = false;
            const lease = leases && leases[bi];
            if (lease) {
                const p = (now - lease.startedAt) / lease.duration;
                if (p >= 0 && p < 1) {
                    let k;                       // 0 = home, 1 = at the boss
                    let swing = 0;
                    if (p < 0.24) {
                        // Launch: quadratic ease-out reads as acceleration.
                        const u = p / 0.24;
                        k = 1 - (1 - u) * (1 - u);
                    } else if (p < 0.60) {
                        // Hover: hold station just PAST the boss (k > 1), with
                        // a tremble that tightens as the cut approaches.
                        const u = (p - 0.24) / 0.36;
                        k = 1 + Math.sin(u * Math.PI) * 0.09;
                        charging = true;
                    } else if (p < 0.76) {
                        k = 1;
                        swing = (p - 0.60) / 0.16;
                        trailing = true;
                    } else {
                        // Recall: quick smooth float home, blade retracts.
                        const u = (p - 0.76) / 0.24;
                        k = 1 - u * u * (3 - 2 * u);
                        swing = 1 - u;
                        trailing = true;
                    }
                    // Stop short of the boss centre so the blade reads as
                    // cutting across it rather than passing through.
                    const aimX = lease.targetX - Math.sign(b.dx) * 18;
                    const aimY = lease.targetY;
                    drawX = bx + (aimX - bx) * k;
                    drawY = bpy + (aimY - bpy) * k;
                    // Tremble while it hangs: a tight jitter that peaks mid-hover
                    // and is gone by the cut, so the pause feels like held
                    // pressure rather than a stall.
                    if (charging) {
                        const amp = 1.6 + Math.sin((p - 0.24) * 34) * 1.1;
                        drawX += Math.sin((p - 0.24) * 51) * amp;
                        drawY += Math.cos((p - 0.24) * 43) * amp;
                    }
                    // A fast diagonal arc across the boss, mirrored per side.
                    drawRot = lean + Math.sign(b.dx) * swing * 1.5
                        + (charging ? Math.sin((p - 0.24) * 30) * 0.06 : 0);
                    // Fully opaque through launch/hover/slash, then a short
                    // fade on the recall leg so it melts home.
                    alpha = p < 0.76 ? 1 : Math.max(0, 1 - (p - 0.76) / 0.24);
                    trailing = p >= 0.60;
                }
            }

            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(drawX, drawY);
            ctx.rotate(drawRot);

            // Blade body: dark steel, tapering to a point at the bottom. The width
            // tracks the length so the long outer pair reads as a real blade
            // rather than a thin needle next to the short inner pair, and stays
            // deliberately slender — the guide shows four light blades, not a
            // wall of red, so the guard/pommel below are kept just as restrained.
            const bl = b.len * breath;
            const bw = bl * 0.085;
            ctx.beginPath();
            ctx.moveTo(-bw, -bl);
            ctx.lineTo(bw, -bl);
            ctx.lineTo(bw * 0.52, bl * 0.62);
            ctx.lineTo(-bw * 0.52, bl * 0.62);
            ctx.closePath();
            ctx.fillStyle = '#0b0206';
            ctx.fill();

            // Crimson edge — the only bright line on the blade. It BRIGHTENS
            // through the hover beat so the pause is legibly "charging" rather
            // than the blade simply sitting still in mid-air.
            ctx.save();
            if (!lowQ) {
                ctx.shadowColor = charging ? '#ff6b88' : '#ff1744';
                ctx.shadowBlur = charging ? 13 : 7;
            }
            ctx.strokeStyle = charging ? 'rgba(255, 150, 170, 0.98)' : 'rgba(255, 23, 68, 0.92)';
            ctx.lineWidth = charging ? Math.max(1.3, bw * 0.78) : Math.max(0.85, bw * 0.5);
            ctx.stroke();
            ctx.restore();

            // Crossguard, so a blade is never just a floating line. Kept narrow
            // (2.4x the blade) and thin so it reads as a hilt detail rather than
            // a bar that thickens the silhouette.
            ctx.fillStyle = '#2b0710';
            ctx.fillRect(-bw * 1.2, -bl - 1.2, bw * 2.4, 1.2);
            // Pommel stone, catching the rune light.
            ctx.fillStyle = '#ff1744';
            ctx.beginPath();
            ctx.arc(0, -bl - 2.2, Math.max(0.8, bw * 0.4), 0, Math.PI * 2);
            ctx.fill();

            // Strike flash: while the blade is cutting, its edge burns white-hot
            // and a short arc trails behind the tip. This is what makes a
            // leasing blade read as an ATTACK rather than a blade drifting
            // across the screen.
            if (trailing) {
                ctx.save();
                if (!lowQ) {
                    ctx.shadowColor = '#ffd0d5';
                    ctx.shadowBlur = 12;
                }
                ctx.strokeStyle = 'rgba(255, 208, 213, 0.95)';
                ctx.lineWidth = Math.max(1.1, bw * 0.9);
                ctx.beginPath();
                ctx.moveTo(0, -bl * 0.4);
                ctx.lineTo(0, bl * 0.9);
                ctx.stroke();
                ctx.restore();

                // Motion arc, drawn in the blade's own frame so it trails the
                // swing instead of being a fixed decoration.
                ctx.save();
                ctx.globalAlpha = alpha * 0.5;
                ctx.strokeStyle = 'rgba(255, 141, 150, 0.75)';
                ctx.lineWidth = 1.1;
                ctx.beginPath();
                ctx.arc(0, 0, bl * 1.25, -0.9, 0.9);
                ctx.stroke();
                ctx.restore();
            }
            ctx.restore();

            // Each blade feeds the upward life-current it is harvesting. This
            // still animates, so a stationary blade never reads as a dead decal.
            // It follows the blade's DRAWN position, so a leased blade carries
            // its mote out to the boss instead of leaving it hanging at home.
            const rise = (now * 0.0011 + b.phase * 0.3) % 1;
            ctx.globalAlpha = 0.42 * (1 - rise) * alpha;
            ctx.fillStyle = streakHot;
            ctx.beginPath();
            ctx.arc(drawX, drawY - bl - 5 - rise * 8, 0.85, 0, Math.PI * 2);
            ctx.fill();
            ctx.globalAlpha = 1;
        }



        // --- Layer 4: combo tiers ---------------------------------------------
        if (combo >= 150) {
            // Blood moon: pale disc, crescent shadow, behind the cowl.
            ctx.save();
            ctx.translate(cx, by - 26);
            ctx.beginPath();
            ctx.arc(0, 0, 14, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(255, 176, 184, 0.20)';
            ctx.fill();
            ctx.strokeStyle = streak;
            ctx.lineWidth = 1.3;
            ctx.stroke();
            ctx.beginPath();
            ctx.arc(5, -3, 12, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(10, 2, 4, 0.5)';
            ctx.fill();
            ctx.restore();
            // Oath pulse spreading across the sigil.
            const pulse = (now % 640) / 640;
            ctx.beginPath();
            ctx.ellipse(cx, sigY + 9, 14 + pulse * 30, (14 + pulse * 30) * 0.28, 0, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255, 141, 150, ${(1 - pulse) * 0.5})`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.restore();
    }

    /**
     * Bakes the Bloodseeker's body, hood and netherblade once. The blade's
     * crimson edge glow is the expensive part and is spent here — per frame the
     * blade is a single drawImage plus one thin moving highlight.
     */
    static _bakeBloodBody() {
        return RenderCache.bake('char_body_bloodseeker', CharacterRenderer.BODY_W, CharacterRenderer.BODY_H, (ctx) => {
            const x = CharacterRenderer.BODY_ANCHOR_X;
            const y = CharacterRenderer.BODY_ANCHOR_Y;

            // ---- Cloth undershadow
            ctx.fillStyle = '#0a0205';
            ctx.beginPath();
            ctx.moveTo(x - 18, y + 20);
            ctx.lineTo(x - 13, y - 14);
            ctx.lineTo(x + 13, y - 14);
            ctx.lineTo(x + 18, y + 20);
            ctx.closePath();
            ctx.fill();

            // ---- Crimson-lined cloak (rear view), tattered hem
            const cloak = ctx.createLinearGradient(x - 18, y - 22, x + 18, y + 20);
            cloak.addColorStop(0, '#1a0409');
            cloak.addColorStop(0.5, '#360912');
            cloak.addColorStop(1, '#140306');
            ctx.fillStyle = cloak;
            ctx.strokeStyle = '#5c1420';
            ctx.lineWidth = 1.3;
            ctx.beginPath();
            ctx.moveTo(x, y - 24);
            ctx.lineTo(x - 16, y + 19);
            ctx.lineTo(x - 9, y + 16);
            ctx.lineTo(x - 4, y + 21);
            ctx.lineTo(x, y + 17);
            ctx.lineTo(x + 5, y + 21);
            ctx.lineTo(x + 10, y + 16);
            ctx.lineTo(x + 16, y + 19);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // ---- Severed-cord stitching: three glyphs bound down the spine
            ctx.strokeStyle = 'rgba(255, 23, 68, 0.75)';
            ctx.lineWidth = 0.9;
            ctx.beginPath();
            ctx.moveTo(x - 4, y - 4);
            ctx.lineTo(x + 4, y - 4);
            ctx.moveTo(x - 4, y + 1);
            ctx.lineTo(x + 4, y + 1);
            ctx.moveTo(x - 4, y + 6);
            ctx.lineTo(x + 2, y + 6);
            ctx.stroke();

            // ---- Waist belt with two hanging vials
            ctx.fillStyle = '#2b0710';
            ctx.fillRect(x - 13, y + 5, 26, 3.2);
            ctx.fillStyle = '#ff1744';
            ctx.fillRect(x - 8, y + 8.2, 2.4, 5);
            ctx.fillRect(x + 5, y + 8.2, 2.4, 4);
            ctx.fillStyle = '#ff8a95';
            ctx.fillRect(x - 7.6, y + 9.6, 1.6, 3.2);
            ctx.fillRect(x + 5.4, y + 9.4, 1.6, 2.6);

            // ---- Shoulder mantle (bone-trimmed pauldrons)
            ctx.fillStyle = '#280711';
            ctx.strokeStyle = '#ff1744';
            ctx.lineWidth = 1.0;
            ctx.beginPath();
            ctx.moveTo(x - 14, y - 14);
            ctx.quadraticCurveTo(x, y - 8, x + 14, y - 14);
            ctx.lineTo(x + 12, y - 21);
            ctx.quadraticCurveTo(x, y - 17, x - 12, y - 21);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // ---- Hood, deep and closed (nothing looks back)
            ctx.fillStyle = '#12030a';
            ctx.strokeStyle = '#ff1744';
            ctx.lineWidth = 1.2;
            ctx.beginPath();
            ctx.arc(x, y - 23, 9.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = '#3d0a12';
            ctx.beginPath();
            ctx.moveTo(x - 9.5, y - 22);
            ctx.quadraticCurveTo(x, y - 19, x + 9.5, y - 22);
            ctx.lineTo(x + 2, y - 42);
            ctx.lineTo(x - 2, y - 42);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
            // Fed edge highlight: the only bright line on the whole silhouette
            ctx.strokeStyle = '#ff8a95';
            ctx.lineWidth = 0.8;
            ctx.beginPath();
            ctx.moveTo(x - 8, y - 15);
            ctx.quadraticCurveTo(x, y - 10, x + 8, y - 15);
            ctx.stroke();
        });
    }

    /**
     * One of six runes, stroked inside a ~13px box centred on the origin. Drawn
     * from line/curve primitives on purpose: glyph fonts would be a raster-ish
     * dependency and would not scale-free or bake, and the house rule for
     * character art is procedural only.
     * @param {number} kind glyph index (wraps)
     * @param {boolean} lit true at 50+ combo — brighter, thicker, ember-shifted
     */
    static _strokeBloodGlyph(ctx, kind, lit) {
        ctx.strokeStyle = lit ? '#ff7a8a' : 'rgba(255, 23, 68, 0.85)';
        ctx.lineWidth = lit ? 1.3 : 1.0;
        ctx.beginPath();
        switch (kind % 6) {
            case 0: // stroke and two branches
                ctx.moveTo(-2, -6);
                ctx.lineTo(-2, 6);
                ctx.moveTo(-2, -1);
                ctx.lineTo(3, -4);
                ctx.moveTo(-2, 3);
                ctx.lineTo(2, 1);
                break;
            case 1: // the card's triangle, bound
                ctx.moveTo(0, -6);
                ctx.lineTo(4.5, 5);
                ctx.lineTo(-4.5, 5);
                ctx.closePath();
                break;
            case 2: // barred cross
                ctx.moveTo(-4, -4);
                ctx.lineTo(4, 4);
                ctx.moveTo(4, -4);
                ctx.lineTo(-4, 4);
                ctx.moveTo(-5, 0);
                ctx.lineTo(5, 0);
                break;
            case 3: // droplet
                ctx.moveTo(0, -6);
                ctx.quadraticCurveTo(4, 1, 0, 5);
                ctx.quadraticCurveTo(-4, 1, 0, -6);
                break;
            case 4: // angled tick stack
                ctx.moveTo(-4, -5);
                ctx.lineTo(0, -1);
                ctx.lineTo(0, 5);
                ctx.moveTo(3, -5);
                ctx.lineTo(3, 2);
                break;
            default: // hooked double stroke
                ctx.moveTo(-3, -6);
                ctx.quadraticCurveTo(-3, 0, 2, 0);
                ctx.lineTo(2, 5);
                ctx.moveTo(3, -6);
                ctx.lineTo(3, 2);
                break;
        }
        ctx.stroke();
    }

    /**
     * Renders an individual illuminated manuscript folio for the Ethereal Lexicon.
     */
    static _drawLexiconLeaf(ctx, lx, ly, angle, now, p, isForeground, wandColor, lowQ) {
        ctx.save();
        ctx.translate(lx, ly);
        const flutter = Math.sin(now / 140 + p * 1.5) * 0.2;
        ctx.rotate(angle + Math.PI / 2 + flutter);

        const scale = isForeground ? 1.0 : 0.78;
        ctx.scale(scale, scale);

        // Parchment Leaf Body (Ivory / Aged Gold with glowing edge)
        ctx.fillStyle = isForeground ? 'rgba(255, 252, 240, 0.92)' : 'rgba(235, 225, 200, 0.65)';
        if (!lowQ && isForeground) {
            ctx.shadowColor = wandColor;
            ctx.shadowBlur = 6;
        }
        ctx.fillRect(-3.5, -5.5, 7, 11);

        // Golden / Cyan illuminated border
        ctx.strokeStyle = isForeground ? '#ffd700' : 'rgba(255, 215, 0, 0.5)';
        ctx.lineWidth = 0.8;
        ctx.strokeRect(-3.5, -5.5, 7, 11);

        // Inscribed Runic Script Lines
        ctx.fillStyle = 'rgba(100, 70, 30, 0.75)';
        ctx.fillRect(-2, -3.5, 4, 1);
        ctx.fillRect(-2, -1, 3.5, 1);
        ctx.fillRect(-2, 1.5, 4, 1);

        // Illuminated Capital Letter Spark at top
        ctx.fillStyle = wandColor;
        ctx.beginPath();
        ctx.arc(0, -4.2, 0.9, 0, Math.PI * 2);
        ctx.fill();

        // Stardust trail spark behind leaf
        if (isForeground) {
            ctx.fillStyle = '#ffd700';
            ctx.globalAlpha = 0.7;
            ctx.beginPath();
            ctx.arc(-2, 7, 1.0, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();
    }
}

