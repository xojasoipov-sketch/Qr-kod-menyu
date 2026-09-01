'use server'

/**
 * Server actions for the branches editor (`/admin/branches`).
 *
 * `branch-service.ts` re-derives the caller's session and refuses a create
 * to anyone but an owner, and an edit to anyone outside the branch's own
 * scope — this file only translates a malformed payload into `Result`
 * before it reaches that layer.
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { err, appError, type Result } from '@/lib/result'
import {
  createBranch,
  setAcceptingOrders,
  setBranchActive,
  updateBranch,
} from '@/lib/services/branch-service'
import { branchSchema } from '@/lib/validation/tenancy'
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

const setBoolInputSchema = z.strictObject({ id: uuidSchema, value: z.boolean() })

function revalidateBranches(): void {
  revalidatePath('/admin/branches')
  revalidatePath('/admin', 'layout')
}

export async function createBranchAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = branchSchema.safeParse(input)
  if (!parsed.success) return validationFailure('createBranchAction', parsed.error.issues)

  const result = await createBranch(parsed.data)
  if (result.ok) revalidateBranches()
  return result
}

export async function updateBranchAction(input: unknown): Promise<Result<null>> {
  const parsed = branchSchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateBranchAction', parsed.error.issues)
  if (parsed.data.id === undefined) return missingId('updateBranchAction')

  const result = await updateBranch({ ...parsed.data, id: parsed.data.id })
  if (result.ok) revalidateBranches()
  return result
}

export async function setBranchAcceptingOrdersAction(input: unknown): Promise<Result<null>> {
  const parsed = setBoolInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('setBranchAcceptingOrdersAction', parsed.error.issues)

  const result = await setAcceptingOrders(parsed.data.id, parsed.data.value)
  if (result.ok) revalidateBranches()
  return result
}

export async function setBranchActiveAction(input: unknown): Promise<Result<null>> {
  const parsed = setBoolInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('setBranchActiveAction', parsed.error.issues)

  const result = await setBranchActive(parsed.data.id, parsed.data.value)
  if (result.ok) revalidateBranches()
  return result
}
