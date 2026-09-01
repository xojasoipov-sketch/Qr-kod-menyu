/**
 * Wire and row shapes -> menu view models.
 *
 * Two sources feed the same view models, and that is deliberate:
 *
 *   - `public_get_menu` JSONB, parsed by `PublicMenuSchema` — what a diner sees.
 *   - `menu_items` / `menu_item_options` rows read by the staff services under RLS —
 *     what a manager edits.
 *
 * Both funnel through the SAME functions so the admin preview of a dish and the
 * customer card can never disagree about spice level, availability or price.
 * Demo mode reuses this file untouched (its fixture is shaped as the wire payload),
 * which is what makes the demo an exercise of the real mapping code rather than a
 * parallel implementation of it.
 *
 * Nothing here formats. Money leaves as `Money` (integer minor units) and text
 * leaves as `I18nText`; picking a locale and rendering a currency are render
 * concerns that belong to the component.
 */
import { assertMoney, type Money } from '@/lib/money'
import type {
  PublicMenu,
  PublicMenuCategory,
  PublicMenuItem,
  PublicMenuOption,
  PublicOptionGroup,
  PublicPromotion,
  PublicTableContext,
} from '@/lib/rpc/schemas'
import { DIETARY_TAGS } from '@/types/database'
import type {
  DietaryTag,
  MenuCategoryRow,
  MenuItemOptionRow,
  MenuItemRow,
  PromotionRow,
} from '@/types/database'
import type {
  MenuCategoryView,
  MenuItemView,
  MenuOptionGroupView,
  MenuOptionView,
  MenuTree,
  PromotionView,
  TableContext,
} from '@/types/domain'

/* ------------------------------------------------------------------ */
/* Small shared guards                                                 */
/* ------------------------------------------------------------------ */

/**
 * A trust boundary, not a formality. PostgREST hands BIGINT back as a JSON
 * number; a value that is not an exact non-negative integer means the column,
 * the payload or the transport is wrong, and rendering it would put a wrong
 * price in front of a paying guest. Throwing here surfaces inside the service's
 * `toResult()` as one typed failure instead of a plausible-looking receipt.
 */
function money(value: number, label: string): Money {
  assertMoney(value, label)
  return value
}

const KNOWN_DIETARY_TAGS: ReadonlySet<string> = new Set<string>(DIETARY_TAGS)

/**
 * The wire types `dietary_tags` as `string[]` because the payload is built by
 * `jsonb_build_object`. Unknown labels are dropped rather than rendered: a badge
 * reading `contains_unobtanium` is worse than no badge, and a future enum value
 * must not crash an old client.
 */
function dietaryTags(tags: readonly string[]): DietaryTag[] {
  return tags.filter((tag): tag is DietaryTag => KNOWN_DIETARY_TAGS.has(tag))
}

/** Minutes. The wire allows null (the branch default applies); the view does not. */
const FALLBACK_PREP_MINUTES = 15

/* ------------------------------------------------------------------ */
/* Table context                                                       */
/* ------------------------------------------------------------------ */

/**
 * The one identifier a customer ever holds is the token. No restaurant id, no
 * branch id, no table id crosses this function — brief §3 ("public URL must NOT
 * expose internal DB ids") is enforced by the shape of `TableContext` itself,
 * and this mapper is where that shape is produced.
 */
export function toTableContext(payload: PublicTableContext): TableContext {
  return {
    token: payload.token,
    restaurant: {
      name: payload.restaurant.name,
      slug: payload.restaurant.slug,
      logoUrl: payload.restaurant.logo_url,
      welcomeMessage: payload.restaurant.welcome_message,
      currency: payload.restaurant.currency,
      currencyDecimals: payload.restaurant.currency_decimals,
      defaultLocale: payload.restaurant.default_locale,
    },
    branch: {
      name: payload.branch.name,
      timezone: payload.branch.timezone,
      serviceFeeEnabled: payload.branch.service_fee_enabled,
      serviceFeeBps: payload.branch.service_fee_enabled ? payload.branch.service_fee_bps : 0,
      isAcceptingOrders: payload.branch.is_accepting_orders,
    },
    table: {
      number: payload.table.number ?? '',
      name: payload.table.name,
    },
    resolvedAt: payload.resolved_at,
  }
}

/** Doc 03 names this function; kept as an alias so both spellings resolve. */
export const mapPublicTableContext = toTableContext

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

