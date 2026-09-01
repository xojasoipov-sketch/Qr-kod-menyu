import 'server-only';

/**
 * src/lib/auth/session.ts — the one place a staff identity is derived.
 * Source: 05-app-structure.md §4.4; 02-security-and-rls.md §3.3/§3.4/§3.5.
 *
 * Every staff page, layout, action and route handler scopes itself from
 * `getStaffContext()`. It is wrapped in `React.cache()` so a layout, its page, a
 * sibling Suspense branch and any number of services in the same render share ONE
 * auth round trip and ONE membership query. The cache is per request/render pass
 * by construction and is never shared between users.
 *
 * It is deliberately NOT wrapped in `unstable_cache` / `'use cache'`: the answer
 * depends on a cookie and on live `staff.is_active` / `profiles.is_active`, and
 * doc 02 §8.1 requires a deactivation to take effect on the NEXT QUERY, not after
 * a revalidation window.
 *
 * Everything here reads through `createServerClient()`, so RLS is what actually
 * decides. `staff_select_self` and `profiles_select_self` let a signed-in user
 * read their own rows; `branches_select_staff USING has_branch_access(id)` means
 * the branch query below already returns exactly the caller's branch scope. The
 * application-side filtering that follows is a second, cheap agreement with the
 * database — never a substitute for it.
 */

import { cache } from 'react';
import { cookies } from 'next/headers';
import type { User } from '@supabase/supabase-js';

import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient, type ServerSupabaseClient } from '@/lib/supabase/server';
import type { AppLocale, Json, StaffRole } from '@/types/database';
import type { StaffSession } from '@/types/domain';

/**
 * The branch the admin UI is currently pointed at. Advisory only: a service
 * re-derives the allowed set from `StaffContext.branchIds` and RLS is the real
 * boundary (05 §2.6). Not HttpOnly for the same reason the locale cookie is not —
 * it carries no authority.
 */
export const BRANCH_COOKIE = 'qros_branch';

/** One branch of the caller's restaurant, already inside their scope. */
export interface StaffBranch {
  id: string;
  name: string;
  /** `^[A-Z][A-Z0-9]{0,3}$` — the prefix of `order_number`, e.g. 'C' in 'C-014'. */
  code: string;
  /** IANA zone. Business dates and KDS clocks are computed in it. */
  timezone: string;
  isActive: boolean;
  isAcceptingOrders: boolean;
  /** Minutes after which an open ticket is flagged late on the KDS. */
  lateOrderThresholdMinutes: number;
  defaultPrepMinutes: number;
  /** NULL in the database = inherit the restaurant's rate. */
  serviceFeeBps: number | null;
}

/** The tenant. Currency lives here and drives every `formatMoney` call. */
export interface StaffRestaurant {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  /** ISO-4217, e.g. 'UZS'. */
  currency: string;
  /** 0 for UZS, 2 for USD/EUR. */
  currencyDecimals: number;
  /** Content fallback for `i18n_text`, NOT the UI language. */
  defaultLocale: AppLocale;
  serviceFeeBps: number;
  serviceFeeEnabled: boolean;
  isActive: boolean;
  /** `restaurants.is_demo` — every StatCard on this tenant must show the demo badge. */
  isDemo: boolean;
}

/** One `staff` row: a membership, not a person. Someone may hold several. */
export interface StaffMembership {
  staffId: string;
  restaurantId: string;
  /** null = restaurant-wide (RESTAURANT_OWNER, or a MANAGER with no branch pin). */
  branchId: string | null;
  role: StaffRole;
  /** Fine-grained MANAGER overrides; `{}` for every other role. */
  permissions: Json;
}

/**
 * Everything a staff surface needs to scope itself, resolved once per request.
 *
 * `restaurant` and `session` are non-null by construction: a caller with no
 * active `staff` row has no context at all and `getStaffContext()` returns null.
 * That includes a platform admin who holds no membership — see the note on
 * `isPlatformAdmin` below.
 */
export interface StaffContext {
  /** The canonical session shape other slices already type against (doc 03 §4). */
  session: StaffSession;
  /** The membership `session` was derived from. */
  membership: StaffMembership;
  /** Every active membership this profile holds, highest privilege first. */
  memberships: readonly StaffMembership[];
  restaurant: StaffRestaurant;
  /** The branches this caller may read or act on, by name. */
  branches: readonly StaffBranch[];
  /** `branches.map(b => b.id)`, for a fast `includes` check. */
  branchIds: readonly string[];
  /**
   * The `qros_branch` cookie when it names a branch inside `branchIds`, otherwise
   * the caller's pinned branch, otherwise the first branch in scope. UI only.
   */
  activeBranchId: string | null;
  role: StaffRole;
  /**
   * `profiles.is_platform_admin` — brief §16's SUPER_ADMIN. It is a profile flag,
   * not a `staff.role` (`ck_staff_no_super_admin` forbids that), so a platform
   * admin still needs an active membership to obtain a context. That mirrors
   * 05 §2.6.1, which calls `requireStaffSession()` before checking the flag.
   */
  isPlatformAdmin: boolean;
}

/**
 * Privilege order, used to pick the primary membership when someone works for
 * several restaurants or holds several roles. Higher is more privileged.
 */
const ROLE_RANK: Readonly<Record<StaffRole, number>> = {
  RESTAURANT_OWNER: 3,
  MANAGER: 2,
  WAITER: 1,
  KITCHEN: 0,
};

/**
 * The signed-in Supabase user, or null.
 *
 * MUST stay `getUser()` and never `getSession()`: `getSession()` decodes the
 * cookie without revalidating it against the auth server, which makes it a
 * forgeable identity on the server. Cached so the round trip happens once.
 */
