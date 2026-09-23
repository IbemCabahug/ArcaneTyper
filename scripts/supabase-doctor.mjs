/**
 * supabase-doctor.mjs — one command that answers "is the cloud side healthy?"
 *
 *   npm run doctor
 *
 * It reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env at the repo root
 * (the same file Vite loads via envDir: '../'), then checks, read-only:
 *
 *   1. configuration present (not the placeholder values)
 *   2. the project is REACHABLE (a paused free project answers 404 here)
 *   3. auth settings (reachability + whether email confirmation is on)
 *   4. every column the client reads or writes, per table
 *   5. row counts, so an empty cloud profile/history is obvious
 *
 * Exit codes:  0 healthy · 1 schema drift (run the migration) · 2 unreachable
 * Dependencies: none (Node 18+ global fetch).
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Columns the client actually uses, and whether the migration adds them. */
const EXPECTED = {
    leaderboard: [
        ['difficulty', false], ['name', false], ['score', false],
        ['wpm', false], ['accuracy', false], ['created_at', false],
        ['streak', true]
    ],
    profiles: [
        ['id', false], ['username', false], ['total_xp', false], ['player_level', false],
        ['unlocked_skills', true], ['wand_color', true], ['mage_class', true],
        ['best_score', true], ['best_wpm', true], ['created_at', true], ['updated_at', true]
    ],
    run_history: [
        ['user_id', false], ['mode', false], ['wpm', false],
        ['accuracy', false], ['score', false], ['created_at', false]
    ]
};

const MIGRATION = 'supabase/migrations/20260923_arcanetyper_schema_repair.sql';

function loadEnvFile(path) {
    if (!existsSync(path)) return {};
    const out = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
        if (!m) continue;
        out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
}

const envFile = loadEnvFile(resolve(ROOT, '.env'));
const url = (process.env.VITE_SUPABASE_URL || envFile.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.VITE_SUPABASE_ANON_KEY || envFile.VITE_SUPABASE_ANON_KEY || '';

const results = [];
let exitCode = 0;

function line(ok, label, detail = '') {
    const mark = ok === true ? 'PASS' : ok === false ? 'FAIL' : 'INFO';
    results.push(`${mark}  ${label}${detail ? `  → ${detail}` : ''}`);
}

async function req(path, { method = 'GET', headers = {} } = {}) {
    const res = await fetch(`${url}${path}`, {
        method,
        headers: { apikey: key, Authorization: `Bearer ${key}`, ...headers },
        signal: AbortSignal.timeout(15000)
    });
    let body = null;
    try {
        body = await res.json();
    } catch (e) { /* empty body is fine */ }
    return { status: res.status, body, headers: res.headers };
}

function finish() {
    console.log(results.join('\n'));
    console.log('');
    if (exitCode === 0) console.log('✅ Cloud side healthy.');
    else if (exitCode === 2) console.log('❌ Project unreachable — see the PAUSED note above.');
    else console.log(`❌ Schema drift — run ${MIGRATION} in the Supabase SQL editor, then re-run this.`);
    process.exit(exitCode);
}

// ── 1. configuration ────────────────────────────────────────────────────────
console.log('Arcane Typer — Supabase doctor\n');

if (!url || !key) {
    line(false, 'configuration', 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env');
    process.exit(2);
}
if (url.includes('your-project') || key.includes('your-anon-key')) {
    line(false, 'configuration', 'still the placeholder values from .env.example');
    process.exit(2);
}
line(true, 'configuration', `${url.replace(/^https?:\/\//, '')} …${key.slice(-6)}`);

// ── 2. reachability (a paused project answers 404 here) ─────────────────────
let reachable = false;
try {
    const health = await req('/auth/v1/health');
    if (health.status === 200) {
        reachable = true;
        line(true, 'project reachable', `GoTrue ${health.body?.version || 'ok'}`);
    } else {
        line(false, 'project reachable', `HTTP ${health.status}`);
    }
} catch (e) {
    line(false, 'project reachable', e.message);
}

if (!reachable) {
    console.log(results.join('\n'));
    console.log(`
❌ UNREACHABLE / PAUSED.

   A paused free-tier project answers 404 (or nothing at all) to every request.
   Fix: https://supabase.com/dashboard -> your organization -> the project ->
   "Resume project". Pausing happens after 7 days of low database activity, so
   also run through steps 2–3 of docs/arcaneTyper-docs/supabase-operations.md.
`);
    process.exit(2);
}

// ── 3. auth settings ───────────────────────────────────────────────────────
try {
    const settings = await req('/auth/v1/settings');
    line(true, 'auth settings', `email signup ${settings.body?.disable_signup ? 'DISABLED' : 'enabled'}, ` +
        `auto-confirm ${settings.body?.mailer_autoconfirm ? 'on' : 'off'}`);
} catch (e) {
    line(null, 'auth settings', `could not read (${e.message})`);
}


// ── 4. schema — every column the client reads or writes ────────────────────
const drift = [];

for (const [table, cols] of Object.entries(EXPECTED)) {
    for (const [col, fromMigration] of cols) {
        let status = 0;
        try {
            const res = await req(`/rest/v1/${table}?select=${col}&limit=1`);
            status = res.status;
        } catch (e) {
            line(null, `${table}.${col}`, `network error: ${e.message}`);
            continue;
        }
        const ok = status === 200;
        if (!ok) drift.push(`${table}.${col}${fromMigration ? ' (added by the migration)' : ''}`);
        line(ok, `${table}.${col}`, ok ? '' : `HTTP ${status}`);
    }
}

// ── 5. row counts — makes an empty cloud profile/history obvious ───────────
for (const table of Object.keys(EXPECTED)) {
    try {
        const res = await req(`/rest/v1/${table}?select=id`, {
            method: 'HEAD',
            headers: { Prefer: 'count=exact', 'Range-Unit': 'items', Range: '0-0' }
        });
        const range = res.headers.get('content-range') || '?/?';
        line(true, `${table} rows`, range.split('/')[1] || '?');
    } catch (e) {
        line(null, `${table} rows`, e.message);
    }
}

if (drift.length > 0) {
    exitCode = 1;
    results.push('');
    results.push(`MISSING COLUMNS (${drift.length}): ${drift.join(', ')}`);
    results.push(`FIX: paste ${MIGRATION} into the Supabase SQL editor and Run, then re-run npm run doctor.`);
}

finish();

