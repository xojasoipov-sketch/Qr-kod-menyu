'use server'

/**
 * src/app/(staff)/waiter/actions.ts — the waiter console's three mutations.
 * Source: docs/architecture/05-app-structure.md §5.1, §5.2.4-5 (restructured: this
 * assignment keeps the waiter console's actions local to its own route segment
 * rather than the shared `src/app/_actions/*` modules those sections describe).
 *
 * Every action here follows the same five rules doc 05 §5.1 sets for every
 * Server Action in the product:
 *   1. First statement is a zod parse of `input: unknown`.
 *   2. Second statement is authorization — `requireCapability('waiter')`, which
 *      accepts WAITER, MANAGER, RESTAURANT_OWNER and a platform admin.
 *   3. Returns `Promise<Result<T>>`. Nothing throws across the boundary — the
 *      services underneath (`waiter-service`, `order-service`) already return
 *      `Result` themselves via `toResult()`, so there is nothing here to catch.
 *   4. No `restaurant_id` / `branch_id` is ever accepted from the client: the
 *      call id or order id is looked up and its branch is checked against the
 *      caller's session inside the service layer.
 *   5. `revalidatePath` runs only after a successful `Result`.
 */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { requireCapability } from '@/lib/auth/guards'
import { appError, err, type Result } from '@/lib/result'
import { advanceOrderStatus } from '@/lib/services/order-service'
import { acknowledgeCall, resolveCall } from '@/lib/services/waiter-service'
import { optionalNoteSchema, uuidSchema } from '@/lib/validation/common'
import type { OrderStatus } from '@/types/database'
import type { OrderView, WaiterCallView } from '@/types/domain'

function validationError<T>(issue: z.ZodError): Result<T> {
  return err(
    appError('VALIDATION_FAILED', 'invalid input to a waiter action', {
      wire: 'QR023_INVALID_PAYLOAD',
      details: { issues: issue.issues.map((i) => ({ path: i.path, message: i.message })) },
    }),
  )
}

/* ------------------------------------------------------------------ */
/* acknowledgeCallAction / resolveCallAction                           */
/* ------------------------------------------------------------------ */

const callIdSchema = z.strictObject({ waiter_call_id: uuidSchema })

export async function acknowledgeCallAction(input: unknown): Promise<Result<WaiterCallView>> {
  const parsed = callIdSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error)

  await requireCapability('waiter')

  const result = await acknowledgeCall(parsed.data.waiter_call_id)
  if (result.ok) revalidatePath('/waiter')
  return result
}

export async function resolveCallAction(input: unknown): Promise<Result<WaiterCallView>> {
  const parsed = callIdSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error)

  await requireCapability('waiter')

  const result = await resolveCall(parsed.data.waiter_call_id)
  if (result.ok) revalidatePath('/waiter')
  return result
}

/* ------------------------------------------------------------------ */
/* advanceOrderAction                                                  */
/* ------------------------------------------------------------------ */

/**
 * The waiter console's four one-tap order moves: taking a phone/manual order
 * (pending -> confirmed), serving a finished plate (ready -> delivered),
 * closing a served table (delivered -> completed), and withdrawing an order
 * that never should have gone in (* -> cancelled, reason required).
 *
 * This is a structural allow-list, not the security boundary: `assertTransition`
 * inside `order-service.updateOrderStatus` checks (from -> to) against the
 * caller's actual role, and `trg_orders_status_guard` checks it again in
 * Postgres. Restricting the set here only keeps a compromised client from
 * spending a round trip on a status this console has no button for.
 */
const ADVANCEABLE_STATUSES = ['confirmed', 'delivered', 'completed', 'cancelled'] as const

const advanceOrderSchema = z
  .strictObject({
    order_id: uuidSchema,
    next_status: z.enum(ADVANCEABLE_STATUSES),
    cancellation_reason: optionalNoteSchema(300),
  })
  .refine((payload) => payload.next_status !== 'cancelled' || payload.cancellation_reason !== null, {
    error: 'errors.app.VALIDATION_FAILED',
    path: ['cancellation_reason'],
  })

export async function advanceOrderAction(input: unknown): Promise<Result<OrderView>> {
  const parsed = advanceOrderSchema.safeParse(input)
  if (!parsed.success) return validationError(parsed.error)

  await requireCapability('waiter')

  const nextStatus: OrderStatus = parsed.data.next_status
  const result = await advanceOrderStatus(
    parsed.data.order_id,
    nextStatus,
    parsed.data.cancellation_reason,
  )

  if (result.ok) {
    // The waiter board is the primary surface; the other three also render
    // orders and must not go stale behind what realtime already pushed here.
    revalidatePath('/waiter')
    revalidatePath('/kitchen')
    revalidatePath('/admin/orders')
    revalidatePath('/admin')
  }

  return result
}
