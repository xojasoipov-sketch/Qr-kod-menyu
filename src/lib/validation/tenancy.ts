// src/lib/validation/tenancy.ts
import { z } from 'zod';
import {
  anyUuidSchema, bpsSchema, branchCodeSchema, currencyDecimalsSchema, currencySchema,
  emailSchema, i18nTextSchema, imageUrlSchema, localeSchema, optionalI18nTextSchema,
  phoneSchema, slugSchema, sortOrderSchema, staffRoleSchema, tableNumberSchema,
  timezoneSchema, uuidSchema,
} from '@/lib/validation/common';

/** tables — create/edit. qr_token is NEVER in this payload; rotation is a separate RPC. */
export const tableSchema = z.strictObject({
  id: uuidSchema.optional(),
  branch_id: uuidSchema,
  number: tableNumberSchema,
  name: z.string().trim().min(1).max(60).nullish().transform((v) => v ?? null),
  zone: z.string().trim().min(1).max(40).nullish().transform((v) => v ?? null),
  seats: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
  sort_order: sortOrderSchema.default(0),
  is_active: z.boolean().default(true),
});
export type TableInput = z.infer<typeof tableSchema>;

/** Rotate a table's QR token — admin_rotate_table_token(p_table_id). */
export const rotateTableTokenSchema = z.strictObject({
  table_id: uuidSchema,
  reason: z.string().trim().max(200).nullish().transform((v) => v ?? null),
});
export type RotateTableTokenInput = z.infer<typeof rotateTableTokenSchema>;

/** branches — create/edit, including the operational knobs the KDS and limiter read. */
export const branchSchema = z.strictObject({
  id: uuidSchema.optional(),
  name: z.string().trim().min(1).max(120),
  code: branchCodeSchema,
  address: z.string().trim().max(300).nullish().transform((v) => v ?? null),
  phone: phoneSchema.nullish().transform((v) => v ?? null),
  timezone: timezoneSchema.default('Asia/Tashkent'),
  /** NUMERIC(9,6) — sent as a string so no float ever touches a coordinate. */
  latitude: z.string().regex(/^-?\d{1,2}(\.\d{1,6})?$/).nullish().transform((v) => v ?? null),
  longitude: z.string().regex(/^-?\d{1,3}(\.\d{1,6})?$/).nullish().transform((v) => v ?? null),
  /** null = inherit restaurants.service_fee_bps. */
  service_fee_bps: bpsSchema.nullish().transform((v) => v ?? null),
  /** { "mon": [["09:00","23:00"]], ... }; empty object = always open. */
  opening_hours: z.partialRecord(
    z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
    z.array(z.tuple([z.iso.time({ precision: -1 }), z.iso.time({ precision: -1 })])).max(3),
  ).default({}),
  waiter_call_cooldown_seconds: z.number().int().min(0).max(3600).default(90),
  waiter_call_expiry_minutes: z.number().int().min(1).max(1440).default(30),
  order_min_interval_seconds: z.number().int().min(0).max(3600).default(20),
  default_prep_minutes: z.number().int().min(1).max(240).default(15),
  late_order_threshold_minutes: z.number().int().min(1).max(480).default(25),
  is_active: z.boolean().default(true),
  is_accepting_orders: z.boolean().default(true),
}).refine(
  (b) => (b.latitude === null) === (b.longitude === null),
  { error: 'errors.validation.geo_pair', path: ['longitude'] },
);
export type BranchInput = z.infer<typeof branchSchema>;

/**
 * staff — invite or edit a membership.
 * ck_staff_role_scope: RESTAURANT_OWNER must have branch_id NULL; WAITER and KITCHEN must have
 * a branch_id; MANAGER may be either (restaurant-wide or branch-scoped).
 * SUPER_ADMIN is not storable — it is profiles.is_platform_admin.
 */
export const staffSchema = z.strictObject({
  id: uuidSchema.optional(),
  /** Either an existing profile, or an email to invite. Exactly one. */
  profile_id: anyUuidSchema.nullish().transform((v) => v ?? null),
  invite_email: emailSchema.nullish().transform((v) => v ?? null),
  role: staffRoleSchema,
  branch_id: uuidSchema.nullish().transform((v) => v ?? null),
  display_name: z.string().trim().min(1).max(80).nullish().transform((v) => v ?? null),
  employee_code: z.string().trim().regex(/^[A-Za-z0-9_-]{1,16}$/).nullish().transform((v) => v ?? null),
  is_active: z.boolean().default(true),
})
  .refine(
    (s) => (s.profile_id === null) !== (s.invite_email === null),
    { error: 'errors.validation.profile_or_invite', path: ['invite_email'] },
  )
  .refine(
    (s) => s.role !== 'RESTAURANT_OWNER' || s.branch_id === null,
    { error: 'errors.validation.owner_is_restaurant_wide', path: ['branch_id'] },
  )
  .refine(
    (s) => !(s.role === 'WAITER' || s.role === 'KITCHEN') || s.branch_id !== null,
    { error: 'errors.validation.branch_required', path: ['branch_id'] },
  );
export type StaffInput = z.infer<typeof staffSchema>;

/**
 * settings — the restaurant-level settings screen. Owner only (can_manage_settings).
 * Changing `currency` or `currency_decimals` does NOT rewrite historical orders: every order
 * froze its own currency at placement.
 */
export const settingsSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  slug: slugSchema,
  logo_url: imageUrlSchema.nullish().transform((v) => v ?? null),
  cover_image_url: imageUrlSchema.nullish().transform((v) => v ?? null),
  phone: phoneSchema.nullish().transform((v) => v ?? null),
  email: emailSchema.nullish().transform((v) => v ?? null),
  welcome_message: optionalI18nTextSchema.transform((v) => v ?? null),
  description: optionalI18nTextSchema.transform((v) => v ?? null),
  default_locale: localeSchema.default('uz'),
  currency: currencySchema.default('UZS'),
  currency_decimals: currencyDecimalsSchema.default(0),
  service_fee_enabled: z.boolean().default(false),
  service_fee_bps: bpsSchema.default(0),
  is_active: z.boolean().default(true),
}).refine(
  (s) => !s.service_fee_enabled || s.service_fee_bps > 0,
  { error: 'errors.validation.fee_enabled_without_rate', path: ['service_fee_bps'] },
);
export type SettingsInput = z.infer<typeof settingsSchema>;

/** Exported so the menu editor can reuse the same i18n rule. */
export { i18nTextSchema, sortOrderSchema };
