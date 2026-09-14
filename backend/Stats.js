import { supabase } from './supabaseClient.js';

export class Stats {
    constructor(achievements) {
        this.achievements = achievements;
        this.score = 0;
        this.keystrokes = 0;
        this.correctKeystrokes = 0;
        this.wordsTyped = 0;
        this.combo = 0;
        this.maxCombo = 0;
        this.mana = 0;
        this.maxMana = 100;
        this.startTime = null;

        this.lives = 4; // 3 barriers + 1 final hit on wizard

        // Rolling WPM: store timestamp of each correct keystroke
        this._keystrokeTimestamps = [];
        this._rollingWindowMs = 10000; // 10-second window

        this.bestScore = parseInt(localStorage.getItem('typerMaster_score') || '0', 10);
        this.bestWPM = parseInt(localStorage.getItem('typerMaster_wpm') || '0', 10);

        // --- RPG Elements ---
        this._totalXP = parseInt(localStorage.getItem('typerMaster_xp') || '0', 10);
        this._playerLevel = Math.floor(Math.sqrt(this._totalXP / 500)) + 1;
        this.unlockedSkills = JSON.parse(localStorage.getItem('typerMaster_skills') || '[]');
        this.wandColor = localStorage.getItem('typerMaster_wandColor') || '#ff00ff';
        this.mageName = localStorage.getItem('typerMaster_mageName') || null;
        let savedChar = localStorage.getItem('typerMaster_selectedCharacter');
        if (savedChar === 'gojo' || savedChar === 'sukuna') {
            savedChar = 'wizard';
            localStorage.setItem('typerMaster_selectedCharacter', 'wizard');
        }
        this.selectedCharacter = savedChar || 'wizard';

        // True only after a successful authenticated (non-guest) login.
        // Gates the admin bypass - see AuthUI. Never inferred from mageName alone.
        this.isAuthenticated = false;

        // Single source of truth for the admin override: Achievements defers
        // to Stats.isAdmin() so guests can never trigger it (Bug #1B fix).
        if (this.achievements) {
            this.achievements.adminPredicate = () => this.isAdmin();
        }

        this.bindDOM();
    }

    isAdmin() {
        // Restricted admin bypass (ROADMAP Bug #1B decision, 2026-08-24):
        // requires an authenticated non-guest session AND the exact mage
        // name "admin" (case-insensitive). Guests never qualify.
        if (!this.isAuthenticated || !this.mageName) return false;
        return this.mageName.toLowerCase().trim() === 'admin';
    }

    get totalXP() {
        if (this.isAdmin()) return 999999;
        return this._totalXP;
    }

    set totalXP(val) {
        this._totalXP = val;
    }

    get playerLevel() {
        if (this.isAdmin()) return 99;
        return this._playerLevel;
    }

    set playerLevel(val) {
        this._playerLevel = val;
    }

    bindDOM() {
        this.scoreEl = document.getElementById('score-display');
        this.comboEl = document.getElementById('combo-display');
        this.multiplierEl = document.getElementById('multiplier-display');
        this.manaFillEl = document.getElementById('mana-bar-fill');
        this.manaTextEl = document.getElementById('mana-text');
        this.manaHintEl = document.getElementById('mana-hint');
        this.wpmEl = document.getElementById('wpm-display');
        this.accEl = document.getElementById('acc-display');
        this.livesContainer = document.getElementById('lives-display');
    }

    reset() {
        this.score = 0;
        this.keystrokes = 0;
        this.correctKeystrokes = 0;
        this.wordsTyped = 0;

        // Passive: Starting Combo
        this.combo = this.hasSkill('combo') ? 10 : 0;

        this.mana = 0;

        // Passive: Max Mana
        this.maxMana = this.hasSkill('mana') ? 120 : 100;

        this.startTime = Date.now();

        // Passive: Extra Barrier
        this.lives = this.hasSkill('life') ? 5 : 4;

        this._keystrokeTimestamps = [];
        this.updateHUD();
        this.updateLivesDisplay();
    }

