'use client'

/**
 * The browser client.
 *
 * Its only job is Realtime. Reads and writes go through Server Components,
 * Server Actions and the RPC modules, so that authorisation is decided on the
 * server and a compromised browser cannot widen its own scope. Subscriptions
 * have to live in the browser, and Realtime authorises them separately: a
 * customer's `order:{public_code}` channel is authorised by RLS on
 * `realtime.messages`, and a staff `branch:{branch_id}` channel by the session's
 * branch access.
 */
import { createBrowserClient as createSSRBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireSupabasePublicConfig } from '@/lib/env'
import type { Database } from '@/types/database'

export type BrowserSupabaseClient = SupabaseClient<Database>

let cached: BrowserSupabaseClient | null = null

/**
 * Single instance per tab. A second client would open a second websocket and
 * duplicate every realtime event, which shows up as double-counted new-order
 * alerts on the kitchen display.
 */
export function createBrowserClient(): BrowserSupabaseClient {
  if (cached) return cached

  const { url, anonKey } = requireSupabasePublicConfig()

  cached = createSSRBrowserClient<Database>(url, anonKey, {
    realtime: {
      // Bound the reconnect storm when a venue's wifi drops: the panels also
      // resync on reconnect, so a slower retry loses nothing.
      params: { eventsPerSecond: 20 },
    },
  })

  return cached
}
