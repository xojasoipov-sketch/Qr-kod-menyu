# RESTAURANT QR OS — 03. TypeScript Domain Layer & Shared Contracts

**Status:** FINAL. This document is the authoritative contract for everything under `src/types/**`
and `src/lib/**`.
**Upstream:** `docs/BRIEF.md` (product), `docs/architecture/01-database-schema.md` (schema — binding
for table names, column names and enum labels), `docs/architecture/02-security-and-rls.md`
(authorization, RPC surface, wire error codes — binding for function names, grants and the
`QRxxx_` catalogue).

Every identifier in this document — file path, exported symbol, field name, error code — is
**binding**. UI agents, service agents and the DB agent implement against these names verbatim.

---

## 0. The four rules this layer exists to enforce

1. **Money is an integer.** `type Money = number`, an exact count of minor units. No `float`, no
   `parseFloat`, no `toFixed()` arithmetic, no `Number(price) * qty` on a decimal string. §4.
2. **Postgres is authoritative.** Every rule in `src/lib/orders/state-machine.ts` and every zod
   schema is a *mirror* of a database constraint, not a substitute for it. The TypeScript copy
   exists to give the user a fast, localised, well-worded refusal; the database copy exists to make
   the refusal true. §5.
3. **Nothing crosses a boundary un-parsed.** Input is parsed by zod at the boundary; RPC output is
   parsed by zod at the boundary. §6.
4. **Failure is a value, not an exception.** Services return `Result<T>`; only genuinely
   exceptional conditions throw, and the service layer converts throws into `Result` at its edge.
   §7.

---

## 1. Reconciliation between doc 01 and doc 02 (read before writing any type)

Docs 01 and 02 were authored in parallel and drifted. This layer sits on top of both and cannot
compile against two vocabularies, so the drift is resolved here, **once**, and the resolution below
is binding on every agent including the DB agent.

**Resolution rule.**
- Doc 01 wins on *schema vocabulary*: table names, column names, enum type names and enum **labels**.
- Doc 02 wins on *authorization surface*: RPC function names, argument lists, grants, guard triggers
  and the `QRxxx_` wire error catalogue.
- Where a doc-02 SQL body references an identifier that doc 01 does not define, the SQL body is
  wrong and must be rewritten to the doc-01 identifier in the right-hand column.

### 1.1 Binding rename table

| Doc 02 writes | Authoritative (doc 01) | Note |
|---|---|---|
| table `public.qr_tokens`, `qt.token`, `qt.is_active` | `public.tables.qr_token` (live token) + `public.qr_token_history` (retired tokens) | There is exactly one live token per table; `qr_token_history` holds revoked ones. Joins `join public.qr_tokens qt on qt.table_id = t.id and qt.is_active` become `t.qr_token`. |
| `orders.public_token` | `orders.public_code` | Tracking capability. Format `^[A-Za-z0-9_-]{10,32}$`, 12 chars / 72 bits from `generate_public_code()`. |
| `orders.note` | `orders.customer_note` | Max 500 chars in DB; this layer caps input at 280 (doc 02 §2.6). |
| `menu_items.dietary` | `menu_items.dietary_tags` | `dietary_tag[]`. |
| `menu_items.is_archived is not true` | `menu_items.deleted_at IS NULL` | Soft delete is a timestamp, not a boolean. |
| `menu_item_options.is_required` | `menu_item_options.group_min_select >= 1` | Requiredness is a group property, derived. |
| `menu_item_options.max_select` | `menu_item_options.group_max_select` | Nullable = unbounded. |
| `menu_item_options.branch_id` | — (does not exist) | Options hang off `menu_item_id`; branch scope is inherited from the item. Drop the predicate. |
| `waiter_calls.status = 'open'` | `'pending'` | `waiter_call_status` labels are `pending, acknowledged, resolved, cancelled, expired`. |
| reasons `service, bill, water, cleaning, other` | `call_waiter, request_bill, request_water, request_cutlery, clean_table, complaint, other` | `waiter_call_reason` labels. The `QR023_INVALID_PAYLOAD` `allowed` array must list the doc-01 labels. |
| `notifications.kind`, value `'waiter_call.created'` | `notifications.type`, value `'waiter_call_created'` | `notification_type` enum. |
| `notifications.target_user_id` | `notifications.target_staff_id` | FK to `staff`, not to `profiles`. |
| `target_role = 'waiter'` | `'WAITER'` | `app_role` labels are UPPER_SNAKE. |
| roles `super_admin, owner, manager, waiter, kitchen` | `SUPER_ADMIN, RESTAURANT_OWNER, MANAGER, WAITER, KITCHEN` | Applies to every helper in doc 02 §4 and to `order_transition_allowed`. |
| `staff.user_id` | `staff.profile_id` | |
| `order_items.branch_id` | — (does not exist) | `staff_void_order_item` must read `branch_id` from the parent `orders` row. |
| `branches.service_fee_enabled` | `restaurants.service_fee_enabled` + `branches.service_fee_bps` (nullable override) | Fee is *enabled* per restaurant; the *rate* may be overridden per branch. §4.6. |

### 1.2 Columns doc 02's logic requires that doc 01 does not yet declare — REQUIRED ADDITIONS

The DB agent must add these; the types in §3 already include them.

```sql
-- Idempotency + duplicate-payload guard for public_place_order (doc 02 §2.6, §5.2).
ALTER TABLE public.orders
  ADD COLUMN client_request_id   UUID,
  ADD COLUMN payload_fingerprint TEXT;

CREATE UNIQUE INDEX uq_orders_client_request_id
  ON public.orders (client_request_id) WHERE client_request_id IS NOT NULL;

CREATE INDEX idx_orders_dup_guard
  ON public.orders (table_id, payload_fingerprint, created_at DESC);

COMMENT ON COLUMN public.orders.client_request_id IS
  'Client-generated v4 UUID, one per cart, reused across retries. The unique partial index makes a retry idempotent (QR013_DUPLICATE_ORDER never fires for the same cart).';
COMMENT ON COLUMN public.orders.payload_fingerprint IS
  'Hash of the normalised item payload. Detects an accidental double submit from the SAME table with a DIFFERENT client_request_id inside the duplicate window.';

-- Per-table anti-spam clocks (doc 02 §2.6 locks these rows FOR UPDATE).
ALTER TABLE public.tables
  ADD COLUMN last_order_at       TIMESTAMPTZ,
  ADD COLUMN last_waiter_call_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tables.last_order_at IS
  'Clock for the per-table order cooldown (branches.order_min_interval_seconds). Written only by public_place_order under FOR UPDATE.';
COMMENT ON COLUMN public.tables.last_waiter_call_at IS
  'Clock for the per-table waiter-call cooldown (branches.waiter_call_cooldown_seconds). Written only by public_call_waiter under FOR UPDATE.';
```

### 1.3 The one behavioural conflict, resolved

Doc 01's `is_valid_order_transition(from, to)` says `delivered` may only go to `completed`.
Doc 02's `order_transition_allowed(from, to, actor)` lets `super_admin` and `owner` cancel from
`delivered`. Because `order_status_history` carries
`CHECK (public.is_valid_order_transition(previous_status, new_status))`, a `delivered -> cancelled`
update would be rejected by that CHECK when the history trigger writes its row — the doc-02 grant is
unreachable and would surface as a confusing constraint violation instead of a clean `QR040`.

**Resolution: the legal edge set is the intersection.** `order_transition_allowed` must be rewritten
so that `delivered -> cancelled` is `false` for every actor. `delivered` has exactly one outgoing
edge, `completed`, for everybody. `src/lib/orders/state-machine.ts` encodes the intersection. A
post-delivery reversal is a refund; the MVP does not model refunds.

### 1.4 One RPC doc 02 does not define but the brief requires — REQUIRED ADDITION

Brief §26 demands explicit cancellation rules and §11 forbids customer accounts, so a guest must be
able to withdraw an order they have not been served. There is no public RPC for it. The DB agent
must add exactly this one, and no other public write:

```sql
-- public.public_cancel_order(p_token text, p_order_public_id text, p_reason text) -> jsonb
-- SECURITY DEFINER, owner postgres, search_path = '', VOLATILE.
-- GRANT EXECUTE TO anon, authenticated.
-- Resolves the token (strict), matches orders.public_code AND orders.table_id (both capabilities),
-- refuses unless orders.status = 'pending', writes cancelled_at + cancellation_reason,
-- and writes order_status_history with changed_by_kind = 'customer', changed_by = NULL,
-- changed_by_role = NULL.
-- Raises: QR001 (404) · QR002/QR003/QR004 (423) · QR030_ORDER_NOT_FOUND (404)
--       · QR040_INVALID_STATUS_TRANSITION (409, details {from, to, actor:'customer'})
--       · QR042_CANCEL_REASON_REQUIRED (422)
-- Returns app_private.order_payload(order_id).
```

Until this function exists, `OrderTracker` must not render a cancel button;
`canTransition('pending', 'cancelled', 'CUSTOMER')` returning `true` is a statement about policy,
and `src/lib/rpc/public.ts#cancelOrder` is the only thing that makes it reachable.

---

## 2. File map

Exactly these files. One responsibility each; no file in this layer imports React, and no file in
this layer performs I/O except the three Supabase factories and the two RPC modules.

### 2.1 `src/types/`

| File | Responsibility |
|---|---|
| `src/types/database.ts` | Hand-written row/insert/update types for all 19 `public` tables, the 10 Postgres enums as TS unions, and the `Database` interface passed to `createClient<Database>()`. Zero runtime exports except the enum value arrays. |
| `src/types/domain.ts` | App-facing view models (`TableContext`, `MenuTree`, `CartState`, `OrderView`, `KitchenTicket`, `WaiterCallView`, `DashboardStats`, …). What components receive. Never a raw DB row. |
| `src/types/rpc.ts` | The exact JSONB shapes the five public RPCs return, as inferred zod output types re-exported from `src/lib/rpc/schemas.ts`. The wire, before mapping into `domain.ts`. |
| `src/types/i18n.ts` | `Locale`, `I18nText`, `MessageKey`, `Messages`, `LOCALES`, `DEFAULT_LOCALE`, `BCP47`. |
| `src/types/result.ts` | `Result<T>`, `AppError`, `AppErrorCode`, `Ok`, `Err` — types only, no runtime. Runtime constructors live in `src/lib/result.ts`. |
| `src/types/supabase.generated.ts` | **Optional, git-ignored, never imported.** `npm run db:types` output, used only to diff against `database.ts` in CI. The DB is not reachable at build time, so the hand-written file is the one that compiles. |

### 2.2 `src/lib/`

