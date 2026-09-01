import 'server-only';

/**
 * src/lib/auth/guards.ts — the authorization affordances every staff surface uses.
 * Source: 05-app-structure.md §4.4 (capability matrix), §4.5 (post-login redirects);
 * 02-security-and-rls.md §4.5.
 *
 * THE RULE, STATED ONCE. A route being reachable is decided in four independent
 * places: middleware (UX), the layout (redirect), these guards (a good refusal),
 * and RLS (the truth). Removing any of the first three degrades the experience.
 * Removing the fourth is a breach. Nothing in this file is a security boundary —
 * it exists to produce a correct redirect and a legible error, and it mirrors the
 * SQL predicates in doc 02 §4.5 so the two never disagree.
 */

import { notFound, redirect } from 'next/navigation';

import { appError, AppErrorException } from '@/lib/result';
import { canAccessBranch, getStaffContext, type StaffContext } from '@/lib/auth/session';
import type { StaffRole } from '@/types/database';

/** The four things a staff surface can require. Mirrors doc 05 §4.4. */
export type Capability = 'kitchen' | 'waiter' | 'admin' | 'platform';

/**
 * The capability matrix. A platform admin (`profiles.is_platform_admin`) satisfies
 * every capability and is handled separately, because SUPER_ADMIN is not a
 * `staff.role` — `ck_staff_no_super_admin` makes it unrepresentable there.
 */
export const CAPABILITY_ROLES: Readonly<Record<Capability, readonly StaffRole[]>> = {
  kitchen: ['KITCHEN', 'MANAGER', 'RESTAURANT_OWNER'],
  waiter: ['WAITER', 'MANAGER', 'RESTAURANT_OWNER'],
  admin: ['MANAGER', 'RESTAURANT_OWNER'],
  platform: [],
};

/** The surface a role lands on after a successful sign-in (doc 05 §4.5). */
export function landingPathFor(context: StaffContext): string {
  if (context.isPlatformAdmin) return '/admin/platform';
  switch (context.role) {
    case 'KITCHEN':
      return '/kitchen';
    case 'WAITER':
      return '/waiter';
    case 'MANAGER':
    case 'RESTAURANT_OWNER':
      return '/admin';
  }
}

/** Pure predicate over an already-loaded context. No I/O, safe to call in a loop. */
export function hasRole(context: StaffContext, ...roles: readonly StaffRole[]): boolean {
  return context.isPlatformAdmin || roles.includes(context.role);
}

/** Pure predicate for a capability. */
export function hasCapability(context: StaffContext, capability: Capability): boolean {
  if (context.isPlatformAdmin) return true;
  return CAPABILITY_ROLES[capability].includes(context.role);
}

/** Which capability a path needs, or null when the path is not a staff surface. */
function capabilityForPath(path: string): Capability | null {
  if (path === '/admin/platform' || path.startsWith('/admin/platform/')) return 'platform';
  if (path === '/admin' || path.startsWith('/admin/')) return 'admin';
  if (path === '/kitchen' || path.startsWith('/kitchen/')) return 'kitchen';
  if (path === '/waiter' || path.startsWith('/waiter/')) return 'waiter';
  return null;
}

/**
 * Is this path something this session may actually open?
 *
 * Used by the sign-in action so a KITCHEN member carrying a stale `?next=/admin`
 * lands on /kitchen instead of bouncing off the admin layout.
 */
export function isPathReachable(context: StaffContext, path: string): boolean {
  const capability = capabilityForPath(path);
  if (capability === null) return true;
  return hasCapability(context, capability);
}

/**
 * Sanitize a `?next=` value. Prevents open redirects, protocol-relative escapes
 * and backslash tricks, and prevents bouncing a signed-in staff member into the
 * customer app or an API route.
 *
 * Accepts only a same-origin path that starts with a single '/'. Anything else
 * returns `fallback`.
 */
export function safeNextPath(
  candidate: string | null | undefined,
  fallback = '/admin',
): string {
  if (typeof candidate !== 'string') return fallback;

  const value = candidate.trim();
  if (value.length === 0 || value.length > 512) return fallback;
  if (!value.startsWith('/')) return fallback;
  // '//host' and '/\host' are both read as protocol-relative by some parsers.
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // Control characters and whitespace are how a header-splitting or
  // scheme-smuggling payload gets past a naive prefix check.
  if (/[\u0000-\u0020\u007f\s]/.test(value)) return fallback;

  const pathname = value.split(/[?#]/)[0] ?? '/';
  // A colon anywhere in the path is only ever an attempt at a scheme.
  if (pathname.includes(':')) return fallback;
  if (pathname === '/login' || pathname.startsWith('/login/')) return fallback;
  if (pathname.startsWith('/t/') || pathname.startsWith('/api/')) return fallback;

  return value;
}

/** The sign-in URL a guard sends an anonymous caller to. */
export function loginPathFor(next: string): string {
  return `/login?next=${encodeURIComponent(safeNextPath(next))}`;
}

/**
 * The context, or a redirect to /login.
 *
 * `next` is passed explicitly because a Server Component has no reliable "current
 * pathname": guessing from `referer` sends people to the wrong screen after they
 * sign in. A layout knows its own route, so it says so.
 */
export async function requireStaffContext(next = '/admin'): Promise<StaffContext> {
  const context = await getStaffContext();
  if (context !== null) return context;
  redirect(loginPathFor(next));
}

/**
 * Require one of `roles`.
 *
 * No session → /login. Wrong role → the caller's own landing surface, which is
 * always reachable for that role, so this cannot loop. `redirect` throws, so
 * nothing after a failed check executes.
 */
export async function requireRole(...roles: readonly StaffRole[]): Promise<StaffContext> {
  const context = await requireStaffContext();
  if (hasRole(context, ...roles)) return context;
  redirect(landingPathFor(context));
}

/** Require a capability rather than an explicit role list. Same redirect policy. */
export async function requireCapability(capability: Capability): Promise<StaffContext> {
  const context = await requireStaffContext(capability === 'kitchen' ? '/kitchen' : '/admin');
  if (hasCapability(context, capability)) return context;
  redirect(landingPathFor(context));
}

/**
 * Platform-admin only. `notFound()` rather than a redirect or a 403: a manager
 * probing /admin/platform must not learn whether the route exists (doc 05 §2.6.1).
 */
export async function requirePlatformAdmin(): Promise<StaffContext> {
  const context = await requireStaffContext('/admin');
  if (context.isPlatformAdmin) return context;
  notFound();
}

/**
 * Require access to one branch — the 403 half of this module.
 *
 * Throws `AppErrorException(FORBIDDEN)` instead of redirecting, because a caller
 * asking for a specific branch has usually followed a link or submitted a form:
 * bouncing them to another screen hides what happened, whereas the thrown error
 * carries `httpStatus: 403` for a route handler and a localisable code
 * (`errors.app.FORBIDDEN`) for a page. Use `canAccessBranch()` when you want a
 * boolean instead.
 */
export async function requireBranchAccess(branchId: string): Promise<StaffContext> {
  const context = await requireStaffContext();
  if (canAccessBranch(context, branchId)) return context;
  throw new AppErrorException(
    appError('FORBIDDEN', `branch ${branchId} is outside the caller's scope`, {
      details: { branchId, restaurantId: context.restaurant.id },
    }),
  );
}
