import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database.types'
import { getEnv } from './env'
import { isDesktop } from './platform'

export type AppSupabaseClient = SupabaseClient<Database>

let client: AppSupabaseClient | null = null

/**
 * The single Supabase client for the app.
 *
 * Created lazily so the environment-error screen can render without a client,
 * and memoised so realtime never ends up with two competing socket
 * connections — a classic source of duplicated messages.
 */
export function getSupabase(): AppSupabaseClient {
  if (client) return client

  const env = getEnv()

  client = createClient<Database>(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The desktop shell is not a browser tab: there is no URL fragment to
      // parse on boot, and deep links are handled explicitly instead.
      detectSessionInUrl: !isDesktop(),
      flowType: 'pkce',
      storageKey: 'lfg-hq-auth',
    },
    realtime: {
      params: {
        // Phase 1 has no realtime feeds yet; this ceiling keeps a future chat
        // subscription from flooding the client.
        eventsPerSecond: 10,
      },
    },
    global: {
      headers: { 'x-application-name': 'lfg-hq' },
    },
  })

  return client
}

/** Test seam: drops the memoised client so each test starts clean. */
export function resetSupabaseClient(): void {
  client = null
}
