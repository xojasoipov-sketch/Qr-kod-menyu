// src/lib/validation/order.ts
import { z } from 'zod';
import {
  anyUuidSchema, optionalNoteSchema, orderStatusSchema, publicCodeSchema,
  qrTokenSchema, uuidSchema,
} from '@/lib/validation/common';
import { ACTOR_ROLES } from '@/lib/orders/state-machine';

/**
 * One line of a cart, as it crosses the wire to public_place_order.
 * THERE IS NO PRICE FIELD. Brief §34.2: prices are always server-calculated.
 * `option_ids` are ids only — the server reads price_delta from menu_item_options.
 */
export const cartLineSchema = z.strictObject({
  menu_item_id: uuidSchema,
  quantity: z.number().int().min(1).max(50),
  option_ids: z.array(uuidSchema).max(20).default([]),
  note: optionalNoteSchema(140),
}).refine(
  (line) => new Set(line.option_ids).size === line.option_ids.length,
  { error: 'errors.validation.duplicate_option', path: ['option_ids'] },
);
export type CartLineInput = z.infer<typeof cartLineSchema>;

/**
 * The full PLACE ORDER payload. Matches public_place_order(p_token, p_items, p_note,
 * p_client_request_id) argument for argument.
 * Caps mirror the SQL: 1..40 lines, note ≤ 280.
 */
export const placeOrderSchema = z.strictObject({
  token: qrTokenSchema,
  items: z.array(cartLineSchema).min(1).max(40),
  note: optionalNoteSchema(280),
  /** v4 UUID, one per cart, reused on retry. Makes a double submit idempotent. */
  client_request_id: anyUuidSchema,
  /** Frozen onto the order so the kitchen ticket prints in the language the guest ordered in. */
  locale: z.enum(['uz', 'ru', 'en']),
  guest_count: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
}).refine(
  (payload) => payload.items.reduce((sum, line) => sum + line.quantity, 0) <= 200,
  { error: 'errors.validation.too_many_units', path: ['items'] },
);
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** Customer withdrawing a pending order (public_cancel_order, §1.4). */
export const cancelOrderSchema = z.strictObject({
  token: qrTokenSchema,
  public_code: publicCodeSchema,
  reason: optionalNoteSchema(300).transform((r) => r ?? 'customer_cancelled'),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/**
 * A staff status change. The legality of (from -> to) for `actor` is checked by
 * assertTransition() BEFORE this payload is sent, and again by trg_orders_guard() after.
 * `expected_status` is an optimistic-concurrency guard: two waiters tapping READY on the same
 * ticket must not both succeed silently.
 */
export const statusUpdateSchema = z.strictObject({
  order_id: uuidSchema,
  expected_status: orderStatusSchema,
  next_status: orderStatusSchema,
  actor: z.enum(ACTOR_ROLES),
  cancellation_reason: optionalNoteSchema(300),
}).refine(
  (payload) => payload.expected_status !== payload.next_status,
  { error: 'errors.validation.same_status', path: ['next_status'] },
).refine(
  (payload) => payload.next_status !== 'cancelled' || payload.cancellation_reason !== null,
  { error: 'errors.app.VALIDATION_FAILED', path: ['cancellation_reason'] },
);
export type StatusUpdateInput = z.infer<typeof statusUpdateSchema>;
