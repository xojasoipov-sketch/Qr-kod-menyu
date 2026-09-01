-- =============================================================================
-- RESTAURANT QR OS — migration 8 of 10
-- File: 20260901000800_functions_triggers.sql
--
-- Implements docs/architecture/01-database-schema.md:
--   §5   Utility functions
--        §5.1 public.set_updated_at()
--        §5.2 public.generate_qr_token(INTEGER)        (re-asserted; created in
--        §5.3 public.generate_public_code()             migrations 3 and 6 where
--        §5.4 public.is_valid_order_transition(...)     column DEFAULTs need them)
--        §5.5 public.safe_app_locale(TEXT, public.app_locale)  (new: F04)
--   §7   Trigger functions and triggers
--        §7.1  updated_at on every table
--        §7.2  auth.users -> public.profiles
--        §7.3  branch timezone validation, order-number allocation
--        §7.4  currency and fee snapshotting on order creation
--        §7.5  order totals consistency (deferred constraint triggers)
--        §7.6  line-level option rollup (deferred constraint triggers)
--        §7.7  order state machine, audit trail, append-only enforcement
--        §7.8  option-group consistency
--        §7.9  menu scope consistency and the orderability backstop
--        §7.10 QR token rotation, history and reuse prevention
--        §7.11 waiter-call cooldown and order rate limiting
--
-- This file is the AUTHORITATIVE order-status state machine. Any TypeScript
-- copy (src/lib/orders/state-machine.ts) mirrors it; it does not define it.
-- An illegal transition reaching Postgres raises SQLSTATE ORD01 (§10).
--
-- SECURITY DEFINER policy (§7 global note): every function that reads or writes
-- rows other than the one being modified is SECURITY DEFINER with a pinned
-- search_path, so that a trigger firing on behalf of `anon` is not blinded by
-- RLS. Functions touching only NEW/OLD stay invoker-rights.
--
-- No money column is created here. The money assertions below use numeric only
-- as the intermediate of a rounding division, immediately cast back to bigint.
--
-- Depends on: 20260901000100 (enums public.order_status, public.actor_kind,
--                             public.app_role, public.app_locale; extensions
--                             schema with pgcrypto),
--             20260901000200 (restaurants, branches, profiles, staff),
--             20260901000300 (tables, qr_token_history),
--             20260901000400 (menu_categories, menu_items, menu_item_options),
--             20260901000500 (promotions, promotion_items),
--             20260901000600 (branch_order_counters, orders, order_items,
--                             order_item_options, order_status_history),
--             20260901000700 (waiter_calls, notifications, notification_reads).
-- =============================================================================


-- =============================================================================
-- §5 UTILITY FUNCTIONS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- §5.1 set_updated_at() — the universal updated_at trigger
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.set_updated_at() IS
  'BEFORE UPDATE FOR EACH ROW on every table carrying updated_at. Set unconditionally (not only when the row changed) so that a no-op UPDATE still emits a Realtime event, which the panels use as a cheap "touch to re-broadcast" signal.';

-- ---------------------------------------------------------------------------
-- §5.2 generate_qr_token() — 144-bit URL-safe token
-- Already created in 20260901000300 (the tables.qr_token DEFAULT needs it).
-- Re-asserted verbatim here so §5 is complete in one place.
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
-- §5.3 generate_public_code() — short unguessable public identifier
-- Already created in 20260901000600 (the orders.public_code DEFAULT needs it).
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
-- §5.4 is_valid_order_transition() — the state machine, as data
-- Already created in 20260901000600 (ck_order_status_history_transition needs
-- it). Re-asserted verbatim. IMMUTABLE + PARALLEL SAFE and deliberately WITHOUT
-- a SET clause: it touches no table, and a SET clause would block SQL inlining
-- of this hot predicate.
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


