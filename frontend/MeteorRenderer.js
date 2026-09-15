import { RenderCache } from './RenderCache.js';

/**
 * MeteorRenderer — Procedural Elemental Meteor System (AT-F7 & AT-F8)
 *
 * Fully replaces legacy raster meteor PNG sprites (fire.png, ice.png,
 * lightning.png, void.png) with procedurally generated, multi-layered
 * elemental auras baked once into offscreen canvases via RenderCache.
 *
 * Features:
 * - AT-F7 Void Rift: Deep singularity core with micro-starfield + bright teal/cyan
 *   event-horizon rim to ensure crisp contrast against dark game backgrounds.
 * - AT-F8 Procedural Elements:
 *     * Fire: Solar flare corona with twisting flame arcs & incandescent embers.
 *     * Ice: Crystalline glacial snowflake with sharp diamond facets & frost shimmer.
 *     * Lightning: High-voltage plasma orb with branching electric discharge arcs.
 * - Zero network requests, zero image decode hitches, zero synchronous pixel walks.
 * - Resolution-independent vector rendering baked to bitmap for maximum blit performance.
 */
export class MeteorRenderer {
    static FRAME_COUNT = 8;
    static BASE_SIZE = 200; // 200x200 px canvas per frame
    static CENTER = 100;

    constructor(elementName = 'fire', ticksPerFrame = 5) {
        this.elementName = MeteorRenderer.normalizeElement(elementName);
        this.ticksPerFrame = ticksPerFrame;
        this.frameIndex = Math.floor(Math.random() * MeteorRenderer.FRAME_COUNT);
        this.tickCount = 0;

        // Ensure all frames are pre-baked for this element
        MeteorRenderer.preloadElement(this.elementName);
    }

    static normalizeElement(element) {
        if (!element) return 'fire';
        const el = element.toLowerCase();
        if (el === 'dark') return 'void';
        if (el === 'thunder') return 'lightning';
        return ['fire', 'ice', 'lightning', 'void'].includes(el) ? el : 'fire';
    }

    /**
     * Pre-bakes all animation frames for the given element into RenderCache.
     */
    static preloadElement(element) {
        const norm = MeteorRenderer.normalizeElement(element);
        for (let f = 0; f < MeteorRenderer.FRAME_COUNT; f++) {
            const key = `meteor_${norm}_frame_${f}`;
            if (!RenderCache.has(key)) {
                RenderCache.bake(key, MeteorRenderer.BASE_SIZE, MeteorRenderer.BASE_SIZE, (ctx) => {
                    MeteorRenderer.renderFrame(ctx, norm, f, MeteorRenderer.FRAME_COUNT);
                });
            }
        }
    }

    /**
     * Pre-bakes the directional atmospheric comet tail for each element.
     */
    static getTail(element) {
        const norm = MeteorRenderer.normalizeElement(element);
        const key = `at_tail_${norm}`;
        return RenderCache.bake(key, 64, 128, (ctx) => {
            const tailGrad = ctx.createLinearGradient(32, 128, 32, 0);
            switch (norm) {
                case 'fire':
                    tailGrad.addColorStop(0, 'rgba(255, 215, 0, 0.85)');
                    tailGrad.addColorStop(0.3, 'rgba(255, 123, 84, 0.6)');
                    tailGrad.addColorStop(0.7, 'rgba(255, 75, 75, 0.25)');
                    tailGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    break;
                case 'ice':
                    tailGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
                    tailGrad.addColorStop(0.3, 'rgba(0, 229, 255, 0.65)');
                    tailGrad.addColorStop(0.7, 'rgba(41, 182, 246, 0.25)');
                    tailGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    break;
                case 'lightning':
                    tailGrad.addColorStop(0, 'rgba(255, 255, 255, 0.9)');
                    tailGrad.addColorStop(0.3, 'rgba(234, 128, 252, 0.7)');
                    tailGrad.addColorStop(0.7, 'rgba(213, 0, 249, 0.25)');
                    tailGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    break;
                case 'void':
                    tailGrad.addColorStop(0, 'rgba(0, 229, 255, 0.85)');
                    tailGrad.addColorStop(0.4, 'rgba(29, 233, 182, 0.5)');
                    tailGrad.addColorStop(0.8, 'rgba(0, 191, 165, 0.2)');
                    tailGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
                    break;
            }
            ctx.fillStyle = tailGrad;
            ctx.beginPath();
            ctx.moveTo(14, 128);
            ctx.quadraticCurveTo(22, 50, 32, 0);
            ctx.quadraticCurveTo(42, 50, 50, 128);
            ctx.closePath();
            ctx.fill();
        });
    }

