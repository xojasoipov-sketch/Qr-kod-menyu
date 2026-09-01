-- =============================================================================
-- RESTAURANT QR OS — migration 1 of 10
-- File: 20260901000100_extensions_domains_enums.sql
--
-- Implements docs/architecture/01-database-schema.md:
--   §2 Extensions
--   §3 Domains        (public.is_i18n_text, public.i18n_text, public.money_minor, public.bps)
--   §4 Enumerated types (§4.1 - §4.10)
--
-- Nothing here depends on any other migration; every later migration depends on
-- this one. §5 utility functions and all tables live in later files.
-- Run once, in filename order. Not wrapped in an explicit transaction:
-- Supabase already runs each migration file in one.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §2 Extensions
--
-- closes F15 (and carries the schema-USAGE half of F02's note).
--
-- This file used to open with a bare
--     CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
-- which assumes the `extensions` schema already exists. It does on a Supabase
-- project, where the platform creates it before any project migration runs; it
-- does not on a stock PostgreSQL instance, where the whole chain aborted on its
-- very first statement with `ERROR: schema "extensions" does not exist`.
--
-- Three post-conditions must hold afterwards, identically on both platforms:
--
--   1. schema `extensions` exists and the request roles may traverse it. This
--      is not cosmetic: public.generate_qr_token() and
--      public.generate_public_code() are SECURITY INVOKER and sit in the
--      DEFAULT expression of tables.qr_token and orders.public_code, so a
--      manager creating a table executes them as `authenticated` and needs
--      USAGE on the schema they resolve through (F02).
--
--   2. pgcrypto is installed somewhere.
--
--   3. `extensions.gen_random_bytes(integer)` and `extensions.digest(text,text)`
--      resolve, because migrations 03 (line 39), 06 (line 52), 08 (lines 82/98)
--      and 13 (line 726) call them schema-qualified. If pgcrypto was already
--      installed into a different schema — a hand-rolled instance normally puts
--      it in `public` — moving or reinstalling someone else's extension is not
--      this migration's business, so we publish forwarding wrappers in
--      `extensions` instead. They are SECURITY DEFINER on purpose:
--      20260901009900 revokes every routine in `public` from anon and PUBLIC,
--      which would otherwise take pgcrypto away from the very roles that
--      evaluate those two column defaults.
--
-- The block is idempotent and re-runnable: nothing here is created twice, and
-- on Supabase (pgcrypto already in `extensions`) it does nothing at all beyond
-- the CREATE EXTENSION the old line did.
-- -----------------------------------------------------------------------------

DO $ext$
DECLARE
  v_schema TEXT;
BEGIN
  -- 1. The home schema. CREATE SCHEMA IF NOT EXISTS is not used: on a platform
  --    where the schema exists but is owned by another role, the IF NOT EXISTS
  --    form still requires CREATE on the database, and we would rather not ask
  --    for a privilege we do not need.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'extensions') THEN
    EXECUTE 'CREATE SCHEMA extensions';
    RAISE NOTICE
      'created schema "extensions" (Supabase ships it; stock PostgreSQL does not)';
  END IF;

  -- 2. Where does pgcrypto actually live?
  SELECT n.nspname
    INTO v_schema
  FROM pg_catalog.pg_extension e
  JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
  WHERE e.extname = 'pgcrypto';

  IF v_schema IS NULL THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION pgcrypto WITH SCHEMA extensions';
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION
        'pgcrypto is required for QR-token and order public-code entropy '
        '(doc 01 §2, §1.13) and could not be installed: %', SQLERRM;
    END;
    v_schema := 'extensions';
  END IF;

  -- 3. pgcrypto lives elsewhere: forward the two entry points the later
  --    migrations hard-code, so their schema-qualified calls still resolve.
  IF v_schema <> 'extensions' THEN
    RAISE WARNING
      'pgcrypto is installed in schema "%", not "extensions"; publishing '
      'SECURITY DEFINER forwarding wrappers extensions.gen_random_bytes(integer), '
      'extensions.digest(text,text) and extensions.digest(bytea,text) so the '
      'schema-qualified calls in migrations 03/06/08/13 resolve.', v_schema;

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION extensions.gen_random_bytes(INTEGER) '
      'RETURNS BYTEA LANGUAGE sql VOLATILE STRICT SECURITY DEFINER '
      'SET search_path = '''' AS ''SELECT %I.gen_random_bytes($1)''', v_schema);

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION extensions.digest(TEXT, TEXT) '
      'RETURNS BYTEA LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER '
      'SET search_path = '''' AS ''SELECT %I.digest($1, $2)''', v_schema);

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION extensions.digest(BYTEA, TEXT) '
      'RETURNS BYTEA LANGUAGE sql IMMUTABLE STRICT SECURITY DEFINER '
      'SET search_path = '''' AS ''SELECT %I.digest($1, $2)''', v_schema);

    EXECUTE 'COMMENT ON FUNCTION extensions.gen_random_bytes(INTEGER) IS '
            '''Forwarding wrapper published by 20260901000100 when pgcrypto is '
            'installed outside the extensions schema. SECURITY DEFINER so it '
            'survives 20260901009900''''s revoke of every routine in public. '
            'Closes F15.''';
    EXECUTE 'COMMENT ON FUNCTION extensions.digest(TEXT, TEXT) IS '
            '''Forwarding wrapper published by 20260901000100 when pgcrypto is '
            'installed outside the extensions schema. Closes F15.''';
    EXECUTE 'COMMENT ON FUNCTION extensions.digest(BYTEA, TEXT) IS '
            '''Forwarding wrapper published by 20260901000100 when pgcrypto is '
            'installed outside the extensions schema. Closes F15.''';
  END IF;
