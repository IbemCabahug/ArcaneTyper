import { supabase } from './supabaseClient.js';
import { dbHealth, isMissingColumnError, isNetworkError, describeError } from './dbHealth.js';
import { syncQueue } from './syncQueue.js';
import { DEFAULT_MAGE_CLASS, normalizeMageClass, normalizeMageClassForCharacter, isMageClassForCharacter } from './MageClasses.js';
import { DEFAULT_CHARACTER, isCharacter, normalizeCharacter, characterInfo } from './Characters.js';

/** localStorage keys that belong to ONE mage account (purged on logout). */
const PROGRESSION_KEYS = [
    'typerMaster_xp',
    'typerMaster_skills',
    'typerMaster_wandColor',
    'typerMaster_mageClass',
    'typerMaster_mageName',
    'typerMaster_achievements',
    'typerMaster_equippedTitle',
    'typerMaster_selectedCharacter',
    'typerMaster_unlockedCharacters', // AT-F16: Forge skins bought with XP (local, like the selection itself)
    'typerMaster_score',
    'typerMaster_wpm',
    'typerMaster_bestStreak',
    'typerMaster_wpmHistory',
    'typerMaster_runHistory',
    'typerMaster_dailyCompleted',
    'typerMaster_level',
    'typerMaster_leaderboardSchema_v1',
    'typerMaster_lastRunBanked' // AT-M8 one-shot unload-bank flag (consumed at load)
];

/**
 * `profiles` columns, split by whether the live database actually has them.
 *
 * Verified 2026-09-23: only `core` existed. The extended columns are added by
 * supabase/migrations/20260923_arcanetyper_schema_repair.sql, and until that
 * runs a full-payload upsert is rejected wholesale (HTTP 400 / PGRST204) —
 * which is why NO cloud progress was ever saved. `_upsertProfile` therefore
 * retries with `core` only, so XP and level sync even on an unmigrated DB.
 * `null` = not discovered yet, `true` = extended columns present, `false` = core only.
 */
const PROFILE_CORE_COLUMNS = ['id', 'username', 'total_xp', 'player_level'];
let _profileExtendedSupported = null;

function readStoredJSON(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw === null || raw === '' || raw === 'undefined') return fallback;
        const parsed = JSON.parse(raw);
        return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
        console.warn(`[Stats] Could not parse ${key}, using the fallback.`, e);
        return fallback;
    }
}

