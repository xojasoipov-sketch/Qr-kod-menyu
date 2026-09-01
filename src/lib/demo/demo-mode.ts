/**
 * Demo mode: the ONE module that may read the fixture.
 *
 * `git clone && npm install && npm run dev` with no `.env.local` must open a
 * complete, explorable Restaurant QR OS — scan the demo table, browse a real
 * menu, place an order, watch it land on the kitchen display, move it through
 * the state machine, raise a waiter call, open the dashboard. That is what this
 * file provides.
 *
 * THE DANGER, stated plainly, because the brief states it twice (§11 "no fake
 * analytics — real data only; demo data clearly separated"; §35 "real
 * functional system, not a fake prototype"): a demo number that is not
 * conspicuously labelled becomes a screenshot, and a screenshot becomes a claim.
 *
 * So the containment is structural, not disciplinary:
 *
 * 1. **One module boundary.** `src/lib/demo/fixture.ts` is imported here and
 *    nowhere else. No service, no mapper, no RPC module and no component reads
 *    a fixture, and no `if (isDemoMode())` appears in any of them.
 * 2. **One switch point.** The caller chooses `demoRepository` or the live
 *    service ONCE, at the data layer, on `isDemoMode()`. There is no code path
 *    where a fixture value and a database value appear in the same response.
 * 3. **Always labelled.** `DEMO_NOTICE` is true whenever this repository can be
 *    reached, `DashboardStats.isDemo` rides on every stats object, and every
 *    figure the dashboard renders from the fixture carries that flag into the
 *    component (doc 05 §8.5).
 * 4. **Reads reuse the real mappers.** The fixture is shaped as database rows
 *    and wire payloads, so `toMenuTree`, `toOrderView`, `toKitchenTicket` and
 *    `toWaiterCallView` run over it unchanged. Demo mode exercises the real
 *    mapping code; it does not shadow it.
 *
 * WHAT THE STORE IS NOT: it is a per-process `Map`. It resets on restart, is not
 * shared between instances, has no durability and no transactions, and holds at
 * most 200 orders. Writes it does not simulate are refused with
 * `demoReadOnly()`, so the form still renders and still validates and simply
 * declines to pretend it persisted.
 */
import { isDemoMode } from '@/lib/env'
import { toKitchenTicket, toOrderView } from '@/lib/mappers/order-mapper'
import type { OrderRowWithRelations } from '@/lib/mappers/order-mapper'
import { byUrgency, toWaiterCallView } from '@/lib/mappers/waiter-mapper'
import { toMenuCategoryView, toMenuItemView, toMenuOptionGroups } from '@/lib/mappers/menu-mapper'
import { applyBps, multiplyMoney, sumMoney, type Money } from '@/lib/money'
import { isLate } from '@/lib/orders/lateness'
import { assertTransition, isTerminalStatus } from '@/lib/orders/state-machine'
import { KDS_STATUSES, OPEN_CALL_STATUSES } from '@/lib/realtime/channels'
import { AppErrorException, appError, err, ok, type AppError, type Result } from '@/lib/result'
import type {
  PublicMenu,
  PublicMenuItem,
  PublicOptionGroup,
  PublicOrder,
  PublicOrderLine,
  PublicTableContext,
  WaiterCallResult,
} from '@/lib/rpc/schemas'
import { businessDateFor } from '@/lib/utils/datetime'
import { ORDER_STATUSES } from '@/types/database'
import type {
  MenuItemOptionRow,
  MenuItemRow,
  OrderItemOptionRow,
  OrderItemRow,
  OrderRow,
  OrderStatus,
  WaiterCallReason,
  WaiterCallRow,
} from '@/types/database'
import type {
  DashboardStats,
  DashboardTopItem,
  KitchenTicket,
  OrderView,
  StaffSession,
  WaiterCallView,
} from '@/types/domain'
import type { I18nText } from '@/types/i18n'

import {
  DEMO_IDS,
  DEMO_TOKEN,
  FIXTURES,
  type FixtureBranch,
  type FixtureMenuItem,
  type FixtureOrder,
  type FixtureTable,
} from '@/lib/demo/fixture'

import type { CategoryAdminView, MenuItemAdminView, MenuItemFilters } from '@/lib/services/menu-service'
import type { OrderFilters, OrderListPage } from '@/lib/services/order-service'
import type { TableAdminView, TableDetailView } from '@/lib/services/table-service'
import type { BranchAdminView } from '@/lib/services/branch-service'
import type { StaffAdminView } from '@/lib/services/staff-service'
import type { SettingsView } from '@/lib/services/settings-service'

/* ================================================================== */
/* The label                                                           */
/* ================================================================== */

/**
 * The flag every surface reads. True exactly when this repository is the source
 * of what is on screen. Safe to import from a Client Component: it is a plain
 * boolean derived from a build-time constant.
 */
export const DEMO_NOTICE: boolean = isDemoMode()

/** Message keys for the banner, the badge and the explanatory paragraph. */
export const DEMO_BANNER_KEY = 'states.demo.banner' as const
export const DEMO_BADGE_KEY = 'states.demo.badge' as const
export const DEMO_BODY_KEY = 'states.demo.body' as const

export { DEMO_TOKEN }

/** Three tokens, so table switching and the tables screen are both explorable. */
export const DEMO_TOKENS: readonly string[] = FIXTURES.tables.map((row) => row.qr_token)

/**
 * The refusal for a write demo mode does not simulate. The form renders, the
 * schema validates, and the submit says — in the guest's own language — that
 * nothing was persisted. That is more honest than a fake success toast and more
 * useful than a disabled button.
 */
export function demoReadOnly(what: string): AppError {
  return appError('FORBIDDEN', `demo mode does not persist ${what}`, {
    details: { demo: true, entity: what, messageKey: DEMO_BODY_KEY },
  })
}

function demoRefusal<T>(what: string): Result<T> {
  return err(demoReadOnly(what))
}

/**
 * A fixed staff identity, so `/kitchen`, `/waiter`, `/admin` and the platform
 * screens are reachable with no auth server. It exists ONLY while
 * `isDemoMode()` is true — which is false the moment a Supabase URL and key are
 * configured — so there is no runtime path from a live deployment to this
 * session.
 */
export function demoStaffSession(): StaffSession {
  return {
    profileId: DEMO_IDS.ownerProfileId,
    staffId: DEMO_IDS.ownerStaffId,
    restaurantId: DEMO_IDS.restaurantId,
    branchId: null,
    role: 'RESTAURANT_OWNER',
    isPlatformAdmin: true,
    displayName: 'Demo Owner',
    email: null,
    avatarUrl: null,
    locale: FIXTURES.restaurant.default_locale,
  }
}

/* ================================================================== */
/* Errors, in the same vocabulary the database uses                    */
/* ================================================================== */

const invalidQr = (): AppError =>
  appError('INVALID_QR', 'unknown QR token', {
    wire: 'QR001_INVALID_QR_TOKEN',
    details: { entity: 'table' },
  })

