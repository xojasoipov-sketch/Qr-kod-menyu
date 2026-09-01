'use client'

/**
 * The transport layer: what a topic is bound to, and what shape is allowed
 * through. Browser only — every function here reaches the socket owned by
 * `createBrowserClient()` through the reference-counted manager.
 *
 * Two rules are enforced here rather than trusted to callers:
 *
 * 1. **Every inbound payload is parsed before it reaches a handler.** A
 *    broadcast is untrusted input: it arrives over the network into a client
 *    that cannot verify who wrote it beyond "someone RLS let publish". Today
 *    only the database publishes (there is no INSERT policy on
 *    `realtime.messages` for `anon` or `authenticated`), and the parse costs
 *    microseconds; it is the difference between a protocol change producing a
 *    typed rejection and producing `undefined` rendered into the DOM.
 *
 * 2. **An unknown protocol version is ignored, never guessed at.** A payload
 *    carrying `v` different from REALTIME_PROTOCOL_VERSION fails the schema and
 *    is reported through `onProtocolMismatch`, whose contract in every consumer
 *    is "drop the message and resync from the server".
 *
 * DISCREPANCY WITH THE SPEC, DELIBERATE (the SQL is what runs):
 * doc 06 §1.4 requires every payload to carry `v: 1`, but the broadcasts the
 * migrations actually emit (`20260901001300_public_api.sql`,
 * `20260901001600_staff_and_admin_rpcs.sql`) carry no `v` and only a subset of
 * the documented fields. So `v` is OPTIONAL here — absent means "the protocol
 * version this client was written against", present-and-different means unknown
 * and is refused — and every field the migrations do not send is nullish. The
 * moment the documented `broadcast_order_event()` trigger lands with `v`, both
 * shapes validate and nothing here changes.
 */

import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'
import { z } from 'zod'

import {
  BRANCH_EVENTS,
  ORDER_EVENTS,
  REALTIME_PROTOCOL_VERSION,
  branchTopic,
  orderTopic,
} from '@/lib/realtime/channels'
import { acquireChannel, type ChannelHandle } from '@/lib/realtime/manager'
import {
  ORDER_STATUSES,
  WAITER_CALL_REASONS,
  type MenuItemRow,
  type NotificationRow,
  type OrderRow,
  type WaiterCallRow,
} from '@/types/database'

/* ------------------------------------------------------------------ */
/* Payload schemas                                                     */
/* ------------------------------------------------------------------ */

/** Absent = version 1 (what the migrations emit). Present and different = unknown. */
const protocolVersion = z.literal(REALTIME_PROTOCOL_VERSION).optional()

const orderStatus = z.enum(ORDER_STATUSES)
const waiterCallReason = z.enum(WAITER_CALL_REASONS)
const timestamp = z.string().min(1).max(64)

/**
 * The customer lane. `order.cancelled` is included because
 * `public_cancel_order()` publishes it onto `order:{public_code}`; the event
 * name is taken from the constants module, never spelled inline.
 */
export const orderBroadcastSchema = z.object({
  v: protocolVersion,
  event: z.enum([ORDER_EVENTS.created, ORDER_EVENTS.statusChanged, BRANCH_EVENTS.orderCancelled]),
  status: orderStatus,
  public_code: z.string().min(1).max(64).nullish(),
  order_number: z.string().min(1).max(32).nullish(),
  table_number: z.string().max(32).nullish(),
  estimated_prep_minutes: z.number().int().nonnegative().nullish(),
  due_at: timestamp.nullish(),
  cancellation_reason: z.string().max(400).nullish(),
  at: timestamp.nullish(),
})

export type OrderBroadcast = z.infer<typeof orderBroadcastSchema>

/**
 * The staff alert lane. One permissive object; `event` discriminates, exactly as
 * doc 06 §1.2 intends ("one topic per entity; the event name discriminates").
 * Every field beyond `event` is optional because the five events carry
 * different subsets and the migrations send fewer fields than doc 06 §2.5
 * documents.
 */