    recordStroke(isCorrect) {
        this.keystrokes++;
        if (isCorrect) {
            this.correctKeystrokes++;
            this.combo++;
            if (this.combo > this.maxCombo) this.maxCombo = this.combo;
            if (this.achievements) this.achievements.onEvent('combo_update', { combo: this.combo });
            // Record timestamp for rolling window calculation
            this._keystrokeTimestamps.push(Date.now());

            // Play milestone jingle when hitting a multiplier cut-off (10, 20, 30, 40, 50)
            if (this.combo === 10 || this.combo === 20 || this.combo === 30 || this.combo === 40 || this.combo === 50) {
                if (window.game && window.game.audio) {
                    window.game.audio.playComboSound(this.combo);
                }
            }
        } else {
            this.combo = 0;
        }
    }

    getComboMultiplier() {
        if (this.combo >= 50) return 4.0;
        if (this.combo >= 40) return 3.0;
        if (this.combo >= 30) return 2.5;
        if (this.combo >= 20) return 2.0;
        if (this.combo >= 10) return 1.5;
        return 1.0;
    }

    addScore(wordLength, grantMana = true, isPerfect = false) {
        const comboMultiplier = this.getComboMultiplier();
        let points = Math.floor(wordLength * 10 * comboMultiplier);

        // Pyromancer Focus Skill: +20% Score (which also dictates base XP gain)
        if (this.mageClass === 'Pyromancer') {
            points = Math.floor(points * 1.2);
        }

        this.score += points;
        this.wordsTyped++;

        if (this.achievements) {
            this.achievements.onEvent('score_update', { score: this.score });
        }

        // Philosopher's Focus Skill: +2 XP for perfectly typed words
        if (isPerfect && this.hasSkill('philosopher')) {
            this.addXP(2);
            // Spawn a small gold "+2 XP" particle? Handled silently here for now or we can let Game.js know.
        }

        // Add mana per word completed based on length
        if (grantMana && this.mana < this.maxMana) {
            this.mana = Math.min(this.maxMana, this.mana + wordLength * 2);
        }
    }

    useMana(amount) {
        if (this.mana >= amount) {
            this.mana -= amount;
            this.updateHUD();
            return true;
        }
        return false;
    }

    loseLife() {
        this.lives--;
        this.updateLivesDisplay();
        return this.lives <= 0;
    }

    getWPM() {
        const now = Date.now();
        const cutoff = now - this._rollingWindowMs;

        // Drop keystrokes older than the window
        this._keystrokeTimestamps = this._keystrokeTimestamps.filter(t => t >= cutoff);

        const countInWindow = this._keystrokeTimestamps.length;
        if (countInWindow === 0) return 0;

        // Determine the actual window span (from oldest timestamp to now)
        // This avoids inflating WPM at the very start of the game
        const oldest = this._keystrokeTimestamps[0];
        const windowSpanMs = Math.max(1000, now - oldest); // minimum 1s to avoid NaN/Infinity
        const windowSpanMin = windowSpanMs / 60000;

        // Standard WPM: keystrokes / 5 / minutes
        const wpm = Math.round((countInWindow / 5) / windowSpanMin);
        if (this.achievements && wpm > 0) {
            this.achievements.onEvent('wpm_update', { wpm, accuracy: this.getAccuracy() });
        }
        return wpm;
    }

    // Full-session WPM — used for leaderboard saving
    getSessionWPM() {
        if (!this.startTime || this.correctKeystrokes === 0) return 0;
        const minutesElapsed = (Date.now() - this.startTime) / 60000;
        return Math.round((this.correctKeystrokes / 5) / minutesElapsed);
    }

    getAccuracy() {
        if (this.keystrokes === 0) return 100;
        return Math.round((this.correctKeystrokes / this.keystrokes) * 100);
    }

    updateHUD() {
        if (!this.scoreEl) return;
        this.scoreEl.innerText = this.score;
        this.wpmEl.innerText = this.getWPM();
        this.accEl.innerText = this.getAccuracy() + '%';

        if (this.comboEl) {
            this.comboEl.innerText = this.combo;

            if (this.multiplierEl) {
                const mult = this.getComboMultiplier();
                this.multiplierEl.innerText = `x${mult.toFixed(1)}`;
                // Only fade the multiplier text in if it's > 1.0
                this.multiplierEl.style.opacity = mult > 1.0 ? '0.9' : '0';
            }

            if (this.combo >= 20) {
                this.comboEl.classList.add('high-combo');
            } else {
                this.comboEl.classList.remove('high-combo');
            }
        }

        if (this.manaFillEl && this.manaTextEl) {
            const manaPercent = (this.mana / this.maxMana) * 100;
            this.manaFillEl.style.width = manaPercent + '%';
            this.manaTextEl.innerText = `${this.mana} / ${this.maxMana}`;

            if (this.mana >= this.maxMana) {
                this.manaFillEl.classList.add('full');
                this.manaHintEl.classList.remove('hidden');
            } else {
                this.manaFillEl.classList.remove('full');
                this.manaHintEl.classList.add('hidden');
            }
        }
    }

