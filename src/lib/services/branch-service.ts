import 'server-only'

/**
 * Branches and their operational knobs (brief §17-25).
 *
 * A branch is where the product's timing lives: the timezone that decides which
 * business day an order belongs to, the late threshold the KDS flags against,
 * the prep estimate the tracker promises, and the two anti-spam intervals the
 * database enforces. Those are not cosmetic settings, so they are edited here
 * rather than scattered across whichever screen happened to need one.
 */
import { applyBps } from '@/lib/money'
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { mapPgError } from '@/lib/security/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/services/session'
import { isValidTimeZone } from '@/lib/utils/datetime'
import type { BranchInput } from '@/lib/validation/tenancy'
import type { BranchRow, StaffRole } from '@/types/database'
import type { StaffSession } from '@/types/domain'

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

export interface BranchAdminView {
  id: string
  name: string
  code: string
  address: string | null
  phone: string | null
  timezone: string
  latitude: string | null
  longitude: string | null
  /** null = inherit the restaurant rate. */
  serviceFeeBps: number | null
  /** The rate that actually applies once inheritance is resolved. */
  effectiveServiceFeeBps: number
  openingHours: BranchRow['opening_hours']
  waiterCallCooldownSeconds: number
  waiterCallExpiryMinutes: number
  orderMinIntervalSeconds: number
  defaultPrepMinutes: number
  lateOrderThresholdMinutes: number
  isActive: boolean
  isAcceptingOrders: boolean
  tableCount: number
  updatedAt: string
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const BRANCH_MANAGER_ROLES: readonly StaffRole[] = ['RESTAURANT_OWNER', 'MANAGER']

async function requireSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (!session) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return session
}

/** Creating and deleting a branch is an owner's decision, not a manager's. */
function assertCanCreateBranch(session: StaffSession): void {
  if (session.isPlatformAdmin || session.role === 'RESTAURANT_OWNER') return
  throw new AppErrorException(
    appError('FORBIDDEN', `${session.role} may not create a branch`, {
      wire: 'QR050_FORBIDDEN',
      details: { role: session.role },
    }),
  )
}

function assertCanEditBranch(session: StaffSession, branchId: string): void {
  if (session.isPlatformAdmin) return
  if (!BRANCH_MANAGER_ROLES.includes(session.role)) {
    throw new AppErrorException(
      appError('FORBIDDEN', `${session.role} may not edit a branch`, {
        wire: 'QR050_FORBIDDEN',
        details: { role: session.role },
      }),
    )
  }
  if (session.branchId !== null && session.branchId !== branchId) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'branch outside this session', {
        wire: 'QR050_FORBIDDEN',
        details: { branchId },
      }),
    )
  }
}

function notFound(entity: string): AppErrorException {
  return new AppErrorException(
    appError('NOT_FOUND', `${entity} not found`, {
      wire: 'QR030_NOT_FOUND',
      details: { entity },
    }),
  )
}

function toBranchView(
  row: BranchRow,
  restaurantFeeBps: number,
  tableCount: number,
): BranchAdminView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    latitude: row.latitude,
    longitude: row.longitude,
    serviceFeeBps: row.service_fee_bps,
    effectiveServiceFeeBps: row.service_fee_bps ?? restaurantFeeBps,
    openingHours: row.opening_hours,
    waiterCallCooldownSeconds: row.waiter_call_cooldown_seconds,
    waiterCallExpiryMinutes: row.waiter_call_expiry_minutes,
    orderMinIntervalSeconds: row.order_min_interval_seconds,
    defaultPrepMinutes: row.default_prep_minutes,
    lateOrderThresholdMinutes: row.late_order_threshold_minutes,
    isActive: row.is_active,
    isAcceptingOrders: row.is_accepting_orders,
    tableCount,
    updatedAt: row.updated_at,
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Every branch of the caller's restaurant. RLS scopes it; there is no id argument to forge. */
export async function listBranches(): Promise<Result<BranchAdminView[]>> {
  return toResult(async () => {
    const session = await requireSession()
    const supabase = await createServerClient()

    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .is('deleted_at', null)
      .order('code', { ascending: true })

    if (error) throw new AppErrorException(mapPgError(error))
    const rows: BranchRow[] = data ?? []

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('service_fee_bps')
      .eq('id', session.restaurantId)
      .maybeSingle()

    const { data: tables, error: tableError } = await supabase
      .from('tables')
      .select('branch_id')
      .is('deleted_at', null)

    if (tableError) throw new AppErrorException(mapPgError(tableError))

    const tableCounts = new Map<string, number>()
    for (const table of tables ?? []) {
      tableCounts.set(table.branch_id, (tableCounts.get(table.branch_id) ?? 0) + 1)
    }

    return rows.map((row) =>
      toBranchView(row, restaurant?.service_fee_bps ?? 0, tableCounts.get(row.id) ?? 0),
    )
  })
}

