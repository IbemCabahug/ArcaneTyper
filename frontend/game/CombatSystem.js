import { Particle } from '../Particle.js';
import { FloatingText } from '../FloatingText.js';
import { Projectile } from '../Projectile.js';
import { teamColorFor } from './ArenaTeams.js';

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
        // AT-F9 P3: the seal is a message to THIS player about THEIR mage, so
        // it is drawn over their own team slot (host left / challenger right)
        // in their team colour — not dead-centre where it reads as ambiguous,
        // and never mirrored.
        if (this.game.gameMode === 'duel') {
            // AT-F10: inside the arena this press is the player's Discipline
            // active, not the ultimate. The race answers true for every press it
            // owned (cast, already armed, not enough mana) and false only when
            // there is nothing to hand the press to — so the seal message below
            // still explains the ultimate pre-FIGHT and after a match.
            if (this.game.onDuelCast && this.game.onDuelCast()) return;
            this.game.audio.playErrorSound();
            const side = this.game.duelSide || 'A';
            const text = 'THE ARENA SEALS YOUR ULTIMATE!';
            const size = 20;
            const ctx = this.game.ctx;
            // Clamp inside the canvas: the message is wider than one slot on
            // narrow/mobile viewports, and must never bleed off the edge.
            ctx.save();
            ctx.font = `bold ${size}px Cinzel, serif`;
            const half = ctx.measureText(text).width / 2;
            ctx.restore();
            const x = Math.min(
                Math.max(this.game.duelSlotX(side), half + 8),
                this.game.canvas.width - half - 8
            );
            this.game.floatingTexts.push(
                new FloatingText(text, x, this.game.canvas.height - 130, teamColorFor(side), size)
            );
            return;
        }
        const hasDestructibleWords = this.game.words.some(w => !w.dying && !w.isBossAttack);
        const hasBoss = this.game.isBossPhase && this.game.boss && !this.game.boss.isDead;
        const maxDefense = this.game.stats.getSurvivalMaxLives();
        const canHeal = this.game.stats.hasSkill('burst') && this.game.stats.lives < maxDefense;

        if (!hasDestructibleWords && !hasBoss && !canHeal) {
            this.game.audio.playErrorSound();
            const cx = this.game.canvas.width / 2;
            const cy = this.game.canvas.height / 2;
            this.game.floatingTexts.push(new FloatingText("NO TARGETS!", cx, cy - 30, "#ff5252", 28));
            return;
        }

        if (!this.game.stats.useMana(100)) return;

        // Mana Overflow Skill: Ultimate restores one character-specific defense
        // charge. Voidweaver calls these absorption charges; Bloodseeker calls
        // them lives; the Wizard keeps its historic barrier/final-life split.
        if (this.game.stats.hasSkill('burst')) {
            const maxAllowedLives = this.game.stats.getSurvivalMaxLives();
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
        const palette = this._supernovaPalette();

        // The shared meteor-shatter language remains the foundation of every
        // Supernova. Character cinematics then add a distinct staged identity;
        // gameplay effects below still resolve immediately.
        const isBloodseeker = this.game.stats?.selectedCharacter === 'bloodseeker';
        const isVoidweaver = this.game.stats?.selectedCharacter === 'voidweaver';
        this.game.supernovaFx = isBloodseeker
            ? { kind: 'blood-moon', startedAt: performance.now(), duration: 1000, seed: Math.random() * 1000 }
            : isVoidweaver
                ? { kind: 'void-collapse', startedAt: performance.now(), duration: 1000, seed: Math.random() * 1000 }
                : null;
        if (!isBloodseeker && !isVoidweaver) {
            this.game.ctx.fillStyle = palette.flash;
            this.game.ctx.fillRect(0, 0, cw, ch);
        }
        if (isVoidweaver) {
            this.spawnVoidImplosion(cx, cy, palette.particles, 3.5);
        } else {
            this.spawnExplosion(cx, cy, { particles: palette.particles }, isBloodseeker ? 3.5 : 6.0);
            this.spawnBurst(cx, cy, palette.particles);
            this.game.particles.spawn(cx, cy, palette.shockwave);
        }

        // Floating titles wait for the character-specific impact frame.
        if (!isBloodseeker && !isVoidweaver) {
            this.game.floatingTexts.push(new FloatingText("SUPERNOVA", cx, cy - 40, palette.title, 42));
        }

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
            // Bloodseeker's Supernova throws ALL FOUR netherblades at the boss as
            // one volley, timed to finish inside the 1 s Blood Moon cinematic so
            // the blades are already back in formation when the takeover ends.
            if (isBloodseeker) {
                this.game._leaseBladeVolley?.(this.game.boss.x, this.game.boss.y + 20);
            }
            for (let i = 0; i < 3; i++) {
                this.game.boss.takeDamage();
            }
        }
    }

    /**
     * How much damage the equipped character deals to the boss for one solved
     * word. This is the character's ATTACK identity against bosses, and each
     * branch mirrors how that character already fights everywhere else:
     *
     *   Wizard       — steady and versatile: a flat arcane bolt that rewards a
     *                  long word slightly.
     *   Voidweaver   — scales with the caster's own endless streak, because a
     *                  streak is what compresses space for this character.
     *   Bloodseeker  — scales with the BOSS's missing HP, because this
     *                  character hunts the wounded (same execution fantasy as
     *                  the Reaper arena Discipline).
     *
     * Deterministic and skill-linked by design: damage is a function of the
     * player's typing performance, never of chance.
     */
    bossStrikeDamage(wordLength = 0) {
        const len = Number.isFinite(wordLength) && wordLength > 0 ? wordLength : 0;
        const base = 3 + Math.floor(len / 4);
        const character = this.game?.stats?.selectedCharacter || 'wizard';

        if (character === 'voidweaver') {
            const combo = this.game?.stats?.combo || 0;
            const streakBonus = Math.min(5, Math.floor(Math.max(0, combo) / 20));
            return Math.max(1, 2 + streakBonus);
        }

        if (character === 'bloodseeker') {
            const boss = this.game?.boss;
            const max = boss && boss.maxHealth > 0 ? boss.maxHealth : 1;
            const missingPct = Math.max(0, Math.min(100, ((max - (boss ? boss.health : max)) / max) * 100));
            const executeBonus = Math.min(5, Math.floor(missingPct / 20));
            return Math.max(1, Math.round(base * 1.5) + executeBonus);
        }

        return base;
    }

    /**
     * Resolve one solved word against the boss: character damage profile plus
     * the matching impact presentation. The boss element is untouched — this
     * only changes WHO is striking and how hard.
     */
    strikeBoss(wordLength = 0) {
        const boss = this.game?.boss;
        if (!this.game?.isBossPhase || !boss || boss.isDead) return 0;

        const amount = this.bossStrikeDamage(wordLength);
        const dealt = boss.takeDamage(amount);
        const character = this.game.stats?.selectedCharacter || 'wizard';

        if (character === 'voidweaver') {
            // The boss is briefly crushed inward — the same singularity language
            // as the Voidweaver Supernova, at per-word scale.
            this.spawnVoidCrush(boss.x, boss.y + 20);
            this.game.audio.playVoidAbsorb();
        } else if (character === 'bloodseeker') {
            // A crimson carve through the boss, with life drawn back upward.
            // One netherblade is leased per solved word and flies out to cut the
            // boss before recalling. The rotation lives in Game._leaseBladeSlash
            // so a fast typist cycles 1→2→3→4 rather than re-striking one blade.
            this.game._leaseBladeSlash?.(boss.x, boss.y + 20);
            this.spawnBurst(boss.x, boss.y + 20, ['#ff1744', '#ff8a95', '#ffffff']);
            this.spawnReaverArc(boss.x, boss.y + 20);
            this.game.audio.playShatter();
        } else {
            this.spawnExplosion(boss.x, boss.y + 20, { particles: ['#ffd700', '#ffffff', '#ff4b4b'] });
            this.game.audio.playExplosion();
        }

        if (dealt > 1) {
            this.game.floatingTexts.push(new FloatingText(
                `-${dealt}`,
                boss.x,
                boss.y - 10,
                character === 'voidweaver' ? '#00e5ff' : character === 'bloodseeker' ? '#ff6b7a' : '#ffd700',
                26
            ));
        }
        this.game.combatSystem?.triggerShake?.(5, 200);
        return dealt;
    }

    /**
     * A per-word singularity centred on the struck boss. Deliberately much
     * smaller than spawnVoidImplosion (which is a screen-wide Supernova): the
     * motes start just outside the boss and collapse into it, so each solved
     * word visibly crushes the target rather than filling the canvas.
     */
    spawnVoidCrush(x, y) {
        const colors = ['#7c4dff', '#00e5ff', '#b388ff', '#ffffff'];
        const count = window.__atLowQuality ? 10 : 20;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 16 + Math.random() * 26;
            const p = this.game.particles.spawn(
                x + Math.cos(angle) * radius,
                y + Math.sin(angle) * radius * 0.7,
                colors[i % colors.length]
            );
            if (!p) continue;
            p.targetX = x;
            p.targetY = y;
            p.vx = -Math.sin(angle) * 0.22;
            p.vy = Math.cos(angle) * 0.14;
            p.gravity = 0;
            p.isVoidMote = true;
            p.isRune = false;
            p.size = 1.0 + Math.random() * 2.0;
            p.initialSize = p.size;
            p.life = 1;
            p.decay = 0.05 + Math.random() * 0.02;
        }
    }

    /** Bloodseeker's upward life-flow drawn out of a struck boss. */
    spawnReaverArc(x, y) {
        const colors = ['#ff1744', '#ff8a95'];
        const count = window.__atLowQuality ? 5 : 10;
        for (let i = 0; i < count; i++) {
            const p = this.game.particles.spawn(
                x + (Math.random() - 0.5) * 46,
                y + Math.random() * 26,
                colors[i % colors.length]
            );
            if (!p) continue;
            p.vx = (Math.random() - 0.5) * 0.5;
            p.vy = -1.1 - Math.random() * 0.9;   // life rising against gravity
            p.gravity = 0;
            p.size = 1.2 + Math.random() * 1.8;
            p.life = 1;
            p.decay = 0.05;
        }
    }

    _supernovaPalette() {
        const character = this.game?.stats?.selectedCharacter || 'wizard';
        if (character === 'voidweaver') {
            return {
                flash: 'rgba(7, 0, 24, 0.78)',
                particles: ['#7c4dff', '#00e5ff', '#b388ff', '#ffffff', '#1a0033'],
                title: '#c084fc',
                shockwave: 'shockwave_purple'
            };
        }
        if (character === 'bloodseeker') {
            return {
                flash: 'rgba(32, 0, 8, 0.78)',
                particles: ['#ff1744', '#ff8a95', '#ffd0d5', '#ffffff', '#4a0010'],
                title: '#ff8a95',
                shockwave: 'shockwave_red'
            };
        }
        return {
            flash: 'rgba(0, 229, 255, 0.78)',
            particles: ['#00e5ff', '#ffd700', '#ffffff', '#29b6f6', '#d500f9'],
            title: '#00e5ff',
            shockwave: 'shockwave'
        };
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

    /**
     * A boss meteor is swallowed by the Voidweaver's outer event horizon.
     * This is a pooled, target-seeking inward burst; it changes presentation
     * only, while Game.js has already resolved the actual defense charge.
     */
    spawnVoidAbsorption(x, y) {
        const colors = ['#7c4dff', '#00e5ff', '#b388ff', '#ffffff'];
        const count = window.__atLowQuality ? 10 : 18;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 18 + Math.random() * 34;
            const p = this.game.particles.spawn(
                x + Math.cos(angle) * radius,
                y + Math.sin(angle) * radius * 0.55,
                colors[i % colors.length]
            );
            if (!p) continue;
            p.targetX = x;
            p.targetY = y;
            p.isVoidMote = true;
            p.isRune = false;
            p.gravity = 0;
            p.vx = -Math.cos(angle) * 0.18;
            p.vy = -Math.sin(angle) * 0.12;
            p.size = 1.2 + Math.random() * 2.2;
            p.initialSize = p.size;
            p.life = 1;
            p.decay = 0.028 + Math.random() * 0.018;
        }
    }


    /**
     * Spawn a target-seeking vortex for the Voidweaver Supernova. Particles
     * begin around the center with tangential drift, then are pulled inward;
     * the target is intentionally fixed so the pool stays allocation-free.
     */
    spawnVoidImplosion(cx, cy, colors, strength = 3.5) {
        const count = window.__atLowQuality ? 34 : 66;
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const radius = 28 + Math.random() * Math.min(this.game.canvas.width, this.game.canvas.height) * 0.42;
            const color = colors[Math.floor(Math.random() * colors.length)];
            const p = this.game.particles.spawn(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius * 0.58, color);
            if (!p) continue;
            p.targetX = cx;
            p.targetY = cy;
            p.vx = -Math.sin(angle) * (0.35 + strength * 0.05);
            p.vy = Math.cos(angle) * (0.20 + strength * 0.03);
            p.gravity = 0;
            p.isVoidMote = true;
            p.isRune = false;
            p.size = 1.2 + Math.random() * 2.6;
            p.initialSize = p.size;
            p.life = 1;
            p.decay = 0.018 + Math.random() * 0.014;
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
