import { Word } from './Word.js';
import { Boss } from './Boss.js';
import { Projectile } from './Projectile.js';
import { WordDictionary } from './WordDictionary.js';
import { Stats } from '../backend/Stats.js';
import { RenderCache } from './RenderCache.js';

import { Particle } from './Particle.js';
import { ParticlePool } from './ParticlePool.js';
import { AudioController } from './AudioController.js';
import { FloatingText } from './FloatingText.js';
import { Achievements } from './Achievements.js';
import { InputHandler } from './game/InputHandler.js';
import { CombatSystem } from './game/CombatSystem.js';
import { MeteorRenderer } from './MeteorRenderer.js';
import { CharacterRenderer } from './game/CharacterRenderer.js';
import { otherSlot, slotX, teamColorFor } from './game/ArenaTeams.js';
import { drawCasterSigil, drawTimeStopSeal } from './game/ArenaSigils.js';

export class Game {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d', { desynchronized: true });

        this.dictionary = new WordDictionary();
        this.audio = new AudioController();
        this.achievements = new Achievements(this.audio);
        this.stats = new Stats(this.achievements);

        // AT-F7 & AT-F8: Pre-bake all procedural meteor element frames
        MeteorRenderer.preloadAll();

        this.words = [];
        this.particles = new ParticlePool(400);
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

        // AT-F17: Arena-only active effects. Auras are keyed to the fixed team
        // slots (A/B), never to "self", so both clients draw the same caster.
        this.duelAuras = { A: null, B: null };
        this.duelCombos = { A: 0, B: 0 };
        this.duelBuffUntil = { A: 0, B: 0 };
        this.duelDebuffs = { A: null, B: null };
        this.duelTimeStopUntil = 0;
        this.duelTimeStopSlot = null;
        this.stats.onBarrierRestored = (combo) => this._onBarrierRestored(combo);

        // Character-specific ultimate cinematics. Bloodseeker's Blood Moon
        // takeover is a render-time timeline, not a chain of timers.
        this.supernovaFx = null;
        this.voidWardUntil = 0;

        // Bloodseeker's four netherblades are a ROTATING STRIKE POOL. Each
        // solved boss word leases exactly one blade; a blade cannot be leased
        // again until it has flown out, cut, and been recalled. The cursor
        // makes that a strict 1→2→3→4 rotation, and a fast typist who outruns
        // the recall simply takes the next free blade instead of re-firing
        // one already in the air.
        this.bladeSlash = { next: 0, leases: [null, null, null, null] };

        // Screen shake
        this.shakeTimer = 0;
        this.shakeIntensity = 0;

        // Star field (initialized in reset)
        this.stars = [];

