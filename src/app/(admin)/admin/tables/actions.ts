'use server'

/**
 * Server actions for the tables editor (`/admin/tables`).
 *
 * `rotateTableTokenAction` is the only place a QR token ever changes — it
 * goes through `admin_rotate_table_token` (table-service.ts), which the
 * database itself now enforces as the sole writer of `tables.qr_token`.
 * `getTableQrAction` is the read side of the same capability: the token and
 * its rendered PNG are fetched together, on demand, when an operator opens
 * the QR preview — never as part of the list, which deliberately never
 * carries the token (table-service.ts, "a token is a bearer capability").
 */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'

import { err, appError, type Result } from '@/lib/result'
import {
  createTable,
  deleteTable,
  getTable,
  qrPngDataUrl,
  rotateToken,
  setTableActive,
  updateTable,
  type TableDetailView,
} from '@/lib/services/table-service'
import { rotateTableTokenSchema, tableSchema } from '@/lib/validation/tenancy'
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
const setActiveInputSchema = z.strictObject({ id: uuidSchema, is_active: z.boolean() })

function revalidateTables(): void {
  revalidatePath('/admin/tables')
}

export async function createTableAction(
  input: unknown,
): Promise<Result<{ id: string; qrToken: string }>> {
  const parsed = tableSchema.safeParse(input)
  if (!parsed.success) return validationFailure('createTableAction', parsed.error.issues)

  const result = await createTable(parsed.data)
  if (result.ok) revalidateTables()
  return result
}

export async function updateTableAction(input: unknown): Promise<Result<null>> {
  const parsed = tableSchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateTableAction', parsed.error.issues)
  if (parsed.data.id === undefined) return missingId('updateTableAction')

  const result = await updateTable({ ...parsed.data, id: parsed.data.id })
  if (result.ok) revalidateTables()
  return result
}

export async function setTableActiveAction(input: unknown): Promise<Result<null>> {
  const parsed = setActiveInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('setTableActiveAction', parsed.error.issues)

  const result = await setTableActive(parsed.data.id, parsed.data.is_active)
  if (result.ok) revalidateTables()
  return result
}

export async function deleteTableAction(input: unknown): Promise<Result<null>> {
  const parsed = idInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('deleteTableAction', parsed.error.issues)

  const result = await deleteTable(parsed.data.id)
  if (result.ok) revalidateTables()
  return result
}

export async function rotateTableTokenAction(
  input: unknown,
): Promise<Result<{ qrToken: string; rotationCount: number }>> {
  const parsed = rotateTableTokenSchema.safeParse(input)
  if (!parsed.success) return validationFailure('rotateTableTokenAction', parsed.error.issues)

  const result = await rotateToken(parsed.data)
  if (!result.ok) return result
  revalidateTables()
  return { ok: true, data: { qrToken: result.data.qrToken, rotationCount: result.data.rotationCount } }
}

/** The QR preview dialog's data: the live token, its target URL and a rendered PNG. */
export async function getTableQrAction(
  input: unknown,
): Promise<Result<Pick<TableDetailView, 'qrToken' | 'qrUrl' | 'number'> & { pngDataUrl: string }>> {
  const parsed = idInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('getTableQrAction', parsed.error.issues)

  const tableResult = await getTable(parsed.data.id)
  if (!tableResult.ok) return tableResult

  const pngResult = await qrPngDataUrl(tableResult.data.qrToken, { size: 512, margin: 2 })
  if (!pngResult.ok) return pngResult

  return {
    ok: true,
    data: {
      qrToken: tableResult.data.qrToken,
      qrUrl: tableResult.data.qrUrl,
      number: tableResult.data.number,
      pngDataUrl: pngResult.data,
    },
  }
}
