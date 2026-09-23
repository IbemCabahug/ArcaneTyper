import { supabase } from './supabaseClient.js';
import { dbHealth, isMissingColumnError, isNetworkError, describeError } from './dbHealth.js';
import { syncQueue } from './syncQueue.js';

const LOCAL_KEY = 'typermaster_hall_of_fame_v2';

/**
 * Whether the live `leaderboard` table actually has the `streak` column.
 *
 * Observed MISSING on 2026-09-23 (GET ?select=streak -> HTTP 400 / 42703), which
 * made every leaderboard read fail and silently fall back to the per-browser
 * cache. The flag is session-scoped on purpose: it starts as "unknown", we ask
 * for `streak` once, and if the column is absent we degrade for the rest of the
 * session. Once the migration is applied the first request simply succeeds, so
 * the client heals itself with no cache to invalidate.
 * `null` = unknown, `true` = present, `false` = absent.
 */
let _hasStreakColumn = null;

export class Leaderboard {
    constructor() {
        this._local = this._loadLocal();

        // Replay owner for queued rows (see backend/syncQueue.js).
        syncQueue.register('leaderboard', (payload) => this._insertRow(payload));

        // Deferred Hall-of-Fame submission for runs banked during unload
        // (AT-M8). isTop10 needs the network, which a pagehide handler does
        // not have, so the ENTIRE decision is queued and replayed on the next
        // live page. A replay that resolves to "did not qualify" returns ok so
        // the item is consumed without ever writing.
        syncQueue.register('pending-score', async (payload) => {
            const qualifies = await this.isTop10(
                payload.difficulty, payload.score, payload.wpm,
                payload.accuracy, payload.streak || 0
            );
            if (!qualifies) return { ok: true };
            const res = await this.addScore(
                payload.difficulty, payload.name, payload.score,
                payload.wpm, payload.accuracy, payload.streak || 0
            );
            // addScore queued its own 'leaderboard' item on a retryable
            // failure — consume this one too, or the row would submit twice.
            if (res && res.queued) return { ok: true };
            return res;
        });
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
     *
     * Degradation rules (2026-09-23 hardening):
     *   - the DB answers            → those rows, plus any already-queued local row
     *   - the DB is unreachable     → the local cache (dbHealth reports OFFLINE)
     *   - the schema lacks `streak` → the local cache for the streak board only,
     *                                 with dbHealth reporting schema drift
     */
    async getTopScores(difficulty, category) {
        const remote = await this._fetchTop(difficulty, category);
        const local = this._local[difficulty]?.[category] || [];

        if (!remote) return local;

        // Rows the server has not accepted yet (queued while it was paused) are
        // merged in so a qualifying run is never invisible. They are matched by
        // name and only for this difficulty, so nothing is fabricated.
        const queuedNames = new Set(
            syncQueue.pending('leaderboard')
                .filter(item => item.payload && item.payload.difficulty === difficulty)
                .map(item => item.payload.name)
        );
        const localOnly = local.filter(entry =>
            queuedNames.has(entry.name) && !remote.some(r => r.name === entry.name));

        return [...remote, ...localOnly]
            .sort((a, b) => (b[category] ?? 0) - (a[category] ?? 0))
            .slice(0, 10);
    }

    /**
     * Reads the top 10 straight from Supabase.
     * @returns {Promise<Array|null>} rows (every row has a numeric `streak`),
     *          or null when the data is unavailable for any reason.
     */
    async _fetchTop(difficulty, category) {
        if (!supabase) return null;

        // The streak board cannot be answered by a schema without the column.
        if (category === 'streak' && _hasStreakColumn === false) return null;

        const withStreak = _hasStreakColumn !== false;
        const columns = withStreak
            ? 'name, score, wpm, accuracy, streak, created_at'
            : 'name, score, wpm, accuracy, created_at';
        // Without `streak`, ordering the streak board by it would 400 too.
        const orderColumn = (category === 'streak' && !withStreak) ? 'score' : category;

        const { data, error } = await supabase
            .from('leaderboard')
            .select(columns)
            .eq('difficulty', difficulty)
            .order(orderColumn, { ascending: false })
            .limit(10);

        if (error) {
            if (withStreak && isMissingColumnError(error)) {
                _hasStreakColumn = false;
                dbHealth.noteSchema('leaderboard select', describeError(error));
                console.warn('[Leaderboard] `streak` column missing — degrading this session. ' +
                    'Apply supabase/migrations/20260923_arcanetyper_schema_repair.sql');
                return this._fetchTop(difficulty, category);
            }
            dbHealth.reportFailure(error, 'leaderboard select');
            console.warn('[Leaderboard] Supabase getTopScores error, using local cache:', describeError(error));
            return null;
        }

        if (withStreak) dbHealth.reportSuccess();

        return (data || []).map(row => ({ ...row, streak: Number(row.streak || 0) }));
    }

    /**
     * Checks if a score qualifies for the global top 10 in any category.
     *
     * A category whose read FAILED is treated as "unknown", never as "qualified"
     * (the pre-2026-09-23 code passed `null` data into the comparison, so a
     * missing `streak` column made every run with a streak look like a record).
     */
    async isTop10(difficulty, score, wpm, accuracy, streak = 0) {
        if (score === 0 && streak === 0) return false;

        if (supabase) {
            const columns = _hasStreakColumn === false
                ? ['score', 'wpm', 'accuracy']
                : ['score', 'wpm', 'accuracy', 'streak'];

            const results = await Promise.all(columns.map(col =>
                supabase.from('leaderboard').select(col)
                    .eq('difficulty', difficulty)
                    .order(col, { ascending: false })
                    .limit(10)
            ));

            let evaluated = 0;
            let qualifies = false;

            // `evaluated` counts the categories we could actually read, so a
            // total outage still falls through to the local check below.
            const beats = (val, res, field) => {
                if (!res || res.error || !Array.isArray(res.data)) return false;
                evaluated++;
                const list = res.data;
                return list.length < 10 || val > (list[list.length - 1]?.[field] ?? 0);
            };

            if (beats(score, results[0], 'score')) qualifies = true;
            if (beats(wpm, results[1], 'wpm')) qualifies = true;
            if (score > 500 && beats(accuracy, results[2], 'accuracy')) qualifies = true;
            if (streak > 0 && results[3] && beats(streak, results[3], 'streak')) qualifies = true;

            if (evaluated > 0) {
                dbHealth.reportSuccess();
                return qualifies;
            }

            const firstError = results.find(r => r && r.error);
            if (firstError) {
                dbHealth.reportFailure(firstError.error, 'leaderboard isTop10');
                console.warn('[Leaderboard] isTop10 could not read the global boards, using local:', describeError(firstError.error));
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
    /**
     * Saves ONE row per score entry to Supabase. No category column — no duplicates.
     *
     * A write that fails because the connection is down is queued in the local
     * outbox and replayed automatically; the local cache is always updated first
     * so the player never loses sight of the run.
     * @returns {Promise<{ok:boolean, queued?:boolean, retryable?:boolean}>}
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

        if (!supabase) return { ok: false, queued: false };

        const payload = {
            difficulty,
            name: entry.name,
            score,
            wpm,
            accuracy
        };
        // Only send `streak` once we know (or still believe) the column exists.
        if (_hasStreakColumn !== false) payload.streak = entry.streak;

        const res = await this._insertRow(payload);

        if (!res.ok && res.retryable) {
            // Distinct achievements, so no dedupe key: every run deserves its row.
            syncQueue.enqueue('leaderboard', payload);
            console.warn('[Leaderboard] insert deferred to the offline queue:', payload.name, payload.score);
            return { ok: false, queued: true, retryable: true };
        }

        return res;
    }

    /**
     * Queues the isTop10 → addScore decision for the next live page (AT-M8:
     * pagehide banking). Pure synchronous outbox write — safe during unload.
     */
    queuePendingScore(difficulty, name, score, wpm, accuracy, streak = 0) {
        syncQueue.enqueue('pending-score', { difficulty, name, score, wpm, accuracy, streak });
    }

    /**
     * Performs a single leaderboard insert.
     * Missing-column errors degrade the session to the schema we know exists.
     * Also the replay handler for the outbox, so it must be self-contained.
     * @returns {Promise<{ok:boolean, retryable?:boolean}>}
     */
    async _insertRow(payload) {
        if (!supabase) return { ok: false, retryable: false };

        const { error } = await supabase.from('leaderboard').insert([payload]);

        if (!error) {
            dbHealth.reportSuccess();
            return { ok: true };
        }

        if (isMissingColumnError(error)) {
            _hasStreakColumn = false;
            dbHealth.noteSchema('leaderboard insert', describeError(error));
            if ('streak' in payload) {
                console.warn('[Leaderboard] Insert with streak failed, retrying without the streak column:', describeError(error));
                const reduced = { ...payload };
                delete reduced.streak;
                const retry = await supabase.from('leaderboard').insert([reduced]);
                if (!retry.error) return { ok: true };
                dbHealth.reportFailure(retry.error, 'leaderboard insert');
                console.warn('[Leaderboard] Retry insert failed:', describeError(retry.error));
                return { ok: false, retryable: isNetworkError(retry.error) || !retry.error.code };
            }
            return { ok: false, retryable: false };
        }

        dbHealth.reportFailure(error, 'leaderboard insert');
        console.warn('[Leaderboard] Insert failed:', describeError(error));

        // PostgREST errors always carry a SQLSTATE code (RLS 42501, unique 23505
        // ...). A failure WITHOUT one is transport-level → worth replaying.
        return { ok: false, retryable: isNetworkError(error) || !error.code };
    }
}