    updateLivesDisplay() {
        if (!this.livesContainer) return;

        const expectedBarriers = this.hasSkill('life') ? 4 : 3;
        while (this.livesContainer.children.length < expectedBarriers) {
            const dot = document.createElement('span');
            dot.className = 'barrier';
            this.livesContainer.appendChild(dot);
        }
        while (this.livesContainer.children.length > expectedBarriers) {
            this.livesContainer.removeChild(this.livesContainer.lastChild);
        }

        const hearts = this.livesContainer.querySelectorAll('.barrier');
        hearts.forEach((heart, index) => {
            const isActive = index < (this.lives - 1);

            if (!isActive) {
                heart.classList.add('lost');
                heart.style.backgroundColor = 'transparent';
                heart.style.color = '';
                heart.style.boxShadow = 'none';
                heart.style.border = '1px solid rgba(255,255,255,0.15)';
            } else {
                heart.classList.remove('lost');
                // Default Wizard: clear inline styles so style.css nth-child classes govern
                heart.style.backgroundColor = '';
                heart.style.color = '';
                heart.style.boxShadow = '';
                heart.style.border = '';
            }
        });
    }

    saveHighScore() {
        // Use full-session WPM for leaderboard (more stable/fair)
        const finalWPM = this.getSessionWPM();
        if (this.score > this.bestScore) {
            this.bestScore = this.score;
            localStorage.setItem('typerMaster_score', this.bestScore);
        }
        if (finalWPM > this.bestWPM) {
            this.bestWPM = finalWPM;
            localStorage.setItem('typerMaster_wpm', this.bestWPM);
        }

        // Convert score to XP (10% of score becomes XP)
        let gainedXP = Math.floor(this.score * 0.1);

        // Mage's Greed Skill: +25% XP
        if (this.hasSkill('greed')) {
            gainedXP = Math.floor(gainedXP * 1.25);
        }

        if (gainedXP > 0) this.addXP(gainedXP);
    }

    // --- Run History Ring Buffer (feeds the profile WPM chart, AT-M2) ---
    recordWpm(wpm) {
        if (!wpm || wpm <= 0) return;
        let history = this.getWpmHistory();
        history.push(Math.round(wpm));
        if (history.length > 10) history = history.slice(-10);
        localStorage.setItem('typerMaster_wpmHistory', JSON.stringify(history));
    }

    getWpmHistory() {
        try {
            const parsed = JSON.parse(localStorage.getItem('typerMaster_wpmHistory') || '[]');
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            return [];
        }
    }

    // --- Progression Methods ---
    addXP(amount) {
        this.totalXP += amount;

        const oldLevel = this.playerLevel;
        // Canonical level curve (AT-M3): level = 1 + floor(sqrt(xp / 500)).
        // Matches the constructor, loadFromSupabase and getXPProgress.
        this.playerLevel = Math.floor(Math.sqrt(this.totalXP / 500)) + 1;

        if (this.playerLevel > oldLevel) {
            console.log(`[Stats] Level Up! You are now Level ${this.playerLevel}`);
            localStorage.setItem('typerMaster_level', this.playerLevel.toString());
            if (this.achievements) this.achievements.onEvent('level_up', { level: this.playerLevel });
        }

        this.saveProgression();
    }

    spendXP(amount) {
        if (this.totalXP >= amount) {
            this.totalXP -= amount;
            this.saveProgression();
            return true;
        }
        return false;
    }

    unlockSkill(skillId) {
        if (!this.unlockedSkills.includes(skillId)) {
            this.unlockedSkills.push(skillId);
            this.saveProgression();
            return true;
        }
        return false;
    }

    hasSkill(skillId) {
        if (this.isAdmin()) return true;
        return this.unlockedSkills.includes(skillId);
    }

