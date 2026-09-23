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
        // AT-F9: ultimates are sealed out of the arena — the shared race
        // word must never be cleared (or healed around) on one client only.
        if (this.game.gameMode === 'duel') {
            this.game.audio.playErrorSound();
            const cx = this.game.canvas.width / 2;
            const cy = this.game.canvas.height / 2;
            this.game.floatingTexts.push(new FloatingText('THE ARENA SEALS YOUR ULTIMATE!', cx, cy - 30, '#ff9800', 26));
            return;
        }
        const hasDestructibleWords = this.game.words.some(w => !w.dying && !w.isBossAttack);
        const hasBoss = this.game.isBossPhase && this.game.boss && !this.game.boss.isDead;
        const canHeal = this.game.stats.hasSkill('burst') && this.game.stats.lives < (this.game.stats.hasSkill('life') ? 5 : 4);

        if (!hasDestructibleWords && !hasBoss && !canHeal) {
            this.game.audio.playErrorSound();
            const cx = this.game.canvas.width / 2;
            const cy = this.game.canvas.height / 2;
            this.game.floatingTexts.push(new FloatingText("NO TARGETS!", cx, cy - 30, "#ff5252", 28));
            return;
        }

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

        const cw = this.game.canvas.width;
        const ch = this.game.canvas.height;
        const cx = cw / 2;
        const cy = ch / 2;

        // Flash screen brilliant celestial cyan/gold
        this.game.ctx.fillStyle = 'rgba(0, 229, 255, 0.9)';
        this.game.ctx.fillRect(0, 0, cw, ch);

        // Massive celestial explosion & shockwave
        this.spawnExplosion(cx, cy, { particles: ['#00e5ff', '#ffd700', '#ffffff', '#29b6f6', '#d500f9'] }, 6.0);
        this.game.particles.spawn(cx, cy, 'shockwave_blue');

        // Floating Title
        this.game.floatingTexts.push(new FloatingText("SUPERNOVA", cx, cy - 40, "#00e5ff", 42));

        // Destroy all normal words
        for (let i = this.game.words.length - 1; i >= 0; i--) {
            const word = this.game.words[i];

            // Skip if dying or is a boss attack
            if (word.dying || word.isBossAttack) continue;

            this.game.stats.addScore(word.text.length, false);
            word.dying = true;
            this.spawnBurst(word.x, word.y, word.elementColors.particles);

            if (word === this.game.targetedWord) {
                word.isTargeted = false;
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
        let numParticles = 30 + Math.random() * 15;
        numParticles *= (1 + bonusMultiplier);

        const MAX_PARTICLES = window.__atLowQuality ? 100 : 250;
        numParticles = Math.min(numParticles, MAX_PARTICLES);

        for (let i = 0; i < numParticles; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const particle = this.game.particles.spawn(x, y, color);
            if (particle && bonusMultiplier > 0) {
                particle.vx *= (1 + bonusMultiplier * 0.35);
                particle.vy *= (1 + bonusMultiplier * 0.35);
                particle.size *= (1 + bonusMultiplier * 0.35);
            }
        }
    }

    spawnBurst(x, y, palette) {
        // High-juice kill visual: ONE pre-baked splash image + pooled shard spray
        const colors = Array.isArray(palette) ? palette : [palette];
        this.game.particles.spawn(x, y, { type: 'burst', colors });
        const shards = window.__atLowQuality ? 4 : 8;
        for (let i = 0; i < shards; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const p = this.game.particles.spawn(x, y, color);
            if (p) {
                p.size = Math.random() * 3 + 1.5;
                p.decay = Math.random() * 0.02 + 0.01;
            }
        }
    }

    spawnHitSpark(x, y, elementColors) {
        const colors = elementColors.particles;
        const numParticles = 4 + Math.random() * 3;
        for (let i = 0; i < numParticles; i++) {
            const color = colors[Math.floor(Math.random() * colors.length)];
            const p = this.game.particles.spawn(x, y, color);
            if (p) {
                p.life = 0.5;
                p.size = Math.random() * 2 + 1;
                p.isRune = false;
            }
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
