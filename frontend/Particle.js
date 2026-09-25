import { RenderCache } from './RenderCache.js';

// Bakes (once per palette) a shatter-splash used for word kills. Drawing one
// image + a handful of shard particles replaced the previous 35-55 shadowed
// circles per kill; the burst reads as a richer explosion for far less work.
export function bakeBurst(palette) {
    const colors = Array.isArray(palette) ? palette : [palette, '#ffffff'];
    const key = 'at_burst_' + colors.join('_');
    return RenderCache.bake(key, 96, 96, (ctx) => {
        const cx = 48, cy = 48;
        // Core glow
        const grad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 30);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.4, colors[0]);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 96, 96);

        // Radial shard spikes
        for (let s = 0; s < 14; s++) {
            const a = (s / 14) * Math.PI * 2 + Math.random() * 0.2;
            const len = 34 + Math.random() * 26;
            const c = colors[(s + (colors.length > 1 ? 1 : 0)) % colors.length];
            ctx.strokeStyle = c;
            ctx.lineWidth = 3 + Math.random() * 3;
            ctx.lineCap = 'round';
            ctx.shadowColor = c;
            ctx.shadowBlur = 6;
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * 8, cy + Math.sin(a) * 8);
            ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
            ctx.stroke();
        }
        ctx.shadowBlur = 0;
    });
}

export class Particle {
    constructor(x, y, color) {
        this.active = false;
        if (typeof x !== 'undefined') {
            this.init(x, y, color);
        }
    }

    init(x, y, color) {
        this.active = true;
        this.x = x;
        this.y = y;
        this.color = color;

        // Random velocity in all directions — wider speed range for more energy
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 0.7 + 0.15;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;

        // Precompute curve rotation matrix — eliminates 4 transcendental calls per frame
        this.curve = (Math.random() - 0.5) * 0.1;
        this.cosCurve = Math.cos(this.curve);
        this.sinCurve = Math.sin(this.curve);

        // Lifespan and size
        this.life = 1.0;
        this.decay = Math.random() * 0.018 + 0.008;
        this.size = Math.random() * 5 + 2;
        this.initialSize = this.size;

        // Gravity — particles arc downward
        this.gravity = 0.0008 + Math.random() * 0.0006;

        // Sometimes draw a rune instead of a circle
        this.isRune = Math.random() > 0.7;
        this.runeChar = String.fromCharCode(0x16A0 + Math.floor(Math.random() * 80)); // Runic block

        // Type flags
        this.isShockwave = false;
        this.isSlashLine = false;
        this.isHexShield = false;
        this.isDistortionRing = false;
        this.isGlassShard = false;
        this.isBurst = false;
        this.isVoidMote = false;

        // Setup shockwave properties if indicated
        if (color === 'shockwave' || color === 'shockwave_purple' || color === 'shockwave_red') {
            this.isShockwave = true;
            this.isRune = false;
            if (color === 'shockwave_purple') {
                this.color = 'rgba(224, 64, 251, 0.9)'; // Neon purple expanding ring
            } else if (color === 'shockwave_red') {
                this.color = 'rgba(255, 23, 68, 0.9)'; // Crimson red expanding ring
            } else {
                this.color = 'rgba(255, 215, 0, 0.8)'; // Gold expanding ring
            }
            this.vx = 0;
            this.vy = 0;
            this.gravity = 0;
            this.life = 1.0;
            this.decay = 0.04; // Fast fade
            this.size = 5; // Starting radius
            this.expansionRate = 12; // How fast the ring grows
        }



        // --- Shatter Burst (pre-baked splash on word kills) ---
        if (typeof color === 'object' && color.type === 'burst') {
            this.isBurst = true;
            this.isRune = false;
            this.isShockwave = false;
            this.burstKey = color.burstKey;
            this.burstColors = color.colors || [color.color || '#ffffff'];
            // Reset on EVERY init: the pool reuses Particle objects, so a caller
            // that shrinks the splash (the Voidweaver's core pop) would otherwise
            // leak that scale into the next unrelated burst.
            this.burstScale = 1;
            this.color = this.burstColors[0];
            this.vx = 0;
            this.vy = 0;
            this.gravity = 0;
            this.life = 1.0;
            this.decay = 0.05; // ~20 frames, then the shard particles take over
            this.size = 0;
        }

        // --- Celestial Crystal / Barrier Shard (Barrier shatter fracture) ---
        if (typeof color === 'object' && color.type === 'glass_shard') {
            this.isGlassShard = true;
            this.isRune = false;
            this.isShockwave = false;
            this.color = color.color || '#00e5ff';
            this.shardLength = color.length || (8 + Math.random() * 10);
            this.shardWidth = color.width || (3.5 + Math.random() * 4);
            this.rot = Math.random() * Math.PI * 2;
            this.vRot = (Math.random() - 0.5) * 0.02;
            this.vx = color.vx !== undefined ? color.vx : (Math.random() - 0.5) * 0.4;
            this.vy = color.vy !== undefined ? color.vy : (Math.random() - 0.5) * 0.4;
            this.gravity = color.gravity !== undefined ? color.gravity : 0.0003;
            this.life = 1.0;
            this.decay = color.decay || (0.012 + Math.random() * 0.008);
            this.size = 0;
        }
    }

