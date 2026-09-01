# RESTAURANT QR OS — 01. PostgreSQL Database Schema

**Status:** FINAL. This document is the authoritative schema contract.
**Target:** Supabase PostgreSQL **15+** (17 recommended). Several constructs below *require* PG 15:
`UNIQUE NULLS NOT DISTINCT`, and `ON DELETE SET NULL (column_list)` on composite foreign keys.
**Money:** every money column is `BIGINT` in **minor units** (integers only, never `float`/`double`/`numeric` for storage).
**TypeScript:** `type Money = number` — an integer count of minor units.

Other specs implement against this file. Column names, table names, function signatures, enum labels,
index names, `SQLSTATE` codes and trigger names in this document are **binding**.

---

## 0. Migration file layout

All DDL below is runnable in this order. Split across Supabase migration files exactly as follows so
other agents know where to add things:

| # | File | Contents |
|---|------|----------|
| 1 | `supabase/migrations/20260901000100_extensions_domains_enums.sql` | §2 extensions, §3 domains, §4 enums |
| 2 | `supabase/migrations/20260901000200_core_tenancy.sql` | §6.1 `restaurants`, §6.2 `branches`, §6.3 `profiles`, §6.4 `staff` |
| 3 | `supabase/migrations/20260901000300_tables_qr.sql` | §6.5 `tables`, §6.6 `qr_token_history` |
| 4 | `supabase/migrations/20260901000400_menu.sql` | §6.7 `menu_categories`, §6.8 `menu_items`, §6.9 `menu_item_options` |
| 5 | `supabase/migrations/20260901000500_promotions.sql` | §6.10 `promotions`, §6.11 `promotion_items` |
| 6 | `supabase/migrations/20260901000600_orders.sql` | §6.12 `branch_order_counters`, §6.13 `orders`, §6.14 `order_items`, §6.15 `order_item_options`, §6.16 `order_status_history` |
| 7 | `supabase/migrations/20260901000700_ops.sql` | §6.17 `waiter_calls`, §6.18 `notifications`, §6.19 `notification_reads` |
| 8 | `supabase/migrations/20260901000800_functions_triggers.sql` | §5 utility functions, §7 all trigger functions + `CREATE TRIGGER` |
| 9 | `supabase/migrations/20260901000900_indexes.sql` | §8 every index |
| 10 | `supabase/migrations/20260901001000_realtime_rls_enable.sql` | §9 realtime publication + `ENABLE ROW LEVEL SECURITY` |

RLS **policies** are NOT in this document. They live in `docs/architecture/02-rls-and-authorization.md`.
This document only enables RLS (which, with zero policies, denies everything except `service_role` —
the correct fail-closed default while the policy migration is being written).

---

## 1. The multi-tenant isolation invariant (read this first)

Everything in this schema is arranged around two structural invariants. They are enforced by
**composite foreign keys**, not by convention, not by application code, and not by RLS.

### Invariant T1 — tenant closure

> For every row `r` in every tenant-scoped table, `r.restaurant_id` is NOT NULL, and every foreign-key
> edge leaving `r` lands on a row with the **same** `restaurant_id`.

Mechanism: every parent table exposes a redundant unique key `UNIQUE (restaurant_id, id)`, and every
child references the parent through the **pair** `(restaurant_id, parent_id)` rather than through
`parent_id` alone. Postgres then makes a cross-tenant reference physically unrepresentable:

```sql
-- parent
CONSTRAINT uq_menu_items_tenant UNIQUE (restaurant_id, id)
-- child
CONSTRAINT fk_order_items_menu_item
  FOREIGN KEY (restaurant_id, menu_item_id)
  REFERENCES public.menu_items (restaurant_id, id)
```

An attacker (or a bug) that supplies restaurant B's `menu_item_id` while writing an order for
restaurant A gets a `23503 foreign_key_violation` from the storage engine. No policy has to be correct
for this to hold. This is what "database layer enforces isolation" (brief §15, §27, §34.5) means here.

### Invariant T2 — branch closure

> For every branch-scoped row, `(restaurant_id, branch_id)` references a real branch of that restaurant,
> and every table/order/call reachable from it belongs to that same branch.

Mechanism: `branches` exposes `UNIQUE (restaurant_id, id)`, `tables` exposes `UNIQUE (branch_id, id)`,
and `orders`/`waiter_calls` reference `(branch_id, table_id) → tables (branch_id, id)`. An order can
therefore never point at a table in a different branch, which is what makes "waiters see only their
branch" (brief §34.6) safe to express as a single `branch_id` comparison in RLS.

### Why `restaurant_id` is denormalised onto branch-scoped tables

`order_items`, `order_item_options`, `order_status_history`, `waiter_calls`, `notifications`,
`menu_item_options`, `promotion_items` all carry `restaurant_id` even though it is derivable.

Three concrete reasons, in order of weight:

1. **RLS cost.** An RLS policy is an expression evaluated **per candidate row**. Without the column,
   the `order_items` policy must walk `order_items → orders → branches → staff` on every row of every
   kitchen query. With the column it is one index-backed `EXISTS` against `staff (restaurant_id, profile_id)`.
   On a 300-row KDS query that is the difference between one index scan and 900 extra lookups.
2. **RLS correctness.** Multi-join policies are where tenant leaks actually happen (a missed join
   predicate silently widens the policy). A single-column predicate is auditable at a glance.
3. **Drift is impossible here.** The normal argument against denormalisation is that the copy can
   disagree with the source. It cannot: the composite FK in Invariant T1 *is* the consistency
   constraint on the copy. `order_items.restaurant_id` is not a cached value, it is half of the key
   that binds the row to its order.

`branch_id` is denormalised onto `waiter_calls`, `notifications`, `order_status_history` for the same
reason — the waiter and kitchen panels filter by branch on every query.

---

## 2. Extensions

```sql
-- Supabase installs extensions into the `extensions` schema.
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- gen_random_uuid() is in core PostgreSQL 13+; no extension needed for it.
-- gen_random_bytes() comes from pgcrypto and IS needed (QR tokens, order public codes).
```

`pg_trgm` is deliberately **not** installed. Menu search uses a stored `tsvector` with `simple`
configuration and `:*` prefix matching (§6.8), which covers Latin-script Uzbek, Cyrillic Russian and
English without a language-specific dictionary and without the write amplification of trigram indexes
on a table that the customer app reads on every page load.

---

## 3. Domains

### 3.1 `i18n_text` — trilingual content

All customer-visible content (`name`, `description`, `ingredients`, promo copy) is stored as a single
`JSONB` object keyed by locale: `{"uz": "Osh", "ru": "Плов", "en": "Plov"}`.

**Why JSONB and not `name_uz` / `name_ru` / `name_en` columns:**

- Column explosion. `menu_items` alone has 3 translatable fields → 9 columns; across `menu_categories`,
  `menu_item_options`, `promotions`, `order_items` snapshots that is ~40 near-duplicate columns.
- Adding a 4th locale (Karakalpak, Kazakh) becomes a data change, not a migration that touches every table.
- `order_items.name_snapshot` can capture **all three** translations in one column, so a historical
  receipt still renders correctly for a Russian-speaking manager reviewing an order taken in Uzbek.
  Three snapshot columns per translatable field would be unusable.
- PostgREST returns the object as-is; the client picks with a resolver `t(value, locale)` that falls
  back `locale → restaurant.default_locale → first non-empty`.

Validation is a real constraint, not a convention:

```sql
CREATE OR REPLACE FUNCTION public.is_i18n_text(v JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
AS $$
DECLARE
  k TEXT;
  has_value BOOLEAN := false;
BEGIN
  IF v IS NULL THEN
    RETURN true;                       -- nullability is decided per-column, not by the domain
  END IF;
  IF jsonb_typeof(v) <> 'object' THEN
    RETURN false;
  END IF;
  FOR k IN SELECT jsonb_object_keys(v) LOOP
    IF k NOT IN ('uz', 'ru', 'en') THEN
      RETURN false;                    -- unknown locale key
    END IF;
    IF jsonb_typeof(v -> k) <> 'string' THEN
      RETURN false;                    -- values must be strings, not nested objects
    END IF;
    IF length(btrim(v ->> k)) > 0 THEN
      has_value := true;
    END IF;
    IF length(v ->> k) > 2000 THEN
      RETURN false;                    -- hard cap; prevents unbounded payloads
    END IF;
  END LOOP;
  RETURN has_value;                    -- at least one locale must be non-empty
END;
$$;

COMMENT ON FUNCTION public.is_i18n_text(JSONB) IS
  'Validates an i18n_text value: a JSONB object whose keys are a subset of {uz,ru,en}, whose values are strings of at most 2000 chars, with at least one non-empty value.';

CREATE DOMAIN public.i18n_text AS JSONB
  CONSTRAINT ck_i18n_text_shape CHECK (public.is_i18n_text(VALUE));

COMMENT ON DOMAIN public.i18n_text IS
  'Trilingual text: {"uz":"...","ru":"...","en":"..."}. Keys are optional individually; at least one must be non-empty. Read with (col::jsonb)->>''uz''.';
```

> **Implementation note for every agent:** when writing SQL against an `i18n_text` column inside an
> index expression or a generated column, cast explicitly — `(name::jsonb) ->> 'uz'`. The implicit
> domain→base coercion is binary-coercible and immutable, but the explicit cast keeps the expression
> unambiguously immutable across PG versions and avoids `could not identify operator` surprises.

### 3.2 `money_minor` — money as integers

```sql
CREATE DOMAIN public.money_minor AS BIGINT
  CONSTRAINT ck_money_minor_non_negative CHECK (VALUE >= 0);

COMMENT ON DOMAIN public.money_minor IS
  'Money in MINOR CURRENCY UNITS as an exact integer (UZS tiyin-less: currency_decimals=0, so 45000 = 45 000 UZS). Never floating point. Signed BIGINT with a >= 0 check; negative adjustments are modelled as separate positive discount columns.';
```

Every money column below is declared `public.money_minor`, which gives the `CHECK (>= 0)` requirement
uniformly and for free. Each such column additionally carries its own `COMMENT ON COLUMN` naming the
unit, as required.

### 3.3 `bps` — rates without floats

```sql
CREATE DOMAIN public.bps AS INTEGER
  CONSTRAINT ck_bps_range CHECK (VALUE >= 0 AND VALUE <= 10000);

COMMENT ON DOMAIN public.bps IS
  'A rate in basis points: 10000 = 100.00%. Service fee percentages are stored as bps so that fee arithmetic stays in exact integer/numeric space and never touches a float.';
```

### 3.4 `citext_email` is not used

Supabase already owns identity. `profiles.email` is a denormalised, lower-cased `TEXT` display copy of
`auth.users.email`, constrained but **not** unique — `auth.users` is the uniqueness authority and a
second unique index would create a write-ordering hazard during signup.

---

## 4. Enumerated types

Declared before any table that uses them.

```sql
-- ---------------------------------------------------------------------------
-- 4.1 app_role
-- ---------------------------------------------------------------------------
CREATE TYPE public.app_role AS ENUM (
  'SUPER_ADMIN',
  'RESTAURANT_OWNER',
  'MANAGER',
  'WAITER',
  'KITCHEN'
);

COMMENT ON TYPE public.app_role IS
  'RBAC roles (brief §16). SUPER_ADMIN is a PLATFORM role and is deliberately NOT storable in staff.role (see ck_staff_role_scope): staff.restaurant_id is NOT NULL and that non-nullability is the load-bearing multi-tenant invariant. Platform admin is the boolean profiles.is_platform_admin.';

-- ---------------------------------------------------------------------------
-- 4.2 order_status
-- ---------------------------------------------------------------------------
CREATE TYPE public.order_status AS ENUM (
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'delivered',
  'completed',
  'cancelled'
);

COMMENT ON TYPE public.order_status IS
  'Order lifecycle (brief §8, §26). Labels are declared in lifecycle order for readable psql output ONLY. DO NOT use enum ordering comparisons (status < ''ready''): cancelled sorts last but is terminal from any pre-delivery state, so ordering carries no semantics. Legal transitions are defined solely by public.is_valid_order_transition().';

-- ---------------------------------------------------------------------------
-- 4.3 order_type / order_channel
-- ---------------------------------------------------------------------------
CREATE TYPE public.order_type AS ENUM (
  'dine_in',
  'takeaway'
);

COMMENT ON TYPE public.order_type IS
  'What the guest does with the food. MVP creates only dine_in. takeaway exists so that orders.table_id can be legally NULL for counter orders without a schema change; ck_orders_table_required ties the two together.';

CREATE TYPE public.order_channel AS ENUM (
  'qr',
  'waiter',
  'admin'
);

COMMENT ON TYPE public.order_channel IS
  'Who physically created the order. Justification: (a) analytics must separate self-service QR revenue from staff-entered revenue, which is the headline number of this product; (b) RLS and the anti-spam rate limiter treat channel=qr (anonymous, untrusted) differently from channel=waiter (authenticated staff); (c) demo/seed data is channel=admin, satisfying brief §11 "demo data clearly separated".';

-- ---------------------------------------------------------------------------
-- 4.4 dietary_tag
-- ---------------------------------------------------------------------------
CREATE TYPE public.dietary_tag AS ENUM (
  'vegetarian',
  'vegan',
  'halal',
  'gluten_free',
  'lactose_free',
  'nut_free',
  'contains_nuts',
  'contains_seafood',
  'contains_pork',
  'contains_alcohol'
);

COMMENT ON TYPE public.dietary_tag IS
  'Dietary information (brief §5, §6) as a closed enum rather than free text, so that customer-app filter chips, their three translations and their icons are a finite, testable set. Positive claims (halal, vegan) and warnings (contains_pork, contains_alcohol) share one type because the customer UI renders them in one badge row; the client decides styling from the label. Stored as dietary_tag[] on menu_items with a GIN index.';

-- ---------------------------------------------------------------------------
-- 4.5 waiter_call_reason / waiter_call_status
-- ---------------------------------------------------------------------------
CREATE TYPE public.waiter_call_reason AS ENUM (
  'call_waiter',
  'request_bill',
  'request_water',
  'request_cutlery',
  'clean_table',
  'complaint',
  'other'
);

COMMENT ON TYPE public.waiter_call_reason IS
  'Why the table pressed CALL WAITER (brief §10). An enum, not free text: the waiter console must sort and colour by reason, and free text from an anonymous public client is an abuse surface. Free text is still accepted separately in waiter_calls.note, length-capped.';

CREATE TYPE public.waiter_call_status AS ENUM (
  'pending',
  'acknowledged',
  'resolved',
  'cancelled',
  'expired'
);

COMMENT ON TYPE public.waiter_call_status IS
  'pending = ringing on the waiter console; acknowledged = a waiter tapped "I am coming" (brief §10); resolved = handled; cancelled = the guest withdrew it; expired = auto-closed by the housekeeping job after branches.waiter_call_expiry_minutes so a forgotten call cannot ring forever. pending and acknowledged are the two OPEN states used by uq_waiter_calls_open_per_table.';

-- ---------------------------------------------------------------------------
-- 4.6 actor_kind — who performed a logged action
-- ---------------------------------------------------------------------------
CREATE TYPE public.actor_kind AS ENUM (
  'customer',
  'staff',
  'system'
);

COMMENT ON TYPE public.actor_kind IS
  'Actor classification for order_status_history. Required because brief §11 forbids customer accounts: the actor of a pending->cancelled transition may be an anonymous guest with no auth.users row, so changed_by (a profile id) is NULL and this column carries the meaning. system covers trigger- and cron-driven transitions (auto-expiry, auto-complete).';

-- ---------------------------------------------------------------------------
-- 4.7 option_selection_type
-- ---------------------------------------------------------------------------
CREATE TYPE public.option_selection_type AS ENUM (
  'single',
  'multiple'
);

COMMENT ON TYPE public.option_selection_type IS
  'How a menu_item_options group behaves in the product-detail sheet: single = radio (choose one size), multiple = checkboxes (extras). Stored per row and kept identical across a group by trg_menu_item_options_group_consistency.';

-- ---------------------------------------------------------------------------
-- 4.8 promotion_type
-- ---------------------------------------------------------------------------
CREATE TYPE public.promotion_type AS ENUM (
  'announcement',
  'percentage',
  'fixed_amount',
  'special_price'
);

COMMENT ON TYPE public.promotion_type IS
  'announcement = display-only banner with no arithmetic (the MVP default, brief §4 "active promotions"). percentage/fixed_amount/special_price carry the numbers a later pricing engine will read; ck_promotions_value_shape guarantees exactly the right value column is populated for each type. MVP order pricing does NOT auto-apply promotions - see §6.10.';

-- ---------------------------------------------------------------------------
-- 4.9 notification_type
-- ---------------------------------------------------------------------------
CREATE TYPE public.notification_type AS ENUM (
  'order_created',
  'order_confirmed',
  'order_preparing',
  'order_ready',
  'order_delivered',
  'order_completed',
  'order_cancelled',
  'order_late',
  'waiter_call_created',
  'waiter_call_acknowledged',
  'menu_item_unavailable',
  'system'
);

COMMENT ON TYPE public.notification_type IS
  'Discriminator for the staff notification feed. Notification TEXT IS NOT STORED: the row carries type + payload JSONB and the client renders the localised string. Storing rendered text would freeze one of three locales into the row and go stale when the underlying entity changes.';

-- ---------------------------------------------------------------------------
-- 4.10 app_locale
-- ---------------------------------------------------------------------------
CREATE TYPE public.app_locale AS ENUM (
  'uz',
  'ru',
  'en'
);

COMMENT ON TYPE public.app_locale IS
  'Supported UI locales. Used for restaurants.default_locale (the i18n_text fallback locale for that tenant) and profiles.locale (a staff member''s admin-panel language). Public customers carry locale in a cookie, not in the database - they have no account (brief §11).';
```

> **Migration hazard, stated once:** `ALTER TYPE ... ADD VALUE` cannot be used and then referenced in
> the *same* transaction. Any future migration adding an enum label must add it in its own migration
> file, separate from the migration that writes rows using it.

### 4.11 Why `spicy_level` is a `SMALLINT`, not an enum

`spicy_level SMALLINT NOT NULL DEFAULT 0 CHECK (spicy_level BETWEEN 0 AND 3)`.

Deliberate deviation from "make it an enum":

- It is an **ordinal scale**, and the customer app must express "show me anything at or below mild"
  (`spicy_level <= 1`). Enum comparison works but is opaque, and a future re-ordering of labels would
  silently change query meaning.
- The UI renders it as *n* chilli glyphs — a direct integer render, no lookup table.
- The `CHECK (BETWEEN 0 AND 3)` requested in the requirements is expressible only on a numeric type.

Semantics are fixed: `0 = not spicy`, `1 = mild`, `2 = medium`, `3 = hot`.


---

## 5. Utility functions

These are created in migration 8 in production, but are listed here because tables reference them in
`DEFAULT` clauses. Run migration 8's function bodies before the table migrations, or (simpler, and what
the file layout above does) create the four functions in this section at the top of migration 1.

```sql
-- ---------------------------------------------------------------------------
-- 5.1 set_updated_at() — the universal updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'BEFORE UPDATE FOR EACH ROW on every table carrying updated_at. Set unconditionally (not only when the row changed) so that a no-op UPDATE still emits a Realtime event, which the panels use as a cheap "touch to re-broadcast" signal.';

-- ---------------------------------------------------------------------------
-- 5.2 generate_qr_token() — 144-bit URL-safe token
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_qr_token(p_bytes INTEGER DEFAULT 18)
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$$;

COMMENT ON FUNCTION public.generate_qr_token(INTEGER) IS
  'Cryptographically secure QR token (brief §13, §14, §34.9). 18 bytes = 144 bits = exactly 24 base64 characters with no padding, translated to the base64url alphabet ([A-Za-z0-9_-]). translate() with a 3-char FROM and 2-char TO deletes any ''='' should p_bytes ever not be a multiple of 3.';

-- ---------------------------------------------------------------------------
-- 5.3 generate_public_code() — short unguessable public identifier
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_public_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', '-_');
$$;

COMMENT ON FUNCTION public.generate_public_code() IS
  'Unguessable 12-character (72-bit) code used in the customer order-tracking URL /o/<public_code>. Brief §3 forbids exposing internal DB ids in public URLs; this keeps orders.id off the wire exactly as tables.qr_token keeps tables.id off the wire.';

-- ---------------------------------------------------------------------------
-- 5.4 is_valid_order_transition() — the state machine, as data
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_order_transition(
  p_from public.order_status,
  p_to   public.order_status
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_from
    WHEN 'pending'   THEN p_to IN ('confirmed', 'cancelled')
    WHEN 'confirmed' THEN p_to IN ('preparing', 'cancelled')
    WHEN 'preparing' THEN p_to IN ('ready',     'cancelled')
    WHEN 'ready'     THEN p_to IN ('delivered', 'cancelled')
    WHEN 'delivered' THEN p_to  = 'completed'
    WHEN 'completed' THEN false
    WHEN 'cancelled' THEN false
  END;
$$;

COMMENT ON FUNCTION public.is_valid_order_transition(public.order_status, public.order_status) IS
  'The single source of truth for brief §26. Forward path: pending->confirmed->preparing->ready->delivered->completed. CANCELLATION RULE (explicit, as the brief demands): an order may be cancelled from pending, confirmed, preparing or ready - i.e. at any point until the food has physically left the pass. Once delivered, the only legal move is completed; delivered->cancelled is a refund, which is an accounting event this MVP does not model. completed and cancelled are absorbing states with no outgoing edges, so completed->preparing and cancelled->ready are rejected. Same-status "transitions" never reach this function (the guard trigger only fires on an actual change).';
```

> **Contract for the API layer:** the TypeScript state machine in
> `src/lib/orders/state-machine.ts` MUST mirror this table exactly. The database is the last line of
> defence, not the first — an illegal transition that reaches Postgres is a bug in the API layer that
> Postgres will convert into `SQLSTATE ORD01` (see §10).

---

## 6. Tables

Ordered by dependency. Every business table has `id UUID PRIMARY KEY DEFAULT gen_random_uuid()`,
`created_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`, with
exactly two documented exceptions (`profiles.id`, §6.3; `branch_order_counters`, §6.12).

### 6.1 `restaurants` — the tenant root

