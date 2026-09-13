import { Particle } from '../Particle.js';
import { FloatingText } from '../FloatingText.js';
import { Projectile } from '../Projectile.js';

export class CombatSystem {
    constructor(game) {
        this.game = game;
    }

    castUltimateSpell() {
        // Wrapped so a failure mid-cast can never freeze the game; the
        // flash/particles may be partial but play always continues.
        try {
            this._castUltimateSpellInner();
        } catch (err) {
            console.error('[ArcaneTyper] castUltimateSpell failed:', err);
            if (this.game && this.game._reportError) this.game._reportError(err, 'ultimate');
        }
    }

    _castUltimateSpellInner() {
        if (!this.game.stats.useMana(100)) return;

        // Mana Overflow Skill: Ultimate restores 1 Barrier
        if (this.game.stats.hasSkill('burst')) {
            const maxAllowedLives = this.game.stats.hasSkill('life') ? 5 : 4;
            if (this.game.stats.lives < maxAllowedLives) {
                this.game.stats.lives++;
                this.game.stats.updateLivesDisplay();
            }
        }

        // Echo Cast Skill: 20% chance to immediately refund 50% max mana
        if (this.game.stats.hasSkill('echo') && Math.random() < 0.20) {
            this.game.stats.mana = Math.min(this.game.stats.maxMana, this.game.stats.mana + (this.game.stats.maxMana * 0.5));
            this.game.stats.updateHUD();
            this.spawnExplosion(this.game.canvas.width / 2, this.game.canvas.height / 2, { particles: ['#FF5722', '#FFE0B2', '#E64A19'] }, 1.5);
        }

        // Chronomancer Discipline Master of Time: Flat refund of 50 mana
        if (this.game.stats.mageClass === 'Chronomancer') {
            this.game.stats.mana = Math.min(this.game.stats.maxMana, this.game.stats.mana + 50);
            this.game.stats.updateHUD();
            // Golden chronomancer particles
            this.spawnExplosion(this.game.canvas.width / 2, this.game.canvas.height / 2, { particles: ['#ffd700', '#ffeb3b', '#fff9c4'] }, 1.0);
        }

        this.game.audio.playExplosion();
        // Massive screen shake for Nova
        this.game.combatSystem.triggerShake(35, 900);

        const selectedChar = this.game.stats.selectedCharacter;
        const cw = this.game.canvas.width;
        const ch = this.game.canvas.height;
        const cx = cw / 2;
        const cy = ch / 2;

        if (selectedChar === 'gojo') {
            // === HOLLOW PURPLE — Enhanced with Unlimited Void ===

            // Trigger Unlimited Void domain overlay
            this.game.domainType = 'void';
            this.game.domainTimer = this.game.domainDuration;
            this.game.domainAlpha = 0;

            // Flash screen purple
            this.game.ctx.fillStyle = 'rgba(224, 64, 251, 0.85)';
            this.game.ctx.fillRect(0, 0, cw, ch);

            // Enhanced purple/cyan/white particle burst (larger count)
            this.spawnExplosion(cx, cy, { particles: ['#d500f9', '#00e5ff', '#ffffff', '#aa00ff', '#e040fb'] }, 7.0);
            this.game.particles.push(new Particle(cx, cy, 'shockwave_purple'));

            // Spinning purple vortex particles (ring of purple orbs around center)
            for (let v = 0; v < 12; v++) {
                const vAngle = (v / 12) * Math.PI * 2;
                const vr = 30 + Math.random() * 20;
                const vx = cx + Math.cos(vAngle) * vr;
                const vy = cy + Math.sin(vAngle) * vr;
                const p = new Particle(vx, vy, Math.random() > 0.5 ? '#e040fb' : '#aa00ff');
                p.size = 3 + Math.random() * 3;
                p.life = 1.2;
                this.game.particles.push(p);
            }

            // Full-screen purple energy beam (horizontal slash line particle)
            this.game.particles.push(new Particle(cx, cy, {
                type: 'slash_line',
                color: '#e040fb',
                angle: 0,
                length: cw * 0.9,
                width: 4
            }));

            // Hollow Purple title
            this.game.floatingTexts.push(new FloatingText("HOLLOW PURPLE", cx, cy - 55, "#e040fb", 42));

        } else if (selectedChar === 'sukuna') {
            // === MALEVOLENT SHRINE — Enhanced with domain + slash rain + cleave ===

            // Trigger Malevolent Shrine domain overlay
            this.game.domainType = 'shrine';
            this.game.domainTimer = this.game.domainDuration;
            this.game.domainAlpha = 0;

            // Flash screen red
            this.game.ctx.fillStyle = 'rgba(255, 23, 68, 0.85)';
            this.game.ctx.fillRect(0, 0, cw, ch);

            // Enhanced crimson/black/gold particle burst
            this.spawnExplosion(cx, cy, { particles: ['#ff1744', '#212121', '#ffc107', '#d50000', '#b71c1c'] }, 7.0);
            this.game.particles.push(new Particle(cx, cy, 'shockwave_red'));

            // Rain of slashes — 18 slash lines from random positions across screen
            for (let s = 0; s < 18; s++) {
                const sx = Math.random() * cw;
                const sy = Math.random() * ch * 0.7;
                const sAngle = -Math.PI / 4 + Math.random() * Math.PI / 2;
                const sColor = Math.random() > 0.3 ? '#ff1744' : '#ffc107';
                this.game.particles.push(new Particle(sx, sy, {
                    type: 'slash_line',
                    color: sColor,
                    angle: sAngle,
                    length: 40 + Math.random() * 60,
                    width: 1.5 + Math.random() * 2
                }));
            }

            // Massive full-width Cleave projectile across the center
            const cleave = new Projectile(
                0, cy, cw, cy,
                ['#ff1744', '#ffea00'], 'sukuna_cleave'
            );
            this.game.projectiles.push(cleave);

            // Malevolent Shrine title
            this.game.floatingTexts.push(new FloatingText("MALEVOLENT SHRINE", cx, cy - 55, "#ff1744", 42));
        } else {
            // Flash screen blue/cyan
            this.game.ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
            this.game.ctx.fillRect(0, 0, this.game.canvas.width, this.game.canvas.height);

            // Spawn massive center explosion and Shockwave
            this.spawnExplosion(this.game.canvas.width / 2, this.game.canvas.height / 2, { particles: ['#00e5ff', '#ffffff', '#0077ff'] }, 5.0);
            this.game.particles.push(new Particle(this.game.canvas.width / 2, this.game.canvas.height / 2, 'shockwave'));

            // Supernova title
            this.game.floatingTexts.push(new FloatingText("SUPERNOVA", this.game.canvas.width / 2, this.game.canvas.height / 2 - 55, "#00e5ff", 42));
        }

        // Destroy all normal words
        for (let i = this.game.words.length - 1; i >= 0; i--) {
            const word = this.game.words[i];

            // Skip if dying or is a boss attack
            if (word.dying || word.isBossAttack) continue;

            this.game.stats.addScore(word.text.length, false);
            word.dying = true;
            this.spawnExplosion(word.x, word.y, word.elementColors, 0.5);

            if (word === this.game.targetedWord) {
                this.game.targetedWord = null;
            }
        }

        // Damage Boss heavily
        if (this.game.isBossPhase && this.game.boss && !this.game.boss.isDead) {
            for (let i = 0; i < 3; i++) {
                this.game.boss.takeDamage();
            }
        }
    }

