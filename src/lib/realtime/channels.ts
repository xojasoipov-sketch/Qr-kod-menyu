/**
 * The only module that builds a realtime topic string.
 *
 * Concentrating it here is a security control, not tidiness. A topic name IS a
 * capability for the customer lane: `order:{public_code}` carries 72 bits of
 * entropy that the diner already holds via their tracking URL, and RLS on
 * `realtime.messages` authorises the channel by parsing that name. A topic
 * assembled from unvalidated input is how a client ends up subscribed to
 * `order:undefined`, or how an attacker probes for a topic that exists.
 */
import { publicCodeSchema, qrTokenSchema, uuidSchema } from '@/lib/validation/common'

/**
 * Bumped when a payload shape changes. Every broadcast payload carries `v`.
 * A client receiving an unknown version ignores the message and resyncs from
 * the server rather than guessing at a shape it does not know.
 */
export const REALTIME_PROTOCOL_VERSION = 1 as const

export type OrderTopic = `order:${string}`
export type TableTopic = `table:${string}`
export type BranchTopic = `branch:${string}`
export type RealtimeTopic = OrderTopic | TableTopic | BranchTopic

/* ------------------------------------------------------------------ */
/* Event names — a closed set, shared with the Postgres broadcast      */
/* triggers. A name here that the trigger does not send is a silent    */
/* dead subscription, so both sides are changed together.              */
/* ------------------------------------------------------------------ */

/** Customer lane: one diner watching one order. */
export const ORDER_EVENTS = {
  created: 'order.created',
  statusChanged: 'order.status_changed',
} as const

/** Staff lane: every panel scoped to one branch. */
export const BRANCH_EVENTS = {
  orderCreated: 'order.created',
  orderReady: 'order.ready',
  orderCancelled: 'order.cancelled',
  waiterCallCreated: 'waiter_call.created',
  waiterCallAcknowledged: 'waiter_call.acknowledged',
} as const

/** Table lane: feedback to the diner who pressed CALL WAITER. */
export const TABLE_EVENTS = {
  waiterCallAcknowledged: 'waiter_call.acknowledged',
  waiterCallResolved: 'waiter_call.resolved',
} as const

export type OrderEvent = (typeof ORDER_EVENTS)[keyof typeof ORDER_EVENTS]
export type BranchEvent = (typeof BRANCH_EVENTS)[keyof typeof BRANCH_EVENTS]
export type TableEvent = (typeof TABLE_EVENTS)[keyof typeof TABLE_EVENTS]

export class InvalidTopicError extends Error {
  constructor(kind: string, value: string) {
    super(`Refusing to build a ${kind} topic from an invalid identifier: ${JSON.stringify(value)}`)
    this.name = 'InvalidTopicError'
  }
}

/** One diner tracking one order. Authorised by knowing the public code. */
export function orderTopic(publicCode: string): OrderTopic {
  const parsed = publicCodeSchema.safeParse(publicCode)
  if (!parsed.success) throw new InvalidTopicError('order', publicCode)
  return `order:${parsed.data}`
}

/** One table's own lane — waiter-call acknowledgements come back on it. */
export function tableTopic(qrToken: string): TableTopic {
  const parsed = qrTokenSchema.safeParse(qrToken)
  if (!parsed.success) throw new InvalidTopicError('table', qrToken)
  return `table:${parsed.data}`
}

/** Every staff panel for one branch. Authorised by the session's branch access. */
export function branchTopic(branchId: string): BranchTopic {
  const parsed = uuidSchema.safeParse(branchId)
  if (!parsed.success) throw new InvalidTopicError('branch', branchId)
  return `branch:${parsed.data}`
}

/* ------------------------------------------------------------------ */
/* Status sets each panel cares about. Defined once so the realtime    */
/* filter, the initial query and the reconnect resync cannot drift.    */
/* ------------------------------------------------------------------ */

/** What the kitchen display shows. `delivered` and later are the waiter's problem. */
export const KDS_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'] as const

/** What the waiter's "active" column shows. */
export const WAITER_ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing'] as const

/** A waiter call still ringing or being handled. */
export const OPEN_CALL_STATUSES = ['pending', 'acknowledged'] as const

/** Tables a branch channel carries postgres_changes for. */
export const BRANCH_TABLES = ['orders', 'waiter_calls', 'menu_items', 'notifications'] as const
export type BranchTable = (typeof BRANCH_TABLES)[number]

/* ------------------------------------------------------------------ */
/* Timings. Named because each encodes a decision, not a magic number. */
/* ------------------------------------------------------------------ */

/** A join that has not completed by now is treated as failed and retried. */
export const JOIN_TIMEOUT_MS = 8_000

/** No traffic for this long means the panel may have missed an event: resync. */
export const STALE_AFTER_MS = 45_000

/** Collapses a burst of resync triggers into one refetch. */
export const RESYNC_DEBOUNCE_MS = 400

/** Batches the per-order hydration fetches a burst of inserts would cause. */
export const HYDRATION_COALESCE_MS = 120

/** How long a ready ticket stays on the KDS before it stops competing for space. */
export const KDS_READY_TTL_MS = 15 * 60_000

/** Suppresses a repeated audible alert for the same event. */
export const ALERT_DEDUPE_MS = 10_000