    update(dt) {
        if (!this.active || this.life <= 0) {
            this.active = false;
            return;
        }

        if (this.isShockwave) {
            this.size += this.expansionRate * (dt / 16);
            this.life -= this.decay * (dt / 16);
        } else if (this.isVoidMote) {
            const dx = this.targetX - this.x;
            const dy = this.targetY - this.y;
            const distance = Math.max(1, Math.hypot(dx, dy));
            const pull = 0.018 + (1 - Math.min(1, distance / 260)) * 0.012;
            this.vx += (dx / distance) * pull * dt;
            this.vy += (dy / distance) * pull * dt;
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.life -= this.decay * (dt / 16.67);
            this.size = this.initialSize * this.life;
        } else if (this.isGlassShard) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.vy += this.gravity * dt;
            this.rot += this.vRot * dt;
            this.life -= this.decay * (dt / 16);
        } else {
            const dtScale = dt / 16.67;
            // Matrix rotation for organic swerve scaled by delta-time
            if (this.curve !== 0) {
                const scaledCurve = this.curve * dtScale;
                const cosC = Math.cos(scaledCurve);
                const sinC = Math.sin(scaledCurve);
                const nvx = this.vx * cosC - this.vy * sinC;
                const nvy = this.vx * sinC + this.vy * cosC;
                this.vx = nvx;
                this.vy = nvy;
            }

            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.life -= this.decay * dtScale;

            // Gravity pulls particles down
            this.vy += this.gravity * dt;

            // Shrink as they die
            this.size = this.initialSize * this.life;
        }

