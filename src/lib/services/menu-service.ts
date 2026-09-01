import 'server-only'

/**
 * Staff-side menu CRUD (brief §12).
 *
 * Every query runs through `createServerClient()`, so the caller's JWT is
 * attached and RLS decides which rows exist at all. The role checks in this file
 * are NOT the security boundary — the policies are. They exist so a waiter who
 * opens the menu editor gets a clear "you may not do this" instead of an empty
 * list and a silently failing save, which is a much worse bug to diagnose.
 *
 * `restaurant_id` is never accepted from a caller. It comes from the session, on
 * every insert, without exception (doc 03 §9.2.3).
 */
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { toMenuCategoryView, toMenuItemView, toMenuOptionGroups } from '@/lib/mappers/menu-mapper'
import { mapPgError } from '@/lib/security/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/services/session'
import type {
  CategoryInput,
  MenuItemAvailabilityInput,
  MenuItemInput,
  MenuItemOptionInput,
  ReorderInput,
} from '@/lib/validation/menu'
import type { MenuCategoryRow, MenuItemRow, StaffRole } from '@/types/database'
import type { MenuCategoryView, MenuItemView, StaffSession } from '@/types/domain'
import type { I18nText } from '@/types/i18n'

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** A category as the admin list shows it: the customer view plus the editable flags. */
export interface CategoryAdminView {
  view: MenuCategoryView
  branchId: string | null
  isActive: boolean
  updatedAt: string
}

/** A dish as the admin list shows it. */
export interface MenuItemAdminView {
  item: MenuItemView
  branchId: string | null
  categoryName: I18nText | null
  unavailableUntil: string | null
  availableFrom: string | null
  availableUntil: string | null
  popularityScore: number
  updatedAt: string
}

export interface MenuItemFilters {
  categoryId?: string | null
  /** Case-insensitive, matched against every locale of name and description. */
  search?: string | null
  availability?: 'all' | 'available' | 'unavailable'
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const MENU_MANAGER_ROLES: readonly StaffRole[] = ['RESTAURANT_OWNER', 'MANAGER']

async function requireSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (!session) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return session
}

function assertCanManageMenu(session: StaffSession): void {
  if (session.isPlatformAdmin) return
  if (!MENU_MANAGER_ROLES.includes(session.role)) {
    throw new AppErrorException(
      appError('FORBIDDEN', `${session.role} may not manage the menu`, {
        wire: 'QR050_FORBIDDEN',
        details: { role: session.role },
      }),
    )
  }
}

/**
 * A branch-scoped session may only name its own branch. Restaurant-wide content
 * (`branch_id = null`) is always in scope, because it belongs to every branch.
 */
function assertBranchScope(session: StaffSession, branchId: string | null): void {
  if (branchId === null) return
  if (session.isPlatformAdmin) return
  if (session.branchId !== null && session.branchId !== branchId) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'branch outside this session', {
        wire: 'QR050_FORBIDDEN',
        details: { branchId },
      }),
    )
  }
}

function notFound(entity: string): AppErrorException {
  return new AppErrorException(
    appError('NOT_FOUND', `${entity} not found`, {
      wire: 'QR030_NOT_FOUND',
      details: { entity },
    }),
  )
}

