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
            'archmage_supremacy': { id: 'archmage_supremacy', name: 'Archmage Supremacy', description: 'Reach a 100x Combo streak or score 10,000+ points.', title: 'Grand Archon' }
        };
        
        // Callbacks for UI updates
        this.onUnlockCallback = null;
    }

    _save() {
        localStorage.setItem('typerMaster_achievements', JSON.stringify(Array.from(this.unlocked)));
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