    spawnExplosion(x, y, elementColors, bonusMultiplier = 0) {
        const colors = elementColors.particles;
        let numParticles = 35 + Math.random() * 20; // More energetic burst
        numParticles *= (1 + bonusMultiplier);

        // Performance guard: cap the total live particle population.
        // Every particle costs a shadowed canvas draw; uncapped Nova casts
        // (7x multiplier ≈ 380 particles) stagger slow machines. When the
        // budget is exhausted, oldest particles are recycled first.
        const MAX_PARTICLES = window.__atLowQuality ? 150 : 400;
        const room = MAX_PARTICLES - this.game.particles.length;
        if (room <= 0) {
            // Recycle: replace the oldest third rather than growing the array
            const recycleCount = Math.min(numParticles, Math.floor(MAX_PARTICLES / 3));
            for (let i = 0; i < recycleCount; i++) {
                const old = this.game.particles.shift();
                if (!old) break;
                const color = colors[Math.floor(Math.random() * colors.length)];
                this.game.particles.push(new Particle(x, y, color));
            }
            return;
        }
        numParticles = Math.min(numParticles, room);

        for (let i = 0; i < numParticles; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const particle = new Particle(x, y, color);

            if (bonusMultiplier > 0) {
                particle.speed *= (1 + bonusMultiplier * 0.5);
                particle.size *= (1 + bonusMultiplier * 0.5);
            }

            this.game.particles.push(particle);
        }
    }

    spawnHitSpark(x, y, elementColors) {
        const colors = elementColors.particles;
        const numParticles = 4 + Math.random() * 3;
        for (let i = 0; i < numParticles; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const p = new Particle(x, y, color);
            p.life = 0.5;
            p.size = Math.random() * 2 + 1;
            p.isRune = false;
            this.game.particles.push(p);
        }
    }

    castBossSpell() {
        if (!this.game.boss) return;
        const blindDuration = this.game.stats.hasSkill('vision') ? 2000 : 4000;
        this.game.blindTimer = blindDuration;

        this.spawnExplosion(this.game.boss.x, this.game.boss.y, { particles: ['#8a2be2', '#4b0082', '#000000'] });
        this.game.audio.playExplosion();
        this.triggerShake(10, 400);

        this.game.floatingTexts.push(new FloatingText("BOSS CASTS BLINDNESS!", this.game.canvas.width / 2, this.game.canvas.height / 2, "#8a2be2", 36));
    }

    receiveAttack(type) {
        if (!this.game.isRunning) return;

        if (type === 'blind') {
            const blindDuration = this.game.stats.hasSkill('vision') ? 2000 : 4000;
            this.game.blindTimer = blindDuration;
            this.game.floatingTexts.push(new FloatingText("BLINDED!", this.game.canvas.width / 2, this.game.canvas.height / 2, "#d500f9", 48));
        } else if (type === 'swarm') {
            this.game.floatingTexts.push(new FloatingText("SWARM INBOUND!", this.game.canvas.width / 2, this.game.canvas.height / 2, "#ff4b4b", 48));
            for (let i = 0; i < 4; i++) {
                // Use _spawnSingleWord so the boss counter is NOT incremented
                this.game._spawnSingleWord();
            }
        }
    }

    triggerShake(intensity, duration) {
        this.game.shakeIntensity = intensity;
        this.game.shakeTimer = duration;
    }
}