const tableInactive = (): AppError =>
  appError('TABLE_INACTIVE', 'this table is out of service', {
    wire: 'QR002_TABLE_INACTIVE',
  })

const branchClosed = (): AppError =>
  appError('RESTAURANT_CLOSED', 'this branch is not accepting orders', {
    wire: 'QR003_BRANCH_INACTIVE',
  })

const orderNotFound = (): AppError =>
  appError('NOT_FOUND', 'order not found', {
    wire: 'QR030_ORDER_NOT_FOUND',
    details: { entity: 'order' },
  })

const itemUnavailable = (menuItemId: string): AppError =>
  appError('ITEM_UNAVAILABLE', 'this dish is not available right now', {
    wire: 'QR020_ITEM_UNAVAILABLE',
    details: { menu_item_id: menuItemId },
  })

const rateLimited = (seconds: number, wire: 'QR010_ORDER_RATE_LIMITED' | 'QR011_WAITER_CALL_COOLDOWN'): AppError =>
  appError('RATE_LIMITED', 'please wait before trying again', {
    wire,
    retryAfterSeconds: seconds,
    details: { retry_after_seconds: seconds },
  })

/* ================================================================== */
/* Indexes over the fixture                                            */
/* ================================================================== */

const branchById = new Map<string, FixtureBranch>(FIXTURES.branches.map((b) => [b.id, b]))
const tableById = new Map<string, FixtureTable>(FIXTURES.tables.map((t) => [t.id, t]))
const tableByToken = new Map<string, FixtureTable>(FIXTURES.tables.map((t) => [t.qr_token, t]))
const itemById = new Map<string, FixtureMenuItem>(FIXTURES.menuItems.map((i) => [i.id, i]))

const optionById = new Map(FIXTURES.menuItemOptions.map((o) => [o.id, o]))
const optionsByItem = new Map<string, typeof FIXTURES.menuItemOptions>()
for (const row of FIXTURES.menuItemOptions) {
  const bucket = optionsByItem.get(row.menu_item_id) ?? []
  bucket.push(row)
  optionsByItem.set(row.menu_item_id, bucket)
}

const REST = FIXTURES.restaurant
const SERVICE_FEE_BPS = REST.service_fee_enabled ? REST.service_fee_bps : 0

function iso(offsetMs: number, from: Date = new Date()): string {
  return new Date(from.getTime() + offsetMs).toISOString()
}

/* ================================================================== */
/* Fixture -> database rows                                            */
/* ================================================================== */

function menuItemRow(source: FixtureMenuItem, at: Date): MenuItemRow {
  return {
    id: source.id,
    restaurant_id: source.restaurant_id,
    branch_id: source.branch_id,
    category_id: source.category_id,
    name: source.name,
    description: source.description,
    ingredients: source.ingredients,
    price: source.price,
    compare_at_price: source.compare_at_price,
    image_url: source.image_url,
    image_path: null,
    spicy_level: source.spicy_level,
    preparation_time: source.preparation_time,
    calories: source.calories,
    dietary_tags: source.dietary_tags,
    is_available: source.is_available,
    unavailable_until:
      source.unavailable_for_hours === null
        ? null
        : iso(source.unavailable_for_hours * 3_600_000, at),
    available_from: null,
    available_until: null,
    is_featured: source.is_featured,
    is_popular: source.is_popular,
    popularity_score: source.popularity_score,
    sort_order: source.sort_order,
    deleted_at: null,
    created_at: iso(-90 * 86_400_000, at),
    updated_at: iso(-86_400_000, at),
  }
}

function menuItemOptionRow(
  source: (typeof FIXTURES.menuItemOptions)[number],
  at: Date,
): MenuItemOptionRow {
  return {
    ...source,
    deleted_at: null,
    created_at: iso(-90 * 86_400_000, at),
    updated_at: iso(-86_400_000, at),
  }
}

/* ================================================================== */
/* Fixture -> wire payloads                                            */
/* ================================================================== */

function contextPayload(source: FixtureTable, at: Date): PublicTableContext {
  const branch = branchById.get(source.branch_id)
  return {
    token: source.qr_token,
    restaurant: {
      name: REST.name,
      slug: REST.slug,
      logo_url: REST.logo_url,
      welcome_message: REST.welcome_message,
      default_locale: REST.default_locale,
      currency: REST.currency,
      currency_decimals: REST.currency_decimals,
    },
    branch: {
      name: branch?.name ?? '',
      timezone: branch?.timezone ?? 'Asia/Tashkent',
      is_accepting_orders: branch?.is_accepting_orders ?? false,
      service_fee_enabled: REST.service_fee_enabled,
      service_fee_bps: SERVICE_FEE_BPS,
    },
    table: { number: source.number, name: source.name },
    resolved_at: at.toISOString(),
  }
}

function optionGroupPayloads(menuItemId: string): PublicOptionGroup[] {
  const rows = optionsByItem.get(menuItemId) ?? []
  const groups = new Map<string, PublicOptionGroup>()

  for (const row of rows) {
    let group = groups.get(row.group_key)
    if (!group) {
      group = {
        group_key: row.group_key,
        group_label: row.group_label,
        selection_type: row.selection_type,
        min_select: row.group_min_select,
        max_select: row.group_max_select,
        is_required: row.group_min_select >= 1,
        sort_order: row.group_sort_order,
        options: [],
      }
      groups.set(row.group_key, group)
    }
    group.options.push({
      id: row.id,
      name: row.name,
      price_delta: row.price_delta,
      max_quantity: row.max_quantity,
      is_default: row.is_default,
      is_available: row.is_available,
      sort_order: row.sort_order,
    })
  }

  return [...groups.values()].sort((a, b) => a.sort_order - b.sort_order)
}

function menuItemPayload(source: FixtureMenuItem): PublicMenuItem {
  return {
    id: source.id,
    category_id: source.category_id,
    name: source.name,
    description: source.description,
    ingredients: source.ingredients,
    price: source.price,
    compare_at_price: source.compare_at_price,
    image_url: source.image_url,
    spicy_level: source.spicy_level,
    preparation_time: source.preparation_time,
    calories: source.calories,
    dietary_tags: source.dietary_tags,
    is_available: source.is_available,
    is_featured: source.is_featured,
    is_popular: source.is_popular,
    sort_order: source.sort_order,
    option_groups: optionGroupPayloads(source.id),
  }
}

/* ================================================================== */
/* The store                                                           */
/* ================================================================== */

const MAX_ORDERS = 200

interface DemoState {
  orders: Map<string, OrderRowWithRelations>
  calls: Map<string, WaiterCallRow>
  /** Table id -> last order instant, for the per-table order interval. */
  lastOrderAt: Map<string, number>
  /** Table id -> last waiter call instant, for the cooldown. */
  lastCallAt: Map<string, number>
  sequence: number
}

let state: DemoState | null = null

