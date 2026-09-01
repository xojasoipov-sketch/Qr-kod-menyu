import 'server-only'

/**
 * Staff-side order reads and the three writes that move an order.
 *
 * The state machine is checked HERE, before anything reaches the wire, and
 * again by `trg_orders_status_guard` in Postgres afterwards. The second check is
 * the one that makes brief §34.8 true; the first exists so an illegal request
 * never leaves the process and so the operator gets a precise, localised refusal
 * instead of a generic 409.
 *
 * Every status write is also an optimistic-concurrency write: the UPDATE matches
 * on `status = expected_status`, so two waiters tapping READY on the same ticket
 * cannot both silently succeed. The second one is told the order moved.
 *
 * `src/types/database.ts` declares `Relationships: []`, so PostgREST embeds do
 * not type-check. Related rows are therefore fetched alongside and stitched in
 * memory by `attachRelations()` — one extra round trip per list, and a join a
 * reviewer can actually see.
 */
import {
  toKitchenTicket,
  toOrderView,
  type OrderItemRowWithOptions,
  type OrderRowWithRelations,
} from '@/lib/mappers/order-mapper'
import { assertTransition, type ActorRole } from '@/lib/orders/state-machine'
import { KDS_STATUSES } from '@/lib/realtime/channels'
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { PublicOrderSchema } from '@/lib/rpc/schemas'
import { mapPgError } from '@/lib/security/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/services/session'
import type { StatusUpdateInput } from '@/lib/validation/order'
import type {
  OrderItemOptionRow,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  OrderStatusHistoryRow,
  TableRow,
} from '@/types/database'
import type { KitchenTicket, OrderView, StaffSession } from '@/types/domain'

type ServerClient = Awaited<ReturnType<typeof createServerClient>>

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

async function requireSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (!session) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return session
}

/**
 * A branch-scoped session (WAITER, KITCHEN, branch MANAGER) may only name its
 * own branch — brief §34.6 and §34.7. RLS enforces it; this produces the
 * sentence a human can act on.
 */
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

/** The actor the state machine reasons about. Taken from the session, never from the client. */
function actorOf(session: StaffSession): ActorRole {
  return session.isPlatformAdmin ? 'SUPER_ADMIN' : session.role
}

function notFound(entity: string): AppErrorException {
  return new AppErrorException(
    appError('NOT_FOUND', `${entity} not found`, {
      wire: 'QR030_NOT_FOUND',
      details: { entity },
    }),
  )
}

/* ------------------------------------------------------------------ */
/* Relation stitching                                                  */
/* ------------------------------------------------------------------ */

interface RelationOptions {
  withLines?: boolean
  withHistory?: boolean
}

/**
 * Fetch the rows an order view needs and hang them off the order rows.
 *
 * Three `IN` queries at most, whatever the page size — not N+1. The cost of not
 * having PostgREST embeds is one round trip per relation, not one per order.
 */
