import 'server-only'

/**
 * The one place a staff identity is derived (doc 05 §4.4).
 *
 * Wrapped in `React.cache()` so a layout, its page, a sibling Suspense branch
 * and every service in the same render share ONE auth round trip and ONE staff
 * read. That cache lives for exactly one request pass and is never shared
 * between users — `React.cache()` is per-request by construction.
 *
 * Deliberately NOT wrapped in `unstable_cache` / `'use cache'`: the answer
 * depends on a cookie and on live `staff.is_active`, and doc 02 §8.1 requires a
 * deactivation to take effect on the NEXT query, not after a revalidation
 * window.
 *
 * NOTE ON OWNERSHIP: this module is named by doc 05 §4.4 but was not present
 * when the service layer landed, and every service imports it. It is written
 * here to the documented contract so the layer compiles and runs; if the auth
 * slice ships its own, that one is authoritative and this file should be
 * replaced wholesale rather than merged.
 */
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'

import { demoStaffSession } from '@/lib/demo/demo-mode'
import { isDemoMode } from '@/lib/env'
import { AppErrorException, appError } from '@/lib/result'
import { createServerClient } from '@/lib/supabase/server'
import type { StaffRole } from '@/types/database'
import type { StaffSession } from '@/types/domain'

/** The cookie that remembers which branch the staff UI is pointed at. */
export const ACTIVE_BRANCH_COOKIE = 'qros_branch'

export const getStaffSession = cache(async (): Promise<StaffSession | null> => {
  if (isDemoMode()) return demoStaffSession()

  const supabase = await createServerClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  // Three reads rather than one embedded select: src/types/database.ts declares
  // `Relationships: []`, so a PostgREST embed does not type-check. RLS scopes
  // each of them to the caller's own rows (doc 02 §3.5).
  const { data: staff, error } = await supabase
    .from('staff')
    .select('id, restaurant_id, branch_id, role, is_active')
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (error || !staff) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, full_name, avatar_url, locale, is_platform_admin, is_active')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile || !profile.is_active) return null

  const { data: restaurant } = await supabase
    .from('restaurants')
    .select('id, is_active')
    .eq('id', staff.restaurant_id)
    .maybeSingle()

  if (!restaurant || !restaurant.is_active) return null

  return {
    profileId: profile.id,
    staffId: staff.id,
    restaurantId: staff.restaurant_id,
    branchId: staff.branch_id,
    role: staff.role,
    isPlatformAdmin: profile.is_platform_admin,
    displayName: profile.full_name ?? profile.email ?? 'Staff',
    email: profile.email,
    avatarUrl: profile.avatar_url,
    locale: profile.locale,
  }
})

/** Only paths inside this app; an absolute URL in `next` would be an open redirect. */
function safeNextPath(next: string): string {
  return next.startsWith('/') && !next.startsWith('//') ? next : '/admin'
}

export async function requireStaffSession(next = '/admin'): Promise<StaffSession> {
  const session = await getStaffSession()
  if (session) return session
  redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`)
}

export type Capability = 'kitchen' | 'waiter' | 'admin' | 'platform'

/** Doc 05 §4.4's matrix. Mirrors the SQL predicates in doc 02 §4.5. */
const CAPABILITY_ROLES: Readonly<Record<Capability, readonly StaffRole[]>> = {
  kitchen: ['RESTAURANT_OWNER', 'MANAGER', 'KITCHEN'],
  waiter: ['RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  admin: ['RESTAURANT_OWNER', 'MANAGER'],
  platform: [],
}

/** Throws `AppErrorException(FORBIDDEN)`. The caller decides redirect vs render. */
export function requireCapability(session: StaffSession, capability: Capability): void {
  if (session.isPlatformAdmin) return
  if (!CAPABILITY_ROLES[capability].includes(session.role)) {
    throw new AppErrorException(
      appError('FORBIDDEN', `${session.role} lacks the ${capability} capability`, {
        wire: 'QR050_FORBIDDEN',
        details: { capability, role: session.role },
      }),
    )
  }
}

export async function requirePlatformAdmin(): Promise<StaffSession> {
  const session = await requireStaffSession()
  if (!session.isPlatformAdmin) notFound()
  return session
}

export interface BranchScope {
  /** Branch ids this session may read or act on. Empty means "every branch of the restaurant". */
  branchIds: string[]
  /** True when the session is not pinned to one branch. */
  isRestaurantWide: boolean
}

/**
 * The branch set this session may touch. Also React-cached: the admin shell, the
 * branch switcher and any service that validates a `branchId` argument all ask
 * for it during one render.
 */
export const getBranchScope = cache(async (): Promise<BranchScope> => {
  const session = await getStaffSession()
  if (!session) return { branchIds: [], isRestaurantWide: false }

  if (session.branchId) {
    return { branchIds: [session.branchId], isRestaurantWide: false }
  }

  const supabase = await createServerClient()
  const { data } = await supabase
    .from('branches')
    .select('id')
    .eq('restaurant_id', session.restaurantId)
    .is('deleted_at', null)
    .order('code', { ascending: true })

  return { branchIds: (data ?? []).map((row) => row.id), isRestaurantWide: true }
})

/**
 * The branch the UI is pointed at: the cookie when it is inside the scope,
 * otherwise the first branch of the scope. UI convenience only — a service must
 * re-check any branch id against `getBranchScope()` rather than trusting this.
 */
export const getActiveBranchId = cache(async (): Promise<string | null> => {
  const scope = await getBranchScope()
  if (scope.branchIds.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_BRANCH_COOKIE)?.value
  if (preferred && scope.branchIds.includes(preferred)) return preferred

  return scope.branchIds[0] ?? null
})