-- ---------------------------------------------------------------------------
-- §5.5 safe_app_locale() — total function from client text to public.app_locale
--
-- closes F04 (part 1). auth.users.raw_user_meta_data is CLIENT CONTROLLED: any
-- browser can send options.data = {locale: 'en-US'} at signup. A bare
-- ('en-US')::public.app_locale raises 22P02, and because trg_auth_user_created
-- is an AFTER INSERT trigger on auth.users that 22P02 aborts the whole signup
-- transaction (GoTrue answers 500 "Database error saving new user"). This
-- function is TOTAL: every text input, including NULL and garbage, maps to a
-- real enum label, so no client string can ever raise.
--
-- The lookup is against pg_enum rather than a hard-coded IN list so that adding
-- a locale to public.app_locale needs no second edit here.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.safe_app_locale(
  p_raw     TEXT,
  p_default public.app_locale DEFAULT 'uz'
)
RETURNS public.app_locale
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT COALESCE(
    (SELECT e.enumlabel::text::public.app_locale
       FROM pg_catalog.pg_enum e
       JOIN pg_catalog.pg_type t ON t.oid = e.enumtypid
       JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'public'
        AND t.typname = 'app_locale'
        AND e.enumlabel = btrim(COALESCE(p_raw, ''))
      LIMIT 1),
    p_default);
$$;

REVOKE ALL ON FUNCTION public.safe_app_locale(TEXT, public.app_locale) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.safe_app_locale(TEXT, public.app_locale) IS
  'Total coercion from an untrusted text locale to public.app_locale, falling back to p_default (uz, the profiles.locale default) for NULL, empty, mis-cased or unknown input such as the browser tag ''en-US''. Exists because the only producers of that text are clients (auth.users.raw_user_meta_data, OAuth provider metadata) and a failed cast inside an AFTER INSERT trigger on auth.users denies signup outright. Closes F04.';


-- The DROP TRIGGER IF EXISTS lines below make a re-run of this migration safe;
-- their "does not exist, skipping" notices are pure noise on a first run.
SET client_min_messages = warning;


-- =============================================================================
-- §7.1 updated_at on every table
--
-- order_status_history and qr_token_history deliberately get NO updated_at
-- trigger: both are append-only (§7.7c), so updated_at stays at created_at.
-- =============================================================================

DROP TRIGGER IF EXISTS trg_restaurants_set_updated_at            ON public.restaurants;
DROP TRIGGER IF EXISTS trg_branches_set_updated_at               ON public.branches;
DROP TRIGGER IF EXISTS trg_profiles_set_updated_at               ON public.profiles;
DROP TRIGGER IF EXISTS trg_staff_set_updated_at                  ON public.staff;
DROP TRIGGER IF EXISTS trg_tables_set_updated_at                 ON public.tables;
DROP TRIGGER IF EXISTS trg_menu_categories_set_updated_at        ON public.menu_categories;
DROP TRIGGER IF EXISTS trg_menu_items_set_updated_at             ON public.menu_items;
DROP TRIGGER IF EXISTS trg_menu_item_options_set_updated_at      ON public.menu_item_options;
DROP TRIGGER IF EXISTS trg_promotions_set_updated_at             ON public.promotions;
DROP TRIGGER IF EXISTS trg_promotion_items_set_updated_at        ON public.promotion_items;
DROP TRIGGER IF EXISTS trg_branch_order_counters_set_updated_at  ON public.branch_order_counters;
DROP TRIGGER IF EXISTS trg_orders_set_updated_at                 ON public.orders;
DROP TRIGGER IF EXISTS trg_order_items_set_updated_at            ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_item_options_set_updated_at     ON public.order_item_options;
DROP TRIGGER IF EXISTS trg_waiter_calls_set_updated_at           ON public.waiter_calls;
DROP TRIGGER IF EXISTS trg_notifications_set_updated_at          ON public.notifications;
DROP TRIGGER IF EXISTS trg_notification_reads_set_updated_at     ON public.notification_reads;

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


-- =============================================================================
-- §7.2 auth.users -> public.profiles
-- =============================================================================

