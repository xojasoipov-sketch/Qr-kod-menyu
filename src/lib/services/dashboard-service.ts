import 'server-only'

/**
 * The admin dashboard's numbers (brief §11).
 *
 * Two rules govern this file and neither is negotiable:
 *
 * 1. **Real aggregates from real rows.** Nothing here is estimated, sampled,
 *    extrapolated or invented. Brief §11 says "no fake analytics — real data
 *    only", and a dashboard that quietly rounds a number the operator will act
 *    on is worse than one that says it has none.
 *
 * 2. **"Today" is the branch's today.** A restaurant group can span timezones,
 *    and revenue for a Tashkent branch computed against the server's UTC
 *    midnight is wrong every night on the late shift — which is precisely the
 *    shift where the number matters. `businessDateFor()` resolves the calendar
 *    date in the branch's own zone, and `orders.business_date` is stamped by the
 *    database with the same rule, so the two agree by construction.
 *
 * `isDemo` rides on the result rather than being decided by the component,
 * because a fixture number and a real number must be distinguishable at the
 * point of render (doc 05 §8.5). It is true when the queried scope contains a
 * tenant flagged `restaurants.is_demo`.
 */
import { sumMoney, type Money } from '@/lib/money'
import { isLate } from '@/lib/orders/lateness'
import { isTerminalStatus } from '@/lib/orders/state-machine'
import { OPEN_CALL_STATUSES } from '@/lib/realtime/channels'
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { mapPgError } from '@/lib/security/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/services/session'
import { businessDateFor } from '@/lib/utils/datetime'
import { ORDER_STATUSES, type OrderStatus } from '@/types/database'
import type { DashboardStats, DashboardTopItem, StaffSession } from '@/types/domain'
import type { I18nText } from '@/types/i18n'

type ReadClient =
  | Awaited<ReturnType<typeof createServerClient>>
  | ReturnType<typeof createAdminClient>

export interface DashboardOptions {
  /** Defaults to now in the branch timezone. Format 'YYYY-MM-DD'. */
  businessDate?: string
  /** The instant "now" means. Passed in so a server render and a client tick agree. */
  now?: Date
  /**
   * Aggregate across every tenant. Platform admins only, and the ONE reason
   * this module is allowed to construct the service-role client (doc 03 §9.2.6).
   */
  platformWide?: boolean
}

async function requireSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (!session) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return session
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

function zeroByStatus(): Record<OrderStatus, number> {
  const counts = {} as Record<OrderStatus, number>
  for (const status of ORDER_STATUSES) counts[status] = 0
  return counts
}

/* ------------------------------------------------------------------ */

/**
 * Every number brief §11 names, for one business date and one scope.
 *
 * @param branchId `null` means every branch the session may see — an owner's
 *                 restaurant-wide view. A branch-scoped session cannot widen it.
 */