| File | Responsibility |
|---|---|
| `src/lib/result.ts` | `ok()`, `err()`, `isOk()`, `isErr()`, `unwrapOr()`, `mapResult()`, `AppErrorException`, `toResult()`, `appError()`. The `Result` convention's runtime half. |
| `src/lib/money.ts` | `Money`, `toMinor`, `fromMinor`, `formatMoney`, `sumMoney`, `multiplyMoney`, `applyBps`, `assertMoney`, `MONEY_MAX`. Integer-only arithmetic. |
| `src/lib/i18n/locale.ts` | `resolveLocale(cookie, searchParam, acceptLanguage)`, `LOCALE_COOKIE`, `setLocaleCookie`, `bcp47(locale)`. |
| `src/lib/i18n/t.ts` | `t(value: I18nText \| null, locale, fallback)` — the `i18n_text` resolver: `locale → restaurant default → first non-empty → ''`. |
| `src/lib/i18n/messages.ts` | `getMessages(locale)`, `translate(messages, key, params)`. Loads `messages/{uz,ru,en}.json`. |
| `src/lib/orders/state-machine.ts` | The transition graph, actor matrix, `canTransition`, `assertTransition`, `nextStatuses`, `isTerminalStatus`. Mirrors Postgres. Pure, no imports except types + `AppErrorException`. |
| `src/lib/orders/pricing.ts` | `priceCart(lines, feeConfig)` → `CartTotals`. **Advisory only**: renders the cart preview. The order total is whatever `public_place_order` returns. |
| `src/lib/orders/lateness.ts` | `isLate(ticket, thresholdMinutes, now)`, `elapsedSeconds`, `dueAt`. Shared by KDS and admin. |
| `src/lib/security/errors.ts` | `QrErrorCode` union (the doc-02 catalogue), `mapPgError(e: PostgrestError): AppError`, `QR_TO_APP_ERROR`, `messageKeyFor(error)`. |
| `src/lib/security/rate-limit.ts` | `checkLimit(kind, key)`, `clientIp(headers)` — the in-process shedder of doc 02 §5.4. Not a security control. |
| `src/lib/supabase/public-client.ts` | `createPublicClient()` — anon key, **no cookies**. Node runtime only, under `/t/**` and `/api/public/**`. |
| `src/lib/supabase/server.ts` | `createServerClient()` — `@supabase/ssr` cookie client for `authenticated` staff. |
| `src/lib/supabase/admin.ts` | `createAdminClient()` — service role. `import 'server-only'` is line 1. |
| `src/lib/supabase/browser.ts` | `createBrowserClient()` — anon key, browser only. Realtime subscriptions and nothing else. |
| `src/lib/rpc/schemas.ts` | zod schemas for RPC **input and output**: `PlaceOrderInput`, `PublicTableContextSchema`, `PublicMenuSchema`, `PublicOrderSchema`, `WaiterCallResultSchema`. |
| `src/lib/rpc/public.ts` | `resolveTable`, `getMenu`, `placeOrder`, `getOrder`, `cancelOrder`, `callWaiter`. Parse in → `.rpc()` → parse out → `Result`. |
| `src/lib/rpc/staff.ts` | `rotateTableToken`, `staffPlaceOrder`, `voidOrderItem`. Same pattern, cookie client. |
| `src/lib/validation/common.ts` | Shared primitives: `uuidSchema`, `i18nTextSchema`, `moneySchema`, `localeSchema`, `slugSchema`, `phoneSchema`, `qrTokenSchema`, `publicCodeSchema`, `sortOrderSchema`, `noteSchema`. |
| `src/lib/validation/order.ts` | `cartLineSchema`, `placeOrderSchema`, `statusUpdateSchema`, `cancelOrderSchema`. |
| `src/lib/validation/menu.ts` | `menuItemSchema`, `categorySchema`, `menuItemOptionSchema`, `menuItemAvailabilitySchema`, `reorderSchema`. |
| `src/lib/validation/tenancy.ts` | `tableSchema`, `branchSchema`, `staffSchema`, `settingsSchema`. |
| `src/lib/validation/waiter.ts` | `waiterCallSchema`, `waiterCallUpdateSchema`. |
| `src/lib/services/menu-service.ts` | Staff-side menu CRUD against the cookie client. Returns `Result`. |
| `src/lib/services/order-service.ts` | Staff-side order reads + `updateOrderStatus`, `cancelOrder`, `voidLine`. Calls `state-machine` before writing. |
| `src/lib/services/table-service.ts` | Tables + QR: create, edit, deactivate, `rotateToken` (via RPC), `qrPngDataUrl`. |
| `src/lib/services/branch-service.ts` | Branch CRUD and per-branch operational settings. |
| `src/lib/services/staff-service.ts` | Staff roster: invite, change role, change branch, deactivate. |
| `src/lib/services/waiter-service.ts` | Waiter-call list, `acknowledge`, `resolve`. |
| `src/lib/services/dashboard-service.ts` | `getDashboardStats(branchId, businessDate)` → `DashboardStats`. |
| `src/lib/services/settings-service.ts` | Restaurant settings, currency, service fee, locale defaults. Owner-only. |
| `src/lib/mappers/menu-mapper.ts` | `toMenuTree(PublicMenuPayload)`, `toMenuItemView(MenuItemRow, options)`. Wire/row → view model. |
| `src/lib/mappers/order-mapper.ts` | `toOrderView`, `toOrderLineView`, `toKitchenTicket`. |
| `src/lib/mappers/waiter-mapper.ts` | `toWaiterCallView`. |
| `src/lib/realtime/channels.ts` | `orderTopic(publicCode)`, `branchTopic(branchId)`, `REALTIME_EVENTS`. The only place topic strings are built. |
| `src/lib/realtime/subscribe.ts` | `subscribeToOrder(publicCode, cb)`, `subscribeToBranch(branchId, handlers)`. Browser client only. |
| `src/lib/utils/cn.ts` | `cn(...)` — `clsx` + `tailwind-merge`. |
| `src/lib/utils/datetime.ts` | `formatTime`, `formatRelative`, `businessDateFor(timezone, at)`. Timezone-aware via `Intl.DateTimeFormat`. |
| `src/lib/utils/id.ts` | `newClientRequestId()` (`crypto.randomUUID()`), `newCartLineId()`. |
| `src/lib/cart/cart-store.ts` | Client-side cart reducer + `localStorage` persistence keyed by QR token. Holds `CartState`. |

---

## 3. `src/types/database.ts`

Hand-written. The database is not reachable at build time, and a generated file that fails to
regenerate silently rots; this file is reviewed like any other source. CI runs `npm run db:types`
against a local Supabase and diffs the result — a mismatch fails the build but never blocks a build
that has no database.

Conventions:
- `TIMESTAMPTZ` and `DATE` → `string` (PostgREST emits ISO-8601 / `YYYY-MM-DD`).
- `NUMERIC` → `string` (PostgREST emits numerics as strings to preserve precision — never `number`).
- `BIGINT` money → `Money` (`number`; safe because `money_minor >= 0` and every realistic total is
  far below `2^53`; `assertMoney` guards the ceiling anyway).
- `public.i18n_text` → `I18nText`.
- Generated columns are present on `Row` and absent from `Insert`/`Update`.
- `menu_items.search_vector` is deliberately absent: it is `tsvector`, never selected, and never
  written.

