import 'server-only'

/**
 * The waiter console's data (brief §10).
 *
 * A waiter call has its own small state machine, separate from the order one:
 * `pending -> acknowledged -> resolved`, with `cancelled` (the guest withdrew)
 * and `expired` (the branch's expiry window elapsed) reachable only from the
 * customer and the system respectively. Staff may traverse exactly two edges,
 * and `waiterCallUpdateSchema` is typed so that no other value can arrive.
 *
 * Calls are never created here. `public_call_waiter` is the only writer, because
 * it is also where the per-table cooldown is enforced under `FOR UPDATE` —
 * brief §10's "cooldown prevents spam" is a database guarantee, not a disabled
 * button.
 */
import { byUrgency, toWaiterCallView } from '@/lib/mappers/waiter-mapper'
import { OPEN_CALL_STATUSES } from '@/lib/realtime/channels'
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { mapPgError } from '@/lib/security/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffContext } from '@/lib/auth/session'
import type { WaiterCallUpdateInput } from '@/lib/validation/waiter'
import type { StaffRole, WaiterCallRow, WaiterCallStatus } from '@/types/database'
import type { StaffSession, WaiterCallView } from '@/types/domain'

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

const WAITER_ROLES: readonly StaffRole[] = ['RESTAURANT_OWNER', 'MANAGER', 'WAITER']

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

function assertWaiterCapability(session: StaffSession): void {
  if (session.isPlatformAdmin) return
  if (!WAITER_ROLES.includes(session.role)) {
    throw new AppErrorException(
      appError('FORBIDDEN', `${session.role} may not work waiter calls`, {
        wire: 'QR050_FORBIDDEN',
        details: { role: session.role },
      }),
    )
  }
}

/** Brief §34.6: a waiter sees their own branch and nothing else. */
function assertBranchScope(session: StaffSession, branchId: string): void {
  if (session.isPlatformAdmin) return
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
    appError('NOT_FOUND', 'waiter call not found', {
      wire: 'QR030_NOT_FOUND',
      details: { entity: 'waiter_call' },
    }),
  )
}

/**
 * The legal staff moves. Mirrors the SQL check that raises QR041; a client that
 * asks for `resolved` on an already-resolved call is told so rather than
 * silently no-op'd.
 */
const CALL_TRANSITIONS: Readonly<Record<WaiterCallStatus, readonly WaiterCallStatus[]>> = {
  pending: ['acknowledged', 'resolved'],
  acknowledged: ['resolved'],
  resolved: [],
  cancelled: [],
  expired: [],
}

function assertCallTransition(from: WaiterCallStatus, to: WaiterCallStatus): void {
  if (!CALL_TRANSITIONS[from].includes(to)) {
    throw new AppErrorException(
      appError('INVALID_TRANSITION', `illegal waiter-call transition ${from} -> ${to}`, {
        wire: 'QR041_INVALID_CALL_TRANSITION',
        details: { from, to },
      }),
    )
  }
}

/**
 * Table numbers and order numbers, keyed by id.
 *
 * `src/types/database.ts` declares `Relationships: []`, so PostgREST embeds do
 * not type-check; the join is done here, in memory, where it is auditable.
 */
