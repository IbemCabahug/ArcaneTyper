import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Resolved endpoints are exported so backend/dbHealth.js can run the same
// lightweight REST heartbeat the CI keep-alive job uses. Both values are
// PUBLIC by design (the anon key ships to every browser).
export { supabaseUrl, supabaseKey };

// If env vars are missing (not yet configured), export null so Leaderboard falls back gracefully
export const supabase = (supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project'))
    ? createClient(supabaseUrl, supabaseKey)
    : null;