-- closes F04. Everything that reaches public.profiles from this trigger is
-- CLIENT CONTROLLED (auth.users.email is validated only loosely by GoTrue, and
-- raw_user_meta_data is whatever the signup call put in options.data), while
-- profiles is strictly typed and CHECK constrained. The trigger is AFTER INSERT
-- ON auth.users, so ANY error raised here aborts the signup transaction and the
-- user is never created — a client-triggerable denial of signup. Three were
-- reproduced against a live database:
--   1. locale 'en-US'                -> 22P02 invalid input value for app_locale
--   2. full_name longer than 120     -> 23514 ck_profiles_full_name_len
--   3. email 'user@localhost'        -> 23514 ck_profiles_email_format
-- The rule inverted below: SANITISE, never propagate. Each value is coerced or
-- dropped to something the constraints accept, and the whole INSERT is wrapped
-- in an exception handler so that no future constraint, no future column and no
-- unforeseen input can make profile creation block account creation. A profile
-- that fails to materialise is repairable (the row can be back-filled); an
-- account that cannot be created is not.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta      JSONB := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_email     TEXT;
  v_full_name TEXT;
  v_avatar    TEXT;
  v_locale    public.app_locale;
BEGIN
  -- email: keep it only if it satisfies ck_profiles_email_format AND
  -- ck_profiles_email_lowercase. profiles.email is a nullable display copy —
  -- auth.users owns the authoritative address — so dropping an address this
  -- schema cannot represent costs nothing and never blocks signup.
  v_email := lower(btrim(COALESCE(NEW.email, '')));
  IF v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    v_email := NULL;
  END IF;

  -- full_name: truncate to the 120 characters ck_profiles_full_name_len allows.
  -- left() before btrim() so a padded 200-character string cannot survive.
  v_full_name := NULLIF(btrim(left(COALESCE(v_meta ->> 'full_name', ''), 120)), '');

  -- avatar_url: no CHECK today, but an unbounded client string in a column the
  -- admin UI renders is not worth storing. Rejected rather than truncated: half
  -- a URL is a broken image, NULL is a default avatar.
  v_avatar := NULLIF(btrim(COALESCE(v_meta ->> 'avatar_url', '')), '');
  IF v_avatar IS NOT NULL AND char_length(v_avatar) > 2048 THEN
    v_avatar := NULL;
  END IF;

  -- locale: total coercion, never a cast (§5.5).
  v_locale := public.safe_app_locale(v_meta ->> 'locale');

  INSERT INTO public.profiles (id, email, full_name, avatar_url, locale)
  VALUES (NEW.id, v_email, v_full_name, v_avatar, v_locale)
  ON CONFLICT (id) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Last line of defence: signup must not fail because of this trigger. The
    -- WARNING lands in the Postgres log with the auth user id, so a missing
    -- profile is diagnosable and back-fillable.
    RAISE WARNING 'handle_new_auth_user: profile creation skipped for auth user % (%: %)',
      NEW.id, SQLSTATE, SQLERRM;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auth_user_created ON auth.users;

CREATE TRIGGER trg_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

COMMENT ON FUNCTION public.handle_new_auth_user() IS
  'Guarantees the 1:1 between auth.users and profiles at the database level, so no signup path (email, OAuth, admin invite, SQL) can produce an authenticated user without a profile row. ON CONFLICT DO NOTHING keeps it idempotent if a profile was pre-created by an invite flow. Every value copied out of auth.users is CLIENT CONTROLLED and is therefore sanitised, not trusted: the locale goes through public.safe_app_locale() (an unknown tag such as ''en-US'' becomes ''uz'' instead of raising 22P02), full_name is truncated to the 120 characters ck_profiles_full_name_len allows, an address that cannot satisfy ck_profiles_email_format is stored as NULL, and an over-long avatar_url is dropped. The whole INSERT sits inside an EXCEPTION WHEN OTHERS handler because this is an AFTER INSERT trigger on auth.users: any error it raises would abort signup itself and GoTrue would answer 500. Closes F04.';


-- =============================================================================
-- §7.3 Branch timezone validation and order-number assignment
-- =============================================================================

