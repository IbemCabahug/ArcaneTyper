export class Boss {
    constructor(canvasWidth, canvasHeight, elementType = 'fire', difficultyScale = 1) {
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
        this.elementType = elementType;

        // Start off-screen top, then slide in
        this.x = canvasWidth / 2;
        this.y = -100;
        this.targetY = 100; // Hover position near the top

        this.introFinished = false;

        // Visual properties
        this.scale = 1.2;
        this.flashTimer = 0; // For damage feedback

        // Base elemental stats
        const elements = {
            'fire': { hp: 4, speed: 2000, color: '#ff4500', aura: '#ff8c00' },
            'ice': { hp: 6, speed: 4500, color: '#00ffff', aura: '#e0ffff' },
            'lightning': { hp: 3, speed: 1500, color: '#ffd700', aura: '#ffffba' },
            'void': { hp: 5, speed: 3000, color: '#8a2be2', aura: '#4b0082' }
        };

        const config = elements[this.elementType] || elements['fire'];
        this.color = config.color;
        this.auraColor = config.aura;

        // Scale HP and attack speed based on how many bosses have been defeated
        this.maxHealth = Math.floor(config.hp * difficultyScale);
        this.health = this.maxHealth;
        this.displayHealth = this.maxHealth; // Lerped display value for smooth bar
        this.isDead = false;

        // Death animation state
        this.dyingTimer = 0;
        this.dyingDuration = 600; // ms
        this.opacity = 1.0;
        this.deathScale = this.scale;

        // Attack logic
        this.attackTimer = 0;

        // Spell logic
        this.spellTimer = 0;
        this.spellInterval = 8000; // Cast a defensive spell every 8 seconds

        // Attack speed scales faster as you beat more bosses (up to a 50% cap)
        const speedMultiplier = Math.max(0.5, 1 - (difficultyScale * 0.1));
        this.attackInterval = config.speed * speedMultiplier;
    }

    update(dt) {
        // Intro animation: slide down
        if (!this.introFinished) {
            const dy = this.targetY - this.y;
            this.y += dy * 2 * dt; // Smooth ease-out
            if (this.y >= this.targetY - 1) {
                this.y = this.targetY;
                this.introFinished = true;
            }
        } else if (!this.isDead) {
            // Hover effect slightly up and down
            this.y = this.targetY + Math.sin(performance.now() / 500) * 10;
        }

        if (this.flashTimer > 0) {
            this.flashTimer -= dt;
        }

        // Smooth health bar display via lerp
        this.displayHealth += (this.health - this.displayHealth) * Math.min(1, dt * 0.008);

        // Death animation
        if (this.isDead) {
            this.dyingTimer += dt;
            const progress = Math.min(1, this.dyingTimer / this.dyingDuration);
            this.opacity = 1.0 - progress;
            this.deathScale = this.scale * (1 + progress * 1.5); // Expand outward
        }

        this.attackTimer += dt;
        this.spellTimer += dt;
    }

    takeDamage() {
        this.health -= 1;
        this.flashTimer = 200; // Flash white for 200ms
        if (this.health <= 0) {
            this.health = 0;
            this.isDead = true;
        }
    }

    shouldAttack() {
        if (this.introFinished && !this.isDead && this.attackTimer >= this.attackInterval) {
            this.attackTimer = 0;
            return true;
        }
        return false;
    }

    shouldCastSpell() {
        if (this.introFinished && !this.isDead && this.spellTimer >= this.spellInterval) {
            this.spellTimer = 0;
            return true;
        }
        return false;
    }

    // Returns true once the death animation is fully complete
    isFullyDead() {
        return this.isDead && this.dyingTimer >= this.dyingDuration;
    }

    draw(ctx) {
        if (this.isFullyDead()) return;

        const healthPct = this.health / this.maxHealth;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.deathScale, this.deathScale);
        ctx.globalAlpha = this.opacity;

        // Aura glow intensity scales up as HP drops (2x glow at 0 HP)
        const angerMultiplier = 1 + (1 - healthPct);
        const pulseGlow = Math.sin(performance.now() / 200) * 10;
        const baseGlow = this.flashTimer > 0 ? 40 : (20 + pulseGlow) * angerMultiplier;

        ctx.shadowColor = this.flashTimer > 0 ? '#ffffff' : this.auraColor;
        ctx.shadowBlur = baseGlow;

        // Draw Rival Wizard Silhouette
        ctx.fillStyle = this.flashTimer > 0 ? '#ffffff' : '#1a1a24';
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1;

        // Cloak
        ctx.beginPath();
        ctx.moveTo(0, -24);
        ctx.lineTo(-15, 18);
        ctx.quadraticCurveTo(0, 21, 15, 18);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Hat
        ctx.beginPath();
        ctx.moveTo(-11, -21);
        ctx.quadraticCurveTo(0, -18, 11, -21);
        ctx.lineTo(1, -45);
        ctx.lineTo(-1, -45);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Health bar (only when intro done and alive)
        if (this.introFinished && !this.isDead) {
            ctx.shadowBlur = window.__atLowQuality ? 0 : 0;
            const barWidth = 60;
            const barHeight = 6;
            const yOffset = -60;

            // Background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
            ctx.fillRect(-barWidth / 2, yOffset, barWidth, barHeight);

            // Smooth health fill using displayHealth
            const displayPct = this.displayHealth / this.maxHealth;
            // Color shifts from green → yellow → red as HP drops
            const r = Math.floor(255 * (1 - displayPct));
            const g = Math.floor(200 * displayPct);
            ctx.fillStyle = `rgb(${255}, ${g}, 75)`;
            ctx.fillRect(-barWidth / 2, yOffset, barWidth * displayPct, barHeight);

            // Border
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1;
            ctx.strokeRect(-barWidth / 2, yOffset, barWidth, barHeight);
        }

        ctx.restore();
    }
}
