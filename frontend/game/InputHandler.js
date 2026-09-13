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

        // Ignore Spacebar so players don't accidentally break combo after finishing a word
        if (e.key === ' ') {
            if (e.preventDefault) e.preventDefault();
            return;
        }

        // Extremely important: prevent default to stop Desktop browsers from 
        // also typing this letter into the hidden `mobileInput`, which would 
        // cause a synthetic double-fire event!
        if (e.preventDefault) e.preventDefault();

        const letter = e.key.toLowerCase();

        if (this.game.targetedWord) {
            this.processKeystroke(this.game.targetedWord, letter);
        } else {
            let potentialTargets = this.game.words.filter(w => !w.dying && w.untyped[0] === letter);
            if (potentialTargets.length > 0) {
                potentialTargets.sort((a, b) => b.y - a.y);
                this.game.targetedWord = potentialTargets[0];
                this.game.targetedWord.isTargeted = true;
                this.processKeystroke(this.game.targetedWord, letter);
            } else {
                this.game.stats.recordStroke(false);
                this.game.audio.playErrorSound();
                this.game.stats.updateHUD(); // Ensure combo break is visible
            }
        }
    }

    processKeystroke(word, letter) {
        if (word.untyped[0] === letter) {
            word.typed += letter;
            word.untyped = word.untyped.slice(1);
            this.game.stats.recordStroke(true);
            this.game.audio.playTypeSound();

            // Spark at typed position
            this.game.ctx.font = 'bold 32px Cinzel, serif';
            const fullWidth = this.game.ctx.measureText(word.text).width;
            const typedWidth = this.game.ctx.measureText(word.typed).width;
            const textXOffset = -35;
            const sparkX = word.x + (-fullWidth / 2 + textXOffset + typedWidth) * word.scale;
            const sparkY = word.y + 70 * word.scale;
            this.game.combatSystem.spawnHitSpark(sparkX, sparkY, word.elementColors);

            if (word.untyped.length === 0) {
                this.game.achievements.onEvent('word_typed');
                this.game.waveWordsTyped++;
                // Word fully typed — trigger death animation
                this.game.stats.addScore(word.text.length, true, word.mistakesMade === 0);
                word.dying = true; // Let the animation play instead of instant splice
                // Set character-specific death visual style
                const charForDeath = this.game.stats.selectedCharacter;
                if (charForDeath === 'gojo') word.deathStyle = 'purple';
                else if (charForDeath === 'sukuna') word.deathStyle = 'slash';
                this.game.audio.playExplosion();
                this.game.floatingTexts.push(new FloatingText(`+${word.text.length * 10}`, word.x, word.y - 15 * word.scale, "#00e5ff", 28));

                // Character-specific word death effects
                const comboBonus = Math.min(this.game.stats.combo, 50) / 50;
                const selectedChar = this.game.stats.selectedCharacter;

                if (selectedChar === 'gojo') {
                    // Hollow Purple — purple/cyan palette splash
                    this.game.combatSystem.spawnBurst(word.x, word.y + 15 * word.scale,
                        ['#e040fb', '#d500f9', '#00e5ff', '#aa00ff', '#ffffff']);
                } else if (selectedChar === 'sukuna') {
                    // Dismantle slash — slash lines through the word + crimson splash
                    const slashCount = 2 + Math.floor(Math.random() * 2); // 2-3 slashes
                    for (let sl = 0; sl < slashCount; sl++) {
                        const slAngle = -0.8 + Math.random() * 1.6;
                        const slColor = Math.random() > 0.3 ? '#ff1744' : '#ffea00';
                        this.game.particles.push(new Particle(word.x, word.y + 15 * word.scale, {
                            type: 'slash_line',
                            color: slColor,
                            angle: slAngle,
                            length: 50 + Math.random() * 40,
                            width: 2 + Math.random() * 1.5
                        }));
                    }
                    this.game.combatSystem.spawnBurst(word.x, word.y + 15 * word.scale,
                        ['#ff1744', '#d50000', '#ffea00', '#212121']);
                } else {
                    // Default wizard — element-colored splash
                    this.game.combatSystem.spawnBurst(word.x, word.y + 15 * word.scale, word.elementColors.particles);
                }

                this.game.playerAnimTimer = 200;
                this.game.combatSystem.triggerShake(4 + comboBonus * 4, 150 + comboBonus * 100);

                // Combo Milestones
                const combo = this.game.stats.combo;
                if (combo > 0 && combo % 10 === 0) {
                    const milestoneText = document.createElement('div');
                    milestoneText.className = 'combo-milestone-text';
                    milestoneText.textContent = `${combo}x COMBO!`;
                    document.body.appendChild(milestoneText);

                    // Extra large screen shake
                    this.game.combatSystem.triggerShake(10, 400);

                    // Remove after animation completes
                    setTimeout(() => milestoneText.remove(), 1500);
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
                                if (otherW === this.game.targetedWord) this.game.targetedWord = null;
                            }
                        }
                    }
                }

                // Fire counter-attack projectile at boss
                if (this.game.isBossPhase && this.game.boss && !this.game.boss.isDead && word.isBossAttack) {
                    const startX = this.game.canvas.width / 2;
                    const startY = this.game.canvas.height - 40;
                    const targetXOffset = (Math.random() - 0.5) * 100;
                    
                    let colors = word.elementColors.particles;
                    let type = 'normal';
                    
                    const selectedChar = this.game.stats.selectedCharacter;
                    if (selectedChar === 'gojo') {
                        // Alternate blue and red energy orbs
                        const isBlue = Math.random() < 0.5;
                        type = isBlue ? 'gojo_blue' : 'gojo_red';
                        colors = isBlue ? ['#00e5ff', '#ffffff'] : ['#ff1744', '#ffffff'];
                    } else if (selectedChar === 'sukuna') {
                        type = 'sukuna_slash';
                        colors = ['#ff1744', '#ffea00'];
                    }
                    
                    if (selectedChar === 'sukuna') {
                        // Dismantle barrage — fire 3 rapid slash projectiles with slight offsets
                        for (let si = 0; si < 3; si++) {
                            const offsetX = (si - 1) * 8;
                            const offsetY = si * 4;
                            const projectile = new Projectile(
                                startX + offsetX, startY + offsetY,
                                this.game.boss.x + targetXOffset + offsetX, this.game.boss.y + 20,
                                colors, type
                            );
                            this.game.projectiles.push(projectile);
                        }
                    } else {
                        const projectile = new Projectile(startX, startY, this.game.boss.x + targetXOffset, this.game.boss.y + 20, colors, type);
                        this.game.projectiles.push(projectile);
                    }
                }

                // Release targeting immediately so player can type next word
                this.game.targetedWord = null;
            }
        } else {
            this.game.stats.recordStroke(false);
            this.game.audio.playErrorSound();
            if (word) word.mistakesMade++;

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