/** Every locale of an i18n_text, lowercased, for the in-memory search filter. */
function searchable(...values: (I18nText | null)[]): string {
  return values
    .flatMap((value) => (value ? Object.values(value) : []))
    .join(' ')
    .toLowerCase()
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/**
 * Categories for one branch, with live item counts.
 *
 * `branch_id IS NULL` means "every branch of this restaurant" (doc 01 §6.7), so
 * a branch list is the union of the branch's own categories and the shared ones
 * — not an equality filter, which would hide the entire shared menu.
 */
export async function listCategories(
  branchId: string | null,
): Promise<Result<CategoryAdminView[]>> {
  return toResult(async () => {
    const session = await requireSession()
    assertBranchScope(session, branchId)

    const supabase = await createServerClient()

    let categoryQuery = supabase
      .from('menu_categories')
      .select('*')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })

    if (branchId) categoryQuery = categoryQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`)

    const { data: categories, error } = await categoryQuery
    if (error) throw new AppErrorException(mapPgError(error))

    let itemQuery = supabase
      .from('menu_items')
      .select('id, category_id, is_available')
      .is('deleted_at', null)

    if (branchId) itemQuery = itemQuery.or(`branch_id.is.null,branch_id.eq.${branchId}`)

    const { data: items, error: itemError } = await itemQuery
    if (itemError) throw new AppErrorException(mapPgError(itemError))

    const counts = new Map<string, { total: number; available: number }>()
    for (const item of items ?? []) {
      const bucket = counts.get(item.category_id) ?? { total: 0, available: 0 }
      bucket.total += 1
      if (item.is_available) bucket.available += 1
      counts.set(item.category_id, bucket)
    }

    return (categories ?? []).map((row: MenuCategoryRow): CategoryAdminView => {
      const bucket = counts.get(row.id) ?? { total: 0, available: 0 }
      const view = toMenuCategoryView(row)
      return {
        view: { ...view, itemCount: bucket.total, availableItemCount: bucket.available },
        branchId: row.branch_id,
        isActive: row.is_active,
        updatedAt: row.updated_at,
      }
    })
  })
}

/** Dishes for one branch, filtered. Options are not fetched — the list does not render them. */
export async function listMenuItems(
  branchId: string | null,
  filters: MenuItemFilters = {},
): Promise<Result<MenuItemAdminView[]>> {
  return toResult(async () => {
    const session = await requireSession()
    assertBranchScope(session, branchId)

    const supabase = await createServerClient()

    let query = supabase
      .from('menu_items')
      .select('*')
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })

    if (branchId) query = query.or(`branch_id.is.null,branch_id.eq.${branchId}`)
    if (filters.categoryId) query = query.eq('category_id', filters.categoryId)
    if (filters.availability === 'available') query = query.eq('is_available', true)
    if (filters.availability === 'unavailable') query = query.eq('is_available', false)

    const { data, error } = await query
    if (error) throw new AppErrorException(mapPgError(error))

    const rows: MenuItemRow[] = data ?? []
    const categoryNames = await readCategoryNames(supabase)

    // Search runs in memory rather than as a PostgREST filter: the term must
    // match ANY locale of name or description, and expressing that as a
    // server-side `or()` over JSONB arrow operators is both fragile and, at
    // admin-list cardinality (tens to low hundreds of dishes), pointless.
    const needle = filters.search?.trim().toLowerCase() ?? ''

    return rows
      .filter(
        (row) => needle === '' || searchable(row.name, row.description).includes(needle),
      )
      .map((row): MenuItemAdminView => ({
        item: toMenuItemView(row),
        branchId: row.branch_id,
        categoryName: categoryNames.get(row.category_id) ?? null,
        unavailableUntil: row.unavailable_until,
        availableFrom: row.available_from,
        availableUntil: row.available_until,
        popularityScore: row.popularity_score,
        updatedAt: row.updated_at,
      }))
  })
}

/**
 * Category names, keyed by id.
 *
 * A separate round trip rather than a PostgREST embed: `src/types/database.ts`
 * declares `Relationships: []` for every table, so an embedded select does not
 * type-check — and rather than cast the result to a shape TypeScript has no
 * reason to believe, the join is done here, in memory, where it is visible.
 */
async function readCategoryNames(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
): Promise<Map<string, I18nText>> {
  const { data, error } = await supabase.from('menu_categories').select('id, name')
  if (error) throw new AppErrorException(mapPgError(error))
  return new Map((data ?? []).map((row) => [row.id, row.name]))
}

/** One dish with its option rows, for the edit form and the customer detail sheet. */
export async function getMenuItem(id: string): Promise<Result<MenuItemAdminView>> {
  return toResult(async () => {
    await requireSession()
    const supabase = await createServerClient()

    const { data: row, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!row) throw notFound('menu_item')

    const { data: optionRows, error: optionError } = await supabase
      .from('menu_item_options')
      .select('*')
      .eq('menu_item_id', id)
      .is('deleted_at', null)

    if (optionError) throw new AppErrorException(mapPgError(optionError))

    const { data: category, error: categoryError } = await supabase
      .from('menu_categories')
      .select('name')
      .eq('id', row.category_id)
      .maybeSingle()

    if (categoryError) throw new AppErrorException(mapPgError(categoryError))

    return {
      item: toMenuItemView(row, { optionRows: optionRows ?? [] }),
      branchId: row.branch_id,
      categoryName: category?.name ?? null,
      unavailableUntil: row.unavailable_until,
      availableFrom: row.available_from,
      availableUntil: row.available_until,
      popularityScore: row.popularity_score,
      updatedAt: row.updated_at,
    }
  })
}

/** The option groups of one dish, for the options editor. */
export async function listMenuItemOptions(menuItemId: string) {
  return toResult(async () => {
    await requireSession()
    const supabase = await createServerClient()

    const { data, error } = await supabase
      .from('menu_item_options')
      .select('*')
      .eq('menu_item_id', menuItemId)
      .is('deleted_at', null)

    if (error) throw new AppErrorException(mapPgError(error))
    return toMenuOptionGroups(data ?? [])
  })
}

/* ------------------------------------------------------------------ */
/* Category writes                                                     */
/* ------------------------------------------------------------------ */

export async function createCategory(input: CategoryInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .insert({
        restaurant_id: session.restaurantId,
        branch_id: input.branch_id,
        name: input.name,
        description: input.description,
        image_url: input.image_url,
        image_path: input.image_path,
        icon: input.icon,
        sort_order: input.sort_order,
        is_active: input.is_active,
      })
      .select('id')
      .single()

    if (error) throw new AppErrorException(mapPgError(error))
    return { id: data.id }
  })
}

export async function updateCategory(
  input: CategoryInput & { id: string },
): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('menu_categories')
      .update({
        branch_id: input.branch_id,
        name: input.name,
        description: input.description,
        image_url: input.image_url,
        image_path: input.image_path,
        icon: input.icon,
        sort_order: input.sort_order,
        is_active: input.is_active,
      })
      .eq('id', input.id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('menu_category')
    return { id: data.id }
  })
}

export async function setCategoryActive(
  id: string,
  isActive: boolean,
): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)

    const supabase = await createServerClient()
    const { error } = await supabase
      .from('menu_categories')
      .update({ is_active: isActive })
      .eq('id', id)

    if (error) throw new AppErrorException(mapPgError(error))
    return null
  })
}

/**
 * Soft delete. The FK from `menu_items` is RESTRICT, so a category that still
 * holds live dishes is refused here with a message the form can render, rather
 * than left to surface as a foreign-key violation the operator cannot read.
 */
export async function deleteCategory(id: string): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)

    const supabase = await createServerClient()

    const { count, error: countError } = await supabase
      .from('menu_items')
      .select('id', { count: 'exact', head: true })
      .eq('category_id', id)
      .is('deleted_at', null)

    if (countError) throw new AppErrorException(mapPgError(countError))
    if ((count ?? 0) > 0) {
      throw new AppErrorException(
        appError('VALIDATION_FAILED', 'category still holds menu items', {
          wire: 'QR023_INVALID_PAYLOAD',
          details: { entity: 'menu_category', itemCount: count ?? 0 },
        }),
      )
    }

    const { error } = await supabase
      .from('menu_categories')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)

    if (error) throw new AppErrorException(mapPgError(error))
    return null
  })
}

/* ------------------------------------------------------------------ */
/* Item writes                                                         */
/* ------------------------------------------------------------------ */

/** The columns an option carries, minus the three the row type freezes on update. */
function optionColumns(option: MenuItemOptionInput) {
  return {
    group_key: option.group_key,
    group_label: option.group_label,
    selection_type: option.selection_type,
    group_min_select: option.group_min_select,
    group_max_select: option.group_max_select,
    group_sort_order: option.group_sort_order,
    name: option.name,
    price_delta: option.price_delta,
    max_quantity: option.max_quantity,
    is_default: option.is_default,
    is_available: option.is_available,
    sort_order: option.sort_order,
  }
}

function optionInsert(
  restaurantId: string,
  menuItemId: string,
  option: MenuItemOptionInput,
) {
  return {
    restaurant_id: restaurantId,
    menu_item_id: menuItemId,
    ...optionColumns(option),
  }
}

export async function createMenuItem(input: MenuItemInput): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('menu_items')
      .insert({
        restaurant_id: session.restaurantId,
        branch_id: input.branch_id,
        category_id: input.category_id,
        name: input.name,
        description: input.description,
        ingredients: input.ingredients,
        price: input.price,
        compare_at_price: input.compare_at_price,
        image_url: input.image_url,
        image_path: input.image_path,
        spicy_level: input.spicy_level,
        preparation_time: input.preparation_time,
        calories: input.calories,
        dietary_tags: input.dietary_tags,
        is_available: input.is_available,
        unavailable_until: input.unavailable_until,
        available_from: input.available_from,
        available_until: input.available_until,
        is_featured: input.is_featured,
        is_popular: input.is_popular,
        sort_order: input.sort_order,
      })
      .select('id')
      .single()

    if (error) throw new AppErrorException(mapPgError(error))

    if (input.options.length > 0) {
      const { error: optionError } = await supabase
        .from('menu_item_options')
        .insert(input.options.map((option) => optionInsert(session.restaurantId, data.id, option)))
      if (optionError) throw new AppErrorException(mapPgError(optionError))
    }

    return { id: data.id }
  })
}

/**
 * Update a dish and reconcile its options.
 *
 * Options that disappeared from the payload are soft-deleted rather than
 * removed: `order_item_options.menu_item_option_id` points at them, and an
 * historical order must keep resolving what the guest actually chose.
 */
export async function updateMenuItem(
  input: MenuItemInput & { id: string },
): Promise<Result<{ id: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('menu_items')
      .update({
        branch_id: input.branch_id,
        category_id: input.category_id,
        name: input.name,
        description: input.description,
        ingredients: input.ingredients,
        price: input.price,
        compare_at_price: input.compare_at_price,
        image_url: input.image_url,
        image_path: input.image_path,
        spicy_level: input.spicy_level,
        preparation_time: input.preparation_time,
        calories: input.calories,
        dietary_tags: input.dietary_tags,
        is_available: input.is_available,
        unavailable_until: input.unavailable_until,
        available_from: input.available_from,
        available_until: input.available_until,
        is_featured: input.is_featured,
        is_popular: input.is_popular,
        sort_order: input.sort_order,
      })
      .eq('id', input.id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound('menu_item')

    const { data: existing, error: readError } = await supabase
      .from('menu_item_options')
      .select('id')
      .eq('menu_item_id', input.id)
      .is('deleted_at', null)

    if (readError) throw new AppErrorException(mapPgError(readError))

    const keep = new Set(input.options.map((option) => option.id).filter((id): id is string => !!id))
    const drop = (existing ?? []).map((row) => row.id).filter((id) => !keep.has(id))

    if (drop.length > 0) {
      const { error: dropError } = await supabase
        .from('menu_item_options')
        .update({ deleted_at: new Date().toISOString(), is_available: false })
        .in('id', drop)
      if (dropError) throw new AppErrorException(mapPgError(dropError))
    }

    for (const option of input.options) {
      if (option.id) {
        const { error: updateError } = await supabase
          .from('menu_item_options')
          .update(optionColumns(option))
          .eq('id', option.id)
        if (updateError) throw new AppErrorException(mapPgError(updateError))
      } else {
        const { error: insertError } = await supabase
          .from('menu_item_options')
          .insert(optionInsert(session.restaurantId, input.id, option))
        if (insertError) throw new AppErrorException(mapPgError(insertError))
      }
    }

    return { id: data.id }
  })
}

/**
 * The one-tap AVAILABLE -> UNAVAILABLE toggle (brief §12). Kept separate from
 * `updateMenuItem` because the kitchen uses it mid-service and must not have to
 * round-trip the whole dish to say "we are out of plov".
 */
export async function setItemAvailability(
  input: MenuItemAvailabilityInput,
): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    if (!session.isPlatformAdmin && session.role === 'WAITER') {
      throw new AppErrorException(
        appError('FORBIDDEN', 'a waiter may not change availability', {
          wire: 'QR050_FORBIDDEN',
        }),
      )
    }

    const supabase = await createServerClient()
    const { error } = await supabase
      .from('menu_items')
      .update({
        is_available: input.is_available,
        unavailable_until: input.unavailable_until,
      })
      .eq('id', input.menu_item_id)

    if (error) throw new AppErrorException(mapPgError(error))
    return null
  })
}

/** Soft delete, so historical orders keep resolving their `menu_item_id`. */
export async function deleteMenuItem(id: string): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)

    const supabase = await createServerClient()
    const { error } = await supabase
      .from('menu_items')
      .update({ deleted_at: new Date().toISOString(), is_available: false })
      .eq('id', id)

    if (error) throw new AppErrorException(mapPgError(error))
    return null
  })
}

/**
 * Drag-and-drop reordering.
 *
 * One statement per row: PostgREST has no multi-row UPDATE with per-row values,
 * and the alternative — an upsert carrying every column — would let a stale
 * client overwrite a price while dragging a card. A `sort_order` write is the
 * only thing this function is allowed to do.
 */
export async function reorder(input: ReorderInput): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageMenu(session)

    const supabase = await createServerClient()

    for (const entry of input.items) {
      const patch = { sort_order: entry.sort_order }
      const { error } =
        input.entity === 'menu_category'
          ? await supabase.from('menu_categories').update(patch).eq('id', entry.id)
          : input.entity === 'menu_item'
            ? await supabase.from('menu_items').update(patch).eq('id', entry.id)
            : await supabase.from('menu_item_options').update(patch).eq('id', entry.id)

      if (error) throw new AppErrorException(mapPgError(error))
    }

    return null
  })
}
