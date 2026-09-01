import 'server-only'

/**
 * The cookie-bound client for authenticated staff.
 *
 * Every query made through it runs as the `authenticated` role with the staff
 * member's JWT attached, so RLS decides what they can see. This is the default
 * client for admin, kitchen and waiter surfaces — the point is precisely that a
 * waiter at branch A cannot read branch B, and that guarantee comes from the
 * database, not from the query we happen to write.
 *
 * Next 16 note: cookies() is async, and a Server Component may not write
 * cookies. The setAll handler therefore tolerates the write failing — the
 * session refresh is performed by middleware, which CAN write, and the
 * try/catch is what lets the same factory serve both contexts.
 */
import { createServerClient as createSSRClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'
import type { SupabaseClient } from '@supabase/supabase-js'

import { requireSupabasePublicConfig } from '@/lib/env'
import type { Database } from '@/types/database'

export type ServerSupabaseClient = SupabaseClient<Database>

export async function createServerClient(): Promise<ServerSupabaseClient> {
  const { url, anonKey } = requireSupabasePublicConfig()
  const cookieStore = await cookies()

  return createSSRClient<Database>(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // middleware.ts performs the refresh, so dropping the write here is
          // correct rather than merely tolerable.
        }
      },
    },
  })
}
