import { MeteorRenderer } from './MeteorRenderer.js';

export class Word {
    constructor(text, canvasWidth, canvasHeight, speedMultiplier, targetX, targetY, options = {}) {
        this.text = text;
        this.isBossAttack = options.isBossAttack || false;

        this.variant = options.variant || 'normal';
        this.gameMode = options.gameMode || 'classic';
        this.typed = "";

        if (this.variant === 'cursed') {
            this.text = text.split('').reverse().join('');
            this.untyped = this.text;
        } else {
            this.text = text;
            this.untyped = text;
        }

        this.mistakesMade = 0;

        // Caching text measurements
        this._lastTypedStr = null;
        this._cachedTypedWidth = 0;

        // Static shared canvas for zero-allocation text measurement
        this.totalTextWidth = Word.measureText(this.text);

        // Pre-calculate sprite target width
        const minSpriteWidth = 100;
        this.spriteTargetWidth = Math.max(this.totalTextWidth, minSpriteWidth);

        // Elements
        const elementNames = ['fire', 'ice', 'lightning', 'void'];
        this.elementName = elementNames[Math.floor(Math.random() * elementNames.length)];
        this.elementColors = Word.ELEMENTS[this.elementName];

        // AT-F7 & AT-F8: Procedural elemental meteor halo / void rift
        this.meteor = new MeteorRenderer(this.elementName);
        this.sprite = this.meteor; // Backward compatibility

        // Position
        if (typeof options.x !== 'undefined') {
            this.x = options.x;
            this.y = typeof options.y !== 'undefined' ? options.y : -50;
        } else if (this.isBossAttack) {
            this.x = canvasWidth / 2;
            this.y = 100; // Boss's targetY
        } else {
            this.y = -50;
            const margin = 100;
            this.x = margin + Math.random() * (canvasWidth - 2 * margin);
        }

        // Scale
        if (this.isBossAttack) {
            this.scale = 0.25 + Math.random() * 0.1;
        } else {
            this.scale = 0.45 + Math.random() * 0.25;
        }

        // Speed
        // baseSpeed may be pinned by the caller (AT-F9 race issues carry the
        // host's roll so both clients render the same fall speed)
        const baseSpeed = (typeof options.baseSpeed === 'number') ? options.baseSpeed : (0.8 + Math.random() * 0.6);
        let finalSpeed = (baseSpeed * speedMultiplier) * (1 - (text.length * 0.02));

        if (this.isBossAttack) {
            finalSpeed *= 0.35;
        } else if (this.variant === 'swarm') {
            finalSpeed *= 1.8; // Swarm is very fast
        } else if (this.variant === 'armored') {
            finalSpeed *= 0.6; // Armored is slow
        }

        this.speed = finalSpeed;

        // Velocity vector towards target
        this.targetX = targetX;
        this.targetY = targetY;

        const dx = this.targetX - this.x;
        const dy = this.targetY - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        this.vx = (dx / distance) * this.speed * 0.05;
        this.vy = (dy / distance) * this.speed * 0.05;

        this.angle = Math.atan2(dy, dx) - Math.PI / 2;

        this.isTargeted = false;
        this.isDead = false;

        // --- Fade-in animation ---
        this.opacity = 0;
        this.spawnTimer = 0;
        this.spawnDuration = 300; // ms

        // --- Death animation ---
        this.dying = false;
        this.deathTimer = 0;
        this.deathDuration = 200; // ms
        this.deathScale = 1.0; // scale multiplier during death

        // Cached text metrics (measureText is a layout pass; only re-run when
        // the string actually changes instead of every frame per word)
        this._lastTypedStr = null;
        this._cachedTypedWidth = 0;
        this._lastUntypedStr = null;
        this._cachedUntypedWidth = 0;
    }

    static _measureCtx = null;
    static measureText(text, font = 'bold 32px Cinzel, serif') {
        if (!Word._measureCtx) {
            const c = document.createElement('canvas');
            c.width = 1;
            c.height = 1;
            Word._measureCtx = c.getContext('2d');
        }
        Word._measureCtx.font = font;
        return Word._measureCtx.measureText(text).width;
    }

    update(dt) {
        // Fade-in
        if (this.spawnTimer < this.spawnDuration) {
            this.spawnTimer += dt;
            this.opacity = Math.min(1, this.spawnTimer / this.spawnDuration);
        }

        // Death animation
        if (this.dying) {
            this.deathTimer += dt;
            const progress = Math.min(1, this.deathTimer / this.deathDuration);
            this.opacity = 1.0 - progress;
            this.deathScale = 1.0 + progress * 0.4; // scale up slightly
            if (this.deathTimer >= this.deathDuration) {
                this.isDead = true;
            }
            return; // Don't move while dying
        }

        // Move diagonally towards target
        this.x += this.vx * dt;
        this.y += this.vy * dt;

        // Ghost oscillating opacity
        if (this.variant === 'ghost' && !this.isTargeted) {
            // Oscillate opacity between 0.0 and 1.0 based on time + unique offset
            const time = performance.now();
            const wave = Math.sin((time / 400) + (this.x / 100)); // Sine wave
            this.opacity = Math.max(0, wave); // Clamp at 0 so it stays invisible for a chunk of the cycle
        } else if (this.variant === 'ghost' && this.isTargeted) {
            this.opacity = 1.0; // Force visible when targeted
        }

        // Update procedural meteor animation frame
        if (this.meteor) {
            this.meteor.update(dt);
        }
    }

