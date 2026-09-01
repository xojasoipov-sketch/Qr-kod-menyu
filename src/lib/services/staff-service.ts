import 'server-only'

/**
 * The staff roster (brief §16).
 *
 * This is one of exactly two modules permitted to construct
 * `createAdminClient()` (doc 03 §9.2.6), and it uses it for exactly one thing:
 * creating the `auth.users` row for an invitation, which the GoTrue admin API
 * is the only way to do. Everything else — the `public.staff` INSERT, the role
 * change, the deactivation — goes through the CALLER'S cookie client, so
 * `staff_insert_manager`, `trg_staff_guard()` and the escalation checks all
 * apply. Doing the INSERT with the admin client would silently disarm every one
 * of them.
 */
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { appUrl } from '@/lib/env'
import { mapPgError } from '@/lib/security/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/auth/session'
import type { StaffInput } from '@/lib/validation/tenancy'
import type { ProfileRow, StaffRole, StaffRow } from '@/types/database'
import type { StaffSession } from '@/types/domain'
import type { Locale } from '@/types/i18n'

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export interface StaffAdminView {
  id: string
  profileId: string
  branchId: string | null
  role: StaffRole
  displayName: string
  email: string | null
  employeeCode: string | null
  avatarUrl: string | null
  locale: Locale
  isActive: boolean
  isPlatformAdmin: boolean
  invitedAt: string | null
  joinedAt: string | null
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const STAFF_MANAGER_ROLES: readonly StaffRole[] = ['RESTAURANT_OWNER', 'MANAGER']

async function requireSession(): Promise<StaffSession> {
  // StaffContext.session is exactly the StaffSession shape this file's
  // guards operate on (@/lib/auth/session), so the rest of the file needs
  // no other change.
  const context = await getStaffContext()
  if (!context) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return context.session
}

function assertCanManageStaff(session: StaffSession): void {
  if (session.isPlatformAdmin) return
  if (!STAFF_MANAGER_ROLES.includes(session.role)) {
    throw new AppErrorException(
      appError('FORBIDDEN', `${session.role} may not manage staff`, {
        wire: 'QR050_FORBIDDEN',
        details: { role: session.role },
      }),
    )
  }
}

/**
 * Only an owner may mint another owner. A manager promoting themselves — or a
 * colleague — to RESTAURANT_OWNER is the escalation `trg_staff_guard()` refuses
 * with QR055; refusing it here too means the form can say why.
 */
function assertNoEscalation(session: StaffSession, role: StaffRole): void {
  if (session.isPlatformAdmin || session.role === 'RESTAURANT_OWNER') return
  if (role === 'RESTAURANT_OWNER') {
    throw new AppErrorException(
      appError('FORBIDDEN', 'only an owner may grant ownership', {
        wire: 'QR055_PRIVILEGE_ESCALATION',
        details: { role },
      }),
    )
  }
}

/** Editing your own membership is QR056 in the database, and a footgun everywhere else. */
function assertNotSelf(session: StaffSession, staffId: string): void {
  if (session.staffId === staffId) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'a staff member may not modify their own membership', {
        wire: 'QR056_SELF_MODIFICATION',
        details: { staffId },
      }),
    )
  }
}

function assertBranchScope(session: StaffSession, branchId: string | null): void {
  if (branchId === null || session.isPlatformAdmin) return
  if (session.branchId !== null && session.branchId !== branchId) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'branch outside this session', {
        wire: 'QR050_FORBIDDEN',
        details: { branchId },
      }),
    )
  }
}

function notFound(): AppErrorException {
  return new AppErrorException(
    appError('NOT_FOUND', 'staff member not found', {
      wire: 'QR030_NOT_FOUND',
      details: { entity: 'staff' },
    }),
  )
}

type ProfileLite = Pick<
  ProfileRow,
  'id' | 'email' | 'full_name' | 'avatar_url' | 'locale' | 'is_platform_admin'
>