async function decorate(
  supabase: ServerClient,
  rows: readonly WaiterCallRow[],
  now: Date,
): Promise<WaiterCallView[]> {
  if (rows.length === 0) return []

  const tableIds = [...new Set(rows.map((row) => row.table_id))]
  const orderIds = [
    ...new Set(rows.map((row) => row.order_id).filter((id): id is string => id !== null)),
  ]
  const staffIds = [
    ...new Set(
      rows.map((row) => row.acknowledged_by_staff_id).filter((id): id is string => id !== null),
    ),
  ]

  const { data: tables, error: tableError } = await supabase
    .from('tables')
    .select('id, number, name')
    .in('id', tableIds)
  if (tableError) throw new AppErrorException(mapPgError(tableError))

  const tablesById = new Map((tables ?? []).map((row) => [row.id, row]))

  const ordersById = new Map<string, { order_number: string }>()
  if (orderIds.length > 0) {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('id, order_number')
      .in('id', orderIds)
    if (error) throw new AppErrorException(mapPgError(error))
    for (const order of orders ?? []) ordersById.set(order.id, { order_number: order.order_number })
  }

  const staffById = new Map<string, { id: string; display_name: string | null }>()
  if (staffIds.length > 0) {
    const { data: staff, error } = await supabase
      .from('staff')
      .select('id, display_name')
      .in('id', staffIds)
    if (error) throw new AppErrorException(mapPgError(error))
    for (const member of staff ?? []) staffById.set(member.id, member)
  }

  return rows
    .map((row) =>
      toWaiterCallView(
        {
          ...row,
          tables: tablesById.get(row.table_id) ?? null,
          orders: row.order_id ? (ordersById.get(row.order_id) ?? null) : null,
          acknowledged_by: row.acknowledged_by_staff_id
            ? (staffById.get(row.acknowledged_by_staff_id) ?? null)
            : null,
        },
        { now },
      ),
    )
    .sort(byUrgency)
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * The call list for one branch. `openOnly` is the console's default: a resolved
 * call is history, and history on the working board is noise exactly when the
 * room is busy.
 */
export async function listWaiterCalls(
  branchId: string,
  openOnly = true,
  options: { now?: Date; limit?: number } = {},
): Promise<Result<WaiterCallView[]>> {
  return toResult(async () => {
    const session = await requireSession()
    assertWaiterCapability(session)
    assertBranchScope(session, branchId)

    const now = options.now ?? new Date()
    const supabase = await createServerClient()

    let query = supabase
      .from('waiter_calls')
      .select('*')
      .eq('branch_id', branchId)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(options.limit ?? 100, 1), 500))

    if (openOnly) query = query.in('status', OPEN_CALL_STATUSES)

    const { data, error } = await query
    if (error) throw new AppErrorException(mapPgError(error))

    return decorate(supabase, data ?? [], now)
  })
}

export async function getWaiterCall(id: string): Promise<Result<WaiterCallView>> {
  return toResult(async () => {
    const session = await requireSession()
    assertWaiterCapability(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('waiter_calls')
      .select('*')
      .eq('id', id)
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()

    const [view] = await decorate(supabase, [data], new Date())
    if (!view) throw notFound()
    return view
  })
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

/**
 * Advance a call.
 *
 * The UPDATE matches on the status we read, so two waiters tapping ACKNOWLEDGE
 * on the same ringing table do not both claim it — the second is told the call
 * already moved, which is the correct thing to say and the correct thing to
 * show.
 */
async function transitionCall(
  id: string,
  next: WaiterCallStatus,
): Promise<Result<WaiterCallView>> {
  return toResult(async () => {
    const session = await requireSession()
    assertWaiterCapability(session)

    const supabase = await createServerClient()

    const { data: current, error: readError } = await supabase
      .from('waiter_calls')
      .select('id, branch_id, status')
      .eq('id', id)
      .maybeSingle()

    if (readError) throw new AppErrorException(mapPgError(readError))
    if (!current) throw notFound()

    assertBranchScope(session, current.branch_id)
    assertCallTransition(current.status, next)

    const { data, error } = await supabase
      .from('waiter_calls')
      .update({ status: next })
      .eq('id', id)
      .eq('status', current.status)
      .select('*')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) {
      throw new AppErrorException(
        appError('INVALID_TRANSITION', 'the call moved before this update landed', {
          wire: 'QR041_INVALID_CALL_TRANSITION',
          details: { from: current.status, to: next },
        }),
      )
    }

    const [view] = await decorate(supabase, [data], new Date())
    if (!view) throw notFound()
    return view
  })
}

/** "I have seen it and I am walking over." */
export async function acknowledgeCall(id: string): Promise<Result<WaiterCallView>> {
  return transitionCall(id, 'acknowledged')
}

/** "Handled." */
export async function resolveCall(id: string): Promise<Result<WaiterCallView>> {
  return transitionCall(id, 'resolved')
}

/** The action-layer entry point: one parsed payload, one of two edges. */
export async function updateWaiterCall(
  input: WaiterCallUpdateInput,
): Promise<Result<WaiterCallView>> {
  return transitionCall(input.waiter_call_id, input.next_status)
}