function orderRowFrom(source: FixtureOrder, at: Date): OrderRowWithRelations {
  const table = tableById.get(source.table_id)
  const branch = branchById.get(source.branch_id)
  const placedAt = new Date(at.getTime() - source.placed_minutes_ago * 60_000)

  const items: (OrderItemRow & { order_item_options: OrderItemOptionRow[] })[] = []
  const lineTotals: Money[] = []

  for (const line of source.items) {
    const dish = itemById.get(line.menu_item_id)
    if (!dish) continue
    const total = multiplyMoney(dish.price, line.quantity)
    lineTotals.push(total)
    items.push({
      id: line.id,
      restaurant_id: source.restaurant_id,
      order_id: source.id,
      menu_item_id: dish.id,
      name_snapshot: dish.name,
      description_snapshot: dish.description,
      category_name_snapshot: null,
      image_url_snapshot: dish.image_url,
      price_snapshot: dish.price,
      spicy_level_snapshot: dish.spicy_level,
      preparation_time_snapshot: dish.preparation_time,
      dietary_tags_snapshot: dish.dietary_tags,
      quantity: line.quantity,
      options_total: 0,
      total,
      note: line.note,
      sort_order: line.sort_order,
      created_at: placedAt.toISOString(),
      updated_at: placedAt.toISOString(),
      order_item_options: [],
    })
  }

  const subtotal = sumMoney(lineTotals)
  const serviceFee = applyBps(subtotal, SERVICE_FEE_BPS)

  return {
    ...emptyOrderRow(),
    id: source.id,
    restaurant_id: source.restaurant_id,
    branch_id: source.branch_id,
    table_id: source.table_id,
    public_code: source.public_code,
    order_number: source.order_number,
    order_seq: Number(source.order_number.split('-')[1] ?? '1'),
    business_date: businessDateFor(branch?.timezone ?? 'Asia/Tashkent', placedAt),
    order_type: source.order_type,
    channel: source.channel,
    status: source.status,
    customer_name: source.customer_name,
    customer_note: source.customer_note,
    guest_count: source.guest_count,
    locale: source.locale,
    currency: REST.currency,
    currency_decimals: REST.currency_decimals,
    subtotal,
    discount_total: 0,
    service_fee: serviceFee,
    service_fee_bps: SERVICE_FEE_BPS,
    total: subtotal + serviceFee,
    estimated_prep_minutes: source.estimated_prep_minutes,
    due_at: iso(source.estimated_prep_minutes * 60_000, placedAt),
    placed_at: placedAt.toISOString(),
    confirmed_at: statusReached(source.status, 'confirmed')
      ? iso(60_000, placedAt)
      : null,
    preparing_at: statusReached(source.status, 'preparing') ? iso(180_000, placedAt) : null,
    ready_at: statusReached(source.status, 'ready') ? iso(960_000, placedAt) : null,
    delivered_at: statusReached(source.status, 'delivered') ? iso(1_140_000, placedAt) : null,
    completed_at: statusReached(source.status, 'completed') ? iso(3_720_000, placedAt) : null,
    created_at: placedAt.toISOString(),
    updated_at: placedAt.toISOString(),
    order_items: items,
    tables: table ? { number: table.number, name: table.name } : null,
    order_status_history: historyFor(source.status, placedAt),
  }
}

const FORWARD: readonly OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'delivered',
  'completed',
]

function statusReached(current: OrderStatus, milestone: OrderStatus): boolean {
  if (current === 'cancelled') return false
  return FORWARD.indexOf(current) >= FORWARD.indexOf(milestone)
}

/** A realistic trail, so the tracker's stepper has something to render. */
function historyFor(status: OrderStatus, placedAt: Date): { new_status: OrderStatus; created_at: string }[] {
  const offsets: Partial<Record<OrderStatus, number>> = {
    pending: 0,
    confirmed: 60_000,
    preparing: 180_000,
    ready: 960_000,
    delivered: 1_140_000,
    completed: 3_720_000,
  }

  if (status === 'cancelled') {
    return [
      { new_status: 'pending', created_at: placedAt.toISOString() },
      { new_status: 'cancelled', created_at: iso(120_000, placedAt) },
    ]
  }

  const reached = FORWARD.slice(0, FORWARD.indexOf(status) + 1)
  return reached.map((step) => ({
    new_status: step,
    created_at: iso(offsets[step] ?? 0, placedAt),
  }))
}

/** Every column of `orders`, so a synthesized row is a complete row. */
function emptyOrderRow(): OrderRow {
  const stamp = new Date().toISOString()
  return {
    id: '',
    restaurant_id: REST.id,
    branch_id: '',
    table_id: null,
    public_code: '',
    order_number: '',
    order_seq: 0,
    business_date: '',
    order_type: 'dine_in',
    channel: 'qr',
    status: 'pending',
    customer_session_id: null,
    customer_name: null,
    customer_phone: null,
    customer_note: null,
    guest_count: null,
    locale: REST.default_locale,
    currency: REST.currency,
    currency_decimals: REST.currency_decimals,
    subtotal: 0,
    discount_total: 0,
    service_fee: 0,
    service_fee_bps: SERVICE_FEE_BPS,
    total: 0,
    estimated_prep_minutes: 15,
    due_at: null,
    placed_at: stamp,
    confirmed_at: null,
    preparing_at: null,
    ready_at: null,
    delivered_at: null,
    completed_at: null,
    cancelled_at: null,
    cancellation_reason: null,
    confirmed_by_staff_id: null,
    served_by_staff_id: null,
    cancelled_by_staff_id: null,
    client_request_id: null,
    payload_fingerprint: null,
    created_at: stamp,
    updated_at: stamp,
  }
}

function waiterCallRow(
  source: (typeof FIXTURES.waiterCalls)[number],
  at: Date,
): WaiterCallRow {
  const created = new Date(at.getTime() - source.created_seconds_ago * 1000)
  return {
    id: source.id,
    restaurant_id: source.restaurant_id,
    branch_id: source.branch_id,
    table_id: source.table_id,
    order_id: source.order_id,
    reason: source.reason,
    status: source.status,
    note: source.note,
    customer_session_id: null,
    acknowledged_at: null,
    acknowledged_by_staff_id: null,
    resolved_at: null,
    resolved_by_staff_id: null,
    created_at: created.toISOString(),
    updated_at: created.toISOString(),
  }
}

/**
 * Seeded lazily and exactly once per process. The seed uses the instant of first
 * read, which is what keeps a three-minute-old ticket three minutes old however
 * long ago this repository was checked out.
 */
function store(): DemoState {
  if (state) return state

  const at = new Date()
  const orders = new Map<string, OrderRowWithRelations>()
  for (const source of FIXTURES.orders) orders.set(source.id, orderRowFrom(source, at))

  const calls = new Map<string, WaiterCallRow>()
  for (const source of FIXTURES.waiterCalls) calls.set(source.id, waiterCallRow(source, at))

  state = {
    orders,
    calls,
    lastOrderAt: new Map(),
    lastCallAt: new Map(),
    sequence: 0,
  }
  return state
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

function newPublicCode(): string {
  let code = 'DEMO'
  for (let i = 0; i < 8; i += 1) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)] ?? 'X'
  }
  return code
}

