export class Achievements {
    constructor(audioController) {
        this.audio = audioController;
        this.unlocked = new Set();

        // Load from local storage for now (Sync to Supabase later if requested)
        const saved = localStorage.getItem('typerMaster_achievements');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                parsed.forEach(id => this.unlocked.add(id));
            } catch (e) {
                console.error("Failed to parse achievements", e);
            }
        }

        // Admin override predicate. Stats binds this to its restricted
        // isAdmin() check once constructed (ROADMAP Bug #1B decision):
        // authenticated non-guest session with the exact mage name "admin".
        // Defaults to false so a bare Achievements instance never bypasses.
        this.adminPredicate = () => false;

        // Achievement definitions
        this.definitions = {
            'first_blood': { id: 'first_blood', name: 'First Blood', description: 'Type your first word.', title: 'Apprentice' },
            'speed_demon': { id: 'speed_demon', name: 'Speed Demon', description: 'Reach 100 WPM.', title: 'Speedcaster' },
            'untouchable': { id: 'untouchable', name: 'Untouchable', description: 'Reach a 50x Combo streak.', title: 'The Undefeated' },
            'boss_slayer': { id: 'boss_slayer', name: 'Boss Slayer', description: 'Defeat your first Boss.', title: 'Dragonbane' },
            'millionaire': { id: 'millionaire', name: 'Archmage', description: 'Reach Level 10.', title: 'Archmage' },
            'survivor': { id: 'survivor', name: 'Survivor', description: 'Survive for 5 minutes in a single run.', title: 'The Enduring' },
            'celestial_focus': { id: 'celestial_focus', name: 'Celestial Focus', description: 'Reach 100+ WPM with 95%+ accuracy.', title: 'Chrono-Transcendent' },
            'archmage_supremacy': { id: 'archmage_supremacy', name: 'Archmage Supremacy', description: 'Reach a 100x Combo streak or score 10,000+ points.', title: 'Grand Archon' },

            // ── Secret counter achievements ──────────────────────────────────
            // A `counter` definition is the first achievement that must
            // ACCUMULATE state across many separate runs; every other entry is
            // a stateless boolean decided from live values. The count lives in
            // its own storage key (see `progress` below) and is owned here so
            // the unlock rules stay in one place.
            //
            // UNLOCKS THE VOIDWEAVER. The condition is deliberately secret: the
            // locked card shows the bare count (n/10) and nothing else, so the
            // only clue a player has is the number climbing after a boss dies.
            'the_unspoken': {
                id: 'the_unspoken',
                name: 'The Unspoken',
                description: 'Defeat ten Bosses without ever casting the Supernova.',
                title: 'The Unspoken',
                // No `description` on the card while locked — the renderer prints
                // the counter instead. Kept here for the unlock toast.
                secret: true,
                counter: { key: 'bossKillsNoSupernova', goal: 10 }
            },

            // UNLOCKS THE BLOODSEEKER (owner decision 2026-09-26).
            //
            // This route REPLACED an earlier idea — unlock by dying in Survival
            // without typing a single word. That condition punished the exact
            // behaviour the game asks for: a mage who refuses to sit idle and
            // die is the mage the game wants, and the reward told them the
            // opposite. The counter is also the only handle a player has on it:
            // at 100 duels the number moves once per real match, so a stuck
            // 0/100 is a visible, reportable bug rather than a silent one.
            //
            // Secret like `the_unspoken`: while locked the card prints the bare
            // n/100 and nothing else, so the only clue is the count climbing
            // after a duel is won.
            'the_bloodied_standard': {
                id: 'the_bloodied_standard',
                name: 'The Bloodied Standard',
                description: 'Win one hundred duels in the Arena.',
                title: 'Bloodletter',
                secret: true,
                counter: { key: 'pvpWins', goal: 100 }
            }
        };

        // Persisted counter values, e.g. { bossKillsNoSupernova: 3 }. Kept
        // separate from `unlocked` (an id Set): a partially-completed
        // achievement must survive a reload, and an id Set cannot hold a
        // partial. Guarded like the rest of the storage layer, and a corrupt
        // value degrades to 0 rather than throwing.
        this.progress = {};
        try {
            const raw = localStorage.getItem('typerMaster_achievementProgress');
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    this.progress = parsed;
                }
            }
        } catch (e) {
            console.error("Failed to parse achievement progress", e);
        }

        // ── Reconcile a completed counter back into the unlocked set ─────────
        // Bug found 2026-09-26, and it is a PERMANENT soft-lock.
        //
        // `backend/Stats.js` PROGRESSION_KEYS purged `typerMaster_achievements`
        // on logout but never listed `typerMaster_achievementProgress`, so
        // signing out deleted the unlocked FLAG while keeping the COUNTER. On
        // the next sign-in the two disagreed: the card read a completed
        // 100/100 (or 10/10) while the achievement was locked again — and it
        // could never be re-earned, because `bumpProgress` clamps at the goal,
        // so `next === before` returns false forever. The player owned nothing
        // and had no way back. Affected `the_unspoken` (the Voidweaver) long
        // before this date; the Bloodseeker route inherited it at 100 duels.
        //
        // The counter is the source of truth for a counter achievement, so a
        // finished counter re-derives its own unlock. Self-healing, no schema
        // migration — and the same rule is what repairs a cloud snapshot that
        // arrives with a completed count but no flag (see `mergeCloudState`).
        //
        // Deliberately does NOT re-persist: `_save` is left to the next real
        // write, so merely opening the page cannot resurrect a flag the moment a
        // player signs out. It repairs on the next legitimate write.
        this._reconcileCounters();

        // Callbacks for UI updates
        this.onUnlockCallback = null;
        // Fired whenever the unlocked Set or the counters change, so the owner
        // (Stats) can push the new state to the cloud. Without it an achievement
        // earned on this device sits in localStorage until some unrelated
        // `saveProgression()` happens to fire — and the 100-duel route can be
        // earned with no XP spent at all, so nothing else would ever trigger one.
        this.onChange = null;
    }

    /**
     * Re-derive the unlock of any counter achievement whose count has reached its
     * goal but whose flag is missing. Idempotent, and a no-op on a healthy
     * profile — it only ever ADDS an id.
     */
    _reconcileCounters() {
        for (const [id, def] of Object.entries(this.definitions)) {
            if (def?.counter && !this.unlocked.has(id) && this.getProgress(id) >= def.counter.goal) {
                this.unlocked.add(id);
            }
        }
    }

    /**
     * The full achievement state as plain data, for the cloud.
     *
     * Achievements were the only progression that never left the browser
     * (`typerMaster_achievements` / `typerMaster_achievementProgress` were
     * localStorage-only), so a 100-duel grind to the Bloodseeker was lost on
     * sign-out and on any device change. `Stats._buildProfilePayload` reads this
     * to fill `profiles.unlocked_achievements` / `.achievement_progress`.
     *
     * Snapshots rather than live references: the payload is handed to an async
     * upsert, and passing `this.unlocked` / `this.progress` would let a later
     * mutation change the body after it was queued.
     */
    toCloudState() {
        return {
            unlocked_achievements: Array.from(this.unlocked),
            achievement_progress: { ...this.progress }
        };
    }

    /**
     * Merge a cloud snapshot in; returns true when anything actually changed.
     *
     * MERGES rather than assigns, which is the opposite of how `unlocked_skills`
     * loads. Both these keys are in `PROGRESSION_KEYS` and are purged on sign-out,
     * so for a returning mage the cloud is the only source — but a signed-in mage
     * who has been offline holds real local progress that a plain assignment would
     * overwrite with a stale snapshot. Union + per-key max are monotone and
     * idempotent: replaying them, applying the same snapshot twice, or merging out
     * of order can only ever ADD progress, never destroy it.
     *
     * A cloud counter at or above the goal also re-derives its unlock, so a
     * snapshot from a device whose flag was lost still restores the Bloodseeker
     * instead of parking the card at 100/100.
     */
    mergeCloudState(snapshot) {
        if (!snapshot || typeof snapshot !== 'object') return false;
        let changed = false;

        const ids = Array.isArray(snapshot.unlocked_achievements) ? snapshot.unlocked_achievements : [];
        for (const id of ids) {
            // An unknown id is dropped, not stored: the unlocked Set feeds the
            // Forge and the Trophy Room, and an undefined definition would render
            // a blank card forever.
            if (this.definitions[id] && !this.unlocked.has(id)) {
                this.unlocked.add(id);
                changed = true;
            }
        }

        const progress = snapshot.achievement_progress;
        if (progress && typeof progress === 'object' && !Array.isArray(progress)) {
            for (const [key, raw] of Object.entries(progress)) {
                const goal = this.goalForKey(key);
                // Only keys a real counter declares, and junk degrades exactly as
                // the localStorage loader does.
                if (!goal) continue;
                const incoming = Number(raw);
                if (!Number.isFinite(incoming) || incoming < 0) continue;
                const current = Number(this.progress[key]) || 0;
                const next = Math.min(Math.floor(Math.max(current, incoming)), goal);
                if (next !== current) { this.progress[key] = next; changed = true; }
            }
        }

        if (!changed) return false;
        this._save();
        this._saveProgress();
        // A merged snapshot can complete a counter whose flag was missing — the
        // very case the reconciliation exists for — so re-run it now and let the
        // character unlock in this load rather than the next one.
        this._reconcileCounters();
        return true;
    }

    /** The declared goal for a counter key, or 0 when the key is unknown. */
    goalForKey(key) {
        const def = Object.values(this.definitions).find((d) => d?.counter && d.counter.key === key);
        return def ? def.counter.goal : 0;
    }

    _save() {
        localStorage.setItem('typerMaster_achievements', JSON.stringify(Array.from(this.unlocked)));
        if (typeof this.onChange === 'function') this.onChange();
    }

    _saveProgress() {
        localStorage.setItem('typerMaster_achievementProgress', JSON.stringify(this.progress));
        if (typeof this.onChange === 'function') this.onChange();
    }

    /**
     * Current value of a counter achievement, clamped to its goal.
     * Returns 0 for anything that is not a counter, so callers never have to
     * guard the shape themselves.
     */
    getProgress(achievementId) {
        const def = this.definitions[achievementId];
        if (!def || !def.counter) return 0;
        const raw = Number(this.progress[def.counter.key]);
        if (!Number.isFinite(raw) || raw < 0) return 0;
        return Math.min(Math.floor(raw), def.counter.goal);
    }

    /**
     * Advance a counter achievement and unlock it on reaching the goal.
     * Idempotent at the cap: a 11th qualifying kill does not push the saved
     * value past the goal, so the stored number always reads as a real
     * 0..goal range rather than drifting.
     * @returns {boolean} true only when THIS call crossed the threshold
     */
    bumpProgress(achievementId, amount = 1) {
        const def = this.definitions[achievementId];
        if (!def || !def.counter) return false;
        if (this.unlocked.has(achievementId)) return false;

        const next = Math.min(this.getProgress(achievementId) + Math.max(0, Math.floor(amount)), def.counter.goal);
        const before = this.getProgress(achievementId);
        if (next === before) return false;

        this.progress[def.counter.key] = next;
        this._saveProgress();
        if (next >= def.counter.goal) {
            this.checkUnlock(achievementId);
            return true;
        }
        return false;
    }

    onEvent(eventName, data) {
        if (eventName === 'word_typed') {
            this.checkUnlock('first_blood');
        } else if (eventName === 'wpm_update') {
            if (data.wpm >= 100) {
                this.checkUnlock('speed_demon');
                if (data.accuracy >= 95) {
                    this.checkUnlock('celestial_focus');
                }
            }
        } else if (eventName === 'combo_update') {
            if (data.combo >= 50) this.checkUnlock('untouchable');
            if (data.combo >= 100) this.checkUnlock('archmage_supremacy');
        } else if (eventName === 'score_update') {
            if (data.score >= 10000) this.checkUnlock('archmage_supremacy');
        } else if (eventName === 'boss_defeated') {
            this.checkUnlock('boss_slayer');
        } else if (eventName === 'level_up') {
            if (data.level >= 10) this.checkUnlock('millionaire');
        } else if (eventName === 'time_survived') {
            if (data.time >= 300) this.checkUnlock('survivor'); // 300 seconds = 5 mins
        }
    }

    checkUnlock(achievementId) {
        if (!this.unlocked.has(achievementId) && this.definitions[achievementId]) {
            this.unlocked.add(achievementId);
            this._save();
            
            const def = this.definitions[achievementId];
            if (this.audio) this.audio.playSound('tada'); // Assumes a triumph sound exists
            
            if (this.onUnlockCallback) {
                this.onUnlockCallback(def);
            }
            
            console.log(`Unlocked Achievement: ${def.name}! You earned the title: ${def.title}`);
        }
    }

    getUnlockedTitles() {
        if (this.adminPredicate()) {
            return Object.values(this.definitions).map(def => def.title);
        }
        return Array.from(this.unlocked).map(id => this.definitions[id].title);
    }

    getUnlockedAchievements() {
        if (this.adminPredicate()) {
            return Object.values(this.definitions);
        }
        return Array.from(this.unlocked).map(id => this.definitions[id]);
    }
}
