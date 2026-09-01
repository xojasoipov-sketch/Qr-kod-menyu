/**
 * `waiter_calls` rows -> the waiter console's card.
 *
 * The console's whole job is answering "who is calling, from which table, and
 * how long have they been waiting" (brief §10), so this mapper's contract is
 * that `tableNumber` is always a string a human can read out loud and
 * `ageSeconds` is always a number a timer can count up from.
 */
import { OPEN_CALL_STATUSES } from '@/lib/realtime/channels'
import type { WaiterCallRow, WaiterCallStatus } from '@/types/database'
import type { WaiterCallView } from '@/types/domain'

/** Joined `tables` row. */
export interface WaiterCallTableJoin {
  number: string
  name: string | null
}

/** Joined `orders` row, present only when the guest called from a tracker screen. */
export interface WaiterCallOrderJoin {
  order_number: string
}

/** Joined `staff` row for whoever acknowledged the call. */
export interface WaiterCallStaffJoin {
  id: string
  display_name: string | null
}

/**
 * The select shape:
 *
 *   .select('*, tables(number, name), orders(order_number),
 *            acknowledged_by:staff!waiter_calls_acknowledged_by_staff_id_fkey(id, display_name)')
 *
 * All three embeds are optional: the realtime `postgres_changes` payload
 * delivers a bare row, and a card that could not render from one would go blank
 * exactly when a guest is calling.
 */
export interface WaiterCallRowWithRelations extends WaiterCallRow {
  tables?: WaiterCallTableJoin | null
  orders?: WaiterCallOrderJoin | null
  acknowledged_by?: WaiterCallStaffJoin | null
}

export interface WaiterCallViewOptions {
  /** Passed in so a server render and the client's one-second tick agree. */
  now?: Date
  /** Fallback when the row arrived without its `tables` embed (a realtime payload). */
  tableNumber?: string
  tableName?: string | null
}

const OPEN: ReadonlySet<WaiterCallStatus> = new Set<WaiterCallStatus>(OPEN_CALL_STATUSES)

function secondsSince(iso: string, now: Date): number {
  const started = Date.parse(iso)
  if (Number.isNaN(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / 1000))
}

export function toWaiterCallView(
  row: WaiterCallRowWithRelations,
  options: WaiterCallViewOptions = {},
): WaiterCallView {
  const now = options.now ?? new Date()

  return {
    id: row.id,
    branchId: row.branch_id,
    tableId: row.table_id,
    tableNumber: row.tables?.number ?? options.tableNumber ?? '',
    tableName: row.tables?.name ?? options.tableName ?? null,
    reason: row.reason,
    status: row.status,
    isOpen: OPEN.has(row.status),
    note: row.note,
    createdAt: row.created_at,
    ageSeconds: secondsSince(row.created_at, now),
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByStaffId: row.acknowledged_by_staff_id,
    acknowledgedByName: row.acknowledged_by?.display_name ?? null,
    resolvedAt: row.resolved_at,
    resolvedByStaffId: row.resolved_by_staff_id,
    orderId: row.order_id,
    orderNumber: row.orders?.order_number ?? null,
  }
}

/** Open calls first, oldest first inside each group — the order a waiter works them. */
export function byUrgency(a: WaiterCallView, b: WaiterCallView): number {
  if (a.isOpen !== b.isOpen) return a.isOpen ? -1 : 1
  return b.ageSeconds - a.ageSeconds
}