/* ================================================================== */
/* Wire projection of a stored order                                   */
/* ================================================================== */

function lineOptionPayloads(line: OrderItemRow & { order_item_options?: OrderItemOptionRow[] | null }) {
  return (line.order_item_options ?? []).map((option) => ({
    name: option.name_snapshot,
    price_delta: option.price_delta_snapshot,
    quantity: option.quantity,
  }))
}

function orderLinePayload(
  line: OrderItemRow & { order_item_options?: OrderItemOptionRow[] | null },
): PublicOrderLine {
  return {
    id: line.id,
    name: line.name_snapshot,
    description: line.description_snapshot,
    image_url: line.image_url_snapshot,
    unit_price: line.price_snapshot,
    quantity: line.quantity,
    options_total: line.options_total,
    line_total: line.total,
    note: line.note,
    spicy_level: line.spicy_level_snapshot,
    options: lineOptionPayloads(line),
  }
}

function orderPayload(row: OrderRowWithRelations, token: string | null): PublicOrder {
  return {
    order_number: row.order_number,
    public_code: row.public_code,
    tracking_path: token
      ? `/t/${token}/order/${row.public_code}`
      : `/o/${row.public_code}`,
    status: row.status,
    order_type: row.order_type,
    channel: row.channel,
    currency: row.currency,
    currency_decimals: row.currency_decimals,
    subtotal: row.subtotal,
    discount_total: row.discount_total,
    service_fee: row.service_fee,
    service_fee_bps: row.service_fee_bps,
    total: row.total,
    note: row.customer_note,
    guest_count: row.guest_count,
    locale: row.locale,
    estimated_prep_minutes: row.estimated_prep_minutes,
    due_at: row.due_at,
    placed_at: row.placed_at,
    confirmed_at: row.confirmed_at,
    preparing_at: row.preparing_at,
    ready_at: row.ready_at,
    delivered_at: row.delivered_at,
    completed_at: row.completed_at,
    cancelled_at: row.cancelled_at,
    cancellation_reason: row.cancellation_reason,
    created_at: row.created_at,
    table: { number: row.tables?.number ?? null, name: row.tables?.name ?? null },
    lines: (row.order_items ?? []).map(orderLinePayload),
    history: (row.order_status_history ?? []).map((event) => ({
      status: event.new_status,
      at: event.created_at,
    })),
  }
}

/* ================================================================== */
/* Public (customer) reads and writes                                  */
/* ================================================================== */

function resolveOrFail(token: string): Result<FixtureTable> {
  const found = tableByToken.get(token)
  if (!found) return err(invalidQr())
  if (!found.is_active) return err(tableInactive())

  const branch = branchById.get(found.branch_id)
  if (!branch || !branch.is_active) return err(branchClosed())
  if (!REST.is_active) {
    return err(
      appError('RESTAURANT_CLOSED', 'this restaurant is closed', {
        wire: 'QR004_RESTAURANT_INACTIVE',
      }),
    )
  }
  return ok(found)
}

function resolveTable(token: string): Promise<Result<PublicTableContext>> {
  const resolved = resolveOrFail(token)
  if (!resolved.ok) return Promise.resolve(resolved)
  return Promise.resolve(ok(contextPayload(resolved.data, new Date())))
}

function getMenu(token: string): Promise<Result<PublicMenu>> {
  const resolved = resolveOrFail(token)
  if (!resolved.ok) return Promise.resolve(resolved)

  const at = new Date()
  const context = contextPayload(resolved.data, at)

  const menu: PublicMenu = {
    token: context.token,
    restaurant: context.restaurant,
    branch: context.branch,
    table: context.table,
    categories: FIXTURES.categories
      .filter((category) => category.is_active)
      .map((category) => ({
        id: category.id,
        name: category.name,
        description: category.description,
        image_url: category.image_url,
        icon: category.icon,
        sort_order: category.sort_order,
        items: FIXTURES.menuItems
          .filter((row) => row.category_id === category.id)
          .map(menuItemPayload),
      })),
    promotions: FIXTURES.promotions
      .filter((promotion) => promotion.is_active)
      .map((promotion) => ({
        id: promotion.id,
        title: promotion.title,
        description: promotion.description,
        badge_label: promotion.badge_label,
        image_url: promotion.image_url,
        sort_order: promotion.sort_order,
      })),
    generated_at: at.toISOString(),
  }

  return Promise.resolve(ok(menu))
}

function findOrder(publicCode: string): OrderRowWithRelations | undefined {
  for (const row of store().orders.values()) {
    if (row.public_code === publicCode) return row
  }
  return undefined
}

function getOrder(token: string, publicCode: string): Promise<Result<PublicOrder>> {
  const resolved = resolveOrFail(token)
  if (!resolved.ok) return Promise.resolve(resolved)

  const row = findOrder(publicCode)
  // Both capabilities are required, exactly as in `public_get_order`: holding a
  // forwarded tracking link without that table's QR gets you nothing.
  if (!row || row.table_id !== resolved.data.id) return Promise.resolve(err(orderNotFound()))

  return Promise.resolve(ok(orderPayload(row, token)))
}

export interface DemoPlaceOrderArgs {
  token: string
  items: { menu_item_id: string; quantity: number; option_ids?: string[]; note?: string | null }[]
  note?: string | null
  client_request_id: string
  locale?: PublicOrder['locale']
  guest_count?: number | null
}

/**
 * Place an order against the fixture menu.
 *
 * Prices come from the fixture, never from the payload — the same rule as
 * production (brief §34.2), enforced the same way: the request carries dish
 * ids, quantities and option ids, and this function reads every amount itself.
 */