        this.resizeCanvas();
        window.addEventListener('resize', () => this.resizeCanvas());
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => this.resizeCanvas());
        }

        this.inputHandler = new InputHandler(this);
        this.combatSystem = new CombatSystem(this);

        this.onGameOver = () => { };
    }

    resizeCanvas() {
        const parent = this.canvas.parentElement;
        if (!parent) return;
        const newW = Math.floor(parent.clientWidth);
        const newH = Math.floor(parent.clientHeight);
        if (this.canvas.width === newW && this.canvas.height === newH) return;

        this.canvas.width = newW;
        this.canvas.height = newH;

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

        // Layered starfield: the star pattern is baked ONCE into two offscreen
        // canvases (normal + high-combo red tint) with the glow burned into the
        // pixels. Each frame costs two drawImage blits plus a scroll/wrap instead
        // of ~120 individually shadowed path draws. Re-bake on resize.
        const baseKey = `at_stars_${this.canvas.width}x${this.canvas.height}`;
        const bakeStars = (isRed) => RenderCache.bake(baseKey + (isRed ? '_r' : '_w'), this.canvas.width, this.canvas.height, (ctx) => {
            this.stars.forEach(star => {
                ctx.globalAlpha = Math.max(0.35, Math.min(1, star.brightness));
                if (isRed) {
                    ctx.fillStyle = '#ffccdd';
                    ctx.shadowColor = '#ff2266';
                } else {
                    ctx.fillStyle = '#ffffff';
                    ctx.shadowColor = '#aaaaff';
                }
                ctx.shadowBlur = star.size * 4;
                ctx.fillRect(star.x, star.y, star.size, star.size);
            });
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        });
        // Bake both tints now (the closures above will run through RenderCache).
        bakeStars(false);
        bakeStars(true);

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
        this.stats.gameMode = mode;
        this._runFinalised = false; // fresh run → finalisation armed (AT-L5)
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

        // --- Frame resurrection watchdog ---
        // If the rAF chain ever dies silently (a stray stop(), an edge case
        // that swallows scheduling, a browser throttling bug) the game would
        // freeze with no error to report. A 1-second interval notices "no
        // frame executed since the last tick while the game should be
        // running" and re-kicks the loop. Covers every silent-stop case;
        // a truly blocked main thread can't run this timer either, so it
        // is harmless there.
        if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
        this._frameTicked = true;
        this._heartbeatInterval = setInterval(() => {
            if (!this.isRunning) return;
            if (this._frameTicked) {
                this._frameTicked = false;
                return;
            }
            console.warn('[ArcaneTyper] no frame for 1s while running — resurrecting game loop');
            this.lastTime = performance.now();
            this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
        }, 1000);
    }

    stop() {
        this.isRunning = false;
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
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
        if (this.particles && typeof this.particles.clear === 'function') {
            this.particles.clear();
        } else {
            this.particles = new ParticlePool(400);
        }
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
        // AT: a dead boss's own meteors unravel with it, so a dead boss can
        // never score a last hit on the player.
        this._bossSummonsCleared = false;

        // Screen shake
        this.shakeTimer = 0;
        this.shakeIntensity = 0;


        // Single run timer
        this.survivalTime = 0;
        this.survivorAwarded = false;

        // Difficulty settings
        const difficultySettings = {
            'easy': { speed: 0.8, spawnInt: 2500, maxSpeed: 1.5, minSpawn: 1200 },
            'normal': { speed: 1.1, spawnInt: 2000, maxSpeed: 2.2, minSpawn: 850 },
            'hard': { speed: 1.5, spawnInt: 1300, maxSpeed: 2.8, minSpawn: 600 },
            'hell': { speed: 2.0, spawnInt: 900, maxSpeed: 3.5, minSpawn: 450 }
        };
        const settings = difficultySettings[this.difficulty] || difficultySettings['normal'];

        this.currentSpeedMultiplier = settings.speed;
        this.spawnInterval = settings.spawnInt;
        this.maxSpeedMultiplier = settings.maxSpeed;
        this.minSpawnInterval = settings.minSpawn;

        if (this.stats.hasSkill('clairvoyance')) {
            this.spawnInterval *= 1.25; // 25% slower spawns
        }

        this.precognitionUsed = false;

        this.blindTimer = 0; // Tracks active Blind spell duration
        this.duelBuffUntil = { A: 0, B: 0 };
        this.duelDebuffs = { A: null, B: null };
        this.duelAuras = { A: null, B: null };
        this.duelCombos = { A: 0, B: 0 };
        this.duelTimeStopUntil = 0;
        this.duelTimeStopSlot = null;
        this.supernovaFx = null;
        this.voidWardUntil = 0;
        this._bossSummonsCleared = false;
        this.bladeSlash = { next: 0, leases: [null, null, null, null] };

        this.stats.reset();
        const waveDisplay = document.getElementById('wave-display');
        if (waveDisplay) waveDisplay.textContent = this.wave;
        this._initStars();
    }

    gameLoop(currentTime) {
        if (!this.isRunning) return;
        this._frameTicked = true; // heartbeat for the resurrection watchdog

        let dt = currentTime - this.lastTime;
        dt = Math.min(dt, 50);
        this.lastTime = currentTime;

        // --- Adaptive quality monitor ---
        // Tracks frame rate; on sustained slow frames (slow PC / heavy scenes)
        // flips a global low-quality flag that renderers consult to skip
        // expensive effects (shadowBlur, gradients). Recovers automatically.
        this._fpsAccum = (this._fpsAccum || 0) + dt;
        this._fpsFrames = (this._fpsFrames || 0) + 1;
        if (this._fpsAccum >= 1000) {
            const fps = Math.round(this._fpsFrames / (this._fpsAccum / 1000));
            this.currentFps = fps;
            this._fpsFrames = 0;
            this._fpsAccum = 0;

            const fpsBadge = document.getElementById('hud-fps');
            if (fpsBadge) {
                fpsBadge.textContent = `${fps} FPS`;
                if (fps >= 100) {
                    fpsBadge.style.color = '#00e5ff';
                    fpsBadge.style.textShadow = '0 0 6px rgba(0, 229, 255, 0.6)';
                    fpsBadge.title = `High-Refresh Rate Active (${fps} FPS)`;
                } else if (fps >= 55) {
                    fpsBadge.style.color = 'rgba(255, 215, 0, 0.6)';
                    fpsBadge.style.textShadow = 'none';
                    fpsBadge.title = `Standard Locked (${fps} FPS)`;
                } else {
                    fpsBadge.style.color = '#ff5252';
                    fpsBadge.style.textShadow = 'none';
                    fpsBadge.title = `Framerate Drop (${fps} FPS)`;
                }
            }

            if (fps < 40) {
                this._lowFpsStrikes = (this._lowFpsStrikes || 0) + 1;
                if (this._lowFpsStrikes >= 2 && !window.__atLowQuality) {
                    window.__atLowQuality = true;
                    console.warn('[Perf] FPS ' + fps + ' — enabling low-quality render mode');
                }
            } else {
                this._lowFpsStrikes = 0;
                if (fps > 55 && window.__atLowQuality) {
                    window.__atLowQuality = false;
                    console.info('[Perf] FPS recovered — restoring full quality');
                }
            }
        }

        // --- AT-F13: a paused frame is frozen, not redrawn ---
        // Pausing used to skip update() but keep painting draw() 60 times a
        // second, so the canvas kept repainting underneath whichever overlay was
        // open on top of it (the pause card, an Arena panel, a result screen) and
        // every such overlay re-composited for the whole time it was open.
        // draw() only ever paints the live scene — the last frame stays on screen
        // unchanged — and every HUD field is DOM (the 200 ms HUD tick below is
        // already pause-gated), so nothing goes stale while frozen.
        if (this.isPaused) {
            if (this.isRunning) {
                this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
            }
            return;
        }

        // --- Crash-proof update/draw ---
        // A throw inside update() or draw() previously killed the
        // requestAnimationFrame chain and permanently froze the page.
        // Errors are now contained: the failing subsystem is skipped for
        // that frame, the error is surfaced on-screen, and play continues.
        // AT-F17: Chronomancer's Time Stop freezes the shared arena simulation,
        // but never the input path. Skip update() entirely so collision/expiry
        // checks cannot resolve the word while the world is stopped.
        const frozen = this.gameMode === 'duel' && Date.now() < this.duelTimeStopUntil;

        if (!frozen) {
            try {
                this.update(dt);
            } catch (err) {
                this._reportError(err, 'update');
            }
        }
        try {
            this.draw(frozen);
        } catch (err) {
            this._reportError(err, 'draw');
        }

        if (this.isRunning) {
            this.animationFrameId = requestAnimationFrame((t) => this.gameLoop(t));
        }

        // Throttled HUD update: only update DOM stats every 200ms
        if (!this.isPaused && currentTime - this.lastHudUpdate >= 200) {
            try {
                this.stats.updateHUD();
            } catch (err) {
                this._reportError(err, 'hud');
            }
            this.lastHudUpdate = currentTime;
        }
    }

    _reportError(err, subsystem) {
        console.error('[ArcaneTyper] error in ' + subsystem + '():', err);
        // Throttle identical reports to once per second
        const now = performance.now();
        if (this._lastErrReport && now - this._lastErrReport < 1000) return;
        this._lastErrReport = now;
        let banner = document.getElementById('at-error-banner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'at-error-banner';
            banner.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;' +
                'max-width:70%;background:rgba(60,0,0,0.85);color:#ff8a80;' +
                'font:12px/1.4 monospace;padding:8px 10px;border-radius:6px;' +
                'border:1px solid #ff1744;pointer-events:none;white-space:pre-wrap;';
            document.body.appendChild(banner);
        }
        banner.textContent = '⚠ ' + subsystem + ' error (game kept running):\n' +
            (err && err.stack ? err.stack.split('\n').slice(0, 4).join('\n') : String(err));
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
        // (frozen in duels — AT-F9: identical cadence for both sides, no
        //  client-local scaling driven by your own typing.)
        if (!this.isBossPhase && this.gameMode !== 'duel') {
            this.waveTimer += dt;
            // Advance wave every 30 seconds OR every 12 words typed
            if (this.waveTimer >= 30000 || this.waveWordsTyped >= 12) {
                this.wave++;
                this.waveTimer = 0;
                this.waveWordsTyped = 0;

                // Scale up difficulty: Speed +4% (capped), Spawn interval -4% (floored)
                this.currentSpeedMultiplier = Math.min(this.maxSpeedMultiplier || 2.4, this.currentSpeedMultiplier * 1.04);
                this.spawnInterval = Math.max(this.minSpawnInterval || 600, this.spawnInterval * 0.96);

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

        // AT-F9: race words arrive from the host (DuelRace) — never spawn locally
        if (this.gameMode !== 'duel' && !this.isBossPhase && this.spawnTimer >= this.spawnInterval) {
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



        // Boss Logic
        if (this.isBossPhase && this.boss) {
            this.boss.update(dt);

            if (this.boss.shouldAttack()) {
                this.spawnBossAttack();
            }

            if (this.boss.shouldCastSpell()) {
                this.combatSystem.castBossSpell();
            }

            // AT: when the boss dies, its own summoned meteors unravel with it.
            // A dead boss must not keep scoring hits — that made the "victory"
            // a moment where the player could still lose a life. ORDINARY words
            // are deliberately left alone: they are the score/XP flow and
            // clearing the whole lane would throw away the reward.
            if (this.boss.isDead && !this._bossSummonsCleared) {
                this._bossSummonsCleared = true;
                this._dissolveBossSummons();
            }

            // Wait for death animation to fully finish before ending phase
            if (this.boss.isFullyDead() && this.words.length === 0 && this.projectiles.length === 0) {
                this.achievements.onEvent('boss_defeated');
                this.endBossPhase();
            }
        }

        const wizX = this.canvas.width / 2;
        const wizY = this.canvas.height - 35;
        const shieldY = wizY - 18; // Geometric center of Archmage sprite

        const barrierScale = Math.min(1, Math.max(0.75, this.canvas.height / 750));
        const comboBonus = Math.round(((this.stats && this.stats.combo >= 100) ? 12 : ((this.stats && this.stats.combo >= 50) ? 6 : 0)) * barrierScale);
        const rStep = Math.round(24 * barrierScale);
        // Minimum inner shield radius is 76px so the wizard (tallest point 37px from shield center) has 39px+ clearance and NEVER overlaps!
        const r1 = Math.max(76, Math.round(78 * barrierScale)) + comboBonus;
        const r2 = r1 + rStep;
        const r3 = r2 + rStep;
        const r4 = r3 + rStep;

        const defenseMode = this.stats.getSurvivalDefenseMode();
        let activeRadius = Math.round(30 * barrierScale);
        let hitColor = '#ff4b4b';

        if (defenseMode === 'absorption') {
            // Voidweaver has one outer event horizon. Its 3/4 charges are a pool,
            // not separate shrinking collision rings; once exhausted, the ward
            // collapses to the mage's small body hitbox.
            activeRadius = this.stats.lives > 0
                ? (this.stats.hasSkill('life') ? r4 : r3)
                : activeRadius;
            hitColor = '#00e5ff';
        } else if (defenseMode === 'lives') {
            // Bloodseeker deliberately has no barrier/ward ring. Lives are a
            // damage pool, while the character body remains the hit target.
            activeRadius = Math.round(30 * barrierScale);
            hitColor = '#ff1744';
        } else if (this.stats.lives >= 5) { activeRadius = r4; hitColor = '#00e5ff'; }
        else if (this.stats.lives === 4) { activeRadius = r3; hitColor = '#ffd700'; }
        else if (this.stats.lives === 3) { activeRadius = r2; hitColor = '#d500f9'; }
        else if (this.stats.lives === 2) { activeRadius = r1; hitColor = '#29b6f6'; }

        for (let i = this.words.length - 1; i >= 0; i--) {
            const word = this.words[i];
            word.update(dt);

            // Only do collision check on words that are NOT dying
            if (!word.dying) {
                const dx = word.x - wizX;
                const dy = word.y - shieldY;
                const distance = Math.sqrt(dx * dx + dy * dy);
                const textHitboxSize = 20;

                if (distance < activeRadius + textHitboxSize) {
                    // AT-F9 duel: words never damage — arrival expires the race
                    // word (DuelRace finalizes on the host; guests mirror).
                    if (this.gameMode === 'duel') {
                        this.words.splice(i, 1);
                        if (word === this.targetedWord) {
                            word.isTargeted = false;
                            this.targetedWord = null;
                        }
                        this.audio.playShatter();
                        this.combatSystem.spawnExplosion(word.x, word.y, { particles: [hitColor, '#ffffff'] });
                        if (this.onRaceWordExpired) this.onRaceWordExpired(word);
                        continue;
                    }
                    if (this.gameMode !== 'duel' && this.stats.hasSkill('precognition') && !this.precognitionUsed) {
                        this.precognitionUsed = true;
                        this.words.splice(i, 1);
                        if (word === this.targetedWord) {
                            word.isTargeted = false;
                            this.targetedWord = null;
                        }

                        // Free Nova Cast
                        this.audio.playExplosion();
                        this.combatSystem.triggerShake(15, 600);
                        this.combatSystem.spawnExplosion(this.canvas.width / 2, this.canvas.height / 2, { particles: ['#9C27B0', '#ffffff', '#E040FB'] }, 3.0);

                        for (let j = this.words.length - 1; j >= 0; j--) {
                            const w = this.words[j];
                            if (w.dying || w.isBossAttack) continue;
                            this.stats.addScore(w.text.length, false);
                            w.dying = true;
                            this.combatSystem.spawnBurst(w.x, w.y, w.elementColors.particles);
                            if (w === this.targetedWord) {
                                w.isTargeted = false;
                                this.targetedWord = null;
                            }
                        }

                        if (this.isBossPhase && this.boss && !this.boss.isDead) {
                            for (let j = 0; j < 3; j++) this.boss.takeDamage();
                        }
                        continue;
                    }

                    this.words.splice(i, 1);
                    if (word === this.targetedWord) {
                        word.isTargeted = false;
                        this.targetedWord = null;
                    }

                    // Every falling word is rendered as a meteor. Reaching the
                    // character is a shield impact, so it consumes the equipped
                    // character's defense. Only the off-screen path below is
                    // streak-only for ordinary meteors.
                    if (word.meteor) {
                        const defense = this.stats.consumeSurvivalDefense();
                        // The Voidweaver CAPTURES the meteor at its ward instead
                        // of shattering it, so the impact treatment is derived
                        // from the resolved defense mode — not from the word
                        // alone. Every other mode keeps the damage shatter.
                        const isVoidAbsorb = defense.mode === 'absorption';
                        if (isVoidAbsorb) {
                            this.audio.playVoidAbsorb();
                            this.combatSystem.spawnVoidAbsorption(wizX, shieldY);
                        } else {
                            this.audio.playShatter();
                            this.combatSystem.spawnExplosion(word.x, word.y, { particles: [hitColor, '#ffffff'] });
                        }
                        this.combatSystem.triggerShake(5, 200);
                        this.stats.combo = 0;
                        this.bloodVignetteIntensity = 1.0;
                        this.stats.updateHUD();
                        const defenseLabel = defense.mode === 'absorption'
                            ? 'ABSORPTION −1'
                            : defense.mode === 'lives'
                                ? 'LIFE LOST'
                                : 'SHIELD BROKEN';
                        this.floatingTexts.push(new FloatingText(defenseLabel, wizX, wizY - 120, hitColor, 28));
                        if (isVoidAbsorb && defense.before > 1) {
                            this.voidWardUntil = Date.now() + 1500;
                            this.floatingTexts.push(new FloatingText('SPACE SLOWED', this.canvas.width / 2, this.canvas.height - 150, '#00e5ff', 22));
                        }
                        if (defense.mode === 'barriers' && defense.before > 2 && defense.after <= 2) {
                            this.triggerBarrierBreakEffect();
                        }
                        if (defense.depleted) this.triggerGameOver();
                    } else {
                        // An ordinary word that reaches the mage is a typing
                        // failure only: reset the streak, never the barrier/life
                        // pool. The shatter remains as feedback, not damage.
                        this.audio.playShatter();
                        this.stats.combo = 0;
                        this.stats.updateHUD();
                        this.floatingTexts.push(new FloatingText("STREAK BROKEN", wizX, wizY - 120, hitColor, 28));
                    }
                } else if (word.y > this.canvas.height + 150) {
                    // Check if word drifted completely off-screen (missed)
                    // AT-F9 duel: expiry only — never damage.
                    if (this.gameMode === 'duel') {
                        if (word === this.targetedWord) {
                            word.isTargeted = false;
                            this.targetedWord = null;
                        }
                        this.words.splice(i, 1);
                        if (this.onRaceWordExpired) this.onRaceWordExpired(word);
                        continue;
                    }
                    this.words.splice(i, 1);
                    if (word === this.targetedWord) {
                        word.isTargeted = false;
                        this.targetedWord = null;
                    }

                    // A word that drifts off-screen is also a missed typing
                    // failure only. Keep the feedback, but never consume the
                    // barrier/life pool for an ordinary word. A boss attack is
                    // the explicit damage source and still consumes a life.
                    if (word.isBossAttack) {
                        const defense = this.stats.consumeSurvivalDefense();
                        const isVoidAbsorb = defense.mode === 'absorption';
                        if (isVoidAbsorb) {
                            this.audio.playVoidAbsorb();
                            this.combatSystem.spawnVoidAbsorption(wizX, shieldY);
                        } else {
                            this.audio.playShatter();
                        }
                        this.combatSystem.triggerShake(5, 200);
                        this.stats.combo = 0;
                        this.bloodVignetteIntensity = 1.0;
                        this.stats.updateHUD();
                        const defenseLabel = defense.mode === 'absorption'
                            ? 'ABSORPTION −1'
                            : defense.mode === 'lives'
                                ? 'LIFE LOST'
                                : 'SHIELD BROKEN';
                        this.floatingTexts.push(new FloatingText(defenseLabel, wizX, wizY - 120, hitColor, 28));
                        if (isVoidAbsorb && defense.before > 1) {
                            this.voidWardUntil = Date.now() + 1500;
                            this.floatingTexts.push(new FloatingText('SPACE SLOWED', this.canvas.width / 2, this.canvas.height - 150, '#00e5ff', 22));
                        }
                        if (defense.mode === 'barriers' && defense.before > 2 && defense.after <= 2) {
                            this.triggerBarrierBreakEffect();
                        }
                        if (defense.depleted) this.triggerGameOver();
                    } else {
                        this.audio.playShatter();
                        this.stats.combo = 0;
                        this.stats.updateHUD();
                        this.floatingTexts.push(new FloatingText("STREAK BROKEN", wizX, wizY - 120, hitColor, 28));
                    }
                }
            }

            // Remove words whose death animation has completed
            if (word.isDead) {
                this.words.splice(i, 1);
            }
        }

        // Update particles via ParticlePool (zero-allocation)
        if (this.particles && typeof this.particles.update === 'function') {
            this.particles.update(dt);
        } else {
            for (let i = this.particles.length - 1; i >= 0; i--) {
                const p = this.particles[i];
                p.update(dt);
                if (p.life <= 0) {
                    this.particles.splice(i, 1);
                }
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

                // Each solved boss-attack word is one character-shaped strike.
                // CombatSystem owns the damage profile AND the impact
                // presentation, so the per-character identity lives in one place.
                if (this.isBossPhase && this.boss && !this.boss.isDead) {
                    this.combatSystem.strikeBoss(proj.wordLength);
                }
            }
        }
    }

    draw(frozen = false) {
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
            const bgVignette = this._getComboVignette();
            if (bgVignette) {
                this.ctx.save();
                this.ctx.globalAlpha = comboIntensity;
                this.ctx.drawImage(bgVignette, 0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();
            }
        }

        // --- Star field ---
        this._drawStars(comboIntensity);

        // Bloodseeker's ready Moon belongs behind the active combatants. Its
        // glow grows with Supernova mana, but it remains a quiet background
        // element until the cast cinematic takes over.
        this._drawReadyBloodMoon();

        // --- Pocket Dimension Background ---
        if (this.bossDimensionAlpha > 0) {
            const { base, vig } = this._getPocketDimensionBGs();
            this.ctx.save();
            this.ctx.globalAlpha = this.bossDimensionAlpha;
            if (base) this.ctx.drawImage(base, 0, 0, this.canvas.width, this.canvas.height);

            const vignetteAlpha = 0.4 + Math.sin(performance.now() / 600) * 0.15;
            this.ctx.globalAlpha = this.bossDimensionAlpha * vignetteAlpha;
            if (vig) this.ctx.drawImage(vig, 0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }


        // --- Wizard and Barriers ---
        this.ctx.save();
        const wizX = this.canvas.width / 2;
        const wizY = this.canvas.height - 35;
        const shieldY = wizY - 18;
        const barrierScale = Math.min(1, Math.max(0.75, this.canvas.height / 750));
        const comboBonus = Math.round(((this.stats && this.stats.combo >= 100) ? 12 : ((this.stats && this.stats.combo >= 50) ? 6 : 0)) * barrierScale);
        const rStep = Math.round(24 * barrierScale);
        const r1 = Math.max(76, Math.round(78 * barrierScale)) + comboBonus;
        const r2 = r1 + rStep;
        const r3 = r2 + rStep;
        const r4 = r3 + rStep;

        // AT-F9: arena shields live in the score bar (HP bars) — no survival
        // rings around the mage; they would falsely imply live shield state.
        if (this.gameMode !== 'duel') {
            const defenseMode = this.stats.getSurvivalDefenseMode();
            if (defenseMode === 'absorption') {
                // One outer Voidweaver event horizon; the 3/4 absorption charges
                // are represented by the HUD pool, never by stacked rings.
                if (this.stats.lives > 0) {
                    const radius = this.stats.hasSkill('life') ? r4 : r3;
                    this._blitBarrier(this._barrierImg('voidward', '#00e5ff', radius, 0), wizX, shieldY);
                }
            } else if (defenseMode !== 'lives') {
                const barriers = [
                    { radius: r1, color: '#29b6f6', active: this.stats.lives >= 2 },
                    { radius: r2, color: '#d500f9', active: this.stats.lives >= 3 },
                    { radius: r3, color: '#ffd700', active: this.stats.lives >= 4 },
                    ...(this.stats.hasSkill('life') ? [{ radius: r4, color: '#00e5ff', active: this.stats.lives >= 5 }] : [])
                ];
                barriers.forEach((barrier) => {
                    if (barrier.active) {
                        this._blitBarrier(this._barrierImg('def', barrier.color, barrier.radius, 0), wizX, shieldY);
                    }
                });
            }
        }

        this.ctx.restore();
        this.ctx.shadowBlur = window.__atLowQuality ? 0 : 0;

        // --- Character Sprite Drawing via CharacterRenderer ---
        const animProgress = this.playerAnimTimer > 0 ? this.playerAnimTimer / 200 : 0;
        if (this.gameMode === 'duel' && this.duelSide) {
            // AT-F9 Phase 3: BOTH mages share the arena in FIXED team slots —
            // slot A (host) is the left mage in blue, slot B (challenger) the
            // right mage in red, IDENTICAL on both clients, because colour and
            // position are keyed to the team slot and never to "self". Keying
            // them to the viewer swapped the two mages between clients and
            // contradicted the score bar (owner-reported confusion).
            // Sprites are NOT mirrored: the Archmage is procedural/radially
            // symmetric, so flipping it only mirrored asymmetric details
            // (wand arm, cowl) and implied a facing both clients disagreed on.
            const selfSlot = this.duelSide;            // 'A' host | 'B' challenger
            const oppSlot = otherSlot(selfSlot);
            const opp = this.duelOpponent || {};
            const selfCharacter = this.stats.selectedCharacter;
            const oppCharacter = opp.character || this.stats.selectedCharacter;
            const selfCombo = this.duelCombos[selfSlot] || 0;
            const oppCombo = this.duelCombos[oppSlot] || 0;
            // Streak identity first, active seal second, body last. This keeps
            // the class focus dominant without deleting the character's aura.
            CharacterRenderer.drawStreakOverlay(
                this.ctx, slotX(this.canvas, selfSlot), this.canvas.height - 35,
                selfCharacter, selfCombo, performance.now(), !!this.duelAuras[selfSlot]
            );
            CharacterRenderer.drawStreakOverlay(
                this.ctx, slotX(this.canvas, oppSlot), this.canvas.height - 35,
                oppCharacter, oppCombo, performance.now(), !!this.duelAuras[oppSlot]
            );
            this._drawDuelAuras(frozen);
            const selfStats = this.duelAuras[selfSlot]
                ? { ...this.stats, arenaSkillActive: true, skipStreakOverlay: true }
                : { ...this.stats, skipStreakOverlay: true };
            this._drawTeamMage(
                slotX(this.canvas, selfSlot), animProgress, selfStats,
                teamColorFor(selfSlot), 'YOU'
            );
            const oppStats = {
                ...this.stats,
                // AT-F16: the renderer branches on characterId now, so the
                // opponent plays as whichever Forge skin their presence
                // advertised (unknown/missing → the Archmage).
                selectedCharacter: opp.character || this.stats.selectedCharacter,
                combo: oppCombo,
                arenaSkillActive: !!this.duelAuras[oppSlot],
                skipStreakOverlay: true,
                wandColor: opp.wand || this.stats.wandColor,
                hasSkill: () => false
            };
            this._drawTeamMage(
                slotX(this.canvas, oppSlot), 0, oppStats,
                teamColorFor(oppSlot), opp.name || 'Opponent'
            );
        } else {
            // AT-F15: Survival only. The blade-lease table travels on `stats` so
            // the renderer can read it; it is transient presentation state and
            // is never read by gameplay. Cleared on reset() with the rest of
            // the run state, and stripped again immediately after the draw so
            // no later code path can mistake it for persistent stats.
            this.stats.bladeSlash = this.bladeSlash;
            CharacterRenderer.draw(this.ctx, wizX, wizY, this.stats.selectedCharacter, animProgress, this.stats);
            this.stats.bladeSlash = null;
        }
        this.ctx.restore();

        // --- Boss ---
        if (this.isBossPhase && this.boss) {
            this.boss.draw(this.ctx);
        }

        // --- Words ---
        this.words.forEach(word => {
            if (word !== this.targetedWord) {
                word.isTargeted = false;
                word.draw(this.ctx);
            }
        });
        if (this.targetedWord && !this.targetedWord.isDead) {
            this.targetedWord.isTargeted = true;
            this.targetedWord.draw(this.ctx);
        }

        // --- Ambient Dust (Batched single-path draw) ---
        this.ctx.save();
        this.ctx.globalAlpha = 0.22;
        this.ctx.fillStyle = '#ffffff';
        this.ctx.beginPath();
        for (let i = 0; i < this.ambientParticles.length; i++) {
            const ap = this.ambientParticles[i];
            this.ctx.moveTo(ap.x + ap.size, ap.y);
            this.ctx.arc(ap.x, ap.y, ap.size, 0, Math.PI * 2);
        }
        this.ctx.fill();
        this.ctx.restore();

        // --- Projectiles ---
        this.projectiles.forEach(p => p.draw(this.ctx));

        // --- Particles ---
        if (this.particles && typeof this.particles.draw === 'function') {
            this.particles.draw(this.ctx);
        } else {
            this.particles.forEach(p => p.draw(this.ctx));
        }

        // --- Floating Texts ---
        this.floatingTexts.forEach(ft => ft.draw(this.ctx));

        // --- Character Supernova cinematics (presentation only) ---
        this._drawBloodMoonSupernova();
        this._drawVoidCollapseSupernova();

        // --- Blind Overlay ---
        if (this.blindTimer > 0) {
            this.ctx.save();
            this.ctx.fillStyle = 'rgba(20, 0, 40, 0.95)';
            this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
            this.ctx.restore();
        }

        // --- Blood Vignette ---
        if (this.bloodVignetteIntensity > 0) {
            const vig = this._getBloodVignette();
            if (vig) {
                this.ctx.save();
                this.ctx.globalAlpha = this.bloodVignetteIntensity * 0.5; // Max 50% opacity
                this.ctx.drawImage(vig, 0, 0, this.canvas.width, this.canvas.height);
                this.ctx.restore();
            }
        }
        this.ctx.restore(); // Restore from screen shake translate
    }
    /**
     * Bloodseeker's ready Moon is a background charge indicator. It is always
     * behind the mage/words, its glow rises continuously with the Supernova
     * mana bar, and it disappears during the active cinematic.
     */
    _drawReadyBloodMoon() {
        if (this.gameMode === 'duel' || this.stats.selectedCharacter !== 'bloodseeker') return;
        if (this.supernovaFx) return;

        const readiness = Math.max(0, Math.min(1, this.stats.mana / 100));
        // A faint dormant Moon is always present in Bloodseeker's background;
        // it brightens continuously as the 100-mana Supernova bar fills.
        const x = this.canvas.width * 0.82;
        const y = this.canvas.height * 0.18;
        const radius = Math.min(this.canvas.width, this.canvas.height) * (0.055 + readiness * 0.020);
        const ctx = this.ctx;
        const pulse = 0.96 + Math.sin(performance.now() / 1200) * 0.04;
        const backgroundAlpha = 0.18 + readiness * 0.24;

        ctx.save();
        ctx.translate(x, y);
        ctx.scale(pulse, pulse);
        const halo = ctx.createRadialGradient(0, 0, radius * 0.25, 0, 0, radius * 2.8);
        halo.addColorStop(0, `rgba(255, 164, 158, ${backgroundAlpha * 0.78})`);
        halo.addColorStop(0.35, `rgba(255, 23, 68, ${backgroundAlpha * 0.42})`);
        halo.addColorStop(1, 'rgba(80, 0, 18, 0)');
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(0, 0, radius * 2.8, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = `rgba(255, 179, 173, ${0.18 + readiness * 0.42})`;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = `rgba(255, 65, 88, ${0.16 + readiness * 0.38})`;
        ctx.lineWidth = 1 + readiness;
        ctx.stroke();

        // Offset shadow preserves the eclipse silhouette without making the
        // ready state as bright or large as the Supernova takeover Moon.
        ctx.fillStyle = `rgba(48, 0, 14, ${0.20 + readiness * 0.28})`;
        ctx.beginPath();
        ctx.arc(radius * 0.30, -radius * 0.10, radius * 0.90, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }



    /**
     * Lease the next free netherblade to slash the boss. The cursor makes this
     * a strict 1→2→3→4 rotation; a blade still in the air is skipped rather
     * than re-fired, which is what lets a very fast typist use all four
     * without any single blade striking twice.
     *
     * @param {number} targetX boss x
     * @param {number} targetY boss y
     * @param {number} duration flight + slash + recall time in ms
     * @returns {number} the leased blade index, or -1 if all four are in flight
     */
    _leaseBladeSlash(targetX, targetY, duration = 700) {
        if (!this.bladeSlash) this.bladeSlash = { next: 0, leases: [null, null, null, null] };
        const { leases } = this.bladeSlash;
        const now = performance.now();

        for (let i = 0; i < 4; i++) {
            const active = leases[i];
            if (active && now - active.startedAt >= active.duration) leases[i] = null;
        }
        for (let n = 0; n < 4; n++) {
            const idx = (this.bladeSlash.next + n) % 4;
            if (!leases[idx]) {
                leases[idx] = { startedAt: now, duration, targetX, targetY };
                this.bladeSlash.next = (idx + 1) % 4;
                return idx;
            }
        }
        return -1;
    }

    /**
     * Supernova leases ALL FOUR blades at once. The flight is deliberately
     * shorter than the Blood Moon cinematic so every blade has landed back in
     * formation by the time the takeover finishes — a volley that outlived its
     * own cinematic would leave four blades hanging in mid-air after the spell
     * finished.
     */
    _leaseBladeVolley(targetX, targetY, duration = 960) {
        if (!this.bladeSlash) this.bladeSlash = { next: 0, leases: [null, null, null, null] };
        const now = performance.now();
        for (let i = 0; i < 4; i++) {
            this.bladeSlash.leases[i] = { startedAt: now, duration, targetX, targetY };
        }
        this.bladeSlash.next = 0;
    }

    /**
     * Bloodseeker's Supernova is a 1 second, 100 ms-stepped cinematic. The
     * world is already resolved by CombatSystem; this only paints presentation
     * state, so tab throttling cannot alter damage, word clears, or boss hits.
     */
    _drawBloodMoonSupernova() {
        const fx = this.supernovaFx;
        if (!fx || fx.kind !== 'blood-moon') return;
        const elapsed = performance.now() - fx.startedAt;
        if (elapsed >= fx.duration) {
            this.supernovaFx = null;
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const lowQ = window.__atLowQuality;
        // 100 ms steps, so the stage count follows the cinematic's own duration
        // rather than a fixed 10 — the Blood Moon now runs 1.8 s to match the
        // four-blade volley, and a hardcoded cap would freeze the last frame.
        const stage = Math.min(Math.ceil(fx.duration / 100) - 1, Math.floor(elapsed / 100));
        const local = (elapsed % 100) / 100;
        // The Moon is the source in the upper-right; the sigil below is the
        // ritual's center. Their diagonal relationship makes the takeover read
        // as a spell travelling across the canvas, not a generic red flash.
        const moonX = w * 0.82;
        const moonY = h * 0.18;
        const maxRadius = Math.hypot(w, h) * 0.72;
        const spread = stage < 2
            ? 0.08 + stage * 0.08 + local * 0.04
            : stage < 5
                ? 0.24 + (stage - 2) * 0.18 + local * 0.10
                : stage < 7
                    ? 0.78 + (stage - 5) * 0.11
                    : 1;
        const fade = stage >= 7 ? Math.max(0, 1 - (elapsed - 700) / 300) : 1;
        const ctx = this.ctx;
        ctx.save();

        // The Moon is born in the upper-right. Its red influence then travels
        // diagonally toward the central Blood-Oath sigil.
        if (stage < 7) {
            const fieldRadius = Math.max(1, maxRadius * spread);
            const field = ctx.createRadialGradient(moonX, moonY, 12, moonX, moonY, fieldRadius);
            const fieldAlpha = (stage < 2 ? 0.12 + stage * 0.07 : 0.30 + Math.min(0.24, (stage - 2) * 0.06)) * fade;
            field.addColorStop(0, `rgba(255, 150, 145, ${fieldAlpha * 0.9})`);
            field.addColorStop(0.45, `rgba(190, 0, 28, ${fieldAlpha * 0.62})`);
            field.addColorStop(1, 'rgba(58, 0, 12, 0)');
            ctx.fillStyle = field;
            ctx.fillRect(0, 0, w, h);
        } else {
            ctx.fillStyle = `rgba(110, 0, 20, ${0.16 * fade})`;
            ctx.fillRect(0, 0, w, h);
        }

        // Blood moon: pale disc, red corona, and a slow dark crescent. The
        // crescent is a graphic blood-eclipse cue, not a copied character shot.
        const moonScale = stage < 2 ? 0.35 + stage * 0.22 + local * 0.08 : 1;
        const moonR = Math.min(w, h) * 0.105 * moonScale;
        if (stage <= 7) {
            const corona = ctx.createRadialGradient(moonX, moonY, moonR * 0.4, moonX, moonY, moonR * 2.8);
            corona.addColorStop(0, `rgba(255, 220, 205, ${0.7 * fade})`);
            corona.addColorStop(0.35, `rgba(255, 23, 68, ${0.45 * fade})`);
            corona.addColorStop(1, 'rgba(80, 0, 18, 0)');
            ctx.fillStyle = corona;
            ctx.beginPath();
            ctx.arc(moonX, moonY, moonR * 2.8, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = '#ffb3ad';
            ctx.beginPath();
            ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = `rgba(255, 65, 88, ${0.95 * fade})`;
            ctx.lineWidth = lowQ ? 1.2 : 2.2;
            ctx.stroke();

            ctx.fillStyle = 'rgba(48, 0, 14, 0.62)';
            ctx.beginPath();
            ctx.arc(moonX + moonR * 0.34, moonY - moonR * 0.12, moonR * 0.92, 0, Math.PI * 2);
            ctx.fill();
        }

        // Impact frame: a blood-oath triangle and radial spokes punch through
        // the takeover once, then remain restrained during the recovery frames.
        if (stage >= 4 && stage <= 6) {
            const impactAlpha = stage === 4 ? 0.35 + local * 0.45 : 0.8 - local * 0.12;
            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.globalAlpha = impactAlpha * fade;
            ctx.strokeStyle = '#ff6b7a';
            ctx.lineWidth = lowQ ? 1.2 : 2.4;
            ctx.shadowColor = '#ff1744';
            ctx.shadowBlur = lowQ ? 0 : 16;
            ctx.beginPath();
            ctx.moveTo(0, -92);
            ctx.lineTo(80, 64);
            ctx.lineTo(-80, 64);
            ctx.closePath();
            ctx.stroke();
            ctx.rotate(Math.PI / 6);
            ctx.beginPath();
            ctx.arc(0, 0, 46, 0, Math.PI * 2);
            ctx.stroke();
            ctx.rotate(-Math.PI / 3);
            ctx.beginPath();
            ctx.arc(0, 0, 68, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        // Central Blood-Oath sigil: the Moon is the source, while this complete
        // ritual geometry is what the Moon awakens in the middle of the canvas.
        if (stage >= 2 && stage <= 6) {
            const sigilAlpha = (stage === 2 ? 0.20 + local * 0.18 : stage >= 5 ? 0.76 - local * 0.12 : 0.42 + local * 0.14) * fade;
            ctx.save();
            ctx.translate(w / 2, h / 2);
            const sigilSpin = stage * 0.12 + Math.PI / 6;
            ctx.globalAlpha = sigilAlpha;
            ctx.strokeStyle = '#ff1744';
            ctx.lineWidth = lowQ ? 1.1 : 2.2;
            ctx.shadowColor = '#ff1744';
            ctx.shadowBlur = lowQ ? 0 : 14;
            ctx.beginPath();
            ctx.arc(0, 0, 88, 0, Math.PI * 2);
            ctx.stroke();
            ctx.strokeStyle = '#ff8a95';
            ctx.lineWidth = 1;
            ctx.setLineDash([7, 6]);
            ctx.beginPath();
            ctx.arc(0, 0, 68, -sigilSpin, -sigilSpin + Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = stage >= 5 ? '#fff0ef' : '#ff6b7a';
            ctx.lineWidth = lowQ ? 1.2 : 2;
            ctx.beginPath();
            ctx.moveTo(0, -58);
            ctx.lineTo(50, 38);
            ctx.lineTo(-50, 38);
            ctx.closePath();
            ctx.stroke();
            for (let i = 0; i < 6; i++) {
                const a = i * Math.PI / 3 + stage * 0.12;
                ctx.fillStyle = i % 2 ? '#ffffff' : '#ff8a95';
                ctx.beginPath();
                ctx.arc(Math.cos(a) * 88, Math.sin(a) * 88, stage >= 5 ? 3 : 2, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }

        // Stepped title is readable without covering the arena. It appears on
        // the impact frame, then holds briefly before the field dissolves.
        if (stage >= 5 && stage <= 6) {
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${lowQ ? 24 : 32}px Cinzel, serif`;
            ctx.fillStyle = '#fff0ef';
            ctx.shadowColor = '#ff1744';
            ctx.shadowBlur = lowQ ? 0 : 12;
            ctx.fillText('BLOOD MOON', w / 2, h * 0.68);
            ctx.font = `bold ${lowQ ? 12 : 15}px Cinzel, serif`;
            ctx.fillStyle = '#ffb3ad';
            ctx.fillText('THE HARVEST BEGINS', w / 2, h * 0.68 + 28);
            ctx.restore();
        }
        ctx.restore();
    }

    /** Voidweaver Supernova: a 100ms-stepped inward collapse, never an outward blast. */
    _drawVoidCollapseSupernova() {
        const fx = this.supernovaFx;
        if (!fx || fx.kind !== 'void-collapse') return;
        const elapsed = performance.now() - fx.startedAt;
        if (elapsed >= fx.duration) {
            this.supernovaFx = null;
            return;
        }

        const w = this.canvas.width;
        const h = this.canvas.height;
        const stage = Math.min(9, Math.floor(elapsed / 100));
        const local = (elapsed % 100) / 100;
        const cx = w / 2;
        const cy = h / 2;
        const lowQ = window.__atLowQuality;
        const maxRadius = Math.max(w, h) * 0.68;
        const collapse = stage < 2
            ? 0.30 - stage * 0.07 - local * 0.025
            : stage < 5
                ? 0.16 - (stage - 2) * 0.035 - local * 0.018
                : stage < 7
                    ? 0.045 + (stage - 5) * 0.018
                    : 0.08 + (stage - 7) * 0.05;
        const release = stage >= 6;
        const fade = stage >= 7 ? Math.max(0, 1 - (elapsed - 700) / 300) : 1;
        const ctx = this.ctx;
        ctx.save();

        // A void field closes around the edges while the center remains the
        // readable target. It is intentionally translucent, not a blackout.
        const edge = ctx.createRadialGradient(cx, cy, maxRadius * 0.25, cx, cy, maxRadius);
        edge.addColorStop(0, 'rgba(7, 0, 24, 0)');
        edge.addColorStop(0.68, `rgba(8, 0, 28, ${0.20 + Math.min(0.30, stage * 0.04)})`);
        edge.addColorStop(1, `rgba(0, 0, 8, ${0.68 * fade})`);
        ctx.fillStyle = edge;
        ctx.fillRect(0, 0, w, h);

        // The horizon contracts instead of expanding: this is the primary
        // visual difference from Wizard and Bloodseeker Supernovas.
        const horizon = Math.max(8, maxRadius * collapse);
        ctx.strokeStyle = `rgba(0, 229, 255, ${(0.28 + (1 - collapse) * 0.55) * fade})`;
        ctx.lineWidth = lowQ ? 1.2 : 2.6;
        if (!lowQ) {
            ctx.shadowColor = '#7c4dff';
            ctx.shadowBlur = 16;
        }
        ctx.beginPath();
        ctx.ellipse(cx, cy, horizon, horizon * 0.42, 0, 0, Math.PI * 2);
        ctx.stroke();

        if (stage >= 2 && stage <= 5) {
            ctx.strokeStyle = `rgba(124, 77, 255, ${(0.42 + local * 0.28) * fade})`;
            ctx.lineWidth = lowQ ? 1 : 1.8;
            ctx.setLineDash([12, 9]);
            ctx.beginPath();
            ctx.ellipse(cx, cy, horizon * 0.68, horizon * 0.27, Math.PI / 4, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Four inward spokes make the collapse direction readable even when
        // the particle pool is in low-quality mode. The full elliptical
        // boundary keeps the effect centered instead of feeling like loose
        // fragments around the singularity.
        if (stage >= 1 && stage <= 5) {
            ctx.strokeStyle = `rgba(192, 132, 252, ${0.34 * fade})`;
            ctx.lineWidth = lowQ ? 1 : 1.4;
            for (let i = 0; i < 4; i++) {
                const a = i * Math.PI / 2 + stage * 0.09;
                ctx.beginPath();
                ctx.moveTo(cx + Math.cos(a) * horizon * 1.18, cy + Math.sin(a) * horizon * 0.52);
                ctx.lineTo(cx + Math.cos(a) * horizon * 0.34, cy + Math.sin(a) * horizon * 0.14);
                ctx.stroke();
            }
        }

        if (release) {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.globalAlpha = (stage === 6 ? 0.85 : 0.52) * fade;
            ctx.fillStyle = '#020008';
            ctx.beginPath();
            ctx.arc(0, 0, 18 + stage * 7, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = lowQ ? 1.2 : 2.4;
            ctx.shadowColor = '#7c4dff';
            ctx.shadowBlur = lowQ ? 0 : 18;
            ctx.beginPath();
            ctx.arc(0, 0, 24 + stage * 8, 0, Math.PI * 2);
            ctx.stroke();
            // Lensed release: stretched light leaves the singularity without
            // becoming a generic radial explosion.
            for (let i = 0; i < 8; i++) {
                const a = i * Math.PI / 4 + stage * 0.05;
                const inner = 24 + stage * 5;
                const outer = inner + 34 + stage * 7;
                ctx.strokeStyle = i % 2 ? `rgba(0,229,255,${0.24 * fade})` : `rgba(192,132,252,${0.34 * fade})`;
                ctx.lineWidth = lowQ ? 0.8 : 1.4;
                ctx.beginPath();
                ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner * 0.62);
                ctx.lineTo(Math.cos(a) * outer, Math.sin(a) * outer * 0.62);
                ctx.stroke();
            }
            ctx.strokeStyle = `rgba(216,250,255,${0.30 * fade})`;
            ctx.lineWidth = lowQ ? 0.8 : 1.2;
            ctx.beginPath();
            ctx.ellipse(0, 0, 30 + stage * 9, (30 + stage * 9) * 0.42, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }

        if (stage === 5 || stage === 6) {
            ctx.save();
            ctx.globalAlpha = fade;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `bold ${lowQ ? 24 : 32}px Cinzel, serif`;
            ctx.fillStyle = '#e9d5ff';
            ctx.shadowColor = '#7c4dff';
            ctx.shadowBlur = lowQ ? 0 : 12;
            ctx.fillText('SINGULARITY', cx, h * 0.68);
            ctx.font = `bold ${lowQ ? 12 : 15}px Cinzel, serif`;
            ctx.fillStyle = '#00e5ff';
            ctx.fillText('SPACE BENDS INWARD', cx, h * 0.68 + 28);
            ctx.restore();
        }
        ctx.restore();
    }

    /** Bloodseeker's streak milestone restores a lost layer and announces it. */
    _onBarrierRestored(combo) {
        if (this.gameMode === 'duel') return;
        const x = this.canvas.width / 2;
        const y = this.canvas.height - 150;
        this.floatingTexts.push(new FloatingText(`BLOOD OATH +1 LIFE · ${combo}x`, x, y, '#ff8a95', 22));
        this.combatSystem.spawnBurst(x, y + 20, ['#ff1744', '#ff8a95', '#ffffff']);
    }

    _drawDuelAuras(frozen = false) {
        if (this.gameMode !== 'duel') return;
        const now = Date.now();
        const scale = Math.min(1.2, Math.max(0.82, this.canvas.height / 750));
        const baseRadius = Math.round(154 * scale);
        const y = this.canvas.height - 53;
        const timeStopActive = frozen && this.duelTimeStopSlot;
        const remaining = this.duelTimeStopUntil - now;

        // The Chronomancer's primary effect is a shared, centered canvas seal.
        // Its final outer arc is driven by the host's absolute deadline, so it
        // visibly counts down to the same expiry on both clients.
        if (timeStopActive && remaining > 0) {
            drawTimeStopSeal(this.ctx, this.canvas.width, this.canvas.height, remaining, now);
        }

        for (const slot of ['A', 'B']) {
            const skillId = this.duelAuras[slot];
            if (!skillId) continue;
            const remaining = this.duelBuffUntil[slot] > now
                ? this.duelBuffUntil[slot] - now
                : 0;
            const radius = baseRadius + (skillId === 'time-stop' ? 18 : 0);
            const breathe = 1 + Math.sin(now / (skillId === 'time-stop' ? 220 : 420)) * .035;
            drawCasterSigil(
                this.ctx,
                skillId,
                slotX(this.canvas, slot),
                y,
                Math.round(radius * breathe),
                now,
                skillId === 'time-stop' ? .86 : .72,
                skillId === 'time-stop' ? remaining : this.duelBuffUntil[slot] - now
            );
        }
    }

    _getComboVignette() {
        return RenderCache.bake('at_vignette_combo', 256, 256, (ctx) => {
            const grad = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
            grad.addColorStop(0, 'transparent');
            grad.addColorStop(1, 'rgba(100, 0, 80, 0.6)');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 256, 256);
        });
    }

    _getPocketDimensionBGs() {
        const base = RenderCache.bake('at_pocket_dim_base', 256, 256, (ctx) => {
            const g = ctx.createRadialGradient(128, 128, 15, 128, 128, 128);
            g.addColorStop(0, '#2a0808');
            g.addColorStop(1, '#05020a');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
        });
        const vig = RenderCache.bake('at_pocket_dim_vig', 256, 256, (ctx) => {
            const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
            g.addColorStop(0, 'transparent');
            g.addColorStop(1, 'rgba(80, 0, 20, 0.55)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
        });
        return { base, vig };
    }

    _getBloodVignette() {
        return RenderCache.bake('at_blood_vignette', 256, 256, (ctx) => {
            const g = ctx.createRadialGradient(128, 128, 40, 128, 128, 128);
            g.addColorStop(0, 'transparent');
            g.addColorStop(1, 'rgba(255, 0, 0, 1)');
            ctx.fillStyle = g;
            ctx.fillRect(0, 0, 256, 256);
        });
    }

    _drawStars(comboIntensity = 0) {
        // Layered starfield: two baked canvases (white calm / red high-combo)
        // are scrolled downward slowly and cross-faded on combo intensity.
        // The individual per-star twinkle from the original is approximated by
        // a uniform slow shimmer; motion and the red shift are preserved at a
        // fraction of the cost (2 drawImage + 2 solid fills, vs ~80 shadowed
        // arcs per frame before).
        const w = this.canvas.width;
        const h = this.canvas.height;
        const white = RenderCache.get(`at_stars_${w}x${h}_w`);
        const red = RenderCache.get(`at_stars_${w}x${h}_r`);
        if (!white || !red) return;

        const now = performance.now();
        // Downward drift: base ~12 px/s, up to ~90 px/s at full combo
        const pxPerSec = 12 + comboIntensity * 78;
        const scroll = (now / 1000 * pxPerSec) % h;

        // Cross-fade white -> red for comboIntensity above 0.5
        const redMix = Math.max(0, Math.min(1, (comboIntensity - 0.5) * 2));
        // Uniform shimmer approximating the old per-star twinkle
        const shimmer = 0.88 + 0.12 * Math.sin(now / 350);

        this.ctx.save();
        this.ctx.globalAlpha = (1 - redMix) * shimmer;
        if (this.ctx.globalAlpha > 0.005) {
            this.ctx.drawImage(white, 0, scroll - h);
            this.ctx.drawImage(white, 0, scroll);
        }
        this.ctx.globalAlpha = redMix * shimmer;
        if (this.ctx.globalAlpha > 0.005) {
            this.ctx.drawImage(red, 0, scroll - h);
            this.ctx.drawImage(red, 0, scroll);
        }
        this.ctx.restore();
    }

    // --- Baked round barriers ---
    // Shields are full 360° glowing spheres centered at the character (wizX, wizY).
    // Eliminates the flat bottom semicircle cutoff glitch during violent screen shakes (e.g. Supernova).
    _barrierImg(kind, color, radius, echoRadius = 0) {
        const R = Math.max(radius, echoRadius);
        const pad = 14;
        const key = `at_barr_${kind}_${color}_${R}_v4`;
        return RenderCache.bake(key, 2 * R + 2 * pad, 2 * R + 2 * pad, (ctx) => {
            const cx = R + pad;
            const cy = R + pad;
            const fullCircle = (r, lw, alpha, blur = 15) => {
                ctx.save();
                ctx.beginPath();
                ctx.arc(cx, cy, r, 0, Math.PI * 2, false);
                ctx.strokeStyle = color;
                ctx.lineWidth = lw;
                ctx.globalAlpha = alpha;
                ctx.shadowColor = color;
                ctx.shadowBlur = window.__atLowQuality ? 0 : blur;
                ctx.stroke();
                ctx.restore();
            };

            if (kind === 'voidward') {
                fullCircle(radius, 2.4, 0.95, 16);
                fullCircle(radius - 8, 1.0, 0.45, 8);
                // The Voidweaver ward is intentionally a clean circular
                // event horizon: no radial spokes, so the shield reads as a
                // calm absorption boundary rather than a cluttered sigil.
                ctx.restore();
            } else if (kind === 'bloodward') {
                fullCircle(radius, 2.4, 0.95, 16);
                fullCircle(radius - 8, 1.0, 0.45, 8);
                ctx.save();
                ctx.strokeStyle = 'rgba(255,23,68,0.9)';
                ctx.lineWidth = 1.6;
                ctx.beginPath();
                ctx.moveTo(cx, cy - radius * 0.48);
                ctx.lineTo(cx + radius * 0.42, cy + radius * 0.30);
                ctx.lineTo(cx - radius * 0.42, cy + radius * 0.30);
                ctx.closePath();
                ctx.stroke();
                for (let i = 0; i < 6; i++) {
                    const a = i * Math.PI / 3;
                    ctx.fillStyle = i % 2 ? '#ffd0d5' : '#ff1744';
                    ctx.beginPath();
                    ctx.arc(cx + Math.cos(a) * radius * 0.72, cy + Math.sin(a) * radius * 0.72, 2.4, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
            } else {
                // Wizard Arcane Barrier: Full 360° luminous sphere.
                fullCircle(radius, 3.0, 0.95, 16);
                fullCircle(radius - 5, 1.2, 0.35, 6);
            }
        });
    }

    _blitBarrier(img, wizX, wizY) {
        if (!img) return;
        // Breathing pulse centered on the character
        const pulse = 1 + 0.025 * Math.sin(performance.now() / 500);
        const dw = img.width * pulse;
        const dh = img.height * pulse;
        this.ctx.globalAlpha = 1;
        this.ctx.drawImage(img, wizX - dw / 2, wizY - dh / 2, dw, dh);
        this.ctx.globalAlpha = 1;
    }

    /**
     * AT-F9 P3: anchor point for anything that belongs to a team slot — the
     * caster's mage x, so per-player arena feedback appears on that player's
     * own side of the lane instead of dead-centre where it is ambiguous.
     * @param {'A'|'B'} [slot] defaults to this player's own slot.
     */
    duelSlotX(slot) {
        return slotX(this.canvas, slot || this.duelSide || 'A');
    }

    /**
     * AT-F9: spawn the shared race word issued by the host (duel mode only).
     * Variant always 'normal'; x/baseSpeed come from the issue payload so
     * both clients render the identical word. No class perks apply — one
     * shared word, one shared speed (fairness pin, AT-L7 spirit).
     */
    spawnRaceWord(text, { x, baseSpeed } = {}) {
        const targetX = this.canvas.width / 2;
        const targetY = this.canvas.height - 53;
        const margin = 100;
        let wordX = (typeof x === 'number')
            ? x
            : margin + Math.random() * Math.max(this.canvas.width - 2 * margin, 1);
        // Keep spawns out of the top-center band the score bar overlays —
        // deterministic nudge (no RNG) so both clients land on the same x.
        const avoidHalf = 170;
        const mid = this.canvas.width / 2;
        if (Math.abs(wordX - mid) < avoidHalf) {
            wordX = wordX < mid ? mid - avoidHalf : mid + avoidHalf;
        }
        const newWord = new Word(text, this.canvas.width, this.canvas.height,
            this.currentSpeedMultiplier, targetX, targetY, {
                variant: 'normal',
                x: wordX,
                y: -50,
                gameMode: this.gameMode,
                baseSpeed
            });
        this.words.push(newWord);
        return newWord;
    }

    /**
     * AT-F9 P3: the race word has been DECIDED against this client (the
     * opponent typed it first) — dissolve it instantly instead of letting a
     * dead word keep falling to this player's mage. No damage, no expiry
     * callback: DuelRace owns the arbitration, this is only the visual.
     * The dying animation is reused so the word fades out like a normal kill.
     * @param {string} color team colour of the player who took the word
     * @returns {boolean} true when a live race word was dissolved
     */
    dissolveRaceWord(color = '#b892b0') {
        const word = this.words.find(w => !w.dying && !w.isDead);
        if (!word) return false;
        if (word === this.targetedWord) {
            word.isTargeted = false;
            this.targetedWord = null;
        }
        word.dying = true;
        this.combatSystem.spawnBurst(word.x, word.y, [color, '#ffffff']);
        return true;
    }

    _spawnSingleWord() {
        const targetX = this.canvas.width / 2;
        const targetY = this.canvas.height - 53;

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

    /**
     * AT (option A): when the boss dies, every meteor it still owns unravels
     * with it, so a dead boss can never score a last hit.
     *
     * The dissolve is one-shot per boss (`_bossSummonsCleared`) so it cannot
     * re-fire on later frames, and each meteor gets its own burst so the removal
     * reads as the boss's magic coming apart rather than words blinking out.
     * ORDINARY words are deliberately left on the lane: they are the score/XP
     * flow, and clearing them would throw away the reward at the moment of
     * victory.
     */
    _dissolveBossSummons() {
        for (let i = this.words.length - 1; i >= 0; i--) {
            const word = this.words[i];
            if (!word.isBossAttack || word.dying) continue;
            word.dying = true;
            if (word === this.targetedWord) {
                word.isTargeted = false;
                this.targetedWord = null;
            }
            const palette = (word.elementColors && word.elementColors.particles)
                || [this.boss && this.boss.color ? this.boss.color : '#ffd700', '#ffffff'];
            this.combatSystem.spawnBurst(word.x, word.y, palette);
        }

        // A projectile the dead boss was already answering dies with it.
        for (const proj of this.projectiles) {
            proj.isDead = true;
        }
    }

    spawnBossAttack() {
        const isEpic = Math.random() > 0.5;
        const text = this.dictionary.getRandomWord(isEpic ? 'epic' : 'hard');

        const targetX = this.canvas.width / 2;
        const targetY = this.canvas.height;

        const voidWardActive = this.stats.selectedCharacter === 'voidweaver' && this.voidWardUntil > Date.now();
        const magicBullet = new Word(text, this.canvas.width, this.canvas.height,
            this.currentSpeedMultiplier * (voidWardActive ? 0.85 : 1), targetX, targetY,
            { isBossAttack: true });
        this.words.push(magicBullet);
    }

    endBossPhase() {
        this.stats.addScore(1000);
        this.isBossPhase = false;
        this.boss = null;
        this._bossSummonsCleared = false;
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

    /**
     * Shared run-end persistence (AT-L5 — extracted 2026-09-23 so every end
     * path — triggerGameOver, endDuel, and the unload bank — writes through
     * ONE place, exactly once). Contract: high score + WPM ring ONLY.
     * run_history stays arena-only (AT-M8 scope): logRunToSupabase is
     * deliberately NOT called here — triggerGameOver adds it for arena deaths.
     */
    finalizeRun() {
        if (this._runFinalised) return;
        this._runFinalised = true;
        this.stats.saveHighScore();
        this.stats.recordWpm(this.stats.getSessionWPM());
    }

    triggerGameOver() {
        this.stop();
        this.stats.updateHUD();
        this.finalizeRun();
        // AT-M4 fix (2026-08-24): the extra floor(score/10) XP grant that
        // lived here was removed. saveHighScore already converts 10% of
        // score to XP (+ Mage's Greed), matching the documented intent and
        // the duel path. Players were effectively earning ~20% per arena run
        // while duels paid 10%.
        // AT-L5/AT-M8: duels never write run_history (endDuel contract) —
        // forfeits that reach this function must not either.
        if (this.gameMode !== 'duel') {
            this.stats.logRunToSupabase('arena', this.stats.getSessionWPM(), this.stats.getAccuracy(), this.stats.score);
        }

        if (this.onGameOver) {
            this.onGameOver(this.stats);
        }
    }

    triggerBarrierBreakEffect() {
        const wizX = this.canvas.width / 2;
        const wizY = this.canvas.height;

        this.particles.push(new Particle(wizX, wizY - 15, 'shockwave_blue'));
        const shardColors = ['#00e5ff', '#ffd700', '#ffffff', '#29b6f6', '#d500f9'];
        for (let s = 0; s < 16; s++) {
            const sAngle = Math.PI + (s / 15) * Math.PI + (Math.random() - 0.5) * 0.3;
            const speed = 0.35 + Math.random() * 0.45;
            const shard = new Particle(
                wizX + Math.cos(sAngle) * 75,
                wizY - 15 + Math.sin(sAngle) * 75,
                {
                    type: 'glass_shard',
                    color: shardColors[s % shardColors.length],
                    vx: Math.cos(sAngle) * speed,
                    vy: Math.sin(sAngle) * speed - 0.15,
                    length: 8 + Math.random() * 8,
                    width: 3 + Math.random() * 3,
                    decay: 0.015 + Math.random() * 0.01
                }
            );
            this.particles.push(shard);
        }
    }

    /**
     * AT-F9 Phase 3: draw one arena mage in its fixed team slot — team aura
     * disc + name plate, both in the slot's team colour (A host blue / B
     * challenger red, identical on both clients). NOT mirrored (owner
     * decision): the sprite is procedural and symmetric, so flipping it only
     * flipped asymmetric details and implied a facing the two clients
     * disagreed on.
     */
    _drawTeamMage(x, animProgress, stats, teamColor, label) {
        const ctx = this.ctx;
        const y = this.canvas.height - 35;

        // Team aura under the feet — colour comes from the team SLOT
        // (A host blue / B challenger red), never from the local viewer, so
        // both clients paint the same mage the same colour (ArenaTeams.js).
        ctx.save();
        ctx.globalAlpha = 0.5;
        const aura = ctx.createRadialGradient(x, y + 6, 4, x, y + 6, 86);
        aura.addColorStop(0, teamColor);
        aura.addColorStop(1, 'rgba(0, 0, 0, 0)');
        ctx.fillStyle = aura;
        ctx.beginPath();
        ctx.ellipse(x, y + 6, 86, 26, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Sprite — deliberately NOT mirrored (owner decision, AT-F9 P3):
        // mirroring flipped asymmetric details (wand arm, cowl) and implied a
        // facing that differed between the two clients' screens.
        ctx.save();
        CharacterRenderer.draw(ctx, x, y, stats.selectedCharacter, animProgress, stats);
        ctx.restore();

        // Name plate
        ctx.save();
        ctx.font = 'bold 13px Cinzel, serif';
        ctx.fillStyle = teamColor;
        ctx.textAlign = 'center';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
        ctx.shadowBlur = 4;
        const plate = label.length > 14 ? label.slice(0, 13) + '…' : label;
        ctx.fillText(plate, x, this.canvas.height - 6);
        ctx.restore();
    }
}
