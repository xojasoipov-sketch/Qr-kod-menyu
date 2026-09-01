'use server'

/**
 * Server actions for the staff roster (`/admin/staff`, brief §16).
 *
 * `staff-service.ts` re-derives the caller's session and role on every
 * call, so the escalation guard (`QR055` — only an owner mints an owner),
 * the self-modification guard (`QR056`) and the branch-scope check all run
 * there, not here. This file's job is the zod parse and the revalidation.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { err, appError, type Result } from '@/lib/result'
import { deactivateStaff, inviteStaff, updateStaff } from '@/lib/services/staff-service'
import { staffSchema } from '@/lib/validation/tenancy'
import { uuidSchema } from '@/lib/validation/common'

function validationFailure(source: string, issues: unknown): Result<never> {
  return err(
    appError('VALIDATION_FAILED', `${source} received a payload it does not understand`, {
      httpStatus: 422,
      details: { issues },
    }),
  )
}

function missingId(source: string): Result<never> {
  return err(
    appError('VALIDATION_FAILED', `${source} requires an id to update`, {
      httpStatus: 422,
      details: { field: 'id' },
    }),
  )
}

const idInputSchema = z.strictObject({ id: uuidSchema })

function revalidateStaff(): void {
  revalidatePath('/admin/staff')
}

export async function inviteStaffAction(input: unknown): Promise<Result<{ staffId: string }>> {
  const parsed = staffSchema.safeParse(input)
  if (!parsed.success) return validationFailure('inviteStaffAction', parsed.error.issues)

  const result = await inviteStaff(parsed.data)
  if (result.ok) revalidateStaff()
  return result
}

export async function updateStaffAction(input: unknown): Promise<Result<null>> {
  const parsed = staffSchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateStaffAction', parsed.error.issues)
  if (parsed.data.id === undefined) return missingId('updateStaffAction')

  const result = await updateStaff({ ...parsed.data, id: parsed.data.id })
  if (result.ok) revalidateStaff()
  return result
}

export async function deactivateStaffAction(input: unknown): Promise<Result<null>> {
  const parsed = idInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('deactivateStaffAction', parsed.error.issues)

  const result = await deactivateStaff(parsed.data.id)
  if (result.ok) revalidateStaff()
  return result
}
