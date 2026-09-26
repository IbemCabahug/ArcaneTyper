import { createClient } from '@supabase/supabase-js';

// `import.meta.env` is injected by Vite in the browser, but it is `undefined`
// when this module is loaded by plain Node (a verify script, a migration script,
// a one-off REPL session). Dereferencing it unguarded threw a TypeError and made
// the whole module — and everything importing it, including `Stats` — impossible
// to load outside a bundler.
//
// The optional chain is a no-op in the app: Vite ALWAYS defines `import.meta.env`,
// so the browser path reads exactly the same values it always did. It only
// changes the Node path from "throws" to "no env, so `supabase` is null", which
// is the documented fallback below.
const env = import.meta.env ?? {};
const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

// Resolved endpoints are exported so backend/dbHealth.js can run the same
// lightweight REST heartbeat the CI keep-alive job uses. Both values are
// PUBLIC by design (the anon key ships to every browser).
export { supabaseUrl, supabaseKey };

// If env vars are missing (not yet configured), export null so Leaderboard falls back gracefully
export const supabase = (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project'))
    ? createClient(supabaseUrl, supabaseKey)
    : null;