export const getSession = cache(async (): Promise<User | null> => {
  // Demo mode: no Supabase project, therefore no auth server to ask.
  if (!isSupabaseConfigured()) return null;

  const supabase = await createServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error !== null) return null;
  return data.user;
});

function toMembership(row: {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  role: StaffRole;
  permissions: Json;
}): StaffMembership {
  return {
    staffId: row.id,
    restaurantId: row.restaurant_id,
    branchId: row.branch_id,
    role: row.role,
    permissions: row.permissions,
  };
}

/**
 * Build the context from an already-authenticated client.
 *
 * Exported so the sign-in action can use the client it has just authenticated
 * rather than re-reading cookies through the `React.cache()`d wrapper, whose
 * entry for this request was populated (as null) before the credentials existed.
 */
export async function loadStaffContext(
  supabase: ServerSupabaseClient,
  user: User,
): Promise<StaffContext | null> {
  const [profileResult, staffResult] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).maybeSingle(),
    supabase.from('staff').select('*').eq('profile_id', user.id).eq('is_active', true),
  ]);

  const profile = profileResult.data;
  // A suspended human is signed out everywhere, in every tenant they belong to.
  if (profile === null || !profile.is_active) return null;

  const rows = [...(staffResult.data ?? [])].sort((a, b) => {
    const byRank = ROLE_RANK[b.role] - ROLE_RANK[a.role];
    if (byRank !== 0) return byRank;
    return a.created_at.localeCompare(b.created_at);
  });

  const primaryRow = rows[0];
  if (primaryRow === undefined) return null;

  const [restaurantResult, branchResult] = await Promise.all([
    supabase
      .from('restaurants')
      .select('*')
      .eq('id', primaryRow.restaurant_id)
      .is('deleted_at', null)
      .maybeSingle(),
    supabase
      .from('branches')
      .select('*')
      .eq('restaurant_id', primaryRow.restaurant_id)
      .is('deleted_at', null)
      .order('name', { ascending: true }),
  ]);

  const restaurantRow = restaurantResult.data;
  // A deactivated tenant has no usable surface; treat it as no session at all
  // rather than rendering an admin panel over a restaurant that is switched off.
  if (restaurantRow === null || !restaurantRow.is_active) return null;

  const memberships = rows.map(toMembership);
  const inTenant = memberships.filter((m) => m.restaurantId === primaryRow.restaurant_id);
  // A branch_id of null means restaurant-wide. Platform admins see the tenant
  // whole, which is what `has_branch_access` already grants them in SQL.
  const restaurantWide = profile.is_platform_admin || inTenant.some((m) => m.branchId === null);
  const pinned = new Set(
    inTenant.map((m) => m.branchId).filter((id): id is string => id !== null),
  );

  const branches: StaffBranch[] = (branchResult.data ?? [])
    .filter((row) => restaurantWide || pinned.has(row.id))
    .map((row) => ({
      id: row.id,
      name: row.name,
      code: row.code,
      timezone: row.timezone,
      isActive: row.is_active,
      isAcceptingOrders: row.is_accepting_orders,
      lateOrderThresholdMinutes: row.late_order_threshold_minutes,
      defaultPrepMinutes: row.default_prep_minutes,
      serviceFeeBps: row.service_fee_bps,
    }));

  const branchIds = branches.map((branch) => branch.id);

  const cookieStore = await cookies();
  const requestedBranch = cookieStore.get(BRANCH_COOKIE)?.value ?? null;
  const activeBranchId =
    requestedBranch !== null && branchIds.includes(requestedBranch)
      ? requestedBranch
      : (primaryRow.branch_id ?? branchIds[0] ?? null);

  const session: StaffSession = {
    profileId: profile.id,
    staffId: primaryRow.id,
    restaurantId: primaryRow.restaurant_id,
    branchId: primaryRow.branch_id,
    role: primaryRow.role,
    isPlatformAdmin: profile.is_platform_admin,
    // No hard-coded English fallback here: a UI that has nothing to show falls
    // back to its own localised placeholder (`common.unnamed`).
    displayName:
      primaryRow.display_name ?? profile.full_name ?? profile.email ?? user.email ?? '',
    email: profile.email,
    avatarUrl: profile.avatar_url,
    locale: profile.locale,
  };

  const membership = toMembership(primaryRow);

  return {
    session,
    membership,
    memberships,
    restaurant: {
      id: restaurantRow.id,
      name: restaurantRow.name,
      slug: restaurantRow.slug,
      logoUrl: restaurantRow.logo_url,
      currency: restaurantRow.currency,
      currencyDecimals: restaurantRow.currency_decimals,
      defaultLocale: restaurantRow.default_locale,
      serviceFeeBps: restaurantRow.service_fee_bps,
      serviceFeeEnabled: restaurantRow.service_fee_enabled,
      isActive: restaurantRow.is_active,
      isDemo: restaurantRow.is_demo,
    },
    branches,
    branchIds,
    activeBranchId,
    role: membership.role,
    isPlatformAdmin: profile.is_platform_admin,
  };
}

/**
 * The caller's restaurant, branches and role — or null when nobody is signed in,
 * the profile is suspended, the tenant is deactivated, or there is no active
 * `staff` row. Every staff page starts here.
 */
export const getStaffContext = cache(async (): Promise<StaffContext | null> => {
  const user = await getSession();
  if (user === null) return null;

  const supabase = await createServerClient();
  return loadStaffContext(supabase, user);
});

/** True when `branchId` is inside this context's scope. Pure; no I/O. */
export function canAccessBranch(context: StaffContext, branchId: string): boolean {
  return context.branchIds.includes(branchId);
}
