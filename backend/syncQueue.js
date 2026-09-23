/**
 * SyncQueue — a localStorage-backed outbox for Supabase writes.
 *
 * WHY. Every cloud write in this project is best-effort and fire-and-forget:
 * a free-tier project that is paused (or a browser tab that closes mid-flight)
 * silently loses the write. Observed 2026-09-23: `profiles` upserts were being
 * rejected outright (schema drift), so a whole session of XP/Workshop spending
 * evaporated without a single player-visible signal.
 *
 * WHAT. Writes that fail with a RETRYABLE error (network / paused project /
 * 5xx) are serialised into localStorage and replayed when the connection comes
 * back. Writes that fail with a PERMANENT error (missing column, constraint,
 * RLS) are dropped once — the owning module is expected to have degraded its
 * payload already (see Stats._upsertProfile) and to report the reason to
 * dbHealth.
 *
 * Handlers are registered per `kind` by the owning module:
 *
 *   syncQueue.register('profile',     (payload) => this._upsertProfile(payload));
 *   syncQueue.register('leaderboard', (payload) => this._insertRow(payload));
 *
 * A handler must resolve to `{ ok: true }` on success, or
 * `{ ok: false, retryable: boolean }` on failure.
 */

const STORAGE_KEY = 'typerMaster_syncQueue_v1';
const MAX_ITEMS = 60;      // hard cap so a long outage cannot bloat localStorage
const MAX_ATTEMPTS = 8;    // per-item retry ceiling before it is dropped

export class SyncQueue {
    constructor() {
        this._items = this._load();
        this._handlers = new Map();
        this._flushing = false;
        this._timer = null;
        this._onOnline = null;
        this.onChange = null; // (items: Array) => void
    }

    // ─── Persistence ─────────────────────────────────────────────────────────

    _load() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return [];
            const parsed = JSON.parse(raw);
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            console.warn('[SyncQueue] could not read the outbox, starting empty:', e);
            return [];
        }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._items));
        } catch (e) {
            console.warn('[SyncQueue] could not persist the outbox:', e);
        }
        if (this.onChange) this.onChange(this._items);
    }

    // ─── Public API ──────────────────────────────────────────────────────────

    register(kind, handler) {
        this._handlers.set(kind, handler);
    }

    /**
     * Queue a write for later replay.
     * @param {string} kind  handler key ('profile' | 'leaderboard' | 'run')
     * @param {object} payload data handed back to the handler
     * @param {string|null} dedupeKey when set, an existing queued item with the
     *        same kind+key is REPLACED instead of duplicated (profile syncs are
     *        full snapshots — only the latest one matters).
     */
    enqueue(kind, payload, dedupeKey = null) {
        const item = {
            id: `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            kind,
            key: dedupeKey,
            payload,
            attempts: 0,
            queuedAt: Date.now()
        };

        if (dedupeKey) {
            this._items = this._items.filter(i => !(i.kind === kind && i.key === dedupeKey));
        }

        this._items.push(item);

        while (this._items.length > MAX_ITEMS) {
            // Drop the oldest profile snapshot first: it is a full state
            // snapshot, whereas a leaderboard row is an individual achievement.
            const idx = this._items.findIndex(i => i.kind !== 'profile');
            this._items.splice(idx === -1 ? 0 : idx, 1);
        }

        this._save();
        return item.id;
    }

    pending(kind = null) {
        return kind ? this._items.filter(i => i.kind === kind) : [...this._items];
    }

    count() {
        return this._items.length;
    }

    clear() {
        this._items = [];
        this._save();
    }

    /**
     * Replay queued writes in order.
     * Stops on the first retryable failure so a dead connection is not hammered.
     * @returns {Promise<{flushed:number, remaining:number}>}
     */
    async flush() {
        if (this._flushing) return { flushed: 0, remaining: this._items.length };
        if (this._items.length === 0) return { flushed: 0, remaining: 0 };

        this._flushing = true;
        let flushed = 0;

        try {
            for (const item of [...this._items]) {
                const handler = this._handlers.get(item.kind);
                if (!handler) {
                    // No owner registered (module never loaded). Age it out.
                    item.attempts++;
                    if (item.attempts >= MAX_ATTEMPTS) this._remove(item.id);
                    continue;
                }

                let ok = false;
                let retryable = true;
                try {
                    const res = await handler(item.payload);
                    ok = !!(res && res.ok);
                    retryable = !(res && res.retryable === false);
                } catch (e) {
                    console.warn('[SyncQueue] handler threw while replaying', item.kind, e);
                }

                if (ok) {
                    this._remove(item.id);
                    flushed++;
                    continue;
                }

                if (!retryable) {
                    // Permanent (schema / constraint / RLS): replaying cannot
                    // help, and the owner already degraded the payload.
                    console.warn('[SyncQueue] dropping permanently rejected write:', item.kind);
                    this._remove(item.id);
                    continue;
                }

                item.attempts++;
                item.lastAttempt = Date.now();
                if (item.attempts >= MAX_ATTEMPTS) {
                    console.warn(`[SyncQueue] giving up on ${item.kind} after ${item.attempts} attempts`);
                    this._remove(item.id);
                }
                break; // connection looks unhealthy — back off the whole pass
            }
        } finally {
            this._flushing = false;
            this._save();
        }

        return { flushed, remaining: this._items.length };
    }

    _remove(id) {
        this._items = this._items.filter(i => i.id !== id);
    }

    /** Flush on load, on regaining connectivity, and periodically while visible. */
    start(intervalMs = 60000) {
        this.stop();
        this.flush();
        this._onOnline = () => this.flush();
        window.addEventListener('online', this._onOnline);
        this._timer = setInterval(() => {
            if (document.visibilityState === 'visible') this.flush();
        }, intervalMs);
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
        this._timer = null;
        if (this._onOnline) window.removeEventListener('online', this._onOnline);
        this._onOnline = null;
    }
}

export const syncQueue = new SyncQueue();
