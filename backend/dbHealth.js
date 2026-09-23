/**
 * dbHealth — is the Supabase project reachable, and if not, why?
 *
 * WHY. Every Supabase failure in this codebase used to end as a console.warn:
 * a paused free-tier project, a missing column, or a dropped session all looked
 * identical to the player ("my progress vanished") and to the developer
 * ("nothing in the UI"). This module gives the app ONE place to record the
 * outcome of real requests, and one small on-screen chip so an outage is
 * visible instead of silent.
 *
 * It also carries the shared error classifiers used by Stats/Leaderboard so we
 * never again mistake schema drift (HTTP 400) for a network outage (or vice
 * versa) — that misdiagnosis is what let the schema bug live in production.
 */

import { supabase, supabaseUrl, supabaseKey } from './supabaseClient.js';

export const DbStatus = {
    UNKNOWN: 'unknown',   // not probed yet
    ONLINE: 'online',
    SCHEMA: 'schema',     // reachable, but the client asks for columns that do not exist
    OFFLINE: 'offline',   // unreachable: paused project, DNS, CORS, timeout
    DISABLED: 'disabled'  // env vars absent — supabase client is null
};

const PROBE_TIMEOUT_MS = 4000;
const WATCH_INTERVAL_MS = 60000;

/** PostgREST/Postgres errors that mean "this column does not exist here". */
export function isMissingColumnError(error) {
    if (!error) return false;
    if (error.code === '42703' || error.code === 'PGRST204') return true;
    const msg = String(error.message || error.details || error || '');
    return /column .* does not exist|could not find the '.*' column|schema cache/i.test(msg);
}

/** Errors that mean the request never reached a healthy server. */
export function isNetworkError(error) {
    if (!error) return false;
    if (typeof error === 'string') return /failed to fetch|network|load failed|abort|timeout/i.test(error);
    const name = String(error.name || '');
    if (name === 'AbortError' || name === 'TypeError') return true;
    return /failed to fetch|network|load failed|fetch|abort|timeout|ERR_/i.test(String(error.message || ''));
}

/** A one-line, log-friendly rendering of any Supabase/PostgREST error. */
export function describeError(error) {
    if (!error) return 'unknown error';
    if (typeof error === 'string') return error;
    const parts = [];
    if (error.message) parts.push(error.message);
    if (error.code) parts.push(`code=${error.code}`);
    if (error.details) parts.push(`details=${error.details}`);
    if (error.hint) parts.push(`hint=${error.hint}`);
    return parts.join(' ') || String(error);
}

class DbHealth {
    constructor() {
        this.status = supabase ? DbStatus.UNKNOWN : DbStatus.DISABLED;
        this.detail = supabase ? '' : 'Supabase is not configured (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing).';
        this.schemaNotes = new Set();
        this.pendingCount = 0;
        this.lastProbeAt = 0;
        this._listeners = new Set();
        this._watchTimer = null;
        this._probeInFlight = null;
        this._chip = null;
    }

    get isReachable() {
        return this.status === DbStatus.ONLINE || this.status === DbStatus.SCHEMA;
    }

    // ─── Subscriptions ───────────────────────────────────────────────────────

    onChange(callback) {
        this._listeners.add(callback);
        callback(this.status, this);
        return () => this._listeners.delete(callback);
    }

    _emit() {
        this._renderChip();
        this._listeners.forEach(cb => {
            try {
                cb(this.status, this);
            } catch (e) {
                console.warn('[dbHealth] listener failed:', e);
            }
        });
    }

    // ─── Reporting from real requests (preferred over polling) ───────────────

    reportSuccess() {
        if (!supabase) return;
        this._set(DbStatus.ONLINE, '');
    }

    /**
     * Classify a failed Supabase call.
     * @param {any} error the PostgREST/SDK error
     * @param {string} context e.g. 'profiles upsert'
     */
    reportFailure(error, context = '') {
        if (!supabase) return;
        const detail = describeError(error);

        if (isMissingColumnError(error)) {
            this.noteSchema(context, detail);
            return;
        }
        if (isNetworkError(error)) {
            this._set(DbStatus.OFFLINE, detail);
            return;
        }
        // Reachable but refusing us (RLS 403, constraint 23505, auth 401 ...).
        this._set(DbStatus.SCHEMA, context ? `${context}: ${detail}` : detail);
    }

    /** Record schema drift — the database answered, it just lacks a column. */
    noteSchema(context, detail) {
        const note = `${context || 'query'}: ${detail}`;
        this.schemaNotes.add(note);
        console.warn('[dbHealth] schema drift detected →', note);
        if (this.status !== DbStatus.OFFLINE) {
            this._set(DbStatus.SCHEMA, 'Run supabase/migrations/20260923_arcanetyper_schema_repair.sql');
        }
    }