```sql
CREATE TABLE public.restaurants (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  name               TEXT        NOT NULL,
  slug               TEXT        NOT NULL,
  logo_url           TEXT,
  logo_path          TEXT,
  cover_image_url    TEXT,
  phone              TEXT,
  email              TEXT,

  welcome_message    public.i18n_text,
  description        public.i18n_text,

  default_locale     public.app_locale NOT NULL DEFAULT 'uz',
  currency           CHAR(3)     NOT NULL DEFAULT 'UZS',
  currency_decimals  SMALLINT    NOT NULL DEFAULT 0,

  service_fee_bps    public.bps  NOT NULL DEFAULT 0,
  service_fee_enabled BOOLEAN    NOT NULL DEFAULT false,

  settings           JSONB       NOT NULL DEFAULT '{}'::jsonb,

  is_active          BOOLEAN     NOT NULL DEFAULT true,
  is_demo            BOOLEAN     NOT NULL DEFAULT false,

  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_restaurants_name_len
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),

  CONSTRAINT ck_restaurants_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$'),

  CONSTRAINT ck_restaurants_slug_not_reserved
    CHECK (slug NOT IN (
      't', 'o', 'api', 'auth', 'admin', 'login', 'logout', 'signup', 'kitchen',
      'waiter', 'app', 'www', 'static', 'assets', 'public', 'health', 'favicon'
    )),

  CONSTRAINT ck_restaurants_currency_format
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT ck_restaurants_currency_decimals
    CHECK (currency_decimals BETWEEN 0 AND 4),

  CONSTRAINT ck_restaurants_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{5,24}$'),

  CONSTRAINT ck_restaurants_email_format
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  CONSTRAINT ck_restaurants_settings_object
    CHECK (jsonb_typeof(settings) = 'object'),

  CONSTRAINT ck_restaurants_urls_len
    CHECK (
      (logo_url        IS NULL OR char_length(logo_url)        <= 1024) AND
      (cover_image_url IS NULL OR char_length(cover_image_url) <= 1024) AND
      (logo_path       IS NULL OR char_length(logo_path)       <= 512)
    ),

  CONSTRAINT uq_restaurants_slug UNIQUE (slug)
);

COMMENT ON TABLE  public.restaurants IS
  'The tenant root. Every tenant-scoped row in this database traces to exactly one row here (Invariant T1).';
COMMENT ON COLUMN public.restaurants.slug IS
  'URL-safe tenant handle used in admin routes (/admin/<slug>/...). Reserved words are rejected so a slug can never shadow an application route - notably /t/ (QR resolution) and /o/ (order tracking).';
COMMENT ON COLUMN public.restaurants.currency IS
  'ISO-4217 alphabetic code. Governs how every money_minor value in this tenant is FORMATTED; it never changes how one is STORED (always minor units).';
COMMENT ON COLUMN public.restaurants.currency_decimals IS
  'Number of decimal places for currency. 0 for UZS (45000 minor units renders as "45 000 so''m"); 2 for USD (4500 renders as "$45.00"). Formatting divisor is 10^currency_decimals.';
COMMENT ON COLUMN public.restaurants.service_fee_bps IS
  'Default service charge in basis points (10000 = 100.00%). Branches may override (branches.service_fee_bps). Snapshotted onto every order as orders.service_fee_bps.';
COMMENT ON COLUMN public.restaurants.service_fee_enabled IS
  'Master switch for the "service fee (if enabled)" line in the cart (brief §7). When false the order pricing service writes service_fee_bps = 0 onto the order regardless of the configured rate.';
COMMENT ON COLUMN public.restaurants.logo_path IS
  'Supabase Storage object path (bucket-relative) backing logo_url. Kept alongside the public URL so that replacing or deleting a logo can remove the old object instead of orphaning it.';
COMMENT ON COLUMN public.restaurants.is_demo IS
  'Marks seeded demonstration tenants. Brief §11 requires that demo data be clearly separated from real analytics; every analytics query filters is_demo = false unless explicitly asked otherwise.';
COMMENT ON COLUMN public.restaurants.is_active IS
  'Operational switch. A false value makes every QR of this tenant resolve to the "restaurant unavailable" state (brief §32) without deleting anything.';
COMMENT ON COLUMN public.restaurants.deleted_at IS
  'Soft delete. Hard-deleting a tenant would cascade into historical orders; offboarding sets this and disables is_active instead.';
```

### 6.2 `branches`

```sql
CREATE TABLE public.branches (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id                 UUID        NOT NULL,

  name                          TEXT        NOT NULL,
  code                          TEXT        NOT NULL,
  address                       TEXT,
  phone                         TEXT,
  timezone                      TEXT        NOT NULL DEFAULT 'Asia/Tashkent',

  latitude                      NUMERIC(9,6),
  longitude                     NUMERIC(9,6),

  service_fee_bps               public.bps,

  opening_hours                 JSONB       NOT NULL DEFAULT '{}'::jsonb,

  waiter_call_cooldown_seconds  INTEGER     NOT NULL DEFAULT 90,
  waiter_call_expiry_minutes    INTEGER     NOT NULL DEFAULT 30,
  order_min_interval_seconds    INTEGER     NOT NULL DEFAULT 20,
  default_prep_minutes          SMALLINT    NOT NULL DEFAULT 15,
  late_order_threshold_minutes  SMALLINT    NOT NULL DEFAULT 25,

  is_active                     BOOLEAN     NOT NULL DEFAULT true,
  is_accepting_orders           BOOLEAN     NOT NULL DEFAULT true,

  deleted_at                    TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_branches_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT uq_branches_tenant UNIQUE (restaurant_id, id),
  CONSTRAINT uq_branches_code   UNIQUE (restaurant_id, code),

  CONSTRAINT ck_branches_name_len
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),

  CONSTRAINT ck_branches_code_format
    CHECK (code ~ '^[A-Z][A-Z0-9]{0,3}$'),

  CONSTRAINT ck_branches_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{5,24}$'),

  CONSTRAINT ck_branches_opening_hours_object
    CHECK (jsonb_typeof(opening_hours) = 'object'),

  CONSTRAINT ck_branches_geo_pair
    CHECK ((latitude IS NULL) = (longitude IS NULL)),

  CONSTRAINT ck_branches_latitude_range
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),

  CONSTRAINT ck_branches_longitude_range
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),

  CONSTRAINT ck_branches_cooldown_range
    CHECK (waiter_call_cooldown_seconds BETWEEN 0 AND 3600),

  CONSTRAINT ck_branches_expiry_range
    CHECK (waiter_call_expiry_minutes BETWEEN 1 AND 1440),

  CONSTRAINT ck_branches_order_interval_range
    CHECK (order_min_interval_seconds BETWEEN 0 AND 3600),

  CONSTRAINT ck_branches_prep_minutes_range
    CHECK (default_prep_minutes BETWEEN 1 AND 240),

  CONSTRAINT ck_branches_late_threshold_range
    CHECK (late_order_threshold_minutes BETWEEN 1 AND 480)
);

COMMENT ON TABLE  public.branches IS
  'A physical location of a restaurant. The unit of operational scoping: waiters, kitchen staff, tables, orders and waiter calls are all branch-scoped.';
COMMENT ON COLUMN public.branches.code IS
  'Short human branch code, 1-4 uppercase chars (A, B, MAIN, C2). Unique per restaurant. This is the letter in the human-friendly order number #A-014 (see §7.3) and MUST be short enough to fit a kitchen ticket header.';
COMMENT ON COLUMN public.branches.timezone IS
  'IANA timezone name. Load-bearing, not cosmetic: the daily order-number counter rolls over at local midnight in THIS timezone (§7.3), and analytics "today" is computed here. Validity is enforced against pg_timezone_names by trg_branches_validate_timezone, because a CHECK cannot call the non-immutable timezone machinery.';
COMMENT ON COLUMN public.branches.service_fee_bps IS
  'Per-branch service-charge override in basis points. NULL means inherit restaurants.service_fee_bps. Resolution happens once, server-side, at order creation, and the result is snapshotted onto orders.service_fee_bps.';
COMMENT ON COLUMN public.branches.opening_hours IS
  'Weekly schedule as {"mon":[{"open":"10:00","close":"23:00"}], ...}. Advisory for the customer app ("closed now") and for the menu daypart resolver; it does not itself block ordering. is_accepting_orders is the hard switch.';
COMMENT ON COLUMN public.branches.waiter_call_cooldown_seconds IS
  'Anti-spam window for CALL WAITER (brief §10, §27). Enforced in the database by trg_waiter_calls_cooldown, so the protection survives any API bug or direct client call.';
COMMENT ON COLUMN public.branches.waiter_call_expiry_minutes IS
  'A pending/acknowledged waiter call older than this is auto-set to expired by the housekeeping job, so a forgotten call cannot ring on the console forever and cannot permanently block the table via uq_waiter_calls_open_per_table.';
COMMENT ON COLUMN public.branches.order_min_interval_seconds IS
  'Minimum gap between two orders from the same anonymous customer session at the same table. Order-spam protection (brief §27), enforced by trg_orders_rate_limit.';
COMMENT ON COLUMN public.branches.default_prep_minutes IS
  'Fallback preparation time used when no line item declares one; feeds orders.estimated_prep_minutes and therefore orders.due_at.';
COMMENT ON COLUMN public.branches.late_order_threshold_minutes IS
  'A KDS card is flagged LATE (brief §9) once now() - orders.placed_at exceeds this. Configurable per branch because a pizza kitchen and a plov kitchen have different normal.';
COMMENT ON COLUMN public.branches.is_accepting_orders IS
  'Panic switch, separate from is_active. is_active = false hides the branch entirely; is_accepting_orders = false keeps the menu browsable but rejects order creation ("kitchen is closed"), which is a real and frequent operational state.';
```

### 6.3 `profiles` — the human identity

```sql
CREATE TABLE public.profiles (
  id                 UUID        PRIMARY KEY,

  email              TEXT,
  full_name          TEXT,
  phone              TEXT,
  avatar_url         TEXT,
  avatar_path        TEXT,
  locale             public.app_locale NOT NULL DEFAULT 'uz',

  is_platform_admin  BOOLEAN     NOT NULL DEFAULT false,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  last_seen_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_profiles_auth_user
    FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,

  CONSTRAINT ck_profiles_full_name_len
    CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 1 AND 120),

  CONSTRAINT ck_profiles_email_format
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  CONSTRAINT ck_profiles_email_lowercase
    CHECK (email IS NULL OR email = lower(email)),

  CONSTRAINT ck_profiles_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{5,24}$')
);

COMMENT ON TABLE  public.profiles IS
  'Application-level identity, 1:1 with auth.users. Only STAFF have profiles - customers never authenticate (brief §11) and therefore never appear here.';
COMMENT ON COLUMN public.profiles.id IS
  'DELIBERATE EXCEPTION to the "id uuid default gen_random_uuid()" rule. This is auth.users.id verbatim, with NO default. Two reasons: (1) it makes auth.uid() = profiles.id, so every RLS policy in 02-rls-and-authorization.md is one join shorter and reads as a direct equality; (2) a second, generated PK would allow two profile rows for one auth user, an illegal state this eliminates structurally rather than by unique index.';
COMMENT ON COLUMN public.profiles.email IS
  'Lower-cased display copy of auth.users.email. NOT UNIQUE and not authoritative: auth.users owns email uniqueness, and a second unique index here would create a write-ordering hazard during signup and social-account linking.';
COMMENT ON COLUMN public.profiles.is_platform_admin IS
  'SUPER_ADMIN (brief §16). Modelled as a profile boolean rather than a staff row because staff.restaurant_id is NOT NULL, and that non-nullability is the multi-tenant invariant every FK and every RLS policy depends on. Allowing one role to null it would poison the entire authorization model for a single actor type. RLS grants platform admins access via a separate branch of each policy.';
COMMENT ON COLUMN public.profiles.locale IS
  'Preferred language for the admin/kitchen/waiter UI. Public customers store locale in a cookie instead - they have no row here.';
COMMENT ON COLUMN public.profiles.is_active IS
  'Global suspension of a human, independent of their per-restaurant staff rows. Used to lock out a departed employee who holds memberships in several tenants.';
```

**Row creation.** Profiles are created by an `AFTER INSERT` trigger on `auth.users` (§7.2), so no code
path can produce an authenticated user without a profile.

### 6.4 `staff` — membership, role and branch scope

```sql
CREATE TABLE public.staff (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL,
  branch_id      UUID,
  profile_id     UUID        NOT NULL,

  role           public.app_role NOT NULL,
  permissions    JSONB       NOT NULL DEFAULT '{}'::jsonb,

  display_name   TEXT,
  employee_code  TEXT,

  is_active      BOOLEAN     NOT NULL DEFAULT true,
  invited_at     TIMESTAMPTZ,
  joined_at      TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_staff_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_staff_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_staff_profile
    FOREIGN KEY (profile_id) REFERENCES public.profiles (id) ON DELETE CASCADE,

  CONSTRAINT uq_staff_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT uq_staff_membership
    UNIQUE NULLS NOT DISTINCT (restaurant_id, profile_id, branch_id, role),

  CONSTRAINT ck_staff_no_super_admin
    CHECK (role <> 'SUPER_ADMIN'),

  CONSTRAINT ck_staff_role_scope
    CHECK (
      (role = 'RESTAURANT_OWNER' AND branch_id IS NULL)
      OR (role = 'MANAGER')
      OR (role IN ('WAITER', 'KITCHEN') AND branch_id IS NOT NULL)
    ),

  CONSTRAINT ck_staff_permissions_object
    CHECK (jsonb_typeof(permissions) = 'object'),

  CONSTRAINT ck_staff_employee_code_format
    CHECK (employee_code IS NULL OR employee_code ~ '^[A-Za-z0-9_-]{1,16}$'),

  CONSTRAINT ck_staff_display_name_len
    CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 80)
);

-- Exactly-one-branch enforcement for operational roles (see rationale below).
CREATE UNIQUE INDEX uq_staff_operational_single_branch
  ON public.staff (restaurant_id, profile_id, role)
  WHERE role IN ('WAITER', 'KITCHEN');

CREATE UNIQUE INDEX uq_staff_employee_code
  ON public.staff (restaurant_id, employee_code)
  WHERE employee_code IS NOT NULL;

COMMENT ON TABLE  public.staff IS
  'Ties a profile to a restaurant, with a role and an optional branch. This is the ONLY table an RLS policy needs to consult to answer "may this user touch this tenant/branch".';
COMMENT ON COLUMN public.staff.restaurant_id IS
  'NOT NULL by design. This is the anchor of the entire authorization model: every membership is scoped to exactly one tenant, with no nullable escape hatch. SUPER_ADMIN, the only role without a tenant, is therefore not representable here (ck_staff_no_super_admin) and lives on profiles.is_platform_admin.';
COMMENT ON COLUMN public.staff.branch_id IS
  'NULL = restaurant-wide scope (all branches). NOT NULL = pinned to one branch. Which is legal depends on role, per ck_staff_role_scope. The composite FK to branches (restaurant_id, id) uses MATCH SIMPLE, so a NULL branch_id skips the branch check while restaurant_id is still enforced by fk_staff_restaurant - exactly the semantics wanted.';
COMMENT ON COLUMN public.staff.role IS
  'RBAC role for this membership. A person may legitimately hold several memberships (owner of restaurant X, waiter at branch B of restaurant Y); each is its own row.';
COMMENT ON COLUMN public.staff.permissions IS
  'Fine-grained overrides for MANAGER ("menu/tables/orders/staff per permission", brief §16), e.g. {"menu":true,"staff":false,"analytics":true}. Absent keys fall back to the role default table in 02-rls-and-authorization.md. Ignored for the other roles, whose capability set is fixed.';
COMMENT ON COLUMN public.staff.display_name IS
  'Name shown on kitchen/waiter tickets ("Aziz"), which is often a short first name rather than profiles.full_name. NULL falls back to profiles.full_name.';
COMMENT ON COLUMN public.staff.is_active IS
  'Deactivating a membership must never delete it: order_status_history and waiter_calls reference staff rows and a former employee''s actions must remain attributable.';
```

**Modelling waiter-on-one-branch vs manager-across-branches (explicit answer):**

| Role | `branch_id` | Enforced by | Meaning |
|------|-------------|-------------|---------|
| `RESTAURANT_OWNER` | must be `NULL` | `ck_staff_role_scope` | Whole tenant, all branches. |
| `MANAGER` | `NULL` **or** a branch | `ck_staff_role_scope` (permits both) | `NULL` = multi-branch manager; set = single-branch manager. |
| `WAITER` | must be `NOT NULL` | `ck_staff_role_scope` | One branch. Brief §10/§34.6: a waiter sees only their assigned branch. |
| `KITCHEN` | must be `NOT NULL` | `ck_staff_role_scope` | One branch — a KDS is a physical screen in one kitchen. |

`ck_staff_role_scope` guarantees *at least one* branch for `WAITER`/`KITCHEN`. The partial unique index
`uq_staff_operational_single_branch` guarantees *at most one*: it makes `(restaurant_id, profile_id, role)`
unique for those two roles, so a person cannot hold two `WAITER` rows pointing at two branches of the
same restaurant. Together they mean **exactly one**. A `MANAGER` is excluded from that index and may
therefore hold several branch-pinned manager rows, or one restaurant-wide row.

`uq_staff_membership` uses `UNIQUE NULLS NOT DISTINCT` (PG 15+) so that two restaurant-wide
`MANAGER` rows for the same person — both with `branch_id IS NULL` — collide instead of silently
duplicating, which the SQL-standard NULL-distinct behaviour would allow.

### 6.5 `tables` — physical tables and their QR tokens

```sql
CREATE TABLE public.tables (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      UUID        NOT NULL,
  branch_id          UUID        NOT NULL,

  number             TEXT        NOT NULL,
  name               TEXT,
  zone               TEXT,
  seats              SMALLINT,
  sort_order         INTEGER     NOT NULL DEFAULT 0,

  qr_token           TEXT        NOT NULL DEFAULT public.generate_qr_token(),
  qr_token_issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_rotation_count  INTEGER     NOT NULL DEFAULT 0,

  is_active          BOOLEAN     NOT NULL DEFAULT true,

  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_tables_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_tables_qr_token        UNIQUE (qr_token),
  CONSTRAINT uq_tables_tenant          UNIQUE (restaurant_id, id),
  CONSTRAINT uq_tables_branch_identity UNIQUE (branch_id, id),

  CONSTRAINT ck_tables_number_format
    CHECK (number ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$'),

  CONSTRAINT ck_tables_name_len
    CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 60),

  CONSTRAINT ck_tables_zone_len
    CHECK (zone IS NULL OR char_length(btrim(zone)) BETWEEN 1 AND 40),

  CONSTRAINT ck_tables_seats_range
    CHECK (seats IS NULL OR seats BETWEEN 1 AND 100),

  CONSTRAINT ck_tables_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_tables_qr_token_format
    CHECK (qr_token ~ '^[A-Za-z0-9_-]{22,64}$'),

  CONSTRAINT ck_tables_qr_rotation_count_non_negative
    CHECK (qr_rotation_count >= 0)
);

CREATE UNIQUE INDEX uq_tables_branch_number
  ON public.tables (branch_id, number)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE  public.tables IS
  'A physical table. The QR token on this row is the ONLY public entry point into the whole system (brief §3, §14): token -> table -> branch -> restaurant.';
COMMENT ON COLUMN public.tables.number IS
  'Human table designation as printed on the table tent: "12", "A4", "Terrace 2". TEXT, not INTEGER, because real venues number tables alphanumerically by zone. Unique per branch among non-deleted rows (uq_tables_branch_number).';
COMMENT ON COLUMN public.tables.name IS
  'Optional descriptive label ("Window booth"). The customer welcome screen shows number first and name as a subtitle.';
COMMENT ON COLUMN public.tables.sort_order IS
  'Display order in the admin table grid and the waiter console floor list. CHECK >= 0.';
COMMENT ON COLUMN public.tables.qr_token IS
  'Cryptographically random, URL-safe, 144-bit public token (brief §13, §34.9). Appears in the public URL as /t/<qr_token>. UNIQUE across the ENTIRE platform, not per tenant, because the resolver looks it up with no other context. Never sequential, never derived from any id. Regenerating writes the old value into qr_token_history and increments qr_rotation_count.';
COMMENT ON COLUMN public.tables.qr_token_issued_at IS
  'When the CURRENT token was minted. Drives the "QR printed on" line of the downloadable QR sheet and lets an operator see which tables still carry a stale print run.';
COMMENT ON COLUMN public.tables.qr_rotation_count IS
  'How many times this table''s QR has been regenerated. Maintained by trg_tables_rotate_qr_token; never written by application code.';
COMMENT ON COLUMN public.tables.is_active IS
  'A false value keeps the token resolvable but makes the resolver return the "table inactive" state (brief §32) instead of the menu. Deactivating is NOT the same as revoking the token.';
COMMENT ON COLUMN public.tables.deleted_at IS
  'Soft delete. Hard deletion is forbidden while orders reference the table (fk_orders_table is ON DELETE RESTRICT); retiring a table sets this and the resolver treats it as an unknown table.';
```

### 6.6 `qr_token_history` — retired tokens (recommended: YES, and here is why)

**Decision: keep a full history table, not a `revoked` boolean on a merged token table.**

The alternatives and why they lose:

| Option | Verdict |
|---|---|
| Overwrite `tables.qr_token` and keep nothing | Rejected. A guest with a printed old QR gets an indistinguishable **404**, so the app cannot say "this QR was replaced, ask staff" (brief §32 demands a real state for invalid QR). Worse, nothing prevents a future random token from colliding with a historical one and silently re-activating an old print run. |
| One `qr_tokens` table with `is_active`, `tables.qr_token` removed | Rejected on the hot path. Every single public request would join `tables → qr_tokens`; keeping the active token *on* `tables` makes resolution one index lookup on one table. |
| **`tables.qr_token` (active, hot path) + `qr_token_history` (retired, audit path)** | **Chosen.** One-index resolution for the 99% case, an explicit `410 Gone` for the retired case, a full audit trail of who rotated what and when, and a trigger-enforced guarantee that a retired token is never re-issued. |

```sql
CREATE TABLE public.qr_token_history (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID        NOT NULL,
  branch_id           UUID        NOT NULL,
  table_id            UUID        NOT NULL,

  token               TEXT        NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by          UUID,
  revoke_reason       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_qr_token_history_table
    FOREIGN KEY (branch_id, table_id)
    REFERENCES public.tables (branch_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_qr_token_history_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_qr_token_history_revoked_by
    FOREIGN KEY (revoked_by) REFERENCES public.profiles (id) ON DELETE SET NULL,

  CONSTRAINT uq_qr_token_history_token UNIQUE (token),

  CONSTRAINT ck_qr_token_history_token_format
    CHECK (token ~ '^[A-Za-z0-9_-]{22,64}$'),

  CONSTRAINT ck_qr_token_history_revoke_reason_len
    CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),

  CONSTRAINT ck_qr_token_history_time_order
    CHECK (revoked_at >= issued_at)
);

COMMENT ON TABLE  public.qr_token_history IS
  'Every QR token this platform has ever retired. Two jobs: (1) let the /t/<token> resolver answer 410 Gone with a useful message instead of 404 for a token from an old print run (brief §14, §34.10); (2) guarantee no token is ever re-issued - trg_tables_prevent_token_reuse rejects any tables.qr_token that appears here.';
COMMENT ON COLUMN public.qr_token_history.token IS
  'The retired token value. UNIQUE platform-wide, mirroring uq_tables_qr_token. Cross-table uniqueness (a token being in exactly one of the two tables) cannot be a single constraint in PostgreSQL, so it is enforced by trg_tables_prevent_token_reuse on insert/update of tables.qr_token.';
COMMENT ON COLUMN public.qr_token_history.revoked_by IS
  'Profile that performed the rotation, read from the app.actor_profile_id transaction setting by trg_tables_rotate_qr_token. NULL for system rotations.';
COMMENT ON COLUMN public.qr_token_history.revoke_reason IS
  'Free-text operator note ("reprinted after refurbishment", "QR sticker damaged"). Shown in the table audit drawer of the admin panel.';
```

