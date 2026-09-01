'use server'

/**
 * Server actions for the menu and category editors (`/admin/menu`,
 * `/admin/categories`).
 *
 * Every action starts with a zod parse of `input: unknown` and ends by
 * revalidating the routes a change is visible on. Authorization is not
 * duplicated here: `menu-service.ts` re-derives the caller's session from the
 * cookie client on every call and refuses a disallowed write with a typed
 * `FORBIDDEN` — this file only translates a malformed payload into the same
 * `Result` shape before it ever reaches the service.
 */

import { revalidatePath } from 'next/cache'

import { err, appError, type Result } from '@/lib/result'
import {
  createCategory,
  createMenuItem,
  deleteCategory,
  deleteMenuItem,
  reorder,
  setCategoryActive,
  setItemAvailability,
  updateCategory,
  updateMenuItem,
} from '@/lib/services/menu-service'
import {
  categorySchema,
  menuItemAvailabilitySchema,
  menuItemSchema,
  reorderSchema,
} from '@/lib/validation/menu'
import { uuidSchema } from '@/lib/validation/common'
import { z } from 'zod'

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

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function revalidateMenu(): void {
  revalidatePath('/admin/menu')
  revalidatePath('/admin/categories')
}

export async function createCategoryAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = categorySchema.safeParse(input)
  if (!parsed.success) return validationFailure('createCategoryAction', parsed.error.issues)

  const result = await createCategory(parsed.data)
  if (result.ok) revalidateMenu()
  return result
}

export async function updateCategoryAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = categorySchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateCategoryAction', parsed.error.issues)
  if (parsed.data.id === undefined) return missingId('updateCategoryAction')

  const result = await updateCategory({ ...parsed.data, id: parsed.data.id })
  if (result.ok) revalidateMenu()
  return result
}

export async function deleteCategoryAction(input: unknown): Promise<Result<null>> {
  const parsed = idInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('deleteCategoryAction', parsed.error.issues)

  const result = await deleteCategory(parsed.data.id)
  if (result.ok) revalidateMenu()
  return result
}

export async function setCategoryActiveAction(input: unknown): Promise<Result<null>> {
  const parsed = setActiveInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('setCategoryActiveAction', parsed.error.issues)

  const result = await setCategoryActive(parsed.data.id, parsed.data.is_active)
  if (result.ok) revalidateMenu()
  return result
}

export async function reorderCategoriesAction(input: unknown): Promise<Result<null>> {
  const parsed = reorderSchema.safeParse(input)
  if (!parsed.success) return validationFailure('reorderCategoriesAction', parsed.error.issues)

  const result = await reorder(parsed.data)
  if (result.ok) revalidateMenu()
  return result
}

/* ------------------------------------------------------------------ */
/* Menu items                                                          */
/* ------------------------------------------------------------------ */

export async function createMenuItemAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = menuItemSchema.safeParse(input)
  if (!parsed.success) return validationFailure('createMenuItemAction', parsed.error.issues)

  const result = await createMenuItem(parsed.data)
  if (result.ok) revalidateMenu()
  return result
}

export async function updateMenuItemAction(input: unknown): Promise<Result<{ id: string }>> {
  const parsed = menuItemSchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateMenuItemAction', parsed.error.issues)
  if (parsed.data.id === undefined) return missingId('updateMenuItemAction')

  const result = await updateMenuItem({ ...parsed.data, id: parsed.data.id })
  if (result.ok) revalidateMenu()
  return result
}

export async function deleteMenuItemAction(input: unknown): Promise<Result<null>> {
  const parsed = idInputSchema.safeParse(input)
  if (!parsed.success) return validationFailure('deleteMenuItemAction', parsed.error.issues)

  const result = await deleteMenuItem(parsed.data.id)
  if (result.ok) revalidateMenu()
  return result
}

/** The one-tap AVAILABLE / UNAVAILABLE toggle brief §12 requires. */
export async function setItemAvailabilityAction(input: unknown): Promise<Result<null>> {
  const parsed = menuItemAvailabilitySchema.safeParse(input)
  if (!parsed.success) return validationFailure('setItemAvailabilityAction', parsed.error.issues)

  const result = await setItemAvailability(parsed.data)
  if (result.ok) revalidateMenu()
  return result
}

export async function reorderMenuItemsAction(input: unknown): Promise<Result<null>> {
  const parsed = reorderSchema.safeParse(input)
  if (!parsed.success) return validationFailure('reorderMenuItemsAction', parsed.error.issues)

  const result = await reorder(parsed.data)
  if (result.ok) revalidateMenu()
  return result
}