    /**
     * Preload all elements across the entire game on startup.
     */
    static preloadAll() {
        ['fire', 'ice', 'lightning', 'void'].forEach(el => {
            MeteorRenderer.preloadElement(el);
            MeteorRenderer.getTail(el);
        });
    }

    /**
     * Renders a specific frame for an element into the provided offscreen context.
     */
    static renderFrame(ctx, element, frameIndex, totalFrames) {
        const cx = MeteorRenderer.CENTER;
        const cy = MeteorRenderer.CENTER;
        const phase = (frameIndex / totalFrames) * Math.PI * 2;

        ctx.save();
        ctx.clearRect(0, 0, MeteorRenderer.BASE_SIZE, MeteorRenderer.BASE_SIZE);

        switch (element) {
            case 'void':
                MeteorRenderer.drawVoidRift(ctx, cx, cy, phase, frameIndex);
                break;
            case 'fire':
                MeteorRenderer.drawFireCorona(ctx, cx, cy, phase, frameIndex);
                break;
            case 'ice':
                MeteorRenderer.drawIceGlacialStar(ctx, cx, cy, phase, frameIndex);
                break;
            case 'lightning':
                MeteorRenderer.drawLightningCore(ctx, cx, cy, phase, frameIndex);
                break;
        }

        ctx.restore();
    }