**Resolver contract for `/t/[token]`** (implemented in `src/lib/qr/resolve-token.ts`):

1. `SELECT ... FROM tables WHERE qr_token = $1 AND deleted_at IS NULL` → found ⇒ continue.
2. Not found ⇒ `SELECT 1 FROM qr_token_history WHERE token = $1` → found ⇒ HTTP **410**, UI state
   `QR_REPLACED`.
3. Neither ⇒ HTTP **404**, UI state `QR_INVALID`.
4. Found but `tables.is_active = false` ⇒ UI state `TABLE_INACTIVE`.
5. Found but `branches.is_active = false` or `restaurants.is_active = false` ⇒ UI state
   `BRANCH_CLOSED` / `RESTAURANT_UNAVAILABLE`.

All five are distinct screens per brief §32. Steps 1–5 are a single query joining
`tables → branches → restaurants` plus, only on miss, one lookup in `qr_token_history`.

### 6.7 `menu_categories`

```sql
CREATE TABLE public.menu_categories (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL,
  branch_id      UUID,

  name           public.i18n_text NOT NULL,
  description    public.i18n_text,
  image_url      TEXT,
  image_path     TEXT,
  icon           TEXT,

  sort_order     INTEGER     NOT NULL DEFAULT 0,
  is_active      BOOLEAN     NOT NULL DEFAULT true,

  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_menu_categories_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_menu_categories_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_menu_categories_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_menu_categories_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_menu_categories_icon_format
    CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{1,40}$'),

  CONSTRAINT ck_menu_categories_urls_len
    CHECK (
      (image_url  IS NULL OR char_length(image_url)  <= 1024) AND
      (image_path IS NULL OR char_length(image_path) <= 512)
    )
);

COMMENT ON TABLE  public.menu_categories IS
  'Menu sections (Popular, Uzbek Cuisine, Fast Food, Salads, Drinks, Desserts - brief §4). Reorderable and deactivatable per brief §12.';
COMMENT ON COLUMN public.menu_categories.branch_id IS
  'NULL = the category exists at every branch of the restaurant (the common case for a chain with one menu). NOT NULL = branch-exclusive category. The composite FK is MATCH SIMPLE, so NULL skips the branch check while fk_menu_categories_restaurant still pins the tenant.';
COMMENT ON COLUMN public.menu_categories.sort_order IS
  'Ascending display order, ties broken by name. CHECK >= 0. Reordering in the admin panel rewrites this column for the affected rows in one transaction.';
COMMENT ON COLUMN public.menu_categories.icon IS
  'Kebab-case key into the client icon registry (e.g. "flame", "leaf", "cup"). A key, never markup or a URL - the customer app must not render arbitrary strings as icons.';
COMMENT ON COLUMN public.menu_categories.is_active IS
  'Deactivating hides the category and, transitively, its items from the customer app. It does not cascade to menu_items.is_available - the two switches are independent and the orderability rule in §6.8 ANDs them.';
```

### 6.8 `menu_items`

```sql
CREATE TABLE public.menu_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID        NOT NULL,
  branch_id           UUID,
  category_id         UUID        NOT NULL,

  name                public.i18n_text NOT NULL,
  description         public.i18n_text,
  ingredients         public.i18n_text,

  price               public.money_minor NOT NULL,
  compare_at_price    public.money_minor,

  image_url           TEXT,
  image_path          TEXT,

  spicy_level         SMALLINT    NOT NULL DEFAULT 0,
  preparation_time    SMALLINT    NOT NULL DEFAULT 15,
  calories            INTEGER,
  dietary_tags        public.dietary_tag[] NOT NULL DEFAULT '{}',

  is_available        BOOLEAN     NOT NULL DEFAULT true,
  unavailable_until   TIMESTAMPTZ,
  available_from      TIME,
  available_until     TIME,

  is_featured         BOOLEAN     NOT NULL DEFAULT false,
  is_popular          BOOLEAN     NOT NULL DEFAULT false,
  popularity_score    INTEGER     NOT NULL DEFAULT 0,

  sort_order          INTEGER     NOT NULL DEFAULT 0,

  search_vector       tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple',
                          coalesce((name::jsonb)        ->> 'uz', '') || ' ' ||
                          coalesce((name::jsonb)        ->> 'ru', '') || ' ' ||
                          coalesce((name::jsonb)        ->> 'en', '') || ' ' ||
                          coalesce((description::jsonb) ->> 'uz', '') || ' ' ||
                          coalesce((description::jsonb) ->> 'ru', '') || ' ' ||
                          coalesce((description::jsonb) ->> 'en', '')
                        )
                      ) STORED,

  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_menu_items_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_menu_items_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_menu_items_category
    FOREIGN KEY (restaurant_id, category_id)
    REFERENCES public.menu_categories (restaurant_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT uq_menu_items_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_menu_items_spicy_level_range
    CHECK (spicy_level BETWEEN 0 AND 3),

  CONSTRAINT ck_menu_items_preparation_time_range
    CHECK (preparation_time BETWEEN 1 AND 240),

  CONSTRAINT ck_menu_items_calories_range
    CHECK (calories IS NULL OR (calories >= 0 AND calories <= 20000)),

  CONSTRAINT ck_menu_items_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_menu_items_popularity_score_non_negative
    CHECK (popularity_score >= 0),

  CONSTRAINT ck_menu_items_compare_at_price_higher
    CHECK (compare_at_price IS NULL OR compare_at_price > price),

  CONSTRAINT ck_menu_items_daypart_pair
    CHECK ((available_from IS NULL) = (available_until IS NULL)),

  CONSTRAINT ck_menu_items_daypart_order
    CHECK (available_from IS NULL OR available_from < available_until),

  CONSTRAINT ck_menu_items_unavailable_until_requires_unavailable
    CHECK (unavailable_until IS NULL OR is_available = false),

  CONSTRAINT ck_menu_items_dietary_tags_no_nulls
    CHECK (array_position(dietary_tags, NULL) IS NULL),

  CONSTRAINT ck_menu_items_urls_len
    CHECK (
      (image_url  IS NULL OR char_length(image_url)  <= 1024) AND
      (image_path IS NULL OR char_length(image_path) <= 512)
    )
);

COMMENT ON TABLE  public.menu_items IS
  'A dish. The centre of the customer experience (brief §5, §6) and the source of every order_items snapshot.';
COMMENT ON COLUMN public.menu_items.price IS
  'Base price in MINOR CURRENCY UNITS of restaurants.currency (UZS, currency_decimals=0, so 45000 means 45 000 so''m). Exact BIGINT integer; never a float. CHECK >= 0 via the money_minor domain. This is the ONLY authoritative price: brief §7 and §34.2 require the server to recompute every total from this column and to ignore any price sent by the client.';
COMMENT ON COLUMN public.menu_items.compare_at_price IS
  'Optional strike-through "was" price in MINOR CURRENCY UNITS, for promotional display only. CHECK forces it strictly above price so a "discount" can never read as an increase.';
COMMENT ON COLUMN public.menu_items.branch_id IS
  'NULL = the dish is sold at every branch. NOT NULL = branch-exclusive. Must be no wider than its category''s scope; trg_menu_items_scope_consistency enforces that a branch-scoped category cannot hold a restaurant-wide item.';
COMMENT ON COLUMN public.menu_items.spicy_level IS
  'Ordinal heat scale: 0 = not spicy, 1 = mild, 2 = medium, 3 = hot. SMALLINT rather than an enum because the customer filter is a range query (spicy_level <= 1) and the UI renders it as N chilli glyphs. CHECK 0..3.';
COMMENT ON COLUMN public.menu_items.preparation_time IS
  'Expected preparation time in MINUTES. Shown on the product detail sheet (brief §6) and summed into orders.estimated_prep_minutes, which sets orders.due_at and therefore the KDS late flag.';
COMMENT ON COLUMN public.menu_items.dietary_tags IS
  'Closed set of dietary markers as an enum array. GIN-indexed (idx_menu_items_dietary_tags) so the customer filter "vegetarian AND gluten_free" is a single containment query dietary_tags @> ARRAY[...]::dietary_tag[].';
COMMENT ON COLUMN public.menu_items.is_available IS
  'The hard availability switch (brief §12). false = cannot be ordered, and the card renders in the visually-distinct unavailable style (brief §5) rather than disappearing.';
COMMENT ON COLUMN public.menu_items.unavailable_until IS
  'Temporary 86-ing with an automatic return: "out of lamb until 18:00". Only meaningful while is_available = false (enforced by CHECK). The orderability rule treats an item as back in stock once now() >= unavailable_until, so staff do not have to remember to flip the switch back.';
COMMENT ON COLUMN public.menu_items.available_from IS
  'Start of the daily serving window (daypart), as a LOCAL time interpreted in branches.timezone. NULL = all day. Paired with available_until by CHECK. Breakfast items are the motivating case.';
COMMENT ON COLUMN public.menu_items.available_until IS
  'End of the daily serving window, local time in branches.timezone. Windows do not wrap past midnight (CHECK available_from < available_until); a late-night menu is modelled as a separate branch-scoped category.';
COMMENT ON COLUMN public.menu_items.is_featured IS
  'Editorial pick. Drives the "featured food" hero rail on the customer home (brief §4). Manually curated by staff - never computed.';
COMMENT ON COLUMN public.menu_items.is_popular IS
  'Manual override forcing a dish into the "popular dishes" rail (brief §4) regardless of sales. Sorting is: is_popular DESC, popularity_score DESC, sort_order ASC.';
COMMENT ON COLUMN public.menu_items.popularity_score IS
  'Computed sales rank over a trailing window, refreshed by the analytics job (owned by 06-analytics.md); never written by request handlers. Kept as a plain column rather than a materialized view so the customer menu query needs no extra join.';
COMMENT ON COLUMN public.menu_items.search_vector IS
  'Stored generated tsvector over all six translated name/description strings using the ''simple'' configuration (no stemming dictionary, which is correct for mixed Latin-Uzbek / Cyrillic-Russian / English text). Queried with to_tsquery(''simple'', <term> || '':*'') for as-you-type prefix search. GIN-indexed by idx_menu_items_search_vector.';
COMMENT ON COLUMN public.menu_items.deleted_at IS
  'Soft delete. Hard deletion is avoided because order_items references this row; if a hard delete ever happens, fk_order_items_menu_item nulls ONLY menu_item_id and the order_items snapshots keep the historical record intact (brief §34.4).';
```

**Orderability rule (binding, single definition).** A `menu_items` row may be added to a cart or an
order if and only if all of the following hold, where `tz` is `branches.timezone` of the ordering branch
and `local_now = (now() AT TIME ZONE tz)`:

```sql
    menu_items.deleted_at IS NULL
AND (
      menu_items.is_available = true
      OR (menu_items.unavailable_until IS NOT NULL AND now() >= menu_items.unavailable_until)
    )
AND (
      menu_items.available_from IS NULL
      OR local_now::time >= menu_items.available_from
         AND local_now::time <= menu_items.available_until
    )
AND (menu_items.branch_id IS NULL OR menu_items.branch_id = <ordering branch id>)
AND menu_categories.is_active = true
AND menu_categories.deleted_at IS NULL
AND branches.is_active = true
AND branches.is_accepting_orders = true
AND restaurants.is_active = true
```

Implemented once in `src/lib/menu/orderability.ts` and mirrored as a **database backstop** by
`trg_order_items_item_orderable` (§7.9), which checks the timezone-independent clauses only
(`deleted_at`, `is_available`, `unavailable_until`). Dayparts stay in the application because the
backstop must not reject a legitimate retroactive correction to an order placed inside the window.

### 6.9 `menu_item_options` — extras, sizes, modifiers

The brief names exactly one table for extras. Rather than introduce a `menu_item_option_groups` table,
group-level attributes are carried **on every option row** and kept identical across a group by
`trg_menu_item_options_group_consistency` (§7.8). This keeps the brief's table list exact while making
the denormalisation safe — the trigger is the consistency constraint that a separate table would have
provided for free.

```sql
CREATE TABLE public.menu_item_options (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  menu_item_id      UUID        NOT NULL,

  group_key         TEXT        NOT NULL DEFAULT 'extras',
  group_label       public.i18n_text NOT NULL,
  selection_type    public.option_selection_type NOT NULL DEFAULT 'multiple',
  group_min_select  SMALLINT    NOT NULL DEFAULT 0,
  group_max_select  SMALLINT,
  group_sort_order  INTEGER     NOT NULL DEFAULT 0,

  name              public.i18n_text NOT NULL,
  price_delta       public.money_minor NOT NULL DEFAULT 0,
  max_quantity      SMALLINT    NOT NULL DEFAULT 1,

  is_default        BOOLEAN     NOT NULL DEFAULT false,
  is_available      BOOLEAN     NOT NULL DEFAULT true,
  sort_order        INTEGER     NOT NULL DEFAULT 0,

  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_menu_item_options_item
    FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES public.menu_items (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_menu_item_options_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_menu_item_options_group_key_format
    CHECK (group_key ~ '^[a-z0-9_]{1,32}$'),

  CONSTRAINT ck_menu_item_options_min_select_range
    CHECK (group_min_select BETWEEN 0 AND 20),

  CONSTRAINT ck_menu_item_options_max_select_range
    CHECK (group_max_select IS NULL OR (group_max_select >= 1 AND group_max_select <= 20)),

  CONSTRAINT ck_menu_item_options_select_bounds
    CHECK (group_max_select IS NULL OR group_max_select >= group_min_select),

  CONSTRAINT ck_menu_item_options_single_select_bounds
    CHECK (selection_type <> 'single' OR (group_max_select = 1 AND max_quantity = 1)),

  CONSTRAINT ck_menu_item_options_max_quantity_range
    CHECK (max_quantity BETWEEN 1 AND 20),

  CONSTRAINT ck_menu_item_options_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_menu_item_options_group_sort_order_non_negative
    CHECK (group_sort_order >= 0)
);

CREATE UNIQUE INDEX uq_menu_item_options_single_default
  ON public.menu_item_options (menu_item_id, group_key)
  WHERE selection_type = 'single' AND is_default AND deleted_at IS NULL;

COMMENT ON TABLE  public.menu_item_options IS
  'Optional extras and required choices for a dish (brief §6, §12): "Extra cheese +5000", "Size: Small / Large". Group-level attributes (group_label, selection_type, min/max select) are replicated onto every row of a group and kept consistent by trg_menu_item_options_group_consistency, so the brief''s single-table model holds without losing group semantics.';
COMMENT ON COLUMN public.menu_item_options.group_key IS
  'Stable machine key that partitions the options of one dish into groups ("size", "extras", "sauce"). All rows sharing (menu_item_id, group_key) MUST agree on group_label, selection_type, group_min_select, group_max_select and group_sort_order.';
COMMENT ON COLUMN public.menu_item_options.selection_type IS
  'single = radio group, the guest picks exactly one (a size); multiple = checkboxes (extras). ck_menu_item_options_single_select_bounds forces a single-select group to have group_max_select = 1 and max_quantity = 1, so "pick one size, twice" is unrepresentable.';
COMMENT ON COLUMN public.menu_item_options.group_min_select IS
  'Minimum options the guest must choose from this group. 1 makes the group mandatory (a size must be picked before ADD TO CART). Validated by the cart/order service, which reads it from any row of the group.';
COMMENT ON COLUMN public.menu_item_options.group_max_select IS
  'Maximum distinct options selectable from this group. NULL = unlimited (typical for extras).';
COMMENT ON COLUMN public.menu_item_options.price_delta IS
  'Price ADDED to the dish per single unit of this option, in MINOR CURRENCY UNITS (UZS: 5000 = 5 000 so''m). CHECK >= 0 via money_minor: options never reduce a price - a cheaper size is modelled as a lower base price on a separate item or as the zero-delta default of a single-select group.';
COMMENT ON COLUMN public.menu_item_options.max_quantity IS
  'How many of this one option may be attached to a single unit of the dish ("extra cheese x2"). 1 for the overwhelming majority; forced to 1 for single-select groups.';
COMMENT ON COLUMN public.menu_item_options.is_default IS
  'Pre-selected when the product sheet opens. uq_menu_item_options_single_default guarantees at most ONE default per single-select group, so a radio group can never open with two buttons lit.';
COMMENT ON COLUMN public.menu_item_options.is_available IS
  'Per-option 86-ing ("no bacon today") without hiding the dish. An unavailable option is rendered disabled, never removed, so the layout does not jump.';
```

### 6.10 `promotions`

The customer home shows "active promotions" (brief §4). This models them.

```sql
CREATE TABLE public.promotions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  branch_id         UUID,

  promo_type        public.promotion_type NOT NULL DEFAULT 'announcement',

  title             public.i18n_text NOT NULL,
  description       public.i18n_text,
  badge_label       public.i18n_text,

  image_url         TEXT,
  image_path        TEXT,

  discount_bps      public.bps,
  discount_amount   public.money_minor,
  special_price     public.money_minor,

  starts_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at           TIMESTAMPTZ,

  sort_order        INTEGER     NOT NULL DEFAULT 0,
  is_active         BOOLEAN     NOT NULL DEFAULT true,

  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_promotions_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_promotions_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_promotions_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_promotions_window_order
    CHECK (ends_at IS NULL OR ends_at > starts_at),

  CONSTRAINT ck_promotions_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_promotions_value_shape
    CHECK (
      CASE promo_type
        WHEN 'announcement'  THEN discount_bps IS NULL AND discount_amount IS NULL AND special_price IS NULL
        WHEN 'percentage'    THEN discount_bps IS NOT NULL AND discount_amount IS NULL AND special_price IS NULL
        WHEN 'fixed_amount'  THEN discount_bps IS NULL AND discount_amount IS NOT NULL AND special_price IS NULL
        WHEN 'special_price' THEN discount_bps IS NULL AND discount_amount IS NULL AND special_price IS NOT NULL
      END
    ),

  CONSTRAINT ck_promotions_percentage_range
    CHECK (discount_bps IS NULL OR discount_bps BETWEEN 1 AND 10000),

  CONSTRAINT ck_promotions_urls_len
    CHECK (
      (image_url  IS NULL OR char_length(image_url)  <= 1024) AND
      (image_path IS NULL OR char_length(image_path) <= 512)
    )
);

COMMENT ON TABLE  public.promotions IS
  'Campaigns surfaced on the customer home rail (brief §4 "active promotions"). MVP SCOPE: promotions are DISPLAY-ONLY. The order pricing service does not auto-apply them; orders.discount_total is written as 0. The numeric columns exist so a later pricing engine has a schema to read instead of a migration to write.';
COMMENT ON COLUMN public.promotions.promo_type IS
  'Selects which value column must be populated; ck_promotions_value_shape makes every other combination unrepresentable, so a "percentage" promotion with a NULL percentage cannot exist.';
COMMENT ON COLUMN public.promotions.branch_id IS
  'NULL = the promotion runs at every branch. NOT NULL = one branch only (a grand-opening offer).';
COMMENT ON COLUMN public.promotions.badge_label IS
  'Short overlay text for the item card ("-20%", "YANGI", "НОВИНКА"). Translatable because it is customer-visible; kept separate from title so the card badge is not a truncated headline.';
COMMENT ON COLUMN public.promotions.discount_bps IS
  'Percentage discount in basis points (2000 = 20.00%) for promo_type = percentage. Basis points, not NUMERIC percent, so that any future discount arithmetic stays integral: discount = round(base * discount_bps / 10000).';
COMMENT ON COLUMN public.promotions.discount_amount IS
  'Flat discount in MINOR CURRENCY UNITS for promo_type = fixed_amount (UZS: 10000 = 10 000 so''m off).';
COMMENT ON COLUMN public.promotions.special_price IS
  'Replacement price in MINOR CURRENCY UNITS for promo_type = special_price ("this dish is 39 000 so''m this week").';
COMMENT ON COLUMN public.promotions.starts_at IS
  'Campaign start. "Active" is evaluated as is_active AND deleted_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()); idx_promotions_active_window serves exactly that predicate.';
COMMENT ON COLUMN public.promotions.ends_at IS
  'Campaign end, exclusive. NULL = open-ended. CHECK forces it strictly after starts_at, so an empty window is unrepresentable.';
```

### 6.11 `promotion_items` — which dishes a promotion covers

```sql
CREATE TABLE public.promotion_items (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL,
  promotion_id   UUID        NOT NULL,
  menu_item_id   UUID        NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_promotion_items_promotion
    FOREIGN KEY (restaurant_id, promotion_id)
    REFERENCES public.promotions (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_promotion_items_menu_item
    FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES public.menu_items (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_promotion_items_pair UNIQUE (promotion_id, menu_item_id)
);

COMMENT ON TABLE  public.promotion_items IS
  'Many-to-many link from a promotion to the dishes it covers. An empty set means the promotion is a whole-menu banner. Both FKs are composite on restaurant_id, so a promotion can never be attached to another tenant''s dish (Invariant T1).';
COMMENT ON COLUMN public.promotion_items.restaurant_id IS
  'Denormalised tenant key. Present so both foreign keys can be composite and so the RLS policy is a single-column predicate rather than a two-hop join.';
```

### 6.12 `branch_order_counters` — the race-safe daily order-number sequence

**Requirement.** A human-friendly order number, unique and restarting daily **per branch**, in the form
`A-014` (branch code `A`, the 14th order of that branch today), race-safe under concurrent inserts, with
`orders.id` remaining a separate, opaque UUID (brief §25: "Order number human-friendly, internal id separate").

**Design chosen: an upsert counter table with `INSERT ... ON CONFLICT DO UPDATE ... RETURNING`.**

