'use server'

/**
 * Server actions for the kitchen display.
 *
 * Both actions re-derive the caller's context from the cookie-bound session
 * (`getStaffContext()`) rather than trusting anything the client sent about
 * who it is — the `order_id`/`expected_status`/`next_status` triple is the
 * only untrusted input. `advanceOrderAction` mirrors the assignment brief
 * exactly: `assertTransition()` runs FIRST, against the client's believed
 * current status, so an illegal tap is refused with a precise, localised
 * error before a network round trip is spent on it; the actual authority is
 * still `order-service.ts`'s `advanceOrderStatus()`, whose compare-and-swap
 * re-reads the real current status and refuses a STALE transition even when
 * this pre-check passed (doc 06 §3.4 — two cooks on two tablets cannot both
 * win the same ticket).
 *
 * `refreshKitchenTicketsAction` is the resync primitive `<KdsBoard>` calls
 * after every realtime event and on every reconnect (doc 06 §5) — a thin,
 * capability-checked wrapper around `listKitchenTickets`, kept here rather
 * than exposing the service directly to a client component.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { hasCapability } from '@/lib/auth/guards'
import { getStaffContext } from '@/lib/auth/session'
import { assertTransition, type ActorRole } from '@/lib/orders/state-machine'
import { advanceOrderStatus, listKitchenTickets } from '@/lib/services/order-service'
import { AppErrorException, appError, err, type Result } from '@/lib/result'
import { optionalNoteSchema, orderStatusSchema, uuidSchema } from '@/lib/validation/common'
import type { KitchenTicket, OrderView } from '@/types/domain'

const advanceInputSchema = z.strictObject({
  order_id: uuidSchema,
  expected_status: orderStatusSchema,
  next_status: orderStatusSchema,
  cancellation_reason: optionalNoteSchema(300),
})

/** Every action rejects a malformed payload the same way. */
function validationFailure(source: string, issues: unknown): Result<never> {
  return err(
    appError('VALIDATION_FAILED', `${source} received a payload it does not understand`, {
      httpStatus: 422,
      details: { issues },
    }),
  )
}

function forbidden(): Result<never> {
  return err(appError('FORBIDDEN', 'no kitchen access', { wire: 'QR050_FORBIDDEN' }))
}

/** `session.isPlatformAdmin ? 'SUPER_ADMIN' : session.role` — mirrors order-service.ts's actorOf(). */
async function requireKitchenActor(): Promise<ActorRole | null> {
  const context = await getStaffContext()
  if (!context || !hasCapability(context, 'kitchen')) return null
  return context.isPlatformAdmin ? 'SUPER_ADMIN' : context.role
}

/**
 * One tap on a KDS ticket. `assertTransition` throws `INVALID_TRANSITION` for
 * a structurally illegal edge and `FORBIDDEN` for a legal edge this actor may
 * not use — both convert to a `Result` here rather than escaping past the
 * action boundary.
 */
export async function advanceOrderAction(input: unknown): Promise<Result<OrderView>> {
  const parsed = advanceInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('advanceOrderAction', parsed.error.issues)

  const actor = await requireKitchenActor()
  if (!actor) return forbidden()

  const { order_id, expected_status, next_status, cancellation_reason } = parsed.data

  try {
    assertTransition(expected_status, next_status, actor)
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return err(thrown.error)
    throw thrown
  }

  if (next_status === 'cancelled' && (cancellation_reason ?? '').trim().length === 0) {
    return err(
      appError('VALIDATION_FAILED', 'a cancellation reason is required', {
        wire: 'QR042_CANCEL_REASON_REQUIRED',
        httpStatus: 422,
      }),
    )
  }

  const result = await advanceOrderStatus(order_id, next_status, cancellation_reason)

  if (result.ok) {
    revalidatePath('/kitchen')
    revalidatePath('/waiter')
    revalidatePath('/admin/orders')
    revalidatePath('/admin')
  }

  return result
}

/** The full-board resync `<KdsBoard>` calls on join, on reconnect, and after every event. */
export async function refreshKitchenTicketsAction(): Promise<Result<KitchenTicket[]>> {
  const context = await getStaffContext()
  if (!context || !hasCapability(context, 'kitchen')) return forbidden()

  const branchId = context.activeBranchId
  if (!branchId) {
    return err(appError('NOT_FOUND', 'no branch in scope', { httpStatus: 404 }))
  }

  return listKitchenTickets(branchId)
}
