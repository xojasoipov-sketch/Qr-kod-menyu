// src/lib/validation/waiter.ts
import { z } from 'zod';
import {
  optionalNoteSchema, qrTokenSchema, uuidSchema, waiterCallReasonSchema,
} from '@/lib/validation/common';

/**
 * CALL WAITER, from the customer app. Matches public_call_waiter(p_token, p_reason).
 * The cooldown is enforced in Postgres (branches.waiter_call_cooldown_seconds); this schema
 * only guarantees the reason is one of the seven enum labels.
 */
export const waiterCallSchema = z.strictObject({
  token: qrTokenSchema,
  reason: waiterCallReasonSchema.default('call_waiter'),
  note: optionalNoteSchema(200),
});
export type WaiterCallInput = z.infer<typeof waiterCallSchema>;

/**
 * A waiter acknowledging or resolving a call. `cancelled` is a customer action; `expired` is a
 * system action; neither is reachable from this schema.
 */
export const waiterCallUpdateSchema = z.strictObject({
  waiter_call_id: uuidSchema,
  next_status: z.enum(['acknowledged', 'resolved']),
});
export type WaiterCallUpdateInput = z.infer<typeof waiterCallUpdateSchema>;