END
$ext$;

-- The request roles must be able to traverse the schema those functions live
-- in. Supabase grants this by default; a stock instance does not, and without
-- it `authenticated` creating a table fails with
-- `permission denied for schema extensions` one step after the F02 grants.
GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

-- Best effort: make the two entry points explicitly executable by the request
-- roles instead of relying on PostgreSQL's built-in EXECUTE-to-PUBLIC, which
-- F14 shows is not something to lean on. On a managed platform the extension's
-- functions may be owned by a role we cannot grant on; that is not fatal (the
-- built-in PUBLIC grant still applies there), so it degrades to a NOTICE.
DO $ext_grant$
BEGIN
  EXECUTE 'GRANT EXECUTE ON FUNCTION extensions.gen_random_bytes(INTEGER) '
          'TO anon, authenticated, service_role';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE
    'could not grant EXECUTE on extensions.gen_random_bytes(integer) (%); '
    'relying on the platform''s own grant.', SQLERRM;
END
$ext_grant$;

-- Self-check: the three post-conditions above, asserted rather than assumed.
-- Everything downstream of this file (QR tokens, order public codes, the
-- duplicate-payload fingerprint) is unrecoverable without them, so failing here
-- is strictly better than failing in migration 03, 06, 08 or 13.
DO $ext_check$
BEGIN
  IF to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION
      'doc 01 §2 violated: extensions.gen_random_bytes(integer) does not resolve; '
      'migrations 03/06/08 call it schema-qualified for QR tokens and public codes'
      USING ERRCODE = 'undefined_function';
  END IF;

  IF to_regprocedure('extensions.digest(text,text)') IS NULL THEN
    RAISE EXCEPTION
      'doc 01 §2 violated: extensions.digest(text,text) does not resolve; '
      'migration 13 calls it for the duplicate-payload fingerprint (doc 02 §5.2)'
      USING ERRCODE = 'undefined_function';
  END IF;

  IF NOT has_schema_privilege('authenticated', 'extensions', 'USAGE')
     OR NOT has_schema_privilege('anon', 'extensions', 'USAGE') THEN
    RAISE EXCEPTION
      'F02/F15: anon and authenticated need USAGE on schema extensions — '
      'public.generate_qr_token() is SECURITY INVOKER and is the DEFAULT of '
      'public.tables.qr_token'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT has_function_privilege('authenticated',
                                'extensions.gen_random_bytes(integer)', 'EXECUTE') THEN
    RAISE WARNING
      'authenticated cannot execute extensions.gen_random_bytes(integer); '
      'creating a public.tables row will fail on the qr_token DEFAULT (F02)';
  END IF;
END
$ext_check$;

-- gen_random_uuid() is in core PostgreSQL 13+; no extension needed for it.
-- gen_random_bytes() comes from pgcrypto and IS needed (QR tokens, order public codes).
-- pg_trgm is deliberately NOT installed: menu search uses a stored tsvector with the
-- `simple` configuration and `:*` prefix matching (§6.8).


-- -----------------------------------------------------------------------------
-- §3.1 i18n_text — trilingual content {"uz":...,"ru":...,"en":...}
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_i18n_text(v JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
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


-- -----------------------------------------------------------------------------
-- §3.2 money_minor — money as exact integers in minor currency units
-- -----------------------------------------------------------------------------
CREATE DOMAIN public.money_minor AS BIGINT
  CONSTRAINT ck_money_minor_non_negative CHECK (VALUE >= 0);

COMMENT ON DOMAIN public.money_minor IS
  'Money in MINOR CURRENCY UNITS as an exact integer (UZS tiyin-less: currency_decimals=0, so 45000 = 45 000 UZS). Never floating point. Signed BIGINT with a >= 0 check; negative adjustments are modelled as separate positive discount columns.';


-- -----------------------------------------------------------------------------
-- §3.3 bps — rates without floats
-- -----------------------------------------------------------------------------
CREATE DOMAIN public.bps AS INTEGER
  CONSTRAINT ck_bps_range CHECK (VALUE >= 0 AND VALUE <= 10000);

COMMENT ON DOMAIN public.bps IS
  'A rate in basis points: 10000 = 100.00%. Service fee percentages are stored as bps so that fee arithmetic stays in exact integer/numeric space and never touches a float.';

-- §3.4: citext_email is deliberately NOT defined. auth.users owns email uniqueness;
-- profiles.email is a lower-cased TEXT display copy, constrained but not unique.


-- -----------------------------------------------------------------------------
-- §4 Enumerated types — declared before any table that uses them.
-- MIGRATION HAZARD: ALTER TYPE ... ADD VALUE cannot be used and then referenced in
-- the same transaction. A future label must be added in its own migration file.
-- -----------------------------------------------------------------------------

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

-- §4.11: spicy_level is deliberately a SMALLINT with CHECK (BETWEEN 0 AND 3) on
-- menu_items, not an enum. 0 = not spicy, 1 = mild, 2 = medium, 3 = hot.