    draw(ctx) {
        if (this.isDead) return;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.scale * this.deathScale, this.scale * this.deathScale);
        ctx.globalAlpha = this.opacity;

        ctx.font = 'bold 32px Cinzel, serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';

        // Cache measured text width
        if (this._lastTypedStr !== this.typed) {
            this._cachedTypedWidth = ctx.measureText(this.typed).width;
            this._lastTypedStr = this.typed;
        }
        if (this._lastUntypedStr !== this.untyped) {
            this._cachedUntypedWidth = ctx.measureText(this.untyped).width;
            this._lastUntypedStr = this.untyped;
        }

        const textYOffset = 70;
        const totalTextWidth = this._cachedTypedWidth + this._cachedUntypedWidth;
        // Perfectly centralized at x = 0 beneath the meteor core
        const startX = -totalTextWidth / 2;

        // Draw Procedural Meteor Aura above the text
        if (this.meteor) {
            const typingProgress = this.text.length > 0 ? this.typed.length / this.text.length : 0;
            this.meteor.draw(ctx, 0, -15, this.spriteTargetWidth, this.angle, this.isTargeted, typingProgress);
        }

        ctx.save();
        if (this.isBossAttack) {
            ctx.scale(1.5, 1.5);
        }

        // Variant Badges (Clean fantasy icons rendered next to text without a box)
        if (this.variant === 'armored') {
            ctx.fillStyle = '#ff3d00';
            ctx.font = '16px serif';
            ctx.fillText('🛡️', startX - 26, textYOffset);
            ctx.font = 'bold 32px Cinzel, serif';
        } else if (this.variant === 'cursed') {
            ctx.fillStyle = '#ff1744';
            ctx.font = '16px serif';
            ctx.fillText('👁️', startX - 26, textYOffset);
            ctx.font = 'bold 32px Cinzel, serif';
        } else if (this.variant === 'combo') {
            ctx.fillStyle = '#ffd700';
            ctx.font = '16px serif';
            ctx.fillText('🔗', startX - 30, textYOffset + 2);
            ctx.font = 'bold 32px Cinzel, serif';
        }

        // --- High-Contrast Magical Typography ---
        if (this.isTargeted) {
            ctx.shadowColor = 'rgba(255, 215, 0, 0.9)';
            ctx.shadowBlur = window.__atLowQuality ? 0 : 12;
        } else {
            ctx.shadowBlur = 0;
            // Crisp dark drop offset for passive words (0 Gaussian blur overhead)
            ctx.fillStyle = 'rgba(0, 0, 0, 0.85)';
            if (this.typed) ctx.fillText(this.typed, startX + 1.5, textYOffset + 1.5);
            ctx.fillText(this.untyped, startX + this._cachedTypedWidth + 1.5, textYOffset + 1.5);
        }

        // 1. Typed part: Illuminated starlight with soft cyan mana sheen
        ctx.fillStyle = this.isTargeted ? '#80deea' : 'rgba(200, 230, 255, 0.45)';
        ctx.fillText(this.typed, startX, textYOffset);

        // 2. Untyped part
        if (this.gameMode === 'blind' && this.isTargeted && this.typed.length > 0) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
            const hiddenText = '?'.repeat(this.untyped.length);
            ctx.fillText(hiddenText, startX + this._cachedTypedWidth, textYOffset);
        } else {
            if (this.variant === 'elemental') {
                ctx.fillStyle = this.isTargeted ? this.elementColors.untypedTargeted : this.elementColors.untyped;
            } else if (this.variant === 'cursed') {
                ctx.fillStyle = this.isTargeted ? '#ff5252' : '#ff8a80';
            } else {
                ctx.fillStyle = this.isTargeted ? '#ffd700' : '#ffffff';
            }

            ctx.fillText(this.untyped, startX + this._cachedTypedWidth, textYOffset);
        }



        ctx.restore();

        ctx.restore();
        ctx.restore();
    }

    scramble() {
        if (this.untyped.length > 2 && this.variant !== 'cursed') {
            const arr = this.untyped.split('');
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            this.untyped = arr.join('');
        }
    }

}

Word.ELEMENTS = {
    fire: {
        untyped: '#ff7b54',
        untypedTargeted: '#ff4b4b',
        typed: '#4a3b5a',
        typedTargeted: '#b892b0',
        particles: ['#ff4b4b', '#ff7b54', '#ffd700', '#4a0000']
    },
    ice: {
        untyped: '#b3e5fc',
        untypedTargeted: '#29b6f6',
        typed: '#4a3b5a',
        typedTargeted: '#b892b0',
        particles: ['#b3e5fc', '#29b6f6', '#ffffff', '#0277bd']
    },
    lightning: {
        untyped: '#e1bee7',
        untypedTargeted: '#d500f9',
        typed: '#4a3b5a',
        typedTargeted: '#b892b0',
        particles: ['#d500f9', '#ea80fc', '#ffffff', '#4a148c']
    },
    void: {
        untyped: '#80cbc4',
        untypedTargeted: '#00bfa5',
        typed: '#4a3b5a',
        typedTargeted: '#b892b0',
        particles: ['#00bfa5', '#1de9b6', '#004d40', '#000000']
    }
};