```sql
CREATE TABLE public.branch_order_counters (
  branch_id      UUID        NOT NULL,
  business_date  DATE        NOT NULL,
  last_number    INTEGER     NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_branch_order_counters PRIMARY KEY (branch_id, business_date),

  CONSTRAINT fk_branch_order_counters_branch
    FOREIGN KEY (branch_id) REFERENCES public.branches (id) ON DELETE CASCADE,

  CONSTRAINT ck_branch_order_counters_last_number_positive
    CHECK (last_number >= 0)
);

COMMENT ON TABLE  public.branch_order_counters IS
  'One counter row per branch per local business date. DELIBERATE EXCEPTION to the uuid-id rule: this is not a business entity, it is a concurrency primitive, and its natural key (branch_id, business_date) IS the lock identity. Adding a surrogate uuid would let two counter rows exist for the same branch-day, which is precisely the illegal state this table exists to prevent.';
COMMENT ON COLUMN public.branch_order_counters.business_date IS
  'The LOCAL calendar date at the branch, computed as (now() AT TIME ZONE branches.timezone)::date. Local, not UTC: a Tashkent branch open until 02:00 must keep numbering the same evening rather than rolling to #A-001 at 05:00 local when UTC midnight passes.';
COMMENT ON COLUMN public.branch_order_counters.last_number IS
  'Highest sequence number issued for this branch-day. Written only by public.next_order_number(); no application code touches this table directly.';
```

**How the race is won — exactly.** `public.next_order_number()` (§5, body repeated here for the
argument) performs a single statement:

```sql
INSERT INTO public.branch_order_counters AS c (branch_id, business_date, last_number)
VALUES (p_branch_id, v_date, 1)
ON CONFLICT (branch_id, business_date)
DO UPDATE SET last_number = c.last_number + 1,
              updated_at  = now()
RETURNING c.last_number INTO v_seq;
```

- **First order of the day:** the `INSERT` path wins and returns `1`. If two transactions race to
  insert the *same* new key, one gets a unique-violation internally, is converted by `ON CONFLICT` into
  the `DO UPDATE` path, and blocks on the other's row lock. Exactly one gets `1`, the other gets `2`.
- **Every later order:** `DO UPDATE` takes a `FOR UPDATE` row lock on `(branch_id, business_date)`.
  Concurrent transactions serialise on that one row and each receives a distinct `last_number`.
  This is correct at `READ COMMITTED` — `ON CONFLICT DO UPDATE` re-reads the locked row before applying
  the `SET`, so `c.last_number` is never a stale snapshot value.
- **Rollback behaviour:** if the surrounding transaction aborts, the counter increment aborts with it,
  so **no gap** is created. This is the property a `SEQUENCE` cannot give.
- **Contention cost:** the serialisation point is one row per branch per day. A branch turning 1 000
  covers a day holds that lock for microseconds per order. Cross-branch and cross-tenant traffic never
  contend, because the lock is per `(branch_id, business_date)`.

**Alternatives considered and rejected:**

| Alternative | Why rejected |
|---|---|
| `SELECT max(order_seq) + 1 FROM orders WHERE ...` | Not race-safe at `READ COMMITTED`: two concurrent readers both see the same max and produce duplicate numbers. Only `SERIALIZABLE` would save it, at the cost of retry storms on the hottest write path in the product. |
| One `SEQUENCE` per branch (`CREATE SEQUENCE ...` at branch creation) | Requires runtime DDL from application code (a privilege the app should not hold), cannot be reset daily without `setval` races, and sequences are **non-transactional**: every rolled-back order permanently burns a number, so the kitchen sees `#A-014` then `#A-017`. |
| `pg_advisory_xact_lock(hashtext(branch_id::text || date))` around a `max()` query | Works, but `hashtext` is 32-bit and two branch-days *will* eventually collide, silently serialising unrelated branches. It also leaves no durable record of the counter, so the number cannot be audited or manually corrected. The lock is strictly more machinery than the upsert for strictly less information. |
| A global daily sequence shared across branches | Violates the requirement (numbers must restart per branch) and makes the number meaningless on a kitchen ticket. |

**Format.** `order_number = branches.code || '-' || lpad(order_seq::text, 3, '0')` → `A-014`.
The UI prefixes `#` for display (`#A-014`); the `#` is **not** stored. Past 999 orders in one branch-day
the number simply widens to `A-1000`, which `lpad` handles without truncation.

**Uniqueness.** Guaranteed twice: by the counter's primary key (the source), and by
`uq_orders_branch_day_seq UNIQUE (branch_id, business_date, order_seq)` on `orders` (the destination).
If a future code path ever bypasses `next_order_number()`, the second constraint turns a silent
duplicate into a hard `23505`.

### 6.13 `orders`

```sql
CREATE TABLE public.orders (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id             UUID        NOT NULL,
  branch_id                 UUID        NOT NULL,
  table_id                  UUID,

  public_code               TEXT        NOT NULL DEFAULT public.generate_public_code(),

  order_number              TEXT        NOT NULL,
  order_seq                 INTEGER     NOT NULL,
  business_date             DATE        NOT NULL,

  order_type                public.order_type    NOT NULL DEFAULT 'dine_in',
  channel                   public.order_channel NOT NULL DEFAULT 'qr',
  status                    public.order_status  NOT NULL DEFAULT 'pending',

  customer_session_id       UUID,
  customer_name             TEXT,
  customer_phone            TEXT,
  customer_note             TEXT,
  guest_count               SMALLINT,
  locale                    public.app_locale NOT NULL DEFAULT 'uz',

  currency                  CHAR(3)     NOT NULL,
  currency_decimals         SMALLINT    NOT NULL,

  subtotal                  public.money_minor NOT NULL DEFAULT 0,
  discount_total            public.money_minor NOT NULL DEFAULT 0,
  service_fee               public.money_minor NOT NULL DEFAULT 0,
  service_fee_bps           public.bps  NOT NULL DEFAULT 0,
  total                     public.money_minor NOT NULL DEFAULT 0,

  estimated_prep_minutes    SMALLINT    NOT NULL DEFAULT 15,
  due_at                    TIMESTAMPTZ,

  placed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at              TIMESTAMPTZ,
  preparing_at              TIMESTAMPTZ,
  ready_at                  TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,

  cancellation_reason       TEXT,
  confirmed_by_staff_id     UUID,
  served_by_staff_id        UUID,
  cancelled_by_staff_id     UUID,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_orders_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_orders_table
    FOREIGN KEY (branch_id, table_id)
    REFERENCES public.tables (branch_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_orders_confirmed_by_staff
    FOREIGN KEY (restaurant_id, confirmed_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (confirmed_by_staff_id),

  CONSTRAINT fk_orders_served_by_staff
    FOREIGN KEY (restaurant_id, served_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (served_by_staff_id),

  CONSTRAINT fk_orders_cancelled_by_staff
    FOREIGN KEY (restaurant_id, cancelled_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (cancelled_by_staff_id),

  CONSTRAINT uq_orders_tenant           UNIQUE (restaurant_id, id),
  CONSTRAINT uq_orders_public_code      UNIQUE (public_code),
  CONSTRAINT uq_orders_branch_day_seq   UNIQUE (branch_id, business_date, order_seq),
  CONSTRAINT uq_orders_branch_day_number UNIQUE (branch_id, business_date, order_number),

  CONSTRAINT ck_orders_public_code_format
    CHECK (public_code ~ '^[A-Za-z0-9_-]{10,32}$'),

  CONSTRAINT ck_orders_order_number_format
    CHECK (order_number ~ '^[A-Z][A-Z0-9]{0,3}-[0-9]{3,6}$'),

  CONSTRAINT ck_orders_order_seq_positive
    CHECK (order_seq >= 1),

  CONSTRAINT ck_orders_table_required
    CHECK (order_type <> 'dine_in' OR table_id IS NOT NULL),

  CONSTRAINT ck_orders_totals_arithmetic
    CHECK (total = subtotal - discount_total + service_fee),

  CONSTRAINT ck_orders_discount_within_subtotal
    CHECK (discount_total <= subtotal),

  CONSTRAINT ck_orders_currency_format
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT ck_orders_currency_decimals_range
    CHECK (currency_decimals BETWEEN 0 AND 4),

  CONSTRAINT ck_orders_guest_count_range
    CHECK (guest_count IS NULL OR guest_count BETWEEN 1 AND 100),

  CONSTRAINT ck_orders_estimated_prep_range
    CHECK (estimated_prep_minutes BETWEEN 1 AND 480),

  CONSTRAINT ck_orders_customer_note_len
    CHECK (customer_note IS NULL OR char_length(customer_note) <= 500),

  CONSTRAINT ck_orders_customer_name_len
    CHECK (customer_name IS NULL OR char_length(btrim(customer_name)) BETWEEN 1 AND 80),

  CONSTRAINT ck_orders_customer_phone_format
    CHECK (customer_phone IS NULL OR customer_phone ~ '^\+?[0-9 ()-]{5,24}$'),

  CONSTRAINT ck_orders_cancellation_reason_len
    CHECK (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 300),

  CONSTRAINT ck_orders_cancelled_shape
    CHECK (
      (status = 'cancelled')
      = (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
    ),

  CONSTRAINT ck_orders_terminal_timestamps
    CHECK (
      (status <> 'completed' OR completed_at IS NOT NULL)
      AND (completed_at IS NULL OR delivered_at IS NOT NULL)
      AND (delivered_at  IS NULL OR ready_at     IS NOT NULL)
      AND (ready_at      IS NULL OR preparing_at IS NOT NULL)
      AND (preparing_at  IS NULL OR confirmed_at IS NOT NULL)
    ),

  CONSTRAINT ck_orders_qr_channel_has_session
    CHECK (channel <> 'qr' OR customer_session_id IS NOT NULL)
);

COMMENT ON TABLE  public.orders IS
  'One guest order. The pivot of the whole system: written by the public customer app, read live by the KDS and the waiter console, aggregated by the admin dashboard.';
COMMENT ON COLUMN public.orders.public_code IS
  'Unguessable 12-character public identifier used in the customer tracking URL /o/<public_code>. Exists so brief §3 ("public URL must not expose internal DB ids") holds for order tracking exactly as qr_token makes it hold for tables. Never shown to staff - they use order_number.';
COMMENT ON COLUMN public.orders.order_number IS
  'Human-friendly number, unique per branch per business_date: branches.code || ''-'' || lpad(order_seq,3,''0'') => "A-014". Displayed as #A-014. Assigned by trg_orders_assign_number; application code MUST NOT set it.';
COMMENT ON COLUMN public.orders.order_seq IS
  'The raw daily counter behind order_number, from public.next_order_number(). Kept as its own column so the KDS can sort numerically without parsing a string.';
COMMENT ON COLUMN public.orders.business_date IS
  'Local calendar date at the branch when the order was placed, in branches.timezone. The partition key of the daily numbering AND the grouping key of every "today" figure on the admin dashboard, so both agree by construction.';
COMMENT ON COLUMN public.orders.customer_session_id IS
  'Anonymous guest identity from an HttpOnly cookie set by the server on first QR scan. Brief §11 forbids customer accounts, yet the tracking page must show "my orders" and the rate limiter must recognise a repeat offender; this UUID does both without an account. Required for channel = qr (ck_orders_qr_channel_has_session), absent for staff-entered orders.';
COMMENT ON COLUMN public.orders.locale IS
  'Locale the guest was using when ordering. Lets a staff-facing reprint or a follow-up message address the guest in the language they chose.';
COMMENT ON COLUMN public.orders.currency IS
  'SNAPSHOT of restaurants.currency at order time. Snapshotted because a tenant may change currency and every historical total must keep rendering in the money it was actually taken in.';
COMMENT ON COLUMN public.orders.currency_decimals IS
  'SNAPSHOT of restaurants.currency_decimals at order time. The divisor (10^currency_decimals) needed to render this order''s minor-unit amounts.';
COMMENT ON COLUMN public.orders.subtotal IS
  'Sum of order_items.total, in MINOR CURRENCY UNITS. Computed exclusively on the server from menu_items.price (brief §7, §34.2); a client-supplied value is never trusted. Equality with the children is enforced at COMMIT by the deferred constraint trigger trg_orders_totals_consistent.';
COMMENT ON COLUMN public.orders.discount_total IS
  'Total discount applied, in MINOR CURRENCY UNITS. ALWAYS 0 in the MVP - promotions are display-only (§6.10). The column exists so the totals identity below is already correct when discounts arrive, instead of requiring a migration that rewrites every historical total. CHECK: 0 <= discount_total <= subtotal.';
COMMENT ON COLUMN public.orders.service_fee IS
  'Service charge in MINOR CURRENCY UNITS (brief §7). Derived, not free: trg_orders_totals_consistent asserts service_fee = round((subtotal - discount_total) * service_fee_bps / 10000).';
COMMENT ON COLUMN public.orders.service_fee_bps IS
  'SNAPSHOT of the effective service-fee rate in basis points (branch override, else restaurant default, else 0 when restaurants.service_fee_enabled is false). Snapshotted so changing the rate tomorrow cannot retroactively invalidate today''s totals.';
COMMENT ON COLUMN public.orders.total IS
  'Amount payable in MINOR CURRENCY UNITS. Bound by ck_orders_totals_arithmetic to total = subtotal - discount_total + service_fee, so a total inconsistent with its parts is not storable.';
COMMENT ON COLUMN public.orders.estimated_prep_minutes IS
  'Expected preparation time for the whole order: max(menu_items.preparation_time) across its lines, falling back to branches.default_prep_minutes. Set once at creation.';
COMMENT ON COLUMN public.orders.due_at IS
  'When the order is expected to be READY. Set to now() + estimated_prep_minutes at the pending->confirmed transition by trg_orders_status_guard. A PLAIN column, not GENERATED: timestamptz + interval is STABLE (not IMMUTABLE) in PostgreSQL and is therefore rejected in a generated-column expression.';
COMMENT ON COLUMN public.orders.placed_at IS
  'When the guest pressed PLACE ORDER. The KDS elapsed-time badge and the late flag (now() - placed_at > branches.late_order_threshold_minutes) both read this, never created_at, so a backfilled row cannot masquerade as a late order.';
COMMENT ON COLUMN public.orders.confirmed_at IS
  'Kitchen accepted the order. Set automatically by trg_orders_status_guard on entering confirmed; never written by application code.';
COMMENT ON COLUMN public.orders.preparing_at IS
  'Cooking started. Set automatically on entering preparing.';
COMMENT ON COLUMN public.orders.ready_at IS
  'Food is on the pass; this is the moment the waiter panel must light up (brief §28). Set automatically on entering ready.';
COMMENT ON COLUMN public.orders.delivered_at IS
  'Waiter put the food on the table. Set automatically on entering delivered.';
COMMENT ON COLUMN public.orders.completed_at IS
  'Order closed. Set automatically on entering completed.';
COMMENT ON COLUMN public.orders.cancelled_at IS
  'Set automatically on entering cancelled. ck_orders_cancelled_shape makes status = cancelled, cancelled_at and cancellation_reason a single atomic fact: an order cannot be cancelled without a reason, and cannot carry a reason without being cancelled.';
COMMENT ON COLUMN public.orders.cancellation_reason IS
  'Mandatory human explanation for a cancellation, surfaced to the guest on the tracking screen so a cancelled order is never an unexplained dead end (brief §32).';
COMMENT ON COLUMN public.orders.confirmed_by_staff_id IS
  'Kitchen staff member who accepted the order (brief §9 "accept order"). Composite FK on restaurant_id, so a foreign tenant''s staff row is unassignable. ON DELETE SET NULL names only this column, which PostgreSQL 15+ permits on a composite FK - without the column list the delete would try to null restaurant_id and violate NOT NULL.';
COMMENT ON COLUMN public.orders.served_by_staff_id IS
  'Waiter who delivered the order. Feeds per-waiter service analytics.';
COMMENT ON COLUMN public.orders.cancelled_by_staff_id IS
  'Staff member who cancelled. NULL when the guest cancelled their own pending order (channel = qr, actor_kind = customer).';
```

**The totals identity, stated once and enforced in three places:**

```
order_items.total          = quantity * (price_snapshot + options_total)     -- GENERATED column, §6.14
order_items.options_total  = SUM(order_item_options.total_per_unit)          -- deferred trigger, §7.6
orders.subtotal            = SUM(order_items.total)                          -- deferred trigger, §7.5
orders.service_fee         = round((subtotal - discount_total) * service_fee_bps / 10000)  -- deferred trigger, §7.5
orders.total               = subtotal - discount_total + service_fee         -- CHECK, immediate
```

### 6.14 `order_items` — order lines with mandatory snapshots

```sql
CREATE TABLE public.order_items (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id               UUID        NOT NULL,
  order_id                    UUID        NOT NULL,
  menu_item_id                UUID,

  name_snapshot               public.i18n_text NOT NULL,
  description_snapshot        public.i18n_text,
  category_name_snapshot      public.i18n_text,
  image_url_snapshot          TEXT,
  price_snapshot              public.money_minor NOT NULL,
  spicy_level_snapshot        SMALLINT    NOT NULL DEFAULT 0,
  preparation_time_snapshot   SMALLINT    NOT NULL DEFAULT 15,
  dietary_tags_snapshot       public.dietary_tag[] NOT NULL DEFAULT '{}',

  quantity                    INTEGER     NOT NULL,
  options_total               public.money_minor NOT NULL DEFAULT 0,

  total                       public.money_minor
                              GENERATED ALWAYS AS
                              (quantity::BIGINT * (price_snapshot + options_total)) STORED,

  note                        TEXT,
  sort_order                  INTEGER     NOT NULL DEFAULT 0,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_order_items_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_items_menu_item
    FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES public.menu_items (restaurant_id, id)
    ON DELETE SET NULL (menu_item_id),

  CONSTRAINT uq_order_items_tenant   UNIQUE (restaurant_id, id),
  CONSTRAINT uq_order_items_in_order UNIQUE (order_id, id),

  CONSTRAINT ck_order_items_quantity_positive
    CHECK (quantity > 0 AND quantity <= 999),

  CONSTRAINT ck_order_items_spicy_level_range
    CHECK (spicy_level_snapshot BETWEEN 0 AND 3),

  CONSTRAINT ck_order_items_prep_time_range
    CHECK (preparation_time_snapshot BETWEEN 1 AND 240),

  CONSTRAINT ck_order_items_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_order_items_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),

  CONSTRAINT ck_order_items_image_url_len
    CHECK (image_url_snapshot IS NULL OR char_length(image_url_snapshot) <= 1024),

  CONSTRAINT ck_order_items_dietary_tags_no_nulls
    CHECK (array_position(dietary_tags_snapshot, NULL) IS NULL)
);

COMMENT ON TABLE  public.order_items IS
  'One line of an order. Every customer-visible attribute is SNAPSHOTTED at order time. Brief §25 and §34.4 make this mandatory: renaming, repricing, 86-ing or deleting a dish must never alter what a historical order says was sold. A reader can render a complete kitchen ticket or receipt from this table alone, with menu_item_id NULL.';
COMMENT ON COLUMN public.order_items.menu_item_id IS
  'Link back to the live dish, for analytics ("most popular dishes"). NULLABLE and non-authoritative: it is a reference, not the record. ON DELETE SET NULL (menu_item_id) - the PG 15+ column-list form, needed because the FK is composite and nulling restaurant_id too would violate NOT NULL. Soft delete (menu_items.deleted_at) is the preferred path; this is the backstop.';
COMMENT ON COLUMN public.order_items.name_snapshot IS
  'Full trilingual name as it was at order time, e.g. {"uz":"Osh","ru":"Плов","en":"Plov"}. All three locales are captured in this one column, so a receipt reprinted for a Russian-speaking manager still renders correctly for an order taken in Uzbek.';
COMMENT ON COLUMN public.order_items.description_snapshot IS
  'Trilingual short description at order time. Kept so the guest-facing tracking screen and the reprinted receipt show the dish exactly as it was sold.';
COMMENT ON COLUMN public.order_items.category_name_snapshot IS
  'Trilingual category name at order time. Lets the kitchen ticket group lines by section (Starters / Mains / Drinks) even after the category is renamed or deleted.';
COMMENT ON COLUMN public.order_items.image_url_snapshot IS
  'Image URL at order time, for the cart and tracking views (brief §7 lists the image as part of a cart line). A URL, not a Storage path: the historical view must survive the object being replaced.';
COMMENT ON COLUMN public.order_items.price_snapshot IS
  'Unit base price in MINOR CURRENCY UNITS at order time, copied from menu_items.price by the server. This - not the live menu - is what the order was sold at. Never sourced from client input (brief §34.2).';
COMMENT ON COLUMN public.order_items.spicy_level_snapshot IS
  'Heat level 0..3 at order time, so the kitchen ticket carries the chilli marks that were promised to the guest.';
COMMENT ON COLUMN public.order_items.preparation_time_snapshot IS
  'Preparation minutes at order time, feeding orders.estimated_prep_minutes and the KDS timing without a join to a menu that may have changed.';
COMMENT ON COLUMN public.order_items.dietary_tags_snapshot IS
  'Dietary markers at order time. An allergy-relevant claim must be reproducible from the order record itself, not re-derived from a menu that has since been edited.';
COMMENT ON COLUMN public.order_items.quantity IS
  'Units of this dish on this line. CHECK quantity > 0 (a zero-quantity line is an illegal state - removal is a DELETE) and <= 999 as an abuse ceiling on an anonymous public write path.';
COMMENT ON COLUMN public.order_items.options_total IS
  'Sum of the chosen options'' per-unit price deltas for ONE unit of this line, in MINOR CURRENCY UNITS. Equality with the order_item_options children is asserted at COMMIT by trg_order_items_options_total_consistent.';
COMMENT ON COLUMN public.order_items.total IS
  'Line total in MINOR CURRENCY UNITS. A STORED GENERATED column: quantity * (price_snapshot + options_total). Generated rather than CHECK-validated so that an inconsistent line total is not merely rejected, it is unwritable. INSERT and UPDATE statements MUST NOT mention this column - PostgreSQL raises 428C9 if they do.';
COMMENT ON COLUMN public.order_items.note IS
  'Per-line customer instruction ("No onion", brief §6). Printed prominently on the kitchen ticket. Length-capped at 300 chars because it comes from an anonymous public client.';
COMMENT ON COLUMN public.order_items.sort_order IS
  'Order in which lines were added to the cart, preserved so the ticket and the receipt read the way the guest built the order. CHECK >= 0.';
```

> **Insert contract:** the order service inserts `order_items` **without** the `total` column, computes
> `options_total` as the sum of the option deltas it is about to insert, and updates `orders.subtotal`,
> `orders.service_fee` and `orders.total` in the **same transaction**. The deferred constraint triggers
> in §7.5–§7.6 verify all of it at `COMMIT`.

### 6.15 `order_item_options` — chosen extras, with snapshots

