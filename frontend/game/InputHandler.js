import { FloatingText } from '../FloatingText.js';
import { Projectile } from '../Projectile.js';
import { Particle } from '../Particle.js';

export class InputHandler {
    constructor(game) {
        this.game = game;
        this._keydownHandler = (e) => this.handleKeyDown(e);
    }

    enable() {
        this.disable();
        document.addEventListener('keydown', this._keydownHandler);
    }

    disable() {
        document.removeEventListener('keydown', this._keydownHandler);
    }

    handleKeyDown(e) {
        if (!this.game.isRunning) return;

        // Check for Ultimate Spell (Tab or Enter key)
        if (e.key === 'Tab' || e.key === 'Enter') {
            if (e.preventDefault) e.preventDefault(); // Prevent focus switching
            this.game.combatSystem.castUltimateSpell();
            return;
        }

        if (e.ctrlKey || e.altKey || e.metaKey || e.key.length > 1) return;

        // Ignore Spacebar so players don't accidentally break combo after finishing a word,
        // unless the currently targeted word specifically expects a space.
        if (e.key === ' ') {
            const needsSpace = this.game.targetedWord &&
                !this.game.targetedWord.dying &&
                !this.game.targetedWord.isDead &&
                this.game.targetedWord.untyped &&
                this.game.targetedWord.untyped[0] === ' ';
            if (!needsSpace) {
                if (e.preventDefault) e.preventDefault();
                return;
            }
        }

        // Extremely important: prevent default to stop Desktop browsers from 
        // also typing this letter into the hidden `mobileInput`, which would 
        // cause a synthetic double-fire event!
        if (e.preventDefault) e.preventDefault();

        const letter = e.key.toLowerCase();

        if (this.game.targetedWord && !this.game.targetedWord.dying && !this.game.targetedWord.isDead) {
            this.processKeystroke(this.game.targetedWord, letter);
        } else {
            if (this.game.targetedWord) {
                this.game.targetedWord.isTargeted = false;
                this.game.targetedWord = null;
            }
            let potentialTargets = this.game.words.filter(w => !w.dying && !w.isDead && w.untyped && w.untyped.length > 0 && w.untyped[0].toLowerCase() === letter);
            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.y - a.y);
                this.game.targetedWord = potentialTargets[0];
                this.game.targetedWord.isTargeted = true;
                this.processKeystroke(this.game.targetedWord, letter);
            } else {
                this.game.stats.recordStroke(false);
                if (this.game.onDuelCombo) this.game.onDuelCombo(this.game.stats.combo);
                this.game.audio.playErrorSound();
                this.game.stats.updateHUD(); // Ensure combo break is visible
                if (this.game.onRaceMistake) this.game.onRaceMistake(); // AT-F9: stray key
            }
        }
    }

    processKeystroke(word, letter) {
        if (word.untyped && word.untyped.length > 0 && word.untyped[0].toLowerCase() === letter) {
            word.typed += word.untyped[0];
            word.untyped = word.untyped.slice(1);
            this.game.stats.recordStroke(true);
            if (this.game.onDuelCombo) this.game.onDuelCombo(this.game.stats.combo);
            this.game.audio.playTypeSound();

            // Spark at typed position (centralized to match word baseline)
            this.game.ctx.font = 'bold 32px Cinzel, serif';
            const fullWidth = this.game.ctx.measureText(word.text).width;
            const typedWidth = this.game.ctx.measureText(word.typed).width;
            const sparkX = word.x + (-fullWidth / 2 + typedWidth) * word.scale;
            const sparkY = word.y + 70 * word.scale;
            this.game.combatSystem.spawnHitSpark(sparkX, sparkY, word.elementColors);

            if (word.untyped.length === 0) {
                if (this.game.onRaceTyped) this.game.onRaceTyped(); // AT-F9: claim instant
                this.game.achievements.onEvent('word_typed');
                this.game.waveWordsTyped++;
                // Word fully typed — trigger death animation
                this.game.stats.addScore(word.text.length, true, word.mistakesMade === 0);
                word.dying = true; // Let the animation play instead of instant splice
                this.game.audio.playExplosion();
                this.game.floatingTexts.push(new FloatingText(`+${word.text.length * 10}`, word.x, word.y - 15 * word.scale, "#00e5ff", 28));

                // Element-colored shatter burst
                const comboBonus = Math.min(this.game.stats.combo, 50) / 50;
                this.game.combatSystem.spawnBurst(word.x, word.y + 15 * word.scale, word.elementColors.particles);

                this.game.playerAnimTimer = 200;
                this.game.combatSystem.triggerShake(4 + comboBonus * 4, 150 + comboBonus * 100);

                // Combo Milestones — rendered cleanly on canvas with zero DOM thrashing
                const combo = this.game.stats.combo;
                if (combo > 0 && combo % 10 === 0) {
                    let milestoneText = `${combo}x COMBO!`;
                    let milestoneColor = '#ffd700';
                    let shakePower = 10;
                    if (combo >= 200) {
                        milestoneText = `GODLIKE ${combo}x STREAK!`;
                        milestoneColor = '#ffffff';
                        shakePower = 16;
                    } else if (combo >= 150) {
                        milestoneText = `TRANSCENDENT ${combo}x STREAK!`;
                        milestoneColor = '#d500f9';
                        shakePower = 14;
                    } else if (combo >= 100) {
                        milestoneText = `CELESTIAL ${combo}x STREAK!`;
                        milestoneColor = '#00e5ff';
                        shakePower = 12;
                    } else if (combo >= 50) {
                        milestoneText = `ASCENDANT ${combo}x STREAK!`;
                        milestoneColor = '#ff9100';
                        shakePower = 11;
                    }
                    this.game.floatingTexts.push(new FloatingText(milestoneText, this.game.canvas.width / 2, this.game.canvas.height / 2 - 80, milestoneColor, 44));
                    this.game.combatSystem.triggerShake(shakePower, 400);
                }

                // Combustion Talent (Explosion AoE)
                if (this.game.stats.hasSkill('combustion') && this.game.stats.combo >= 50) {
                    const radius = 150;
                    for (let j = this.game.words.length - 1; j >= 0; j--) {
                        const otherW = this.game.words[j];
                        if (!otherW.dying && !otherW.isBossAttack && otherW !== word) {
                            const dist = Math.hypot(otherW.x - word.x, otherW.y - word.y);
                            if (dist < radius) {
                                otherW.dying = true;
                                this.game.stats.addScore(otherW.text.length, false);
                                this.game.combatSystem.spawnExplosion(otherW.x, otherW.y, otherW.elementColors, 0.5);
                                if (otherW === this.game.targetedWord) {
                                    otherW.isTargeted = false;
                                    this.game.targetedWord = null;
                                }
                            }
                        }
                    }
                }

                // Fire counter-attack projectile at boss
                if (this.game.isBossPhase && this.game.boss && !this.game.boss.isDead && word.isBossAttack) {
                    const startX = this.game.canvas.width / 2;
                    const startY = this.game.canvas.height - 40;
                    const targetXOffset = (Math.random() - 0.5) * 100;
                    
                    const colors = word.elementColors.particles;
                    const projectile = new Projectile(startX, startY, this.game.boss.x + targetXOffset, this.game.boss.y + 20, colors, 'normal');
                    this.game.projectiles.push(projectile);
                }

                // Release targeting immediately so player can type next word
                word.isTargeted = false;
                this.game.targetedWord = null;
            }
        } else {
            this.game.stats.recordStroke(false);
            this.game.audio.playErrorSound();
            if (word) word.mistakesMade++;
            if (this.game.onRaceMistake) this.game.onRaceMistake(); // AT-F9: mistake forfeits

            // Armored words reset on typo!
            if (word.variant === 'armored' && word.typed.length > 0) {
                word.untyped = word.typed + word.untyped;
                word.typed = "";
                word.isTargeted = false;
                this.game.targetedWord = null;
                this.game.audio.playShatter();
                this.game.floatingTexts.push(new FloatingText("Armor Repaired!", word.x, word.y - 30, "#a0a0a0", 20));

                // Visual feedback for armor regenerating
                this.game.ctx.font = 'bold 32px Cinzel, serif';
                const sparkX = word.x - this.game.ctx.measureText(word.text).width / 2 * word.scale;
                this.game.combatSystem.spawnHitSpark(sparkX, word.y, word.elementColors);
            }
        }

        this.game.stats.updateHUD();

        // Update audio intensity based on combo (0.0 to 1.0, maxing at 50 combo)
        this.game.audio.setMusicIntensity(this.game.stats.combo / 50);
    }
}