CREATE OR REPLACE FUNCTION public.validate_branch_timezone()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names z WHERE z.name = NEW.timezone) THEN
    RAISE EXCEPTION 'unknown IANA timezone: %', NEW.timezone
      USING ERRCODE = 'BRN01';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_branches_validate_timezone ON public.branches;

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
VOLATILE
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
VOLATILE
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

DROP TRIGGER IF EXISTS trg_orders_assign_number ON public.orders;

CREATE TRIGGER trg_orders_assign_number
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_assign_number();

COMMENT ON FUNCTION public.orders_assign_number() IS
  'Fills business_date, order_seq and order_number on INSERT. Application code MUST omit all three (the columns are NOT NULL with no default; the trigger is what satisfies them). The conditional guard exists solely for data-restore paths that supply explicit values.';


-- =============================================================================
-- §7.4 Currency and fee snapshotting on order creation
-- =============================================================================

CREATE OR REPLACE FUNCTION public.orders_snapshot_pricing_context()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_orders_snapshot_pricing_context ON public.orders;

CREATE TRIGGER trg_orders_snapshot_pricing_context
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_snapshot_pricing_context();

COMMENT ON FUNCTION public.orders_snapshot_pricing_context() IS
  'Resolves and freezes the pricing context of an order: currency, currency_decimals and the effective service-fee rate (branch override, else restaurant default, else 0 when the fee is disabled). Done in the database rather than the API so that every write path - customer app, waiter panel, admin, seed script - gets the identical resolution, and so a client cannot dictate its own service-fee rate. It OVERWRITES whatever the caller supplied for these three columns.';


-- =============================================================================
-- §7.5 Order totals consistency (deferred constraint trigger)
--
-- Contract: any transaction that inserts, updates or deletes order_items MUST
-- recompute orders.subtotal, orders.service_fee and orders.total before it
-- commits. There is deliberately no auto-maintenance trigger; this assertion
-- catches any lapse at COMMIT.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_order_totals_consistent()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_orders_totals_consistent       ON public.orders;
DROP TRIGGER IF EXISTS trg_order_items_rollup_consistent  ON public.order_items;

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


-- =============================================================================
-- §7.6 Line-level option rollup (deferred constraint trigger)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_order_item_options_consistent()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_order_items_options_total_consistent   ON public.order_items;
DROP TRIGGER IF EXISTS trg_order_item_options_rollup_consistent   ON public.order_item_options;

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


-- =============================================================================
-- §7.7 The order state machine, its audit trail, and its immutability
-- =============================================================================

-- --- (a) Transition guard + automatic lifecycle timestamps -----------------
--
-- AUTHORITATIVE. An illegal transition raises ORD01; a cancellation without a
-- reason raises ORD04. Invoker-rights: it touches only NEW/OLD and one
-- IMMUTABLE function.

