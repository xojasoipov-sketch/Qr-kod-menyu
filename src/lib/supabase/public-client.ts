/**
 * The unauthenticated client used for public QR traffic.
 *
 * `anon` holds no privilege on any table (see the privilege-baseline migration):
 * it may execute exactly five SECURITY DEFINER capability functions, each of
 * which takes the table's QR token as a bearer capability. So this client is
 * only ever used to call those functions through `src/lib/rpc/public.ts`.
 *
 * No cookies. A diner has no session and must not acquire one — attaching the
 * staff cookie jar here would let a signed-in waiter's session leak into a
 * public page render and change what the page returns.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { requireSupabasePublicConfig } from '@/lib/env'
import type { Database } from '@/types/database'

export type PublicSupabaseClient = SupabaseClient<Database>

/**
 * One client per process is safe: it is stateless, holds no session, and
 * persists nothing. Creating one per request would rebuild the fetch pipeline
 * on every menu view for no benefit.
 */
let cached: PublicSupabaseClient | null = null

export function createPublicClient(): PublicSupabaseClient {
  if (cached) return cached

  const { url, anonKey } = requireSupabasePublicConfig()

  cached = createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-application-name': 'restaurant-qr-os/public' },
    },
  })

  return cached
}