function toMenuOptionView(option: PublicMenuOption): MenuOptionView {
  return {
    id: option.id,
    name: option.name,
    priceDelta: money(option.price_delta, 'option price delta'),
    maxQuantity: option.max_quantity,
    isDefault: option.is_default,
    isAvailable: option.is_available,
    sortOrder: option.sort_order,
  }
}

function toOptionGroupView(group: PublicOptionGroup): MenuOptionGroupView {
  return {
    groupKey: group.group_key,
    groupLabel: group.group_label,
    selectionType: group.selection_type,
    minSelect: group.min_select,
    maxSelect: group.max_select,
    // `is_required` and `min_select >= 1` say the same thing in the SQL; taking
    // either as sufficient means a payload that sets only one of them still
    // renders a required group rather than a silently optional one.
    isRequired: group.is_required || group.min_select >= 1,
    sortOrder: group.sort_order,
    options: [...group.options]
      .sort(bySortOrderThenId)
      .map(toMenuOptionView),
  }
}

function bySortOrderThenId(
  a: { sort_order: number; id: string },
  b: { sort_order: number; id: string },
): number {
  return a.sort_order - b.sort_order || a.id.localeCompare(b.id)
}

/**
 * `menu_item_options` is a FLAT table: the group is a discriminator column set
 * repeated on every member row (doc 01 §6.9). Grouping is therefore a mapper
 * job, and it lives here so the admin editor and the customer sheet build the
 * identical group structure from the identical rows.
 */
export function toMenuOptionGroups(
  rows: readonly MenuItemOptionRow[],
): MenuOptionGroupView[] {
  const groups = new Map<string, MenuOptionGroupView>()

  for (const row of [...rows].sort(
    (a, b) =>
      a.group_sort_order - b.group_sort_order ||
      a.group_key.localeCompare(b.group_key) ||
      a.sort_order - b.sort_order ||
      a.id.localeCompare(b.id),
  )) {
    if (row.deleted_at !== null) continue

    let group = groups.get(row.group_key)
    if (!group) {
      group = {
        groupKey: row.group_key,
        groupLabel: row.group_label,
        selectionType: row.selection_type,
        minSelect: row.group_min_select,
        maxSelect: row.group_max_select,
        isRequired: row.group_min_select >= 1,
        sortOrder: row.group_sort_order,
        options: [],
      }
      groups.set(row.group_key, group)
    }

    group.options.push({
      id: row.id,
      name: row.name,
      priceDelta: money(row.price_delta, 'option price delta'),
      maxQuantity: row.max_quantity,
      isDefault: row.is_default,
      isAvailable: row.is_available,
      sortOrder: row.sort_order,
    })
  }

  return [...groups.values()]
}

/* ------------------------------------------------------------------ */
/* Items                                                               */
/* ------------------------------------------------------------------ */

export interface MenuItemViewOptions {
  /** Option rows, when the source is a `menu_items` row rather than the wire payload. */
  optionRows?: readonly MenuItemOptionRow[]
  /** `branches.default_prep_minutes`, used when the item does not carry its own. */
  defaultPrepMinutes?: number
}

function isWireItem(source: PublicMenuItem | MenuItemRow): source is PublicMenuItem {
  return 'option_groups' in source
}

/**
 * One dish, from either source.
 *
 * `isAvailable` is carried through rather than used to filter, because brief §5
 * requires an unavailable dish to be visible and visibly unavailable — a diner
 * who cannot find the plov asks a waiter where it went.
 */
export function toMenuItemView(
  source: PublicMenuItem | MenuItemRow,
  options: MenuItemViewOptions = {},
): MenuItemView {
  const fallbackPrep = options.defaultPrepMinutes ?? FALLBACK_PREP_MINUTES

  if (isWireItem(source)) {
    return {
      id: source.id,
      categoryId: source.category_id,
      name: source.name,
      description: source.description,
      ingredients: source.ingredients,
      price: money(source.price, 'item price'),
      compareAtPrice:
        source.compare_at_price === null
          ? null
          : money(source.compare_at_price, 'item compare-at price'),
      imageUrl: source.image_url,
      spicyLevel: source.spicy_level,
      preparationTime: source.preparation_time ?? fallbackPrep,
      calories: source.calories,
      dietaryTags: dietaryTags(source.dietary_tags),
      isAvailable: source.is_available,
      isFeatured: source.is_featured,
      isPopular: source.is_popular,
      sortOrder: source.sort_order,
      optionGroups: [...source.option_groups]
        .sort((a, b) => a.sort_order - b.sort_order || a.group_key.localeCompare(b.group_key))
        .map(toOptionGroupView),
    }
  }

  return {
    id: source.id,
    categoryId: source.category_id,
    name: source.name,
    description: source.description,
    ingredients: source.ingredients,
    price: money(source.price, 'item price'),
    compareAtPrice:
      source.compare_at_price === null
        ? null
        : money(source.compare_at_price, 'item compare-at price'),
    imageUrl: source.image_url,
    spicyLevel: source.spicy_level,
    preparationTime: source.preparation_time || fallbackPrep,
    calories: source.calories,
    dietaryTags: [...source.dietary_tags],
    isAvailable: source.is_available,
    isFeatured: source.is_featured,
    isPopular: source.is_popular,
    sortOrder: source.sort_order,
    optionGroups: toMenuOptionGroups(options.optionRows ?? []),
  }
}