-- closes F10 (second half). Besides the transition check and the lifecycle
-- timestamps, this guard is the only BEFORE UPDATE trigger positioned to know
-- WHO moved the order, so it also stamps the three staff attribution columns.
-- Nothing else in the chain ever wrote orders.confirmed_by_staff_id /
-- served_by_staff_id / cancelled_by_staff_id, so those columns — and the three
-- partial indexes built on them in 20260901000900_indexes.sql — were
-- permanently empty and every "which waiter served this?" question was
-- unanswerable.
--
-- NOTE TO ANY LATER MIGRATION THAT SUPERSEDES THIS BODY (20260901001500_
-- guard_triggers.sql does, via CREATE OR REPLACE on the same OID, to make the
-- state machine role-aware): the replacement MUST preserve, in this order,
--   (1) the is_valid_order_transition() check raising ORD01,
--   (2) every lifecycle timestamp assignment below, including due_at,
--   (3) the mandatory cancellation_reason raising ORD04,
--   (4) the COALESCE(NEW.<col>, v_staff_id) stamping of the three
--       *_by_staff_id columns, and the rule that a transition declared
--       app.actor_kind = 'customer' stamps none of them (a guest cancelling
--       their own order is not staff work),
-- or F10 silently reopens.
--
-- Security mode is DEFINER rather than INVOKER because the body now reads
-- public.staff, which an anon caller inside public_place_order / public_cancel_
-- order holds no SELECT on; that follows the §7 global note at the top of this
-- file (a trigger that reads rows other than NEW/OLD is DEFINER with a pinned
-- search_path).
CREATE OR REPLACE FUNCTION public.orders_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_actor_kind TEXT;
  v_profile    UUID;
  v_staff_id   UUID;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT public.is_valid_order_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'illegal order status transition: % -> % (order %)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'ORD01';
  END IF;

  -- Who is moving it. The documented actor contract (§7.7b) wins when the
  -- caller adopted it; otherwise the JWT subject is the actor, which is the
  -- state of every ordinary staff UPDATE through PostgREST. A transition
  -- explicitly declared as customer work stamps no staff column at all.
  v_actor_kind := NULLIF(btrim(current_setting('app.actor_kind', true)), '');

  IF v_actor_kind IS DISTINCT FROM 'customer' THEN
    v_profile := COALESCE(
                   NULLIF(btrim(current_setting('app.actor_profile_id', true)), '')::uuid,
                   (SELECT auth.uid()));

    IF v_profile IS NOT NULL THEN
      -- The FK is composite (restaurant_id, staff_id), so the membership must
      -- belong to THIS order's restaurant; a restaurant-wide row (branch_id
      -- NULL) counts for every branch of it. Strongest role wins when someone
      -- holds several memberships in one tenant.
      SELECT s.id INTO v_staff_id
      FROM public.staff s
      WHERE s.profile_id    = v_profile
        AND s.restaurant_id = NEW.restaurant_id
        AND (s.branch_id IS NULL OR s.branch_id = NEW.branch_id)
        AND s.is_active
      ORDER BY array_position(
        ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[], s.role)
      LIMIT 1;
    END IF;
  END IF;

  CASE NEW.status
    WHEN 'confirmed' THEN
      NEW.confirmed_at := COALESCE(NEW.confirmed_at, now());
      NEW.due_at       := COALESCE(NEW.due_at,
                            now() + make_interval(mins => NEW.estimated_prep_minutes));
      NEW.confirmed_by_staff_id := COALESCE(NEW.confirmed_by_staff_id, v_staff_id);
    WHEN 'preparing' THEN NEW.preparing_at := COALESCE(NEW.preparing_at, now());
    WHEN 'ready'     THEN NEW.ready_at     := COALESCE(NEW.ready_at,     now());
    WHEN 'delivered' THEN
      NEW.delivered_at := COALESCE(NEW.delivered_at, now());
      NEW.served_by_staff_id := COALESCE(NEW.served_by_staff_id, v_staff_id);
    WHEN 'completed' THEN NEW.completed_at := COALESCE(NEW.completed_at, now());
    WHEN 'cancelled' THEN
      NEW.cancelled_at := COALESCE(NEW.cancelled_at, now());
      NEW.cancelled_by_staff_id := COALESCE(NEW.cancelled_by_staff_id, v_staff_id);
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

DROP TRIGGER IF EXISTS trg_orders_status_guard ON public.orders;

CREATE TRIGGER trg_orders_status_guard
  BEFORE UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_status_guard();

COMMENT ON FUNCTION public.orders_status_guard() IS
  'The database''s enforcement of brief §26 and §34.8. Rejects any transition is_valid_order_transition() disallows - completed -> preparing and cancelled -> ready both raise ORD01 - and stamps the lifecycle timestamp for the state being entered so no code path can advance an order without recording when. due_at is computed here rather than as a GENERATED column because timestamptz + interval is STABLE, not IMMUTABLE, and is therefore rejected in a generated-column expression. It also stamps confirmed_by_staff_id / served_by_staff_id / cancelled_by_staff_id from the acting staff row (app.actor_profile_id, else auth.uid(), resolved inside this order''s restaurant), which nothing in the chain did before, leaving those three columns and their three indexes permanently empty - closes F10. A transition declared app.actor_kind = ''customer'' stamps none of them. This is a backstop, not the primary implementation: the API state machine must reject the transition first and return a friendly 409.';