```ts
// src/types/database.ts
import type { I18nText, Locale } from '@/types/i18n';
import type { Money } from '@/lib/money';

/** PostgREST JSON scalar. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/* ------------------------------------------------------------------ */
/* Postgres enums (01 §4). Labels are binding.                         */
/* ------------------------------------------------------------------ */

/** public.app_role. SUPER_ADMIN is never stored in staff.role (ck_staff_no_super_admin). */
export type AppRole =
  | 'SUPER_ADMIN'
  | 'RESTAURANT_OWNER'
  | 'MANAGER'
  | 'WAITER'
  | 'KITCHEN';

/** Roles actually storable in public.staff.role. */
export type StaffRole = Exclude<AppRole, 'SUPER_ADMIN'>;

/** public.order_status. Declaration order is display order only — never compare with < or >. */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'completed'
  | 'cancelled';

/** public.order_type */
export type OrderType = 'dine_in' | 'takeaway';

/** public.order_channel */
export type OrderChannel = 'qr' | 'waiter' | 'admin';

/** public.dietary_tag */
export type DietaryTag =
  | 'vegetarian'
  | 'vegan'
  | 'halal'
  | 'gluten_free'
  | 'lactose_free'
  | 'nut_free'
  | 'contains_nuts'
  | 'contains_seafood'
  | 'contains_pork'
  | 'contains_alcohol';

/** public.waiter_call_reason */
export type WaiterCallReason =
  | 'call_waiter'
  | 'request_bill'
  | 'request_water'
  | 'request_cutlery'
  | 'clean_table'
  | 'complaint'
  | 'other';

/** public.waiter_call_status. pending + acknowledged are the two OPEN states. */
export type WaiterCallStatus =
  | 'pending'
  | 'acknowledged'
  | 'resolved'
  | 'cancelled'
  | 'expired';

/** public.actor_kind */
export type ActorKind = 'customer' | 'staff' | 'system';

/** public.option_selection_type */
export type OptionSelectionType = 'single' | 'multiple';

/** public.promotion_type */
export type PromotionType =
  | 'announcement'
  | 'percentage'
  | 'fixed_amount'
  | 'special_price';

/** public.notification_type */
export type NotificationType =
  | 'order_created'
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_ready'
  | 'order_delivered'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_late'
  | 'waiter_call_created'
  | 'waiter_call_acknowledged'
  | 'menu_item_unavailable'
  | 'system';

/** public.app_locale — identical to the UI Locale union by construction. */
export type AppLocale = Locale;

/* Runtime value arrays. The ONLY runtime exports in this file; used by zod z.enum(). */
export const APP_ROLES = [
  'SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN',
] as const satisfies readonly AppRole[];

export const STAFF_ROLES = [
  'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN',
] as const satisfies readonly StaffRole[];

export const ORDER_STATUSES = [
  'pending', 'confirmed', 'preparing', 'ready', 'delivered', 'completed', 'cancelled',
] as const satisfies readonly OrderStatus[];

export const ORDER_TYPES = ['dine_in', 'takeaway'] as const satisfies readonly OrderType[];

export const ORDER_CHANNELS = ['qr', 'waiter', 'admin'] as const satisfies readonly OrderChannel[];

export const DIETARY_TAGS = [
  'vegetarian', 'vegan', 'halal', 'gluten_free', 'lactose_free', 'nut_free',
  'contains_nuts', 'contains_seafood', 'contains_pork', 'contains_alcohol',
] as const satisfies readonly DietaryTag[];

export const WAITER_CALL_REASONS = [
  'call_waiter', 'request_bill', 'request_water', 'request_cutlery',
  'clean_table', 'complaint', 'other',
] as const satisfies readonly WaiterCallReason[];

export const WAITER_CALL_STATUSES = [
  'pending', 'acknowledged', 'resolved', 'cancelled', 'expired',
] as const satisfies readonly WaiterCallStatus[];

export const OPTION_SELECTION_TYPES = [
  'single', 'multiple',
] as const satisfies readonly OptionSelectionType[];

export const PROMOTION_TYPES = [
  'announcement', 'percentage', 'fixed_amount', 'special_price',
] as const satisfies readonly PromotionType[];

export const NOTIFICATION_TYPES = [
  'order_created', 'order_confirmed', 'order_preparing', 'order_ready',
  'order_delivered', 'order_completed', 'order_cancelled', 'order_late',
  'waiter_call_created', 'waiter_call_acknowledged', 'menu_item_unavailable', 'system',
] as const satisfies readonly NotificationType[];

/* ------------------------------------------------------------------ */
/* Shape helpers                                                       */
/* ------------------------------------------------------------------ */

/** Columns the caller must supply on INSERT; everything else is defaulted or nullable. */
export type Insertable<TRow, TRequired extends keyof TRow> =
  Pick<TRow, TRequired> & Partial<Omit<TRow, TRequired>>;

/** UPDATE payload: everything optional except the columns no client may ever rewrite. */
export type Updatable<TRow, TImmutable extends keyof TRow = never> =
  Partial<Omit<TRow, TImmutable | 'id' | 'created_at'>>;

/** Columns the database computes and no client may write. */
type Computed = 'total' | 'total_per_unit';

/* ------------------------------------------------------------------ */
/* 6.1 restaurants                                                     */
/* ------------------------------------------------------------------ */

export interface RestaurantRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_path: string | null;
  cover_image_url: string | null;
  phone: string | null;
  email: string | null;
  welcome_message: I18nText | null;
  description: I18nText | null;
  default_locale: AppLocale;
  /** CHAR(3), ISO-4217, e.g. 'UZS'. */
  currency: string;
  /** 0 for UZS, 2 for USD/EUR. Drives every formatMoney call for this tenant. */
  currency_decimals: number;
  /** Basis points: 10000 = 100.00%. */
  service_fee_bps: number;
  service_fee_enabled: boolean;
  settings: Json;
  is_active: boolean;
  is_demo: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type RestaurantInsert = Insertable<RestaurantRow, 'name' | 'slug'>;
export type RestaurantUpdate = Updatable<RestaurantRow, 'slug'>;

/* ------------------------------------------------------------------ */
/* 6.2 branches                                                        */
/* ------------------------------------------------------------------ */

export interface BranchRow {
  id: string;
  restaurant_id: string;
  name: string;
  /** ^[A-Z][A-Z0-9]{0,3}$ — the prefix of order_number, e.g. 'C' in 'C-014'. */
  code: string;
  address: string | null;
  phone: string | null;
  /** IANA zone, default 'Asia/Tashkent'. Business date and KDS clocks use it. */
  timezone: string;
  /** NUMERIC(9,6) — PostgREST returns a string. */
  latitude: string | null;
  longitude: string | null;
  /** NULL = inherit restaurants.service_fee_bps. */
  service_fee_bps: number | null;
  opening_hours: Json;
  waiter_call_cooldown_seconds: number;
  waiter_call_expiry_minutes: number;
  order_min_interval_seconds: number;
  default_prep_minutes: number;
  late_order_threshold_minutes: number;
  is_active: boolean;
  is_accepting_orders: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type BranchInsert = Insertable<BranchRow, 'restaurant_id' | 'name' | 'code'>;
export type BranchUpdate = Updatable<BranchRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.3 profiles                                                        */
/* ------------------------------------------------------------------ */

export interface ProfileRow {
  /** Equals auth.users.id. Not defaulted. */
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  avatar_path: string | null;
  locale: AppLocale;
  /** Platform admin. This, not staff.role, is what SUPER_ADMIN means. */
  is_platform_admin: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}
export type ProfileInsert = Insertable<ProfileRow, 'id'>;
export type ProfileUpdate = Updatable<ProfileRow, 'is_platform_admin'>;

/* ------------------------------------------------------------------ */
/* 6.4 staff                                                           */
/* ------------------------------------------------------------------ */

export interface StaffRow {
  id: string;
  restaurant_id: string;
  /** NULL for RESTAURANT_OWNER and restaurant-wide MANAGER; NOT NULL for WAITER/KITCHEN. */
  branch_id: string | null;
  profile_id: string;
  role: StaffRole;
  permissions: Json;
  display_name: string | null;
  employee_code: string | null;
  is_active: boolean;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}
export type StaffInsert = Insertable<StaffRow, 'restaurant_id' | 'profile_id' | 'role'>;
export type StaffUpdate = Updatable<StaffRow, 'restaurant_id' | 'profile_id'>;

/* ------------------------------------------------------------------ */
/* 6.5 tables                                                          */
/* ------------------------------------------------------------------ */

export interface TableRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  /** Human label, e.g. '12' or 'A3'. */
  number: string;
  name: string | null;
  zone: string | null;
  seats: number | null;
  sort_order: number;
  /** 144-bit base64url capability. NEVER sent to a staff list view; only to the QR generator. */
  qr_token: string;
  qr_token_issued_at: string;
  qr_rotation_count: number;
  is_active: boolean;
  /** REQUIRED ADDITION §1.2 — per-table order cooldown clock. */
  last_order_at: string | null;
  /** REQUIRED ADDITION §1.2 — per-table waiter-call cooldown clock. */
  last_waiter_call_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type TableInsert = Insertable<TableRow, 'restaurant_id' | 'branch_id' | 'number'>;
/** qr_token is rotated only by admin_rotate_table_token(); never by a direct UPDATE. */
export type TableUpdate = Updatable<
  TableRow,
  'restaurant_id' | 'branch_id' | 'qr_token' | 'qr_token_issued_at' | 'qr_rotation_count'
  | 'last_order_at' | 'last_waiter_call_at'
>;

/* ------------------------------------------------------------------ */
/* 6.6 qr_token_history                                                */
/* ------------------------------------------------------------------ */

export interface QrTokenHistoryRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  token: string;
  issued_at: string;
  revoked_at: string;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}
/** Written only by admin_rotate_table_token(); no client Insert/Update type is exported. */

/* ------------------------------------------------------------------ */
/* 6.7 menu_categories                                                 */
/* ------------------------------------------------------------------ */

export interface MenuCategoryRow {
  id: string;
  restaurant_id: string;
  /** NULL = the category belongs to every branch of the restaurant. */
  branch_id: string | null;
  name: I18nText;
  description: I18nText | null;
  image_url: string | null;
  image_path: string | null;
  /** lucide icon slug, ^[a-z0-9-]{1,40}$. */
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type MenuCategoryInsert = Insertable<MenuCategoryRow, 'restaurant_id' | 'name'>;
export type MenuCategoryUpdate = Updatable<MenuCategoryRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.8 menu_items                                                      */
/* ------------------------------------------------------------------ */

export interface MenuItemRow {
  id: string;
  restaurant_id: string;
  /** NULL = available at every branch. */
  branch_id: string | null;
  category_id: string;
  name: I18nText;
  description: I18nText | null;
  ingredients: I18nText | null;
  /** BIGINT minor units. */
  price: Money;
  /** Strike-through "was" price; must be > price when present. */
  compare_at_price: Money | null;
  image_url: string | null;
  image_path: string | null;
  /** 0 none · 1 mild · 2 medium · 3 hot. */
  spicy_level: number;
  /** Minutes, 1..240. */
  preparation_time: number;
  calories: number | null;
  dietary_tags: DietaryTag[];
  is_available: boolean;
  unavailable_until: string | null;
  /** TIME 'HH:MM:SS' daypart window. */
  available_from: string | null;
  available_until: string | null;
  is_featured: boolean;
  is_popular: boolean;
  popularity_score: number;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // search_vector is intentionally absent: tsvector, generated, never selected.
}
export type MenuItemInsert = Insertable<
  MenuItemRow, 'restaurant_id' | 'category_id' | 'name' | 'price'
>;
export type MenuItemUpdate = Updatable<MenuItemRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.9 menu_item_options                                               */
/* ------------------------------------------------------------------ */

export interface MenuItemOptionRow {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  /** Group discriminator, ^[a-z0-9_]{1,32}$, e.g. 'size', 'extras'. */
  group_key: string;
  group_label: I18nText;
  selection_type: OptionSelectionType;
  /** >= 1 means the group is REQUIRED (this replaces doc 02's is_required). */
  group_min_select: number;
  /** NULL = unbounded (this replaces doc 02's max_select). */
  group_max_select: number | null;
  group_sort_order: number;
  name: I18nText;
  /** Added to the item price, minor units. Never negative. */
  price_delta: Money;
  max_quantity: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type MenuItemOptionInsert = Insertable<
  MenuItemOptionRow, 'restaurant_id' | 'menu_item_id' | 'group_label' | 'name'
>;
export type MenuItemOptionUpdate = Updatable<
  MenuItemOptionRow, 'restaurant_id' | 'menu_item_id'
>;

/* ------------------------------------------------------------------ */
/* 6.10 promotions                                                     */
/* ------------------------------------------------------------------ */

export interface PromotionRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  promo_type: PromotionType;
  title: I18nText;
  description: I18nText | null;
  badge_label: I18nText | null;
  image_url: string | null;
  image_path: string | null;
  discount_bps: number | null;
  discount_amount: Money | null;
  special_price: Money | null;
  starts_at: string;
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type PromotionInsert = Insertable<PromotionRow, 'restaurant_id' | 'title'>;
export type PromotionUpdate = Updatable<PromotionRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.11 promotion_items                                                */
/* ------------------------------------------------------------------ */

export interface PromotionItemRow {
  id: string;
  restaurant_id: string;
  promotion_id: string;
  menu_item_id: string;
  created_at: string;
  updated_at: string;
}
export type PromotionItemInsert = Insertable<
  PromotionItemRow, 'restaurant_id' | 'promotion_id' | 'menu_item_id'
>;

/* ------------------------------------------------------------------ */
/* 6.12 branch_order_counters                                          */
/* ------------------------------------------------------------------ */

/** No id column. PK is (branch_id, business_date). Written only by the order-number trigger. */
export interface BranchOrderCounterRow {
  branch_id: string;
  /** 'YYYY-MM-DD' in the branch timezone. */
  business_date: string;
  last_number: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* 6.13 orders                                                         */
/* ------------------------------------------------------------------ */

export interface OrderRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  /** NULL only for order_type='takeaway'. */
  table_id: string | null;
  /** Customer tracking capability. 12 chars / 72 bits. Never orders.id in a URL. */
  public_code: string;
  /** Human-friendly, e.g. 'C-014'. Unique per (branch, business_date). */
  order_number: string;
  order_seq: number;
  business_date: string;
  order_type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  /** Anonymous browser session; required when channel='qr'. */
  customer_session_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  /** The order-level note ("No onion"). Doc 02 calls this orders.note — see §1.1. */
  customer_note: string | null;
  guest_count: number | null;
  locale: AppLocale;
  /** Frozen at placement so an historical receipt never re-renders in a new currency. */
  currency: string;
  currency_decimals: number;
  subtotal: Money;
  discount_total: Money;
  service_fee: Money;
  service_fee_bps: number;
  /** Always subtotal - discount_total + service_fee (ck_orders_totals_arithmetic). */
  total: Money;
  estimated_prep_minutes: number;
  due_at: string | null;
  placed_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  confirmed_by_staff_id: string | null;
  served_by_staff_id: string | null;
  cancelled_by_staff_id: string | null;
  /** REQUIRED ADDITION §1.2 — idempotency key, one per cart. */
  client_request_id: string | null;
  /** REQUIRED ADDITION §1.2 — normalised payload hash for the duplicate guard. */
  payload_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}
/**
 * No OrderInsert is exported. Orders are created ONLY by public_place_order() /
 * staff_place_order(). A direct client INSERT into orders is a bug and is refused by RLS.
 */
export type OrderStatusUpdate = Pick<OrderRow, 'status'> &
  Partial<Pick<OrderRow, 'cancellation_reason'>>;

/* ------------------------------------------------------------------ */
/* 6.14 order_items                                                    */
/* ------------------------------------------------------------------ */

export interface OrderItemRow {
  id: string;
  restaurant_id: string;
  order_id: string;
  /** NULL once the menu item is deleted — the snapshots below are why that is safe. */
  menu_item_id: string | null;
  name_snapshot: I18nText;
  description_snapshot: I18nText | null;
  category_name_snapshot: I18nText | null;
  image_url_snapshot: string | null;
  /** Unit price at placement time. Minor units. */
  price_snapshot: Money;
  spicy_level_snapshot: number;
  preparation_time_snapshot: number;
  dietary_tags_snapshot: DietaryTag[];
  quantity: number;
  /** Per-unit sum of chosen option deltas. */
  options_total: Money;
  /** GENERATED: quantity * (price_snapshot + options_total). Read-only. */
  total: Money;
  note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type OrderItemInsert = Omit<
  Insertable<OrderItemRow, 'restaurant_id' | 'order_id' | 'name_snapshot' | 'price_snapshot' | 'quantity'>,
  Computed
>;

/* ------------------------------------------------------------------ */
/* 6.15 order_item_options                                             */
/* ------------------------------------------------------------------ */

export interface OrderItemOptionRow {
  id: string;
  restaurant_id: string;
  order_id: string;
  order_item_id: string;
  menu_item_option_id: string | null;
  group_key_snapshot: string;
  group_label_snapshot: I18nText;
  name_snapshot: I18nText;
  price_delta_snapshot: Money;
  quantity: number;
  /** GENERATED: quantity * price_delta_snapshot. Read-only. */
  total_per_unit: Money;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type OrderItemOptionInsert = Omit<
  Insertable<
    OrderItemOptionRow,
    'restaurant_id' | 'order_id' | 'order_item_id' | 'group_key_snapshot'
    | 'group_label_snapshot' | 'name_snapshot' | 'price_delta_snapshot'
  >,
  Computed
>;

/* ------------------------------------------------------------------ */
/* 6.16 order_status_history                                           */
/* ------------------------------------------------------------------ */

export interface OrderStatusHistoryRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  order_id: string;
  /** NULL only for the very first row (order creation). */
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  /** profiles.id of the staff member; NULL for customer and system actors. */
  changed_by: string | null;
  changed_by_kind: ActorKind;
  /** NOT NULL when changed_by_kind='staff'; NULL for customer. */
  changed_by_role: AppRole | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}
/** Append-only, written by trg_orders_write_history(). No Insert type is exported. */

/* ------------------------------------------------------------------ */
/* 6.17 waiter_calls                                                   */
/* ------------------------------------------------------------------ */

export interface WaiterCallRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  order_id: string | null;
  reason: WaiterCallReason;
  status: WaiterCallStatus;
  note: string | null;
  customer_session_id: string | null;
  acknowledged_at: string | null;
  acknowledged_by_staff_id: string | null;
  resolved_at: string | null;
  resolved_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}
/** Created only by public_call_waiter(). Staff may only advance status. */
export type WaiterCallUpdate = Pick<WaiterCallRow, 'status'>;

/* ------------------------------------------------------------------ */
/* 6.18 notifications                                                  */
/* ------------------------------------------------------------------ */

export interface NotificationRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  /** Addressed to a role OR to one staff member; at least one is non-null. */
  target_role: StaffRole | null;
  target_staff_id: string | null;
  /** Doc 02 calls this column `kind` — see §1.1. */
  type: NotificationType;
  /** Rendered text is NOT stored; the client localises from type + payload. */
  payload: Json;
  /** 0 low · 1 normal · 2 urgent. */
  priority: number;
  order_id: string | null;
  waiter_call_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* 6.19 notification_reads                                             */
/* ------------------------------------------------------------------ */

/** Junction with a natural PK (notification_id, staff_id). No id column. */
export interface NotificationReadRow {
  notification_id: string;
  staff_id: string;
  restaurant_id: string;
  read_at: string;
  created_at: string;
  updated_at: string;
}
export type NotificationReadInsert =
  Pick<NotificationReadRow, 'notification_id' | 'staff_id' | 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* The Database interface for createClient<Database>()                 */
/* ------------------------------------------------------------------ */

export interface Database {
  public: {
    Tables: {
      restaurants:           { Row: RestaurantRow;        Insert: RestaurantInsert;        Update: RestaurantUpdate };
      branches:              { Row: BranchRow;            Insert: BranchInsert;            Update: BranchUpdate };
      profiles:              { Row: ProfileRow;           Insert: ProfileInsert;           Update: ProfileUpdate };
      staff:                 { Row: StaffRow;             Insert: StaffInsert;             Update: StaffUpdate };
      tables:                { Row: TableRow;             Insert: TableInsert;             Update: TableUpdate };
      qr_token_history:      { Row: QrTokenHistoryRow;    Insert: never;                   Update: never };
      menu_categories:       { Row: MenuCategoryRow;      Insert: MenuCategoryInsert;      Update: MenuCategoryUpdate };
      menu_items:            { Row: MenuItemRow;          Insert: MenuItemInsert;          Update: MenuItemUpdate };
      menu_item_options:     { Row: MenuItemOptionRow;    Insert: MenuItemOptionInsert;    Update: MenuItemOptionUpdate };
      promotions:            { Row: PromotionRow;         Insert: PromotionInsert;         Update: PromotionUpdate };
      promotion_items:       { Row: PromotionItemRow;     Insert: PromotionItemInsert;     Update: never };
      branch_order_counters: { Row: BranchOrderCounterRow; Insert: never;                  Update: never };
      orders:                { Row: OrderRow;             Insert: never;                   Update: OrderStatusUpdate };
      order_items:           { Row: OrderItemRow;         Insert: OrderItemInsert;         Update: never };
      order_item_options:    { Row: OrderItemOptionRow;   Insert: OrderItemOptionInsert;   Update: never };
      order_status_history:  { Row: OrderStatusHistoryRow; Insert: never;                  Update: never };
      waiter_calls:          { Row: WaiterCallRow;        Insert: never;                   Update: WaiterCallUpdate };
      notifications:         { Row: NotificationRow;      Insert: never;                   Update: never };
      notification_reads:    { Row: NotificationReadRow;  Insert: NotificationReadInsert;  Update: never };
    };
    Views: Record<never, never>;
    Functions: {
      public_resolve_table:     { Args: { p_token: string }; Returns: Json };
      public_get_menu:          { Args: { p_token: string }; Returns: Json };
      public_place_order: {
        Args: {
          p_token: string;
          p_items: Json;
          p_note: string | null;
          p_client_request_id?: string;
        };
        Returns: Json;
      };
      public_get_order:         { Args: { p_token: string; p_order_public_id: string }; Returns: Json };
      public_cancel_order:      { Args: { p_token: string; p_order_public_id: string; p_reason: string }; Returns: Json };
      public_call_waiter:       { Args: { p_token: string; p_reason: string }; Returns: Json };
      admin_rotate_table_token: { Args: { p_table_id: string }; Returns: Json };
      staff_place_order:        { Args: { p_table_id: string; p_items: Json; p_note: string | null }; Returns: Json };
      staff_void_order_item:    { Args: { p_order_item_id: string; p_reason: string }; Returns: Json };
    };
    Enums: {
      app_role: AppRole;
      order_status: OrderStatus;
      order_type: OrderType;
      order_channel: OrderChannel;
      dietary_tag: DietaryTag;
      waiter_call_reason: WaiterCallReason;
      waiter_call_status: WaiterCallStatus;
      actor_kind: ActorKind;
      option_selection_type: OptionSelectionType;
      promotion_type: PromotionType;
      notification_type: NotificationType;
      app_locale: AppLocale;
    };
    CompositeTypes: Record<never, never>;
  };
}
```

