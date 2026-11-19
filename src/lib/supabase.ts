import { createClient } from '@supabase/supabase-js'

/**
 * When VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set, the app uses Supabase Auth and
 * Postgres (with row level security). Otherwise it falls back to browser-only demo storage.
 * Only the public anon key is used here. The service-role key must never reach the browser.
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabase =
  url && anon
    ? createClient(url, anon, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null

export const backendMode: 'supabase' | 'local' = supabase ? 'supabase' : 'local'