    // =========================================================================
    // AT-F7: VOID RIFT (Dark Singularity with High-Contrast Teal Rim)
    // =========================================================================
    static drawVoidRift(ctx, cx, cy, phase, frameIndex) {
        // 1. Gravitational lensing distortion halo (outer teal/cyan glow)
        const outerGlow = ctx.createRadialGradient(cx, cy, 30, cx, cy, 85);
        outerGlow.addColorStop(0, 'rgba(0, 229, 255, 0.4)');
        outerGlow.addColorStop(0.5, 'rgba(29, 233, 182, 0.25)');
        outerGlow.addColorStop(0.85, 'rgba(0, 191, 165, 0.08)');
        outerGlow.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = outerGlow;
        ctx.beginPath();
        ctx.arc(cx, cy, 85, 0, Math.PI * 2);
        ctx.fill();

        // 2. Rotating Accretion Tendrils (spiraling into the void)
        const armCount = 4;
        for (let i = 0; i < armCount; i++) {
            const baseAngle = (i / armCount) * Math.PI * 2 + phase;
            ctx.save();
            ctx.beginPath();
            
            const startR = 75;
            const endR = 32;
            const sx = cx + Math.cos(baseAngle) * startR;
            const sy = cy + Math.sin(baseAngle) * startR;
            const cpAngle = baseAngle + 0.6;
            const cpR = 52;
            const cpx = cx + Math.cos(cpAngle) * cpR;
            const cpy = cy + Math.sin(cpAngle) * cpR;
            const ex = cx + Math.cos(baseAngle + 1.2) * endR;
            const ey = cy + Math.sin(baseAngle + 1.2) * endR;

            ctx.moveTo(sx, sy);
            ctx.quadraticCurveTo(cpx, cpy, ex, ey);

            ctx.strokeStyle = i % 2 === 0 ? 'rgba(0, 229, 255, 0.85)' : 'rgba(29, 233, 182, 0.75)';
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Accent tip spark
            ctx.beginPath();
            ctx.arc(sx, sy, 2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            ctx.restore();
        }

        // 3. Event Horizon (Bright Vibrant Teal/Cyan Rim for high contrast)
        ctx.save();
        ctx.beginPath();
        ctx.arc(cx, cy, 33, 0, Math.PI * 2);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = 3.0;
        ctx.shadowColor = '#00e5ff';
        ctx.shadowBlur = 12;
        ctx.stroke();

        // Secondary inner turquoise rim
        ctx.beginPath();
        ctx.arc(cx, cy, 31, 0, Math.PI * 2);
        ctx.strokeStyle = '#1de9b6';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // 4. Singularity Core (Cosmic ultra-dark gradient)
        ctx.save();
        const coreGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 31);
        coreGrad.addColorStop(0, '#040108');
        coreGrad.addColorStop(0.7, '#0b0616');
        coreGrad.addColorStop(1, '#15092a');

        ctx.beginPath();
        ctx.arc(cx, cy, 30.5, 0, Math.PI * 2);
        ctx.fillStyle = coreGrad;
        ctx.fill();
        ctx.clip(); // Restrict stars to core interior

        // 5. Micro Cosmic Starfield inside core
        const stars = [
            { x: -14, y: -10, r: 1.2, a: 0.9 },
            { x: 12, y: -15, r: 0.9, a: 0.8 },
            { x: -8, y: 14, r: 1.4, a: 0.95 },
            { x: 16, y: 8, r: 0.8, a: 0.75 },
            { x: 0, y: -6, r: 1.0, a: 0.85 },
            { x: 7, y: 16, r: 1.1, a: 0.9 },
            { x: -18, y: 4, r: 0.7, a: 0.7 }
        ];

        stars.forEach((s, idx) => {
            const rotA = phase * 0.4 + idx;
            const dist = Math.sqrt(s.x * s.x + s.y * s.y);
            const px = cx + Math.cos(rotA) * dist;
            const py = cy + Math.sin(rotA) * dist;
            const flicker = 0.6 + Math.sin(phase * 2 + idx) * 0.4;

            ctx.beginPath();
            ctx.arc(px, py, s.r, 0, Math.PI * 2);
            ctx.fillStyle = idx % 2 === 0 
                ? `rgba(255, 255, 255, ${s.a * flicker})` 
                : `rgba(0, 229, 255, ${s.a * flicker})`;
            ctx.fill();
        });

        // 6. Crackling gravitational tendrils across horizon
        const crackleCount = 3;
        for (let c = 0; c < crackleCount; c++) {
            const crackAngle = phase * 1.5 + (c * Math.PI * 2) / crackleCount;
            const r1 = 28;
            const r2 = 33;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(crackAngle) * r1, cy + Math.sin(crackAngle) * r1);
            ctx.lineTo(cx + Math.cos(crackAngle + 0.15) * (r1 + r2) / 2, cy + Math.sin(crackAngle + 0.15) * (r1 + r2) / 2);
            ctx.lineTo(cx + Math.cos(crackAngle - 0.05) * r2, cy + Math.sin(crackAngle - 0.05) * r2);
            ctx.strokeStyle = '#80d8ff';
            ctx.lineWidth = 1.2;
            ctx.stroke();
        }