`src/types/i18n.ts` (referenced above, small enough to state inline):

```ts
// src/types/i18n.ts
export const LOCALES = ['uz', 'ru', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = 'uz';

/** public.i18n_text. Keys optional individually; at least one non-empty (DB-enforced). */
export type I18nText = Partial<Record<Locale, string>>;

/** BCP-47 tags used for Intl formatting. */
export const BCP47: Readonly<Record<Locale, string>> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
};

/** Dot-path into messages/<locale>.json, e.g. 'errors.app.TABLE_INACTIVE'. */
export type MessageKey = string;
export type Messages = Readonly<Record<MessageKey, string>>;
```

---

## 4. `src/types/domain.ts` — the app-facing view models

Components receive these and nothing else. Every field is `camelCase`, every money field is `Money`,
every translatable field is `I18nText` (resolved at render time by `t()`, never at fetch time — the
locale can change without a refetch).

```ts
// src/types/domain.ts
import type { Money } from '@/lib/money';
import type { I18nText, Locale } from '@/types/i18n';
import type {
  DietaryTag, OptionSelectionType, OrderChannel, OrderStatus, OrderType,
  StaffRole, WaiterCallReason, WaiterCallStatus,
} from '@/types/database';

/* ================================================================== */
/* TableContext — the result of resolving a QR token                   */
/* ================================================================== */

export interface TableContextRestaurant {
  name: string;
  slug: string;
  logoUrl: string | null;
  welcomeMessage: I18nText | null;
  /** ISO-4217, e.g. 'UZS'. */
  currency: string;
  /** 0 for UZS, 2 for USD. Every formatMoney call in this session uses it. */
  currencyDecimals: number;
  defaultLocale: Locale;
}

export interface TableContextBranch {
  name: string;
  /** IANA zone; all customer-facing times render in it. */
  timezone: string;
  serviceFeeEnabled: boolean;
  /** Basis points. 0 when disabled. */
  serviceFeeBps: number;
  isAcceptingOrders: boolean;
}

export interface TableContextTable {
  /** Human label shown as "Table 12". */
  number: string;
  name: string | null;
}

/**
 * Carries NO ids. The only identifier a customer ever holds is `token`.
 * Produced by mapPublicTableContext(); never constructed by hand in a component.
 */
export interface TableContext {
  token: string;
  restaurant: TableContextRestaurant;
  branch: TableContextBranch;
  table: TableContextTable;
  /** When this context was resolved; drives stale-context revalidation. */
  resolvedAt: string;
}

/* ================================================================== */
/* MenuTree                                                            */
/* ================================================================== */

export interface MenuOptionView {
  id: string;
  name: I18nText;
  priceDelta: Money;
  maxQuantity: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuOptionGroupView {
  groupKey: string;
  groupLabel: I18nText;
  selectionType: OptionSelectionType;
  minSelect: number;
  /** null = unbounded. */
  maxSelect: number | null;
  /** Derived: minSelect >= 1. */
  isRequired: boolean;
  sortOrder: number;
  options: MenuOptionView[];
}

export interface MenuItemView {
  id: string;
  categoryId: string;
  name: I18nText;
  description: I18nText | null;
  ingredients: I18nText | null;
  price: Money;
  compareAtPrice: Money | null;
  imageUrl: string | null;
  /** 0..3. */
  spicyLevel: number;
  /** Minutes. */
  preparationTime: number;
  calories: number | null;
  dietaryTags: DietaryTag[];
  /** false renders the card dimmed with the add button disabled — never hidden (brief §5). */
  isAvailable: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: number;
  optionGroups: MenuOptionGroupView[];
}

export interface MenuCategoryView {
  id: string;
  name: I18nText;
  description: I18nText | null;
  imageUrl: string | null;
  icon: string | null;
  sortOrder: number;
  items: MenuItemView[];
  /** items.length; cached so a category chip does not walk the array. */
  itemCount: number;
  /** items.filter(i => i.isAvailable).length. */
  availableItemCount: number;
}

export interface PromotionView {
  id: string;
  title: I18nText;
  description: I18nText | null;
  badgeLabel: I18nText | null;
  imageUrl: string | null;
  sortOrder: number;
}

export interface MenuTree {
  context: TableContext;
  categories: MenuCategoryView[];
  promotions: PromotionView[];
  /** Flat index for search and for cart-line revalidation. Key is MenuItemView.id. */
  itemsById: Readonly<Record<string, MenuItemView>>;
  featuredItemIds: string[];
  popularItemIds: string[];
  generatedAt: string;
}

/* ================================================================== */
/* Cart — client-side only. Never a source of truth for price.         */
/* ================================================================== */

export interface CartLineOption {
  optionId: string;
  groupKey: string;
  name: I18nText;
  priceDelta: Money;
  quantity: number;
}

export interface CartLine {
  /** Client-generated line identity. Two lines of the same dish with different options coexist. */
  lineId: string;
  menuItemId: string;
  name: I18nText;
  imageUrl: string | null;
  /** Advisory copy of MenuItemView.price. The server re-reads the real price. */
  unitPrice: Money;
  options: CartLineOption[];
  /** Per-unit sum of option deltas. */
  optionsTotal: Money;
  quantity: number;
  note: string | null;
  /** Advisory: quantity * (unitPrice + optionsTotal). */
  lineTotal: Money;
  /** Last-known availability; refreshed on every menu load. false blocks checkout. */
  isAvailable: boolean;
  spicyLevel: number;
  addedAt: string;
}

export interface CartTotals {
  subtotal: Money;
  serviceFee: Money;
  discountTotal: Money;
  total: Money;
}

export interface CartState {
  /** The QR token this cart belongs to. A cart never survives a change of table. */
  token: string;
  restaurantSlug: string;
  currency: string;
  currencyDecimals: number;
  serviceFeeEnabled: boolean;
  serviceFeeBps: number;
  lines: CartLine[];
  /** Sum of line quantities — the badge on the cart button. */
  itemCount: number;
  /** Advisory preview from src/lib/orders/pricing.ts. NOT authoritative. */
  totals: CartTotals;
  /** Order-level note, max 280 chars. */
  note: string | null;
  /** v4 UUID, generated once per cart, reused on every retry. The idempotency key. */
  clientRequestId: string;
  locale: Locale;
  updatedAt: string;
}

/* ================================================================== */
/* Orders — customer tracking view                                     */
/* ================================================================== */

export interface OrderLineOptionView {
  name: I18nText;
  priceDelta: Money;
  quantity: number;
}

export interface OrderLineView {
  id: string;
  name: I18nText;
  description: I18nText | null;
  imageUrl: string | null;
  /** price_snapshot. */
  unitPrice: Money;
  quantity: number;
  optionsTotal: Money;
  /** Generated by the DB: quantity * (unitPrice + optionsTotal). */
  lineTotal: Money;
  note: string | null;
  spicyLevel: number;
  options: OrderLineOptionView[];
}

export interface OrderStatusEvent {
  status: OrderStatus;
  at: string;
}

export interface OrderView {
  /** Human-friendly, e.g. 'C-014'. */
  orderNumber: string;
  /** The tracking capability. This, never orders.id, appears in a URL. */
  publicCode: string;
  /** '/t/<qrToken>/order/<publicCode>'. */
  trackingPath: string;
  status: OrderStatus;
  /** Position on the forward path, 0..5; -1 for cancelled. Drives the tracker stepper. */
  statusIndex: number;
  isTerminal: boolean;
  orderType: OrderType;
  channel: OrderChannel;
  tableNumber: string | null;
  tableName: string | null;
  currency: string;
  currencyDecimals: number;
  subtotal: Money;
  discountTotal: Money;
  serviceFee: Money;
  total: Money;
  note: string | null;
  guestCount: number | null;
  estimatedPrepMinutes: number;
  dueAt: string | null;
  placedAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  lines: OrderLineView[];
  history: OrderStatusEvent[];
}

/* ================================================================== */
/* KitchenTicket — the KDS card                                        */
/* ================================================================== */

export interface KitchenTicketLine {
  id: string;
  name: I18nText;
  quantity: number;
  note: string | null;
  spicyLevel: number;
  preparationTime: number;
  /** Rendered as a compact second line under the dish name. */
  options: OrderLineOptionView[];
}

export interface KitchenTicket {
  orderId: string;
  orderNumber: string;
  publicCode: string;
  branchId: string;
  tableNumber: string | null;
  tableName: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  placedAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  /** now - placedAt, recomputed client-side on a 1s tick. */
  ageSeconds: number;
  estimatedPrepMinutes: number;
  dueAt: string | null;
  /** ageSeconds > branches.late_order_threshold_minutes * 60. Flags the card red (brief §9). */
  isLate: boolean;
  lateBySeconds: number;
  customerNote: string | null;
  guestCount: number | null;
  lines: KitchenTicketLine[];
  /** Sum of line quantities — the big number on the card. */
  itemCount: number;
}

/* ================================================================== */
/* WaiterCallView                                                      */
/* ================================================================== */

export interface WaiterCallView {
  id: string;
  branchId: string;
  tableId: string;
  tableNumber: string;
  tableName: string | null;
  reason: WaiterCallReason;
  status: WaiterCallStatus;
  /** true for 'pending' and 'acknowledged'. */
  isOpen: boolean;
  note: string | null;
  createdAt: string;
  /** now - createdAt, recomputed on a 1s tick. */
  ageSeconds: number;
  acknowledgedAt: string | null;
  acknowledgedByStaffId: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedByStaffId: string | null;
  /** Set when the guest raised the call from an order-tracking screen. */
  orderId: string | null;
  orderNumber: string | null;
}

/* ================================================================== */
/* DashboardStats — brief §11, real data only                          */
/* ================================================================== */

export interface DashboardTopItem {
  menuItemId: string | null;
  name: I18nText;
  quantitySold: number;
  revenue: Money;
}

export interface DashboardStats {
  /** Scope of every number below. */
  restaurantId: string;
  branchId: string | null;
  /** 'YYYY-MM-DD' in the branch timezone. */
  businessDate: string;
  timezone: string;
  currency: string;
  currencyDecimals: number;
  /** Sum of orders.total for the business date, excluding cancelled. */
  todayRevenue: Money;
  /** Count of orders placed on the business date, excluding cancelled. */
  todayOrderCount: number;
  /** todayRevenue / todayOrderCount, integer division; 0 when no orders. */
  averageOrderValue: Money;
  /** Tables with at least one non-terminal order right now. */
  activeTableCount: number;
  totalTableCount: number;
  pendingOrderCount: number;
  /** Non-terminal orders past their late threshold. */
  lateOrderCount: number;
  openWaiterCallCount: number;
  /** Every OrderStatus key present, zero-filled. */
  ordersByStatus: Readonly<Record<OrderStatus, number>>;
  /** Top 5 by quantitySold on the business date. */
  topItems: DashboardTopItem[];
  cancelledOrderCount: number;
  cancelledRevenue: Money;
  /** True when the scope contains demo tenants; the UI shows a DEMO DATA banner (brief §11). */
  isDemo: boolean;
  generatedAt: string;
}

/* ================================================================== */
/* Staff session — who is looking at an admin screen                   */
/* ================================================================== */

export interface StaffSession {
  profileId: string;
  staffId: string;
  restaurantId: string;
  /** null for RESTAURANT_OWNER and restaurant-wide MANAGER. */
  branchId: string | null;
  role: StaffRole;
  isPlatformAdmin: boolean;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  locale: Locale;
}
```

---

## 5. `src/lib/money.ts`

### 5.1 Why no float ever appears

A `double` has 53 bits of mantissa and a base-2 fraction. `0.1 + 0.2 === 0.30000000000000004` is not
a curiosity, it is the arithmetic. Three concrete failures this design removes:

1. **Totals that do not add up.** `45000.30 * 3` in IEEE-754 is `135000.90000000001`. Written to a
   `NUMERIC` column it rounds; summed across 40 lines it drifts. `ck_orders_totals_arithmetic`
   (`total = subtotal - discount_total + service_fee`) is an exact integer identity in Postgres, and
   a float client would eventually violate it and get a constraint error at checkout — the worst
   possible time.
2. **A price that changes when it round-trips.** `JSON.parse(JSON.stringify(45000.1))` is fine, but
   `Number('45000.10') * 100` is `4500009.999999999`. Any decimal parse followed by a scale
   multiplication is a lossy operation.
3. **Currency-blind code.** `price / 100` is correct for USD and wrong for UZS. Making the scale a
   *carried datum* (`currency_decimals`) rather than a hard-coded `100` makes the bug impossible to
   write.

Therefore:

- `type Money = number` and the number is **always** an integer count of minor units. For UZS
  (`currency_decimals = 0`) one minor unit is one so'm, so `45000` is 45 000 so'm. For USD
  (`decimals = 2`) one minor unit is one cent, so `1250` is $12.50.
- Every arithmetic operation goes through this module. `+`, `*` and especially `/` on a `Money` value
  outside this file is a lint violation (see §5.5).
- `fromMinor` returns a **string**, not a number. Returning `number` would hand a caller a float and
  invite exactly the bug the module exists to prevent. The only reason to leave minor units is to
  display, and display wants a string.
- Division exists in exactly one place — `applyBps` — and it is integer division with an explicit
  half-up rounding term that byte-for-byte matches the Postgres expression.

### 5.2 The module

```ts
// src/lib/money.ts
import { BCP47, type Locale } from '@/types/i18n';

/**
 * An exact integer count of minor currency units.
 * UZS (currency_decimals = 0): 45000 === 45 000 so'm.
 * USD (currency_decimals = 2): 1250  === $12.50.
 * NEVER fractional. NEVER the product of a float expression.
 */
export type Money = number;

/** Beyond this, integer arithmetic in JS stops being exact. BIGINT in Postgres goes further. */
export const MONEY_MAX: Money = Number.MAX_SAFE_INTEGER;

/** Basis-point denominator: 10000 bps = 100.00%. Mirrors public.bps. */
export const BPS_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `value` is a safe, finite, non-negative integer. Use at every trust boundary. */
export function assertMoney(value: unknown, label = 'amount'): asserts value is Money {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer count of minor units, got ${String(value)}`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} must be >= 0, got ${value}`);
  }
  if (value > MONEY_MAX) {
    throw new MoneyError(`${label} exceeds MONEY_MAX (${MONEY_MAX})`);
  }
}

/** Non-throwing predicate, for zod refinements and defensive branches. */
export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MONEY_MAX
  );
}

/**
 * Parse a human-entered major-unit amount into minor units, WITHOUT float arithmetic.
 * The string is split on the decimal separator and the fraction is padded/truncated by
 * string manipulation, so '45000.10' with decimals=2 yields exactly 4500010.
 *
 * Accepts: '45000', '45 000', '45,000.50', '45000,50', 45000, ' -12.5 '.
 * Rejects: anything with more than `decimals` significant fraction digits (a silent
 *          truncation of a price the operator typed is a data-loss bug, not a convenience).
 *
 * @param major   the amount in major units, as typed
 * @param decimals restaurants.currency_decimals (0 for UZS, 2 for USD)
 */
export function toMinor(major: string | number, decimals: number): Money {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
    throw new MoneyError(`decimals must be an integer 0..4, got ${decimals}`);
  }

  // Normalise: strip spaces and NBSP group separators, unify the decimal mark to '.'.
  let raw = String(major).trim().replace(/[\s  ]/g, '');
  if (raw === '') throw new MoneyError('empty amount');

  let sign = 1;
  if (raw.startsWith('-')) { sign = -1; raw = raw.slice(1); }
  else if (raw.startsWith('+')) { raw = raw.slice(1); }

  // '45,000.50' -> '45000.50' ; '45000,50' -> '45000.50'
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    raw = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (lastComma !== -1) {
    raw = raw.replace(',', '.');
  }

  if (!/^\d*(\.\d*)?$/.test(raw) || raw === '.') {
    throw new MoneyError(`not a decimal amount: ${String(major)}`);
  }

  const dot = raw.indexOf('.');
  const wholePart = dot === -1 ? raw : raw.slice(0, dot);
  const fractionPart = dot === -1 ? '' : raw.slice(dot + 1);

  if (fractionPart.replace(/0+$/, '').length > decimals) {
    throw new MoneyError(
      `amount ${String(major)} has more precision than this currency allows (${decimals} decimals)`,
    );
  }

  const digits = (wholePart === '' ? '0' : wholePart) + fractionPart.padEnd(decimals, '0').slice(0, decimals);
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`amount ${String(major)} is out of safe integer range`);
  }
  return sign * minor;
}

/**
 * Render minor units as a plain major-unit STRING with exactly `decimals` fraction digits,
 * no grouping and no currency. String, not number, so the value cannot re-enter float space.
 * Used for form inputs, CSV export and test assertions. For UI, use formatMoney.
 *
 * fromMinor(4500010, 2) === '45000.10'
 * fromMinor(45000, 0)   === '45000'
 */
export function fromMinor(amount: Money, decimals: number): string {
  if (!Number.isInteger(amount)) throw new MoneyError(`amount must be an integer, got ${amount}`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
    throw new MoneyError(`decimals must be an integer 0..4, got ${decimals}`);
  }
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount).toString();
  if (decimals === 0) return sign + digits;
  const padded = digits.padStart(decimals + 1, '0');
  return `${sign}${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Currency labels per locale. Intl's own currency formatting is NOT used because
 * `Intl.NumberFormat('uz-UZ', { style: 'currency', currency: 'UZS' })` renders differently
 * across Node ICU builds and across browsers, and produces 'UZS 45 000' where an Uzbek diner
 * expects "45 000 so'm". Grouping and the decimal mark still come from Intl — those ARE stable
 * and locale-correct — but the currency token is ours.
 */
const CURRENCY_LABELS: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  UZS: { uz: "so'm", ru: 'сўм', en: 'UZS' },
  USD: { uz: '$', ru: '$', en: '$' },
  EUR: { uz: '€', ru: '€', en: '€' },
  RUB: { uz: '₽', ru: '₽', en: '₽' },
};

/** Currencies whose symbol precedes the number — in English only. */
const PREFIX_IN_EN = new Set(['USD', 'EUR']);

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: Locale, decimals: number): Intl.NumberFormat {
  const key = `${locale}|${decimals}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(BCP47[locale], {
    style: 'decimal',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
  formatterCache.set(key, created);
  return created;
}

/**
 * The single money renderer for the whole product.
 *
 * @param amount   minor units
 * @param currency ISO-4217 from restaurants.currency / orders.currency
 * @param decimals restaurants.currency_decimals / orders.currency_decimals
 * @param locale   the UI locale
 *
 * formatMoney(45000,   'UZS', 0, 'uz') === "45 000 so'm"
 * formatMoney(45000,   'UZS', 0, 'ru') === '45 000 сўм'
 * formatMoney(45000,   'UZS', 0, 'en') === '45,000 UZS'
 * formatMoney(1250,    'USD', 2, 'en') === '$12.50'
 * formatMoney(1250,    'USD', 2, 'ru') === '12,50 $'
 * formatMoney(1250,    'USD', 2, 'uz') === '12,50 $'
 */
export function formatMoney(
  amount: Money,
  currency: string,
  decimals: number,
  locale: Locale,
): string {
  if (!Number.isInteger(amount)) throw new MoneyError(`amount must be an integer, got ${amount}`);
  const major = amount / 10 ** decimals; // presentation only; never fed back into arithmetic
  const digits = numberFormatter(locale, decimals).format(major);

  const code = currency.toUpperCase();
  const label = CURRENCY_LABELS[code]?.[locale] ?? code;
  const prefix = locale === 'en' && PREFIX_IN_EN.has(code);

  // U+00A0 NO-BREAK SPACE: the amount and its currency must never wrap apart.
  return prefix ? `${label}${digits}` : `${digits} ${label}`;
}

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

/** Exact integer sum. Throws before it can silently exceed MONEY_MAX. */
export function sumMoney(amounts: readonly Money[]): Money {
  let total = 0;
  for (const amount of amounts) {
    assertMoney(amount, 'summand');
    total += amount;
    if (total > MONEY_MAX) throw new MoneyError('sum exceeds MONEY_MAX');
  }
  return total;
}

/** Exact integer scaling by a whole quantity. `qty` must be a non-negative integer. */
export function multiplyMoney(amount: Money, qty: number): Money {
  assertMoney(amount, 'amount');
  if (!Number.isInteger(qty) || qty < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got ${qty}`);
  }
  const product = amount * qty;
  if (!Number.isSafeInteger(product) || product > MONEY_MAX) {
    throw new MoneyError('product exceeds MONEY_MAX');
  }
  return product;
}

/**
 * Apply a basis-point rate with half-up rounding, in integers only.
 *
 * This mirrors the Postgres expression in staff_void_order_item() and public_place_order()
 * BYTE FOR BYTE:  (v_sub * v_bps + 5000) / 10000  with SQL integer division.
 * Any divergence here would let the cart preview disagree with the receipt.
 *
 * applyBps(45000, 1000) === 4500      // 10.00%
 * applyBps(45005, 1000) === 4501      // 4500.5 rounds half-up to 4501
 */