/* ------------------------------------------------------------------ */
/* Categories                                                          */
/* ------------------------------------------------------------------ */

function categoryFrom(
  source: { id: string; name: MenuCategoryRow['name']; description: MenuCategoryRow['description']; image_url: string | null; icon: string | null; sort_order: number },
  items: MenuItemView[],
): MenuCategoryView {
  return {
    id: source.id,
    name: source.name,
    description: source.description,
    imageUrl: source.image_url,
    icon: source.icon,
    sortOrder: source.sort_order,
    items,
    itemCount: items.length,
    availableItemCount: items.reduce((n, item) => n + (item.isAvailable ? 1 : 0), 0),
  }
}

/** A staff-side category row plus the items already mapped for it. */
export function toMenuCategoryView(
  row: MenuCategoryRow,
  items: readonly MenuItemView[] = [],
): MenuCategoryView {
  return categoryFrom(row, [...items].sort(byItemOrder))
}

function toWireCategoryView(
  category: PublicMenuCategory,
  defaultPrepMinutes: number,
): MenuCategoryView {
  const items = [...category.items]
    .map((item) => toMenuItemView(item, { defaultPrepMinutes }))
    .sort(byItemOrder)
  return categoryFrom(category, items)
}

function byItemOrder(a: MenuItemView, b: MenuItemView): number {
  return a.sortOrder - b.sortOrder || a.id.localeCompare(b.id)
}

/* ------------------------------------------------------------------ */
/* Promotions                                                          */
/* ------------------------------------------------------------------ */

/**
 * Display only. No discount amount is mapped, because placing an order never
 * reads a promotion — the SQL prices the cart from `menu_items.price` alone
 * (doc 02 §2.6). Carrying a discount into a view model would invite a component
 * to show a total the receipt will not match.
 */
export function toPromotionView(source: PublicPromotion | PromotionRow): PromotionView {
  return {
    id: source.id,
    title: source.title,
    description: source.description,
    badgeLabel: source.badge_label,
    imageUrl: source.image_url,
    sortOrder: source.sort_order,
  }
}

/* ------------------------------------------------------------------ */
/* The whole tree                                                      */
/* ------------------------------------------------------------------ */

export interface MenuTreeOptions {
  /** `branches.default_prep_minutes`; the wire payload does not carry it. */
  defaultPrepMinutes?: number
}

/**
 * The complete branch menu, in one pass.
 *
 * `itemsById` is built here rather than by every caller because two hot paths
 * need it — search-as-you-type and cart revalidation — and both would otherwise
 * walk six categories on every keystroke.
 */
export function toMenuTree(menu: PublicMenu, options: MenuTreeOptions = {}): MenuTree {
  const defaultPrepMinutes = options.defaultPrepMinutes ?? FALLBACK_PREP_MINUTES

  const context = toTableContext({
    token: menu.token,
    restaurant: menu.restaurant,
    branch: menu.branch,
    table: menu.table,
    resolved_at: menu.generated_at,
  })

  const categories = [...menu.categories]
    .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
    .map((category) => toWireCategoryView(category, defaultPrepMinutes))

  const itemsById: Record<string, MenuItemView> = {}
  const featuredItemIds: string[] = []
  const popularItemIds: string[] = []

  for (const category of categories) {
    for (const item of category.items) {
      itemsById[item.id] = item
      if (item.isFeatured) featuredItemIds.push(item.id)
      if (item.isPopular) popularItemIds.push(item.id)
    }
  }

  return {
    context,
    categories,
    promotions: [...menu.promotions]
      .sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id))
      .map(toPromotionView),
    itemsById,
    featuredItemIds,
    popularItemIds,
    generatedAt: menu.generated_at,
  }
}
