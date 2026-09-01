/**
 * Wire and row shapes -> order view models.
 *
 * An order is read from two very different places and must look the same from
 * both:
 *
 *   - `public_get_order` / `public_place_order` JSONB (parsed by `PublicOrderSchema`)
 *     — the diner's tracker, reached with a QR token and a public code.
 *   - `orders` joined with `order_items`, `order_item_options`, `tables` and
 *     `order_status_history`, read by the staff services under RLS — the KDS
 *     card, the waiter board and the admin order list.
 *
 * The snapshot columns are what make this safe: every line renders from
 * `name_snapshot` / `price_snapshot`, never from a live `menu_items` join, so an
 * order placed before a rename or a repricing still prints what the guest
 * actually bought (brief §25, §34.4).
 */
import { assertMoney, type Money } from '@/lib/money'
import { elapsedSeconds, isLate as isLateOrder } from '@/lib/orders/lateness'
import { isTerminalStatus, statusIndex } from '@/lib/orders/state-machine'
import type { PublicOrder, PublicOrderLine } from '@/lib/rpc/schemas'
import type {
  OrderItemOptionRow,
  OrderItemRow,
  OrderRow,
  OrderStatus,
} from '@/types/database'
import type {
  KitchenTicket,
  KitchenTicketLine,
  OrderLineOptionView,
  OrderLineView,
  OrderStatusEvent,
  OrderView,
} from '@/types/domain'

/* ------------------------------------------------------------------ */
/* The staff-side row shapes                                           */
/* ------------------------------------------------------------------ */

/** A joined `tables` row. Null for a takeaway order, which has no table. */
export interface OrderTableJoin {
  number: string
  name: string | null
}

/** `order_items` with its embedded `order_item_options`. */
export interface OrderItemRowWithOptions extends OrderItemRow {
  order_item_options?: OrderItemOptionRow[] | null
}

/** One `order_status_history` row, reduced to what the tracker renders. */
export interface OrderHistoryJoin {
  new_status: OrderStatus
  created_at: string
}

/**
 * The staff select shape:
 *
 *   .select('*, order_items(*, order_item_options(*)), tables(number, name),
 *            order_status_history(new_status, created_at)')
 *
 * Every embedded relation is optional here because not every call site needs
 * all of them — the KDS does not fetch history, the admin list does not fetch
 * options — and a mapper that demanded them would force wasteful joins.
 */