`order_items` alone cannot represent selected extras with historical accuracy: a line would have to
either concatenate option names into its own `name_snapshot` (destroying per-option pricing and making
"which extras cost what" unrecoverable) or point at live `menu_item_options` rows (which are edited,
repriced and deleted, breaking brief §34.4 the moment the menu changes). This table is the answer.

```sql
CREATE TABLE public.order_item_options (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id           UUID        NOT NULL,
  order_id                UUID        NOT NULL,
  order_item_id           UUID        NOT NULL,
  menu_item_option_id     UUID,

  group_key_snapshot      TEXT        NOT NULL,
  group_label_snapshot    public.i18n_text NOT NULL,
  name_snapshot           public.i18n_text NOT NULL,
  price_delta_snapshot    public.money_minor NOT NULL,

  quantity                SMALLINT    NOT NULL DEFAULT 1,

  total_per_unit          public.money_minor
                          GENERATED ALWAYS AS
                          (quantity::BIGINT * price_delta_snapshot) STORED,

  sort_order              INTEGER     NOT NULL DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_order_item_options_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_item_options_order_item
    FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_item_options_menu_item_option
    FOREIGN KEY (restaurant_id, menu_item_option_id)
    REFERENCES public.menu_item_options (restaurant_id, id)
    ON DELETE SET NULL (menu_item_option_id),

  CONSTRAINT uq_order_item_options_line_option
    UNIQUE NULLS NOT DISTINCT (order_item_id, menu_item_option_id),

  CONSTRAINT ck_order_item_options_quantity_positive
    CHECK (quantity > 0 AND quantity <= 20),

  CONSTRAINT ck_order_item_options_group_key_format
    CHECK (group_key_snapshot ~ '^[a-z0-9_]{1,32}$'),

  CONSTRAINT ck_order_item_options_sort_order_non_negative
    CHECK (sort_order >= 0)
);

COMMENT ON TABLE  public.order_item_options IS
  'The extras a guest actually chose on one order line, each with its own price and name SNAPSHOT. Required for historical accuracy (brief §34.4): "Extra cheese +5 000" must still read +5 000 on a receipt printed after the extra was repriced to 7 000 or deleted from the menu.';
COMMENT ON COLUMN public.order_item_options.order_id IS
  'Denormalised parent order. Two jobs: it makes the tenant FK to orders composite (Invariant T1), and it lets the receipt/KDS query fetch every option of an order in one indexed scan instead of joining through order_items.';
COMMENT ON COLUMN public.order_item_options.order_item_id IS
  'The line this option belongs to. The FK is (order_id, order_item_id) -> order_items (order_id, id), which makes attaching an option to a line of a DIFFERENT order structurally impossible.';
COMMENT ON COLUMN public.order_item_options.menu_item_option_id IS
  'Reference to the live option row, for analytics only. NULLABLE; ON DELETE SET NULL (menu_item_option_id). The snapshots above are the record.';
COMMENT ON COLUMN public.order_item_options.group_key_snapshot IS
  'The option group this choice came from ("size", "extras"), captured so the receipt can still group choices under their headings after the menu is restructured.';
COMMENT ON COLUMN public.order_item_options.group_label_snapshot IS
  'Trilingual group heading at order time ("O''lcham" / "Размер" / "Size").';
COMMENT ON COLUMN public.order_item_options.name_snapshot IS
  'Trilingual option name at order time ("Qo''shimcha pishloq" / "Доп. сыр" / "Extra cheese").';
COMMENT ON COLUMN public.order_item_options.price_delta_snapshot IS
  'Per-unit price of this option in MINOR CURRENCY UNITS at order time, copied from menu_item_options.price_delta by the server. CHECK >= 0 via money_minor.';
COMMENT ON COLUMN public.order_item_options.quantity IS
  'How many of this option per ONE unit of the parent line ("extra cheese x2"). Not multiplied by the line quantity here - the line quantity multiplies once, in order_items.total.';
COMMENT ON COLUMN public.order_item_options.total_per_unit IS
  'quantity * price_delta_snapshot, in MINOR CURRENCY UNITS, for ONE unit of the parent line. STORED GENERATED, so an inconsistent value is unwritable. The sum of these across a line must equal order_items.options_total (trg_order_items_options_total_consistent).';
COMMENT ON CONSTRAINT uq_order_item_options_line_option ON public.order_item_options IS
  'One row per (line, option). Choosing "extra cheese" twice is expressed as quantity = 2, never as two rows. NULLS NOT DISTINCT (PG 15+) means at most one free-text/orphaned option row per line as well.';
```

**Worked example — the arithmetic, end to end.** Guest orders 2 × Plov (45 000) with extra meat
(+15 000) and 1 × Ayran (8 000). Currency UZS, `currency_decimals = 0`, service fee 10% (`1000` bps).

| Row | Value |
|---|---|
| `order_item_options` (Plov / extra meat) | `price_delta_snapshot = 15000`, `quantity = 1`, `total_per_unit = 15000` |
| `order_items` (Plov) | `price_snapshot = 45000`, `options_total = 15000`, `quantity = 2`, `total = 2 * (45000 + 15000) = 120000` |
| `order_items` (Ayran) | `price_snapshot = 8000`, `options_total = 0`, `quantity = 1`, `total = 8000` |
| `orders` | `subtotal = 128000`, `discount_total = 0`, `service_fee_bps = 1000`, `service_fee = round(128000 * 1000 / 10000) = 12800`, `total = 140800` |

Rendered as `140 800 so'm`. Not one floating-point operation anywhere in that chain.

### 6.16 `order_status_history` — the append-only audit trail

```sql
CREATE TABLE public.order_status_history (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  branch_id         UUID        NOT NULL,
  order_id          UUID        NOT NULL,

  previous_status   public.order_status,
  new_status        public.order_status NOT NULL,

  changed_by        UUID,
  changed_by_kind   public.actor_kind NOT NULL DEFAULT 'system',
  changed_by_role   public.app_role,
  note              TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_order_status_history_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_status_history_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_status_history_changed_by
    FOREIGN KEY (changed_by) REFERENCES public.profiles (id) ON DELETE SET NULL,

  CONSTRAINT ck_order_status_history_actual_change
    CHECK (previous_status IS DISTINCT FROM new_status),

  CONSTRAINT ck_order_status_history_staff_actor
    CHECK (changed_by_kind <> 'staff' OR changed_by_role IS NOT NULL),

  CONSTRAINT ck_order_status_history_customer_actor
    CHECK (changed_by_kind <> 'customer' OR (changed_by IS NULL AND changed_by_role IS NULL)),

  CONSTRAINT ck_order_status_history_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),

  CONSTRAINT ck_order_status_history_transition_legal
    CHECK (
      previous_status IS NULL
      OR public.is_valid_order_transition(previous_status, new_status)
    )
);

COMMENT ON TABLE  public.order_status_history IS
  'Every status transition of every order (brief §25 "every important status transition recorded"). APPEND-ONLY: trg_order_status_history_immutable rejects UPDATE and DELETE, so the audit trail cannot be rewritten. Rows are written ONLY by trg_orders_log_status_change, never by application code, which means no code path can change a status without leaving a trace.';
COMMENT ON COLUMN public.order_status_history.previous_status IS
  'Status before the change. NULL on exactly one row per order: the creation row written by the AFTER INSERT trigger, whose new_status is pending. ck_order_status_history_transition_legal re-validates every non-creation row against the state machine, so even a direct SQL write cannot record an impossible history.';
COMMENT ON COLUMN public.order_status_history.changed_by IS
  'Profile that made the change; the brief''s changed_by column. NULL for customer and system actors, who have no auth.users row - see changed_by_kind.';
COMMENT ON COLUMN public.order_status_history.changed_by_kind IS
  'Disambiguates a NULL changed_by. customer = the anonymous guest cancelled their own pending order (legal, and accountless per brief §11); system = a trigger or cron job; staff = an authenticated employee, which then requires changed_by_role.';
COMMENT ON COLUMN public.order_status_history.changed_by_role IS
  'The staff role in force at the time of the change. Snapshotted here rather than joined from staff, because roles are reassigned and the audit answer to "who was allowed to do this then" must not change afterwards.';
COMMENT ON COLUMN public.order_status_history.note IS
  'Optional free-text reason ("out of lamb"), read by the logging trigger from the app.actor_note transaction setting. For cancellations this mirrors orders.cancellation_reason.';
COMMENT ON COLUMN public.order_status_history.updated_at IS
  'Present only to satisfy the platform-wide "every business table carries created_at and updated_at" rule. It is ALWAYS equal to created_at, because trg_order_status_history_immutable forbids UPDATE. Do not read meaning into it.';
```

### 6.17 `waiter_calls`

```sql
CREATE TABLE public.waiter_calls (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id             UUID        NOT NULL,
  branch_id                 UUID        NOT NULL,
  table_id                  UUID        NOT NULL,
  order_id                  UUID,

  reason                    public.waiter_call_reason NOT NULL DEFAULT 'call_waiter',
  status                    public.waiter_call_status NOT NULL DEFAULT 'pending',
  note                      TEXT,

  customer_session_id       UUID,

  acknowledged_at           TIMESTAMPTZ,
  acknowledged_by_staff_id  UUID,
  resolved_at               TIMESTAMPTZ,
  resolved_by_staff_id      UUID,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_waiter_calls_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_waiter_calls_table
    FOREIGN KEY (branch_id, table_id)
    REFERENCES public.tables (branch_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_waiter_calls_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE SET NULL (order_id),

  CONSTRAINT fk_waiter_calls_acknowledged_by
    FOREIGN KEY (restaurant_id, acknowledged_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (acknowledged_by_staff_id),

  CONSTRAINT fk_waiter_calls_resolved_by
    FOREIGN KEY (restaurant_id, resolved_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (resolved_by_staff_id),

  CONSTRAINT uq_waiter_calls_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_waiter_calls_note_len
    CHECK (note IS NULL OR char_length(note) <= 200),

  CONSTRAINT ck_waiter_calls_pending_not_acknowledged
    CHECK (status <> 'pending' OR acknowledged_at IS NULL),

  CONSTRAINT ck_waiter_calls_acknowledged_pair
    CHECK (status <> 'acknowledged' OR acknowledged_at IS NOT NULL),

  CONSTRAINT ck_waiter_calls_resolved_pair
    CHECK ((resolved_at IS NOT NULL) = (status = 'resolved')),

  CONSTRAINT ck_waiter_calls_time_order
    CHECK (
      (acknowledged_at IS NULL OR acknowledged_at >= created_at)
      AND (resolved_at IS NULL OR resolved_at >= created_at)
      AND (resolved_at IS NULL OR acknowledged_at IS NULL OR resolved_at >= acknowledged_at)
    )
);

-- At most ONE open call per table, at any moment. Spam protection, structurally.
CREATE UNIQUE INDEX uq_waiter_calls_open_per_table
  ON public.waiter_calls (table_id)
  WHERE status IN ('pending', 'acknowledged');

COMMENT ON TABLE  public.waiter_calls IS
  'A table asking for a waiter (brief §10). Created by the anonymous customer app, consumed live by the waiter console ("TABLE 12 IS CALLING"). Two independent anti-spam mechanisms: uq_waiter_calls_open_per_table (at most one open call per table) and trg_waiter_calls_cooldown (a time window between calls), both in the database so neither depends on the API being correct.';
COMMENT ON COLUMN public.waiter_calls.table_id IS
  'The calling table. FK is (branch_id, table_id) -> tables (branch_id, id), so a call can never reference a table outside its own branch - which is what makes the waiter console''s single branch_id filter sufficient for isolation (brief §34.6).';
COMMENT ON COLUMN public.waiter_calls.order_id IS
  'Optional link to the order the guest is calling about (typically request_bill). ON DELETE SET NULL (order_id) so purging an order never destroys the service record.';
COMMENT ON COLUMN public.waiter_calls.reason IS
  'Why the guest called. Drives icon, colour and sort priority on the waiter console; request_bill outranks request_water.';
COMMENT ON COLUMN public.waiter_calls.status IS
  'pending and acknowledged are the OPEN states - exactly those two appear in the partial unique index and in the console''s live query. resolved/cancelled/expired are closed states that release the table for a new call.';
COMMENT ON COLUMN public.waiter_calls.note IS
  'Optional free text from the guest, capped at 200 chars. The reason enum carries the meaning; this only adds detail. An anonymous public write path never gets an unbounded text column.';
COMMENT ON COLUMN public.waiter_calls.customer_session_id IS
  'The anonymous guest session that raised the call, matching orders.customer_session_id. Used by the cooldown trigger and by the tracking screen to show the guest their own call state ("a waiter is on the way").';
COMMENT ON COLUMN public.waiter_calls.acknowledged_at IS
  'When a waiter tapped "I am coming" (brief §10). This timestamp minus created_at is the response-time metric on the admin dashboard.';
COMMENT ON COLUMN public.waiter_calls.acknowledged_by_staff_id IS
  'Which waiter acknowledged. Composite FK on restaurant_id, so another tenant''s staff id is unassignable.';
COMMENT ON COLUMN public.waiter_calls.resolved_by_staff_id IS
  'Which waiter closed the call. Usually, but not necessarily, the same person who acknowledged it.';
```

### 6.18 `notifications` — addressed to a role, a branch, or one staff member

**Who is a notification for?** All three, resolved at read time:

```
restaurant_id (always)  ->  branch_id (always)  ->  target_role (optional)  |  target_staff_id (optional)
```

A row must name **at least one** of `target_role` / `target_staff_id` (`ck_notifications_addressed`).
A KDS screen subscribes with `branch_id = $1 AND (target_role = 'KITCHEN' OR target_staff_id = <me>)`.
A waiter console swaps `'WAITER'` for `'KITCHEN'`. That is one indexed predicate, and it is exactly the
Supabase Realtime filter the panels attach.

**Why address-at-read rather than fan-out-on-write** (one row per recipient, with `is_read` on it):

- Fan-out-on-write must resolve the recipient set at insert time. A kitchen worker who clocks in five
  minutes after an order arrives would have **no row** and see an empty feed — wrong for a KDS, which
  must show the whole current shift's traffic to whoever is standing at the screen.
- Shift changes and role reassignments would leave rows addressed to people who no longer work there,
  and none addressed to their replacement.
- It multiplies write volume by the staff count on the single hottest write path (order created).

The cost of addressing-at-read is that "read" is per-person, which a boolean on a role-broadcast row
cannot express (waiter A marking it read would hide it from waiter B). That is what
`notification_reads` (§6.19) is for.

```sql
CREATE TABLE public.notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  branch_id         UUID        NOT NULL,

  target_role       public.app_role,
  target_staff_id   UUID,

  type              public.notification_type NOT NULL,
  payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  priority          SMALLINT    NOT NULL DEFAULT 1,

  order_id          UUID,
  waiter_call_id    UUID,

  expires_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_notifications_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_target_staff
    FOREIGN KEY (restaurant_id, target_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_waiter_call
    FOREIGN KEY (restaurant_id, waiter_call_id)
    REFERENCES public.waiter_calls (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_notifications_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_notifications_addressed
    CHECK (target_role IS NOT NULL OR target_staff_id IS NOT NULL),

  CONSTRAINT ck_notifications_target_role_not_super_admin
    CHECK (target_role IS NULL OR target_role <> 'SUPER_ADMIN'),

  CONSTRAINT ck_notifications_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT ck_notifications_priority_range
    CHECK (priority BETWEEN 0 AND 2),

  CONSTRAINT ck_notifications_expiry_after_creation
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

COMMENT ON TABLE  public.notifications IS
  'Staff-facing event feed powering the KDS incoming-order alert (brief §9), the waiter ready/call alerts (brief §10, §28) and the admin bell. Addressed by (branch_id + role) or (branch_id + specific staff); resolved at read time, with per-person read state in notification_reads.';
COMMENT ON COLUMN public.notifications.branch_id IS
  'NOT NULL always. Every notification this product produces is about something happening at one physical location, and every panel that consumes them is bound to one location. Making it non-nullable removes an entire class of "which branch is this for" ambiguity from the panels.';
COMMENT ON COLUMN public.notifications.target_role IS
  'Role broadcast within the branch: KITCHEN for new orders, WAITER for ready orders and table calls, MANAGER/RESTAURANT_OWNER for escalations. NULL when the notification is for one named person. SUPER_ADMIN is rejected - platform admins are not on a branch rota.';
COMMENT ON COLUMN public.notifications.target_staff_id IS
  'Direct address to one staff member (e.g. "the order you accepted is now late"). NULL for role broadcasts. At least one of target_role / target_staff_id must be set; both may be, meaning "the WAITER role, but highlight it for this person".';
COMMENT ON COLUMN public.notifications.type IS
  'Event discriminator. Together with payload it is everything the client needs to render.';
COMMENT ON COLUMN public.notifications.payload IS
  'Structured data for rendering: {"order_number":"A-014","table_number":"12","item_count":3}. NO RENDERED TEXT IS STORED - the client composes the localised string from type + payload. Storing a sentence would freeze one of three locales into the row and go stale the moment the underlying entity changes.';
COMMENT ON COLUMN public.notifications.priority IS
  '0 = informational (badge only), 1 = normal (toast), 2 = urgent (persistent banner + sound; new order on the KDS, table calling on the waiter console). CHECK 0..2.';
COMMENT ON COLUMN public.notifications.order_id IS
  'Deep-link target. ON DELETE CASCADE: a notification about a purged order has nothing to point at and should go with it.';
COMMENT ON COLUMN public.notifications.waiter_call_id IS
  'Deep-link target for waiter-call notifications, cascading for the same reason.';
COMMENT ON COLUMN public.notifications.expires_at IS
  'Optional auto-hide time. The housekeeping job deletes expired rows so the feed cannot grow without bound; NULL means keep until the retention job trims by age.';
```

### 6.19 `notification_reads` — per-person read state

```sql
CREATE TABLE public.notification_reads (
  notification_id  UUID        NOT NULL,
  staff_id         UUID        NOT NULL,
  restaurant_id    UUID        NOT NULL,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_notification_reads PRIMARY KEY (notification_id, staff_id),

  CONSTRAINT fk_notification_reads_notification
    FOREIGN KEY (restaurant_id, notification_id)
    REFERENCES public.notifications (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notification_reads_staff
    FOREIGN KEY (restaurant_id, staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE CASCADE
);

COMMENT ON TABLE  public.notification_reads IS
  'One row per (notification, staff member) that has seen it. DELIBERATE EXCEPTION to the uuid-id rule: this is a pure junction whose natural key (notification_id, staff_id) is also its uniqueness requirement; a surrogate id would permit duplicate read marks. A notification is unread FOR ME when no row exists for (notification.id, my staff id).';
COMMENT ON COLUMN public.notification_reads.restaurant_id IS
  'Denormalised tenant key, present so both FKs are composite (Invariant T1) and so the RLS policy is a single-column predicate.';
COMMENT ON COLUMN public.notification_reads.read_at IS
  'When this person saw it. Distinct from created_at so a backfill or a "mark all as read" sweep can record the real observation time.';
```

**The panel query** (binding shape; used by the KDS, the waiter console and the admin bell):

```sql
SELECT n.*, (r.staff_id IS NOT NULL) AS is_read
FROM public.notifications n
LEFT JOIN public.notification_reads r
       ON r.notification_id = n.id
      AND r.staff_id        = $my_staff_id
WHERE n.branch_id = $branch_id
  AND (n.target_role = $my_role OR n.target_staff_id = $my_staff_id)
  AND (n.expires_at IS NULL OR n.expires_at > now())
ORDER BY n.priority DESC, n.created_at DESC
LIMIT 50;
```

Served by `idx_notifications_branch_role_created` and `idx_notifications_branch_staff_created`.
Marking read is `INSERT ... ON CONFLICT DO NOTHING`, which is idempotent under the double-delivery that
a reconnecting Realtime subscription can produce.

---

## 7. Trigger functions and triggers

**Global note on `SECURITY DEFINER`.** Every function below that *reads or writes rows other than the
one being modified* is `SECURITY DEFINER` with `SET search_path = public, pg_temp`. This is not
optional: with RLS enabled, an invoker-rights trigger firing on behalf of the `anon` role would have its
internal `SELECT`s filtered by RLS and would, for example, conclude that a perfectly good order "has no
items". `SET search_path` is mandatory on every `SECURITY DEFINER` function to close the
search-path-hijack hole. Functions that only touch `NEW`/`OLD` stay invoker-rights.

### 7.1 `updated_at` on every table

```sql
CREATE TRIGGER trg_restaurants_set_updated_at        BEFORE UPDATE ON public.restaurants        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_branches_set_updated_at           BEFORE UPDATE ON public.branches           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_profiles_set_updated_at           BEFORE UPDATE ON public.profiles           FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_staff_set_updated_at              BEFORE UPDATE ON public.staff              FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_tables_set_updated_at             BEFORE UPDATE ON public.tables             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_menu_categories_set_updated_at    BEFORE UPDATE ON public.menu_categories    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_menu_items_set_updated_at         BEFORE UPDATE ON public.menu_items         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_menu_item_options_set_updated_at  BEFORE UPDATE ON public.menu_item_options  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_promotions_set_updated_at         BEFORE UPDATE ON public.promotions         FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_promotion_items_set_updated_at    BEFORE UPDATE ON public.promotion_items    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_branch_order_counters_set_updated_at BEFORE UPDATE ON public.branch_order_counters FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_orders_set_updated_at             BEFORE UPDATE ON public.orders             FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_order_items_set_updated_at        BEFORE UPDATE ON public.order_items        FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_order_item_options_set_updated_at BEFORE UPDATE ON public.order_item_options FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_waiter_calls_set_updated_at       BEFORE UPDATE ON public.waiter_calls       FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_notifications_set_updated_at      BEFORE UPDATE ON public.notifications      FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_notification_reads_set_updated_at BEFORE UPDATE ON public.notification_reads FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

`order_status_history` and `qr_token_history` deliberately have **no** `updated_at` trigger — both are
append-only (§7.7c), so their `updated_at` is permanently frozen at `created_at`.

### 7.2 `auth.users` → `profiles`

```sql
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, locale)
  VALUES (
    NEW.id,
    lower(NEW.email),
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')), ''),
    NULLIF(btrim(COALESCE(NEW.raw_user_meta_data ->> 'avatar_url', '')), ''),
    COALESCE(
      NULLIF(NEW.raw_user_meta_data ->> 'locale', ''),
      'uz'
    )::public.app_locale
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Guarantees the 1:1 between auth.users and profiles at the database level, so no signup path (email, OAuth, admin invite, SQL) can produce an authenticated user without a profile row. ON CONFLICT DO NOTHING keeps it idempotent if a profile was pre-created by an invite flow. An invalid locale in user metadata raises 22P02 and aborts signup rather than silently defaulting - metadata is set by our own code, so a bad value is a bug worth failing on.';
```

### 7.3 Branch timezone validation and order-number assignment

```sql
CREATE OR REPLACE FUNCTION public.validate_branch_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = NEW.timezone) THEN
    RAISE EXCEPTION 'unknown IANA timezone: %', NEW.timezone
      USING ERRCODE = 'BRN01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_branches_validate_timezone
  BEFORE INSERT OR UPDATE OF timezone ON public.branches
  FOR EACH ROW EXECUTE FUNCTION public.validate_branch_timezone();