async function attachRelations(
  supabase: ServerClient,
  orders: readonly OrderRow[],
  options: RelationOptions = {},
): Promise<OrderRowWithRelations[]> {
  if (orders.length === 0) return []

  const orderIds = orders.map((order) => order.id)
  const tableIds = [
    ...new Set(orders.map((order) => order.table_id).filter((id): id is string => id !== null)),
  ]

  const itemsByOrder = new Map<string, OrderItemRowWithOptions[]>()

  if (options.withLines !== false) {
    const { data: items, error } = await supabase
      .from('order_items')
      .select('*')
      .in('order_id', orderIds)
    if (error) throw new AppErrorException(mapPgError(error))

    const itemRows: OrderItemRow[] = items ?? []
    const optionsByItem = new Map<string, OrderItemOptionRow[]>()

    if (itemRows.length > 0) {
      const { data: itemOptions, error: optionError } = await supabase
        .from('order_item_options')
        .select('*')
        .in('order_item_id', itemRows.map((item) => item.id))
      if (optionError) throw new AppErrorException(mapPgError(optionError))

      for (const option of itemOptions ?? []) {
        const bucket = optionsByItem.get(option.order_item_id) ?? []
        bucket.push(option)
        optionsByItem.set(option.order_item_id, bucket)
      }
    }

    for (const item of itemRows) {
      const bucket = itemsByOrder.get(item.order_id) ?? []
      bucket.push({ ...item, order_item_options: optionsByItem.get(item.id) ?? [] })
      itemsByOrder.set(item.order_id, bucket)
    }
  }

  const tablesById = new Map<string, Pick<TableRow, 'number' | 'name'>>()
  if (tableIds.length > 0) {
    const { data: tables, error } = await supabase
      .from('tables')
      .select('id, number, name')
      .in('id', tableIds)
    if (error) throw new AppErrorException(mapPgError(error))
    for (const table of tables ?? []) {
      tablesById.set(table.id, { number: table.number, name: table.name })
    }
  }

  const historyByOrder = new Map<string, Pick<OrderStatusHistoryRow, 'new_status' | 'created_at'>[]>()
  if (options.withHistory) {
    const { data: history, error } = await supabase
      .from('order_status_history')
      .select('order_id, new_status, created_at')
      .in('order_id', orderIds)
    if (error) throw new AppErrorException(mapPgError(error))

    for (const event of history ?? []) {
      const bucket = historyByOrder.get(event.order_id) ?? []
      bucket.push({ new_status: event.new_status, created_at: event.created_at })
      historyByOrder.set(event.order_id, bucket)
    }
  }

  return orders.map((order) => ({
    ...order,
    order_items: itemsByOrder.get(order.id) ?? [],
    tables: order.table_id ? (tablesById.get(order.table_id) ?? null) : null,
    order_status_history: historyByOrder.get(order.id) ?? [],
  }))
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export interface OrderFilters {
  status?: readonly OrderStatus[]
  /** Business date, 'YYYY-MM-DD', in the branch timezone. */
  businessDate?: string | null
  /** Matches `order_number` (case-insensitive, partial). */
  search?: string | null
  limit?: number
  offset?: number
}

export interface OrderListPage {
  orders: OrderView[]
  total: number
  limit: number
  offset: number
}

const DEFAULT_PAGE_SIZE = 50
const MAX_PAGE_SIZE = 200

export async function listOrders(
  branchId: string,
  filters: OrderFilters = {},
): Promise<Result<OrderListPage>> {
  return toResult(async () => {
    const session = await requireSession()
    assertBranchScope(session, branchId)

    const limit = Math.min(Math.max(filters.limit ?? DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE)
    const offset = Math.max(filters.offset ?? 0, 0)

    const supabase = await createServerClient()

    let query = supabase
      .from('orders')
      .select('*', { count: 'exact' })
      .eq('branch_id', branchId)
      .order('placed_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filters.status && filters.status.length > 0) query = query.in('status', filters.status)
    if (filters.businessDate) query = query.eq('business_date', filters.businessDate)
    if (filters.search) query = query.ilike('order_number', `%${filters.search}%`)

    const { data, error, count } = await query
    if (error) throw new AppErrorException(mapPgError(error))

    const rows = await attachRelations(supabase, data ?? [])

    return {
      orders: rows.map((row) => toOrderView(row)),
      total: count ?? rows.length,
      limit,
      offset,
    }
  })
}

/** One order, with lines, options and the full status trail. */
export async function getOrder(id: string): Promise<Result<OrderView>> {
  return toResult(async () => {
    await requireSession()
    const supabase = await createServerClient()

    const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle()
    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('order')

    const [row] = await attachRelations(supabase, [data], { withHistory: true })
    if (!row) throw notFound('order')
    return toOrderView(row)
  })
}

/**
 * The kitchen board (brief §9).
 *
 * Only the four open statuses, only the last 24 hours, ordered oldest first —
 * a cook works the queue from the top, and a ticket that has scrolled off the
 * bottom is a ticket nobody cooks.
 */
export async function listKitchenTickets(
  branchId: string,
  options: { now?: Date } = {},
): Promise<Result<KitchenTicket[]>> {
  return toResult(async () => {
    const session = await requireSession()
    assertBranchScope(session, branchId)

    const now = options.now ?? new Date()
    const supabase = await createServerClient()

    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('late_order_threshold_minutes, default_prep_minutes')
      .eq('id', branchId)
      .maybeSingle()

    if (branchError) throw new AppErrorException(mapPgError(branchError))
    if (!branch) throw notFound('branch')

    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabase
      .from('orders')
      .select('*')
      .eq('branch_id', branchId)
      .in('status', KDS_STATUSES)
      .gte('placed_at', since)
      .order('placed_at', { ascending: true })

    if (error) throw new AppErrorException(mapPgError(error))

    const rows = await attachRelations(supabase, data ?? [])

    return rows.map((row) =>
      toKitchenTicket(row, {
        now,
        lateThresholdMinutes: branch.late_order_threshold_minutes,
        defaultPrepMinutes: branch.default_prep_minutes,
      }),
    )
  })
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

async function readOrderView(supabase: ServerClient, id: string): Promise<OrderView> {
  const { data, error } = await supabase.from('orders').select('*').eq('id', id).maybeSingle()
  if (error) throw new AppErrorException(mapPgError(error))
  if (!data) throw notFound('order')

  const [row] = await attachRelations(supabase, [data], { withHistory: true })
  if (!row) throw notFound('order')
  return toOrderView(row)
}

/**
 * Move an order along the state machine.
 *
 * `input.actor` is IGNORED. The actor is the session's role, because a client
 * that could name its own actor could name `SUPER_ADMIN` and walk every edge.
 */
export async function updateOrderStatus(
  input: StatusUpdateInput,
): Promise<Result<OrderView>> {
  return toResult(async () => {
    const session = await requireSession()
    const actor = actorOf(session)

    // 1. Mirror check. Keeps an illegal request off the wire and produces the
    //    localised INVALID_TRANSITION / FORBIDDEN distinction the UI branches on.
    assertTransition(input.expected_status, input.next_status, actor)

    const supabase = await createServerClient()

    // 2. Optimistic concurrency: the row must still be in expected_status.
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: input.next_status,
        ...(input.cancellation_reason !== null
          ? { cancellation_reason: input.cancellation_reason }
          : {}),
      })
      .eq('id', input.order_id)
      .eq('status', input.expected_status)
      .select('id, branch_id')
      .maybeSingle()

    // 3. Postgres is authoritative: trg_orders_status_guard may still refuse
    //    (QR040), and its refusal outranks anything step 1 concluded.
    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) {
      throw new AppErrorException(
        appError('INVALID_TRANSITION', 'order moved before this update landed', {
          wire: 'QR040_INVALID_STATUS_TRANSITION',
          details: { from: input.expected_status, to: input.next_status },
        }),
      )
    }

    assertBranchScope(session, data.branch_id)
    return readOrderView(supabase, data.id)
  })
}

/**
 * The one-tap KDS / waiter buttons.
 *
 * `expected_status` is read server-side rather than supplied by the client —
 * that is what makes the concurrency guard meaningful instead of decorative.
 */
export async function advanceOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
  cancellationReason: string | null = null,
): Promise<Result<OrderView>> {
  return toResult(async () => {
    await requireSession()
    const supabase = await createServerClient()

    const { data, error } = await supabase
      .from('orders')
      .select('status')
      .eq('id', orderId)
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('order')

    const result = await updateOrderStatus({
      order_id: orderId,
      expected_status: data.status,
      next_status: nextStatus,
      actor: 'SYSTEM', // ignored; the session decides. Present because the schema requires it.
      cancellation_reason: cancellationReason,
    })

    if (!result.ok) throw new AppErrorException(result.error)
    return result.data
  })
}