export const branchBroadcastSchema = z.object({
  v: protocolVersion,
  event: z.enum([
    BRANCH_EVENTS.orderCreated,
    BRANCH_EVENTS.orderReady,
    BRANCH_EVENTS.orderCancelled,
    BRANCH_EVENTS.waiterCallCreated,
    BRANCH_EVENTS.waiterCallAcknowledged,
  ]),
  order_id: z.string().min(1).max(64).nullish(),
  order_number: z.string().min(1).max(32).nullish(),
  public_code: z.string().min(1).max(64).nullish(),
  status: orderStatus.nullish(),
  table_number: z.string().max(32).nullish(),
  table_name: z.string().max(120).nullish(),
  item_count: z.number().int().nonnegative().nullish(),
  is_late: z.boolean().nullish(),
  call_id: z.string().min(1).max(64).nullish(),
  reason: waiterCallReason.nullish(),
  note: z.string().max(400).nullish(),
  at: timestamp.nullish(),
})

export type BranchBroadcast = z.infer<typeof branchBroadcastSchema>

/* ------------------------------------------------------------------ */
/* Handler contracts                                                   */
/* ------------------------------------------------------------------ */

/** Why the channel left the joined state. */
export type DownReason = 'error' | 'timeout' | 'closed'

export interface SubscribeLifecycle {
  /** Any transition INTO the joined state, including the first. Always resyncs. */
  onLive: () => void
  /** Left the joined state. */
  onDown: (reason: DownReason) => void
  /** Any inbound message. Feeds the staleness watchdog. */
  onTraffic?: () => void
  /** Failed validation or an unknown protocol version. Contract: drop + resync. */
  onProtocolMismatch?: (raw: unknown) => void
}

export interface OrderSubscriptionHandlers extends SubscribeLifecycle {
  onMessage: (payload: OrderBroadcast) => void
}

/**
 * One `postgres_changes` row event on the branch channel, tagged with its table
 * so a consumer can narrow the row type without re-deriving it from a string.
 */
export type BranchPostgresEvent =
  | { table: 'orders'; payload: RealtimePostgresChangesPayload<OrderRow> }
  | { table: 'waiter_calls'; payload: RealtimePostgresChangesPayload<WaiterCallRow> }
  | { table: 'menu_items'; payload: RealtimePostgresChangesPayload<MenuItemRow> }
  | { table: 'notifications'; payload: RealtimePostgresChangesPayload<NotificationRow> }