COMMENT ON FUNCTION public.validate_branch_timezone() IS
  'A CHECK constraint cannot validate a timezone name (the lookup is not IMMUTABLE and pg_timezone_names is a view, so it cannot be an FK target). This trigger closes the gap. It matters: branches.timezone decides when the daily order counter rolls over and what "today" means on the dashboard, so a typo would silently corrupt both.';

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.next_order_number(p_branch_id UUID)
RETURNS TABLE (
  out_business_date DATE,
  out_order_seq     INTEGER,
  out_order_number  TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tz   TEXT;
  v_code TEXT;
  v_date DATE;
  v_seq  INTEGER;
BEGIN
  SELECT b.timezone, b.code
    INTO v_tz, v_code
  FROM public.branches b
  WHERE b.id = p_branch_id;

  IF v_tz IS NULL THEN
    RAISE EXCEPTION 'branch % does not exist', p_branch_id
      USING ERRCODE = '23503';
  END IF;

  v_date := (now() AT TIME ZONE v_tz)::date;

  INSERT INTO public.branch_order_counters AS c (branch_id, business_date, last_number)
  VALUES (p_branch_id, v_date, 1)
  ON CONFLICT (branch_id, business_date)
  DO UPDATE SET last_number = c.last_number + 1,
                updated_at  = now()
  RETURNING c.last_number INTO v_seq;

  out_business_date := v_date;
  out_order_seq     := v_seq;
  out_order_number  := v_code || '-' || lpad(v_seq::text, 3, '0');
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.next_order_number(UUID) IS
  'Allocates the next human-friendly order number for a branch on its LOCAL business date. Race-safe by construction: the ON CONFLICT DO UPDATE takes a row lock on (branch_id, business_date) and re-reads the row before applying the increment, so concurrent callers serialise and each receives a distinct value at READ COMMITTED. Gap-free on rollback, unlike a SEQUENCE. OUT parameters are prefixed out_ so their names cannot shadow the counter table columns inside the ON CONFLICT clause. SECURITY DEFINER because the anonymous public order path has no rights on branch_order_counters.';

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.orders_assign_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v RECORD;
BEGIN
  IF NEW.order_number IS NULL OR NEW.order_seq IS NULL OR NEW.business_date IS NULL THEN
    SELECT * INTO v FROM public.next_order_number(NEW.branch_id);
    NEW.business_date := v.out_business_date;
    NEW.order_seq     := v.out_order_seq;
    NEW.order_number  := v.out_order_number;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_assign_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_assign_number();

COMMENT ON FUNCTION public.orders_assign_number() IS
  'Fills business_date, order_seq and order_number on INSERT. Application code MUST omit all three (the columns are NOT NULL with no default; the trigger is what satisfies them). The conditional guard exists solely for data-restore paths that supply explicit values.';
```

### 7.4 Currency and fee snapshotting on order creation

```sql
CREATE OR REPLACE FUNCTION public.orders_snapshot_pricing_context()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_currency        CHAR(3);
  v_decimals        SMALLINT;
  v_fee_enabled     BOOLEAN;
  v_restaurant_bps  INTEGER;
  v_branch_bps      INTEGER;
BEGIN
  SELECT r.currency, r.currency_decimals, r.service_fee_enabled, r.service_fee_bps, b.service_fee_bps
    INTO v_currency, v_decimals, v_fee_enabled, v_restaurant_bps, v_branch_bps
  FROM public.branches b
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE b.id = NEW.branch_id;

  NEW.currency          := v_currency;
  NEW.currency_decimals := v_decimals;
  NEW.service_fee_bps   := CASE
                             WHEN v_fee_enabled THEN COALESCE(v_branch_bps, v_restaurant_bps, 0)
                             ELSE 0
                           END;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_snapshot_pricing_context
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_snapshot_pricing_context();

COMMENT ON FUNCTION public.orders_snapshot_pricing_context() IS
  'Resolves and freezes the pricing context of an order: currency, currency_decimals and the effective service-fee rate (branch override, else restaurant default, else 0 when the fee is disabled). Done in the database rather than the API so that every write path - customer app, waiter panel, admin, seed script - gets the identical resolution, and so a client cannot dictate its own service-fee rate. It OVERWRITES whatever the caller supplied for these three columns.';
```

### 7.5 Order totals consistency (deferred constraint trigger)

```sql
CREATE OR REPLACE FUNCTION public.assert_order_totals_consistent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order_id     UUID;
  v_order        public.orders%ROWTYPE;
  v_items_sum    BIGINT;
  v_items_count  INTEGER;
  v_expected_fee BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'orders' THEN
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_order_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_id ELSE NEW.order_id END;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = v_order_id;
  IF NOT FOUND THEN
    RETURN NULL;                        -- the order was deleted in this same transaction
  END IF;

  SELECT COALESCE(SUM(oi.total), 0), COUNT(*)
    INTO v_items_sum, v_items_count
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id;

  IF v_items_count = 0 THEN
    RAISE EXCEPTION 'order % has no order_items', v_order_id
      USING ERRCODE = 'ORD03';
  END IF;

  IF v_items_sum <> v_order.subtotal THEN
    RAISE EXCEPTION
      'order % subtotal is % but its order_items sum to %', v_order_id, v_order.subtotal, v_items_sum
      USING ERRCODE = 'ORD02';
  END IF;

  v_expected_fee := round(
    ((v_order.subtotal - v_order.discount_total)::numeric * v_order.service_fee_bps) / 10000
  )::bigint;

  IF v_order.service_fee <> v_expected_fee THEN
    RAISE EXCEPTION
      'order % service_fee is % but % bps on % yields %',
      v_order_id, v_order.service_fee, v_order.service_fee_bps,
      (v_order.subtotal - v_order.discount_total), v_expected_fee
      USING ERRCODE = 'ORD02';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_orders_totals_consistent
  AFTER INSERT OR UPDATE OF subtotal, discount_total, service_fee, service_fee_bps
  ON public.orders
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_totals_consistent();

CREATE CONSTRAINT TRIGGER trg_order_items_rollup_consistent
  AFTER INSERT OR UPDATE OF total, order_id OR DELETE
  ON public.order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_totals_consistent();

COMMENT ON FUNCTION public.assert_order_totals_consistent() IS
  'Asserts three facts at COMMIT: (1) the order has at least one line - an empty order is an illegal state, not a valid zero-total order; (2) orders.subtotal equals the sum of its order_items.total; (3) orders.service_fee equals round((subtotal - discount_total) * service_fee_bps / 10000). DEFERRABLE INITIALLY DEFERRED is essential: during an order-creation transaction the parent row exists before its children, so an immediate check would fire on a legitimately incomplete state. numeric is used only as the intermediate for the rounding division and is immediately cast back to bigint; nothing is stored as a non-integer. Combined with the immediate CHECK ck_orders_totals_arithmetic (total = subtotal - discount_total + service_fee) and the GENERATED order_items.total, an order whose money does not add up cannot be committed.';
```

> **Contract:** any transaction that inserts, updates or deletes `order_items` MUST recompute
> `orders.subtotal`, `orders.service_fee` and `orders.total` before it commits. There is no
> auto-maintenance trigger, deliberately: a recalculating trigger would fire once per line and turn an
> N-line order into N full re-aggregations, and it would hide pricing logic from the service layer that
> brief §34.2 makes responsible for it. The deferred assertion catches any lapse at `COMMIT`.

### 7.6 Line-level option rollup (deferred constraint trigger)

```sql
CREATE OR REPLACE FUNCTION public.assert_order_item_options_consistent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item_id  UUID;
  v_declared BIGINT;
  v_actual   BIGINT;
BEGIN
  IF TG_TABLE_NAME = 'order_items' THEN
    v_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    v_item_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.order_item_id ELSE NEW.order_item_id END;
  END IF;

  SELECT oi.options_total INTO v_declared
  FROM public.order_items oi
  WHERE oi.id = v_item_id;

  IF NOT FOUND THEN
    RETURN NULL;                        -- the line was deleted in this same transaction
  END IF;

  SELECT COALESCE(SUM(o.total_per_unit), 0) INTO v_actual
  FROM public.order_item_options o
  WHERE o.order_item_id = v_item_id;

  IF v_declared <> v_actual THEN
    RAISE EXCEPTION
      'order_items % declares options_total % but its options sum to %', v_item_id, v_declared, v_actual
      USING ERRCODE = 'ORD02';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER trg_order_items_options_total_consistent
  AFTER INSERT OR UPDATE OF options_total
  ON public.order_items
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_item_options_consistent();

CREATE CONSTRAINT TRIGGER trg_order_item_options_rollup_consistent
  AFTER INSERT OR UPDATE OF total_per_unit, order_item_id OR DELETE
  ON public.order_item_options
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_item_options_consistent();

COMMENT ON FUNCTION public.assert_order_item_options_consistent() IS
  'Closes the last gap in the totals chain: order_items.options_total must equal the sum of its order_item_options.total_per_unit. Without this, a line could claim a large options_total with no options behind it, and every check above it would still pass. Deferred for the same reason as §7.5 - the parent line is inserted before its options.';
```

### 7.7 The order state machine, its audit trail, and its immutability

**(a) Transition guard + automatic lifecycle timestamps**

```sql
CREATE OR REPLACE FUNCTION public.orders_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_valid_order_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'illegal order status transition: % -> % (order %)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'ORD01';
  END IF;

  CASE NEW.status
    WHEN 'confirmed' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
      NEW.due_at       := COALESCE(NEW.due_at,
                            now() + make_interval(mins => NEW.estimated_prep_minutes));
    WHEN 'preparing' THEN NEW.preparing_at := COALESCE(NEW.preparing_at, now());
    WHEN 'ready'     THEN NEW.ready_at     := COALESCE(NEW.ready_at,     now());
    WHEN 'delivered' THEN NEW.delivered_at := COALESCE(NEW.delivered_at, now());
    WHEN 'completed' THEN NEW.completed_at := COALESCE(NEW.completed_at, now());
    WHEN 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      IF NEW.cancellation_reason IS NULL OR btrim(NEW.cancellation_reason) = '' THEN
        RAISE EXCEPTION 'cancelling order % requires a cancellation_reason', OLD.id
          USING ERRCODE = 'ORD04';
      END IF;
    ELSE
      NULL;
  END CASE;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_status_guard
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_status_guard();

COMMENT ON FUNCTION public.orders_status_guard() IS
  'The database''s enforcement of brief §26 and §34.8. Rejects any transition is_valid_order_transition() disallows - completed -> preparing and cancelled -> ready both raise ORD01 - and stamps the lifecycle timestamp for the state being entered so no code path can advance an order without recording when. due_at is computed here rather than as a GENERATED column because timestamptz + interval is STABLE, not IMMUTABLE, and is therefore rejected in a generated-column expression. This is a backstop, not the primary implementation: the API state machine must reject the transition first and return a friendly 409.';
```

**(b) Automatic history logging**

```sql
CREATE OR REPLACE FUNCTION public.orders_log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor UUID;
  v_kind  public.actor_kind;
  v_role  public.app_role;
  v_note  TEXT;
  v_prev  public.order_status;
BEGIN
  v_actor := NULLIF(current_setting('app.actor_profile_id', true), '')::uuid;
  v_kind  := COALESCE(
               NULLIF(current_setting('app.actor_kind', true), ''),
               CASE WHEN v_actor IS NOT NULL THEN 'staff' ELSE 'system' END
             )::public.actor_kind;
  v_role  := NULLIF(current_setting('app.actor_role', true), '')::public.app_role;
  v_note  := NULLIF(btrim(current_setting('app.actor_note', true)), '');
  v_prev  := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;

  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  IF v_kind = 'customer' THEN
    v_actor := NULL;
    v_role  := NULL;
  END IF;

  INSERT INTO public.order_status_history (
    restaurant_id, branch_id, order_id,
    previous_status, new_status,
    changed_by, changed_by_kind, changed_by_role, note
  )
  VALUES (
    NEW.restaurant_id, NEW.branch_id, NEW.id,
    v_prev, NEW.status,
    v_actor, v_kind, v_role,
    COALESCE(v_note, CASE WHEN NEW.status = 'cancelled' THEN NEW.cancellation_reason END)
  );

  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_orders_log_status_change
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_log_status_change();

COMMENT ON FUNCTION public.orders_log_status_change() IS
  'Writes order_status_history automatically, on creation (previous_status NULL, new_status pending) and on every subsequent status change. Because this is the ONLY writer of that table, no code path can change an order status without leaving an audit row - the guarantee brief §25 asks for. The actor is read from transaction-local settings, NOT from a function argument, so the audit works identically for PostgREST calls, service-role route handlers and psql. SECURITY DEFINER because an anonymous guest cancelling their own order has no INSERT right on the audit table.';
```

**Actor contract (binding for every writer).** Before mutating `orders.status`, the caller sets
transaction-local settings. In a Supabase route handler this is one RPC or one `SET LOCAL` per request:

```sql
SELECT set_config('app.actor_profile_id', $1, true);  -- profile uuid, or '' for customer/system
SELECT set_config('app.actor_kind',       $2, true);  -- 'staff' | 'customer' | 'system'
SELECT set_config('app.actor_role',       $3, true);  -- app_role label, or '' when not staff
SELECT set_config('app.actor_note',       $4, true);  -- optional reason, or ''
```

The third argument `true` makes them **transaction-local**, so they cannot leak across pooled
connections. Unset settings degrade safely to `('system', NULL, NULL)`.

**(c) Append-only enforcement**

```sql
CREATE OR REPLACE FUNCTION public.forbid_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not permitted: this table is append-only',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'AUD01';
END;
$$;

CREATE TRIGGER trg_order_status_history_immutable
  BEFORE UPDATE OR DELETE ON public.order_status_history
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();

CREATE TRIGGER trg_qr_token_history_immutable
  BEFORE UPDATE OR DELETE ON public.qr_token_history
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();

COMMENT ON FUNCTION public.forbid_mutation() IS
  'Makes a table append-only. Applied to order_status_history (an audit trail that can be rewritten is not an audit trail) and qr_token_history (deleting a retired token would allow it to be re-issued, defeating trg_tables_prevent_token_reuse). NOTE: a cascading delete from a parent DOES fire this trigger and will therefore abort. That is intended - see the note below.';
```

> Note: a cascading delete of a parent `orders` row **does** fire this trigger. That is intentional:
> orders are never hard-deleted in this product (`fk_orders_branch` and `fk_orders_table` are
> `ON DELETE RESTRICT`, and cancellation is a status, not a deletion). Tenant offboarding, the one
> legitimate mass-delete, runs as a maintenance script that drops the triggers, deletes, and recreates
> them inside one transaction.

### 7.8 Option-group consistency

```sql
CREATE OR REPLACE FUNCTION public.assert_option_group_consistent()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.menu_item_options o
    WHERE o.menu_item_id = NEW.menu_item_id
      AND o.group_key    = NEW.group_key
      AND o.id          <> NEW.id
      AND o.deleted_at IS NULL
      AND (
            o.selection_type   <> NEW.selection_type
         OR o.group_min_select <> NEW.group_min_select
         OR o.group_max_select IS DISTINCT FROM NEW.group_max_select
         OR o.group_sort_order <> NEW.group_sort_order
         OR o.group_label      IS DISTINCT FROM NEW.group_label
      )
  ) THEN
    RAISE EXCEPTION
      'option group "%" of menu item % has inconsistent group attributes',
      NEW.group_key, NEW.menu_item_id
      USING ERRCODE = 'MNU02';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_menu_item_options_group_consistency
  BEFORE INSERT OR UPDATE ON public.menu_item_options
  FOR EACH ROW EXECUTE FUNCTION public.assert_option_group_consistent();

COMMENT ON FUNCTION public.assert_option_group_consistent() IS
  'Group-level attributes (group_label, selection_type, group_min_select, group_max_select, group_sort_order) are replicated onto every row of an option group so that the brief''s single menu_item_options table can carry group semantics without a 20th table. This trigger is the constraint that makes the replication safe: it rejects any row that disagrees with its siblings. Editing a group''s attributes therefore requires updating all its rows in one statement (UPDATE ... WHERE menu_item_id = $1 AND group_key = $2), which is what the admin panel does.';
```

### 7.9 Menu scope consistency and the orderability backstop

```sql
CREATE OR REPLACE FUNCTION public.assert_menu_item_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_category_branch UUID;
BEGIN
  SELECT c.branch_id INTO v_category_branch
  FROM public.menu_categories c
  WHERE c.id = NEW.category_id;

  IF v_category_branch IS NOT NULL AND NEW.branch_id IS DISTINCT FROM v_category_branch THEN
    RAISE EXCEPTION
      'menu item scope (branch %) is wider than its category scope (branch %)',
      NEW.branch_id, v_category_branch
      USING ERRCODE = 'MNU03';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_menu_items_scope_consistency
  BEFORE INSERT OR UPDATE OF branch_id, category_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.assert_menu_item_scope();

COMMENT ON FUNCTION public.assert_menu_item_scope() IS
  'An item may be no wider in scope than its category. A restaurant-wide item (branch_id NULL) inside a branch-exclusive category would be invisible at every other branch while claiming to be sold there - a state the customer menu query cannot render coherently. A restaurant-wide category (branch_id NULL) accepts items of any scope.';

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_order_item_orderable()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_item public.menu_items%ROWTYPE;
BEGIN
  IF NEW.menu_item_id IS NULL THEN
    RETURN NEW;                          -- historical line whose dish was purged
  END IF;

  SELECT * INTO v_item FROM public.menu_items WHERE id = NEW.menu_item_id;

  IF v_item.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'menu item % is deleted and cannot be ordered', NEW.menu_item_id
      USING ERRCODE = 'MNU01';
  END IF;

  IF v_item.is_available = false
     AND (v_item.unavailable_until IS NULL OR now() < v_item.unavailable_until) THEN
    RAISE EXCEPTION 'menu item % is unavailable and cannot be ordered', NEW.menu_item_id
      USING ERRCODE = 'MNU01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_order_items_item_orderable
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_item_orderable();

COMMENT ON FUNCTION public.assert_order_item_orderable() IS
  'Database backstop for brief §34.3 ("cannot order unavailable products"). Deliberately checks ONLY the timezone-independent clauses of the orderability rule (deleted_at, is_available, unavailable_until). Daypart windows are excluded on purpose: they need branches.timezone, and a legitimate retroactive correction to an order placed inside the window must not be blocked hours later. The authoritative check remains src/lib/menu/orderability.ts, run before the transaction opens. Fires on INSERT only, so editing an existing line of an in-flight order is never blocked by a dish being 86-ed mid-service.';
```

### 7.10 QR token rotation, history and reuse prevention

```sql
CREATE OR REPLACE FUNCTION public.tables_rotate_qr_token()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.qr_token IS DISTINCT FROM OLD.qr_token THEN
    INSERT INTO public.qr_token_history (
      restaurant_id, branch_id, table_id,
      token, issued_at, revoked_at, revoked_by, revoke_reason
    )
    VALUES (
      OLD.restaurant_id, OLD.branch_id, OLD.id,
      OLD.qr_token, OLD.qr_token_issued_at, now(),
      NULLIF(current_setting('app.actor_profile_id', true), '')::uuid,
      NULLIF(btrim(current_setting('app.actor_note', true)), '')
    );

    NEW.qr_token_issued_at := now();
    NEW.qr_rotation_count  := OLD.qr_rotation_count + 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.tables_prevent_token_reuse()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.qr_token IS NOT DISTINCT FROM OLD.qr_token THEN
    RETURN NEW;
  END IF;

  IF EXISTS (SELECT 1 FROM public.qr_token_history h WHERE h.token = NEW.qr_token) THEN
    RAISE EXCEPTION 'qr token has already been retired and cannot be re-issued'
      USING ERRCODE = 'QRT01';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_tables_prevent_token_reuse
  BEFORE INSERT OR UPDATE OF qr_token ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.tables_prevent_token_reuse();

CREATE TRIGGER trg_tables_rotate_qr_token
  BEFORE UPDATE OF qr_token ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.tables_rotate_qr_token();

COMMENT ON FUNCTION public.tables_rotate_qr_token() IS
  'Regeneration handling for brief §13/§14/§34.10. On any change to tables.qr_token it archives the OLD value into qr_token_history with who and when, then stamps qr_token_issued_at and bumps qr_rotation_count. Application code performs a rotation with a single statement: UPDATE tables SET qr_token = public.generate_qr_token() WHERE id = $1. Everything else is automatic, so no rotation path can forget to invalidate the old token.';
COMMENT ON FUNCTION public.tables_prevent_token_reuse() IS
  'Cross-table uniqueness cannot be a single constraint in PostgreSQL, so this closes the one hole in the two-table token design: a token present in qr_token_history can never reappear as a live tables.qr_token. Runs BEFORE the rotation trigger (alphabetical trigger ordering: prevent < rotate), so a rejected token never reaches the archive step. At 144 bits of entropy a natural collision is impossible; this defends against a restore, a manual UPDATE or a seed script re-using a value.';
```

**Trigger firing order matters here.** PostgreSQL fires `BEFORE` row triggers in **name order**.
`trg_tables_prevent_token_reuse` sorts before `trg_tables_rotate_qr_token`, so the reuse check runs
first. This is load-bearing; do not rename either trigger without preserving that order.

### 7.11 Waiter-call cooldown and order rate limiting

```sql
CREATE OR REPLACE FUNCTION public.assert_waiter_call_cooldown()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_cooldown INTEGER;
  v_last     TIMESTAMPTZ;
BEGIN
  SELECT b.waiter_call_cooldown_seconds INTO v_cooldown
  FROM public.branches b WHERE b.id = NEW.branch_id;

  v_cooldown := COALESCE(v_cooldown, 90);
  IF v_cooldown = 0 THEN
    RETURN NEW;
  END IF;

  SELECT max(w.created_at) INTO v_last
  FROM public.waiter_calls w
  WHERE w.branch_id = NEW.branch_id
    AND w.table_id  = NEW.table_id;

  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => v_cooldown) THEN
    RAISE EXCEPTION
      'waiter call cooldown active for table % (% seconds)', NEW.table_id, v_cooldown
      USING ERRCODE = 'WTC01';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_waiter_calls_cooldown
  BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.assert_waiter_call_cooldown();