/**
 * Staff cancellation. A reason is mandatory — `ck_orders_cancelled_shape`
 * refuses the row without one (QR042), and "cancelled, no reason given" is
 * useless to the guest and to the next shift alike.
 */
export async function cancelOrder(
  orderId: string,
  reason: string,
): Promise<Result<OrderView>> {
  return toResult(async () => {
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      throw new AppErrorException(
        appError('VALIDATION_FAILED', 'a cancellation reason is required', {
          wire: 'QR042_CANCEL_REASON_REQUIRED',
          details: { field: 'reason' },
        }),
      )
    }

    const result = await advanceOrderStatus(orderId, 'cancelled', trimmed)
    if (!result.ok) throw new AppErrorException(result.error)
    return result.data
  })
}

/**
 * Void one line of an open order.
 *
 * Delegated to `staff_void_order_item`, which is the ONLY writer of
 * `order_items`: `authenticated` holds no DML on that table at all. The RPC
 * deletes the line and re-derives the order totals from the surviving lines and
 * the ORDER's snapshotted fee rate — never the branch's current one — so an
 * order placed before a fee change still balances.
 */
export async function voidLine(
  orderItemId: string,
  reason: string,
): Promise<Result<OrderView>> {
  return toResult(async () => {
    await requireSession()
    const supabase = await createServerClient()

    const { data, error } = await supabase.rpc('staff_void_order_item', {
      p_order_item_id: orderItemId,
      p_reason: reason,
    })

    if (error) throw new AppErrorException(mapPgError(error))

    const parsed = PublicOrderSchema.safeParse(data)
    if (!parsed.success) {
      throw new AppErrorException(
        appError('UNKNOWN', 'staff_void_order_item returned an unrecognised payload', {
          httpStatus: 502,
          details: { issues: parsed.error.issues },
          retryable: false,
        }),
      )
    }

    return toOrderView(parsed.data)
  })
}