    setWandColor(colorHex) {
        this.wandColor = colorHex;
        this.saveProgression();
    }

    setMageClass(className) {
        this.mageClass = className;
        this.saveProgression();
    }



    getXPProgress() {
        const currentLevelTarget = Math.pow(this.playerLevel - 1, 2) * 500;
        const nextLevelTarget = Math.pow(this.playerLevel, 2) * 500;
        const xpInCurrentLevel = this.totalXP - currentLevelTarget;
        const xpRequired = nextLevelTarget - currentLevelTarget;
        return Math.min(100, Math.max(0, (xpInCurrentLevel / xpRequired) * 100));
    }

    async logRunToSupabase(mode, wpm, accuracy, score) {
        if (!supabase) return;
        try {
            const { data: { session } } = await supabase.auth.getSession();
            if (!session || !session.user) return;

            const { error } = await supabase.from('run_history').insert([{
                user_id: session.user.id,
                mode: mode,
                wpm: wpm,
                accuracy: accuracy,
                score: score
            }]);

            if (error) {
                console.warn("[Stats] Error saving run to run_history:", error);
            } else {
                console.log(`[Stats] Saved run to run_history (${mode}, wpm:${wpm})`);
            }
        } catch (e) {
            console.warn("[Stats] Exception logging run to Supabase:", e);
        }
    }

    saveProgression() {
        localStorage.setItem('typerMaster_xp', this.totalXP.toString());
        localStorage.setItem('typerMaster_skills', JSON.stringify(this.unlockedSkills));
        localStorage.setItem('typerMaster_wandColor', this.wandColor);
        localStorage.setItem('typerMaster_mageClass', this.mageClass);
        if (this.mageName) {
            localStorage.setItem('typerMaster_mageName', this.mageName);
        }

        if (supabase) {
            supabase.auth.getSession().then(({ data: { session } }) => {
                if (session && session.user) {
                    supabase.from('profiles').upsert([{
                        id: session.user.id,
                        total_xp: this.totalXP,
                        player_level: this.playerLevel,
                        username: this.mageName || session.user.email.split('@')[0],
                        unlocked_skills: this.unlockedSkills,
                        wand_color: this.wandColor,
                        mage_class: this.mageClass,
                        best_score: this.bestScore,
                        best_wpm: this.bestWPM
                    }], { onConflict: 'id' }).then(({ error }) => {
                        if (error) {
                            // AT-L10 diagnostics: a bare console.warn of the error
                            // object hid the cause of the observed HTTP 400. Log
                            // every PostgREST field so the next occurrence names
                            // the failing column/constraint/policy directly.
                            console.warn("[Stats] Supabase profiles sync error:", {
                                message: error.message,
                                details: error.details,
                                hint: error.hint,
                                code: error.code
                            });
                        }
                    });
                }
            });
        }
    }

    loadFromSupabase(profile) {
        if (!profile) return;

        console.log("[Stats] Loading profile data from Supabase:", profile);
        this.totalXP = profile.total_xp || 0;
        this.playerLevel = profile.player_level || Math.floor(Math.sqrt(this.totalXP / 500)) + 1;

        if (profile.username) this.mageName = profile.username;
        if (profile.unlocked_skills) this.unlockedSkills = profile.unlocked_skills;
        if (profile.wand_color) this.wandColor = profile.wand_color;
        if (profile.mage_class) this.mageClass = profile.mage_class;
        if (profile.best_score && profile.best_score > this.bestScore) this.bestScore = profile.best_score;
        if (profile.best_wpm && profile.best_wpm > this.bestWPM) this.bestWPM = profile.best_wpm;

        // Save these backend values down to localStorage so guest sessions don't revert
        this.saveProgression();

        // Calculate dynamic properties
        this.lives = this.hasSkill('life') ? 5 : 4;
        this.maxMana = this.hasSkill('mana') ? 120 : 100;
        this.combo = this.hasSkill('combo') ? 10 : 0;
    }

    setSelectedCharacter(characterId) {
        this.selectedCharacter = characterId;
        localStorage.setItem('typerMaster_selectedCharacter', characterId);
        this.saveProgression();
    }

    isCharacterUnlocked(charId) {
        if (this.isAdmin()) return true;
        if (charId === 'wizard') return true;
        return false;
    }
}