export async function getBranch(id: string): Promise<Result<BranchAdminView>> {
  return toResult(async () => {
    const session = await requireSession()
    const supabase = await createServerClient()

    const { data, error } = await supabase
      .from('branches')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('branch')

    const { data: restaurant } = await supabase
      .from('restaurants')
      .select('service_fee_bps')
      .eq('id', session.restaurantId)
      .maybeSingle()

    const { count, error: countError } = await supabase
      .from('tables')
      .select('id', { count: 'exact', head: true })
      .eq('branch_id', id)
      .is('deleted_at', null)

    if (countError) throw new AppErrorException(mapPgError(countError))

    return toBranchView(data, restaurant?.service_fee_bps ?? 0, count ?? 0)
  })
}

/**
 * What a 10 000 so'm order would be charged at this branch's rate. Used by the
 * fee editor to show the operator the consequence of the number they typed,
 * computed with the same integer half-up arithmetic as the receipt.
 */
export function previewServiceFee(subtotal: number, bps: number): number {
  return applyBps(subtotal, bps)
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

function assertTimezone(timezone: string): void {
  if (isValidTimeZone(timezone)) return
  throw new AppErrorException(
    appError('VALIDATION_FAILED', `unknown IANA timezone: ${timezone}`, {
      wire: 'QR023_INVALID_PAYLOAD',
      details: { field: 'timezone' },
    }),
  )
}

export async function createBranch(input: BranchInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanCreateBranch(session)
    assertTimezone(input.timezone)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('branches')
      .insert({
        restaurant_id: session.restaurantId,
        name: input.name,
        code: input.code,
        address: input.address,
        phone: input.phone,
        timezone: input.timezone,
        latitude: input.latitude,
        longitude: input.longitude,
        service_fee_bps: input.service_fee_bps,
        opening_hours: input.opening_hours,
        waiter_call_cooldown_seconds: input.waiter_call_cooldown_seconds,
        waiter_call_expiry_minutes: input.waiter_call_expiry_minutes,
        order_min_interval_seconds: input.order_min_interval_seconds,
        default_prep_minutes: input.default_prep_minutes,
        late_order_threshold_minutes: input.late_order_threshold_minutes,
        is_active: input.is_active,
        is_accepting_orders: input.is_accepting_orders,
      })
      .select('id')
      .single()

    if (error) throw new AppErrorException(mapPgError(error))
    return { id: data.id }
  })
}

export async function updateBranch(
  input: BranchInput & { id: string },
): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanEditBranch(session, input.id)
    assertTimezone(input.timezone)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('branches')
      .update({
        name: input.name,
        code: input.code,
        address: input.address,
        phone: input.phone,
        timezone: input.timezone,
        latitude: input.latitude,
        longitude: input.longitude,
        service_fee_bps: input.service_fee_bps,
        opening_hours: input.opening_hours,
        waiter_call_cooldown_seconds: input.waiter_call_cooldown_seconds,
        waiter_call_expiry_minutes: input.waiter_call_expiry_minutes,
        order_min_interval_seconds: input.order_min_interval_seconds,
        default_prep_minutes: input.default_prep_minutes,
        late_order_threshold_minutes: input.late_order_threshold_minutes,
        is_active: input.is_active,
        is_accepting_orders: input.is_accepting_orders,
      })
      .eq('id', input.id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('branch')
    return null
  })
}

/**
 * The "we are slammed, stop the orders" switch. Distinct from `is_active`: a
 * branch that stops accepting still shows its menu and still lets a guest call a
 * waiter — `public_place_order` is the only thing that refuses (QR003).
 */
export async function setAcceptingOrders(
  id: string,
  isAcceptingOrders: boolean,
): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanEditBranch(session, id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('branches')
      .update({ is_accepting_orders: isAcceptingOrders })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('branch')
    return null
  })
}

export async function setBranchActive(id: string, isActive: boolean): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanEditBranch(session, id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('branches')
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('branch')
    return null
  })
}