export interface BranchSubscriptionHandlers extends SubscribeLifecycle {
  /** STATE lane. Every staff list is derived from this plus resync, and nothing else. */
  onPostgres: (event: BranchPostgresEvent) => void
  /** ALERT lane. May chime, toast or flash. Must never insert, remove or reorder a row. */
  onBroadcast: (payload: BranchBroadcast) => void
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

function lifecycleListener(handlers: SubscribeLifecycle) {
  return (status: string): void => {
    switch (status) {
      case 'SUBSCRIBED':
        handlers.onLive()
        return
      case 'CHANNEL_ERROR':
        handlers.onDown('error')
        return
      case 'TIMED_OUT':
        handlers.onDown('timeout')
        return
      case 'CLOSED':
        handlers.onDown('closed')
        return
      default:
        return
    }
  }
}

/**
 * The customer tracker's channel: `order:{public_code}`.
 *
 * Unauthenticated. The topic name IS the capability — RLS on
 * `realtime.messages` answers "is this a real order created in the last 24 h?"
 * via `public.order_topic_is_valid()`. `anon` holds no table privilege at all,
 * so this channel carries broadcast only; there is no postgres_changes lane to
 * fall back to and the resync path is the public RPC.
 */
export function subscribeToOrder(
  publicCode: string,
  handlers: OrderSubscriptionHandlers,
): ChannelHandle {
  const topic = orderTopic(publicCode)

  const dispatch = (raw: unknown): void => {
    handlers.onTraffic?.()
    const parsed = orderBroadcastSchema.safeParse(raw)
    if (!parsed.success) {
      handlers.onProtocolMismatch?.(raw)
      return
    }
    handlers.onMessage(parsed.data)
  }

  return acquireChannel(
    topic,
    (channel) => {
      // One handler per event name; the payload's own `event` discriminates.
      for (const event of [
        ORDER_EVENTS.created,
        ORDER_EVENTS.statusChanged,
        BRANCH_EVENTS.orderCancelled,
      ]) {
        channel.on<Record<string, unknown>>('broadcast', { event }, (message) => {
          dispatch(message.payload)
        })
      }
    },
    lifecycleListener(handlers),
  )
}

/**
 * The staff channel: `branch:{branch_id}`, carrying both transports (doc 06 §1.6).
 *
 * The complete binding set is registered here, before the join, because
 * supabase-js never ships a binding added to an already-joined channel. Every
 * staff panel in the tab multiplexes this one channel through the manager's
 * reference count.
 *
 * The `filter` is a bandwidth control, NOT a security control: it is applied by
 * the Realtime server before RLS, and RLS (orders_select_kitchen and friends) is
 * what decides what this subscriber may legally receive. There is no DELETE
 * binding: orders are cancelled, waiter calls are resolved and menu items are
 * soft-deleted, so a DELETE would be an integrity incident rather than a normal
 * event.
 */
export function subscribeToBranch(
  branchId: string,
  handlers: BranchSubscriptionHandlers,
): ChannelHandle {
  // Throws InvalidTopicError on anything that is not a uuid, which is also what
  // makes the filter below safe to build from `branchId`.
  const topic = branchTopic(branchId)
  const filter = `branch_id=eq.${branchId}`

  const dispatchBroadcast = (raw: unknown): void => {
    handlers.onTraffic?.()
    const parsed = branchBroadcastSchema.safeParse(raw)
    if (!parsed.success) {
      handlers.onProtocolMismatch?.(raw)
      return
    }
    handlers.onBroadcast(parsed.data)
  }

  return acquireChannel(
    topic,
    (channel) => {
      /* -------- STATE lane: postgres_changes (bindings B1..B6) -------- */
      channel
        .on<OrderRow>(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'orders', filter },
          (payload) => {
            handlers.onTraffic?.()
            handlers.onPostgres({ table: 'orders', payload })
          },
        )
        .on<OrderRow>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'orders', filter },
          (payload) => {
            handlers.onTraffic?.()
            handlers.onPostgres({ table: 'orders', payload })
          },
        )
        .on<WaiterCallRow>(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'waiter_calls', filter },
          (payload) => {
            handlers.onTraffic?.()
            handlers.onPostgres({ table: 'waiter_calls', payload })
          },
        )
        .on<WaiterCallRow>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'waiter_calls', filter },
          (payload) => {
            handlers.onTraffic?.()
            handlers.onPostgres({ table: 'waiter_calls', payload })
          },
        )
        .on<MenuItemRow>(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'menu_items', filter },
          (payload) => {
            handlers.onTraffic?.()
            handlers.onPostgres({ table: 'menu_items', payload })
          },
        )
        .on<NotificationRow>(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'notifications', filter },
          (payload) => {
            handlers.onTraffic?.()
            handlers.onPostgres({ table: 'notifications', payload })
          },
        )

      /* -------- ALERT lane: broadcast (bindings B7..B11) -------- */
      for (const event of [
        BRANCH_EVENTS.orderCreated,
        BRANCH_EVENTS.orderReady,
        BRANCH_EVENTS.orderCancelled,
        BRANCH_EVENTS.waiterCallCreated,
        BRANCH_EVENTS.waiterCallAcknowledged,
      ]) {
        channel.on<Record<string, unknown>>('broadcast', { event }, (message) => {
          dispatchBroadcast(message.payload)
        })
      }
    },
    lifecycleListener(handlers),
  )
}