-- --- (b) Automatic history logging -----------------------------------------
--
-- Actor contract (binding for every writer): before mutating orders.status the
-- caller sets transaction-local settings --
--   SELECT set_config('app.actor_profile_id', $1, true);  -- profile uuid, or ''
--   SELECT set_config('app.actor_kind',       $2, true);  -- staff|customer|system
--   SELECT set_config('app.actor_role',       $3, true);  -- app_role label, or ''
--   SELECT set_config('app.actor_note',       $4, true);  -- optional reason, or ''
-- The third argument true makes them transaction-local, so they cannot leak
-- across pooled connections. Unset settings degrade to ('system', NULL, NULL).

-- closes F10 (first half). The actor used to come from the transaction GUCs and
-- from nothing else, which produced two reproduced defects:
--   (a) with no GUC set — the state of EVERY ordinary staff UPDATE through
--       PostgREST — every row was written changed_by_kind='system',
--       changed_by=NULL, changed_by_role=NULL, so the audit trail brief §25 asks
--       for attributed no staff action to anyone;
--   (b) setting app.actor_profile_id WITHOUT app.actor_role — the natural first
--       step of adopting the contract — made kind='staff' with role NULL, which
--       ck_order_status_history_staff_actor rejects with 23514, i.e. adopting
--       half the contract broke all staff order handling.
-- The function is now self-sufficient: it falls back to the JWT subject, it
-- derives the role itself from the branch role helpers, and it classifies a
-- change as 'staff' ONLY when a role was actually resolved, so no combination
-- of settings can produce a row the CHECK constraints reject.
CREATE OR REPLACE FUNCTION public.orders_log_status_change()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID;
  v_actor     UUID;
  v_kind      public.actor_kind;
  v_kind_raw  TEXT;
  v_role      public.app_role;
  v_note      TEXT;
  v_prev      public.order_status;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NULL;
  END IF;

  v_uid      := (SELECT auth.uid());
  v_actor    := NULLIF(btrim(current_setting('app.actor_profile_id', true)), '')::uuid;
  v_kind_raw := NULLIF(btrim(current_setting('app.actor_kind',       true)), '');
  v_role     := NULLIF(btrim(current_setting('app.actor_role',       true)), '')::public.app_role;
  v_note     := NULLIF(btrim(current_setting('app.actor_note',       true)), '');
  v_prev     := CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END;

  IF v_kind_raw = 'customer' THEN
    -- An anonymous guest. ck_order_status_history_customer_actor requires both
    -- identity columns to be NULL, and there is no profile to name anyway.
    v_kind  := 'customer';
    v_actor := NULL;
    v_role  := NULL;

  ELSIF v_kind_raw = 'system' THEN
    -- Explicitly declared machine work (cron, backfill). Honoured as declared:
    -- no role is claimed on its behalf.
    v_kind := 'system';
    v_role := NULL;

  ELSE
    -- Everything else, INCLUDING the plain PostgREST staff UPDATE that sets no
    -- GUC at all. The JWT subject is the actor when the contract was not used.
    v_actor := COALESCE(v_actor, v_uid);

    IF v_role IS NULL AND v_actor IS NOT NULL THEN
      IF v_actor = v_uid THEN
        -- The caller is the actor: the branch role helpers already answer this
        -- exactly as the RLS policies do (and return SUPER_ADMIN for a platform
        -- admin). They are created in 20260901001100_authz_helpers.sql, which
        -- runs before any traffic reaches this trigger.
        v_role := COALESCE(public.auth_role_in_branch(NEW.branch_id), public.auth_role());
      ELSE
        -- A service-role writer naming a different actor: resolve that
        -- profile's strongest active membership in this order's restaurant.
        SELECT s.role INTO v_role
        FROM public.staff s
        JOIN public.profiles p ON p.id = s.profile_id
        WHERE s.profile_id    = v_actor
          AND s.restaurant_id = NEW.restaurant_id
          AND (s.branch_id IS NULL OR s.branch_id = NEW.branch_id)
          AND s.is_active
          AND p.is_active
        ORDER BY array_position(
          ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[], s.role)
        LIMIT 1;
      END IF;
    END IF;

    -- 'staff' is claimed only when a role backs it up. Anything else is
    -- 'system': that keeps changed_by (who we believe acted) while never
    -- violating ck_order_status_history_staff_actor, which is what the
    -- half-adopted contract used to do.
    v_kind := CASE
                WHEN v_actor IS NOT NULL AND v_role IS NOT NULL THEN 'staff'
                ELSE 'system'
              END::public.actor_kind;
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