        if (this.life <= 0) {
            this.active = false;
        }
    }

    draw(ctx) {
        if (this.life <= 0) return;

        // shadowBlur is the single most expensive Canvas2D operation; on
        // low-quality mode (slow PC auto-detected) all particle glow is
        // skipped — visually dimmer but functionally identical.
        const lowQ = window.__atLowQuality === true;

        ctx.save();
        const lifeAlpha = Math.max(0, this.life);
        ctx.globalAlpha = lifeAlpha;

        if (this.isVoidMote) {
            const r = Math.max(0.5, this.size);
            ctx.beginPath();
            ctx.arc(this.x, this.y, r * 2.2, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.globalAlpha = lifeAlpha * 0.32;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(this.x, this.y, r * 0.75, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = lifeAlpha;
            ctx.fill();
        } else if (this.isShockwave) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = Math.max(1, 8 * this.life); // Ring gets thinner as it fades
            ctx.stroke();

            // Softer luminous outer halo ring (0 blur filter overhead)
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size + 2, 0, Math.PI * 2);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = Math.max(1, 3 * this.life);
            ctx.globalAlpha = lifeAlpha * 0.4;
            ctx.stroke();

        } else if (this.isGlassShard) {
            // Spacetime Glass Shard (Refractive polygonal crystal shard)
            ctx.save();
            ctx.translate(this.x, this.y);
            ctx.rotate(this.rot);
            ctx.beginPath();
            ctx.moveTo(0, -this.shardLength / 2);
            ctx.lineTo(this.shardWidth / 2, this.shardLength / 4);
            ctx.lineTo(-this.shardWidth / 2, this.shardLength / 2);
            ctx.closePath();
            ctx.fillStyle = this.color;
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
            ctx.lineWidth = 1.0;
            ctx.fill();
            ctx.stroke();
            ctx.restore();
        } else if (this.isSlashLine) {
            // AT: the Bloodseeker's clean cut. The blade sweeps a straight
            // line THROUGH the meteor's centre at a random angle, so the two
            // halves visibly part along the cut rather than scattering like a
            // generic shatter. Length contracts as it fades, which reads as
            // the blade being drawn back out of the target.
            const half = (this.slashLen * (0.35 + 0.65 * lifeAlpha)) / 2;
            const nx = Math.cos(this.slashAngle + Math.PI / 2);
            const ny = Math.sin(this.slashAngle + Math.PI / 2);
            const ox = nx * this.slashSpread;
            const oy = ny * this.slashSpread;
            ctx.translate(this.x, this.y);
            ctx.rotate(this.slashAngle);
            ctx.lineCap = 'round';
            // Soft crimson bleed along the cut.
            ctx.globalAlpha = lifeAlpha * 0.34;
            ctx.strokeStyle = this.slashGlow;
            ctx.lineWidth = Math.max(1, 7 * lifeAlpha);
            ctx.beginPath();
            ctx.moveTo(ox - half, oy);
            ctx.lineTo(ox + half, oy);
            ctx.stroke();
            // The hot edge of the blade.
            ctx.globalAlpha = lifeAlpha;
            ctx.strokeStyle = this.color;
            ctx.lineWidth = Math.max(1, 2.4 * lifeAlpha);
            ctx.beginPath();
            ctx.moveTo(ox - half, oy);
            ctx.lineTo(ox + half, oy);
            ctx.stroke();
        } else if (this.isBurst) {
            // Bake-once splash: drawImage only, expanding and fading out.
            // `burstScale` lets a caller shrink the splash to a small core pop
            // without a second particle type; it defaults to 1 so every
            // existing caller keeps the original full-size splash.
            const img = bakeBurst(this.burstColors);
            if (img) {
                const grow = 1.4 - this.life * 0.4; // shrink as it fades
                const scale = this.burstScale || 1;
                const s = 96 * grow * scale * (window.__atLowQuality ? 0.75 : 1);
                ctx.globalAlpha = lifeAlpha;
                ctx.drawImage(img, this.x - s / 2, this.y - s / 2, s, s);
                ctx.globalAlpha = 1;
            }
        } else if (this.isRune) {
            ctx.font = `${Math.max(4, this.size * 3)}px serif`;
            ctx.fillStyle = this.color;
            ctx.fillText(this.runeChar, this.x, this.y);
        } else {
            // Blazing-fast incandescent magic spark: Radiant color aura + hot star core (0 blur passes)
            const r = Math.max(0.5, this.size);
            // Outer aura
            ctx.beginPath();
            ctx.arc(this.x, this.y, r * 2.0, 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.globalAlpha = lifeAlpha * 0.35;
            ctx.fill();
            // Hot core
            ctx.beginPath();
            ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
            ctx.fillStyle = '#ffffff';
            ctx.globalAlpha = lifeAlpha;
            ctx.fill();
        }
        ctx.restore();
    }
}