    /** Reported by SyncQueue so the chip can show how much is waiting. */
    setPendingCount(n) {
        if (this.pendingCount === n) return;
        this.pendingCount = n || 0;
        this._renderChip();
    }

    // ─── Active probe (boot, reconnect, and every 60s while visible) ─────────

    async probe() {
        if (!supabase) return this.status;
        if (this._probeInFlight) return this._probeInFlight;

        this._probeInFlight = (async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
            try {
                // The same read-only request the CI keep-alive job sends: tiny,
                // and it counts as the external activity that keeps a free-tier
                // project from being paused.
                const res = await fetch(`${supabaseUrl}/rest/v1/leaderboard?select=created_at&limit=1`, {
                    headers: { apikey: supabaseKey, Authorization: `Bearer ${supabaseKey}` },
                    signal: controller.signal,
                    cache: 'no-store'
                });

                if (res.ok) {
                    this._set(DbStatus.ONLINE, '');
                } else if (res.status === 400) {
                    const body = await res.json().catch(() => ({}));
                    if (isMissingColumnError(body)) this.noteSchema('heartbeat', describeError(body));
                    else this._set(DbStatus.SCHEMA, `HTTP 400 ${describeError(body)}`);
                } else {
                    this._set(DbStatus.OFFLINE, `HTTP ${res.status} ${res.statusText || ''}`.trim());
                }
            } catch (e) {
                this._set(DbStatus.OFFLINE, describeError(e));
            } finally {
                clearTimeout(timer);
                this.lastProbeAt = Date.now();
                this._probeInFlight = null;
            }
            return this.status;
        })();

        return this._probeInFlight;
    }

    startWatch(intervalMs = WATCH_INTERVAL_MS) {
        this.stopWatch();
        this.probe();
        this._watchTimer = setInterval(() => {
            if (document.visibilityState === 'visible') this.probe();
        }, intervalMs);
    }

    stopWatch() {
        if (this._watchTimer) clearInterval(this._watchTimer);
        this._watchTimer = null;
    }

    // ─── Status + chip ───────────────────────────────────────────────────────

    _set(status, detail) {
        const changed = this.status !== status;
        this.status = status;
        this.detail = detail || '';
        if (changed) console.info(`[dbHealth] cloud status → ${status}${detail ? ` (${detail})` : ''}`);
        this._emit();
    }

    _renderChip() {
        const shouldShow = this.status === DbStatus.OFFLINE
            || this.status === DbStatus.SCHEMA
            || this.pendingCount > 0;

        if (!shouldShow) {
            if (this._chip) this._chip.style.display = 'none';
            return;
        }

        if (!this._chip) {
            const chip = document.createElement('div');
            chip.id = 'at-db-status';
            // Deliberate inline style, matching the existing #at-error-banner
            // pattern in Game._reportError: no stylesheet dependency, and it
            // cannot be broken by a CSS regression. Sits just above that banner.
            chip.style.cssText = 'position:fixed;left:8px;bottom:44px;z-index:99998;' +
                'max-width:60%;background:rgba(30,20,0,0.88);color:#ffd700;' +
                'font:12px/1.4 monospace;padding:6px 10px;border-radius:6px;' +
                'border:1px solid rgba(255,215,0,0.5);pointer-events:none;white-space:pre-wrap;';
            document.body.appendChild(chip);
            this._chip = chip;
        }

        const queued = this.pendingCount > 0
            ? `\n${this.pendingCount} change(s) queued locally — they sync automatically.`
            : '';

        if (this.status === DbStatus.OFFLINE) {
            this._chip.style.color = '#ff8a80';
            this._chip.style.border = '1px solid #ff5252';
            this._chip.textContent = `⚠ CLOUD UNREACHABLE — playing offline.${queued}`;
        } else if (this.status === DbStatus.SCHEMA) {
            this._chip.style.color = '#ffd700';
            this._chip.style.border = '1px solid rgba(255,215,0,0.5)';
            this._chip.textContent = `⚠ CLOUD DATA INCOMPLETE — progress is saved locally.${queued}`;
        } else {
            this._chip.style.color = '#ffd700';
            this._chip.style.border = '1px solid rgba(255,215,0,0.5)';
            this._chip.textContent = `☁ Syncing queued progress…${queued}`;
        }
        this._chip.style.display = '';
    }
}

export const dbHealth = new DbHealth();