DROP TRIGGER IF EXISTS trg_orders_log_status_change ON public.orders;

CREATE TRIGGER trg_orders_log_status_change
  AFTER INSERT OR UPDATE OF status ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_log_status_change();

COMMENT ON FUNCTION public.orders_log_status_change() IS
  'Writes order_status_history automatically, on creation (previous_status NULL, new_status pending) and on every subsequent status change. Because this is the ONLY writer of that table, no code path can change an order status without leaving an audit row - the guarantee brief §25 asks for. The actor is resolved in three steps rather than read from one setting: app.actor_profile_id if the caller adopted the §7.7b contract, else auth.uid(); the role from app.actor_role if given, else from auth_role_in_branch()/auth_role() for the caller or from the named profile''s staff row; and changed_by_kind is ''staff'' only when a role was actually resolved, ''system'' otherwise. That makes an ordinary PostgREST staff UPDATE - which sets no GUC at all - attributable instead of anonymous, and makes the half-adopted contract (profile id without role) impossible to turn into a 23514 on ck_order_status_history_staff_actor. Closes F10. SECURITY DEFINER because an anonymous guest cancelling their own order has no INSERT right on the audit table, and because the role lookup reads public.staff.';

-- --- (c) Append-only enforcement -------------------------------------------
--
-- Note: a cascading delete of a parent orders row DOES fire this trigger and
-- aborts. That is intended - orders are never hard-deleted. Tenant offboarding
-- drops these triggers, deletes, and recreates them inside one transaction.

CREATE OR REPLACE FUNCTION public.forbid_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SET search_path = public, pg_temp
AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not permitted: this table is append-only',
    TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME
    USING ERRCODE = 'AUD01';
END;
$$;

DROP TRIGGER IF EXISTS trg_order_status_history_immutable ON public.order_status_history;
DROP TRIGGER IF EXISTS trg_qr_token_history_immutable     ON public.qr_token_history;

CREATE TRIGGER trg_order_status_history_immutable
  BEFORE UPDATE OR DELETE ON public.order_status_history
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();

CREATE TRIGGER trg_qr_token_history_immutable
  BEFORE UPDATE OR DELETE ON public.qr_token_history
  FOR EACH ROW EXECUTE FUNCTION public.forbid_mutation();

COMMENT ON FUNCTION public.forbid_mutation() IS
  'Makes a table append-only. Applied to order_status_history (an audit trail that can be rewritten is not an audit trail) and qr_token_history (deleting a retired token would allow it to be re-issued, defeating trg_tables_prevent_token_reuse). NOTE: a cascading delete from a parent DOES fire this trigger and will therefore abort. That is intended - see §7.7(c).';


-- =============================================================================
-- §7.8 Option-group consistency
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_option_group_consistent()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_menu_item_options_group_consistency ON public.menu_item_options;

CREATE TRIGGER trg_menu_item_options_group_consistency
  BEFORE INSERT OR UPDATE ON public.menu_item_options
  FOR EACH ROW EXECUTE FUNCTION public.assert_option_group_consistent();

COMMENT ON FUNCTION public.assert_option_group_consistent() IS
  'Group-level attributes (group_label, selection_type, group_min_select, group_max_select, group_sort_order) are replicated onto every row of an option group so that the brief''s single menu_item_options table can carry group semantics without a 20th table. This trigger is the constraint that makes the replication safe: it rejects any row that disagrees with its siblings. Editing a group''s attributes therefore requires updating all its rows in one statement (UPDATE ... WHERE menu_item_id = $1 AND group_key = $2), which is what the admin panel does.';