COMMENT ON FUNCTION public.assert_waiter_call_cooldown() IS
  'Waiter-call spam protection (brief §10, §27), in the database so it holds even if the API rate limiter is bypassed or misconfigured. Scoped to the TABLE, not the customer session, because the abuse case is one table pressing the button repeatedly and a guest can trivially clear their own cookie. Complements uq_waiter_calls_open_per_table: that index blocks a SECOND OPEN call, this trigger blocks a rapid SECOND CALL after the first was resolved. Setting branches.waiter_call_cooldown_seconds = 0 disables it for a venue that wants no throttle.';

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_order_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_interval INTEGER;
  v_last     TIMESTAMPTZ;
BEGIN
  IF NEW.channel <> 'qr' OR NEW.customer_session_id IS NULL THEN
    RETURN NEW;                          -- staff-entered orders are not rate limited
  END IF;

  SELECT b.order_min_interval_seconds INTO v_interval
  FROM public.branches b WHERE b.id = NEW.branch_id;

  v_interval := COALESCE(v_interval, 20);
  IF v_interval = 0 THEN
    RETURN NEW;
  END IF;

  SELECT max(o.placed_at) INTO v_last
  FROM public.orders o
  WHERE o.customer_session_id = NEW.customer_session_id
    AND o.table_id            = NEW.table_id;

  IF v_last IS NOT NULL AND v_last > now() - make_interval(secs => v_interval) THEN
    RAISE EXCEPTION
      'order rate limit: this session ordered less than % seconds ago', v_interval
      USING ERRCODE = 'ORD05';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_orders_rate_limit
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_rate_limit();

COMMENT ON FUNCTION public.assert_order_rate_limit() IS
  'Order-spam protection (brief §27), enforced per (customer_session_id, table_id) on the anonymous QR channel only. Waiter- and admin-entered orders are exempt: a busy waiter legitimately fires several orders in a row. This is the last line - the API layer rate limits by IP and session first and returns a friendly 429; reaching this trigger means that layer was bypassed.';
```

---

## 8. Indexes — every one, by name, with its rationale

### 8.1 Indexes created implicitly by constraints (do not create again)

Every `PRIMARY KEY` and `UNIQUE` constraint above already builds a btree index under the constraint's
name. These are listed so nobody adds a duplicate, and because several of them are what makes a
composite FK cheap.

| Index (= constraint name) | Columns | What it serves |
|---|---|---|
| `restaurants_pkey` | `(id)` | PK. |
| `uq_restaurants_slug` | `(slug)` | Admin route resolution by slug. |
| `branches_pkey` | `(id)` | PK; also the FK index for `branch_order_counters.branch_id`. |
| `uq_branches_tenant` | `(restaurant_id, id)` | FK target for every branch-scoped composite FK **and** the index behind `fk_branches_restaurant` (leading column `restaurant_id`). |
| `uq_branches_code` | `(restaurant_id, code)` | Branch-code uniqueness; the order-number prefix must be unambiguous. |
| `profiles_pkey` | `(id)` | PK; also the index for `fk_profiles_auth_user`. |
| `staff_pkey` | `(id)` | PK. |
| `uq_staff_tenant` | `(restaurant_id, id)` | FK target for staff references; index for `fk_staff_restaurant`. |
| `uq_staff_membership` | `(restaurant_id, profile_id, branch_id, role)` `NULLS NOT DISTINCT` | Prevents duplicate memberships including the both-NULL branch case. |
| `tables_pkey` | `(id)` | PK. |
| `uq_tables_qr_token` | `(qr_token)` | **The hot public path.** `/t/<token>` resolution is one index lookup. |
| `uq_tables_tenant` | `(restaurant_id, id)` | FK target; index for tenant-scoped scans. |
| `uq_tables_branch_identity` | `(branch_id, id)` | FK target for `orders`/`waiter_calls`/`qr_token_history`; also serves "all tables of a branch". |
| `qr_token_history_pkey` | `(id)` | PK. |
| `uq_qr_token_history_token` | `(token)` | The `410 Gone` lookup for a retired QR. |
| `menu_categories_pkey`, `uq_menu_categories_tenant` | `(id)`, `(restaurant_id, id)` | PK; FK target and `fk_menu_categories_restaurant` index. |
| `menu_items_pkey`, `uq_menu_items_tenant` | `(id)`, `(restaurant_id, id)` | PK; FK target and `fk_menu_items_restaurant` index. |
| `menu_item_options_pkey`, `uq_menu_item_options_tenant` | `(id)`, `(restaurant_id, id)` | PK; FK target. |
| `promotions_pkey`, `uq_promotions_tenant` | `(id)`, `(restaurant_id, id)` | PK; FK target and `fk_promotions_restaurant` index. |
| `promotion_items_pkey`, `uq_promotion_items_pair` | `(id)`, `(promotion_id, menu_item_id)` | PK; "which items are in this promotion". |
| `pk_branch_order_counters` | `(branch_id, business_date)` | **The concurrency primitive.** The `ON CONFLICT` arbiter and the row lock of §6.12. |
| `orders_pkey` | `(id)` | PK. |
| `uq_orders_tenant` | `(restaurant_id, id)` | FK target for all order children. |
| `uq_orders_public_code` | `(public_code)` | Customer tracking `/o/<code>` — one lookup, no join. |
| `uq_orders_branch_day_seq` | `(branch_id, business_date, order_seq)` | Second guarantee of daily numbering uniqueness; also the KDS "today, in order" scan. |
| `uq_orders_branch_day_number` | `(branch_id, business_date, order_number)` | Staff search by the printed number `A-014`. |
| `order_items_pkey`, `uq_order_items_tenant`, `uq_order_items_in_order` | `(id)`, `(restaurant_id, id)`, `(order_id, id)` | PK; FK target; **the by-order fetch** (leading `order_id`) that renders every ticket. |
| `order_item_options_pkey` | `(id)` | PK. |
| `uq_order_item_options_line_option` | `(order_item_id, menu_item_option_id)` `NULLS NOT DISTINCT` | One row per (line, option); also the per-line option fetch. |
| `order_status_history_pkey` | `(id)` | PK. |
| `waiter_calls_pkey`, `uq_waiter_calls_tenant` | `(id)`, `(restaurant_id, id)` | PK; FK target for notifications. |
| `notifications_pkey`, `uq_notifications_tenant` | `(id)`, `(restaurant_id, id)` | PK; FK target for `notification_reads`. |
| `pk_notification_reads` | `(notification_id, staff_id)` | PK; idempotent "mark as read" upsert arbiter. |

### 8.2 Partial unique indexes declared with their tables

| Index | Definition | Rationale |
|---|---|---|
| `uq_staff_operational_single_branch` | `(restaurant_id, profile_id, role) WHERE role IN ('WAITER','KITCHEN')` | Together with `ck_staff_role_scope`, gives **exactly one** branch per operational role. |
| `uq_staff_employee_code` | `(restaurant_id, employee_code) WHERE employee_code IS NOT NULL` | Employee codes unique per tenant, but optional. |
| `uq_tables_branch_number` | `(branch_id, number) WHERE deleted_at IS NULL` | Table numbers unique per branch, while allowing a retired "12" and a new "12". |
| `uq_menu_item_options_single_default` | `(menu_item_id, group_key) WHERE selection_type = 'single' AND is_default AND deleted_at IS NULL` | A radio group can never open with two options pre-selected. |
| `uq_waiter_calls_open_per_table` | `(table_id) WHERE status IN ('pending','acknowledged')` | At most one open call per table — spam protection as a constraint. |

### 8.3 Explicit indexes

```sql
-- ===========================================================================
-- restaurants / branches / profiles / staff
-- ===========================================================================

CREATE INDEX idx_restaurants_active
  ON public.restaurants (created_at DESC)
  WHERE is_active AND deleted_at IS NULL;
-- Platform-admin tenant list, newest first, excluding offboarded tenants.

CREATE INDEX idx_branches_restaurant_active
  ON public.branches (restaurant_id, name)
  WHERE is_active AND deleted_at IS NULL;
-- The branch switcher in the admin shell and the branch picker in staff invites.

CREATE INDEX idx_profiles_platform_admin
  ON public.profiles (id)
  WHERE is_platform_admin;
-- Tiny partial index. Every RLS policy has a "or the caller is a platform admin"
-- branch; this makes that branch an index probe over a handful of rows instead of
-- a scan of the whole profiles table.

CREATE INDEX idx_staff_profile_active
  ON public.staff (profile_id, restaurant_id, branch_id, role)
  WHERE is_active;
-- THE most important index for authorization. "Which memberships does auth.uid()
-- have?" runs on every RLS-checked row. Covering: the four columns every policy
-- needs are in the index, so the check is index-only.

CREATE INDEX idx_staff_restaurant_branch
  ON public.staff (restaurant_id, branch_id);
-- FK index for fk_staff_branch. Also the admin Staff page, grouped by branch.

CREATE INDEX idx_staff_branch_role
  ON public.staff (branch_id, role)
  WHERE is_active AND branch_id IS NOT NULL;
-- "Who is on shift as KITCHEN at branch X" — notification targeting and the
-- staff presence strip on the waiter console.

-- ===========================================================================
-- tables / qr_token_history
-- ===========================================================================

CREATE INDEX idx_tables_restaurant_branch
  ON public.tables (restaurant_id, branch_id);
-- FK index for fk_tables_branch.

CREATE INDEX idx_tables_branch_sorted
  ON public.tables (branch_id, sort_order, number)
  WHERE deleted_at IS NULL;
-- The admin table grid and the waiter floor map, in display order, in one scan.

CREATE INDEX idx_qr_token_history_restaurant_branch
  ON public.qr_token_history (restaurant_id, branch_id);
-- FK index for fk_qr_token_history_branch.

CREATE INDEX idx_qr_token_history_table_revoked
  ON public.qr_token_history (branch_id, table_id, revoked_at DESC);
-- FK index for fk_qr_token_history_table (leading branch_id, table_id) AND the
-- per-table rotation history shown in the admin audit drawer.

CREATE INDEX idx_qr_token_history_revoked_by
  ON public.qr_token_history (revoked_by)
  WHERE revoked_by IS NOT NULL;
-- FK index for fk_qr_token_history_revoked_by; keeps profile deletion from
-- degrading into a sequential scan of the history table.

-- ===========================================================================
-- menu
-- ===========================================================================

CREATE INDEX idx_menu_categories_restaurant_branch
  ON public.menu_categories (restaurant_id, branch_id);
-- FK index for fk_menu_categories_branch.

CREATE INDEX idx_menu_categories_active_sorted
  ON public.menu_categories (restaurant_id, branch_id, sort_order)
  WHERE is_active AND deleted_at IS NULL;
-- The customer menu's category rail, already ordered. NULL branch_id (shared
-- categories) is indexable and sorts together with the branch-specific rows.

CREATE INDEX idx_menu_items_restaurant_branch
  ON public.menu_items (restaurant_id, branch_id);
-- FK index for fk_menu_items_branch.

CREATE INDEX idx_menu_items_restaurant_category
  ON public.menu_items (restaurant_id, category_id);
-- FK index for fk_menu_items_category.

CREATE INDEX idx_menu_items_category_sorted
  ON public.menu_items (category_id, sort_order, id)
  WHERE deleted_at IS NULL;
-- The main customer menu query: all live items of a category, in display order.

CREATE INDEX idx_menu_items_featured
  ON public.menu_items (restaurant_id, branch_id, sort_order)
  WHERE is_featured AND deleted_at IS NULL;
-- The "featured food" hero rail on the customer home (brief §4).

CREATE INDEX idx_menu_items_popular
  ON public.menu_items (restaurant_id, branch_id, popularity_score DESC)
  WHERE deleted_at IS NULL;
-- The "popular dishes" rail, sorted by the analytics-maintained score. Not
-- partial on is_popular: the rail falls back to top-scoring items when no dish
-- is manually pinned.

CREATE INDEX idx_menu_items_search_vector
  ON public.menu_items USING GIN (search_vector);
-- The customer search field. Prefix queries:
--   WHERE search_vector @@ to_tsquery('simple', quote_literal(term) || ':*')

CREATE INDEX idx_menu_items_dietary_tags
  ON public.menu_items USING GIN (dietary_tags);
-- Dietary filter chips: dietary_tags @> ARRAY['vegetarian']::dietary_tag[].
-- GIN over an enum array uses the default array_ops opclass.

CREATE INDEX idx_menu_items_unavailable_until
  ON public.menu_items (unavailable_until)
  WHERE unavailable_until IS NOT NULL;
-- The housekeeping job that flips temporarily-86-ed dishes back to available
-- scans exactly this partial index, never the whole menu.

CREATE INDEX idx_menu_item_options_restaurant_item
  ON public.menu_item_options (restaurant_id, menu_item_id);
-- FK index for fk_menu_item_options_item.

CREATE INDEX idx_menu_item_options_item_grouped
  ON public.menu_item_options (menu_item_id, group_sort_order, sort_order)
  WHERE deleted_at IS NULL;
-- The product-detail sheet: every option of a dish, already grouped and ordered.

-- ===========================================================================
-- promotions
-- ===========================================================================

CREATE INDEX idx_promotions_restaurant_branch
  ON public.promotions (restaurant_id, branch_id);
-- FK index for fk_promotions_branch.

CREATE INDEX idx_promotions_active_window
  ON public.promotions (restaurant_id, branch_id, starts_at DESC, ends_at)
  WHERE is_active AND deleted_at IS NULL;
-- "Active promotions" on the customer home. The time comparison against now()
-- cannot live in the index predicate (now() is not IMMUTABLE), so starts_at and
-- ends_at are index columns and the query filters on them.

CREATE INDEX idx_promotion_items_restaurant_promotion
  ON public.promotion_items (restaurant_id, promotion_id);
-- FK index for fk_promotion_items_promotion.

CREATE INDEX idx_promotion_items_restaurant_menu_item
  ON public.promotion_items (restaurant_id, menu_item_id);
-- FK index for fk_promotion_items_menu_item; also "is this dish on promotion?"
-- when rendering a menu card badge.

-- ===========================================================================
-- orders
-- ===========================================================================

CREATE INDEX idx_orders_restaurant_branch
  ON public.orders (restaurant_id, branch_id);
-- FK index for fk_orders_branch.

CREATE INDEX idx_orders_branch_table
  ON public.orders (branch_id, table_id);
-- FK index for fk_orders_table.

CREATE INDEX idx_orders_kds_live
  ON public.orders (branch_id, status, placed_at)
  WHERE status IN ('pending', 'confirmed', 'preparing', 'ready');
-- THE kitchen and waiter query. The three KDS columns (NEW / PREPARING / READY)
-- and the waiter's Active + Ready lists are all slices of this one partial index,
-- which stays small because completed and cancelled orders drop out of it.

CREATE INDEX idx_orders_due_at
  ON public.orders (branch_id, due_at)
  WHERE status IN ('confirmed', 'preparing');
-- Late-order detection (brief §9). The flagging sweep touches only in-flight
-- orders of one branch.

CREATE INDEX idx_orders_branch_business_date
  ON public.orders (branch_id, business_date, status);
-- Every "today" figure on the admin dashboard: revenue, order count, average
-- order value, status overview. Grouped by the same business_date the numbering
-- uses, so the dashboard and the tickets can never disagree about which day it is.

CREATE INDEX idx_orders_restaurant_placed_at
  ON public.orders (restaurant_id, placed_at DESC);
-- The admin Orders list across all branches, newest first.

CREATE INDEX idx_orders_customer_session
  ON public.orders (customer_session_id, placed_at DESC)
  WHERE customer_session_id IS NOT NULL;
-- Two consumers: the guest's own order history on the tracking screen, and the
-- rate-limit lookup in assert_order_rate_limit().

CREATE INDEX idx_orders_table_open
  ON public.orders (table_id, status)
  WHERE status IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered');
-- "Active tables" on the dashboard and the occupied/free state of the waiter
-- floor map: a table is busy iff it has a row in this partial index.

CREATE INDEX idx_orders_confirmed_by_staff
  ON public.orders (restaurant_id, confirmed_by_staff_id)
  WHERE confirmed_by_staff_id IS NOT NULL;
CREATE INDEX idx_orders_served_by_staff
  ON public.orders (restaurant_id, served_by_staff_id)
  WHERE served_by_staff_id IS NOT NULL;
CREATE INDEX idx_orders_cancelled_by_staff
  ON public.orders (restaurant_id, cancelled_by_staff_id)
  WHERE cancelled_by_staff_id IS NOT NULL;
-- FK indexes for the three staff attribution FKs. Partial, because most orders
-- name at most one or two of them, and because a staff-row delete must not
-- degenerate into three sequential scans of the orders table.

-- ===========================================================================
-- order children
-- ===========================================================================

CREATE INDEX idx_order_items_restaurant_order
  ON public.order_items (restaurant_id, order_id);
-- FK index for fk_order_items_order.

CREATE INDEX idx_order_items_restaurant_menu_item
  ON public.order_items (restaurant_id, menu_item_id, created_at DESC)
  WHERE menu_item_id IS NOT NULL;
-- Dual purpose: FK index for fk_order_items_menu_item, and the "most popular
-- dishes" aggregation (brief §11), which counts lines per dish over a date range.

CREATE INDEX idx_order_items_order_sorted
  ON public.order_items (order_id, sort_order, id);
-- Ticket and receipt rendering, in the order the guest built the cart.

CREATE INDEX idx_order_item_options_restaurant_order
  ON public.order_item_options (restaurant_id, order_id);
-- FK index for fk_order_item_options_order; also fetches every option of an
-- order in one scan when printing a ticket.

CREATE INDEX idx_order_item_options_order_line
  ON public.order_item_options (order_id, order_item_id, sort_order);
-- FK index for fk_order_item_options_order_item, and the per-line option list.

CREATE INDEX idx_order_item_options_restaurant_option
  ON public.order_item_options (restaurant_id, menu_item_option_id)
  WHERE menu_item_option_id IS NOT NULL;
-- FK index for fk_order_item_options_menu_item_option; also "how often is this
-- extra chosen" for menu analytics.

CREATE INDEX idx_order_status_history_order_created
  ON public.order_status_history (order_id, created_at DESC);
-- The customer's visual order tracker (brief §8) and the admin order timeline.

CREATE INDEX idx_order_status_history_restaurant_order
  ON public.order_status_history (restaurant_id, order_id);
-- FK index for fk_order_status_history_order.

CREATE INDEX idx_order_status_history_restaurant_branch
  ON public.order_status_history (restaurant_id, branch_id, created_at DESC);
-- FK index for fk_order_status_history_branch; also the branch activity feed and
-- the kitchen throughput report (transitions per hour).

CREATE INDEX idx_order_status_history_changed_by
  ON public.order_status_history (changed_by)
  WHERE changed_by IS NOT NULL;
-- FK index for fk_order_status_history_changed_by; also per-employee activity.

-- ===========================================================================
-- waiter_calls
-- ===========================================================================

CREATE INDEX idx_waiter_calls_restaurant_branch
  ON public.waiter_calls (restaurant_id, branch_id);
-- FK index for fk_waiter_calls_branch.

CREATE INDEX idx_waiter_calls_branch_open
  ON public.waiter_calls (branch_id, created_at)
  WHERE status IN ('pending', 'acknowledged');
-- The waiter console's Table Calls panel: oldest open call first. Stays tiny -
-- resolved calls leave the index.

CREATE INDEX idx_waiter_calls_branch_table_created
  ON public.waiter_calls (branch_id, table_id, created_at DESC);
-- FK index for fk_waiter_calls_table, and the cooldown lookup in
-- assert_waiter_call_cooldown() (max(created_at) per table).

CREATE INDEX idx_waiter_calls_restaurant_order
  ON public.waiter_calls (restaurant_id, order_id)
  WHERE order_id IS NOT NULL;
-- FK index for fk_waiter_calls_order.

CREATE INDEX idx_waiter_calls_acknowledged_by
  ON public.waiter_calls (restaurant_id, acknowledged_by_staff_id)
  WHERE acknowledged_by_staff_id IS NOT NULL;
CREATE INDEX idx_waiter_calls_resolved_by
  ON public.waiter_calls (restaurant_id, resolved_by_staff_id)
  WHERE resolved_by_staff_id IS NOT NULL;
-- FK indexes for the two staff attribution FKs; also per-waiter response-time
-- analytics.

-- ===========================================================================
-- notifications
-- ===========================================================================

CREATE INDEX idx_notifications_restaurant_branch
  ON public.notifications (restaurant_id, branch_id, created_at DESC);
-- FK index for fk_notifications_branch; also the admin-wide feed.

CREATE INDEX idx_notifications_branch_role_created
  ON public.notifications (branch_id, target_role, created_at DESC)
  WHERE target_role IS NOT NULL;
-- The KDS and waiter console feeds (role broadcast within a branch).

CREATE INDEX idx_notifications_branch_staff_created
  ON public.notifications (branch_id, target_staff_id, created_at DESC)
  WHERE target_staff_id IS NOT NULL;
-- Directly addressed notifications for one staff member.

CREATE INDEX idx_notifications_restaurant_target_staff
  ON public.notifications (restaurant_id, target_staff_id)
  WHERE target_staff_id IS NOT NULL;
-- FK index for fk_notifications_target_staff (the branch-leading index above does
-- not serve a restaurant_id-leading FK check).

CREATE INDEX idx_notifications_restaurant_order
  ON public.notifications (restaurant_id, order_id)
  WHERE order_id IS NOT NULL;
CREATE INDEX idx_notifications_restaurant_waiter_call
  ON public.notifications (restaurant_id, waiter_call_id)
  WHERE waiter_call_id IS NOT NULL;
-- FK indexes for the two deep-link FKs. Both cascade on delete, so without these
-- deleting an order would sequentially scan notifications.

CREATE INDEX idx_notifications_expires_at
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;
-- The retention job deletes expired notifications by scanning only this index.

CREATE INDEX idx_notification_reads_staff
  ON public.notification_reads (staff_id, notification_id);
-- The LEFT JOIN in the panel query (§6.19): "has THIS staff member read it".

CREATE INDEX idx_notification_reads_restaurant_notification
  ON public.notification_reads (restaurant_id, notification_id);
CREATE INDEX idx_notification_reads_restaurant_staff
  ON public.notification_reads (restaurant_id, staff_id);