export async function getDashboardStats(
  branchId: string | null,
  options: DashboardOptions = {},
): Promise<Result<DashboardStats>> {
  return toResult(async () => {
    const session = await requireSession()
    assertBranchScope(session, branchId)

    const now = options.now ?? new Date()

    if (options.platformWide && !session.isPlatformAdmin) {
      throw new AppErrorException(
        appError('FORBIDDEN', 'platform-wide analytics require a platform admin', {
          wire: 'QR050_FORBIDDEN',
        }),
      )
    }

    // The service-role client bypasses RLS, so it is reached only through the
    // platform-admin branch above, and only for reads.
    const supabase: ReadClient =
      options.platformWide && session.isPlatformAdmin
        ? createAdminClient()
        : await createServerClient()

    /* ---------------- tenant + branch scope ---------------- */

    const { data: restaurant, error: restaurantError } = await supabase
      .from('restaurants')
      .select('id, currency, currency_decimals, is_demo')
      .eq('id', session.restaurantId)
      .maybeSingle()

    if (restaurantError) throw new AppErrorException(mapPgError(restaurantError))
    if (!restaurant) {
      throw new AppErrorException(
        appError('NOT_FOUND', 'restaurant not found', {
          wire: 'QR030_NOT_FOUND',
          details: { entity: 'restaurant' },
        }),
      )
    }

    let branchQuery = supabase
      .from('branches')
      .select('id, timezone, late_order_threshold_minutes')
      .is('deleted_at', null)
      .order('code', { ascending: true })

    if (branchId) branchQuery = branchQuery.eq('id', branchId)
    else if (!options.platformWide) branchQuery = branchQuery.eq('restaurant_id', restaurant.id)

    const { data: branches, error: branchError } = await branchQuery
    if (branchError) throw new AppErrorException(mapPgError(branchError))

    const branchRows = branches ?? []
    const branchIds = branchRows.map((row) => row.id)

    // With no branch in scope every aggregate is legitimately zero — an empty
    // dashboard, not an error. The empty state is a real screen (brief §32).
    const timezone = branchRows[0]?.timezone ?? 'Asia/Tashkent'
    const businessDate = options.businessDate ?? businessDateFor(timezone, now)

    const thresholds = new Map(
      branchRows.map((row) => [row.id, row.late_order_threshold_minutes]),
    )

    const empty: DashboardStats = {
      restaurantId: restaurant.id,
      branchId,
      businessDate,
      timezone,
      currency: restaurant.currency,
      currencyDecimals: restaurant.currency_decimals,
      todayRevenue: 0,
      todayOrderCount: 0,
      averageOrderValue: 0,
      activeTableCount: 0,
      totalTableCount: 0,
      pendingOrderCount: 0,
      lateOrderCount: 0,
      openWaiterCallCount: 0,
      ordersByStatus: zeroByStatus(),
      topItems: [],
      cancelledOrderCount: 0,
      cancelledRevenue: 0,
      isDemo: restaurant.is_demo,
      generatedAt: now.toISOString(),
    }

    if (branchIds.length === 0) return empty

    /* ---------------- the day's orders ---------------- */

    const { data: dayOrders, error: dayError } = await supabase
      .from('orders')
      .select('id, branch_id, table_id, status, total, placed_at, confirmed_at, estimated_prep_minutes')
      .in('branch_id', branchIds)
      .eq('business_date', businessDate)

    if (dayError) throw new AppErrorException(mapPgError(dayError))

    const ordersToday = dayOrders ?? []
    const ordersByStatus = zeroByStatus()
    const countedIds: string[] = []
    const countedTotals: Money[] = []
    const cancelledTotals: Money[] = []

    for (const order of ordersToday) {
      ordersByStatus[order.status] += 1
      if (order.status === 'cancelled') {
        cancelledTotals.push(order.total)
      } else {
        countedIds.push(order.id)
        countedTotals.push(order.total)
      }
    }

    const todayRevenue = sumMoney(countedTotals)
    const todayOrderCount = countedTotals.length
    // Integer division, deliberately: an average of money in minor units is
    // itself money in minor units, and a fractional so'm is not a thing.
    const averageOrderValue =
      todayOrderCount === 0 ? 0 : Math.floor(todayRevenue / todayOrderCount)

    /* ---------------- live board state ---------------- */

    // "Right now" is not "today": an order placed before midnight and still
    // being cooked occupies its table on both sides of the business-date line.
    const { data: openOrders, error: openError } = await supabase
      .from('orders')
      .select('id, branch_id, table_id, status, placed_at, confirmed_at, estimated_prep_minutes')
      .in('branch_id', branchIds)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered'])

    if (openError) throw new AppErrorException(mapPgError(openError))

    const activeTables = new Set<string>()
    let pendingOrderCount = 0
    let lateOrderCount = 0

    for (const order of openOrders ?? []) {
      if (isTerminalStatus(order.status)) continue
      if (order.table_id) activeTables.add(order.table_id)
      if (order.status === 'pending') pendingOrderCount += 1

      const threshold = thresholds.get(order.branch_id) ?? 25
      const late = isLate(
        {
          created_at: order.placed_at,
          confirmed_at: order.confirmed_at,
          preparation_minutes: order.estimated_prep_minutes,
          status: order.status,
        },
        threshold,
        now,
      )
      if (late) lateOrderCount += 1
    }

    const { count: totalTableCount, error: tableError } = await supabase
      .from('tables')
      .select('id', { count: 'exact', head: true })
      .in('branch_id', branchIds)
      .is('deleted_at', null)

    if (tableError) throw new AppErrorException(mapPgError(tableError))

    const { count: openWaiterCallCount, error: callError } = await supabase
      .from('waiter_calls')
      .select('id', { count: 'exact', head: true })
      .in('branch_id', branchIds)
      .in('status', OPEN_CALL_STATUSES)

    if (callError) throw new AppErrorException(mapPgError(callError))

    /* ---------------- most popular dishes ---------------- */

    const topItems = await readTopItems(supabase, countedIds)

    return {
      ...empty,
      todayRevenue,
      todayOrderCount,
      averageOrderValue,
      activeTableCount: activeTables.size,
      totalTableCount: totalTableCount ?? 0,
      pendingOrderCount,
      lateOrderCount,
      openWaiterCallCount: openWaiterCallCount ?? 0,
      ordersByStatus,
      topItems,
      cancelledOrderCount: cancelledTotals.length,
      cancelledRevenue: sumMoney(cancelledTotals),
    }
  })
}

/**
 * Top five dishes of the day, by units sold.
 *
 * Grouped from `order_items` snapshots rather than from a `menu_items` join, so
 * a dish renamed or deleted at lunchtime still reports under the name it was
 * sold as. `menu_item_id` may be null for exactly that reason, and the id is
 * carried only so the row can link to a dish that still exists.
 */
async function readTopItems(
  supabase: ReadClient,
  orderIds: readonly string[],
): Promise<DashboardTopItem[]> {
  if (orderIds.length === 0) return []

  const { data, error } = await supabase
    .from('order_items')
    .select('menu_item_id, name_snapshot, quantity, total')
    .in('order_id', orderIds)

  if (error) throw new AppErrorException(mapPgError(error))

  const buckets = new Map<
    string,
    { menuItemId: string | null; name: I18nText; quantity: number; revenue: Money[] }
  >()

  for (const line of data ?? []) {
    // Deleted dishes have no id; group those by the name they were sold under
    // so two different removed dishes do not merge into one meaningless row.
    const key = line.menu_item_id ?? `name:${JSON.stringify(line.name_snapshot)}`
    const bucket = buckets.get(key) ?? {
      menuItemId: line.menu_item_id,
      name: line.name_snapshot,
      quantity: 0,
      revenue: [],
    }
    bucket.quantity += line.quantity
    bucket.revenue.push(line.total)
    buckets.set(key, bucket)
  }

  return [...buckets.values()]
    .map((bucket) => ({
      menuItemId: bucket.menuItemId,
      name: bucket.name,
      quantitySold: bucket.quantity,
      revenue: sumMoney(bucket.revenue),
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, 5)
}
