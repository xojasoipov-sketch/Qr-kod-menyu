// src/lib/validation/common.ts
import { z } from 'zod';
import {
  APP_ROLES, DIETARY_TAGS, OPTION_SELECTION_TYPES, ORDER_STATUSES,
  STAFF_ROLES, WAITER_CALL_REASONS, WAITER_CALL_STATUSES,
} from '@/types/database';
import { LOCALES } from '@/types/i18n';
import { MONEY_MAX } from '@/lib/money';

export const uuidSchema = z.uuid({ version: 'v4' });
/** Any-version UUID — Supabase gen_random_uuid() is v4, but auth ids must not be over-constrained. */
export const anyUuidSchema = z.uuid();

export const localeSchema = z.enum(LOCALES);
export const appRoleSchema = z.enum(APP_ROLES);
export const staffRoleSchema = z.enum(STAFF_ROLES);
export const orderStatusSchema = z.enum(ORDER_STATUSES);
export const dietaryTagSchema = z.enum(DIETARY_TAGS);
export const selectionTypeSchema = z.enum(OPTION_SELECTION_TYPES);
export const waiterCallReasonSchema = z.enum(WAITER_CALL_REASONS);
export const waiterCallStatusSchema = z.enum(WAITER_CALL_STATUSES);

/** public.i18n_text — mirrors public.is_i18n_text(): keys ⊆ {uz,ru,en}, ≤2000 chars, ≥1 non-empty. */
export const i18nTextSchema = z
  .strictObject({
    uz: z.string().trim().max(2000).optional(),
    ru: z.string().trim().max(2000).optional(),
    en: z.string().trim().max(2000).optional(),
  })
  .refine(
    (value) => Object.values(value).some((s) => typeof s === 'string' && s.length > 0),
    { error: 'At least one of uz / ru / en must be non-empty', path: ['uz'] },
  );

/** Optional i18n text: absent, null, or a valid i18n_text. */
export const optionalI18nTextSchema = i18nTextSchema.nullish();

/** public.money_minor — a non-negative safe integer of minor units. Never a decimal string. */
export const moneySchema = z
  .number()
  .int({ error: 'Money must be an integer count of minor units' })
  .min(0)
  .max(MONEY_MAX);

/** public.bps — 0..10000. */
export const bpsSchema = z.number().int().min(0).max(10_000);

/** restaurants.slug — ck_restaurants_slug_format + ck_restaurants_slug_not_reserved. */
const RESERVED_SLUGS = new Set([
  't', 'o', 'api', 'auth', 'admin', 'login', 'logout', 'signup', 'kitchen',
  'waiter', 'app', 'www', 'static', 'assets', 'public', 'health', 'favicon',
]);
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$/, { error: 'errors.validation.slug_format' })
  .refine((s) => !RESERVED_SLUGS.has(s), { error: 'errors.validation.slug_reserved' });

/** ck_*_phone_format */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9 ()-]{5,24}$/, { error: 'errors.validation.phone_format' });

/** ck_*_email_format, lower-cased to satisfy ck_profiles_email_lowercase. */
export const emailSchema = z.email().trim().toLowerCase().max(254);

/** tables.qr_token / qr_token_history.token — ck_tables_qr_token_format. */
export const qrTokenSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{22,64}$/, { error: 'errors.validation.qr_token_format' });

/** orders.public_code — ck_orders_public_code_format. */
export const publicCodeSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{10,32}$/, { error: 'errors.validation.public_code_format' });

/** branches.code — ck_branches_code_format. Also the order_number prefix. */
export const branchCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z0-9]{0,3}$/, { error: 'errors.validation.branch_code_format' });

/** tables.number — ck_tables_number_format. */
export const tableNumberSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$/, { error: 'errors.validation.table_number_format' });

export const sortOrderSchema = z.number().int().min(0).max(1_000_000);

/** IANA timezone. Validated against the runtime's own tz database — no hard-coded list. */
export const timezoneSchema = z.string().trim().min(1).max(64).refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  },
  { error: 'errors.validation.timezone_unknown' },
);

/** ISO-4217. */
export const currencySchema = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
export const currencyDecimalsSchema = z.number().int().min(0).max(4);

/** Storage URL / path caps. */
export const imageUrlSchema = z.url().max(1024);
export const storagePathSchema = z.string().trim().min(1).max(512);

/** Free-text note with control characters stripped, then length-capped. */
export function noteSchema(max: number) {
  return z
    .string()
    .transform((s) => s.replace(/[\u0000-\u001F\u007F]/g, ' ').trim())
    .refine((s) => s.length <= max, { error: 'errors.validation.note_too_long' });
}

/** Sanitised, nullable note that turns '' into null so it never hits a NOT NULL default. */
export function optionalNoteSchema(max: number) {
  return noteSchema(max)
    .transform((s) => (s.length === 0 ? null : s))
    .nullish()
    .transform((s) => s ?? null);
}