-- FK indexes for fk_notification_reads_notification and fk_notification_reads_staff.
-- The primary key leads with notification_id, not restaurant_id, so neither FK
-- check can use it.
```

**FK coverage audit.** Every `FOREIGN KEY` declared in §6 has an index whose leading columns are the
FK's referencing columns, in order. Composite FKs of the form `(restaurant_id, x)` are covered either
by a dedicated `idx_*_restaurant_x` or, where `x = id`, by the `uq_*_tenant (restaurant_id, id)`
constraint index. This matters twice: PostgreSQL needs it to validate `ON DELETE CASCADE` /
`SET NULL` without a sequential scan of the child, and every one of these FK columns is also a join key
in a panel query.

---

## 9. Realtime publication and RLS enablement

### 9.1 Supabase Realtime

Brief §28 forbids polling as the primary mechanism. Realtime delivers WAL changes, but only for tables
added to the `supabase_realtime` publication, and only with `OLD` values (needed for status-change
diffing and for RLS-filtered subscriptions) when replica identity is `FULL`.

```sql
ALTER TABLE public.orders               REPLICA IDENTITY FULL;
ALTER TABLE public.order_items          REPLICA IDENTITY FULL;
ALTER TABLE public.order_status_history REPLICA IDENTITY FULL;
ALTER TABLE public.waiter_calls         REPLICA IDENTITY FULL;
ALTER TABLE public.notifications        REPLICA IDENTITY FULL;
ALTER TABLE public.menu_items           REPLICA IDENTITY FULL;
ALTER TABLE public.tables               REPLICA IDENTITY FULL;

ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.order_status_history;
ALTER PUBLICATION supabase_realtime ADD TABLE public.waiter_calls;
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE public.menu_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.tables;
```

Why each is published:

| Table | Consumer |
|---|---|
| `orders` | KDS new-order alert; customer tracker status changes; waiter Ready list. |
| `order_items` | KDS card contents when a line is amended mid-service. |
| `order_status_history` | The customer's visual tracker timeline appends without refetching the order. |
| `waiter_calls` | "TABLE 12 IS CALLING" on the waiter console (brief §10). |
| `notifications` | The badge/toast feed on all three staff panels. |
| `menu_items` | Customer menu reacts live when a dish is 86-ed mid-browse (brief §5, §32). |
| `tables` | Admin table grid reflects QR rotation and activation from another operator's session. |

Tables **not** published — `restaurants`, `branches`, `profiles`, `staff`, `menu_categories`,
`menu_item_options`, `promotions`, `promotion_items`, `order_item_options`, `qr_token_history`,
`branch_order_counters`, `notification_reads` — change rarely or carry no live-screen meaning; each
publication entry costs WAL decoding on every write, so they are refetched on navigation instead.

`REPLICA IDENTITY FULL` writes the whole old row into the WAL, which roughly doubles WAL volume for
those seven tables. That is accepted deliberately: without it, Realtime's RLS-aware filtering cannot
evaluate a policy against the old row, and a `DELETE`/`UPDATE` event would arrive with only the primary
key — insufficient for the KDS to know which branch a change belongs to.

### 9.2 Row-Level Security — enable everywhere, fail closed

```sql
ALTER TABLE public.restaurants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_token_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_options     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_calls          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads    ENABLE ROW LEVEL SECURITY;

-- branch_order_counters is a concurrency primitive, never read by a client.
REVOKE ALL ON public.branch_order_counters FROM anon, authenticated;
-- qr_token_history is an audit table read only through server routes.
REVOKE ALL ON public.qr_token_history FROM anon;
```

With RLS enabled and **zero policies**, every role except `service_role` (which has `BYPASSRLS`) sees
nothing and can write nothing. That is the correct state until
`docs/architecture/02-rls-and-authorization.md` lands. The columns that document provides for are:
`restaurant_id` (tenant predicate), `branch_id` (branch predicate), `staff.profile_id` (membership
lookup via `idx_staff_profile_active`), `profiles.is_platform_admin` (super-admin branch), and
`orders.customer_session_id` (anonymous guest self-access).

**Public customer reads do not rely on `anon` table grants.** The `/t/[token]` resolver, the menu
query and order creation all run in Node route handlers with the service-role key, which never reaches
the browser. The public client therefore needs no privileges on any table in this schema; RLS policies
for `anon` exist only for the Realtime subscription on `orders` scoped by `public_code`.

---

## 10. Error codes: `SQLSTATE` → HTTP

Custom five-character `SQLSTATE`s raised by the triggers above. The API layer maps them; anything not
in this table is a 500.

| SQLSTATE | Raised by | Meaning | HTTP | Client message key |
|---|---|---|---|---|
| `ORD01` | `orders_status_guard` | Illegal status transition | 409 | `errors.order.invalid_transition` |
| `ORD02` | `assert_order_totals_consistent`, `assert_order_item_options_consistent` | Totals do not add up — **a server bug**, never user input | 500 | `errors.internal` |
| `ORD03` | `assert_order_totals_consistent` | Order has no items | 422 | `errors.order.empty` |
| `ORD04` | `orders_status_guard` | Cancellation without a reason | 422 | `errors.order.reason_required` |
| `ORD05` | `assert_order_rate_limit` | Order too soon after the previous one | 429 | `errors.order.too_fast` |
| `MNU01` | `assert_order_item_orderable` | Dish unavailable or deleted | 422 | `errors.menu.item_unavailable` |
| `MNU02` | `assert_option_group_consistent` | Inconsistent option-group attributes | 422 | `errors.menu.option_group_conflict` |
| `MNU03` | `assert_menu_item_scope` | Item scope wider than its category | 422 | `errors.menu.scope_conflict` |
| `WTC01` | `assert_waiter_call_cooldown` | Waiter-call cooldown active | 429 | `errors.waiter_call.cooldown` |
| `QRT01` | `tables_prevent_token_reuse` | QR token was previously retired | 409 | `errors.qr.token_reused` |
| `BRN01` | `validate_branch_timezone` | Unknown IANA timezone | 422 | `errors.branch.invalid_timezone` |
| `AUD01` | `forbid_mutation` | Attempted write to an append-only table | 403 | `errors.internal` |
| `23503` | any composite FK | Cross-tenant or dangling reference | 403 | `errors.forbidden` |
| `23505` | `uq_waiter_calls_open_per_table` | A call is already open for this table | 409 | `errors.waiter_call.already_open` |
| `23514` | any `CHECK` | Malformed input that passed zod | 422 | `errors.validation` |

A `23503` from a composite tenant FK is deliberately surfaced as **403, not 404**: it means the caller
referenced another tenant's row, which is an authorization failure, and the response must not confirm
whether that row exists.

---

## 11. Conventions binding on implementers

**Naming.** `pk_` / `uq_` / `fk_` / `ck_` / `idx_` / `trg_` prefixes, then the table name, then the
columns or purpose. Primary keys declared inline (`restaurants_pkey`) keep PostgreSQL's default name;
every other constraint is named explicitly so migrations and error messages are greppable.

**TypeScript.** Generate types with
`supabase gen types typescript --local > src/lib/supabase/database.types.ts`. Then, in
`src/lib/money.ts`:

```ts
/** An exact integer count of minor currency units. Never fractional, never negative. */
export type Money = number;
```

Note that `bigint` columns are emitted by the generator as `number`. That is safe here:
`Number.MAX_SAFE_INTEGER` is 9.007×10¹⁵, and the largest plausible UZS order total is ~10⁷ minor units —
nine orders of magnitude of headroom. It is documented rather than ignored, and
`src/lib/money.ts` asserts `Number.isSafeInteger` on every value crossing the API boundary.

`i18n_text` columns are emitted as `Json`. Narrow them in `src/lib/i18n/types.ts`:

```ts
export type I18nText = Partial<Record<'uz' | 'ru' | 'en', string>>;
```

**Timestamps.** Every timestamp is `TIMESTAMPTZ`, stored in UTC. Local dates and dayparts are derived
from `branches.timezone` at read time. The only stored local value is `orders.business_date`, and it is
computed once, server-side, by `next_order_number()`.

**Zod parity.** Every `CHECK` above has a mirrored zod rule in `src/lib/validation/`. The database
constraint is the guarantee; the zod schema is the friendly error. Where they disagree, the database
wins and the mismatch is a bug in the zod schema.

**Seed data.** `supabase/seed.sql` creates one tenant with `is_demo = true`, two branches
(`code = 'A'`, `code = 'B'`), 12 tables, 6 categories and ~40 items. Every analytics query filters
`restaurants.is_demo = false` by default, satisfying brief §11.

---

## 12. Deliberately out of scope

Named so no implementer wonders whether they were forgotten:

- **Payments.** No `payments`, `transactions` or `refunds` table. Brief §33 defers payment integration
  until ordering is stable. `orders.total` is the amount due; settlement happens off-platform.
- **Per-line kitchen status.** `order_items` has no `status`. The KDS in this MVP moves whole orders
  (brief §9 lists order-level actions only). Adding it later is an additive column plus a rollup rule.
- **Inventory / stock counts.** `menu_items.is_available` and `unavailable_until` are the 86-ing model.
  No quantity tracking.
- **Reservations, loyalty, customer accounts.** Brief §11 and §33 exclude all three.
- **Table sessions / bill splitting.** Multiple orders from one table are independent rows correlated
  by `table_id` and `customer_session_id`.
- **AI recommendations.** Brief §33 excludes them from the MVP; `popularity_score` is a sales counter,
  not a model.

---

## TABLE INVENTORY

Implement against this section without reading the prose above. Notation: `!` = `NOT NULL`,
`?` = nullable, `=x` = default, `PK` / `U` / `FK` as marked, `GEN` = stored generated column.
Types `i18n_text` (jsonb `{uz,ru,en}`), `money_minor` (bigint minor units, `>= 0`), `bps`
(integer 0–10000) are the domains from §3.

**Types:** `app_role`(SUPER_ADMIN, RESTAURANT_OWNER, MANAGER, WAITER, KITCHEN) · `order_status`(pending, confirmed, preparing, ready, delivered, completed, cancelled) · `order_type`(dine_in, takeaway) · `order_channel`(qr, waiter, admin) · `dietary_tag`(vegetarian, vegan, halal, gluten_free, lactose_free, nut_free, contains_nuts, contains_seafood, contains_pork, contains_alcohol) · `waiter_call_reason`(call_waiter, request_bill, request_water, request_cutlery, clean_table, complaint, other) · `waiter_call_status`(pending, acknowledged, resolved, cancelled, expired) · `actor_kind`(customer, staff, system) · `option_selection_type`(single, multiple) · `promotion_type`(announcement, percentage, fixed_amount, special_price) · `notification_type`(order_created, order_confirmed, order_preparing, order_ready, order_delivered, order_completed, order_cancelled, order_late, waiter_call_created, waiter_call_acknowledged, menu_item_unavailable, system) · `app_locale`(uz, ru, en)

```
restaurants           id uuid PK =gen_random_uuid() | name text! | slug text! U | logo_url text? | logo_path text? | cover_image_url text? | phone text? | email text? | welcome_message i18n_text? | description i18n_text? | default_locale app_locale! ='uz' | currency char(3)! ='UZS' | currency_decimals smallint! =0 | service_fee_bps bps! =0 | service_fee_enabled boolean! =false | settings jsonb! ='{}' | is_active boolean! =true | is_demo boolean! =false | deleted_at timestamptz? | created_at timestamptz! =now() | updated_at timestamptz! =now()

branches              id uuid PK =gen_random_uuid() | restaurant_id uuid! FK->restaurants(id) CASCADE | name text! | code text! (U with restaurant_id, ^[A-Z][A-Z0-9]{0,3}$) | address text? | phone text? | timezone text! ='Asia/Tashkent' | latitude numeric(9,6)? | longitude numeric(9,6)? | service_fee_bps bps? | opening_hours jsonb! ='{}' | waiter_call_cooldown_seconds integer! =90 | waiter_call_expiry_minutes integer! =30 | order_min_interval_seconds integer! =20 | default_prep_minutes smallint! =15 | late_order_threshold_minutes smallint! =25 | is_active boolean! =true | is_accepting_orders boolean! =true | deleted_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id)]

profiles              id uuid PK NO DEFAULT FK->auth.users(id) CASCADE | email text? (lowercase) | full_name text? | phone text? | avatar_url text? | avatar_path text? | locale app_locale! ='uz' | is_platform_admin boolean! =false | is_active boolean! =true | last_seen_at timestamptz? | created_at timestamptz! | updated_at timestamptz!

staff                 id uuid PK =gen_random_uuid() | restaurant_id uuid! FK->restaurants(id) CASCADE | branch_id uuid? FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | profile_id uuid! FK->profiles(id) CASCADE | role app_role! (<> SUPER_ADMIN) | permissions jsonb! ='{}' | display_name text? | employee_code text? | is_active boolean! =true | invited_at timestamptz? | joined_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); U NULLS NOT DISTINCT (restaurant_id,profile_id,branch_id,role); partial U (restaurant_id,profile_id,role) WHERE role IN (WAITER,KITCHEN)]

tables                id uuid PK =gen_random_uuid() | restaurant_id uuid! | branch_id uuid! FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | number text! | name text? | zone text? | seats smallint? | sort_order integer! =0 | qr_token text! U =generate_qr_token() | qr_token_issued_at timestamptz! =now() | qr_rotation_count integer! =0 | is_active boolean! =true | deleted_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); U (branch_id,id); partial U (branch_id,number) WHERE deleted_at IS NULL]

qr_token_history      id uuid PK =gen_random_uuid() | restaurant_id uuid! | branch_id uuid! FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | table_id uuid! FK(branch_id,table_id)->tables(branch_id,id) CASCADE | token text! U | issued_at timestamptz! | revoked_at timestamptz! =now() | revoked_by uuid? FK->profiles(id) SET NULL | revoke_reason text? | created_at timestamptz! | updated_at timestamptz!   [APPEND-ONLY]

menu_categories       id uuid PK =gen_random_uuid() | restaurant_id uuid! FK->restaurants(id) CASCADE | branch_id uuid? FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | name i18n_text! | description i18n_text? | image_url text? | image_path text? | icon text? | sort_order integer! =0 | is_active boolean! =true | deleted_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id)]

menu_items            id uuid PK =gen_random_uuid() | restaurant_id uuid! FK->restaurants(id) CASCADE | branch_id uuid? FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | category_id uuid! FK(restaurant_id,category_id)->menu_categories(restaurant_id,id) RESTRICT | name i18n_text! | description i18n_text? | ingredients i18n_text? | price money_minor! | compare_at_price money_minor? (> price) | image_url text? | image_path text? | spicy_level smallint! =0 (0..3) | preparation_time smallint! =15 (1..240, minutes) | calories integer? | dietary_tags dietary_tag[]! ='{}' | is_available boolean! =true | unavailable_until timestamptz? | available_from time? | available_until time? | is_featured boolean! =false | is_popular boolean! =false | popularity_score integer! =0 | sort_order integer! =0 | search_vector tsvector GEN | deleted_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id)]

menu_item_options     id uuid PK =gen_random_uuid() | restaurant_id uuid! | menu_item_id uuid! FK(restaurant_id,menu_item_id)->menu_items(restaurant_id,id) CASCADE | group_key text! ='extras' | group_label i18n_text! | selection_type option_selection_type! ='multiple' | group_min_select smallint! =0 | group_max_select smallint? | group_sort_order integer! =0 | name i18n_text! | price_delta money_minor! =0 | max_quantity smallint! =1 | is_default boolean! =false | is_available boolean! =true | sort_order integer! =0 | deleted_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); partial U (menu_item_id,group_key) WHERE selection_type='single' AND is_default AND deleted_at IS NULL]

promotions            id uuid PK =gen_random_uuid() | restaurant_id uuid! FK->restaurants(id) CASCADE | branch_id uuid? FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | promo_type promotion_type! ='announcement' | title i18n_text! | description i18n_text? | badge_label i18n_text? | image_url text? | image_path text? | discount_bps bps? | discount_amount money_minor? | special_price money_minor? | starts_at timestamptz! =now() | ends_at timestamptz? | sort_order integer! =0 | is_active boolean! =true | deleted_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id)]

promotion_items       id uuid PK =gen_random_uuid() | restaurant_id uuid! | promotion_id uuid! FK(restaurant_id,promotion_id)->promotions(restaurant_id,id) CASCADE | menu_item_id uuid! FK(restaurant_id,menu_item_id)->menu_items(restaurant_id,id) CASCADE | created_at timestamptz! | updated_at timestamptz!   [U (promotion_id,menu_item_id)]

branch_order_counters branch_id uuid! FK->branches(id) CASCADE | business_date date! | last_number integer! =0 | created_at timestamptz! | updated_at timestamptz!   [PK (branch_id,business_date); NO uuid id - concurrency primitive]

orders                id uuid PK =gen_random_uuid() | restaurant_id uuid! | branch_id uuid! FK(restaurant_id,branch_id)->branches(restaurant_id,id) RESTRICT | table_id uuid? FK(branch_id,table_id)->tables(branch_id,id) RESTRICT | public_code text! U =generate_public_code() | order_number text! (trigger-assigned, "A-014") | order_seq integer! (trigger-assigned) | business_date date! (trigger-assigned, branch-local) | order_type order_type! ='dine_in' | channel order_channel! ='qr' | status order_status! ='pending' | customer_session_id uuid? | customer_name text? | customer_phone text? | customer_note text? (<=500) | guest_count smallint? | locale app_locale! ='uz' | currency char(3)! (snapshot) | currency_decimals smallint! (snapshot) | subtotal money_minor! =0 | discount_total money_minor! =0 | service_fee money_minor! =0 | service_fee_bps bps! =0 (snapshot) | total money_minor! =0 (= subtotal - discount_total + service_fee) | estimated_prep_minutes smallint! =15 | due_at timestamptz? | placed_at timestamptz! =now() | confirmed_at timestamptz? | preparing_at timestamptz? | ready_at timestamptz? | delivered_at timestamptz? | completed_at timestamptz? | cancelled_at timestamptz? | cancellation_reason text? | confirmed_by_staff_id uuid? FK(restaurant_id,·)->staff(restaurant_id,id) SET NULL(col) | served_by_staff_id uuid? FK(restaurant_id,·)->staff SET NULL(col) | cancelled_by_staff_id uuid? FK(restaurant_id,·)->staff SET NULL(col) | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); U (branch_id,business_date,order_seq); U (branch_id,business_date,order_number)]

order_items           id uuid PK =gen_random_uuid() | restaurant_id uuid! | order_id uuid! FK(restaurant_id,order_id)->orders(restaurant_id,id) CASCADE | menu_item_id uuid? FK(restaurant_id,menu_item_id)->menu_items(restaurant_id,id) SET NULL(menu_item_id) | name_snapshot i18n_text! | description_snapshot i18n_text? | category_name_snapshot i18n_text? | image_url_snapshot text? | price_snapshot money_minor! | spicy_level_snapshot smallint! =0 (0..3) | preparation_time_snapshot smallint! =15 | dietary_tags_snapshot dietary_tag[]! ='{}' | quantity integer! (>0, <=999) | options_total money_minor! =0 | total money_minor GEN = quantity*(price_snapshot+options_total) | note text? (<=300) | sort_order integer! =0 | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); U (order_id,id)]

order_item_options    id uuid PK =gen_random_uuid() | restaurant_id uuid! | order_id uuid! FK(restaurant_id,order_id)->orders(restaurant_id,id) CASCADE | order_item_id uuid! FK(order_id,order_item_id)->order_items(order_id,id) CASCADE | menu_item_option_id uuid? FK(restaurant_id,·)->menu_item_options(restaurant_id,id) SET NULL(menu_item_option_id) | group_key_snapshot text! | group_label_snapshot i18n_text! | name_snapshot i18n_text! | price_delta_snapshot money_minor! | quantity smallint! =1 (>0, <=20) | total_per_unit money_minor GEN = quantity*price_delta_snapshot | sort_order integer! =0 | created_at timestamptz! | updated_at timestamptz!   [U NULLS NOT DISTINCT (order_item_id,menu_item_option_id)]

order_status_history  id uuid PK =gen_random_uuid() | restaurant_id uuid! | branch_id uuid! FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | order_id uuid! FK(restaurant_id,order_id)->orders(restaurant_id,id) CASCADE | previous_status order_status? | new_status order_status! | changed_by uuid? FK->profiles(id) SET NULL | changed_by_kind actor_kind! ='system' | changed_by_role app_role? | note text? (<=300) | created_at timestamptz! | updated_at timestamptz! (always = created_at)   [APPEND-ONLY; written only by trg_orders_log_status_change]

waiter_calls          id uuid PK =gen_random_uuid() | restaurant_id uuid! | branch_id uuid! FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | table_id uuid! FK(branch_id,table_id)->tables(branch_id,id) CASCADE | order_id uuid? FK(restaurant_id,order_id)->orders(restaurant_id,id) SET NULL(order_id) | reason waiter_call_reason! ='call_waiter' | status waiter_call_status! ='pending' | note text? (<=200) | customer_session_id uuid? | acknowledged_at timestamptz? | acknowledged_by_staff_id uuid? FK(restaurant_id,·)->staff SET NULL(col) | resolved_at timestamptz? | resolved_by_staff_id uuid? FK(restaurant_id,·)->staff SET NULL(col) | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); partial U (table_id) WHERE status IN (pending,acknowledged)]

notifications         id uuid PK =gen_random_uuid() | restaurant_id uuid! | branch_id uuid! FK(restaurant_id,branch_id)->branches(restaurant_id,id) CASCADE | target_role app_role? (<> SUPER_ADMIN) | target_staff_id uuid? FK(restaurant_id,·)->staff(restaurant_id,id) CASCADE | type notification_type! | payload jsonb! ='{}' | priority smallint! =1 (0..2) | order_id uuid? FK(restaurant_id,order_id)->orders(restaurant_id,id) CASCADE | waiter_call_id uuid? FK(restaurant_id,waiter_call_id)->waiter_calls(restaurant_id,id) CASCADE | expires_at timestamptz? | created_at timestamptz! | updated_at timestamptz!   [U (restaurant_id,id); CHECK target_role IS NOT NULL OR target_staff_id IS NOT NULL]

notification_reads    notification_id uuid! FK(restaurant_id,notification_id)->notifications(restaurant_id,id) CASCADE | staff_id uuid! FK(restaurant_id,staff_id)->staff(restaurant_id,id) CASCADE | restaurant_id uuid! | read_at timestamptz! =now() | created_at timestamptz! | updated_at timestamptz!   [PK (notification_id,staff_id); NO uuid id - pure junction]
```

**19 tables.** 13 required by the brief (`restaurants`, `branches`, `profiles`, `staff`, `tables`,
`menu_categories`, `menu_items`, `menu_item_options`, `orders`, `order_items`, `order_status_history`,
`waiter_calls`, `notifications`) plus 6 supporting tables designed here and justified in place:
`qr_token_history` (§6.6), `promotions` (§6.10), `promotion_items` (§6.11), `branch_order_counters`
(§6.12), `order_item_options` (§6.15), `notification_reads` (§6.19).