-- =============================================================================
-- §7.9 Menu scope consistency and the orderability backstop
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_menu_item_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_menu_items_scope_consistency ON public.menu_items;

CREATE TRIGGER trg_menu_items_scope_consistency
  BEFORE INSERT OR UPDATE OF branch_id, category_id ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.assert_menu_item_scope();

COMMENT ON FUNCTION public.assert_menu_item_scope() IS
  'An item may be no wider in scope than its category. A restaurant-wide item (branch_id NULL) inside a branch-exclusive category would be invisible at every other branch while claiming to be sold there - a state the customer menu query cannot render coherently. A restaurant-wide category (branch_id NULL) accepts items of any scope.';

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_order_item_orderable()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_order_items_item_orderable ON public.order_items;

CREATE TRIGGER trg_order_items_item_orderable
  BEFORE INSERT ON public.order_items
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_item_orderable();

COMMENT ON FUNCTION public.assert_order_item_orderable() IS
  'Database backstop for brief §34.3 ("cannot order unavailable products"). Deliberately checks ONLY the timezone-independent clauses of the orderability rule (deleted_at, is_available, unavailable_until). Daypart windows are excluded on purpose: they need branches.timezone, and a legitimate retroactive correction to an order placed inside the window must not be blocked hours later. The authoritative check remains src/lib/menu/orderability.ts, run before the transaction opens. Fires on INSERT only, so editing an existing line of an in-flight order is never blocked by a dish being 86-ed mid-service.';


-- =============================================================================
-- §7.10 QR token rotation, history and reuse prevention
--
-- Trigger firing order is load-bearing: PostgreSQL fires BEFORE row triggers in
-- NAME order, and trg_tables_prevent_token_reuse sorts before
-- trg_tables_rotate_qr_token, so a rejected token never reaches the archive
-- step. Do not rename either trigger without preserving that order.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.tables_rotate_qr_token()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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
VOLATILE
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

DROP TRIGGER IF EXISTS trg_tables_prevent_token_reuse ON public.tables;
DROP TRIGGER IF EXISTS trg_tables_rotate_qr_token     ON public.tables;

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


-- =============================================================================
-- §7.11 Waiter-call cooldown and order rate limiting
-- =============================================================================

CREATE OR REPLACE FUNCTION public.assert_waiter_call_cooldown()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_waiter_calls_cooldown ON public.waiter_calls;

CREATE TRIGGER trg_waiter_calls_cooldown
  BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.assert_waiter_call_cooldown();

COMMENT ON FUNCTION public.assert_waiter_call_cooldown() IS
  'Waiter-call spam protection (brief §10, §27), in the database so it holds even if the API rate limiter is bypassed or misconfigured. Scoped to the TABLE, not the customer session, because the abuse case is one table pressing the button repeatedly and a guest can trivially clear their own cookie. Complements uq_waiter_calls_open_per_table: that index blocks a SECOND OPEN call, this trigger blocks a rapid SECOND CALL after the first was resolved. Setting branches.waiter_call_cooldown_seconds = 0 disables it for a venue that wants no throttle.';

-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.assert_order_rate_limit()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
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

DROP TRIGGER IF EXISTS trg_orders_rate_limit ON public.orders;

CREATE TRIGGER trg_orders_rate_limit
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.assert_order_rate_limit();

COMMENT ON FUNCTION public.assert_order_rate_limit() IS
  'Order-spam protection (brief §27), enforced per (customer_session_id, table_id) on the anonymous QR channel only. Waiter- and admin-entered orders are exempt: a busy waiter legitimately fires several orders in a row. This is the last line - the API layer rate limits by IP and session first and returns a friendly 429; reaching this trigger means that layer was bypassed.';

RESET client_min_messages;

-- =============================================================================
-- End of migration 8.
-- =============================================================================
