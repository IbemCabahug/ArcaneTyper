import { supabase } from './supabaseClient.js';

const LOCAL_KEY = 'typermaster_hall_of_fame_v2';

export class Leaderboard {
    constructor() {
        this._local = this._loadLocal();
    }

    // ─── Local Storage Helpers ──────────────────────────────────────────────

    _emptyTemplate() {
        return {
            easy: { score: [], wpm: [], accuracy: [], streak: [] },
            normal: { score: [], wpm: [], accuracy: [], streak: [] },
            hard: { score: [], wpm: [], accuracy: [], streak: [] },
            hell: { score: [], wpm: [], accuracy: [], streak: [] },
            scribe: { score: [], wpm: [], accuracy: [], streak: [] }
        };
    }

    _loadLocal() {
        try {
            const stored = localStorage.getItem(LOCAL_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed && parsed.easy) {
                    ['easy', 'normal', 'hard', 'hell', 'scribe'].forEach(diff => {
                        if (!parsed[diff]) parsed[diff] = { score: [], wpm: [], accuracy: [], streak: [] };
                        if (!parsed[diff].streak) parsed[diff].streak = [];
                    });
                    return parsed;
                }
            }
        } catch (e) { /* ignore */ }
        return this._emptyTemplate();
    }

    _saveLocal() {
        try {
            localStorage.setItem(LOCAL_KEY, JSON.stringify(this._local));
        } catch (e) { /* ignore */ }
    }

    _pushToLocal(difficulty, entry) {
        const d = this._local[difficulty];
        if (!d) return;

        entry.streak = entry.streak || 0;

        // Deduplicate by name: keep only the best entry per player per category
        const dedupe = (list, field) => {
            const existing = list.findIndex(e => e.name === entry.name);
            if (existing !== -1) {
                if (entry[field] > list[existing][field]) {
                    list.splice(existing, 1); // Remove old — will re-insert below
                } else {
                    return; // Existing entry is better, skip
                }
            }
            list.push({ ...entry });
            list.sort((a, b) => b[field] - a[field]);
            if (list.length > 10) list.pop();
        };

        dedupe(d.score, 'score');
        dedupe(d.wpm, 'wpm');
        if (entry.score > 500) dedupe(d.accuracy, 'accuracy');
        if (entry.streak > 0) dedupe(d.streak, 'streak');

        this._saveLocal();
    }

    // ─── Public API (all async) ─────────────────────────────────────────────

    /**
     * Returns top 10 entries for a given difficulty, sorted by the given category field.
     * 1 row per player — no duplicates.
     */
    async getTopScores(difficulty, category) {
        if (supabase) {
            try {
                const { data, error } = await supabase
                    .from('leaderboard')
                    .select('name, score, wpm, accuracy, streak, created_at')
                    .eq('difficulty', difficulty)
                    .order(category, { ascending: false })
                    .limit(10);

                if (!error && data) return data;
                if (error) console.warn('[Leaderboard] Supabase getTopScores error, trying fallback:', error.message);
            } catch (e) {
                console.warn('[Leaderboard] Supabase fetch failed, using local cache.', e);
            }
        }
        return this._local[difficulty]?.[category] || [];
    }

    /**
     * Checks if a score qualifies for the global top 10 in any category.
     */
    async isTop10(difficulty, score, wpm, accuracy, streak = 0) {
        if (score === 0 && streak === 0) return false;

        if (supabase) {
            try {
                // Get the current 10th-place entries for each sorting column
                const [scoreRes, wpmRes, accRes, streakRes] = await Promise.all([
                    supabase.from('leaderboard').select('score').eq('difficulty', difficulty).order('score', { ascending: false }).limit(10),
                    supabase.from('leaderboard').select('wpm').eq('difficulty', difficulty).order('wpm', { ascending: false }).limit(10),
                    supabase.from('leaderboard').select('accuracy').eq('difficulty', difficulty).order('accuracy', { ascending: false }).limit(10),
                    Promise.resolve(supabase.from('leaderboard').select('streak').eq('difficulty', difficulty).order('streak', { ascending: false }).limit(10)).catch(() => ({ data: [] })),
                ]);

                const beats = (val, list, field) =>
                    !list || list.length < 10 || val > (list[list.length - 1]?.[field] ?? 0);

                return beats(score, scoreRes.data, 'score')
                    || beats(wpm, wpmRes.data, 'wpm')
                    || (score > 500 && beats(accuracy, accRes.data, 'accuracy'))
                    || (streak > 0 && beats(streak, streakRes?.data, 'streak'));

            } catch (e) {
                console.warn('[Leaderboard] Supabase isTop10 failed, using local.', e);
            }
        }

        const d = this._local[difficulty];
        if (!d) return false;
        const check = (val, list, field) => !list || list.length < 10 || val > (list[list.length - 1]?.[field] ?? 0);
        return check(score, d.score, 'score')
            || check(wpm, d.wpm, 'wpm')
            || (score > 500 && check(accuracy, d.accuracy, 'accuracy'))
            || (streak > 0 && check(streak, d.streak, 'streak'));
    }

    /**
     * Saves ONE row per score entry to Supabase. No category column — no duplicates.
     */
    async addScore(difficulty, name, score, wpm, accuracy, streak = 0) {
        const entry = {
            name: name || 'Anonymous Mage',
            score,
            wpm,
            accuracy,
            streak: streak || 0,
            date: new Date().toLocaleDateString()
        };

        // Always update local cache immediately
        this._pushToLocal(difficulty, entry);

        if (supabase) {
            try {
                const payload = {
                    difficulty,
                    name: entry.name,
                    score,
                    wpm,
                    accuracy,
                    streak: entry.streak
                };
                const { error } = await supabase.from('leaderboard').insert([payload]);
                if (error) {
                    console.warn('[Leaderboard] Insert with streak failed, retrying without streak column:', error.message);
                    delete payload.streak;
                    const { error: retryError } = await supabase.from('leaderboard').insert([payload]);
                    if (retryError) console.warn('[Leaderboard] Retry insert failed:', retryError.message);
                }
            } catch (e) {
                console.warn('[Leaderboard] Supabase addScore failed.', e);
            }
        }
    }
}

