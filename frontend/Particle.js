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
        this.x = x;
        this.y = y;
        this.color = color;

        // Random velocity in all directions — wider speed range for more energy
        const angle = Math.random() * Math.PI * 2;
        const speed = Math.random() * 0.7 + 0.15;
        this.vx = Math.cos(angle) * speed;
        this.vy = Math.sin(angle) * speed;
        this.curve = (Math.random() - 0.5) * 0.1; // adding slight swerving trajectory

        // Lifespan and size
        this.life = 1.0;
        this.decay = Math.random() * 0.018 + 0.008;
        this.size = Math.random() * 5 + 2;
        this.initialSize = this.size;

        // Gravity — particles arc downward
        this.gravity = 0.0008 + Math.random() * 0.0006;

        // Sometimes draw a rune instead of a circle
        this.isRune = Math.random() > 0.7 && !this.isShockwave;
        this.runeChar = String.fromCharCode(0x16A0 + Math.floor(Math.random() * 80)); // Runic block

        // Type flags
        this.isShockwave = false;
        this.isSlashLine = false;
        this.isHexShield = false;
        this.isDistortionRing = false;

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

        // --- Slash Line (Sukuna Cleave/Dismantle visual) ---
        if (typeof color === 'object' && color.type === 'slash_line') {
            this.isSlashLine = true;
            this.isRune = false;
            this.isShockwave = false;
            this.color = color.color || '#ff1744';
            this.slashAngle = color.angle || (Math.random() * Math.PI - Math.PI / 2);
            this.slashLength = color.length || (60 + Math.random() * 80);
            this.slashWidth = color.width || (2 + Math.random() * 1.5);
            this.vx = 0;
            this.vy = 0;
            this.gravity = 0;
            this.life = 1.0;
            this.decay = 0.06; // Fast fade
            this.size = 0;
        }

        // --- Hex Shield (Gojo Infinity barrier hexagon) ---
        if (typeof color === 'object' && color.type === 'hex_shield') {
            this.isHexShield = true;
            this.isRune = false;
            this.isShockwave = false;
            this.color = color.color || '#00e5ff';
            this.hexRadius = color.radius || (6 + Math.random() * 4);
            this.hexAngle = color.orbitAngle || (Math.random() * Math.PI * 2);
            this.hexOrbitRadius = color.orbitRadius || 35;
            this.hexRotation = Math.random() * Math.PI;
            this.originX = color.originX || x;
            this.originY = color.originY || y;
            this.vx = 0;
            this.vy = 0;
            this.gravity = 0;
            this.life = 1.0;
            this.decay = 0.025;
            this.size = 0;
        }

        // --- Shatter Burst (pre-baked splash on word kills) ---
        if (typeof color === 'object' && color.type === 'burst') {
            this.isBurst = true;
            this.isRune = false;
            this.isShockwave = false;
            this.burstKey = color.burstKey;
            this.burstColors = color.colors || [color.color || '#ffffff'];
            this.color = this.burstColors[0];
            this.vx = 0;
            this.vy = 0;
            this.gravity = 0;
            this.life = 1.0;
            this.decay = 0.05; // ~20 frames, then the shard particles take over
            this.size = 0;
        }

        // --- Distortion Ring (Gojo spatial distortion wave) ---
        if (typeof color === 'object' && color.type === 'distortion_ring') {
            this.isDistortionRing = true;
            this.isRune = false;
            this.isShockwave = false;
            this.color = color.color || 'rgba(0, 229, 255, 0.6)';
            this.vx = 0;
            this.vy = 0;
            this.gravity = 0;
            this.life = 1.0;
            this.decay = 0.03;
            this.size = color.startRadius || 8;
            this.expansionRate = color.expansionRate || 4;
            this.waveAmplitude = 2 + Math.random() * 2;
            this.waveFrequency = 4 + Math.random() * 4;
            this.ringWidth = color.ringWidth || 1.5;
        }
    }

    update(dt) {
        if (this.isShockwave) {
            this.size += this.expansionRate * (dt / 16);
            this.life -= this.decay * (dt / 16);
        } else if (this.isSlashLine) {
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.life -= this.decay * (dt / 16);
        } else if (this.isHexShield) {
            this.hexAngle += 0.001 * dt;
            this.x = this.originX + Math.cos(this.hexAngle) * this.hexOrbitRadius;
            this.y = this.originY + Math.sin(this.hexAngle) * this.hexOrbitRadius;
            this.life -= this.decay * (dt / 16);
        } else if (this.isDistortionRing) {
            this.size += this.expansionRate * (dt / 16);
            this.life -= this.decay * (dt / 16);
        } else {
            // organic swerve
            const currentSpeed = Math.sqrt(this.vx * this.vx + this.vy * this.vy);
            const currentAngle = Math.atan2(this.vy, this.vx);
            this.vx = Math.cos(currentAngle + this.curve) * currentSpeed;
            this.vy = Math.sin(currentAngle + this.curve) * currentSpeed;

            this.x += this.vx * dt;
            this.y += this.vy * dt;
            this.life -= this.decay;

            // Gravity pulls particles down
            this.vy += this.gravity * dt;

            // Shrink as they die
            this.size = this.initialSize * this.life;
        }
    }

    draw(ctx) {
        if (this.life <= 0) return;

        // shadowBlur is the single most expensive Canvas2D operation; on
        // low-quality mode (slow PC auto-detected) all particle glow is
        // skipped — visually dimmer but functionally identical.
        const lowQ = window.__atLowQuality === true;

        ctx.save();
        ctx.globalAlpha = Math.max(0, this.life);

        if (this.isShockwave) {
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = Math.max(1, 10 * this.life); // Ring gets thinner as it fades
            ctx.shadowColor = this.color;
            ctx.shadowBlur = lowQ ? 0 : 10;
            ctx.stroke();
        } else if (this.isSlashLine) {
            // Draw a bright slash line from center
            const halfLen = this.slashLength / 2;
            const dx = Math.cos(this.slashAngle) * halfLen;
            const dy = Math.sin(this.slashAngle) * halfLen;

            ctx.beginPath();
            ctx.moveTo(this.x - dx, this.y - dy);
            ctx.lineTo(this.x + dx, this.y + dy);
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.slashWidth * this.life;
            ctx.lineCap = 'round';
            ctx.shadowColor = this.color;
            ctx.shadowBlur = lowQ ? 0 : 12;
            ctx.stroke();

            // Inner bright core line
            ctx.globalAlpha = Math.max(0, this.life * 0.8);
            ctx.beginPath();
            ctx.moveTo(this.x - dx * 0.7, this.y - dy * 0.7);
            ctx.lineTo(this.x + dx * 0.7, this.y + dy * 0.7);
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = this.slashWidth * this.life * 0.4;
            ctx.shadowBlur = lowQ ? 0 : 6;
            ctx.stroke();
        } else if (this.isHexShield) {
            // Draw a hexagon
            ctx.translate(this.x, this.y);
            ctx.rotate(this.hexRotation);
            ctx.beginPath();
            for (let i = 0; i < 6; i++) {
                const a = (Math.PI / 3) * i;
                const hx = Math.cos(a) * this.hexRadius;
                const hy = Math.sin(a) * this.hexRadius;
                if (i === 0) ctx.moveTo(hx, hy);
                else ctx.lineTo(hx, hy);
            }
            ctx.closePath();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = 1.2;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = lowQ ? 0 : 8;
            ctx.stroke();

            // Faint fill
            ctx.globalAlpha = Math.max(0, this.life * 0.15);
            ctx.fillStyle = this.color;
            ctx.fill();
        } else if (this.isDistortionRing) {
            // Draw a wavy expanding ring
            const now = performance.now();
            ctx.beginPath();
            const segments = 60;
            for (let i = 0; i <= segments; i++) {
                const a = (i / segments) * Math.PI * 2;
                const wave = Math.sin(a * this.waveFrequency + now * 0.005) * this.waveAmplitude * this.life;
                const r = this.size + wave;
                const px = this.x + Math.cos(a) * r;
                const py = this.y + Math.sin(a) * r;
                if (i === 0) ctx.moveTo(px, py);
                else ctx.lineTo(px, py);
            }
            ctx.closePath();
            ctx.strokeStyle = this.color;
            ctx.lineWidth = this.ringWidth * this.life;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = lowQ ? 0 : 6;
            ctx.stroke();
        } else if (this.isBurst) {
            // Bake-once splash: drawImage only, expanding and fading out
            const img = bakeBurst(this.burstColors);
            if (img) {
                const grow = 1.4 - this.life * 0.4; // shrink as it fades
                const s = 96 * grow * (window.__atLowQuality ? 0.75 : 1);
                ctx.globalAlpha = Math.max(0, this.life);
                ctx.drawImage(img, this.x - s / 2, this.y - s / 2, s, s);
                ctx.globalAlpha = 1;
            }
        } else if (this.isRune) {
            ctx.font = `${Math.max(4, this.size * 3)}px serif`;
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = lowQ ? 0 : 6;
            ctx.fillText(this.runeChar, this.x, this.y);
        } else {
            ctx.beginPath();
            ctx.arc(this.x, this.y, Math.max(0.5, this.size), 0, Math.PI * 2);
            ctx.fillStyle = this.color;
            ctx.shadowColor = this.color;
            ctx.shadowBlur = lowQ ? 0 : 8;
            ctx.fill();
        }
        ctx.restore();
    }
}
