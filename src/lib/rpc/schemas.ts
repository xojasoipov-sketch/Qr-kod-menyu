/**
 * The public wire contract.
 *
 * The five public RPCs return `jsonb` built by `jsonb_build_object`, so
 * PostgREST cannot type them and the generated database types do not describe
 * them. These schemas ARE the contract — they are what makes a change to a SQL
 * payload a loud failure here instead of an `undefined` rendered into a page.
 *
 * Parsing the OUTPUT matters as much as the input. The database is trusted, but
 * "trusted" and "unchanged since this code was written" are different claims,
 * and a menu that silently renders half its fields is worse than one that
 * refuses to render.
 */
import { z } from 'zod'

import {
  i18nTextSchema,
  moneySchema,
  publicCodeSchema,
  qrTokenSchema,
  uuidSchema,
  waiterCallReasonSchema,
} from '@/lib/validation/common'
import { LOCALES } from '@/types/i18n'

/* ------------------------------------------------------------------ */
/* Shared context — the same block rides on resolve_table and get_menu */
/* ------------------------------------------------------------------ */

const optionalI18n = i18nTextSchema.nullable()
const timestamp = z.string().min(1)

export const PublicRestaurantSchema = z.object({
  name: z.string(),
  slug: z.string(),
  logo_url: z.string().nullable(),
  welcome_message: optionalI18n,
  default_locale: z.enum(LOCALES),
  currency: z.string().length(3),
  currency_decimals: z.number().int().min(0).max(4),
})

export const PublicBranchSchema = z.object({
  name: z.string(),
  timezone: z.string(),
  is_accepting_orders: z.boolean(),
  service_fee_enabled: z.boolean(),
  service_fee_bps: z.number().int().min(0).max(10_000),
})

export const PublicTableSchema = z.object({
  number: z.string().nullable(),
  name: z.string().nullable(),
})

export const PublicTableContextSchema = z.object({
  token: qrTokenSchema,
  restaurant: PublicRestaurantSchema,
  branch: PublicBranchSchema,
  table: PublicTableSchema,
  resolved_at: timestamp,
})

/* ------------------------------------------------------------------ */
/* Menu                                                                */
/* ------------------------------------------------------------------ */

export const PublicMenuOptionSchema = z.object({
  id: uuidSchema,
  name: i18nTextSchema,
  price_delta: moneySchema,
  max_quantity: z.number().int().min(1),
  is_default: z.boolean(),
  is_available: z.boolean(),
  sort_order: z.number().int(),
})

export const PublicOptionGroupSchema = z.object({
  group_key: z.string(),
  group_label: i18nTextSchema,
  selection_type: z.enum(['single', 'multiple']),
  min_select: z.number().int().min(0),
  max_select: z.number().int().min(1).nullable(),
  is_required: z.boolean(),
  sort_order: z.number().int(),
  options: z.array(PublicMenuOptionSchema),
})

export const PublicMenuItemSchema = z.object({
  id: uuidSchema,
  category_id: uuidSchema,
  name: i18nTextSchema,
  description: optionalI18n,
  ingredients: optionalI18n,
  price: moneySchema,
  compare_at_price: moneySchema.nullable(),
  image_url: z.string().nullable(),
  spicy_level: z.number().int().min(0).max(3),
  preparation_time: z.number().int().min(0).nullable(),
  calories: z.number().int().min(0).nullable(),
  dietary_tags: z.array(z.string()),
  is_available: z.boolean(),
  is_featured: z.boolean(),
  is_popular: z.boolean(),
  sort_order: z.number().int(),
  option_groups: z.array(PublicOptionGroupSchema),
})

export const PublicCategorySchema = z.object({
  id: uuidSchema,
  name: i18nTextSchema,
  description: optionalI18n,
  image_url: z.string().nullable(),
  icon: z.string().nullable(),
  sort_order: z.number().int(),
  items: z.array(PublicMenuItemSchema),
})

/** Display-only. No discount field is emitted, and placing an order never reads promotions. */
export const PublicPromotionSchema = z.object({
  id: uuidSchema,
  title: i18nTextSchema,
  description: optionalI18n,
  badge_label: optionalI18n,
  image_url: z.string().nullable(),
  sort_order: z.number().int(),
})

export const PublicMenuSchema = z.object({
  token: qrTokenSchema,
  restaurant: PublicRestaurantSchema,
  branch: PublicBranchSchema,
  table: PublicTableSchema,
  categories: z.array(PublicCategorySchema),
  promotions: z.array(PublicPromotionSchema),
  generated_at: timestamp,
})

/* ------------------------------------------------------------------ */
/* Orders                                                              */
/* ------------------------------------------------------------------ */

export const PublicOrderLineOptionSchema = z.object({
  name: i18nTextSchema,
  price_delta: moneySchema,
  quantity: z.number().int().min(1),
})