export interface OrderRowWithRelations extends OrderRow {
  order_items?: OrderItemRowWithOptions[] | null
  tables?: OrderTableJoin | null
  order_status_history?: OrderHistoryJoin[] | null
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

function money(value: number, label: string): Money {
  assertMoney(value, label)
  return value
}

function isWireOrder(source: PublicOrder | OrderRowWithRelations): source is PublicOrder {
  return 'lines' in source
}

function isWireLine(
  source: PublicOrderLine | OrderItemRowWithOptions,
): source is PublicOrderLine {
  return 'unit_price' in source
}

/* ------------------------------------------------------------------ */
/* Lines                                                               */
/* ------------------------------------------------------------------ */

function optionFromRow(row: OrderItemOptionRow): OrderLineOptionView {
  return {
    name: row.name_snapshot,
    priceDelta: money(row.price_delta_snapshot, 'option price delta'),
    quantity: row.quantity,
  }
}

/**
 * One line of an order.
 *
 * `lineTotal` is read, never recomputed: in Postgres it is a GENERATED column
 * (`quantity * (price_snapshot + options_total)`), and recomputing it here would
 * create a second definition of the same number that could drift from the one
 * the deferred totals assertion checks at COMMIT.
 */
export function toOrderLineView(
  source: PublicOrderLine | OrderItemRowWithOptions,
): OrderLineView {
  if (isWireLine(source)) {
    return {
      id: source.id,
      name: source.name,
      description: source.description,
      imageUrl: source.image_url,
      unitPrice: money(source.unit_price, 'line unit price'),
      quantity: source.quantity,
      optionsTotal: money(source.options_total, 'line options total'),
      lineTotal: money(source.line_total, 'line total'),
      note: source.note,
      spicyLevel: source.spicy_level ?? 0,
      options: source.options.map((option) => ({
        name: option.name,
        priceDelta: money(option.price_delta, 'option price delta'),
        quantity: option.quantity,
      })),
    }
  }

  const options = [...(source.order_item_options ?? [])]
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map(optionFromRow)

  return {
    id: source.id,
    name: source.name_snapshot,
    description: source.description_snapshot,
    imageUrl: source.image_url_snapshot,
    unitPrice: money(source.price_snapshot, 'line unit price'),
    quantity: source.quantity,
    optionsTotal: money(source.options_total, 'line options total'),
    lineTotal: money(source.total, 'line total'),
    note: source.note,
    spicyLevel: source.spicy_level_snapshot,
    options,
  }
}

function linesOf(source: PublicOrder | OrderRowWithRelations): OrderLineView[] {
  if (isWireOrder(source)) return source.lines.map(toOrderLineView)
  return [...(source.order_items ?? [])]
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .map(toOrderLineView)
}

function historyOf(source: PublicOrder | OrderRowWithRelations): OrderStatusEvent[] {
  if (isWireOrder(source)) {
    return source.history.map((event) => ({ status: event.status, at: event.at }))
  }
  return [...(source.order_status_history ?? [])]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((event) => ({ status: event.new_status, at: event.created_at }))
}

/* ------------------------------------------------------------------ */
/* The order                                                           */
/* ------------------------------------------------------------------ */

export interface OrderViewOptions {
  /**
   * The QR token of the order's table, when the caller has one. Only the
   * customer path does; a staff console holds order ids, not capabilities, and
   * must not mint a tracking URL it has no business handing out.
   */
  qrToken?: string | null
}

/**
 * The tracker / receipt / admin-detail view of one order.
 *
 * `statusIndex` is taken from the state machine rather than recomputed, so the
 * stepper and the transition rules cannot disagree — cancelled is -1 there and
 * -1 here, and a component that renders "step -1 of 6" is rendering an
 * off-path order, which is exactly what it should say.
 */
export function toOrderView(
  source: PublicOrder | OrderRowWithRelations,
  options: OrderViewOptions = {},
): OrderView {
  const lines = linesOf(source)
  const history = historyOf(source)

  if (isWireOrder(source)) {
    return {
      orderNumber: source.order_number,
      publicCode: source.public_code,
      trackingPath: source.tracking_path,
      status: source.status,
      statusIndex: statusIndex(source.status),
      isTerminal: isTerminalStatus(source.status),
      orderType: source.order_type,
      channel: source.channel,
      tableNumber: source.table.number,
      tableName: source.table.name,
      currency: source.currency,
      currencyDecimals: source.currency_decimals,
      subtotal: money(source.subtotal, 'subtotal'),
      discountTotal: money(source.discount_total, 'discount total'),
      serviceFee: money(source.service_fee, 'service fee'),
      total: money(source.total, 'total'),
      note: source.note,
      guestCount: source.guest_count,
      estimatedPrepMinutes: source.estimated_prep_minutes ?? 0,
      dueAt: source.due_at,
      placedAt: source.placed_at ?? source.created_at,
      confirmedAt: source.confirmed_at,
      readyAt: source.ready_at,
      deliveredAt: source.delivered_at,
      completedAt: source.completed_at,
      cancelledAt: source.cancelled_at,
      cancellationReason: source.cancellation_reason,
      lines,
      history,
    }
  }

  const token = options.qrToken ?? null

  return {
    orderNumber: source.order_number,
    publicCode: source.public_code,
    trackingPath: token
      ? `/t/${token}/order/${source.public_code}`
      : `/o/${source.public_code}`,
    status: source.status,
    statusIndex: statusIndex(source.status),
    isTerminal: isTerminalStatus(source.status),
    orderType: source.order_type,
    channel: source.channel,
    tableNumber: source.tables?.number ?? null,
    tableName: source.tables?.name ?? null,
    currency: source.currency,
    currencyDecimals: source.currency_decimals,
    subtotal: money(source.subtotal, 'subtotal'),
    discountTotal: money(source.discount_total, 'discount total'),
    serviceFee: money(source.service_fee, 'service fee'),
    total: money(source.total, 'total'),
    note: source.customer_note,
    guestCount: source.guest_count,
    estimatedPrepMinutes: source.estimated_prep_minutes,
    dueAt: source.due_at,
    placedAt: source.placed_at,
    confirmedAt: source.confirmed_at,
    readyAt: source.ready_at,
    deliveredAt: source.delivered_at,
    completedAt: source.completed_at,
    cancelledAt: source.cancelled_at,
    cancellationReason: source.cancellation_reason,
    lines,
    history,
  }
}

/* ------------------------------------------------------------------ */
/* Kitchen ticket                                                      */
/* ------------------------------------------------------------------ */

export interface KitchenTicketOptions {
  /** Passed in, never read from the clock, so a server render and the client tick agree. */
  now?: Date
  /** `branches.late_order_threshold_minutes`. */
  lateThresholdMinutes?: number
  /** `branches.default_prep_minutes`, used when the order carries no estimate. */
  defaultPrepMinutes?: number
}

const DEFAULT_LATE_THRESHOLD_MINUTES = 25
const DEFAULT_PREP_MINUTES = 15

function toKitchenTicketLine(row: OrderItemRowWithOptions): KitchenTicketLine {
  const line = toOrderLineView(row)
  return {
    id: line.id,
    name: line.name,
    quantity: line.quantity,
    note: line.note,
    spicyLevel: line.spicyLevel,
    preparationTime: row.preparation_time_snapshot,
    options: line.options,
  }
}

/**
 * The KDS card (brief §9).
 *
 * Only the staff row feeds this: a kitchen ticket needs `orders.id` and
 * `orders.branch_id` to act on the order and to subscribe to the right channel,
 * and the public payload deliberately carries neither.
 *
 * `ageSeconds` is a snapshot taken with the `now` the caller supplies, and the
 * card re-derives it on a one-second tick client-side. Reading the clock inside
 * this function would produce a server value that no longer matches by the time
 * React hydrates.
 */
export function toKitchenTicket(
  row: OrderRowWithRelations,
  options: KitchenTicketOptions = {},
): KitchenTicket {
  const now = options.now ?? new Date()
  const thresholdMinutes = options.lateThresholdMinutes ?? DEFAULT_LATE_THRESHOLD_MINUTES
  const prepMinutes =
    row.estimated_prep_minutes || options.defaultPrepMinutes || DEFAULT_PREP_MINUTES

  const timed = {
    created_at: row.placed_at,
    confirmed_at: row.confirmed_at,
    preparation_minutes: row.estimated_prep_minutes,
    status: row.status,
  }

  const ageSeconds = elapsedSeconds(timed, now)
  const late = isLateOrder(timed, thresholdMinutes, now)

  const lines = [...(row.order_items ?? [])]
    .sort(
      (a, b) =>
        a.sort_order - b.sort_order ||
        a.created_at.localeCompare(b.created_at) ||
        a.id.localeCompare(b.id),
    )
    .map(toKitchenTicketLine)

  return {
    orderId: row.id,
    orderNumber: row.order_number,
    publicCode: row.public_code,
    branchId: row.branch_id,
    tableNumber: row.tables?.number ?? null,
    tableName: row.tables?.name ?? null,
    status: row.status,
    channel: row.channel,
    placedAt: row.placed_at,
    confirmedAt: row.confirmed_at,
    preparingAt: row.preparing_at,
    readyAt: row.ready_at,
    ageSeconds,
    estimatedPrepMinutes: prepMinutes,
    dueAt: row.due_at,
    isLate: late,
    lateBySeconds: late ? Math.max(0, ageSeconds - thresholdMinutes * 60) : 0,
    customerNote: row.customer_note,
    guestCount: row.guest_count,
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
  }
}