function placeOrder(args: DemoPlaceOrderArgs): Promise<Result<PublicOrder>> {
  const resolved = resolveOrFail(args.token)
  if (!resolved.ok) return Promise.resolve(resolved)

  const source = resolved.data
  const branch = branchById.get(source.branch_id)
  if (!branch || !branch.is_accepting_orders) return Promise.resolve(err(branchClosed()))

  const db = store()
  const at = new Date()

  // Idempotency: a retry of the same cart returns the order it already made.
  for (const row of db.orders.values()) {
    if (row.client_request_id === args.client_request_id) {
      return Promise.resolve(ok(orderPayload(row, args.token)))
    }
  }

  const lastOrder = db.lastOrderAt.get(source.id)
  if (lastOrder !== undefined) {
    const waited = Math.floor((at.getTime() - lastOrder) / 1000)
    const interval = branch.order_min_interval_seconds
    if (waited < interval) {
      return Promise.resolve(err(rateLimited(interval - waited, 'QR010_ORDER_RATE_LIMITED')))
    }
  }

  const orderId = crypto.randomUUID()
  const lines: (OrderItemRow & { order_item_options: OrderItemOptionRow[] })[] = []
  const lineTotals: Money[] = []
  let sortOrder = 0
  let prepMinutes = branch.default_prep_minutes

  for (const line of args.items) {
    const dish = itemById.get(line.menu_item_id)
    if (!dish) return Promise.resolve(err(itemUnavailable(line.menu_item_id)))
    if (!dish.is_available) return Promise.resolve(err(itemUnavailable(line.menu_item_id)))

    const chosen = (line.option_ids ?? [])
      .map((id) => optionById.get(id))
      .filter((row): row is NonNullable<typeof row> => row !== undefined && row.menu_item_id === dish.id)

    const optionsTotal = sumMoney(chosen.map((row) => row.price_delta))
    const lineTotal = multiplyMoney(dish.price + optionsTotal, line.quantity)
    lineTotals.push(lineTotal)
    prepMinutes = Math.max(prepMinutes, dish.preparation_time)
    sortOrder += 1

    const lineId = crypto.randomUUID()
    lines.push({
      id: lineId,
      restaurant_id: REST.id,
      order_id: orderId,
      menu_item_id: dish.id,
      name_snapshot: dish.name,
      description_snapshot: dish.description,
      category_name_snapshot: null,
      image_url_snapshot: dish.image_url,
      price_snapshot: dish.price,
      spicy_level_snapshot: dish.spicy_level,
      preparation_time_snapshot: dish.preparation_time,
      dietary_tags_snapshot: dish.dietary_tags,
      quantity: line.quantity,
      options_total: optionsTotal,
      total: lineTotal,
      note: line.note ?? null,
      sort_order: sortOrder,
      created_at: at.toISOString(),
      updated_at: at.toISOString(),
      order_item_options: chosen.map((row, index) => ({
        id: crypto.randomUUID(),
        restaurant_id: REST.id,
        order_id: orderId,
        order_item_id: lineId,
        menu_item_option_id: row.id,
        group_key_snapshot: row.group_key,
        group_label_snapshot: row.group_label,
        name_snapshot: row.name,
        price_delta_snapshot: row.price_delta,
        quantity: 1,
        total_per_unit: row.price_delta,
        sort_order: index + 1,
        created_at: at.toISOString(),
        updated_at: at.toISOString(),
      })),
    })
  }

  if (lines.length === 0) {
    return Promise.resolve(
      err(
        appError('VALIDATION_FAILED', 'an order needs at least one line', {
          wire: 'QR023_INVALID_PAYLOAD',
          details: { field: 'items' },
        }),
      ),
    )
  }

  const subtotal = sumMoney(lineTotals)
  const serviceFee = applyBps(subtotal, SERVICE_FEE_BPS)

  db.sequence += 1
  const row: OrderRowWithRelations = {
    ...emptyOrderRow(),
    id: orderId,
    restaurant_id: REST.id,
    branch_id: source.branch_id,
    table_id: source.id,
    public_code: newPublicCode(),
    order_number: `D-${String(db.sequence).padStart(3, '0')}`,
    order_seq: db.sequence,
    business_date: businessDateFor(branch.timezone, at),
    status: 'pending',
    customer_note: args.note ?? null,
    guest_count: args.guest_count ?? null,
    locale: args.locale ?? REST.default_locale,
    subtotal,
    service_fee: serviceFee,
    total: subtotal + serviceFee,
    estimated_prep_minutes: prepMinutes,
    due_at: iso(prepMinutes * 60_000, at),
    placed_at: at.toISOString(),
    client_request_id: args.client_request_id,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
    order_items: lines,
    tables: { number: source.number, name: source.name },
    order_status_history: [{ new_status: 'pending', created_at: at.toISOString() }],
  }

  db.orders.set(orderId, row)
  db.lastOrderAt.set(source.id, at.getTime())

  // Bounded, so a long-lived dev server cannot grow without limit.
  if (db.orders.size > MAX_ORDERS) {
    const oldest = [...db.orders.values()].sort((a, b) =>
      a.placed_at.localeCompare(b.placed_at),
    )[0]
    if (oldest) db.orders.delete(oldest.id)
  }

  return Promise.resolve(ok(orderPayload(row, args.token)))
}

/** A guest withdrawing an order the kitchen has not accepted. Only from `pending`. */
function cancelOrder(
  token: string,
  publicCode: string,
  reason: string,
): Promise<Result<PublicOrder>> {
  const resolved = resolveOrFail(token)
  if (!resolved.ok) return Promise.resolve(resolved)

  const row = findOrder(publicCode)
  if (!row || row.table_id !== resolved.data.id) return Promise.resolve(err(orderNotFound()))

  try {
    assertTransition(row.status, 'cancelled', 'CUSTOMER')
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return Promise.resolve(err(thrown.error))
    throw thrown
  }

  const at = new Date()
  const updated: OrderRowWithRelations = {
    ...row,
    status: 'cancelled',
    cancelled_at: at.toISOString(),
    cancellation_reason: reason,
    updated_at: at.toISOString(),
    order_status_history: [
      ...(row.order_status_history ?? []),
      { new_status: 'cancelled', created_at: at.toISOString() },
    ],
  }

  store().orders.set(row.id, updated)
  return Promise.resolve(ok(orderPayload(updated, token)))
}

/**
 * CALL WAITER, with the cooldown the brief requires (§10).
 *
 * The refusal is a typed RATE_LIMITED carrying the seconds remaining, so the UI
 * shows a countdown rather than a dead button — the same contract the database
 * enforces under `FOR UPDATE` in production.
 */
function callWaiter(token: string, reason: WaiterCallReason): Promise<Result<WaiterCallResult>> {
  const resolved = resolveOrFail(token)
  if (!resolved.ok) return Promise.resolve(resolved)

  const source = resolved.data
  const branch = branchById.get(source.branch_id)
  const cooldown = branch?.waiter_call_cooldown_seconds ?? 90
  const db = store()
  const at = new Date()

  const last = db.lastCallAt.get(source.id)
  if (last !== undefined) {
    const waited = Math.floor((at.getTime() - last) / 1000)
    if (waited < cooldown) {
      return Promise.resolve(err(rateLimited(cooldown - waited, 'QR011_WAITER_CALL_COOLDOWN')))
    }
  }

  const id = crypto.randomUUID()
  db.calls.set(id, {
    id,
    restaurant_id: REST.id,
    branch_id: source.branch_id,
    table_id: source.id,
    order_id: null,
    reason,
    status: 'pending',
    note: null,
    customer_session_id: null,
    acknowledged_at: null,
    acknowledged_by_staff_id: null,
    resolved_at: null,
    resolved_by_staff_id: null,
    created_at: at.toISOString(),
    updated_at: at.toISOString(),
  })
  db.lastCallAt.set(source.id, at.getTime())

  return Promise.resolve(
    ok({
      status: 'pending' as const,
      reason,
      cooldown_seconds: cooldown,
      created_at: at.toISOString(),
      table: { number: source.number, name: source.name },
    }),
  )
}

/* ================================================================== */
/* Staff reads                                                         */
/* ================================================================== */

function ordersOfBranch(branchId: string | null): OrderRowWithRelations[] {
  return [...store().orders.values()].filter(
    (row) => branchId === null || row.branch_id === branchId,
  )
}

