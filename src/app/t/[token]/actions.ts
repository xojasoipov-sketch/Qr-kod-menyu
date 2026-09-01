'use server'

/**
 * Server actions for the customer transaction surface.
 *
 * Each action is a thin, validated wrapper around one function of the public
 * capability API (`@/lib/rpc/public.ts`) — the ONLY way `/t/**` reaches the
 * database. The zod parse here is a second gate in front of the one the RPC
 * module already performs: it rejects a malformed client payload before a
 * network round trip is spent on it, and it is what lets this file, not the
 * component, own the demo/live switch (`isDemoMode()`), so every client
 * component just calls an action and renders the `Result` it gets back.
 *
 * Nothing here decides prices, availability or transition legality — that is
 * the database's job (doc 02 §1.3). This file only shapes the boundary.
 */

import { isDemoMode } from '@/lib/env'
import { demoRepository } from '@/lib/demo/demo-mode'
import { callWaiter, cancelOrder, placeOrder } from '@/lib/rpc/public'
import {
  CallWaiterInputSchema,
  CancelOrderInputSchema,
  PlaceOrderInputSchema,
  type PublicOrder,
  type WaiterCallResult,
} from '@/lib/rpc/schemas'
import { appError, err, type Result } from '@/lib/result'

/** Every action rejects the same shape of malformed input the same way. */
function validationFailure(source: string, issues: unknown): Result<never> {
  return err(
    appError('VALIDATION_FAILED', `${source} received a payload it does not understand`, {
      httpStatus: 422,
      details: { issues },
    }),
  )
}

/**
 * Send the cart to the kitchen.
 *
 * `input` carries no price anywhere in its shape — `PlaceOrderInputSchema` is
 * `.strict()`, so a client that tried to smuggle one in would fail validation
 * here rather than silently being ignored. `client_request_id` is the cart's
 * own id (born once, in `createEmptyCart`), which is what makes a retry of
 * this exact call idempotent: the database returns the order it already made
 * rather than a duplicate.
 */
export async function placeOrderAction(input: unknown): Promise<Result<PublicOrder>> {
  const parsed = PlaceOrderInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('placeOrderAction', parsed.error.issues)

  return isDemoMode() ? demoRepository.placeOrder(parsed.data) : placeOrder(parsed.data)
}

/**
 * Withdraw an order the kitchen has not yet accepted.
 *
 * The affordance that calls this must already have checked
 * `canTransition(status, 'cancelled', 'CUSTOMER')` client-side; this action
 * does not re-derive that decision, it only forwards to the RPC, which is the
 * actual authority and will refuse anything past `pending` regardless.
 */
export async function cancelOrderAction(input: unknown): Promise<Result<PublicOrder>> {
  const parsed = CancelOrderInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('cancelOrderAction', parsed.error.issues)

  return isDemoMode()
    ? demoRepository.cancelOrder(parsed.data.token, parsed.data.public_code, parsed.data.reason)
    : cancelOrder(parsed.data.token, parsed.data.public_code, parsed.data.reason)
}

/**
 * Ring the floor for this table.
 *
 * The cooldown is enforced under a row lock in the database, not by disabling
 * the client's button — a refusal comes back as `RATE_LIMITED` carrying
 * `retryAfterSeconds`, which the sheet renders as a countdown.
 */
export async function callWaiterAction(input: unknown): Promise<Result<WaiterCallResult>> {
  const parsed = CallWaiterInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('callWaiterAction', parsed.error.issues)

  return isDemoMode()
    ? demoRepository.callWaiter(parsed.data.token, parsed.data.reason)
    : callWaiter(parsed.data.token, parsed.data.reason)
}