export function applyBps(base: Money, bps: number): Money {
  assertMoney(base, 'base');
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new MoneyError(`bps must be an integer 0..${BPS_DENOMINATOR}, got ${bps}`);
  }
  if (bps === 0) return 0;
  const scaled = base * bps;
  if (!Number.isSafeInteger(scaled)) throw new MoneyError('bps product exceeds safe integer range');
  return Math.floor((scaled + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

/** Signed difference, for "you saved X" and admin deltas. May be negative; not a stored Money. */
export function subtractMoney(a: Money, b: Money): number {
  assertMoney(a, 'minuend');
  assertMoney(b, 'subtrahend');
  return a - b;
}
```

### 5.3 How formatting differs, precisely

| Case | `uz-UZ` | `ru-RU` | `en-US` |
|---|---|---|---|
| Group separator (from Intl) | ` ` (NBSP) | ` ` (NBSP) | `,` |
| Decimal separator (from Intl) | `,` | `,` | `.` |
| Currency token position | suffix | suffix | prefix for USD/EUR, suffix otherwise |
| `45000` UZS, decimals 0 | `45 000 so'm` | `45 000 сўм` | `45,000 UZS` |
| `1250` USD, decimals 2 | `12,50 $` | `12,50 $` | `$12.50` |
| `0` UZS, decimals 0 | `0 so'm` | `0 сўм` | `0 UZS` |

Two consequences implementers must honour:

- **Never assert on a literal ASCII space in a money test.** Intl emits U+00A0 for `uz-UZ`/`ru-RU`
  grouping and this module emits U+00A0 before the currency token. Tests compare against
  `'45 000 so’m'`-shaped literals or normalise whitespace explicitly.
- **The decimals argument is data, never a constant.** It comes from `restaurants.currency_decimals`
  for live prices and from `orders.currency_decimals` for historical receipts, which is why the
  order row freezes its own copy: a restaurant that switches UZS→USD next year must not re-render
  last year's receipts at 1/100th of their value.

### 5.4 Where the fee is computed

```ts
// src/lib/orders/pricing.ts
import { applyBps, sumMoney, multiplyMoney, type Money } from '@/lib/money';
import type { CartLine, CartTotals } from '@/types/domain';

export interface FeeConfig {
  /** restaurants.service_fee_enabled */
  enabled: boolean;
  /** branches.service_fee_bps ?? restaurants.service_fee_bps */
  bps: number;
}

/**
 * ADVISORY. Renders the cart preview so the customer is not surprised at checkout.
 * The order's real totals are whatever public_place_order() returns, computed from
 * menu_items.price read inside the transaction. Brief §7: never trust prices from the frontend.
 */
export function priceCart(lines: readonly CartLine[], fee: FeeConfig): CartTotals {
  const subtotal = sumMoney(
    lines.map((line) => multiplyMoney(line.unitPrice + line.optionsTotal, line.quantity)),
  );
  const serviceFee = fee.enabled ? applyBps(subtotal, fee.bps) : 0;
  const discountTotal = 0; // MVP: promotions are display-only (doc 02 §2.6).
  return { subtotal, serviceFee, discountTotal, total: subtotal - discountTotal + serviceFee };
}
```

### 5.5 Enforcement

Add to `eslint.config.mjs`:

```js
{
  files: ['src/**/*.{ts,tsx}'],
  ignores: ['src/lib/money.ts', 'src/lib/orders/pricing.ts'],
  rules: {
    'no-restricted-syntax': ['error',
      {
        selector: "CallExpression[callee.object.name='Math'][callee.property.name='round']",
        message: 'Money rounding belongs in src/lib/money.ts (applyBps). Import it.',
      },
      {
        selector: "CallExpression[callee.property.name='toFixed']",
        message: 'toFixed() is float formatting. Use formatMoney() or fromMinor().',
      },
      {
        selector: "CallExpression[callee.name='parseFloat']",
        message: 'parseFloat introduces float money. Use toMinor().',
      },
    ],
  },
}
```

---

## 6. `src/lib/orders/state-machine.ts`

### 6.1 Postgres is authoritative — stated plainly

There are three copies of this state machine and they are not equals.

| Copy | Location | Role |
|---|---|---|
| Structural envelope | `public.is_valid_order_transition(from, to)` — enforced by `ck_order_status_history_transition_legal` on every `order_status_history` row | **Authoritative.** Defines which edges exist at all. A transition that violates it cannot be committed by any client, any admin, any future service, or a `psql` session. |
| Actor matrix | `public.order_transition_allowed(from, to, actor)` — called by `trg_orders_guard()` | **Authoritative.** Defines which role may traverse which edge. Violations raise `QR040_INVALID_STATUS_TRANSITION` (HTTP 409). |
| TypeScript mirror | `src/lib/orders/state-machine.ts` | **Advisory.** Decides which buttons render and produces a fast localised refusal. It can be bypassed; the two above cannot. |

An illegal transition that reaches Postgres is a bug in this layer, and Postgres turns it into
`QR040` rather than corrupt data. The correct reaction to a `QR040` in production is to fix the TS
mirror, never to loosen the database.

The intersection resolved in §1.3 is what both authoritative copies must express. The DB agent
rewrites `order_transition_allowed` so its cancellation branch reads:

```sql
    when p_to = 'cancelled' then
      case p_actor
        when 'SUPER_ADMIN'      then p_from in ('pending','confirmed','preparing','ready')
        when 'RESTAURANT_OWNER' then p_from in ('pending','confirmed','preparing','ready')
        when 'MANAGER'          then p_from in ('pending','confirmed','preparing','ready')
        when 'WAITER'           then p_from in ('pending','confirmed')
        else false                       -- KITCHEN may never cancel
      end
```

with the forward path relabelled to the doc-01 `app_role` labels (§1.1).

### 6.2 The graph

```
pending ──▶ confirmed ──▶ preparing ──▶ ready ──▶ delivered ──▶ completed
   │            │             │           │
   └────────────┴─────────────┴───────────┘──▶ cancelled

completed ──▶ (nothing)          cancelled ──▶ (nothing)
delivered ──▶ completed ONLY     (delivered ──▶ cancelled is a refund; not modelled — §1.3)
```

**Terminal states:** `completed`, `cancelled`. Zero outgoing edges for every actor including
`SUPER_ADMIN` and `SYSTEM`. `completed -> preparing` and `cancelled -> ready` are rejected — brief
§26, §34.8.

**Cancellation rules, explicit:**

| Actor | May cancel from | May not cancel from | Why |
|---|---|---|---|
| `CUSTOMER` | `pending` | everything else | Once the kitchen has accepted the order, food and labour are committed. Reachable only via `public_cancel_order` (§1.4). |
| `WAITER` | `pending`, `confirmed` | `preparing`, `ready`, `delivered` | A waiter may unwind a mis-entry; once the kitchen has started, cancelling is a manager decision with a stock consequence. |
| `KITCHEN` | — never | all | The kitchen marks readiness, it does not void revenue. It refuses an order by asking a manager. |
| `MANAGER` | `pending`, `confirmed`, `preparing`, `ready` | `delivered` | Full front-of-house authority up to the pass. |
| `RESTAURANT_OWNER` | `pending`, `confirmed`, `preparing`, `ready` | `delivered` | Same envelope as MANAGER after the §1.3 intersection. |
| `SUPER_ADMIN` | `pending`, `confirmed`, `preparing`, `ready` | `delivered` | Platform support cannot invent a refund path either. |
| `SYSTEM` | `pending` | everything else | The abandoned-order sweeper closes carts nobody confirmed. It never touches an order a human has acted on. |

`SYSTEM` additionally owns `delivered -> completed` (the end-of-shift auto-close) and
`pending -> confirmed` (branch auto-accept, when a branch enables it). Both write
`order_status_history` with `changed_by_kind = 'system'`, `changed_by = NULL`,
`changed_by_role = NULL`.

`CUSTOMER` and `SYSTEM` are **not** `app_role` values, so `order_transition_allowed` cannot express
them. Their transitions run inside `SECURITY DEFINER` functions (`public_cancel_order`, the cron
sweeper) which enforce the rows above in their own bodies and are still bounded by
`is_valid_order_transition`.

### 6.3 The module

```ts
// src/lib/orders/state-machine.ts
import type { AppRole, OrderStatus } from '@/types/database';
import { AppErrorException } from '@/lib/result';

/**
 * Everyone who can move an order. AppRole covers staff; CUSTOMER is the anonymous guest
 * (no auth.users row, actor_kind='customer'); SYSTEM is a trigger or cron job
 * (actor_kind='system').
 */
export type ActorRole = AppRole | 'CUSTOMER' | 'SYSTEM';

export const ACTOR_ROLES = [
  'SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN', 'CUSTOMER', 'SYSTEM',
] as const satisfies readonly ActorRole[];

/** Display order and stepper order. Cancelled is off-path. */
export const ORDER_FORWARD_PATH = [
  'pending', 'confirmed', 'preparing', 'ready', 'delivered', 'completed',
] as const satisfies readonly OrderStatus[];

export const TERMINAL_ORDER_STATUSES = ['completed', 'cancelled'] as const
  satisfies readonly OrderStatus[];

/**
 * STRUCTURAL ENVELOPE — mirrors public.is_valid_order_transition(from, to) exactly.
 * Which edges exist at all, independent of who is asking.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready:     ['delivered', 'cancelled'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
} as const;

export type TransitionKey = `${OrderStatus}->${OrderStatus}`;

export function transitionKey(from: OrderStatus, to: OrderStatus): TransitionKey {
  return `${from}->${to}`;
}

/**
 * ACTOR MATRIX — mirrors public.order_transition_allowed(from, to, actor) after the §1.3
 * intersection, extended with CUSTOMER and SYSTEM (which the SQL function cannot type).
 * Every key of ORDER_TRANSITIONS appears here exactly once; the completeness test in
 * src/lib/orders/state-machine.test.ts asserts that.
 */
export const ORDER_TRANSITION_ACTORS: Readonly<Record<TransitionKey, readonly ActorRole[]>> = {
  // --- forward path ------------------------------------------------------
  'pending->confirmed':   ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN', 'SYSTEM'],
  'confirmed->preparing': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN'],
  'preparing->ready':     ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN'],
  'ready->delivered':     ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  'delivered->completed': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'SYSTEM'],
  // --- cancellation ------------------------------------------------------
  'pending->cancelled':   ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'CUSTOMER', 'SYSTEM'],
  'confirmed->cancelled': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  'preparing->cancelled': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'ready->cancelled':     ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
} as const;

/** completed and cancelled are absorbing. Nothing leaves them, for anyone. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** Position on the forward path; -1 for cancelled. Drives the tracker stepper. */
export function statusIndex(status: OrderStatus): number {
  const index = (ORDER_FORWARD_PATH as readonly OrderStatus[]).indexOf(status);
  return index;
}

/** Structural check only — ignores the actor. Mirrors is_valid_order_transition. */
export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ORDER_TRANSITIONS[from].includes(to);
}

/** The roles permitted to traverse this edge; empty for a non-existent edge. */
export function actorsFor(from: OrderStatus, to: OrderStatus): readonly ActorRole[] {
  return ORDER_TRANSITION_ACTORS[transitionKey(from, to)] ?? [];
}

/** The full check: does this edge exist, and may this actor traverse it? */
export function canTransition(from: OrderStatus, to: OrderStatus, role: ActorRole): boolean {
  if (!isValidTransition(from, to)) return false;
  return actorsFor(from, to).includes(role);
}

/**
 * The statuses this actor may move the order to right now.
 * This is what renders the KDS and waiter action buttons — a button that would produce a
 * QR040 must never appear.
 */
export function nextStatuses(status: OrderStatus, role: ActorRole): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[status].filter((to) => actorsFor(status, to).includes(role));
}

/** True when `to` is a cancellation and therefore requires a reason (ck_orders_cancelled_shape). */
export function requiresCancellationReason(to: OrderStatus): boolean {
  return to === 'cancelled';
}

/**
 * Throws AppErrorException with code INVALID_TRANSITION (or FORBIDDEN when the edge exists
 * but this actor may not use it) unless the transition is legal.
 * Services call this before every status write; src/lib/result.ts#toResult converts the throw
 * into Result<never>.
 */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: ActorRole,
): void {
  if (!isValidTransition(from, to)) {
    throw new AppErrorException({
      code: 'INVALID_TRANSITION',
      wire: 'QR040_INVALID_STATUS_TRANSITION',
      httpStatus: 409,
      message: `Illegal order transition ${from} -> ${to}`,
      details: { from, to, actor: role },
      retryable: false,
    });
  }
  if (!actorsFor(from, to).includes(role)) {
    throw new AppErrorException({
      code: 'FORBIDDEN',
      wire: 'QR050_FORBIDDEN',
      httpStatus: 403,
      message: `${role} may not perform ${from} -> ${to}`,
      details: { from, to, actor: role, allowed: [...actorsFor(from, to)] },
      retryable: false,
    });
  }
}
```

### 6.4 Required tests (`src/lib/orders/state-machine.test.ts`)

1. Every key of `ORDER_TRANSITION_ACTORS` corresponds to an edge in `ORDER_TRANSITIONS`, and every
   edge in `ORDER_TRANSITIONS` has a key. No orphans in either direction.
2. `canTransition('completed', s, r)` is `false` for every `s` and every `r` in `ACTOR_ROLES`.
   Same for `'cancelled'`.
3. `canTransition('completed', 'preparing', 'SUPER_ADMIN') === false` and
   `canTransition('cancelled', 'ready', 'SUPER_ADMIN') === false` — the two cases the brief names.
4. `canTransition(f, 'cancelled', 'KITCHEN') === false` for every `f`.
5. `canTransition('delivered', 'cancelled', r) === false` for every `r` (the §1.3 intersection).
6. A pgTAP counterpart in `supabase/tests/state_machine.sql` asserts that, for the 7×7×5 cross
   product, `public.order_transition_allowed(f, t, r)` agrees with a literal table identical to
   `ORDER_TRANSITION_ACTORS` restricted to `AppRole`. The two files are reviewed together; changing
   one without the other fails CI.

---

## 7. `src/lib/validation/*.ts` — zod v4 schemas

Rules that apply to every schema below:

- `z.strictObject` everywhere. An unknown key is an attack or a bug; either way it is a 422.
- Text is `.trim()`ed before length checks, and every max length is the DB `CHECK` minus nothing —
  identical numbers, so a value that passes zod cannot fail the constraint.
- No schema accepts a `price`, `subtotal`, `service_fee` or `total` from a customer. Money appears
  in admin schemas only, where the actor is an authenticated manager or owner.
- Output types are exported as `z.infer<...>` and are what Server Actions accept.

### 7.1 `src/lib/validation/common.ts`

```ts
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
```

### 7.2 `src/lib/validation/order.ts`

```ts
// src/lib/validation/order.ts
import { z } from 'zod';
import {
  anyUuidSchema, optionalNoteSchema, orderStatusSchema, publicCodeSchema,
  qrTokenSchema, uuidSchema,
} from '@/lib/validation/common';
import { ACTOR_ROLES } from '@/lib/orders/state-machine';

/**
 * One line of a cart, as it crosses the wire to public_place_order.
 * THERE IS NO PRICE FIELD. Brief §34.2: prices are always server-calculated.
 * `option_ids` are ids only — the server reads price_delta from menu_item_options.
 */
export const cartLineSchema = z.strictObject({
  menu_item_id: uuidSchema,
  quantity: z.number().int().min(1).max(50),
  option_ids: z.array(uuidSchema).max(20).default([]),
  note: optionalNoteSchema(140),
}).refine(
  (line) => new Set(line.option_ids).size === line.option_ids.length,
  { error: 'errors.validation.duplicate_option', path: ['option_ids'] },
);
export type CartLineInput = z.infer<typeof cartLineSchema>;

/**
 * The full PLACE ORDER payload. Matches public_place_order(p_token, p_items, p_note,
 * p_client_request_id) argument for argument.
 * Caps mirror the SQL: 1..40 lines, note ≤ 280.
 */
export const placeOrderSchema = z.strictObject({
  token: qrTokenSchema,
  items: z.array(cartLineSchema).min(1).max(40),
  note: optionalNoteSchema(280),
  /** v4 UUID, one per cart, reused on retry. Makes a double submit idempotent. */
  client_request_id: anyUuidSchema,
  /** Frozen onto the order so the kitchen ticket prints in the language the guest ordered in. */
  locale: z.enum(['uz', 'ru', 'en']),
  guest_count: z.number().int().min(1).max(100).nullish().transform((v) => v ?? null),
}).refine(
  (payload) => payload.items.reduce((sum, line) => sum + line.quantity, 0) <= 200,
  { error: 'errors.validation.too_many_units', path: ['items'] },
);
export type PlaceOrderInput = z.infer<typeof placeOrderSchema>;

/** Customer withdrawing a pending order (public_cancel_order, §1.4). */
export const cancelOrderSchema = z.strictObject({
  token: qrTokenSchema,
  public_code: publicCodeSchema,
  reason: optionalNoteSchema(300).transform((r) => r ?? 'customer_cancelled'),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

/**
 * A staff status change. The legality of (from -> to) for `actor` is checked by
 * assertTransition() BEFORE this payload is sent, and again by trg_orders_guard() after.
 * `expected_status` is an optimistic-concurrency guard: two waiters tapping READY on the same
 * ticket must not both succeed silently.
 */
export const statusUpdateSchema = z.strictObject({
  order_id: uuidSchema,
  expected_status: orderStatusSchema,
  next_status: orderStatusSchema,
  actor: z.enum(ACTOR_ROLES),
  cancellation_reason: optionalNoteSchema(300),
}).refine(
  (payload) => payload.expected_status !== payload.next_status,
  { error: 'errors.validation.same_status', path: ['next_status'] },
).refine(
  (payload) => payload.next_status !== 'cancelled' || payload.cancellation_reason !== null,
  { error: 'errors.app.VALIDATION_FAILED', path: ['cancellation_reason'] },
);
export type StatusUpdateInput = z.infer<typeof statusUpdateSchema>;
```

### 7.3 `src/lib/validation/menu.ts`

```ts
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
```

### 7.4 `src/lib/validation/tenancy.ts`

```ts
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
  opening_hours: z.record(
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
```

### 7.5 `src/lib/validation/waiter.ts`

```ts
// src/lib/validation/waiter.ts
import { z } from 'zod';
import {
  optionalNoteSchema, qrTokenSchema, uuidSchema, waiterCallReasonSchema,
} from '@/lib/validation/common';

/**
 * CALL WAITER, from the customer app. Matches public_call_waiter(p_token, p_reason).
 * The cooldown is enforced in Postgres (branches.waiter_call_cooldown_seconds); this schema
 * only guarantees the reason is one of the seven enum labels.
 */
export const waiterCallSchema = z.strictObject({
  token: qrTokenSchema,
  reason: waiterCallReasonSchema.default('call_waiter'),
  note: optionalNoteSchema(200),
});
export type WaiterCallInput = z.infer<typeof waiterCallSchema>;

/**
 * A waiter acknowledging or resolving a call. `cancelled` is a customer action; `expired` is a
 * system action; neither is reachable from this schema.
 */
export const waiterCallUpdateSchema = z.strictObject({
  waiter_call_id: uuidSchema,
  next_status: z.enum(['acknowledged', 'resolved']),
});
export type WaiterCallUpdateInput = z.infer<typeof waiterCallUpdateSchema>;
```

---

## 8. `Result<T>`, `AppError` and the error vocabulary

### 8.1 Two vocabularies, one mapping

There are two sets of codes and conflating them is the mistake to avoid.

- **Wire codes** (`QrErrorCode`) are what Postgres raises: `QR020_ITEM_UNAVAILABLE`, `QR040_…`.
  They are precise, numerous, and defined in doc 02 §10. They belong in logs and in
  `src/lib/security/errors.ts`.
- **App codes** (`AppErrorCode`) are what the UI switches on: 12 of them, one per *distinct thing a
  user must be told*. A component never sees `QR002` vs `QR003` vs `QR004`; it sees
  `TABLE_INACTIVE` and renders one screen.

`AppError` carries both. `code` drives UI branching; `wire` drives support diagnosis.

### 8.2 `src/types/result.ts`

```ts
// src/types/result.ts
import type { QrErrorCode } from '@/lib/security/errors';

/** The 12 failures the product distinguishes. Brief §32 requires a screen for each. */
export type AppErrorCode =
  | 'TABLE_INACTIVE'
  | 'INVALID_QR'
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'PRICE_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'NETWORK'
  | 'UNKNOWN';

export interface AppError {
  /** What the UI branches on. */
  code: AppErrorCode;
  /** The originating Postgres code, when there was one. For logs and support, never for UI text. */
  wire?: QrErrorCode;
  /** HTTP status a route handler should return. */
  httpStatus: number;
  /** Developer-facing English. NEVER rendered to a user. */
  message: string;
  /** Structured context: { field, menu_item_id, retry_after_seconds, from, to, actor, … }. */
  details?: Readonly<Record<string, unknown>>;
  /** True when repeating the same request may succeed (NETWORK, RATE_LIMITED after the wait). */
  retryable: boolean;
  /** Present on RATE_LIMITED; drives the countdown instead of an error toast. */
  retryAfterSeconds?: number;
  /** Correlation id echoed into the server log line. */
  traceId?: string;
}

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: AppError };

/** The service-layer return type. Every service function returns this. Nothing throws past it. */
export type Result<T> = Ok<T> | Err;
```

### 8.3 `src/lib/result.ts`

```ts
// src/lib/result.ts
import type { AppError, AppErrorCode, Err, Ok, Result } from '@/types/result';

export type { AppError, AppErrorCode, Result } from '@/types/result';

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(error: AppError): Err {
  return { ok: false, error };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function isErr<T>(result: Result<T>): result is Err {
  return !result.ok;
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export function mapResult<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  return result.ok ? ok(fn(result.data)) : result;
}

/** Default HTTP status per app code, used when a construction site does not specify one. */
const DEFAULT_STATUS: Readonly<Record<AppErrorCode, number>> = {
  TABLE_INACTIVE: 423,
  INVALID_QR: 404,
  RESTAURANT_CLOSED: 423,
  ITEM_UNAVAILABLE: 409,
  PRICE_MISMATCH: 409,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  NETWORK: 503,
  UNKNOWN: 500,
};

const RETRYABLE: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'NETWORK', 'RATE_LIMITED', 'UNKNOWN',
]);

/** Build an AppError with sane defaults. Prefer this over an object literal. */
export function appError(
  code: AppErrorCode,
  message: string,
  extra: Partial<Omit<AppError, 'code' | 'message'>> = {},
): AppError {
  return {
    code,
    message,
    httpStatus: extra.httpStatus ?? DEFAULT_STATUS[code],
    retryable: extra.retryable ?? RETRYABLE.has(code),
    ...extra,
  };
}

/**
 * The only exception type this codebase throws deliberately. It exists so that deep helpers
 * (assertTransition, assertMoney callers) can refuse without threading Result through every frame.
 * Every service boundary catches it via toResult().
 */
export class AppErrorException extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'AppErrorException';
    this.error = error;
  }
}

/**
 * The service-layer edge. Runs `fn`, converts AppErrorException into Err, and converts anything
 * else into UNKNOWN without leaking its message to the client.
 */
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return err(thrown.error);
    if (thrown instanceof TypeError && /fetch|network/i.test(thrown.message)) {
      return err(appError('NETWORK', thrown.message));
    }
    return err(appError('UNKNOWN', thrown instanceof Error ? thrown.message : String(thrown)));
  }
}
```

### 8.4 `src/lib/security/errors.ts` — wire → app mapping and message keys

```ts
// src/lib/security/errors.ts
import type { PostgrestError } from '@supabase/supabase-js';
import { appError } from '@/lib/result';
import type { AppError, AppErrorCode } from '@/types/result';

/** The doc-02 §10 catalogue, verbatim. */
export type QrErrorCode =
  | 'QR001_INVALID_QR_TOKEN'
  | 'QR002_TABLE_INACTIVE'
  | 'QR003_BRANCH_INACTIVE'
  | 'QR004_RESTAURANT_INACTIVE'
  | 'QR010_ORDER_RATE_LIMITED'
  | 'QR011_WAITER_CALL_COOLDOWN'
  | 'QR012_WAITER_CALL_ALREADY_OPEN'
  | 'QR013_DUPLICATE_ORDER'
  | 'QR020_ITEM_UNAVAILABLE'
  | 'QR022_INVALID_OPTION'
  | 'QR023_INVALID_PAYLOAD'
  | 'QR024_QUANTITY_OUT_OF_RANGE'
  | 'QR030_ORDER_NOT_FOUND'
  | 'QR030_NOT_FOUND'
  | 'QR032_ORDER_EXPIRED'
  | 'QR040_INVALID_STATUS_TRANSITION'
  | 'QR041_INVALID_CALL_TRANSITION'
  | 'QR042_CANCEL_REASON_REQUIRED'
  | 'QR043_ORDER_CLOSED'
  | 'QR050_FORBIDDEN'
  | 'QR051_LAST_OWNER'
  | 'QR052_FORBIDDEN_FIELD'
  | 'QR053_IMMUTABLE_COLUMN'
  | 'QR054_COLUMN_NOT_ALLOWED'
  | 'QR055_PRIVILEGE_ESCALATION'
  | 'QR056_SELF_MODIFICATION'
  | 'QR999_INTERNAL';

/**
 * Wire code -> app code. Exhaustive: adding a QrErrorCode without a row here fails to compile.
 *
 * Note the deliberate collapses:
 *  - QR002/QR003/QR004 all become TABLE_INACTIVE... except QR004, which becomes
 *    RESTAURANT_CLOSED, because the customer copy differs ("this table is out of service" vs
 *    "this restaurant is not accepting orders").
 *  - QR010/QR011 both become RATE_LIMITED; the UI reads retryAfterSeconds, not the code.
 *  - QR013 is NOT an error path in the UI: the caller navigates to the returned order. It maps to
 *    UNKNOWN only if it somehow escapes that handling.
 */
export const QR_TO_APP_ERROR: Readonly<Record<QrErrorCode, AppErrorCode>> = {
  QR001_INVALID_QR_TOKEN: 'INVALID_QR',
  QR002_TABLE_INACTIVE: 'TABLE_INACTIVE',
  QR003_BRANCH_INACTIVE: 'RESTAURANT_CLOSED',
  QR004_RESTAURANT_INACTIVE: 'RESTAURANT_CLOSED',
  QR010_ORDER_RATE_LIMITED: 'RATE_LIMITED',
  QR011_WAITER_CALL_COOLDOWN: 'RATE_LIMITED',
  QR012_WAITER_CALL_ALREADY_OPEN: 'RATE_LIMITED',
  QR013_DUPLICATE_ORDER: 'UNKNOWN',
  QR020_ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  QR022_INVALID_OPTION: 'ITEM_UNAVAILABLE',
  QR023_INVALID_PAYLOAD: 'VALIDATION_FAILED',
  QR024_QUANTITY_OUT_OF_RANGE: 'VALIDATION_FAILED',
  QR030_ORDER_NOT_FOUND: 'NOT_FOUND',
  QR030_NOT_FOUND: 'NOT_FOUND',
  QR032_ORDER_EXPIRED: 'NOT_FOUND',
  QR040_INVALID_STATUS_TRANSITION: 'INVALID_TRANSITION',
  QR041_INVALID_CALL_TRANSITION: 'INVALID_TRANSITION',
  QR042_CANCEL_REASON_REQUIRED: 'VALIDATION_FAILED',
  QR043_ORDER_CLOSED: 'INVALID_TRANSITION',
  QR050_FORBIDDEN: 'FORBIDDEN',
  QR051_LAST_OWNER: 'FORBIDDEN',
  QR052_FORBIDDEN_FIELD: 'FORBIDDEN',
  QR053_IMMUTABLE_COLUMN: 'FORBIDDEN',
  QR054_COLUMN_NOT_ALLOWED: 'FORBIDDEN',
  QR055_PRIVILEGE_ESCALATION: 'FORBIDDEN',
  QR056_SELF_MODIFICATION: 'FORBIDDEN',
  QR999_INTERNAL: 'UNKNOWN',
};

const HTTP_BY_WIRE: Readonly<Partial<Record<QrErrorCode, number>>> = {
  QR002_TABLE_INACTIVE: 423,
  QR003_BRANCH_INACTIVE: 423,
  QR004_RESTAURANT_INACTIVE: 423,
  QR032_ORDER_EXPIRED: 410,
};

function isQrErrorCode(value: string): value is QrErrorCode {
  return Object.hasOwn(QR_TO_APP_ERROR, value);
}

/**
 * Convert a PostgrestError into an AppError.
 * Doc 02 §10: our errors carry hint === 'RESTAURANT_QR_OS', message === the machine code, and
 * detail === a JSON object. Anything else is an unexpected database failure and becomes UNKNOWN
 * with its text kept server-side only.
 */
export function mapPgError(e: PostgrestError): AppError {
  if (e.hint !== 'RESTAURANT_QR_OS' || !isQrErrorCode(e.message)) {
    return appError('UNKNOWN', `unmapped postgres error: ${e.code} ${e.message}`, {
      wire: 'QR999_INTERNAL',
    });
  }

  const wire = e.message;
  const code = QR_TO_APP_ERROR[wire];

  let details: Record<string, unknown> | undefined;
  try {
    details = e.details ? (JSON.parse(e.details) as Record<string, unknown>) : undefined;
  } catch {
    details = undefined;
  }

  const retryAfter = typeof details?.retry_after_seconds === 'number'
    ? details.retry_after_seconds
    : undefined;

  return appError(code, wire, {
    wire,
    httpStatus: HTTP_BY_WIRE[wire],
    details,
    retryAfterSeconds: retryAfter,
    retryable: code === 'RATE_LIMITED' || code === 'NETWORK',
  });
}

/**
 * The i18n key for the user-visible message.
 * Prefers the specific wire message (so a guest is told "this dish just ran out" rather than the
 * generic "something is unavailable"), and falls back to the app-code message, which is
 * guaranteed to exist in all three message files.
 */
export function messageKeyFor(error: AppError): string {
  return error.wire ? `errors.${error.wire}` : `errors.app.${error.code}`;
}

/** Every app code's fallback key. The i18n completeness test asserts all 12 exist in uz/ru/en. */
export const APP_ERROR_MESSAGE_KEYS: Readonly<Record<AppErrorCode, string>> = {
  TABLE_INACTIVE: 'errors.app.TABLE_INACTIVE',
  INVALID_QR: 'errors.app.INVALID_QR',
  RESTAURANT_CLOSED: 'errors.app.RESTAURANT_CLOSED',
  ITEM_UNAVAILABLE: 'errors.app.ITEM_UNAVAILABLE',
  PRICE_MISMATCH: 'errors.app.PRICE_MISMATCH',
  INVALID_TRANSITION: 'errors.app.INVALID_TRANSITION',
  RATE_LIMITED: 'errors.app.RATE_LIMITED',
  FORBIDDEN: 'errors.app.FORBIDDEN',
  NOT_FOUND: 'errors.app.NOT_FOUND',
  VALIDATION_FAILED: 'errors.app.VALIDATION_FAILED',
  NETWORK: 'errors.app.NETWORK',
  UNKNOWN: 'errors.app.UNKNOWN',
};
```

### 8.5 The message keys, and what each screen does

| `AppErrorCode` | Message key | Wire codes that map here | UI response (brief §32) |
|---|---|---|---|
| `INVALID_QR` | `errors.app.INVALID_QR` | `QR001` | Full-page "This QR code is not valid" with no retry — retrying cannot help. |
| `TABLE_INACTIVE` | `errors.app.TABLE_INACTIVE` | `QR002` | Full-page "This table is out of service. Please ask a member of staff." |
| `RESTAURANT_CLOSED` | `errors.app.RESTAURANT_CLOSED` | `QR003`, `QR004` | Full-page closed state with the branch name and opening hours when known. |
| `ITEM_UNAVAILABLE` | `errors.app.ITEM_UNAVAILABLE` | `QR020`, `QR022` | Inline on the cart: the offending line (from `details.menu_item_id`) is highlighted and removed on confirm; the rest of the cart survives. |
| `PRICE_MISMATCH` | `errors.app.PRICE_MISMATCH` | — (client-side only) | Raised by the cart when the advisory preview disagrees with the RPC result by more than zero. Re-renders the cart from the server figures and asks the guest to confirm. Never blocks; never trusts the client number. |
| `INVALID_TRANSITION` | `errors.app.INVALID_TRANSITION` | `QR040`, `QR041`, `QR043` | Staff panels: toast + immediate refetch of the ticket. Someone else moved it first. |
| `RATE_LIMITED` | `errors.app.RATE_LIMITED` | `QR010`, `QR011`, `QR012` | Countdown from `retryAfterSeconds` on the disabled button. Not a toast. |
| `FORBIDDEN` | `errors.app.FORBIDDEN` | `QR050`–`QR056` | Staff panels: the action is hidden, not merely disabled, on the next render. |
| `NOT_FOUND` | `errors.app.NOT_FOUND` | `QR030` (both), `QR032` | Tracking page: "We can't find this order any more." Admin: empty state. |
| `VALIDATION_FAILED` | `errors.app.VALIDATION_FAILED` | `QR023`, `QR024`, plus every zod failure | Field-level message under the input named by `details.field`. |
| `NETWORK` | `errors.app.NETWORK` | — (fetch failure) | Offline banner + a retry button. The cart is preserved in `localStorage`. |
| `UNKNOWN` | `errors.app.UNKNOWN` | `QR013`, `QR999`, anything unmapped | Generic error card with a retry and the `traceId` in small type. |

`PRICE_MISMATCH` has no wire code by design: the server never disagrees with itself. It exists so
the *client* can detect that its advisory preview drifted (a stale menu, a price edited while the
guest browsed) and re-render honestly instead of showing a number the receipt will contradict.

Every key in the second column must exist in `messages/uz.json`, `messages/ru.json` and
`messages/en.json`, alongside `errors.<QrErrorCode>` for all 27 wire codes. A missing key fails
`src/lib/i18n/messages.test.ts`.

---

## 9. The service-layer boundary

### 9.1 The four callers and what each may reach

```
┌──────────────────────────────────────────────────────────────────────┐
│ BROWSER (client components)                                          │
│   may import: @/types/*, @/lib/money, @/lib/i18n/*, @/lib/utils/*,   │
│               @/lib/orders/state-machine, @/lib/orders/pricing,      │
│               @/lib/cart/*, @/lib/realtime/*, @/lib/supabase/browser │
│   may call:   Server Actions. Realtime subscribe. NOTHING else.      │
│   may NOT:    import @/lib/services/*, @/lib/rpc/*, @/lib/supabase/  │
│               {server,admin,public-client}, or read any env var      │
│               other than NEXT_PUBLIC_*.                              │
├──────────────────────────────────────────────────────────────────────┤
│ SERVER COMPONENT (async RSC)                                         │
│   may call:   @/lib/rpc/public.ts (read fns), @/lib/services/* READ  │
│               functions, @/lib/supabase/{server,public-client}.      │
│   may NOT:    perform a write. An RSC that mutates is a bug — RSCs   │
│               re-run on navigation and prefetch.                     │
├──────────────────────────────────────────────────────────────────────┤
│ SERVER ACTION ('use server') / ROUTE HANDLER                         │
│   may call:   everything in @/lib/services/* and @/lib/rpc/*.        │
│   MUST:       zod-parse its input FIRST, re-authorise (never trust   │
│               a client-supplied restaurant_id/branch_id), and return │
│               Result<T>. Never throw across the boundary.            │
├──────────────────────────────────────────────────────────────────────┤
│ SERVICE (@/lib/services/*)                                           │
│   may call:   @/lib/supabase/server (cookie client) and, in the two  │
│               documented cases below, @/lib/supabase/admin.          │
│   returns:    Result<T>. Always.                                     │
└──────────────────────────────────────────────────────────────────────┘
```

### 9.2 The rules, prescriptively

1. **A service function never throws to its caller.** Its body may throw
   (`assertTransition`, `assertMoney`); its outermost statement is `return toResult(async () => …)`.
2. **A service function's first act is authorisation, not a query.** It reads `StaffSession` from
   `getStaffSession()` and refuses with `FORBIDDEN` before touching the database. RLS is the
   guarantee; this check is the *good error message*.
3. **A service function never accepts a `restaurant_id` from the client.** Tenancy comes from the
   session. A `branch_id` argument is permitted but is verified against the session's branch scope.
4. **Only `src/lib/rpc/*` calls `.rpc()`. Only `src/lib/services/*` calls `.from()`.** A component
   that reaches for `supabase.from(...)` is a review rejection. This is what keeps every query
   inside a file that a reviewer can audit for tenancy.
5. **Money crosses the boundary as `Money` only.** A service never returns a formatted string; a
   component never sends a formatted string. Formatting is a render concern.
6. **`createAdminClient()` has exactly two legitimate callers**, both `import 'server-only'`:
   `staff-service.ts` (creating an `auth.users` row for a staff invitation, which requires the admin
   API) and `dashboard-service.ts` when a `SUPER_ADMIN` queries across tenants. Every other use is a
   bug; the service-role key never appears in a Server Component, never in a Server Action that a
   non-admin can invoke, and never in any file that a client component can transitively import.
7. **Public customer routes use `createPublicClient()`, never the cookie client.** A cookie client on
   `/t/**` would silently promote a logged-in waiter's own session onto the guest page and change
   which rows RLS returns. `export const runtime = 'nodejs'` on every route and page under
   `src/app/t/**` and `src/app/api/public/**`.
8. **Validate at the boundary, then trust.** A Server Action parses with a zod schema from
   `src/lib/validation/*` as its first statement and passes the *parsed* value onward. Services take
   already-parsed types (`PlaceOrderInput`, `MenuItemInput`), not `unknown`.
9. **Parse RPC output too.** `src/lib/rpc/public.ts` runs the response through the matching schema in
   `src/lib/rpc/schemas.ts`. A JSONB shape that drifts must fail loudly in one file, not produce
   `undefined` in a component three layers away.
10. **Revalidation is the Server Action's job, not the service's.** Services are pure data
    operations; `revalidatePath` / `revalidateTag` belongs in the action, after a successful
    `Result`.

### 9.3 The canonical service signature

```ts
// src/lib/services/order-service.ts  (shape, not the whole file)
import 'server-only';
import { createServerClient } from '@/lib/supabase/server';
import { getStaffSession } from '@/lib/services/session';
import { assertTransition } from '@/lib/orders/state-machine';
import { mapPgError } from '@/lib/security/errors';
import { AppErrorException, appError, toResult, type Result } from '@/lib/result';
import { toOrderView } from '@/lib/mappers/order-mapper';
import type { StatusUpdateInput } from '@/lib/validation/order';
import type { OrderView } from '@/types/domain';

export async function updateOrderStatus(
  input: StatusUpdateInput,
): Promise<Result<OrderView>> {
  return toResult(async () => {
    const session = await getStaffSession();
    if (!session) {
      throw new AppErrorException(appError('FORBIDDEN', 'no staff session'));
    }

    // 1. Mirror check — fast, localised, and keeps an illegal request off the wire.
    assertTransition(input.expected_status, input.next_status, session.role);

    const supabase = await createServerClient();

    // 2. Optimistic concurrency: the row must still be in expected_status.
    const { data, error } = await supabase
      .from('orders')
      .update({
        status: input.next_status,
        ...(input.cancellation_reason ? { cancellation_reason: input.cancellation_reason } : {}),
      })
      .eq('id', input.order_id)
      .eq('status', input.expected_status)
      .select('*, order_items(*, order_item_options(*)), tables(number, name)')
      .single();

    // 3. Postgres is authoritative. trg_orders_guard() may still refuse (QR040), and that
    //    refusal wins over anything step 1 concluded.
    if (error) throw new AppErrorException(mapPgError(error));
    if (!data) {
      throw new AppErrorException(
        appError('INVALID_TRANSITION', 'order moved before this update landed', {
          wire: 'QR040_INVALID_STATUS_TRANSITION',
          details: { from: input.expected_status, to: input.next_status },
        }),
      );
    }

    return toOrderView(data);
  });
}
```

### 9.4 What each service exports

| Service | Read functions (Server Component may call) | Write functions (Server Action only) |
|---|---|---|
| `menu-service.ts` | `listCategories(branchId)`, `listMenuItems(branchId, filters)`, `getMenuItem(id)` | `createCategory`, `updateCategory`, `deleteCategory`, `createMenuItem`, `updateMenuItem`, `setItemAvailability`, `reorder` |
| `order-service.ts` | `listOrders(branchId, filters)`, `getOrder(id)`, `listKitchenTickets(branchId)` | `updateOrderStatus`, `cancelOrder`, `voidLine` |
| `table-service.ts` | `listTables(branchId)`, `getTable(id)`, `qrPngDataUrl(token)` | `createTable`, `updateTable`, `deactivateTable`, `rotateToken` |
| `branch-service.ts` | `listBranches()`, `getBranch(id)` | `createBranch`, `updateBranch`, `setAcceptingOrders` |
| `staff-service.ts` | `listStaff()`, `getStaffMember(id)` | `inviteStaff`, `updateStaff`, `deactivateStaff` |
| `waiter-service.ts` | `listWaiterCalls(branchId, openOnly)` | `acknowledgeCall`, `resolveCall` |
| `dashboard-service.ts` | `getDashboardStats(branchId, businessDate)` | — |
| `settings-service.ts` | `getSettings()` | `updateSettings` |

Every read returns `Result<T>`; every write returns `Result<T>`. No function in this table returns a
bare value or a nullable.

---

## 10. Definition of done for this layer

1. `npm run typecheck` passes with `strict`, `noUncheckedIndexedAccess` and `verbatimModuleSyntax`.
   Type-only imports use `import type`.
2. `src/lib/orders/state-machine.test.ts` passes all six assertions in §6.4, and
   `supabase/tests/state_machine.sql` agrees with it over the full cross product.
3. `src/lib/money.test.ts` covers: `toMinor` round-trips through `fromMinor` for 0 and 2 decimals;
   `toMinor('45000.001', 2)` throws; `applyBps(45005, 1000) === 4501`; the nine `formatMoney` rows
   of §5.3 match exactly, byte for byte including U+00A0.
4. `src/lib/i18n/messages.test.ts` proves `errors.<code>` exists in all three message files for all
   27 `QrErrorCode`s and all 12 `AppErrorCode`s.
5. `grep -rn "from('" src/app src/components` returns nothing — no component queries directly.
6. `grep -rln "createAdminClient" src` returns exactly `src/lib/supabase/admin.ts`,
   `src/lib/services/staff-service.ts`, `src/lib/services/dashboard-service.ts`.
7. `grep -rn "toFixed\|parseFloat" src --include=*.ts --include=*.tsx` returns nothing outside
   `src/lib/money.ts`.
8. The `Database` interface in `src/types/database.ts` diffs clean against
   `npm run db:types` output on a freshly reset local Supabase.