function listKitchenTickets(
  branchId: string,
  options: { now?: Date } = {},
): Promise<Result<KitchenTicket[]>> {
  const now = options.now ?? new Date()
  const branch = branchById.get(branchId)
  const statuses: readonly OrderStatus[] = KDS_STATUSES

  const tickets = ordersOfBranch(branchId)
    .filter((row) => statuses.includes(row.status))
    .sort((a, b) => a.placed_at.localeCompare(b.placed_at))
    .map((row) =>
      toKitchenTicket(row, {
        now,
        lateThresholdMinutes: branch?.late_order_threshold_minutes ?? 25,
        defaultPrepMinutes: branch?.default_prep_minutes ?? 15,
      }),
    )

  return Promise.resolve(ok(tickets))
}

function listOrders(
  branchId: string,
  filters: OrderFilters = {},
): Promise<Result<OrderListPage>> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200)
  const offset = Math.max(filters.offset ?? 0, 0)

  let rows = ordersOfBranch(branchId).sort((a, b) => b.placed_at.localeCompare(a.placed_at))

  if (filters.status && filters.status.length > 0) {
    const wanted = new Set(filters.status)
    rows = rows.filter((row) => wanted.has(row.status))
  }
  if (filters.businessDate) {
    rows = rows.filter((row) => row.business_date === filters.businessDate)
  }
  if (filters.search) {
    const needle = filters.search.toLowerCase()
    rows = rows.filter((row) => row.order_number.toLowerCase().includes(needle))
  }

  return Promise.resolve(
    ok({
      orders: rows.slice(offset, offset + limit).map((row) => toOrderView(row)),
      total: rows.length,
      limit,
      offset,
    }),
  )
}

function getOrderById(id: string): Promise<Result<OrderView>> {
  const row = store().orders.get(id)
  if (!row) return Promise.resolve(err(orderNotFound()))
  return Promise.resolve(ok(toOrderView(row)))
}

function callsOfBranch(branchId: string | null): WaiterCallRow[] {
  return [...store().calls.values()].filter(
    (row) => branchId === null || row.branch_id === branchId,
  )
}

function decorateCall(row: WaiterCallRow, now: Date): WaiterCallView {
  const table = tableById.get(row.table_id)
  const order = row.order_id ? store().orders.get(row.order_id) : undefined
  return toWaiterCallView(
    {
      ...row,
      tables: table ? { number: table.number, name: table.name } : null,
      orders: order ? { order_number: order.order_number } : null,
      acknowledged_by: null,
    },
    { now },
  )
}

function listWaiterCalls(
  branchId: string,
  openOnly = true,
  options: { now?: Date } = {},
): Promise<Result<WaiterCallView[]>> {
  const now = options.now ?? new Date()
  const open: ReadonlySet<string> = new Set<string>(OPEN_CALL_STATUSES)

  const views = callsOfBranch(branchId)
    .filter((row) => !openOnly || open.has(row.status))
    .map((row) => decorateCall(row, now))
    .sort(byUrgency)

  return Promise.resolve(ok(views))
}

/* ================================================================== */
/* Staff writes the demo DOES simulate                                 */
/* ================================================================== */

function updateOrderStatus(
  orderId: string,
  nextStatus: OrderStatus,
  cancellationReason: string | null = null,
): Promise<Result<OrderView>> {
  const db = store()
  const row = db.orders.get(orderId)
  if (!row) return Promise.resolve(err(orderNotFound()))

  try {
    // The same assertion the live service makes, with the same actor the demo
    // session claims. An illegal transition is refused here exactly as Postgres
    // would refuse it — the demo does not get an easier state machine.
    assertTransition(row.status, nextStatus, 'RESTAURANT_OWNER')
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return Promise.resolve(err(thrown.error))
    throw thrown
  }

  const at = new Date()
  const stamp = at.toISOString()
  const updated: OrderRowWithRelations = {
    ...row,
    status: nextStatus,
    confirmed_at: nextStatus === 'confirmed' ? stamp : row.confirmed_at,
    preparing_at: nextStatus === 'preparing' ? stamp : row.preparing_at,
    ready_at: nextStatus === 'ready' ? stamp : row.ready_at,
    delivered_at: nextStatus === 'delivered' ? stamp : row.delivered_at,
    completed_at: nextStatus === 'completed' ? stamp : row.completed_at,
    cancelled_at: nextStatus === 'cancelled' ? stamp : row.cancelled_at,
    cancellation_reason: cancellationReason ?? row.cancellation_reason,
    updated_at: stamp,
    order_status_history: [
      ...(row.order_status_history ?? []),
      { new_status: nextStatus, created_at: stamp },
    ],
  }

  db.orders.set(orderId, updated)
  return Promise.resolve(ok(toOrderView(updated)))
}

function transitionCall(
  id: string,
  next: 'acknowledged' | 'resolved',
): Promise<Result<WaiterCallView>> {
  const db = store()
  const row = db.calls.get(id)
  if (!row) {
    return Promise.resolve(
      err(
        appError('NOT_FOUND', 'waiter call not found', {
          wire: 'QR030_NOT_FOUND',
          details: { entity: 'waiter_call' },
        }),
      ),
    )
  }

  const legal =
    (row.status === 'pending' && (next === 'acknowledged' || next === 'resolved')) ||
    (row.status === 'acknowledged' && next === 'resolved')

  if (!legal) {
    return Promise.resolve(
      err(
        appError('INVALID_TRANSITION', `illegal waiter-call transition ${row.status} -> ${next}`, {
          wire: 'QR041_INVALID_CALL_TRANSITION',
          details: { from: row.status, to: next },
        }),
      ),
    )
  }

  const stamp = new Date().toISOString()
  const updated: WaiterCallRow = {
    ...row,
    status: next,
    acknowledged_at: next === 'acknowledged' ? stamp : row.acknowledged_at,
    acknowledged_by_staff_id:
      next === 'acknowledged' ? DEMO_IDS.ownerStaffId : row.acknowledged_by_staff_id,
    resolved_at: next === 'resolved' ? stamp : row.resolved_at,
    resolved_by_staff_id: next === 'resolved' ? DEMO_IDS.ownerStaffId : row.resolved_by_staff_id,
    updated_at: stamp,
  }

  db.calls.set(id, updated)
  return Promise.resolve(ok(decorateCall(updated, new Date())))
}

/* ================================================================== */
/* Admin reads                                                         */
/* ================================================================== */

function listCategories(branchId: string | null): Promise<Result<CategoryAdminView[]>> {
  const at = new Date()
  const views = FIXTURES.categories.map((category): CategoryAdminView => {
    const items = FIXTURES.menuItems
      .filter((row) => row.category_id === category.id)
      .filter((row) => branchId === null || row.branch_id === null || row.branch_id === branchId)
      .map((row) => toMenuItemView(menuItemRow(row, at)))

    return {
      view: toMenuCategoryView(
        {
          ...category,
          image_path: null,
          deleted_at: null,
          created_at: at.toISOString(),
          updated_at: at.toISOString(),
        },
        items,
      ),
      branchId: category.branch_id,
      isActive: category.is_active,
      updatedAt: at.toISOString(),
    }
  })

  return Promise.resolve(ok(views))
}

