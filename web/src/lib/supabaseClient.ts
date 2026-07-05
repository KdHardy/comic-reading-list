import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env and fill them in.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Shared secret every write RPC call must include (see supabase/migrations/0002_functions.sql).
 * This is a solo-use app with no login, so this stands in for auth — treat it like a password
 * and don't commit it (it lives in web/.env, which is gitignored).
 */
export const WRITE_SECRET = (import.meta.env.VITE_WRITE_SECRET as string | undefined) ?? '';