/** AT-L10 diagnostics: name the failing column/constraint/policy, not just "error". */
function logProfileError(error) {
    console.warn("[Stats] Supabase profiles sync error:", {
        message: error && error.message,
        details: error && error.details,
        hint: error && error.hint,
        code: error && error.code
    });
}

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
        this.gameMode = 'classic';

        this.lives = 4; // 3 barriers + 1 final hit on wizard

        // Rolling WPM: store timestamp of each correct keystroke
        this._keystrokeTimestamps = [];
        this._rollingWindowMs = 10000; // 10-second window

        this.bestScore = parseInt(localStorage.getItem('typerMaster_score') || '0', 10);
        this.bestWPM = parseInt(localStorage.getItem('typerMaster_wpm') || '0', 10);
        this.bestStreak = parseInt(localStorage.getItem('typerMaster_bestStreak') || '0', 10);

        // --- RPG Elements ---
        this._totalXP = parseInt(localStorage.getItem('typerMaster_xp') || '0', 10);
        this._playerLevel = Math.floor(Math.sqrt(this._totalXP / 500)) + 1;
        this.unlockedSkills = readStoredJSON('typerMaster_skills', []);
        if (!Array.isArray(this.unlockedSkills)) this.unlockedSkills = [];
        this.wandColor = localStorage.getItem('typerMaster_wandColor') || '#ff00ff';
        // `mageClass` used to never be read back, so saveProgression persisted
        // the literal string "undefined" and every class bonus (Pyromancer
        // score, Cryomancer speed, Chronomancer's Survival Nova refund) vanished on reload.
        const storedClass = localStorage.getItem('typerMaster_mageClass');
        // AT-L8: normalised through MageClasses so a hand-edited/legacy value
        // ("Scholar", "undefined", a blank string) can never leave the class
        // undefined and silently disable every class effect.
        this.mageClass = normalizeMageClass(
            (storedClass && storedClass !== 'undefined' && storedClass !== 'null')
                ? storedClass
                : DEFAULT_MAGE_CLASS
        );
        this.mageName = localStorage.getItem('typerMaster_mageName') || null;
        // AT-F16: the selection is healed through the roster table itself, so a
        // hand-edited value — or an id from a retired roster (the pre-AT-L8
        // skins, named in the docs) — degrades to the default instead of
        // lingering as an id nothing can render. The healed value is written back.
        const storedChar = localStorage.getItem('typerMaster_selectedCharacter');
        this.selectedCharacter = normalizeCharacter(storedChar);
        if (storedChar && storedChar !== this.selectedCharacter) {
            localStorage.setItem('typerMaster_selectedCharacter', this.selectedCharacter);
        }
        this.mageClass = normalizeMageClassForCharacter(this.mageClass, this.selectedCharacter);
        // AT-F16: which Forge characters this account owns. Validated against the
        // roster on load (a hand-edited/corrupt list degrades to the default,
        // exactly like `mageClass`) — the default character is always owned.
        this.unlockedCharacters = readStoredJSON('typerMaster_unlockedCharacters', [DEFAULT_CHARACTER])
            .filter((id) => isCharacter(id));
        if (!this.unlockedCharacters.includes(DEFAULT_CHARACTER)) {
            this.unlockedCharacters.push(DEFAULT_CHARACTER);
        }

        // True only after a successful authenticated (non-guest) login.
        // Gates the admin bypass - see AuthUI. Never inferred from mageName alone.
        this.isAuthenticated = false;

        // Single source of truth for the admin override: Achievements defers
        // to Stats.isAdmin() so guests can never trigger it (Bug #1B fix).
        if (this.achievements) {
            this.achievements.adminPredicate = () => this.isAdmin();
        }

        this.bindDOM();

        // Offline outbox replays (backend/syncQueue.js).
        // The profile handler rebuilds its payload from LIVE state, so replaying
        // a queued snapshot can never roll back newer XP.
        syncQueue.register('profile', () => this._syncProfileNow());
        // 'run' items queued by the pagehide banker (AT-M8) carry no user_id —
        // an unload handler cannot await a session. Resolve it here, while the
        // page is alive; a sessionless replay is retryable so the outbox tries
        // again once the mage has signed in (and logout clears the queue
        // before another account could inherit the row).
        syncQueue.register('run', async (payload) => {
            if (payload && payload.user_id) return this._insertRun(payload);
            const session = await this._getSession();
            if (!session || !session.user) return { ok: false, retryable: true };
            return this._insertRun({ ...payload, user_id: session.user.id });
        });
    }

    isAdmin() {
        // Restricted admin bypass (ROADMAP Bug #1B decision, 2026-08-24):
        // requires an authenticated non-guest session AND the exact mage
        // name "admin" (case-insensitive). Guests never qualify.
        if (!this.isAuthenticated || !this.mageName) return false;
        return this.mageName.toLowerCase().trim() === 'admin';
    }

    /**
     * AT-M9: does this deployment still need a sealed Mage Card before the
     * entitlement menus (Workshop, Arena lobby, Forge) open?
     *
     * `main.js` used to answer that with `let isGuest = false` — a flag that
     * four guards read and NOTHING ever assigned, so all four were dead code: a
     * guest could buy Workshop upgrades and forge AT-F16's 12,000 XP character
     * out of local XP. This is the one predicate those gates call now, and it is
     * DERIVED from `isAuthenticated` (kept by AuthUI on password login,
     * registration and session restore, cleared on guest entry) instead of
     * cached in main.js — a second copy of auth state is exactly what went stale.
     *
     * `hasBackend === false` deliberately lets everyone through: with no
     * Supabase env there is no account to sign in as, so gating would lock a
     * developer out of features that have no cloud side to protect.
     *
     * @param {boolean} hasBackend true when a Supabase client exists
     * @returns {boolean} true when a guest must be prompted rather than let in
     */
    requiresMageCard(hasBackend) {
        return !!hasBackend && !this.isAuthenticated;
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
        // AT-F12: the live SPEED box is no longer in index.html, so this is null
        // in the real DOM. The binding stays because updateHUD() prints only
        // when the element exists — restoring the box must not require touching
        // the achievement path (see updateHUD).
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
        this.maxCombo = this.combo;

        this.mana = 0;

        // Passive: Max Mana
        this.maxMana = this.hasSkill('mana') ? 120 : 100;

        this.startTime = Date.now();

        // Character-specific Survival capacity. Arena HP is unrelated.
        this.lives = this.getSurvivalMaxLives();

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

            // Bloodseeker's Blood Oath restores one lost life at every
            // 25-combo milestone, up to the character's Survival capacity.
            const maxLives = this.getSurvivalMaxLives();
            if (this.gameMode !== 'duel' && this.selectedCharacter === 'bloodseeker' &&
                this.combo > 0 && this.combo % 25 === 0 && this.lives < maxLives) {
                this.lives++;
                this.updateLivesDisplay();
                if (typeof this.onBarrierRestored === 'function') this.onBarrierRestored(this.combo);
            }

            // Play milestone jingle when hitting a multiplier cut-off (10, 20, 30, 40, 50, and every 25 thereafter: 75, 100, 125, 150...)
            if (this.combo === 10 || this.combo === 20 || this.combo === 30 || this.combo === 40 || this.combo === 50 || (this.combo > 50 && this.combo % 25 === 0)) {
                if (window.game && window.game.audio) {
                    window.game.audio.playComboSound(this.combo);
                }
            }
        } else {
            this.combo = 0;
        }
    }

    getComboMultiplier() {
        if (this.combo >= 200) {
            const bonus = Math.floor((this.combo - 200) / 50) * 0.5;
            return Math.min(10.0, 7.0 + bonus);
        }
        if (this.combo >= 150) return 6.0;
        if (this.combo >= 100) return 5.0;
        if (this.combo >= 75) return 4.5;
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
    /**
     * Survival defense capacity. The Arena owns its own 100 HP separately.
     * Voidweaver uses three absorption charges (four with Life); Bloodseeker
     * uses three lives (four with Life); the Wizard keeps its historic 3+1
     * barrier/final-life split.
     */
    getSurvivalMaxLives() {
        if (this.selectedCharacter === 'voidweaver' || this.selectedCharacter === 'bloodseeker') {
            return this.hasSkill('life') ? 4 : 3;
        }
        return this.hasSkill('life') ? 5 : 4;
    }

    getSurvivalDefenseMode() {
        if (this.selectedCharacter === 'voidweaver') return 'absorption';
        if (this.selectedCharacter === 'bloodseeker') return 'lives';
        return 'barriers';
    }

    getSurvivalDefenseColor() {
        if (this.selectedCharacter === 'voidweaver') return '#00e5ff';
        if (this.selectedCharacter === 'bloodseeker') return '#ff1744';
        return '';
    }



    useMana(amount) {
        if (this.mana >= amount) {
            this.mana -= amount;
            this.updateHUD();
            return true;
        }
        return false;
    }

    /**
     * Add mana outside of `addScore`, clamped to the pool and repainted even
     * when already full. Kept as a shared Stats primitive for future mana
     * effects; the current Chronomancer Arena active spends mana without refunding.
     */
    refundMana(amount) {
        if (!(amount > 0)) return 0;
        const before = this.mana;
        this.mana = Math.min(this.maxMana, this.mana + amount);
        this.updateHUD();
        return this.mana - before;
    }

    loseLife() {
        this.lives--;
        this.updateLivesDisplay();
        return this.lives <= 0;
    }

    /**
     * Consume exactly one boss-damage defense charge for the equipped
     * character. This is deliberately separate from the legacy loseLife()
     * path: Wizard shields, Voidweaver absorptions, and Bloodseeker lives have
     * different display semantics even though they share the integer pool.
     */
    consumeSurvivalDefense() {
        const mode = this.getSurvivalDefenseMode();
        const before = this.lives;
        this.lives = Math.max(0, this.lives - 1);
        this.updateLivesDisplay();
        return {
            mode,
            before,
            after: this.lives,
            consumed: before > this.lives,
            depleted: this.lives === 0
        };
    }

    getWPM() {
        const now = Date.now();
        const cutoff = now - this._rollingWindowMs;

        // Drop keystrokes older than the window without allocating new arrays
        let firstValid = 0;
        while (firstValid < this._keystrokeTimestamps.length && this._keystrokeTimestamps[firstValid] < cutoff) {
            firstValid++;
        }
        if (firstValid > 0) {
            this._keystrokeTimestamps.splice(0, firstValid);
        }

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
        // AT-F12: compute, then print only if the box exists. getWPM() must run
        // either way — it fires `wpm_update`, which unlocks speed_demon
        // (Achievements.js), so guarding the CALL would silently break it.
        const wpm = this.getWPM();
        if (this.wpmEl) this.wpmEl.innerText = wpm;
        this.accEl.innerText = this.getAccuracy() + '%';

        if (this.comboEl) {
            this.comboEl.innerText = this.combo;

            if (this.multiplierEl) {
                const mult = this.getComboMultiplier();
                this.multiplierEl.innerText = `x${mult.toFixed(1)}`;
                // Only fade the multiplier text in if it's > 1.0
                this.multiplierEl.style.opacity = mult > 1.0 ? '0.9' : '0';
            }

            this.comboEl.classList.toggle('high-combo', this.combo >= 20 && this.combo < 50);
            this.comboEl.classList.toggle('epic-combo', this.combo >= 50 && this.combo < 100);
            this.comboEl.classList.toggle('ascendant-combo', this.combo >= 100);
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

        const expectedBarriers = this.getSurvivalMaxLives();
        const mode = this.getSurvivalDefenseMode();
        const defenseColor = this.getSurvivalDefenseColor();
        const label = typeof this.livesContainer.closest === 'function'
            ? this.livesContainer.closest('.stat-box')?.querySelector('.label')
            : null;
        if (label) label.textContent = mode === 'absorption' ? 'ABSORPTION' : mode === 'lives' ? 'LIVES' : 'BARRIERS';
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
            const isActive = mode === 'barriers'
                ? index < (this.lives - 1)
                : index < this.lives;

            if (!isActive) {
                heart.classList.add('lost');
                heart.style.backgroundColor = 'transparent';
                heart.style.color = defenseColor || '';
                heart.style.boxShadow = 'none';
                heart.style.border = `1px solid ${defenseColor || 'rgba(255,255,255,0.15)'}`;
            } else {
                heart.classList.remove('lost');
                if (defenseColor) {
                    // Voidweaver absorption and Bloodseeker lives each use one
                    // stable character color instead of the Wizard's per-ring
                    // barrier palette.
                    heart.style.backgroundColor = defenseColor;
                    heart.style.color = defenseColor;
                    heart.style.boxShadow = `0 0 10px ${defenseColor}`;
                    heart.style.border = `1px solid ${defenseColor}`;
                } else {
                    // Default Wizard: clear inline styles so style.css nth-child
                    // classes govern the historic barrier palette.
                    heart.style.backgroundColor = '';
                    heart.style.color = '';
                    heart.style.boxShadow = '';
                    heart.style.border = '';
                }
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
        if (this.maxCombo > this.bestStreak) {
            this.bestStreak = this.maxCombo;
            localStorage.setItem('typerMaster_bestStreak', this.bestStreak.toString());
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

    /**
     * Set the mage Discipline (AT-L8). Validated against `MageClasses.js` so the
     * stored/cloud value is always canonical; an unknown id is refused (the
     * current class survives) instead of poisoning the profile column.
     * @returns {boolean} true when the class actually changed
     */
    setMageClass(className) {
        const chosen = normalizeMageClass(className);
        if (!isMageClassForCharacter(chosen, this.selectedCharacter) || chosen === this.mageClass) return false;
        this.mageClass = chosen;
        this.saveProgression();
        return true;
    }

    /**
     * Sets the display name from an AUTHORITATIVE source (auth metadata, the
     * cloud profile, or the email prefix) and persists it.
     *
     * Before 2026-09-23 the name was only ever read from localStorage, so a
     * second account on the same browser kept showing the first mage's name —
     * which is what made the dashboard read "Anonymous Mage" for everyone.
     */
    setMageName(name) {
        const clean = (name || '').trim();
        if (!clean) return false;
        this.mageName = clean;
        localStorage.setItem('typerMaster_mageName', clean);
        return true;
    }



    getXPProgress() {
        const currentLevelTarget = Math.pow(this.playerLevel - 1, 2) * 500;
        const nextLevelTarget = Math.pow(this.playerLevel, 2) * 500;
        const xpInCurrentLevel = this.totalXP - currentLevelTarget;
        const xpRequired = nextLevelTarget - currentLevelTarget;
        return Math.min(100, Math.max(0, (xpInCurrentLevel / xpRequired) * 100));
    }

    /**
     * Records a finished run locally (always) and in `run_history` (when a
     * session exists). The local copy feeds the profile's Recent Runs panel and
     * is the fallback when the cloud copy is unavailable or RLS-blocked —
     * `run_history` was completely empty on 2026-09-23, which is why the account
     * had no score history at all.
     */
    async logRunToSupabase(mode, wpm, accuracy, score) {
        this.recordRun({ mode, wpm, accuracy, score });

        if (!supabase) return { ok: false, skipped: true };

        const session = await this._getSession();
        if (!session || !session.user) return { ok: false, skipped: true };

        const payload = {
            user_id: session.user.id,
            mode: mode,
            wpm: wpm,
            accuracy: accuracy,
            score: score
        };

        const res = await this._insertRun(payload);
        if (!res.ok && res.retryable) {
            // AT-M8: the 'run' replay handler existed but NOTHING ever
            // enqueued for it — a transport failure at the instant of death
            // lost the row. Queue it; replay delivers once the project is
            // reachable again.
            syncQueue.enqueue('run', payload);
            return { ok: false, queued: true };
        }
        return res;
    }

    /**
     * Queues a run for `run_history` WITHOUT touching the network — called
     * from the pagehide banker (AT-M8), where awaiting a session would never
     * resolve. Carries no `user_id`: the 'run' replay handler fills it in at
     * replay time. The local ring buffer is written separately by the caller,
     * so guests get their local history exactly as on a normal game over.
     */
    queueAbandonedRun(mode, wpm, accuracy, score) {
        if (!supabase) return;
        syncQueue.enqueue('run', { mode, wpm, accuracy, score });
        this.queueProfileInsurance();
    }

    /**
     * Outbox insurance for saveHighScore()'s cloud half: during pagehide the
     * async profile upsert may never settle, so queue the deduped snapshot
     * SYNCHRONOUSLY. Replay rebuilds it from live state, so it can never roll
     * back newer XP (see the 'profile' handler above). Also called by the duel
     * branch of the unload banker, which writes no run row (AT-L5 parity).
     */
    queueProfileInsurance() {
        if (!supabase) return;
        syncQueue.enqueue('profile', { at: Date.now() }, 'self');
    }

    /** Single run_history insert. Also the outbox replay handler for `run`. */
    async _insertRun(payload) {
        if (!supabase) return { ok: false, retryable: false };

        const { error } = await supabase.from('run_history').insert([payload]);

        if (!error) {
            dbHealth.reportSuccess();
            console.log(`[Stats] Saved run to run_history (${payload.mode}, wpm:${payload.wpm})`);
            return { ok: true };
        }

        dbHealth.reportFailure(error, 'run_history insert');
        console.warn("[Stats] Error saving run to run_history:", describeError(error));
        // Transport-level failures (no SQLSTATE) queue, and so does 42501
        // (RLS denial): replaying after the policy is repaired recovers the
        // run, and the outbox's attempt cap drains it cleanly if the denial
        // is permanent. Any other SQLSTATE (constraint, missing column) is
        // genuinely irreparable — replaying it would change nothing.
        const code = error.code ? String(error.code) : '';
        return { ok: false, retryable: isNetworkError(error) || !error.code || code === '42501' };
    }

    /** Appends to the local ring buffer (last 20 runs) used by the profile UI. */
    recordRun(run) {
        if (!run) return null;
        const entry = {
            mode: run.mode || 'arena',
            wpm: Math.round(run.wpm || 0),
            accuracy: Math.round(run.accuracy || 0),
            score: Math.round(run.score || 0),
            created_at: run.created_at || new Date().toISOString()
        };

        let history = readStoredJSON('typerMaster_runHistory', []);
        if (!Array.isArray(history)) history = [];
        history.push(entry);
        if (history.length > 20) history = history.slice(-20);
        try {
            localStorage.setItem('typerMaster_runHistory', JSON.stringify(history));
        } catch (e) {
            console.warn('[Stats] Could not persist the local run history:', e);
        }
        return entry;
    }

    /**
     * Most recent runs, newest first. Cloud rows when available, otherwise the
     * local buffer (so guests and a paused database both still show a history).
     */
    async getRunHistory(limit = 5) {
        const stored = readStoredJSON('typerMaster_runHistory', []);
        const local = Array.isArray(stored) ? stored.slice(-limit).reverse() : [];

        if (!supabase) return local;

        const session = await this._getSession();
        if (!session || !session.user) return local;

        const { data, error } = await supabase
            .from('run_history')
            .select('mode, wpm, accuracy, score, created_at')
            .eq('user_id', session.user.id)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            dbHealth.reportFailure(error, 'run_history select');
            console.warn('[Stats] run_history read failed, showing local runs:', describeError(error));
            return local;
        }

        dbHealth.reportSuccess();
        const remote = data || [];
        return remote.length > 0 ? remote : local;
    }

    /**
     * Clears every localStorage key that belongs to the signed-in mage.
     * Used on logout: without this, the next account on the same browser
     * inherited the previous mage's name (and its leaderboard identity),
     * best streak and daily-reward flag.
     */
    clearLocalProgression() {
        PROGRESSION_KEYS.forEach(key => {
            try {
                localStorage.removeItem(key);
            } catch (e) { /* ignore */ }
        });
        // The outbox holds writes for the account that is leaving, and the local
        // Hall of Fame cache is a per-browser artifact — neither should leak.
        syncQueue.clear();
        try {
            localStorage.removeItem('typermaster_hall_of_fame_v2');
        } catch (e) { /* ignore */ }
    }

    /**
     * Persists progression to localStorage (synchronously, so nothing is ever
     * lost) and then to Supabase (awaited, with a degraded payload + outbox).
     *
     * Callers may ignore the returned promise; every failure is handled inside.
     * @returns {Promise<{ok:boolean, skipped?:boolean, queued?:boolean}>}
     */
    async saveProgression() {
        this._writeLocalProgression();
        return this._syncProfileNow();
    }

    /** localStorage half of saveProgression (synchronous — never loses a write). */
    _writeLocalProgression() {
        localStorage.setItem('typerMaster_xp', this.totalXP.toString());
        localStorage.setItem('typerMaster_skills', JSON.stringify(this.unlockedSkills));
        localStorage.setItem('typerMaster_unlockedCharacters', JSON.stringify(this.unlockedCharacters));
        localStorage.setItem('typerMaster_wandColor', this.wandColor);
        localStorage.setItem('typerMaster_mageClass', this.mageClass || 'Novice');
        if (this.mageName) {
            localStorage.setItem('typerMaster_mageName', this.mageName);
        }
    }

    /**
     * Pushes the current profile to Supabase. No-op without an authenticated
     * session (guests never reach the network — see docs/backend-and-data.md §3).
     */
    async _syncProfileNow() {
        if (!supabase) return { ok: true, skipped: true };

        const session = await this._getSession();
        if (!session || !session.user) return { ok: true, skipped: true };

        const payload = this._buildProfilePayload(session.user);
        const res = await this._upsertProfile(payload);

        if (!res.ok && res.retryable) {
            // Deduped: profile state is a full snapshot, only the latest matters.
            syncQueue.enqueue('profile', { at: Date.now() }, 'self');
            return { ok: false, queued: true };
        }
        return res;
    }

    async _getSession() {
        try {
            const { data } = await supabase.auth.getSession();
            return data && data.session ? data.session : null;
        } catch (e) {
            console.warn('[Stats] Could not read the auth session:', describeError(e));
            return null;
        }
    }

    _buildProfilePayload(user) {
        return {
            id: user.id,
            username: this.mageName || (user.email ? user.email.split('@')[0] : 'Anonymous Mage'),
            total_xp: this.totalXP,
            player_level: this.playerLevel,
            unlocked_skills: this.unlockedSkills,
            wand_color: this.wandColor,
            mage_class: this.mageClass || DEFAULT_MAGE_CLASS,
            best_score: this.bestScore,
            best_wpm: this.bestWPM
        };
    }

    /**
     * Upserts one profile row, degrading to the columns the live schema has.
     * @returns {Promise<{ok:boolean, retryable?:boolean}>}
     */
    async _upsertProfile(payload) {
        if (!supabase) return { ok: false, retryable: false };

        const attempt = (body) => supabase.from('profiles').upsert([body], { onConflict: 'id' });

        const includeExtended = _profileExtendedSupported !== false;
        const body = includeExtended
            ? payload
            : Object.fromEntries(PROFILE_CORE_COLUMNS
                .filter(col => col in payload)
                .map(col => [col, payload[col]]));

        const { error } = await attempt(body);

        if (!error) {
            _profileExtendedSupported = includeExtended;
            dbHealth.reportSuccess();
            return { ok: true };
        }

        if (isMissingColumnError(error)) {
            dbHealth.noteSchema('profiles upsert', describeError(error));
            if (includeExtended) {
                _profileExtendedSupported = false;
                console.warn('[Stats] profiles is missing progression columns — retrying with ' +
                    PROFILE_CORE_COLUMNS.join(', ') + '. ' +
                    'Apply supabase/migrations/20260923_arcanetyper_schema_repair.sql');
                return this._upsertProfile(payload);
            }
            logProfileError(error);
            return { ok: false, retryable: false };
        }

        dbHealth.reportFailure(error, 'profiles upsert');
        logProfileError(error);
        // No SQLSTATE code means the request never reached Postgres → replay it.
        return { ok: false, retryable: isNetworkError(error) || !error.code };
    }

    loadFromSupabase(profile) {
        if (!profile) return;

        console.log("[Stats] Loading profile data from Supabase:", profile);
        this.totalXP = profile.total_xp || 0;
        this.playerLevel = profile.player_level || Math.floor(Math.sqrt(this.totalXP / 500)) + 1;

        if (profile.username) this.mageName = profile.username;
        if (profile.unlocked_skills) this.unlockedSkills = profile.unlocked_skills;
        if (profile.wand_color) this.wandColor = profile.wand_color;
        this.mageClass = normalizeMageClassForCharacter(this.mageClass, this.selectedCharacter);
        if (profile.mage_class) this.mageClass = normalizeMageClassForCharacter(profile.mage_class, this.selectedCharacter);
        if (profile.best_score && profile.best_score > this.bestScore) this.bestScore = profile.best_score;
        if (profile.best_wpm && profile.best_wpm > this.bestWPM) this.bestWPM = profile.best_wpm;

        // Mirror the cloud values into localStorage so an offline load or a
        // guest session does not revert them. The network write happens in the
        // caller AFTER the display name has been resolved (AuthUI), so we never
        // upsert a half-applied identity.
        this._writeLocalProgression();

        // Character-specific defense capacity is authoritative after the
        // selected character and Workshop skills have been loaded.
        this.lives = this.getSurvivalMaxLives();
        this.maxMana = this.hasSkill('mana') ? 120 : 100;
        this.combo = this.hasSkill('combo') ? 10 : 0;
    }

    isCharacterUnlocked(charId) {
        if (this.isAdmin()) return true;
        if (!isCharacter(charId)) return false;
        if (charId === DEFAULT_CHARACTER) return true;
        return this.unlockedCharacters.includes(charId);
    }

    /**
     * AT-F16: buy a Forge character. The PRICE comes from `Characters.js` — never
     * from the card — and the spend is the Workshop's own `spendXP` rule
     * (deductive, one save for the XP, one for the roster), so a skin costs the
     * same economy the talent nodes do.
     * @returns {boolean} true only when this call actually bought it
     */
    purchaseCharacter(characterId) {
        const id = normalizeCharacter(characterId);
        if (this.isCharacterUnlocked(id)) return false;   // admin/default/owned
        const { unlockPrice } = characterInfo(id);
        if (unlockPrice > 0 && !this.spendXP(unlockPrice)) return false;
        this.unlockedCharacters.push(id);
        this.saveProgression();
        return true;
    }

    /**
     * Equip a character. Refuses anything this account does not own, so a
     * stale/edited `selectedCharacter` can never dress a player in a locked
     * skin (the Forge click path checks first; this is the belt-and-braces).
     * @returns {boolean} true when the selection changed
     */
    setSelectedCharacter(characterId) {
        const id = normalizeCharacter(characterId);
        if (!this.isCharacterUnlocked(id) || id === this.selectedCharacter) return false;
        this.selectedCharacter = id;
        this.mageClass = normalizeMageClassForCharacter(this.mageClass, id);
        localStorage.setItem('typerMaster_selectedCharacter', id);
        this.saveProgression();
        return true;
    }
}