function toStaffView(row: StaffRow, profile: ProfileLite | undefined): StaffAdminView {
  return {
    id: row.id,
    profileId: row.profile_id,
    branchId: row.branch_id,
    role: row.role,
    displayName: row.display_name ?? profile?.full_name ?? profile?.email ?? 'Staff',
    email: profile?.email ?? null,
    employeeCode: row.employee_code,
    avatarUrl: profile?.avatar_url ?? null,
    locale: profile?.locale ?? 'uz',
    isActive: row.is_active,
    isPlatformAdmin: profile?.is_platform_admin ?? false,
    invitedAt: row.invited_at,
    joinedAt: row.joined_at,
    updatedAt: row.updated_at,
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listStaff(): Promise<Result<StaffAdminView[]>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageStaff(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('staff')
      .select('*')
      .order('created_at', { ascending: true })

    if (error) throw new AppErrorException(mapPgError(error))
    const rows: StaffRow[] = data ?? []
    if (rows.length === 0) return []

    const { data: profiles, error: profileError } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, locale, is_platform_admin')
      .in('id', rows.map((row) => row.profile_id))

    if (profileError) throw new AppErrorException(mapPgError(profileError))

    const byId = new Map<string, ProfileLite>((profiles ?? []).map((p) => [p.id, p]))
    return rows.map((row) => toStaffView(row, byId.get(row.profile_id)))
  })
}

export async function getStaffMember(id: string): Promise<Result<StaffAdminView>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageStaff(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase.from('staff').select('*').eq('id', id).maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()

    const { data: profile } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, locale, is_platform_admin')
      .eq('id', data.profile_id)
      .maybeSingle()

    return toStaffView(data, profile ?? undefined)
  })
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Invite a colleague, or attach an existing profile to this restaurant.
 *
 * The two halves are deliberately asymmetric in privilege:
 *   - creating the login is an admin-API operation, done with the service role
 *     and nothing else;
 *   - creating the membership is a tenant operation, done as the caller so RLS
 *     and the guard trigger decide whether it is allowed at all.
 */
export async function inviteStaff(input: StaffInput): Promise<Result<{ staffId: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageStaff(session)
    assertNoEscalation(session, input.role)
    assertBranchScope(session, input.branch_id)

    let profileId = input.profile_id

    if (profileId === null) {
      if (input.invite_email === null) {
        throw new AppErrorException(
          appError('VALIDATION_FAILED', 'an invitation needs an email', {
            wire: 'QR023_INVALID_PAYLOAD',
            details: { field: 'invite_email' },
          }),
        )
      }

      const admin = createAdminClient()
      const { data, error } = await admin.auth.admin.inviteUserByEmail(input.invite_email, {
        redirectTo: `${appUrl()}/api/auth/callback?next=/accept-invite`,
      })

      if (error || !data.user) {
        throw new AppErrorException(
          appError('UNKNOWN', error?.message ?? 'invitation could not be created', {
            details: { field: 'invite_email' },
          }),
        )
      }

      profileId = data.user.id
    }

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('staff')
      .insert({
        restaurant_id: session.restaurantId,
        branch_id: input.branch_id,
        profile_id: profileId,
        role: input.role,
        display_name: input.display_name,
        employee_code: input.employee_code,
        is_active: input.is_active,
        invited_at: new Date().toISOString(),
      })
      .select('id')
      .single()

    if (error) throw new AppErrorException(mapPgError(error))
    return { staffId: data.id }
  })
}

export async function updateStaff(
  input: StaffInput & { id: string },
): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageStaff(session)
    assertNotSelf(session, input.id)
    assertNoEscalation(session, input.role)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('staff')
      .update({
        branch_id: input.branch_id,
        role: input.role,
        display_name: input.display_name,
        employee_code: input.employee_code,
        is_active: input.is_active,
      })
      .eq('id', input.id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()
    return null
  })
}

/**
 * Deactivate rather than delete: `orders.confirmed_by_staff_id` and the status
 * history point at this row, and an audit trail that loses its actor stops
 * being an audit trail. `getStaffContext()` reads `is_active` live, so the
 * effect is immediate on the deactivated person's next query (doc 02 §8.1).
 */
export async function deactivateStaff(id: string): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageStaff(session)
    assertNotSelf(session, id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('staff')
      .update({ is_active: false })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()
    return null
  })
}
