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
            'fire': { hp: 4, speed: 2000, color: '#ff4500', aura: '#ff8c00', title: 'IGNIS · PYROLORD' },
            'ice': { hp: 6, speed: 4500, color: '#00e5ff', aura: '#18ffff', title: 'GLACIES · FROST REAVER' },
            'lightning': { hp: 3, speed: 1500, color: '#ffd700', aura: '#ffff00', title: 'FULGUR · STORM ARCHON' },
            'void': { hp: 5, speed: 3000, color: '#aa00ff', aura: '#00e5ff', title: 'NIHIL · VOID SOVEREIGN' }
        };

        const config = elements[this.elementType] || elements['fire'];
        this.color = config.color;
        this.auraColor = config.aura;
        this.title = config.title;

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
        // Intro animation: slide down smoothly
        if (!this.introFinished) {
            const dy = this.targetY - this.y;
            this.y += dy * Math.min(1, (dt / 1000) * 5); // Smooth ease-out (~1s cinematic slide-in)
            if (this.y >= this.targetY - 1) {
                this.y = this.targetY;
                this.introFinished = true;
            }
        } else if (!this.isDead) {
            // Hover effect slightly up and down
            this.y = this.targetY + Math.sin(performance.now() / 450) * 8;
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

        const healthPct = Math.max(0, this.health / this.maxHealth);
        const now = performance.now();
        const lowQ = window.__atLowQuality;

        ctx.save();
        ctx.translate(this.x, this.y);
        ctx.scale(this.deathScale, this.deathScale);
        ctx.globalAlpha = this.opacity;

        // 1. Casting Spell Windup Aura
        const timeUntilSpell = Math.max(0, this.spellInterval - this.spellTimer);
        const isChargingSpell = timeUntilSpell < 2000;
        const chargeIntensity = isChargingSpell ? (1 - timeUntilSpell / 2000) : 0;

        // 2. Orbiting Elemental Catalysts (3 spell spheres in an elliptical 3D orbit)
        const catalystCount = 3;
        const orbitSpeed = isChargingSpell ? 0.006 : 0.002;
        for (let i = 0; i < catalystCount; i++) {
            const angle = (i / catalystCount) * Math.PI * 2 + now * orbitSpeed;
            const ox = Math.cos(angle) * 48;
            const oy = Math.sin(angle) * 16 - 10;
            const isBehind = Math.sin(angle) < 0;

            // Only draw behind orbs before drawing the body
            if (isBehind) {
                this._drawCatalyst(ctx, ox, oy, this.color, chargeIntensity, lowQ);
            }
        }

        // 3. Ambient Backglow & Levitation Ring
        ctx.save();
        ctx.scale(1, 0.35);
        ctx.beginPath();
        ctx.arc(0, 90, 36, 0, Math.PI * 2);
        ctx.strokeStyle = this.auraColor;
        ctx.lineWidth = 1.8;
        if (!lowQ) {
            ctx.shadowColor = this.auraColor;
            ctx.shadowBlur = 10;
        }
        ctx.globalAlpha = 0.4 + Math.sin(now / 350) * 0.15;
        ctx.stroke();
        ctx.restore();

        // 4. Arch-Warlock Body & Layered Robes
        const isFlashing = this.flashTimer > 0;
        ctx.save();

        // Aura glow around wizard body
        const angerMultiplier = 1 + (1 - healthPct) * 0.5;
        ctx.strokeStyle = isFlashing ? '#ffffff' : this.color;
        ctx.fillStyle = isFlashing ? '#ffffff' : '#110a1a';
        ctx.lineWidth = 1.5;
        if (!lowQ) {
            ctx.shadowColor = isFlashing ? '#ffffff' : this.auraColor;
            ctx.shadowBlur = isFlashing ? 30 : 12 * angerMultiplier;
        }

        // Tiered ceremonial robes
        ctx.beginPath();
        ctx.moveTo(0, -28);
        ctx.lineTo(-24, 26);
        ctx.quadraticCurveTo(0, 32, 24, 26);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Inner robe gold/elemental trim
        ctx.beginPath();
        ctx.moveTo(0, -26);
        ctx.lineTo(0, 28);
        ctx.strokeStyle = '#ffd700';
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Ceremonial Cowl / Shroud
        ctx.fillStyle = isFlashing ? '#ffffff' : '#1a0d26';
        ctx.beginPath();
        ctx.moveTo(-16, -22);
        ctx.quadraticCurveTo(0, -16, 16, -22);
        ctx.lineTo(13, -38);
        ctx.quadraticCurveTo(0, -46, -13, -38);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = this.color;
        ctx.lineWidth = 1.2;
        ctx.stroke();

        // Runic Horns / Spectral Crown
        ctx.strokeStyle = this.auraColor;
        ctx.lineWidth = 1.8;
        // Left horn
        ctx.beginPath();
        ctx.moveTo(-9, -40);
        ctx.quadraticCurveTo(-22, -48, -18, -62);
        ctx.stroke();
        // Right horn
        ctx.beginPath();
        ctx.moveTo(9, -40);
        ctx.quadraticCurveTo(22, -48, 18, -62);
        ctx.stroke();

        // Floating Runic Crest above head
        ctx.beginPath();
        ctx.arc(0, -56, 6, 0, Math.PI * 2);
        ctx.fillStyle = this.auraColor;
        ctx.fill();

        // Glowing Spectral Eyes
        if (!isFlashing) {
            ctx.fillStyle = '#00e5ff';
            ctx.beginPath();
            ctx.arc(-5, -28, 1.8, 0, Math.PI * 2);
            ctx.arc(5, -28, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.restore();

        // 5. Orbiting Catalysts in front of body
        for (let i = 0; i < catalystCount; i++) {
            const angle = (i / catalystCount) * Math.PI * 2 + now * orbitSpeed;
            const ox = Math.cos(angle) * 48;
            const oy = Math.sin(angle) * 16 - 10;
            const isFront = Math.sin(angle) >= 0;

            if (isFront) {
                this._drawCatalyst(ctx, ox, oy, this.color, chargeIntensity, lowQ);
            }
        }

        // 6. Ornate Gilded Boss Health Bar
        if (this.introFinished && !this.isDead) {
            ctx.save();
            ctx.shadowBlur = 0;
            const barWidth = 120;
            const barHeight = 8;
            const yOffset = -75;

            // Boss Title Banner
            ctx.font = 'bold 11px Cinzel, serif';
            ctx.textAlign = 'center';
            ctx.fillStyle = this.color;
            ctx.fillText(this.title, 0, yOffset - 8);

            // Bar background slate
            ctx.fillStyle = 'rgba(5, 2, 10, 0.85)';
            ctx.fillRect(-barWidth / 2, yOffset, barWidth, barHeight);

            // Fill gradient (Color shifts from gold/elemental to crimson danger)
            const displayPct = Math.max(0, Math.min(1, this.displayHealth / this.maxHealth));
            const fillWidth = barWidth * displayPct;

            const barGrad = ctx.createLinearGradient(-barWidth / 2, 0, barWidth / 2, 0);
            barGrad.addColorStop(0, this.color);
            barGrad.addColorStop(1, '#ffd700');
            ctx.fillStyle = barGrad;
            ctx.fillRect(-barWidth / 2, yOffset, fillWidth, barHeight);

            // Gilded filigree frame
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(-barWidth / 2, yOffset, barWidth, barHeight);

            // Corner ornamental brackets
            ctx.beginPath();
            ctx.moveTo(-barWidth / 2 - 4, yOffset + 4);
            ctx.lineTo(-barWidth / 2, yOffset - 2);
            ctx.moveTo(barWidth / 2 + 4, yOffset + 4);
            ctx.lineTo(barWidth / 2, yOffset - 2);
            ctx.stroke();

            // Hit threshold division notches
            ctx.strokeStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.lineWidth = 1;
            for (let h = 1; h < this.maxHealth; h++) {
                const notchX = -barWidth / 2 + (barWidth / this.maxHealth) * h;
                ctx.beginPath();
                ctx.moveTo(notchX, yOffset);
                ctx.lineTo(notchX, yOffset + barHeight);
                ctx.stroke();
            }

            ctx.restore();
        }

        ctx.restore();
    }

    _drawCatalyst(ctx, x, y, color, chargeIntensity, lowQ) {
        ctx.save();
        ctx.translate(x, y);

        // Outer glow
        const r = 5 + chargeIntensity * 2;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = color;
        if (!lowQ) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 8 + chargeIntensity * 6;
        }
        ctx.fill();

        // Bright incandescent core
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();

        ctx.restore();
    }
}
