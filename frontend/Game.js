import { Word } from './Word.js';
import { Boss } from './Boss.js';
import { Projectile } from './Projectile.js';
import { WordDictionary } from './WordDictionary.js';
import { Stats } from '../backend/Stats.js';

import { Particle } from './Particle.js';
import { AudioController } from './AudioController.js';
import { FloatingText } from './FloatingText.js';
import { Achievements } from './Achievements.js';
import { InputHandler } from './game/InputHandler.js';
import { CombatSystem } from './game/CombatSystem.js';

export class Game {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');

        this.dictionary = new WordDictionary();
        this.audio = new AudioController();
        this.achievements = new Achievements(this.audio);
        this.stats = new Stats(this.achievements);

        this.words = [];
        this.particles = [];
        this.ambientParticles = [];
        this.floatingTexts = [];
        this.targetedWord = null;

        this.lastTime = 0;
        this.spawnTimer = 0;
        this.spawnInterval = 3000; // ms
        this.lastHudUpdate = 0; // For throttled HUD updates

        this.isRunning = false;
        this.isPaused = false;
        this.animationFrameId = null;

        this.playerAnimTimer = 0;

        // Screen shake
        this.shakeTimer = 0;
        this.shakeIntensity = 0;

        // Star field (initialized in reset)
        this.stars = [];

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());

        this.inputHandler = new InputHandler(this);
        this.combatSystem = new CombatSystem(this);

        this.onGameOver = () => { };
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        this.canvas.width = parent.clientWidth;
        this.canvas.height = parent.clientHeight;

        // Re-generate star field when canvas resizes
        this._initStars();
    }

    _initStars() {
        this.stars = [];
        const count = 80;
        for (let i = 0; i < count; i++) {
            this.stars.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: Math.random() * 1.5 + 0.3,
                speed: Math.random() * 800 + 400,   // twinkle speed (ms per cycle)
                phase: Math.random() * Math.PI * 2, // random starting phase
                brightness: Math.random() * 0.5 + 0.3
            });
        }

        // Init ambient atmospheric particles (dust motes)
        this.ambientParticles = [];
        for (let i = 0; i < 40; i++) {
            this.ambientParticles.push({
                x: Math.random() * this.canvas.width,
                y: Math.random() * this.canvas.height,
                size: Math.random() * 2 + 1,
                vx: (Math.random() - 0.5) * 0.05,
                vy: (Math.random() - 0.5) * 0.05 - 0.02, // slight upward drift
                alpha: Math.random() * 0.3 + 0.1
            });
        }
    }

    start(difficulty = 'normal', mode = 'classic', dictionaryType = 'classic') {
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        const mobileInput = document.getElementById('mobile-input');
        if (mobileInput) {
            mobileInput.value = ' ';
        }
        this.difficulty = difficulty;
        this.gameMode = mode;
        this.dictionary.setDictionary(dictionaryType);

        if (this.gameMode === 'daily') {
            const todayStr = new Date().toISOString().split('T')[0];
            this.dictionary.setSeed(todayStr);
            // Force normal difficulty for daily challenges to ensure fairness
            this.difficulty = 'normal';
        } else {
            this.dictionary.setSeed(null);
        }

        this.reset();
        this.isRunning = true;
        this.audio.startBackgroundMusic();
        this.inputHandler.enable();
        this.lastTime = performance.now();
        this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
    }

    stop() {
        this.isRunning = false;
        this.audio.stopBackgroundMusic();
        this.inputHandler.disable();
        if (this.animationFrameId) {
            cancelAnimationFrame(this.animationFrameId);
        }
        const mobileInput = document.getElementById('mobile-input');
        if (mobileInput) {
            mobileInput.value = ' ';
        }
    }

    reset() {
        this.words = [];
        this.particles = [];
        this.projectiles = [];
        this.floatingTexts = [];
        this.targetedWord = null;
        this.spawnTimer = 0;
        this.spawnCount = 0;
        this.scrambleTimer = 0;
        this.isPaused = false;
        this.wave = 1;
        this.waveWordsTyped = 0;
        this.waveTimer = 0;

        // Boss phase state
        this.isBossPhase = false;
        this.boss = null;
        this.bossDimensionAlpha = 0;
        this.bossesDefeated = 0;

        // Screen shake
        this.shakeTimer = 0;
        this.shakeIntensity = 0;

        // Domain Expansion overlay
        this.domainType = null; // 'void' | 'shrine' | null
        this.domainTimer = 0;
        this.domainDuration = 1500; // ms
        this.domainAlpha = 0;

        // Gojo Infinity barrier spawn timer
        this.infinitySpawnTimer = 0;
        this.infinitySpawnInterval = 400; // spawn hex/ring every 400ms

        // Sukuna attack visual slash particles
        this.sukunaSlashTimer = 0;

        // Single run timer
        this.survivalTime = 0;
        this.survivorAwarded = false;

        // Difficulty settings
        const difficultySettings = {
            'easy': { speed: 0.8, spawnInt: 2500 },
            'normal': { speed: 1.2, spawnInt: 1800 },
            'hard': { speed: 1.6, spawnInt: 1200 },
            'hell': { speed: 2.2, spawnInt: 800 }
        };
        const settings = difficultySettings[this.difficulty] || difficultySettings['normal'];

        this.currentSpeedMultiplier = settings.speed;
        this.spawnInterval = settings.spawnInt;

        if (this.stats.hasSkill('clairvoyance')) {
            this.spawnInterval *= 1.25; // 25% slower spawns
        }

        this.precognitionUsed = false;

        this.blindTimer = 0; // Tracks active Blind spell duration

        this.stats.reset();
        const waveDisplay = document.getElementById('wave-display');
        if (waveDisplay) waveDisplay.textContent = this.wave;
        this._initStars();
    }

    gameLoop(currentTime) {
        if (!this.isRunning) return;

        let dt = currentTime - this.lastTime;
        dt = Math.min(dt, 50);
        this.lastTime = currentTime;

        if (!this.isPaused) {
            this.update(dt);
        }
        this.draw();

        if (this.isRunning) {
            this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
        }

        // Throttled HUD update: only update DOM stats every 200ms
        if (!this.isPaused && currentTime - this.lastHudUpdate >= 200) {
            this.stats.updateHUD();
            this.lastHudUpdate = currentTime;
        }
    }

    pause() {
        if (!this.isRunning || this.isPaused) return;
        this.isPaused = true;
        this.audio.stopBackgroundMusic();
        this.inputHandler.disable();
    }

    resume() {
        if (!this.isRunning || !this.isPaused) return;
        this.isPaused = false;
        this.audio.startBackgroundMusic();
        this.inputHandler.enable();
        this.lastTime = performance.now();
    }

    update(dt) {
        // Progressive Difficulty Wave Scaling
        if (!this.isBossPhase) {
            this.waveTimer += dt;
            // Advance wave every 30 seconds OR every 12 words typed
            if (this.waveTimer >= 30000 || this.waveWordsTyped >= 12) {
                this.wave++;
                this.waveTimer = 0;
                this.waveWordsTyped = 0;

                // Scale up difficulty: Speed +6%, Spawn frequency +5% (spawn interval decreases by 5%)
                this.currentSpeedMultiplier *= 1.06;
                this.spawnInterval = Math.max(400, this.spawnInterval * 0.95);

                // Update HUD wave counter
                const waveDisplay = document.getElementById('wave-display');
                if (waveDisplay) waveDisplay.textContent = this.wave;

                // Play encouraging magic sound
                this.audio.playExplosion();

                // Show giant "WAVE X" announcement float text in the middle of screen
                const announcementX = this.canvas.width / 2;
                const announcementY = this.canvas.height / 3;
                
                const annText = new FloatingText(`WAVE ${this.wave}`, announcementX, announcementY, "#ffd700", 38);
                annText.decay = 0.006; // decays much slower!
                this.floatingTexts.push(annText);

                const subText = new FloatingText("Spells accelerating...", announcementX, announcementY + 35, "#b892b0", 20);
                subText.decay = 0.008;
                this.floatingTexts.push(subText);

                // Spawn premium magic explosion burst in center
                this.combatSystem.spawnExplosion(announcementX, announcementY, {
                    particles: '#ffd700',
                    core: '#ffffff'
                }, 1.5);
            }
        }

        this.spawnTimer += dt;
        this.survivalTime += dt;

        if (!this.survivorAwarded && this.survivalTime > 300000) { // 5 minutes
            this.survivorAwarded = true;
            this.achievements.onEvent('time_survived', { time: 300 });
        }

        if (!this.isBossPhase && this.spawnTimer >= this.spawnInterval) {
            this.spawnWord();
            this.spawnTimer = 0;
        }

        // Chaos mode scramble
        if (this.gameMode === 'chaos' && !this.isBossPhase) {
            this.scrambleTimer += dt;
            if (this.scrambleTimer > 3000) { // Scramble every 3.0s
                this.scrambleTimer = 0;
                this.words.forEach(w => {
                    if (!w.isTargeted && w.scramble) w.scramble();
                });
            }
        }

        // Pocket Dimension fade
        if (this.isBossPhase && this.bossDimensionAlpha < 1) {
            this.bossDimensionAlpha = Math.min(1, this.bossDimensionAlpha + dt * 0.001);
        } else if (!this.isBossPhase && this.bossDimensionAlpha > 0) {
            this.bossDimensionAlpha = Math.max(0, this.bossDimensionAlpha - dt * 0.001);
        }

        if (this.playerAnimTimer > 0) {
            this.playerAnimTimer = Math.max(0, this.playerAnimTimer - dt);
        }

        // Visual effect decay
        if (this.bloodVignetteIntensity > 0) {
            this.bloodVignetteIntensity = Math.max(0, this.bloodVignetteIntensity - 0.0005 * dt);
        }

        if (this.blindTimer > 0) {
            this.blindTimer -= dt;
        }

        // Decay screen shake
        if (this.shakeTimer > 0) {
            this.shakeTimer = Math.max(0, this.shakeTimer - dt);
        }

        // Domain Expansion timer
        if (this.domainTimer > 0) {
            this.domainTimer = Math.max(0, this.domainTimer - dt);
            const progress = this.domainTimer / this.domainDuration;
            // Fade in fast (first 200ms), hold, then fade out
            if (progress > 0.87) {
                this.domainAlpha = Math.min(1, (1 - progress) / 0.13);
            } else if (progress < 0.3) {
                this.domainAlpha = progress / 0.3;
            } else {
                this.domainAlpha = 1.0;
            }
            if (this.domainTimer <= 0) {
                this.domainType = null;
                this.domainAlpha = 0;
            }
        }

        // Gojo Infinity barrier — continuously spawn hex shields and distortion rings
        if (this.stats.selectedCharacter === 'gojo' && this.isRunning) {
            this.infinitySpawnTimer += dt;
            if (this.infinitySpawnTimer >= this.infinitySpawnInterval) {
                this.infinitySpawnTimer = 0;
                const wizX = this.canvas.width / 2;
                const wizY = this.canvas.height;
                
                // Spawn hex shield particle
                const hexAngle = Math.random() * Math.PI * 2;
                const hexOrbitR = 28 + Math.random() * 18;
                this.particles.push(new Particle(wizX, wizY - 15, {
                    type: 'hex_shield',
                    color: Math.random() > 0.3 ? '#00e5ff' : '#0077ff',
                    orbitAngle: hexAngle,
                    orbitRadius: hexOrbitR,
                    radius: 5 + Math.random() * 4,
                    originX: wizX,
                    originY: wizY - 15
                }));

                // Spawn distortion ring every other cycle
                if (Math.random() > 0.5) {
                    this.particles.push(new Particle(wizX, wizY - 15, {
                        type: 'distortion_ring',
                        color: 'rgba(0, 229, 255, 0.4)',
                        startRadius: 5,
                        expansionRate: 2.5,
                        ringWidth: 1.0
                    }));
                }
            }
        }

        // Boss Logic
        if (this.isBossPhase && this.boss) {
            this.boss.update(dt);

            if (this.boss.shouldAttack()) {
                this.spawnBossAttack();
            }

            if (this.boss.shouldCastSpell()) {
                this.combatSystem.castBossSpell();
            }

            // Wait for death animation to fully finish before ending phase
            if (this.boss.isFullyDead() && this.words.length === 0 && this.projectiles.length === 0) {
                this.achievements.onEvent('boss_defeated');
                this.endBossPhase();
            }
        }

        const wizX = this.canvas.width / 2;
        const wizY = this.canvas.height;

        let activeRadius = 30;
        let hitColor = '#ff4b4b';

        const char = this.stats.selectedCharacter;
        if (char === 'gojo' || char === 'sukuna') {
            if (this.stats.lives >= 2) {
                activeRadius = 85;
                if (char === 'gojo') {
                    if (this.stats.lives >= 4) hitColor = '#00e5ff';
                    else if (this.stats.lives === 3) hitColor = '#5c6bc0';
                    else hitColor = '#d81b60';
                } else {
                    if (this.stats.lives >= 4) hitColor = '#ff1744';
                    else if (this.stats.lives === 3) hitColor = '#ffab00';
                    else hitColor = '#b71c1c';
                }
            } else {
                activeRadius = 30;
                hitColor = '#ff4b4b';
            }
        } else {
            if (this.stats.lives >= 4) { activeRadius = 110; hitColor = '#ffd700'; }
            else if (this.stats.lives === 3) { activeRadius = 85; hitColor = '#d500f9'; }
            else if (this.stats.lives === 2) { activeRadius = 60; hitColor = '#29b6f6'; }
        }

        for (let i = this.words.length - 1; i >= 0; i--) {
            const word = this.words[i];
            word.update(dt);

            // Only do collision check on words that are NOT dying
            if (!word.dying) {
                const dx = word.x - wizX;
                const dy = word.y - wizY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const textHitboxSize = 20;

                if (distance < activeRadius + textHitboxSize) {
                    if (this.stats.hasSkill('precognition') && !this.precognitionUsed) {
                        this.precognitionUsed = true;
                        this.words.splice(i, 1);
                        if (word === this.targetedWord) this.targetedWord = null;

                        // Free Nova Cast
                        this.audio.playExplosion();
                        this.combatSystem.triggerShake(15, 600);
                        this.combatSystem.spawnExplosion(this.canvas.width / 2, this.canvas.height / 2, { particles: ['#9C27B0', '#ffffff', '#E040FB'] }, 3.0);

                        for (let j = this.words.length - 1; j >= 0; j--) {
                            const w = this.words[j];
                            if (w.dying || w.isBossAttack) continue;
                            this.stats.addScore(w.text.length, false);
                            w.dying = true;
                            this.combatSystem.spawnExplosion(w.x, w.y, w.elementColors, 0.5);
                            if (w === this.targetedWord) this.targetedWord = null;
                        }

                        if (this.isBossPhase && this.boss && !this.boss.isDead) {
                            for (let j = 0; j < 3; j++) this.boss.takeDamage();
                        }
                        continue;
                    }

                    this.words.splice(i, 1);
                    if (word === this.targetedWord) this.targetedWord = null;

                    this.audio.playShatter();
                    this.combatSystem.spawnExplosion(word.x, word.y, { particles: [hitColor, '#ffffff'] });
                    this.combatSystem.triggerShake(5, 200);

                    // Drop combo on taking damage
                    this.stats.combo = 0;
                    this.bloodVignetteIntensity = 1.0;
                    this.stats.updateHUD();
                    this.floatingTexts.push(new FloatingText("Hits Taken", wizX, wizY - 120, hitColor, 28));

                    const prevLives = this.stats.lives;
                    const isDead = this.stats.loseLife();
                    if (prevLives === 2 && this.stats.lives === 1) {
                        this.triggerBarrierBreakEffect();
                    }
                    if (isDead) {
                        this.triggerGameOver();
                    }
                } else if (word.y > this.canvas.height + 150) {
                    // Check if word drifted completely off-screen (missed)
                    this.words.splice(i, 1);
                    if (word === this.targetedWord) this.targetedWord = null;

                    // Treat missed words as damage as well (optional, but typical for typing defense games)
                    this.audio.playShatter();
                    this.combatSystem.triggerShake(5, 200);
                    this.stats.combo = 0;
                    this.bloodVignetteIntensity = 1.0;
                    this.stats.updateHUD();
                    this.floatingTexts.push(new FloatingText("Word Missed", wizX, wizY - 120, hitColor, 28));

                    const prevLives = this.stats.lives;
                    const isDead = this.stats.loseLife();
                    if (prevLives === 2 && this.stats.lives === 1) {
                        this.triggerBarrierBreakEffect();
                    }
                    if (isDead) {
                        this.triggerGameOver();
                    }
                }
            }

            // Remove words whose death animation has completed
            if (word.isDead) {
                this.words.splice(i, 1);
            }
        }

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.update(dt);
            if (p.life <= 0) {
                this.particles.splice(i, 1);
            }
        }

        // Update floating texts
        for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
            const ft = this.floatingTexts[i];
            ft.update(dt);
            if (ft.life <= 0) {
                this.floatingTexts.splice(i, 1);
            }
        }

        // Update ambient particles
        for (let i = 0; i < this.ambientParticles.length; i++) {
            const ap = this.ambientParticles[i];
            ap.x += ap.vx * dt;
            ap.y += ap.vy * dt;
            // Wrap around
            if (ap.y < -10) ap.y = this.canvas.height + 10;
            if (ap.y > this.canvas.height + 10) ap.y = -10;
            if (ap.x < -10) ap.x = this.canvas.width + 10;
            if (ap.x > this.canvas.width + 10) ap.x = -10;
        }

        // Update projectiles
        for (let i = this.projectiles.length - 1; i >= 0; i--) {
            const proj = this.projectiles[i];
            proj.update(dt);

            if (proj.isDead) {
                this.projectiles.splice(i, 1);

                if (this.isBossPhase && this.boss && !this.boss.isDead) {
                    this.boss.takeDamage();
                    this.audio.playExplosion();
                    this.combatSystem.spawnExplosion(this.boss.x, this.boss.y, { particles: ['#ffd700', '#ffffff', '#ff4b4b'] });
                    this.combatSystem.triggerShake(7, 250);
                }
            }
        }
    }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        // --- Screen shake offset ---
        let shakeX = 0;
        let shakeY = 0;
        if (this.shakeTimer > 0) {
            shakeX = (Math.random() - 0.5) * this.shakeIntensity * 2;
            shakeY = (Math.random() - 0.5) * this.shakeIntensity * 2;
        }

        this.ctx.save();
        this.ctx.translate(shakeX, shakeY);

        // --- Dynamic Background based on Combo ---
        // Combo 0-20: Normal
        // Combo 20-50+: Red/Violet vignette and faster starfield
        const comboIntensity = Math.min(1.0, this.stats.combo / 50);

        if (comboIntensity > 0.1) {
            const bgVignette = this.ctx.createRadialGradient(
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.4,
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width
            );
            bgVignette.addColorStop(0, 'transparent');
            bgVignette.addColorStop(1, `rgba(100, 0, 80, ${comboIntensity * 0.6})`);
            this.ctx.fillStyle = bgVignette;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        }

        // --- Star field ---
        this._drawStars(comboIntensity);

        // --- Pocket Dimension Background ---
        if (this.bossDimensionAlpha > 0) {
            this.ctx.save();
            this.ctx.globalAlpha = this.bossDimensionAlpha;

            // Base radial gradient
            const gradient = this.ctx.createRadialGradient(
                this.canvas.width / 2, this.canvas.height / 2, 50,
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width / 1.5
            );
            gradient.addColorStop(0, '#2a0808');
            gradient.addColorStop(1, '#05020a');
            this.ctx.fillStyle = gradient;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            // Pulsing edge vignette
            const vignetteAlpha = 0.4 + Math.sin(performance.now() / 600) * 0.15;
            const vignette = this.ctx.createRadialGradient(
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.3,
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.75
            );
            vignette.addColorStop(0, 'transparent');
            vignette.addColorStop(1, `rgba(80, 0, 20, ${vignetteAlpha})`);
            this.ctx.fillStyle = vignette;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

            this.ctx.restore();
        }

        // --- Domain Expansion Overlay ---
        if (this.domainType && this.domainAlpha > 0) {
            this.ctx.save();
            this.ctx.globalAlpha = this.domainAlpha * 0.85;

            if (this.domainType === 'void') {
                // Unlimited Void — deep indigo cosmic starfield
                const voidGrad = this.ctx.createRadialGradient(
                    this.canvas.width / 2, this.canvas.height / 2, 30,
                    this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.8
                );
                voidGrad.addColorStop(0, '#1a0033');
                voidGrad.addColorStop(0.4, '#0d001a');
                voidGrad.addColorStop(1, '#000000');
                this.ctx.fillStyle = voidGrad;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                // Floating geometric shapes (cubes / circles)
                const now = performance.now();
                this.ctx.globalAlpha = this.domainAlpha * 0.5;
                for (let i = 0; i < 15; i++) {
                    const gx = (Math.sin(now * 0.0003 + i * 1.7) * 0.5 + 0.5) * this.canvas.width;
                    const gy = (Math.cos(now * 0.0004 + i * 2.3) * 0.5 + 0.5) * this.canvas.height;
                    const gs = 8 + Math.sin(now * 0.002 + i) * 4;
                    this.ctx.strokeStyle = '#e040fb';
                    this.ctx.shadowColor = '#e040fb';
                    this.ctx.shadowBlur = 10;
                    this.ctx.lineWidth = 1;
                    this.ctx.strokeRect(gx - gs / 2, gy - gs / 2, gs, gs);
                }

                // Radial light rays from center
                this.ctx.globalAlpha = this.domainAlpha * 0.3;
                for (let r = 0; r < 12; r++) {
                    const rayAngle = (r / 12) * Math.PI * 2 + now * 0.0002;
                    const rayLen = this.canvas.width * 0.6;
                    this.ctx.beginPath();
                    this.ctx.moveTo(this.canvas.width / 2, this.canvas.height / 2);
                    this.ctx.lineTo(
                        this.canvas.width / 2 + Math.cos(rayAngle) * rayLen,
                        this.canvas.height / 2 + Math.sin(rayAngle) * rayLen
                    );
                    this.ctx.strokeStyle = 'rgba(170, 0, 255, 0.4)';
                    this.ctx.lineWidth = 1.5;
                    this.ctx.shadowBlur = 0;
                    this.ctx.stroke();
                }
            } else if (this.domainType === 'shrine') {
                // Malevolent Shrine — dark crimson temple
                const shrineGrad = this.ctx.createRadialGradient(
                    this.canvas.width / 2, this.canvas.height / 2, 30,
                    this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.8
                );
                shrineGrad.addColorStop(0, '#330008');
                shrineGrad.addColorStop(0.5, '#1a0004');
                shrineGrad.addColorStop(1, '#0a0000');
                this.ctx.fillStyle = shrineGrad;
                this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

                // Shrine pillars on edges
                this.ctx.globalAlpha = this.domainAlpha * 0.4;
                this.ctx.fillStyle = '#1a0008';
                this.ctx.strokeStyle = '#ff1744';
                this.ctx.lineWidth = 1;
                this.ctx.shadowColor = '#ff1744';
                this.ctx.shadowBlur = 8;

                // Left pillars
                for (let p = 0; p < 3; p++) {
                    const px = 20 + p * 25;
                    const py = this.canvas.height * 0.2 + p * 60;
                    this.ctx.fillRect(px, py, 10, this.canvas.height - py);
                    this.ctx.strokeRect(px, py, 10, this.canvas.height - py);
                }
                // Right pillars
                for (let p = 0; p < 3; p++) {
                    const px = this.canvas.width - 30 - p * 25;
                    const py = this.canvas.height * 0.2 + p * 60;
                    this.ctx.fillRect(px, py, 10, this.canvas.height - py);
                    this.ctx.strokeRect(px, py, 10, this.canvas.height - py);
                }

                // Floating skull/eye marks
                const now = performance.now();
                this.ctx.globalAlpha = this.domainAlpha * 0.35;
                this.ctx.font = '20px serif';
                this.ctx.fillStyle = '#ff1744';
                this.ctx.shadowBlur = 12;
                for (let s = 0; s < 8; s++) {
                    const sx = (Math.sin(now * 0.0002 + s * 2.1) * 0.4 + 0.5) * this.canvas.width;
                    const sy = (Math.cos(now * 0.0003 + s * 1.7) * 0.4 + 0.5) * this.canvas.height;
                    this.ctx.fillText('☠', sx, sy);
                }
            }

            this.ctx.restore();
        }

        // --- Wizard and Barriers ---
        this.ctx.save();
        const wizX = this.canvas.width / 2;
        const wizY = this.canvas.height;
        const char = this.stats.selectedCharacter;

        if (char === 'gojo') {
            if (this.stats.lives >= 2) {
                let color = '#00e5ff'; // 3+ hits
                if (this.stats.lives === 3) color = '#5c6bc0'; // 2 hits
                else if (this.stats.lives === 2) color = '#d81b60'; // 1 hit

                // Solid primary Infinity arc
                this.ctx.beginPath();
                this.ctx.arc(wizX, wizY, 85, Math.PI, 0, false);
                this.ctx.strokeStyle = color;
                this.ctx.lineWidth = 4;
                this.ctx.shadowColor = color;
                this.ctx.shadowBlur = 18;
                this.ctx.stroke();

                // Faint spatial folding ring (outer concentric echo)
                this.ctx.save();
                this.ctx.beginPath();
                this.ctx.arc(wizX, wizY, 91, Math.PI, 0, false);
                this.ctx.strokeStyle = color;
                this.ctx.globalAlpha = 0.35;
                this.ctx.lineWidth = 1.5;
                this.ctx.shadowBlur = 8;
                this.ctx.stroke();
                this.ctx.restore();
            }
        } else if (char === 'sukuna') {
            if (this.stats.lives >= 2) {
                let color = '#ff1744'; // 3+ hits
                if (this.stats.lives === 3) color = '#ffab00'; // 2 hits
                else if (this.stats.lives === 2) color = '#b71c1c'; // 1 hit

                const segs = 6;
                this.ctx.shadowColor = color;
                this.ctx.shadowBlur = 15;
                
                for (let k = 0; k < segs; k++) {
                    const startAngle = Math.PI + (k / segs) * Math.PI;
                    const endAngle = Math.PI + ((k + 1.25) / segs) * Math.PI;

                    // Draw outer slash segment
                    this.ctx.beginPath();
                    this.ctx.arc(wizX, wizY, 85, startAngle, endAngle, false);
                    this.ctx.strokeStyle = color;
                    this.ctx.lineWidth = 3.5;
                    this.ctx.stroke();

                    // Draw overlapping inner sharp claw arc
                    this.ctx.beginPath();
                    this.ctx.arc(wizX, wizY, 81, startAngle + 0.08, endAngle - 0.08, false);
                    this.ctx.strokeStyle = color;
                    this.ctx.lineWidth = 2.0;
                    this.ctx.stroke();
                }
            }
        } else {
            const barriers = [
                { radius: 60, color: '#29b6f6', active: this.stats.lives >= 2 },
                { radius: 85, color: '#d500f9', active: this.stats.lives >= 3 },
                { radius: 110, color: '#ffd700', active: this.stats.lives >= 4 }
            ];

            barriers.forEach(barrier => {
                if (barrier.active) {
                    this.ctx.beginPath();
                    this.ctx.arc(wizX, wizY, barrier.radius, Math.PI, 0, false);
                    this.ctx.strokeStyle = barrier.color;
                    this.ctx.lineWidth = 3;
                    this.ctx.shadowColor = barrier.color;
                    this.ctx.shadowBlur = 15;
                    this.ctx.stroke();
                }
            });
        }

        this.ctx.restore();
        this.ctx.shadowBlur = 0;

        // --- Aura / Weapon / Character Silhouette Drawing ---
        if (this.stats.selectedCharacter === 'wizard') {
            // --- Staff ---
            this.ctx.save();
            const animProgress = this.playerAnimTimer > 0 ? this.playerAnimTimer / 200 : 0;
            const staffAngle = (Math.PI / 6) * (1 - animProgress);
            const staffBaseX = wizX + 10;
            const staffBaseY = wizY - 5;

            this.ctx.translate(staffBaseX, staffBaseY);
            this.ctx.rotate(staffAngle);

            // Pole
            this.ctx.fillStyle = '#4a3320';
            this.ctx.fillRect(-2, -40, 5, 45);

            // Pulsing gem glow
            const gemGlow = 12 + Math.sin(performance.now() / 300) * 8;
            this.ctx.beginPath();
            this.ctx.arc(0, -42, 6, 0, Math.PI * 2);
            this.ctx.fillStyle = this.stats.wandColor;
            this.ctx.shadowColor = this.stats.wandColor;
            this.ctx.shadowBlur = gemGlow;
            this.ctx.fill();

            this.ctx.restore();
            this.ctx.shadowBlur = 0;

            // --- Wizard Silhouette ---
            this.ctx.fillStyle = '#110a17';
            this.ctx.strokeStyle = '#3a2b52';
            this.ctx.lineWidth = 1;

            // Cloak
            this.ctx.beginPath();
            this.ctx.moveTo(wizX, wizY - 24);
            this.ctx.lineTo(wizX - 15, wizY + 18);
            this.ctx.quadraticCurveTo(wizX, wizY + 21, wizX + 15, wizY + 18);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            // Hat
            this.ctx.beginPath();
            this.ctx.moveTo(wizX - 11, wizY - 21);
            this.ctx.quadraticCurveTo(wizX, wizY - 18, wizX + 11, wizY - 21);
            this.ctx.lineTo(wizX + 1, wizY - 45);
            this.ctx.lineTo(wizX - 1, wizY - 45);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();
        } else if (this.stats.selectedCharacter === 'gojo') {
            const animProgress = this.playerAnimTimer > 0 ? this.playerAnimTimer / 200 : 0;
            const now = performance.now();

            // --- Infinity Barrier Aura (pulsing hex grid outline) ---
            this.ctx.save();
            const barrierPulse = 1.0 + Math.sin(now / 400) * 0.15 + animProgress * 0.3;
            const barrierRadius = 38 * barrierPulse;
            const hexCount = 8;

            // Distortion ripple aura (concentric wavy rings)
            this.ctx.globalAlpha = 0.25 + animProgress * 0.15;
            for (let ring = 0; ring < 3; ring++) {
                const ringPhase = (now / 1200 + ring * 0.33) % 1.0;
                const ringR = 12 + ringPhase * 45;
                const ringAlpha = (1 - ringPhase) * 0.4;
                this.ctx.globalAlpha = ringAlpha;
                this.ctx.beginPath();
                const segs = 36;
                for (let s = 0; s <= segs; s++) {
                    const a = (s / segs) * Math.PI * 2;
                    const wave = Math.sin(a * 5 + now * 0.004) * 2.5 * (1 - ringPhase);
                    const r = ringR + wave;
                    const px = wizX + Math.cos(a) * r;
                    const py = (wizY - 15) + Math.sin(a) * r;
                    if (s === 0) this.ctx.moveTo(px, py);
                    else this.ctx.lineTo(px, py);
                }
                this.ctx.closePath();
                this.ctx.strokeStyle = '#00e5ff';
                this.ctx.shadowColor = '#00e5ff';
                this.ctx.shadowBlur = 6;
                this.ctx.lineWidth = 1.0;
                this.ctx.stroke();
            }

            // Hexagonal grid shield outline
            this.ctx.globalAlpha = 0.35 + Math.sin(now / 300) * 0.1 + animProgress * 0.2;
            const hexAngleBase = now * 0.0004;
            for (let h = 0; h < hexCount; h++) {
                const hAngle = hexAngleBase + (h / hexCount) * Math.PI * 2;
                const hx = wizX + Math.cos(hAngle) * barrierRadius;
                const hy = (wizY - 15) + Math.sin(hAngle) * barrierRadius;
                const hexR = 7 + Math.sin(now / 500 + h) * 1.5;
                const flickerAlpha = 0.3 + Math.sin(now / 200 + h * 1.3) * 0.25;

                this.ctx.globalAlpha = flickerAlpha + animProgress * 0.3;
                this.ctx.beginPath();
                for (let v = 0; v < 6; v++) {
                    const va = (Math.PI / 3) * v + hexAngleBase * 0.5;
                    const vx = hx + Math.cos(va) * hexR;
                    const vy = hy + Math.sin(va) * hexR;
                    if (v === 0) this.ctx.moveTo(vx, vy);
                    else this.ctx.lineTo(vx, vy);
                }
                this.ctx.closePath();
                this.ctx.strokeStyle = h % 2 === 0 ? '#00e5ff' : '#0077ff';
                this.ctx.shadowColor = '#00e5ff';
                this.ctx.shadowBlur = 8;
                this.ctx.lineWidth = 1.2;
                this.ctx.stroke();
            }
            this.ctx.restore();

            // --- Inner Radial Aura Glow ---
            this.ctx.save();
            const auraGrad = this.ctx.createRadialGradient(wizX, wizY - 15, 3, wizX, wizY - 15, 30);
            auraGrad.addColorStop(0, 'rgba(0, 229, 255, 0.35)');
            auraGrad.addColorStop(0.6, 'rgba(0, 119, 255, 0.12)');
            auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = auraGrad;
            this.ctx.beginPath();
            this.ctx.arc(wizX, wizY - 15, 30, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            // --- Floating Red & Blue Energy Orbs ---
            this.ctx.save();
            const floatOffset = Math.sin(now / 200) * 6;
            
            // Blue Orb (Lapse)
            this.ctx.beginPath();
            this.ctx.arc(wizX - 25, wizY - 20 + floatOffset, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = '#00e5ff';
            this.ctx.shadowColor = '#00e5ff';
            this.ctx.shadowBlur = 12 + animProgress * 15;
            this.ctx.fill();
            
            // Red Orb (Reversal)
            this.ctx.beginPath();
            this.ctx.arc(wizX + 25, wizY - 20 - floatOffset, 5, 0, Math.PI * 2);
            this.ctx.fillStyle = '#ff1744';
            this.ctx.shadowColor = '#ff1744';
            this.ctx.shadowBlur = 12 + animProgress * 15;
            this.ctx.fill();
            this.ctx.restore();

            // --- Gojo Silhouette ---
            this.ctx.save();
            this.ctx.fillStyle = '#0a0912';
            this.ctx.strokeStyle = '#00e5ff';
            this.ctx.lineWidth = 1.5;

            if (animProgress > 0) {
                // === FINGER FLICK ATTACK POSE ===
                // Body leans forward slightly
                this.ctx.beginPath();
                this.ctx.moveTo(wizX - 14, wizY + 18);
                this.ctx.lineTo(wizX - 10, wizY - 14);
                this.ctx.lineTo(wizX + 14, wizY - 16);
                this.ctx.lineTo(wizX + 18, wizY + 18);
                this.ctx.quadraticCurveTo(wizX, wizY + 21, wizX - 14, wizY + 18);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();

                // Extended right arm (finger flick)
                this.ctx.beginPath();
                this.ctx.moveTo(wizX + 14, wizY - 14);
                this.ctx.lineTo(wizX + 32, wizY - 22);
                this.ctx.lineTo(wizX + 40, wizY - 24); // fingertip
                this.ctx.lineWidth = 2.5;
                this.ctx.strokeStyle = '#0a0912';
                this.ctx.stroke();
                // Finger glow
                this.ctx.beginPath();
                this.ctx.arc(wizX + 40, wizY - 24, 2.5, 0, Math.PI * 2);
                this.ctx.fillStyle = '#e040fb';
                this.ctx.shadowColor = '#e040fb';
                this.ctx.shadowBlur = 15 * animProgress;
                this.ctx.fill();

                // Purple shockwave ring from fingertip
                const shockRadius = (1 - animProgress) * 50;
                const shockAlpha = animProgress * 0.7;
                this.ctx.beginPath();
                this.ctx.arc(wizX + 40, wizY - 24, shockRadius, 0, Math.PI * 2);
                this.ctx.strokeStyle = `rgba(224, 64, 251, ${shockAlpha})`;
                this.ctx.shadowColor = '#e040fb';
                this.ctx.shadowBlur = 12 * animProgress;
                this.ctx.lineWidth = 2.5 * animProgress;
                this.ctx.stroke();

                this.ctx.strokeStyle = '#00e5ff';
                this.ctx.lineWidth = 1.5;
            } else {
                // === IDLE POSE ===
                // Body (high-collar jacket styling)
                this.ctx.beginPath();
                this.ctx.moveTo(wizX - 16, wizY + 18);
                this.ctx.lineTo(wizX - 12, wizY - 15);
                this.ctx.lineTo(wizX + 12, wizY - 15);
                this.ctx.lineTo(wizX + 16, wizY + 18);
                this.ctx.quadraticCurveTo(wizX, wizY + 21, wizX - 16, wizY + 18);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }

            // High Collar
            this.ctx.beginPath();
            this.ctx.moveTo(wizX - 7, wizY - 15);
            this.ctx.lineTo(wizX - 9, wizY - 26);
            this.ctx.lineTo(wizX - 2, wizY - 21);
            this.ctx.lineTo(wizX + 2, wizY - 21);
            this.ctx.lineTo(wizX + 9, wizY - 26);
            this.ctx.lineTo(wizX + 7, wizY - 15);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            // Head Base
            this.ctx.beginPath();
            this.ctx.arc(wizX, wizY - 28, 7, 0, Math.PI * 2);
            this.ctx.fill();

            // Spiky Hair
            this.ctx.beginPath();
            this.ctx.moveTo(wizX - 7, wizY - 30);
            this.ctx.lineTo(wizX - 11, wizY - 38);
            this.ctx.lineTo(wizX - 6, wizY - 35);
            this.ctx.lineTo(wizX - 5, wizY - 45);
            this.ctx.lineTo(wizX - 1, wizY - 37);
            this.ctx.lineTo(wizX, wizY - 47);
            this.ctx.lineTo(wizX + 2, wizY - 37);
            this.ctx.lineTo(wizX + 5, wizY - 43);
            this.ctx.lineTo(wizX + 6, wizY - 34);
            this.ctx.lineTo(wizX + 10, wizY - 38);
            this.ctx.lineTo(wizX + 7, wizY - 30);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            // Glowing Six Eyes (brighter during attack)
            const eyeGlow = 10 + animProgress * 20;
            this.ctx.fillStyle = '#00e5ff';
            this.ctx.shadowColor = '#00e5ff';
            this.ctx.shadowBlur = eyeGlow;
            this.ctx.beginPath();
            this.ctx.arc(wizX - 2.5, wizY - 28, 1.5, 0, Math.PI * 2);
            this.ctx.arc(wizX + 2.5, wizY - 28, 1.5, 0, Math.PI * 2);
            this.ctx.fill();

            this.ctx.restore();
        } else if (this.stats.selectedCharacter === 'sukuna') {
            const animProgress = this.playerAnimTimer > 0 ? this.playerAnimTimer / 200 : 0;
            const now = performance.now();

            // --- Sukuna Aura ---
            this.ctx.save();
            const auraGrad = this.ctx.createRadialGradient(wizX, wizY - 15, 5, wizX, wizY - 15, 50);
            auraGrad.addColorStop(0, 'rgba(255, 23, 68, 0.45)');
            auraGrad.addColorStop(0.5, 'rgba(213, 0, 0, 0.2)');
            auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
            this.ctx.fillStyle = auraGrad;
            this.ctx.beginPath();
            this.ctx.arc(wizX, wizY - 15, 50, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.restore();

            // --- Floating Crescent Slash Rings ---
            this.ctx.save();
            const rotateSpeed = now / 150;
            
            this.ctx.translate(wizX, wizY - 18);
            this.ctx.rotate(rotateSpeed);
            
            this.ctx.strokeStyle = '#ff1744';
            this.ctx.shadowColor = '#ff1744';
            this.ctx.shadowBlur = 10 + animProgress * 10;
            this.ctx.lineWidth = 1.8;
            
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 20, -Math.PI / 6, Math.PI / 6);
            this.ctx.stroke();
            
            this.ctx.beginPath();
            this.ctx.arc(0, 0, 20, Math.PI - Math.PI / 6, Math.PI + Math.PI / 6);
            this.ctx.stroke();
            this.ctx.restore();

            // --- Sukuna Silhouette ---
            this.ctx.save();
            this.ctx.fillStyle = '#1c0c0c';
            this.ctx.strokeStyle = '#ff1744';
            this.ctx.lineWidth = 1.5;

            if (animProgress > 0) {
                // === FINGER SNAP ATTACK POSE ===
                // Body leans slightly forward
                this.ctx.beginPath();
                this.ctx.moveTo(wizX - 16, wizY + 18);
                this.ctx.lineTo(wizX - 11, wizY - 13);
                this.ctx.lineTo(wizX - 4, wizY - 13);
                this.ctx.lineTo(wizX, wizY - 4);
                this.ctx.lineTo(wizX + 4, wizY - 15);
                this.ctx.lineTo(wizX + 15, wizY - 15);
                this.ctx.lineTo(wizX + 20, wizY + 18);
                this.ctx.quadraticCurveTo(wizX, wizY + 21, wizX - 16, wizY + 18);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();

                // Extended right arm (finger snap pointing)
                this.ctx.beginPath();
                this.ctx.moveTo(wizX + 15, wizY - 15);
                this.ctx.lineTo(wizX + 30, wizY - 20);
                this.ctx.lineTo(wizX + 38, wizY - 23); // fingertip
                this.ctx.lineWidth = 2.5;
                this.ctx.strokeStyle = '#1c0c0c';
                this.ctx.stroke();

                // Finger snap glow
                this.ctx.beginPath();
                this.ctx.arc(wizX + 38, wizY - 23, 2, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ff1744';
                this.ctx.shadowColor = '#ff1744';
                this.ctx.shadowBlur = 15 * animProgress;
                this.ctx.fill();

                // Cleave slash lines (visual-only, 2-3 diagonal slashes)
                this.ctx.strokeStyle = '#ff1744';
                this.ctx.shadowColor = '#ff1744';
                this.ctx.shadowBlur = 12 * animProgress;
                this.ctx.lineWidth = 2 * animProgress;
                this.ctx.lineCap = 'round';
                const slashAlpha = animProgress * 0.8;
                this.ctx.globalAlpha = slashAlpha;
                for (let sl = 0; sl < 3; sl++) {
                    const slAngle = -0.6 + sl * 0.4 + Math.sin(now * 0.01 + sl) * 0.1;
                    const slLen = 30 + sl * 8;
                    const slStartX = wizX + 38;
                    const slStartY = wizY - 23;
                    const slEndX = slStartX + Math.cos(slAngle) * slLen * (1 - animProgress * 0.3);
                    const slEndY = slStartY + Math.sin(slAngle) * slLen * (1 - animProgress * 0.3);
                    this.ctx.beginPath();
                    this.ctx.moveTo(slStartX, slStartY);
                    this.ctx.lineTo(slEndX, slEndY);
                    this.ctx.stroke();
                }
                this.ctx.globalAlpha = 1.0;

                this.ctx.strokeStyle = '#ff1744';
                this.ctx.lineWidth = 1.5;
            } else {
                // === IDLE POSE ===
                // Loose Kimono body (draped V-neck shape)
                this.ctx.beginPath();
                this.ctx.moveTo(wizX - 18, wizY + 18);
                this.ctx.lineTo(wizX - 13, wizY - 14);
                this.ctx.lineTo(wizX - 4, wizY - 14);
                this.ctx.lineTo(wizX, wizY - 5);
                this.ctx.lineTo(wizX + 4, wizY - 14);
                this.ctx.lineTo(wizX + 13, wizY - 14);
                this.ctx.lineTo(wizX + 18, wizY + 18);
                this.ctx.quadraticCurveTo(wizX, wizY + 21, wizX - 18, wizY + 18);
                this.ctx.closePath();
                this.ctx.fill();
                this.ctx.stroke();
            }

            // --- Flickering Extra Arms (4-armed form, combo >= 10) ---
            const combo = this.stats.combo || 0;
            if (combo >= 10) {
                const extraArmOpacity = Math.min(1, (combo - 10) / 40);
                const flicker = Math.sin(now / 120) * 0.3 + 0.5;
                this.ctx.globalAlpha = extraArmOpacity * flicker * 0.55;
                this.ctx.fillStyle = '#1c0c0c';
                this.ctx.strokeStyle = '#ff1744';
                this.ctx.lineWidth = 1;

                // Left extra arm
                this.ctx.beginPath();
                this.ctx.moveTo(wizX - 13, wizY - 10);
                this.ctx.lineTo(wizX - 28, wizY - 5);
                this.ctx.lineTo(wizX - 35, wizY - 10);
                this.ctx.lineWidth = 2;
                this.ctx.stroke();

                // Right extra arm
                this.ctx.beginPath();
                this.ctx.moveTo(wizX + 13, wizY - 10);
                this.ctx.lineTo(wizX + 28, wizY - 5);
                this.ctx.lineTo(wizX + 35, wizY - 10);
                this.ctx.stroke();

                // Stomach mouth/eye (Sukuna's true form mark)
                const mouthPulse = 0.5 + Math.sin(now / 300) * 0.3;
                this.ctx.globalAlpha = extraArmOpacity * mouthPulse * 0.6;
                this.ctx.beginPath();
                this.ctx.ellipse(wizX, wizY + 2, 4, 2, 0, 0, Math.PI * 2);
                this.ctx.fillStyle = '#ff1744';
                this.ctx.shadowColor = '#ff1744';
                this.ctx.shadowBlur = 8;
                this.ctx.fill();
                // Pupil slit
                this.ctx.beginPath();
                this.ctx.ellipse(wizX, wizY + 2, 1.5, 0.6, 0, 0, Math.PI * 2);
                this.ctx.fillStyle = '#000000';
                this.ctx.shadowBlur = 0;
                this.ctx.fill();

                this.ctx.globalAlpha = 1.0;
            }

            // Head Base
            this.ctx.beginPath();
            this.ctx.arc(wizX, wizY - 26, 7, 0, Math.PI * 2);
            this.ctx.fill();

            // Spiky slicked back hair (Sukuna's hairstyle)
            this.ctx.beginPath();
            this.ctx.moveTo(wizX - 6, wizY - 28);
            this.ctx.lineTo(wizX - 10, wizY - 35);
            this.ctx.lineTo(wizX - 5, wizY - 32);
            this.ctx.lineTo(wizX - 5, wizY - 41);
            this.ctx.lineTo(wizX - 1, wizY - 35);
            this.ctx.lineTo(wizX, wizY - 43);
            this.ctx.lineTo(wizX + 1, wizY - 35);
            this.ctx.lineTo(wizX + 6, wizY - 40);
            this.ctx.lineTo(wizX + 5, wizY - 31);
            this.ctx.lineTo(wizX + 10, wizY - 34);
            this.ctx.lineTo(wizX + 6, wizY - 27);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.stroke();

            // Glowing red tattoo eyes & markings (brighter during attack)
            const eyeGlow = 10 + animProgress * 20;
            this.ctx.fillStyle = '#ff1744';
            this.ctx.shadowColor = '#ff1744';
            this.ctx.shadowBlur = eyeGlow;
            
            // Primary eyes
            this.ctx.beginPath();
            this.ctx.arc(wizX - 2.5, wizY - 26, 1.2, 0, Math.PI * 2);
            this.ctx.arc(wizX + 2.5, wizY - 26, 1.2, 0, Math.PI * 2);
            this.ctx.fill();

            // Under-eye slit marks
            this.ctx.beginPath();
            this.ctx.arc(wizX - 2.5, wizY - 23.5, 0.8, 0, Math.PI * 2);
            this.ctx.arc(wizX + 2.5, wizY - 23.5, 0.8, 0, Math.PI * 2);
            this.ctx.fill();

            // Forehead tattoo mark
            this.ctx.fillRect(wizX - 0.8, wizY - 30.5, 1.6, 2.5);

            this.ctx.restore();
        }

        this.ctx.restore();

        // --- Boss ---
        if (this.isBossPhase && this.boss) {
            this.boss.draw(this.ctx);
        }

        // --- Words ---
        this.words.forEach(word => !word.isTargeted && word.draw(this.ctx));
        if (this.targetedWord && !this.targetedWord.isDead) {
            this.targetedWord.draw(this.ctx);
        }

        // --- Ambient Dust ---
        this.ctx.save();
        this.ambientParticles.forEach(ap => {
            this.ctx.globalAlpha = ap.alpha;
            this.ctx.fillStyle = '#ffffff';
            this.ctx.beginPath();
            this.ctx.arc(ap.x, ap.y, ap.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.restore();

        // --- Projectiles ---
        this.projectiles.forEach(p => p.draw(this.ctx));

        // --- Particles ---
        this.particles.forEach(p => p.draw(this.ctx));

        // --- Floating Texts ---
        this.floatingTexts.forEach(ft => ft.draw(this.ctx));

        // --- Blind Overlay ---
        if (this.blindTimer > 0) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(20, 0, 40, 0.95)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }

        // --- Blood Vignette ---
        if (this.bloodVignetteIntensity > 0) {
            this.ctx.save();
            this.ctx.globalAlpha = this.bloodVignetteIntensity * 0.5; // Max 50% opacity
            const vignette = this.ctx.createRadialGradient(
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.2,
                this.canvas.width / 2, this.canvas.height / 2, this.canvas.width * 0.6
            );
            vignette.addColorStop(0, 'transparent');
            vignette.addColorStop(1, 'rgba(255, 0, 0, 1)');
            this.ctx.fillStyle = vignette;
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }

        this.ctx.restore(); // Restore from screen shake translate
    }

    _drawStars(comboIntensity = 0) {
        const now = performance.now();
        this.ctx.save();
        this.stars.forEach(star => {
            // Stars twinkle and move faster at high combo
            const speedMod = 1 + (comboIntensity * 2);
            const twinkle = star.brightness + Math.sin((now / (star.speed / speedMod)) + star.phase) * 0.25;

            // Move stars slowly downwards to give a feeling of forward momentum
            star.y += (1 + comboIntensity * 5) * 0.2;
            if (star.y > this.canvas.height) {
                star.y = 0;
                star.x = Math.random() * this.canvas.width;
            }

            const alpha = Math.max(0.05, Math.min(1, twinkle));
            this.ctx.globalAlpha = alpha;

            // Stars shift from white to slight reddish/purple at max combo
            if (comboIntensity > 0.5) {
                this.ctx.fillStyle = '#ffccdd';
                this.ctx.shadowColor = '#ff2266';
            } else {
                this.ctx.fillStyle = '#ffffff';
                this.ctx.shadowColor = '#aaaaff';
            }

            this.ctx.shadowBlur = star.size * 2 + (comboIntensity * 4);
            this.ctx.beginPath();
            this.ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2);
            this.ctx.fill();
        });
        this.ctx.restore();
    }

    _spawnSingleWord() {
        const targetX = this.canvas.width / 2;
        const targetY = this.canvas.height;

        let text = "";
        let variant = 'normal';
        let attempts = 0;
        const maxAttempts = 15;

        let maxAllowed = 1;
        if (this.difficulty === 'hard') maxAllowed = 2;
        else if (this.difficulty === 'hell') maxAllowed = 3;

        do {
            text = this.dictionary.getWordForDifficulty(this.difficulty);
            
            // 10% chance for Armored, 10% chance for Ghost
            const rand = Math.random();
            if (rand < 0.10) variant = 'armored';
            else if (rand < 0.20) variant = 'ghost';
            else variant = 'normal';

            // Determine what the starting letter will be
            const startingLetter = (variant === 'cursed') ? text[text.length - 1].toLowerCase() : text[0].toLowerCase();
            const activeCount = this.words.filter(w => !w.dying && w.untyped && w.untyped.length > 0 && w.untyped[0].toLowerCase() === startingLetter).length;

            if (activeCount < maxAllowed) {
                break;
            }
            attempts++;
        } while (attempts < maxAttempts);

        const margin = 100;
        let bestX = margin + Math.random() * (this.canvas.width - 2 * margin);

        // Try up to 10 times to find a spawn X that is far enough from recent words (top of the screen)
        for (let tries = 0; tries < 10; tries++) {
            let tooClose = false;
            for (const w of this.words) {
                // Only care about words recently spawned (y < 150)
                if (w.y < 150 && Math.abs(w.x - bestX) < 180) {
                    tooClose = true;
                    break;
                }
            }
            if (!tooClose) break;
            bestX = margin + Math.random() * (this.canvas.width - 2 * margin);
        }

        let wordSpeedMultiplier = this.currentSpeedMultiplier;

        // Cryomancer Discipline: Slower words
        if (this.stats && this.stats.mageClass === 'Cryomancer') {
            wordSpeedMultiplier *= 0.85; // 15% slower
        }

        const newWord = new Word(text, this.canvas.width, this.canvas.height, wordSpeedMultiplier, targetX, targetY, { variant, x: bestX, y: -50, gameMode: this.gameMode });
        this.words.push(newWord);
    }

    spawnWord() {
        this.spawnCount++;

        const targetX = this.canvas.width / 2;
        const targetY = this.canvas.height;

        // Boss triggers every 50 standard spawns
        if (this.spawnCount > 0 && this.spawnCount % 50 === 0 && !this.isBossPhase) {
            this.startBossPhase();
            return;
        }

        // Swarm chance: 5% (spawns 3-5 very short words at once)
        if (Math.random() < 0.05) {
            const numSwarm = 3 + Math.floor(Math.random() * 3);
            const spawnedSwarmLetters = [];
            for (let i = 0; i < numSwarm; i++) {
                let text = "";
                let attempts = 0;
                const maxAttempts = 15;
                let maxAllowed = 1;
                if (this.difficulty === 'hard') maxAllowed = 2;
                else if (this.difficulty === 'hell') maxAllowed = 3;

                do {
                    text = this.dictionary.getRandomWord('easy');
                    let subAttempts = 0;
                    while (text.length > 4 && subAttempts < 10) {
                        text = this.dictionary.getRandomWord('easy');
                        subAttempts++;
                    }

                    const startingLetter = text[0].toLowerCase();
                    const activeCount = this.words.filter(w => !w.dying && w.untyped && w.untyped.length > 0 && w.untyped[0].toLowerCase() === startingLetter).length;
                    const swarmCount = spawnedSwarmLetters.filter(l => l === startingLetter).length;

                    if (activeCount + swarmCount < maxAllowed) {
                        spawnedSwarmLetters.push(startingLetter);
                        break;
                    }
                    attempts++;
                } while (attempts < maxAttempts);

                const sx = targetX + (Math.random() - 0.5) * 400;
                const sy = -100 - Math.random() * 100;
                const newWord = new Word(text, this.canvas.width, this.canvas.height, this.currentSpeedMultiplier, sx, targetY, { variant: 'swarm', gameMode: this.gameMode });
                newWord.x = sx;
                newWord.y = sy;
                this.words.push(newWord);
            }
            return;
        }

        this._spawnSingleWord();
    }

    startBossPhase() {
        this.isBossPhase = true;

        const elements = ['fire', 'ice', 'lightning', 'void'];
        const randomElement = elements[Math.floor(Math.random() * elements.length)];
        const difficultyScale = 1 + (this.bossesDefeated * 0.25);

        this.boss = new Boss(this.canvas.width, this.canvas.height, randomElement, difficultyScale);
        this.audio.playExplosion();
    }

    spawnBossAttack() {
        const isEpic = Math.random() > 0.5;
        const text = this.dictionary.getRandomWord(isEpic ? 'epic' : 'hard');

        const targetX = this.canvas.width / 2;
        const targetY = this.canvas.height;

        const magicBullet = new Word(text, this.canvas.width, this.canvas.height, this.currentSpeedMultiplier, targetX, targetY, { isBossAttack: true });
        this.words.push(magicBullet);
    }

    endBossPhase() {
        this.stats.addScore(1000);
        this.isBossPhase = false;
        this.boss = null;
        this.audio.playLevelUp();
        this.bossesDefeated++;
        this.floatingTexts.push(new FloatingText("Level Cleared!", this.canvas.width / 2, this.canvas.height / 2, "#ffd700", 48));

        // Sabotage trigger
        if (this.onAttackCast) this.onAttackCast('swarm');

        if (this.stats.hasSkill('siphon')) {
            this.stats.mana = Math.min(this.stats.maxMana, this.stats.mana + (this.stats.maxMana * 0.5));
            this.stats.updateHUD();
        }

        this.spawnTimer = -2000;
    }

    triggerGameOver() {
        this.stop();
        this.stats.updateHUD();
        this.stats.saveHighScore();
        this.stats.recordWpm(this.stats.getSessionWPM());
        // AT-M4 fix (2026-08-24): the extra floor(score/10) XP grant that
        // lived here was removed. saveHighScore already converts 10% of
        // score to XP (+ Mage's Greed), matching the documented intent and
        // the duel path. Players were effectively earning ~20% per arena run
        // while duels paid 10%.
        this.stats.logRunToSupabase('arena', this.stats.getSessionWPM(), this.stats.getAccuracy(), this.stats.score);

        if (this.onGameOver) {
            this.onGameOver(this.stats);
        }
    }

    triggerBarrierBreakEffect() {
        const wizX = this.canvas.width / 2;
        const wizY = this.canvas.height;
        const char = this.stats.selectedCharacter;

        this.audio.playShatter();
        this.combatSystem.triggerShake(15, 450);

        if (char === 'gojo') {
            // Infinite collapsing space wave
            this.particles.push(new Particle(wizX, wizY - 15, {
                type: 'distortion_ring',
                color: 'rgba(0, 229, 255, 0.8)',
                startRadius: 85,
                expansionRate: 15,
                ringWidth: 3
            }));

            // Spawn cyan/indigo orbit particles that blow outward
            const numParticles = 25;
            for (let j = 0; j < numParticles; j++) {
                const angle = Math.PI + (j / (numParticles - 1)) * Math.PI;
                const px = wizX + Math.cos(angle) * 85;
                const py = wizY + Math.sin(angle) * 85;

                const pSpeed = Math.random() * 0.4 + 0.25;
                const p = new Particle(px, py, Math.random() > 0.5 ? '#00e5ff' : '#5c6bc0');
                p.vx = Math.cos(angle) * pSpeed;
                p.vy = Math.sin(angle) * pSpeed;
                p.gravity = 0.0003;
                p.size = Math.random() * 4 + 4;
                p.decay = Math.random() * 0.015 + 0.008;
                this.particles.push(p);
            }
        } else if (char === 'sukuna') {
            // Malevolent red shockwave
            this.particles.push(new Particle(wizX, wizY - 15, 'shockwave_red'));

            // Radial flying slash line splinters
            const numParticles = 20;
            for (let j = 0; j < numParticles; j++) {
                const angle = Math.PI + (j / (numParticles - 1)) * Math.PI;
                const px = wizX + Math.cos(angle) * 85;
                const py = wizY + Math.sin(angle) * 85;

                const p = new Particle(px, py, {
                    type: 'slash_line',
                    color: Math.random() > 0.5 ? '#ff1744' : '#ffab00',
                    angle: angle + (Math.random() - 0.5) * 0.5,
                    length: 30 + Math.random() * 25,
                    width: 2.5 + Math.random() * 1.5
                });

                const pSpeed = Math.random() * 0.35 + 0.2;
                p.vx = Math.cos(angle) * pSpeed;
                p.vy = Math.sin(angle) * pSpeed;
                p.decay = Math.random() * 0.03 + 0.02;
                this.particles.push(p);
            }
        }
    }
}
