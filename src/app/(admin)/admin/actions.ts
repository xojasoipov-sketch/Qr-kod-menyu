'use server'

/**
 * Server actions for the admin shell, the orders list and the order detail
 * screen.
 *
 * Every action re-derives the caller's context from the cookie-bound session
 * (`getStaffContext()`) rather than trusting anything the client sent about
 * who it is or what it may do — mirrors `(staff)/kitchen/actions.ts`'s
 * convention exactly, including the mirror `assertTransition()` check before
 * the network round trip and the compare-and-swap that `order-service.ts`
 * performs regardless.
 */

import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { hasCapability } from '@/lib/auth/guards'
import { BRANCH_COOKIE, canAccessBranch, getStaffContext } from '@/lib/auth/session'
import { assertTransition, type ActorRole } from '@/lib/orders/state-machine'
import { advanceOrderStatus, cancelOrder as cancelOrderService } from '@/lib/services/order-service'
import { AppErrorException, appError, err, type Result } from '@/lib/result'
import { createServerClient } from '@/lib/supabase/server'
import { noteSchema, orderStatusSchema, uuidSchema } from '@/lib/validation/common'
import type { OrderView } from '@/types/domain'

function validationFailure(source: string, issues: unknown): Result<never> {
  return err(
    appError('VALIDATION_FAILED', `${source} received a payload it does not understand`, {
      httpStatus: 422,
      details: { issues },
    }),
  )
}

function forbidden(): Result<never> {
  return err(appError('FORBIDDEN', 'no admin access', { wire: 'QR050_FORBIDDEN' }))
}

/** Mirrors order-service.ts's actorOf(): the session decides, never the client. */
async function requireAdminActor(): Promise<{
  actor: ActorRole
  branchIds: readonly string[]
} | null> {
  const context = await getStaffContext()
  if (!context || !hasCapability(context, 'admin')) return null
  return {
    actor: context.isPlatformAdmin ? 'SUPER_ADMIN' : context.role,
    branchIds: context.branchIds,
  }
}

function revalidateOrderSurfaces(): void {
  revalidatePath('/admin', 'layout')
  revalidatePath('/kitchen')
  revalidatePath('/waiter')
}

/* ------------------------------------------------------------------ */
/* Branch switching                                                    */
/* ------------------------------------------------------------------ */

/**
 * Writes `qros_branch` for the calling staff member. Not HttpOnly — it carries
 * no authority (doc `session.ts`'s own note on `BRANCH_COOKIE`); every service
 * call still re-derives and re-checks scope from RLS and `StaffContext`, so a
 * tampered cookie only ever asks to look at a branch this profile cannot see,
 * which `canAccessBranch` refuses right here before it is even written.
 */
export async function setActiveBranchAction(branchId: string): Promise<Result<null>> {
  const parsed = uuidSchema.safeParse(branchId)
  if (!parsed.success) return validationFailure('setActiveBranchAction', parsed.error.issues)

  const context = await getStaffContext()
  if (!context) return forbidden()
  if (!canAccessBranch(context, parsed.data)) return forbidden()

  const cookieStore = await cookies()
  cookieStore.set(BRANCH_COOKIE, parsed.data, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    sameSite: 'lax',
  })

  revalidatePath('/admin', 'layout')
  return { ok: true, data: null }
}

/* ------------------------------------------------------------------ */
/* Sign out                                                            */
/* ------------------------------------------------------------------ */

/** Bound directly to `<form action={signOutAction}>` in `<AdminTopbar>` — no client JS. */
export async function signOutAction(): Promise<void> {
  const supabase = await createServerClient()
  await supabase.auth.signOut()
  redirect('/login')
}

/* ------------------------------------------------------------------ */
/* Order status                                                        */
/* ------------------------------------------------------------------ */

const advanceInputSchema = z.strictObject({
  order_id: uuidSchema,
  expected_status: orderStatusSchema,
  next_status: orderStatusSchema,
})

/**
 * One tap on an order's status control. `assertTransition` mirrors the same
 * check `order-service.ts#updateOrderStatus` performs, so an illegal move is
 * refused with a precise localised error before the round trip is spent —
 * the actual authority is still that compare-and-swap.
 */
export async function updateOrderStatusAction(input: unknown): Promise<Result<OrderView>> {
  const parsed = advanceInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateOrderStatusAction', parsed.error.issues)

  const admin = await requireAdminActor()
  if (!admin) return forbidden()

  const { order_id, expected_status, next_status } = parsed.data

  try {
    assertTransition(expected_status, next_status, admin.actor)
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return err(thrown.error)
    throw thrown
  }

  const result = await advanceOrderStatus(order_id, next_status, null)
  if (result.ok) revalidateOrderSurfaces()
  return result
}

const cancelInputSchema = z.strictObject({
  order_id: uuidSchema,
  expected_status: orderStatusSchema,
  reason: noteSchema(400),
})

/** Staff cancellation, gated exactly as `updateOrderStatusAction` above. */
export async function cancelOrderAction(input: unknown): Promise<Result<OrderView>> {
  const parsed = cancelInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('cancelOrderAction', parsed.error.issues)

  const admin = await requireAdminActor()
  if (!admin) return forbidden()

  const { order_id, expected_status, reason } = parsed.data

  try {
    assertTransition(expected_status, 'cancelled', admin.actor)
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return err(thrown.error)
    throw thrown
  }

  const result = await cancelOrderService(order_id, reason)
  if (result.ok) revalidateOrderSurfaces()
  return result
}