function listMenuItems(
  branchId: string | null,
  filters: MenuItemFilters = {},
): Promise<Result<MenuItemAdminView[]>> {
  const at = new Date()
  const categoryNames = new Map<string, I18nText>(
    FIXTURES.categories.map((category) => [category.id, category.name]),
  )
  const needle = filters.search?.trim().toLowerCase() ?? ''

  const views = FIXTURES.menuItems
    .filter((row) => branchId === null || row.branch_id === null || row.branch_id === branchId)
    .filter((row) => !filters.categoryId || row.category_id === filters.categoryId)
    .filter((row) => {
      if (filters.availability === 'available') return row.is_available
      if (filters.availability === 'unavailable') return !row.is_available
      return true
    })
    .filter((row) => {
      if (needle === '') return true
      const haystack = [...Object.values(row.name), ...Object.values(row.description)]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
    .map((row): MenuItemAdminView => {
      const dbRow = menuItemRow(row, at)
      return {
        item: toMenuItemView(dbRow, {
          optionRows: (optionsByItem.get(row.id) ?? []).map((option) =>
            menuItemOptionRow(option, at),
          ),
        }),
        branchId: row.branch_id,
        categoryName: categoryNames.get(row.category_id) ?? null,
        unavailableUntil: dbRow.unavailable_until,
        availableFrom: null,
        availableUntil: null,
        popularityScore: row.popularity_score,
        updatedAt: dbRow.updated_at,
      }
    })

  return Promise.resolve(ok(views))
}

function getMenuItem(id: string): Promise<Result<MenuItemAdminView>> {
  const source = itemById.get(id)
  if (!source) {
    return Promise.resolve(
      err(
        appError('NOT_FOUND', 'menu item not found', {
          wire: 'QR030_NOT_FOUND',
          details: { entity: 'menu_item' },
        }),
      ),
    )
  }

  const at = new Date()
  const dbRow = menuItemRow(source, at)
  const optionRows = (optionsByItem.get(id) ?? []).map((option) => menuItemOptionRow(option, at))

  return Promise.resolve(
    ok({
      item: toMenuItemView(dbRow, { optionRows }),
      branchId: source.branch_id,
      categoryName:
        FIXTURES.categories.find((category) => category.id === source.category_id)?.name ?? null,
      unavailableUntil: dbRow.unavailable_until,
      availableFrom: null,
      availableUntil: null,
      popularityScore: source.popularity_score,
      updatedAt: dbRow.updated_at,
    }),
  )
}

/** The option groups of one dish — the same grouping the live service does. */
function listMenuItemOptions(menuItemId: string) {
  const at = new Date()
  return Promise.resolve(
    ok(
      toMenuOptionGroups(
        (optionsByItem.get(menuItemId) ?? []).map((option) => menuItemOptionRow(option, at)),
      ),
    ),
  )
}

function tableView(source: FixtureTable, at: Date): TableAdminView {
  return {
    id: source.id,
    branchId: source.branch_id,
    number: source.number,
    name: source.name,
    zone: source.zone,
    seats: source.seats,
    sortOrder: source.sort_order,
    isActive: source.is_active,
    hasQrToken: true,
    qrRotationCount: 0,
    qrTokenIssuedAt: iso(-30 * 86_400_000, at),
    updatedAt: iso(-86_400_000, at),
  }
}

function listTables(branchId: string): Promise<Result<TableAdminView[]>> {
  const at = new Date()
  return Promise.resolve(
    ok(
      FIXTURES.tables
        .filter((row) => row.branch_id === branchId)
        .map((row) => tableView(row, at)),
    ),
  )
}

function getTable(id: string): Promise<Result<TableDetailView>> {
  const source = tableById.get(id)
  if (!source) {
    return Promise.resolve(
      err(
        appError('NOT_FOUND', 'table not found', {
          wire: 'QR030_NOT_FOUND',
          details: { entity: 'table' },
        }),
      ),
    )
  }
  const at = new Date()
  return Promise.resolve(
    ok({
      ...tableView(source, at),
      qrToken: source.qr_token,
      qrUrl: `/t/${source.qr_token}`,
    }),
  )
}

function listBranches(): Promise<Result<BranchAdminView[]>> {
  const at = new Date()
  const views = FIXTURES.branches.map((row): BranchAdminView => ({
    id: row.id,
    name: row.name,
    code: row.code,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    latitude: null,
    longitude: null,
    serviceFeeBps: row.service_fee_bps,
    effectiveServiceFeeBps: row.service_fee_bps ?? SERVICE_FEE_BPS,
    openingHours: {},
    waiterCallCooldownSeconds: row.waiter_call_cooldown_seconds,
    waiterCallExpiryMinutes: row.waiter_call_expiry_minutes,
    orderMinIntervalSeconds: row.order_min_interval_seconds,
    defaultPrepMinutes: row.default_prep_minutes,
    lateOrderThresholdMinutes: row.late_order_threshold_minutes,
    isActive: row.is_active,
    isAcceptingOrders: row.is_accepting_orders,
    tableCount: FIXTURES.tables.filter((table) => table.branch_id === row.id).length,
    updatedAt: iso(-86_400_000, at),
  }))

  return Promise.resolve(ok(views))
}

function listStaff(): Promise<Result<StaffAdminView[]>> {
  const at = new Date()
  const views = FIXTURES.staff.map((row): StaffAdminView => ({
    id: row.id,
    profileId: row.profile_id,
    branchId: row.branch_id,
    role: row.role,
    displayName: row.display_name,
    email: row.email,
    employeeCode: row.employee_code,
    avatarUrl: null,
    locale: row.locale,
    isActive: row.is_active,
    isPlatformAdmin: false,
    invitedAt: iso(-120 * 86_400_000, at),
    joinedAt: iso(-118 * 86_400_000, at),
    updatedAt: iso(-86_400_000, at),
  }))

  return Promise.resolve(ok(views))
}

function getSettings(): Promise<Result<SettingsView>> {
  const at = new Date()
  return Promise.resolve(
    ok({
      id: REST.id,
      name: REST.name,
      slug: REST.slug,
      logoUrl: REST.logo_url,
      coverImageUrl: REST.cover_image_url,
      phone: REST.phone,
      email: REST.email,
      welcomeMessage: REST.welcome_message,
      description: REST.description,
      defaultLocale: REST.default_locale,
      currency: REST.currency,
      currencyDecimals: REST.currency_decimals,
      serviceFeeEnabled: REST.service_fee_enabled,
      serviceFeeBps: REST.service_fee_bps,
      isActive: REST.is_active,
      isDemo: true,
      updatedAt: iso(-86_400_000, at),
    }),
  )
}

/* ================================================================== */
/* Dashboard — real arithmetic over fixture rows, flagged as demo      */
/* ================================================================== */

/**
 * The same aggregation the live service performs, over the same in-memory
 * orders the kitchen display is showing.
 *
 * `isDemo: true` is not decoration. It travels with the numbers into the
 * component, which is what lets a single stat tile — cropped out of a
 * screenshot, with no page header in frame — still say that it describes
 * nothing real (brief §11, doc 05 §8.5).
 */
function getDashboardStats(
  branchId: string | null,
  options: { businessDate?: string; now?: Date } = {},
): Promise<Result<DashboardStats>> {
  const now = options.now ?? new Date()
  const scoped = branchId ? [branchById.get(branchId)] : FIXTURES.branches
  const branches = scoped.filter((row): row is FixtureBranch => row !== undefined)
  const timezone = branches[0]?.timezone ?? 'Asia/Tashkent'
  const businessDate = options.businessDate ?? businessDateFor(timezone, now)

  const ordersByStatus = {} as Record<OrderStatus, number>
  for (const status of ORDER_STATUSES) ordersByStatus[status] = 0

  const rows = ordersOfBranch(branchId)
  const dayRows = rows.filter((row) => row.business_date === businessDate)

  const countedTotals: Money[] = []
  const cancelledTotals: Money[] = []
  const countedIds = new Set<string>()

  for (const row of dayRows) {
    ordersByStatus[row.status] += 1
    if (row.status === 'cancelled') cancelledTotals.push(row.total)
    else {
      countedTotals.push(row.total)
      countedIds.add(row.id)
    }
  }

  const todayRevenue = sumMoney(countedTotals)
  const todayOrderCount = countedTotals.length

  const activeTables = new Set<string>()
  let pendingOrderCount = 0
  let lateOrderCount = 0

  for (const row of rows) {
    if (isTerminalStatus(row.status)) continue
    if (row.table_id) activeTables.add(row.table_id)
    if (row.status === 'pending') pendingOrderCount += 1

    const threshold =
      branchById.get(row.branch_id)?.late_order_threshold_minutes ?? 25
    const late = isLate(
      {
        created_at: row.placed_at,
        confirmed_at: row.confirmed_at,
        preparation_minutes: row.estimated_prep_minutes,
        status: row.status,
      },
      threshold,
      now,
    )
    if (late) lateOrderCount += 1
  }

  const buckets = new Map<string, DashboardTopItem & { totals: Money[] }>()
  for (const row of dayRows) {
    if (!countedIds.has(row.id)) continue
    for (const line of row.order_items ?? []) {
      const key = line.menu_item_id ?? `name:${JSON.stringify(line.name_snapshot)}`
      const bucket = buckets.get(key) ?? {
        menuItemId: line.menu_item_id,
        name: line.name_snapshot,
        quantitySold: 0,
        revenue: 0,
        totals: [],
      }
      bucket.quantitySold += line.quantity
      bucket.totals.push(line.total)
      buckets.set(key, bucket)
    }
  }

  const topItems: DashboardTopItem[] = [...buckets.values()]
    .map((bucket) => ({
      menuItemId: bucket.menuItemId,
      name: bucket.name,
      quantitySold: bucket.quantitySold,
      revenue: sumMoney(bucket.totals),
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, 5)

  const branchIds = new Set(branches.map((row) => row.id))
  const openCalls = callsOfBranch(branchId).filter((row) =>
    (OPEN_CALL_STATUSES as readonly string[]).includes(row.status),
  )

  return Promise.resolve(
    ok({
      restaurantId: REST.id,
      branchId,
      businessDate,
      timezone,
      currency: REST.currency,
      currencyDecimals: REST.currency_decimals,
      todayRevenue,
      todayOrderCount,
      averageOrderValue: todayOrderCount === 0 ? 0 : Math.floor(todayRevenue / todayOrderCount),
      activeTableCount: activeTables.size,
      totalTableCount: FIXTURES.tables.filter((row) => branchIds.has(row.branch_id)).length,
      pendingOrderCount,
      lateOrderCount,
      openWaiterCallCount: openCalls.length,
      ordersByStatus,
      topItems,
      cancelledOrderCount: cancelledTotals.length,
      cancelledRevenue: sumMoney(cancelledTotals),
      isDemo: true,
      generatedAt: now.toISOString(),
    }),
  )
}

/* ================================================================== */
/* The repository                                                      */
/* ================================================================== */

/**
 * Mirrors `src/lib/rpc/public.ts` and the read half of `src/lib/services/*`,
 * signature for signature, so the data layer swaps one for the other with no
 * shape conversion in between.
 *
 * Writes the demo does not simulate return `demoReadOnly(...)` rather than
 * throwing or lying.
 */
export const demoRepository = {
  /* --- public capability API --- */
  resolveTable,
  getMenu,
  getOrder,
  placeOrder,
  cancelOrder,
  callWaiter,

  /* --- staff reads --- */
  listKitchenTickets,
  listOrders,
  getOrderById,
  listWaiterCalls,
  listCategories,
  listMenuItems,
  getMenuItem,
  listMenuItemOptions,
  listTables,
  getTable,
  listBranches,
  listStaff,
  getSettings,
  getDashboardStats,

  /* --- staff writes the demo simulates --- */
  updateOrderStatus,
  acknowledgeCall: (id: string) => transitionCall(id, 'acknowledged'),
  resolveCall: (id: string) => transitionCall(id, 'resolved'),

  /* --- everything else --- */
  createCategory: () => Promise.resolve(demoRefusal<{ id: string }>('categories')),
  updateCategory: () => Promise.resolve(demoRefusal<{ id: string }>('categories')),
  deleteCategory: () => Promise.resolve(demoRefusal<null>('categories')),
  createMenuItem: () => Promise.resolve(demoRefusal<{ id: string }>('menu items')),
  updateMenuItem: () => Promise.resolve(demoRefusal<{ id: string }>('menu items')),
  deleteMenuItem: () => Promise.resolve(demoRefusal<null>('menu items')),
  setItemAvailability: () => Promise.resolve(demoRefusal<null>('menu availability')),
  reorder: () => Promise.resolve(demoRefusal<null>('ordering')),
  createTable: () => Promise.resolve(demoRefusal<{ id: string; qrToken: string }>('tables')),
  updateTable: () => Promise.resolve(demoRefusal<null>('tables')),
  deleteTable: () => Promise.resolve(demoRefusal<null>('tables')),
  rotateToken: () => Promise.resolve(demoRefusal<null>('QR tokens')),
  createBranch: () => Promise.resolve(demoRefusal<{ id: string }>('branches')),
  updateBranch: () => Promise.resolve(demoRefusal<null>('branches')),
  inviteStaff: () => Promise.resolve(demoRefusal<{ staffId: string }>('staff invitations')),
  updateStaff: () => Promise.resolve(demoRefusal<null>('staff')),
  deactivateStaff: () => Promise.resolve(demoRefusal<null>('staff')),
  updateSettings: () => Promise.resolve(demoRefusal<null>('settings')),
} as const

/** Test seam: forget every simulated write and reseed from the fixture. */
export function __resetDemoStore(): void {
  state = null
}
