// src/lib/validation/menu.ts
import { z } from 'zod';
import {
  bpsSchema, dietaryTagSchema, i18nTextSchema, imageUrlSchema, moneySchema,
  optionalI18nTextSchema, selectionTypeSchema, sortOrderSchema, storagePathSchema, uuidSchema,
} from '@/lib/validation/common';

/** menu_categories create/update payload. */
export const categorySchema = z.strictObject({
  id: uuidSchema.optional(),
  /** null = restaurant-wide (all branches). */
  branch_id: uuidSchema.nullish().transform((v) => v ?? null),
  name: i18nTextSchema,
  description: optionalI18nTextSchema.transform((v) => v ?? null),
  image_url: imageUrlSchema.nullish().transform((v) => v ?? null),
  image_path: storagePathSchema.nullish().transform((v) => v ?? null),
  /** lucide icon slug — ck_menu_categories_icon_format. */
  icon: z.string().trim().regex(/^[a-z0-9-]{1,40}$/).nullish().transform((v) => v ?? null),
  sort_order: sortOrderSchema.default(0),
  is_active: z.boolean().default(true),
});
export type CategoryInput = z.infer<typeof categorySchema>;

/** One extras/size option. Belongs to a group identified by group_key on the same item. */
export const menuItemOptionSchema = z.strictObject({
  id: uuidSchema.optional(),
  group_key: z.string().trim().regex(/^[a-z0-9_]{1,32}$/),
  group_label: i18nTextSchema,
  selection_type: selectionTypeSchema.default('multiple'),
  group_min_select: z.number().int().min(0).max(20).default(0),
  group_max_select: z.number().int().min(1).max(20).nullish().transform((v) => v ?? null),
  group_sort_order: sortOrderSchema.default(0),
  name: i18nTextSchema,
  price_delta: moneySchema.default(0),
  max_quantity: z.number().int().min(1).max(20).default(1),
  is_default: z.boolean().default(false),
  is_available: z.boolean().default(true),
  sort_order: sortOrderSchema.default(0),
})
  .refine(
    (o) => o.group_max_select === null || o.group_max_select >= o.group_min_select,
    { error: 'errors.validation.select_bounds', path: ['group_max_select'] },
  )
  .refine(
    // ck_menu_item_options_single_select_bounds
    (o) => o.selection_type !== 'single' || (o.group_max_select === 1 && o.max_quantity === 1),
    { error: 'errors.validation.single_select_bounds', path: ['selection_type'] },
  );
export type MenuItemOptionInput = z.infer<typeof menuItemOptionSchema>;

/** menu_items create/update payload. Money is minor units, entered by an authenticated manager. */
export const menuItemSchema = z.strictObject({
  id: uuidSchema.optional(),
  category_id: uuidSchema,
  branch_id: uuidSchema.nullish().transform((v) => v ?? null),
  name: i18nTextSchema,
  description: optionalI18nTextSchema.transform((v) => v ?? null),
  ingredients: optionalI18nTextSchema.transform((v) => v ?? null),
  price: moneySchema,
  compare_at_price: moneySchema.nullish().transform((v) => v ?? null),
  image_url: imageUrlSchema.nullish().transform((v) => v ?? null),
  image_path: storagePathSchema.nullish().transform((v) => v ?? null),
  /** 0 none · 1 mild · 2 medium · 3 hot. */
  spicy_level: z.number().int().min(0).max(3).default(0),
  preparation_time: z.number().int().min(1).max(240).default(15),
  calories: z.number().int().min(0).max(20_000).nullish().transform((v) => v ?? null),
  dietary_tags: z.array(dietaryTagSchema).max(10).default([]),
  is_available: z.boolean().default(true),
  unavailable_until: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
  /** 'HH:MM' daypart window; both or neither. */
  available_from: z.iso.time({ precision: -1 }).nullish().transform((v) => v ?? null),
  available_until: z.iso.time({ precision: -1 }).nullish().transform((v) => v ?? null),
  is_featured: z.boolean().default(false),
  is_popular: z.boolean().default(false),
  sort_order: sortOrderSchema.default(0),
  options: z.array(menuItemOptionSchema).max(50).default([]),
})
  .refine(
    (i) => i.compare_at_price === null || i.compare_at_price > i.price,
    { error: 'errors.validation.compare_at_price', path: ['compare_at_price'] },
  )
  .refine(
    (i) => (i.available_from === null) === (i.available_until === null),
    { error: 'errors.validation.daypart_pair', path: ['available_until'] },
  )
  .refine(
    (i) => i.available_from === null || i.available_until === null || i.available_from < i.available_until,
    { error: 'errors.validation.daypart_order', path: ['available_until'] },
  )
  .refine(
    (i) => i.unavailable_until === null || i.is_available === false,
    { error: 'errors.validation.unavailable_until_requires_unavailable', path: ['unavailable_until'] },
  )
  .refine(
    (i) => new Set(i.dietary_tags).size === i.dietary_tags.length,
    { error: 'errors.validation.duplicate_dietary_tag', path: ['dietary_tags'] },
  );
export type MenuItemInput = z.infer<typeof menuItemSchema>;

/** The AVAILABLE -> UNAVAILABLE toggle (brief §12), separate so it is a one-tap action. */
export const menuItemAvailabilitySchema = z.strictObject({
  menu_item_id: uuidSchema,
  is_available: z.boolean(),
  unavailable_until: z.iso.datetime({ offset: true }).nullish().transform((v) => v ?? null),
}).refine(
  (v) => v.unavailable_until === null || v.is_available === false,
  { error: 'errors.validation.unavailable_until_requires_unavailable', path: ['unavailable_until'] },
);
export type MenuItemAvailabilityInput = z.infer<typeof menuItemAvailabilitySchema>;

/** Drag-and-drop reordering of categories or items. */
export const reorderSchema = z.strictObject({
  entity: z.enum(['menu_category', 'menu_item', 'menu_item_option']),
  items: z.array(z.strictObject({ id: uuidSchema, sort_order: sortOrderSchema })).min(1).max(500),
}).refine(
  (v) => new Set(v.items.map((i) => i.id)).size === v.items.length,
  { error: 'errors.validation.duplicate_id', path: ['items'] },
);
export type ReorderInput = z.infer<typeof reorderSchema>;

/** Unused here but exported for the fee editor; keeps bpsSchema in one import path. */
export { bpsSchema };