        ctx.restore();
    }

    // =========================================================================
    // AT-F8: FIRE CORONA (Solar Flares & Fiery Swirling Vortex)
    // =========================================================================
    static drawFireCorona(ctx, cx, cy, phase, frameIndex) {
        // 1. Warm outer heat haze glow
        const haze = ctx.createRadialGradient(cx, cy, 20, cx, cy, 90);
        haze.addColorStop(0, 'rgba(255, 123, 84, 0.45)');
        haze.addColorStop(0.5, 'rgba(255, 75, 75, 0.25)');
        haze.addColorStop(0.85, 'rgba(230, 81, 0, 0.08)');
        haze.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = haze;
        ctx.beginPath();
        ctx.arc(cx, cy, 90, 0, Math.PI * 2);
        ctx.fill();

        // 2. Dynamic Solar Flare Petals (Multi-tier tongues)
        const flameTiers = [
            { count: 10, minR: 35, maxR: 76, color: 'rgba(255, 75, 75, 0.85)', spin: phase },
            { count: 8,  minR: 30, maxR: 64, color: 'rgba(255, 123, 84, 0.9)', spin: -phase * 1.2 },
            { count: 7,  minR: 24, maxR: 52, color: 'rgba(255, 215, 0, 0.95)', spin: phase * 1.5 }
        ];

        flameTiers.forEach(tier => {
            ctx.save();
            ctx.beginPath();
            const step = (Math.PI * 2) / (tier.count * 2);
            for (let i = 0; i <= tier.count * 2; i++) {
                const angle = i * step + tier.spin;
                const isPeak = i % 2 === 1;
                const wave = Math.sin(angle * 3 + phase * 2) * 6;
                const r = isPeak ? (tier.maxR + wave) : tier.minR;
                const px = cx + Math.cos(angle) * r;
                const py = cy + Math.sin(angle) * r;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.fillStyle = tier.color;
            ctx.fill();
            ctx.restore();
        });

        // 3. Orbiting Ember Sparks
        const emberCount = 6;
        for (let e = 0; e < emberCount; e++) {
            const eAngle = phase * 2 + (e * Math.PI * 2) / emberCount;
            const eDist = 48 + Math.sin(phase * 3 + e) * 22;
            const ex = cx + Math.cos(eAngle) * eDist;
            const ey = cy + Math.sin(eAngle) * eDist;
            const eRadius = 1.2 + Math.sin(phase * 4 + e) * 0.8;

            ctx.beginPath();
            ctx.arc(ex, ey, Math.max(0.8, eRadius), 0, Math.PI * 2);
            ctx.fillStyle = e % 2 === 0 ? '#ffd700' : '#ffffff';
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = 6;
            ctx.fill();
        }

        // 4. White-Hot Incandescent Core
        const core = ctx.createRadialGradient(cx, cy, 2, cx, cy, 24);
        core.addColorStop(0, '#ffffff');
        core.addColorStop(0.4, '#fff9c4');
        core.addColorStop(0.7, '#ffd700');
        core.addColorStop(1, '#ff7b54');

        ctx.beginPath();
        ctx.arc(cx, cy, 24, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.shadowColor = '#ffd700';
        ctx.shadowBlur = 10;
        ctx.fill();
    }

    // =========================================================================
    // AT-F8: ICE GLACIAL STAR (Hexagonal Crystalline Shards & Frost Shimmer)
    // =========================================================================
    static drawIceGlacialStar(ctx, cx, cy, phase, frameIndex) {
        // 1. Cold arctic halo glow
        const frostHalo = ctx.createRadialGradient(cx, cy, 25, cx, cy, 86);
        frostHalo.addColorStop(0, 'rgba(179, 229, 252, 0.4)');
        frostHalo.addColorStop(0.5, 'rgba(41, 182, 246, 0.22)');
        frostHalo.addColorStop(0.85, 'rgba(2, 119, 189, 0.06)');
        frostHalo.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = frostHalo;
        ctx.beginPath();
        ctx.arc(cx, cy, 86, 0, Math.PI * 2);
        ctx.fill();

        // 2. Concentric Hexagonal Rune Rings
        ctx.save();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
        ctx.lineWidth = 1.5;
        const hexAngles = 6;
        ctx.beginPath();
        for (let h = 0; h <= hexAngles; h++) {
            const a = (h / hexAngles) * Math.PI * 2 + phase * 0.3;
            const hx = cx + Math.cos(a) * 44;
            const hy = cy + Math.sin(a) * 44;
            if (h === 0) ctx.moveTo(hx, hy);
            else ctx.lineTo(hx, hy);
        }
        ctx.closePath();
        ctx.stroke();
        ctx.restore();

        // 3. Six Main Glacial Spires (Diamond crystal geometry)
        for (let s = 0; s < 6; s++) {
            const spireAngle = (s / 6) * Math.PI * 2 + phase * 0.5;
            const spireLen = 68 + Math.sin(phase * 2 + s) * 5;
            const sideAngle1 = spireAngle + 0.18;
            const sideAngle2 = spireAngle - 0.18;
            const midR = 26;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(sideAngle1) * midR, cy + Math.sin(sideAngle1) * midR);
            ctx.lineTo(cx + Math.cos(spireAngle) * spireLen, cy + Math.sin(spireAngle) * spireLen);
            ctx.lineTo(cx + Math.cos(sideAngle2) * midR, cy + Math.sin(sideAngle2) * midR);
            ctx.closePath();

            // Facet gradient
            const facetGrad = ctx.createLinearGradient(
                cx, cy,
                cx + Math.cos(spireAngle) * spireLen,
                cy + Math.sin(spireAngle) * spireLen
            );
            facetGrad.addColorStop(0, '#0277bd');
            facetGrad.addColorStop(0.5, '#29b6f6');
            facetGrad.addColorStop(0.9, '#b3e5fc');
            facetGrad.addColorStop(1, '#ffffff');

            ctx.fillStyle = facetGrad;
            ctx.fill();

            // Sharp edge line for crystal definition
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 1.0;
            ctx.stroke();

            // Center ridge line
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(spireAngle) * spireLen, cy + Math.sin(spireAngle) * spireLen);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
            ctx.lineWidth = 1.2;
            ctx.stroke();

            ctx.restore();
        }

        // 4. Six Minor Intermediate Shards
        for (let m = 0; m < 6; m++) {
            const mAngle = (m / 6) * Math.PI * 2 + (Math.PI / 6) + phase * 0.5;
            const mLen = 42 + Math.sin(phase * 3 + m) * 4;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx, cy);
            ctx.lineTo(cx + Math.cos(mAngle + 0.12) * 18, cy + Math.sin(mAngle + 0.12) * 18);
            ctx.lineTo(cx + Math.cos(mAngle) * mLen, cy + Math.sin(mAngle) * mLen);
            ctx.lineTo(cx + Math.cos(mAngle - 0.12) * 18, cy + Math.sin(mAngle - 0.12) * 18);
            ctx.closePath();

            ctx.fillStyle = 'rgba(0, 229, 255, 0.75)';
            ctx.fill();
            ctx.strokeStyle = '#e1f5fe';
            ctx.lineWidth = 0.8;
            ctx.stroke();
            ctx.restore();
        }

        // 5. Frost Sparkles at spire tips
        for (let t = 0; t < 6; t++) {
            const tAngle = (t / 6) * Math.PI * 2 + phase * 0.5;
            const tLen = 68 + Math.sin(phase * 2 + t) * 5;
            const tx = cx + Math.cos(tAngle) * tLen;
            const ty = cy + Math.sin(tAngle) * tLen;

            ctx.beginPath();
            ctx.arc(tx, ty, 2.2, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.shadowColor = '#00e5ff';
            ctx.shadowBlur = 8;
            ctx.fill();
        }

        // 6. Glacial Core
        const core = ctx.createRadialGradient(cx, cy, 2, cx, cy, 20);
        core.addColorStop(0, '#ffffff');
        core.addColorStop(0.5, '#80d8ff');
        core.addColorStop(1, '#0288d1');

        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.shadowColor = '#b3e5fc';
        ctx.shadowBlur = 10;
        ctx.fill();
    }

    // =========================================================================
    // AT-F8: LIGHTNING STORM CORE (Plasma Orb & Branching Electric Arcs)
    // =========================================================================
    static drawLightningCore(ctx, cx, cy, phase, frameIndex) {
        // 1. High-voltage plasma haze
        const plasmaHaze = ctx.createRadialGradient(cx, cy, 20, cx, cy, 88);
        plasmaHaze.addColorStop(0, 'rgba(213, 0, 249, 0.45)');
        plasmaHaze.addColorStop(0.5, 'rgba(124, 77, 255, 0.25)');
        plasmaHaze.addColorStop(0.85, 'rgba(74, 20, 140, 0.08)');
        plasmaHaze.addColorStop(1, 'rgba(0, 0, 0, 0)');

        ctx.fillStyle = plasmaHaze;
        ctx.beginPath();
        ctx.arc(cx, cy, 88, 0, Math.PI * 2);
        ctx.fill();

        // 2. Pulsing Ionization Ring (Segmented electric circle)
        ctx.save();
        const segments = 12;
        const ringR = 52;
        ctx.lineWidth = 1.8;
        ctx.strokeStyle = '#ea80fc';
        ctx.shadowColor = '#d500f9';
        ctx.shadowBlur = 8;

        for (let seg = 0; seg < segments; seg++) {
            if ((seg + frameIndex) % 3 === 0) continue; // broken gaps
            const a1 = (seg / segments) * Math.PI * 2 + phase;
            const a2 = ((seg + 0.8) / segments) * Math.PI * 2 + phase;
            ctx.beginPath();
            ctx.arc(cx, cy, ringR, a1, a2);
            ctx.stroke();
        }
        ctx.restore();

        // 3. Jagged Branching Lightning Arcs
        const boltCount = 5;
        for (let b = 0; b < boltCount; b++) {
            const boltAngle = (b / boltCount) * Math.PI * 2 + phase * 0.8;
            const totalLen = 64 + ((b * 17 + frameIndex * 23) % 18);
            const segCount = 4;
            let curX = cx + Math.cos(boltAngle) * 20;
            let curY = cy + Math.sin(boltAngle) * 20;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(curX, curY);

            for (let s = 1; s <= segCount; s++) {
                const prog = s / segCount;
                const baseR = 20 + prog * totalLen;
                const jitterSeed = (b * 31 + s * 13 + frameIndex * 7) % 21 - 10;
                const jitterAngle = boltAngle + Math.PI / 2;
                const nextX = cx + Math.cos(boltAngle) * baseR + Math.cos(jitterAngle) * jitterSeed;
                const nextY = cy + Math.sin(boltAngle) * baseR + Math.sin(jitterAngle) * jitterSeed;

                ctx.lineTo(nextX, nextY);
                curX = nextX;
                curY = nextY;
            }

            ctx.strokeStyle = b % 2 === 0 ? '#ffffff' : '#ea80fc';
            ctx.lineWidth = 2.0;
            ctx.shadowColor = '#d500f9';
            ctx.shadowBlur = 10;
            ctx.lineCap = 'round';
            ctx.stroke();

            // Vertex spark
            ctx.beginPath();
            ctx.arc(curX, curY, 2.0, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.fill();

            ctx.restore();
        }

        // 4. Secondary micro electric arcs circling the core
        const microCount = 6;
        for (let m = 0; m < microCount; m++) {
            const ma1 = (m / microCount) * Math.PI * 2 - phase * 1.5;
            const ma2 = ma1 + 0.5;
            const mr = 32 + ((m * 11 + frameIndex * 5) % 8);
            ctx.beginPath();
            ctx.arc(cx, cy, mr, ma1, ma2);
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
            ctx.lineWidth = 1.0;
            ctx.stroke();
        }

        // 5. Plasma Core (Electric violet-white glow)
        const core = ctx.createRadialGradient(cx, cy, 2, cx, cy, 22);
        core.addColorStop(0, '#ffffff');
        core.addColorStop(0.3, '#f3e5f5');
        core.addColorStop(0.7, '#d500f9');
        core.addColorStop(1, '#4a148c');

        ctx.beginPath();
        ctx.arc(cx, cy, 22, 0, Math.PI * 2);
        ctx.fillStyle = core;
        ctx.shadowColor = '#ea80fc';
        ctx.shadowBlur = 14;
        ctx.fill();
    }

    // =========================================================================
    // RUNTIME UPDATE & DRAW
    // =========================================================================
    update(dt = 16.67) {
        this.tickCount += 1;
        if (this.tickCount >= this.ticksPerFrame) {
            this.tickCount = 0;
            this.frameIndex = (this.frameIndex + 1) % MeteorRenderer.FRAME_COUNT;
        }
    }

    /**
     * Draws the meteor aura centered at (x, y) with rotation, directional comet wake,
     * and keystroke destabilization flare.
     * Compatible with legacy calls and new options.
     */
    draw(ctx, x = 0, y = 0, targetWidth = 100, arg5 = 0, arg6 = false, typingProgress = 0) {
        let angle = 0;
        let isTargeted = false;

        if (typeof arg5 === 'object' && arg5 !== null) {
            angle = arg5.angle || 0;
            isTargeted = !!arg5.isTargeted;
            typingProgress = arg5.typingProgress || 0;
        } else if (typeof arg5 === 'number') {
            angle = arg5;
            isTargeted = !!arg6;
        } else if (typeof arg5 === 'string') {
            if (arg5) this.elementName = MeteorRenderer.normalizeElement(arg5);
            angle = typeof arg6 === 'number' ? arg6 : 0;
        }

        const key = `meteor_${this.elementName}_frame_${this.frameIndex}`;
        let cachedCanvas = RenderCache.get(key);

        if (!cachedCanvas) {
            MeteorRenderer.preloadElement(this.elementName);
            cachedCanvas = RenderCache.get(key);
            if (!cachedCanvas) return;
        }

        const auraScale = (targetWidth / MeteorRenderer.BASE_SIZE) * 1.5;
        const drawWidth = MeteorRenderer.BASE_SIZE * auraScale;
        const drawHeight = MeteorRenderer.BASE_SIZE * auraScale;
        const now = performance.now();

        ctx.save();

        ctx.translate(x, y);
        ctx.rotate(angle);

        // 1. Directional Atmospheric Comet Tail (Pre-baked in RenderCache, 0 heap allocations)
        const tailLen = 50 * auraScale;
        const tailWidth = 26 * auraScale;
        const tailImg = MeteorRenderer.getTail(this.elementName);

        if (tailImg) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            const tailWobble = Math.sin(now * 0.008 + x) * 2.5;
            ctx.drawImage(tailImg, -tailWidth / 2 + tailWobble, -tailLen, tailWidth, tailLen);

            // Fast batched trailing spark motes
            const sparkColor = this.elementName === 'void' ? '#00e5ff' : '#ffffff';
            ctx.fillStyle = sparkColor;
            ctx.beginPath();
            for (let p = 0; p < 3; p++) {
                const pPhase = (now * 0.0025 + p * 0.33) % 1.0;
                const py = -pPhase * tailLen;
                const px = Math.sin(p * 2.3 + now * 0.008) * (tailWidth * 0.35 * (1 - pPhase));
                const pr = Math.max(0.6, (1 - pPhase) * 2.0);
                ctx.moveTo(px + pr, py);
                ctx.arc(px, py, pr, 0, Math.PI * 2);
            }
            ctx.fill();
            ctx.restore();
        }

        // 2. Blending mode for Meteor Head
        ctx.globalCompositeOperation = this.elementName === 'void' ? 'source-over' : 'screen';

        // 3. Targeted Gold Aura
        if (isTargeted) {
            ctx.save();
            ctx.shadowColor = '#ffd700';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 18;
            ctx.drawImage(cachedCanvas, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
            ctx.restore();
        }

        // 4. Typing Destabilization Flare (crackling damage feedback)
        if (typingProgress > 0) {
            ctx.save();
            const destabShake = (Math.sin(now * 0.06) * 2.5) * typingProgress;
            ctx.translate(destabShake, 0);

            // Expanding destabilization glow
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.beginPath();
            ctx.arc(0, 0, drawWidth * 0.35 * (1 + typingProgress * 0.2), 0, Math.PI * 2);
            ctx.fillStyle = this.elementName === 'void' 
                ? `rgba(0, 229, 255, ${typingProgress * 0.4})` 
                : `rgba(255, 255, 255, ${typingProgress * 0.35})`;
            ctx.fill();
            ctx.restore();

            // Crackling stress arcs
            const arcCount = Math.floor(3 + typingProgress * 4);
            ctx.strokeStyle = this.elementName === 'void' ? '#00e5ff' : '#ffffff';
            ctx.shadowColor = this.elementName === 'void' ? '#00e5ff' : '#ffd700';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 10;
            ctx.lineWidth = 1.6;
            for (let a = 0; a < arcCount; a++) {
                const sparkAngle = (a / arcCount) * Math.PI * 2 + now * 0.005;
                const r1 = drawWidth * 0.2;
                const r2 = drawWidth * (0.32 + Math.sin(now * 0.02 + a) * 0.12 * typingProgress);
                ctx.beginPath();
                ctx.moveTo(Math.cos(sparkAngle) * r1, Math.sin(sparkAngle) * r1);
                ctx.lineTo(Math.cos(sparkAngle + 0.12) * (r1 + r2) / 2, Math.sin(sparkAngle + 0.12) * (r1 + r2) / 2);
                ctx.lineTo(Math.cos(sparkAngle - 0.06) * r2, Math.sin(sparkAngle - 0.06) * r2);
                ctx.stroke();
            }
            ctx.restore();
        }

        // 5. Draw the cached meteor core
        ctx.drawImage(
            cachedCanvas,
            -drawWidth / 2,
            -drawHeight / 2,
            drawWidth,
            drawHeight
        );

        ctx.restore();
    }
}
