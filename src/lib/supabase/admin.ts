import 'server-only'

/**
 * The service-role client. It BYPASSES row-level security entirely.
 *
 * Use it only where no user identity exists to authorise the work and the
 * caller has already established authority by other means — seeding, scheduled
 * housekeeping, and administrative repair. It is never the convenient way to
 * skip a policy: if a signed-in staff member is performing the action, use
 * `createServerClient()` so their RLS scope applies, because that scope is what
 * keeps one restaurant out of another's data.
 *
 * `import 'server-only'` on line 1 turns any client-side import of this module
 * into a build error, which is the mechanism that keeps the key out of the
 * browser bundle.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import { requireServiceRoleKey, requireSupabasePublicConfig } from '@/lib/env'
import type { Database } from '@/types/database'

export type AdminSupabaseClient = SupabaseClient<Database>

let cached: AdminSupabaseClient | null = null

export function createAdminClient(): AdminSupabaseClient {
  if (cached) return cached

  const { url } = requireSupabasePublicConfig()

  cached = createClient<Database>(url, requireServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-application-name': 'restaurant-qr-os/admin' },
    },
  })

  return cached
}