export const PublicOrderLineSchema = z.object({
  id: uuidSchema,
  name: i18nTextSchema,
  description: optionalI18n,
  image_url: z.string().nullable(),
  unit_price: moneySchema,
  quantity: z.number().int().min(1),
  options_total: moneySchema,
  line_total: moneySchema,
  note: z.string().nullable(),
  spicy_level: z.number().int().min(0).max(3).nullable(),
  options: z.array(PublicOrderLineOptionSchema),
})

export const PublicOrderHistorySchema = z.object({
  status: z.enum([
    'pending',
    'confirmed',
    'preparing',
    'ready',
    'delivered',
    'completed',
    'cancelled',
  ]),
  at: timestamp,
})

export const PublicOrderSchema = z.object({
  order_number: z.string(),
  public_code: publicCodeSchema,
  tracking_path: z.string(),
  status: PublicOrderHistorySchema.shape.status,
  order_type: z.enum(['dine_in', 'takeaway']),
  channel: z.enum(['qr', 'waiter', 'admin']),
  currency: z.string().length(3),
  currency_decimals: z.number().int().min(0).max(4),
  subtotal: moneySchema,
  discount_total: moneySchema,
  service_fee: moneySchema,
  service_fee_bps: z.number().int().min(0).max(10_000),
  total: moneySchema,
  note: z.string().nullable(),
  guest_count: z.number().int().min(1).nullable(),
  locale: z.enum(LOCALES),
  estimated_prep_minutes: z.number().int().min(0).nullable(),
  due_at: timestamp.nullable(),
  placed_at: timestamp.nullable(),
  confirmed_at: timestamp.nullable(),
  preparing_at: timestamp.nullable(),
  ready_at: timestamp.nullable(),
  delivered_at: timestamp.nullable(),
  completed_at: timestamp.nullable(),
  cancelled_at: timestamp.nullable(),
  cancellation_reason: z.string().nullable(),
  created_at: timestamp,
  table: PublicTableSchema,
  lines: z.array(PublicOrderLineSchema),
  history: z.array(PublicOrderHistorySchema),
})

export const WaiterCallResultSchema = z.object({
  status: z.literal('pending'),
  reason: waiterCallReasonSchema,
  cooldown_seconds: z.number().int().min(0),
  created_at: timestamp,
  table: PublicTableSchema,
})

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

/**
 * `.strict()` is the point of this schema, not a detail.
 *
 * A line carries a dish, a quantity, chosen option ids and a note — and NOTHING
 * else. No price, no name, no subtotal. Strict mode makes an attempt to smuggle
 * a `price` field a validation failure at the edge, before it can become a
 * field someone later reads by accident.
 */
export const PlaceOrderLineSchema = z
  .object({
    menu_item_id: uuidSchema,
    quantity: z.number().int().min(1).max(99),
    option_ids: z.array(uuidSchema).max(20).default([]),
    note: z.string().trim().max(200).nullish().transform((v) => v || null),
  })
  .strict()

export const PlaceOrderInputSchema = z
  .object({
    token: qrTokenSchema,
    items: z.array(PlaceOrderLineSchema).min(1).max(60),
    note: z.string().trim().max(280).nullish().transform((v) => v || null),
    client_request_id: uuidSchema,
  })
  .strict()

export const GetOrderInputSchema = z
  .object({ token: qrTokenSchema, public_code: publicCodeSchema })
  .strict()

export const CallWaiterInputSchema = z
  .object({ token: qrTokenSchema, reason: waiterCallReasonSchema })
  .strict()

export const CancelOrderInputSchema = z
  .object({
    token: qrTokenSchema,
    public_code: publicCodeSchema,
    reason: z.string().trim().min(1).max(200),
  })
  .strict()

/* ------------------------------------------------------------------ */
/* Inferred types — src/types/rpc.ts re-exports these                  */
/* ------------------------------------------------------------------ */

export type PublicTableContext = z.infer<typeof PublicTableContextSchema>
export type PublicMenu = z.infer<typeof PublicMenuSchema>
export type PublicMenuCategory = z.infer<typeof PublicCategorySchema>
export type PublicMenuItem = z.infer<typeof PublicMenuItemSchema>
export type PublicOptionGroup = z.infer<typeof PublicOptionGroupSchema>
export type PublicMenuOption = z.infer<typeof PublicMenuOptionSchema>
export type PublicPromotion = z.infer<typeof PublicPromotionSchema>
export type PublicOrder = z.infer<typeof PublicOrderSchema>
export type PublicOrderLine = z.infer<typeof PublicOrderLineSchema>
export type WaiterCallResult = z.infer<typeof WaiterCallResultSchema>
export type PlaceOrderInput = z.input<typeof PlaceOrderInputSchema>
export type PlaceOrderPayload = z.infer<typeof PlaceOrderInputSchema>
