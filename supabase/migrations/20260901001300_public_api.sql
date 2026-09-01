-- =============================================================================
-- RESTAURANT QR OS — migration 13
-- File: 20260901001300_public_api.sql
--
-- Implements docs/architecture/02-security-and-rls.md §2 in full:
--   §2.3  the five (and only five) entry points `anon` may execute
--   §2.5  shared internals: app_private.raise_app_error, app_private.table_context,
--         app_private.resolve_token, app_private.order_payload
--   §2.6  public.public_resolve_table  (STABLE)
--         public.public_get_menu       (STABLE)
--         public.public_place_order    (VOLATILE, server-side pricing)
--         public.public_get_order      (STABLE)
--         public.public_call_waiter    (VOLATILE)
--   §1.2  the two columns doc 03 §1.2 declares as REQUIRED ADDITIONS for the
--         idempotency / duplicate-payload / cooldown machinery
--
-- Threats this file is the control for (02 §1):
--   §1.3  price tampering      — no price, name or total is ever read from the
--                               caller; every amount is read from menu_items /
--                               menu_item_options inside this file.
--   §1.4  unavailable items    — the binding orderability rule (01 §6.8) is
--                               re-evaluated per line under FOR SHARE row locks.
--   §1.5  forged table identity— table_id/branch_id/restaurant_id are derived
--                               from the QR token; they are not parameters.
--   §1.6  stale/revoked tokens — a retired token lives in qr_token_history and
--                               resolves only on the read-only order path, <12h.
--   §1.7  order spam          — cooldown under SELECT ... FOR UPDATE, hourly
--                               counters, idempotency key, 60s payload dedupe.
--   §1.8  waiter-call spam    — cooldown + one-open-call-per-table unique index.
--   §1.9  status forgery      — no public write touches orders.status after
--                               creation; there is no such RPC.
--
-- Reconciliation (docs/architecture/03-domain-and-types.md §1, binding):
--   doc 01 owns schema vocabulary, doc 02 owns the authorization surface. Every
--   doc-02 identifier that doc 01 does not define is rewritten here to the
--   doc-01 name: qr_tokens -> tables.qr_token + qr_token_history,
--   orders.public_token -> orders.public_code, orders.note -> customer_note,
--   waiter_calls 'open' -> 'pending', app_role labels UPPER_SNAKE,
--   notifications.kind -> notifications.type, menu_item_options has no
--   branch_id, order_items has no branch_id.
--
-- Depends on: 20260901000000 (app_private schema + privilege baseline),
--             20260901000100..000900 (tables, triggers, indexes),
--             20260901001000 (RLS enabled + FORCE),
--             app_private.rate_limit_hit(text, integer, interval) — 02 §5.1,
--             created by the rate-limiting migration. Referenced only from
--             function bodies, so creation order here does not matter.
--
-- These functions are SECURITY DEFINER and owned by `postgres`, which holds
-- BYPASSRLS on Supabase; that is what lets them read the menu and write orders
-- while every application role holds zero privilege on those tables. They are
-- the ONLY write path into orders / order_items / order_item_options /
-- waiter_calls for a customer (02 §3.12, §3.13, §3.15: no INSERT policy exists
-- for any role).
--
-- Run once, in filename order. Not wrapped in an explicit transaction:
-- Supabase already runs each migration file in one.
-- =============================================================================


-- =============================================================================
-- 0. REQUIRED ADDITIONS (03 §1.2) — columns doc 02's logic needs
--
-- Idempotency and the duplicate-payload guard for public_place_order, and the
-- two per-table anti-spam clocks the function locks FOR UPDATE. Additive and
-- idempotent; the table-level grants of migration 12 already cover new columns,
-- and migration 99 re-revokes everything from anon.
-- =============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_request_id   UUID,
  ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_request_id
  ON public.orders (client_request_id) WHERE client_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_dup_guard
  ON public.orders (table_id, payload_fingerprint, created_at DESC);

COMMENT ON COLUMN public.orders.client_request_id IS
  'Client-generated v4 UUID, one per cart, reused across retries. The unique partial index makes a retry idempotent: public_place_order returns the original order instead of creating a second one. Also written to customer_session_id, which ck_orders_qr_channel_has_session requires on the qr channel.';
COMMENT ON COLUMN public.orders.payload_fingerprint IS
  'sha256(table_id || ''|'' || items json) of the submitted payload. Detects an accidental double submit from the SAME table with a DIFFERENT client_request_id inside the 60-second duplicate window (QR013_DUPLICATE_ORDER).';

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS last_order_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_waiter_call_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tables.last_order_at IS
  'Clock for the per-table order cooldown (branches.order_min_interval_seconds). Read and written by public_place_order only, under SELECT ... FOR UPDATE, so two concurrent submits from one table cannot both pass the cooldown.';
COMMENT ON COLUMN public.tables.last_waiter_call_at IS
  'Clock for the per-table waiter-call cooldown (branches.waiter_call_cooldown_seconds). Read and written by public_call_waiter only, under SELECT ... FOR UPDATE.';


-- =============================================================================
-- 1. §2.5 — structured error raiser
--
-- Every failure in the public API is signalled through this function. PostgREST
-- maps SQLSTATE 'PTnnn' to HTTP nnn; MESSAGE is the stable machine code the
-- TypeScript layer switches on; HINT is the constant that tells the error mapper
-- this was deliberate. Anything reaching a browser without that hint is
-- collapsed to QR999_INTERNAL / 500 (§10).
-- =============================================================================

CREATE OR REPLACE FUNCTION app_private.raise_app_error(
  p_code   TEXT,
  p_status INTEGER,
  p_detail JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = 'PT' || p_status::text,
    MESSAGE = p_code,
    DETAIL  = COALESCE(p_detail, '{}'::jsonb)::text,
    HINT    = 'RESTAURANT_QR_OS';
END;
$fn$;

REVOKE ALL ON FUNCTION app_private.raise_app_error(TEXT, INTEGER, JSONB)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.raise_app_error(TEXT, INTEGER, JSONB) IS
  'The single failure channel of the public capability API (02 §2.5, §10). Contains no SQL, so a STABLE caller may PERFORM it. Never widen DETAIL with anything an anonymous caller must not learn: it crosses the wire verbatim.';


-- =============================================================================
-- 2. §2.5 — the resolved table context
--
-- restaurant_id / branch_id / table_id live here for internal use and are NEVER
-- emitted to anon (the public-payload rule of §2.5).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_type t
    JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'app_private' AND t.typname = 'table_context'
  ) THEN
    CREATE TYPE app_private.table_context AS (
      restaurant_id              UUID,
      restaurant_name            TEXT,
      restaurant_slug            TEXT,
      restaurant_logo_url        TEXT,
      restaurant_welcome_message JSONB,
      restaurant_default_locale  public.app_locale,
      currency                   CHAR(3),
      currency_decimals          SMALLINT,
      branch_id                  UUID,
      branch_name                TEXT,
      branch_timezone            TEXT,
      branch_is_accepting_orders BOOLEAN,
      branch_order_interval_s    INTEGER,
      branch_call_cooldown_s     INTEGER,
      service_fee_enabled        BOOLEAN,
      service_fee_bps            INTEGER,
      table_id                   UUID,
      table_name                 TEXT,
      table_number               TEXT,
      qr_token                   TEXT
    );
  END IF;
END
$$;

COMMENT ON TYPE app_private.table_context IS
  'Everything the five public functions need about one QR token, resolved once. service_fee_bps is already the EFFECTIVE rate (branch override, else restaurant default, else 0 when restaurants.service_fee_enabled is false) - the same resolution orders_snapshot_pricing_context() performs, so the two can never disagree.';


-- =============================================================================
-- 3. §2.5 — the token resolver (the whole public API funnels through it)
--
-- Doc 01 has no `qr_tokens` table: the live token is public.tables.qr_token and
-- retired tokens are rows in public.qr_token_history (03 §1.1). A retired token
-- is therefore "found in history", and p_allow_revoked accepts it for 12 hours
-- so a diner mid-meal survives a QR rotation (§1.6). That path is read-only and
-- additionally requires the per-order code.
--
-- Malformed, unknown, revoked-too-long-ago and soft-deleted all raise the SAME
-- QR001, so an enumerator cannot tell them apart (§1.13).
-- =============================================================================

CREATE OR REPLACE FUNCTION app_private.resolve_token(
  p_token         TEXT,
  p_allow_revoked BOOLEAN DEFAULT false
)
RETURNS app_private.table_context
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v          app_private.table_context;
  v_table_id UUID;
  v_r_active BOOLEAN;
  v_b_active BOOLEAN;
  v_t_active BOOLEAN;
BEGIN
  IF p_token IS NULL OR p_token !~ '^[A-Za-z0-9_-]{22,64}$' THEN
    PERFORM app_private.raise_app_error('QR001_INVALID_QR_TOKEN', 404, '{}'::jsonb);
  END IF;

  -- Live token.
  SELECT t.id INTO v_table_id
  FROM public.tables t
  WHERE t.qr_token = p_token
    AND t.deleted_at IS NULL;

  -- Retired token: readable for 12h on the read-only path only.
  IF v_table_id IS NULL AND p_allow_revoked THEN
    SELECT h.table_id INTO v_table_id
    FROM public.qr_token_history h
    JOIN public.tables t ON t.branch_id = h.branch_id AND t.id = h.table_id
    WHERE h.token = p_token
      AND h.revoked_at > now() - interval '12 hours'
      AND t.deleted_at IS NULL
    ORDER BY h.revoked_at DESC
    LIMIT 1;
  END IF;

  IF v_table_id IS NULL THEN
    PERFORM app_private.raise_app_error('QR001_INVALID_QR_TOKEN', 404, '{}'::jsonb);
  END IF;

  SELECT
    r.id, r.name, r.slug, r.logo_url, r.welcome_message::jsonb, r.default_locale,
    r.currency, r.currency_decimals,
    b.id, b.name, b.timezone, b.is_accepting_orders,
    b.order_min_interval_seconds, b.waiter_call_cooldown_seconds,
    r.service_fee_enabled,
    CASE WHEN r.service_fee_enabled
         THEN COALESCE(b.service_fee_bps, r.service_fee_bps, 0) ELSE 0 END,
    t.id, t.name, t.number, t.qr_token,
    (r.is_active AND r.deleted_at IS NULL),
    (b.is_active AND b.deleted_at IS NULL),
    t.is_active
  INTO
    v.restaurant_id, v.restaurant_name, v.restaurant_slug, v.restaurant_logo_url,
    v.restaurant_welcome_message, v.restaurant_default_locale,
    v.currency, v.currency_decimals,
    v.branch_id, v.branch_name, v.branch_timezone, v.branch_is_accepting_orders,
    v.branch_order_interval_s, v.branch_call_cooldown_s,
    v.service_fee_enabled, v.service_fee_bps,
    v.table_id, v.table_name, v.table_number, v.qr_token,
    v_r_active, v_b_active, v_t_active
  FROM public.tables t
  JOIN public.branches    b ON b.restaurant_id = t.restaurant_id AND b.id = t.branch_id
  JOIN public.restaurants r ON r.id = b.restaurant_id
  WHERE t.id = v_table_id;

  IF NOT FOUND THEN
    PERFORM app_private.raise_app_error('QR001_INVALID_QR_TOKEN', 404, '{}'::jsonb);
  END IF;

  IF NOT v_r_active THEN
    PERFORM app_private.raise_app_error('QR004_RESTAURANT_INACTIVE', 423, '{}'::jsonb);
  END IF;
  IF NOT v_b_active THEN
    PERFORM app_private.raise_app_error('QR003_BRANCH_INACTIVE', 423, '{}'::jsonb);
  END IF;
  IF NOT v_t_active THEN
    PERFORM app_private.raise_app_error('QR002_TABLE_INACTIVE', 423, '{}'::jsonb);
  END IF;

  RETURN v;
END;
$fn$;

REVOKE ALL ON FUNCTION app_private.resolve_token(TEXT, BOOLEAN)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.resolve_token(TEXT, BOOLEAN) IS
  'Turns a bearer QR token into the tenant context the public API is allowed to act in (02 §1.5, §1.6, §1.13). Table identity is derived here and is never an RPC parameter, which is what makes "post someone else''s table_id" unrepresentable. Unknown / malformed / revoked tokens all raise QR001 so the three cases are indistinguishable to a scanner.';


-- =============================================================================
-- 4. §2.6 — the single renderer of a customer-facing order document
--
-- What it deliberately omits: orders.id, restaurant_id, branch_id, table_id,
-- customer_session_id, client_request_id, payload_fingerprint, changed_by and
-- every staff identity.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_private.order_payload(p_order_id UUID)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT jsonb_build_object(
    'order_number',           o.order_number,
    'public_code',            o.public_code,
    'tracking_path',          CASE WHEN t.qr_token IS NOT NULL
                                   THEN '/t/' || t.qr_token || '/order/' || o.public_code
                                   ELSE '/o/' || o.public_code END,
    'status',                 o.status,
    'order_type',             o.order_type,
    'channel',                o.channel,
    'currency',               o.currency,
    'currency_decimals',      o.currency_decimals,
    'subtotal',               o.subtotal,
    'discount_total',         o.discount_total,
    'service_fee',            o.service_fee,
    'service_fee_bps',        o.service_fee_bps,
    'total',                  o.total,
    'note',                   o.customer_note,
    'guest_count',            o.guest_count,
    'locale',                 o.locale,
    'estimated_prep_minutes', o.estimated_prep_minutes,
    'due_at',                 o.due_at,
    'placed_at',              o.placed_at,
    'confirmed_at',           o.confirmed_at,
    'preparing_at',           o.preparing_at,
    'ready_at',               o.ready_at,
    'delivered_at',           o.delivered_at,
    'completed_at',           o.completed_at,
    'cancelled_at',           o.cancelled_at,
    'cancellation_reason',    o.cancellation_reason,
    'created_at',             o.created_at,
    'table',                  jsonb_build_object('number', t.number, 'name', t.name),
    'lines', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object(
                 'id',            oi.id,
                 'name',          oi.name_snapshot::jsonb,
                 'description',   oi.description_snapshot::jsonb,
                 'image_url',     oi.image_url_snapshot,
                 'unit_price',    oi.price_snapshot,
                 'quantity',      oi.quantity,
                 'options_total', oi.options_total,
                 'line_total',    oi.total,
                 'note',          oi.note,
                 'spicy_level',   oi.spicy_level_snapshot,
                 'options', COALESCE((
                   SELECT jsonb_agg(
                            jsonb_build_object(
                              'name',        oio.name_snapshot::jsonb,
                              'price_delta', oio.price_delta_snapshot,
                              'quantity',    oio.quantity)
                            ORDER BY oio.sort_order, oio.id)
                   FROM public.order_item_options oio
                   WHERE oio.order_id      = oi.order_id
                     AND oio.order_item_id = oi.id), '[]'::jsonb))
               ORDER BY oi.sort_order, oi.created_at, oi.id)
      FROM public.order_items oi
      WHERE oi.restaurant_id = o.restaurant_id
        AND oi.order_id      = o.id), '[]'::jsonb),
    'history', COALESCE((
      SELECT jsonb_agg(
               jsonb_build_object('status', h.new_status, 'at', h.created_at)
               ORDER BY h.created_at, h.id)
      FROM public.order_status_history h
      WHERE h.restaurant_id = o.restaurant_id
        AND h.order_id      = o.id), '[]'::jsonb))
  FROM public.orders o
  LEFT JOIN public.tables t ON t.branch_id = o.branch_id AND t.id = o.table_id
  WHERE o.id = p_order_id;
$fn$;

REVOKE ALL ON FUNCTION app_private.order_payload(UUID) FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.order_payload(UUID) IS
  'The ONE place a customer-facing order document is built (02 §2.6). Granted to nobody: it is called only from other SECURITY DEFINER functions. A new column becomes public only by being added to this jsonb_build_object, which is the point of the RPC design (§2.2.6).';


-- =============================================================================
-- 5. §2.6 — public.public_resolve_table(text) -> jsonb
-- STABLE. Raises QR001 (404) · QR002/QR003/QR004 (423).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_resolve_table(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c app_private.table_context;
BEGIN
  c := app_private.resolve_token(p_token, false);

  RETURN jsonb_build_object(
    'token', p_token,
    'restaurant', jsonb_build_object(
        'name',              c.restaurant_name,
        'slug',              c.restaurant_slug,
        'logo_url',          c.restaurant_logo_url,
        'welcome_message',   c.restaurant_welcome_message,
        'default_locale',    c.restaurant_default_locale,
        'currency',          c.currency,
        'currency_decimals', c.currency_decimals),
    'branch', jsonb_build_object(
        'name',                c.branch_name,
        'timezone',            c.branch_timezone,
        'is_accepting_orders', c.branch_is_accepting_orders,
        'service_fee_enabled', c.service_fee_enabled,
        'service_fee_bps',     c.service_fee_bps),
    'table', jsonb_build_object(
        'number', c.table_number,
        'name',   c.table_name),
    'resolved_at', now());
END;
$fn$;

REVOKE ALL     ON FUNCTION public.public_resolve_table(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_resolve_table(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.public_resolve_table(TEXT) IS
  'Public entry point 1 of 5 (02 §2.6). Turns /t/<token> into the branding and pricing context of exactly one table. Carries no ids: the only identifier a customer ever holds is the token itself.';


-- =============================================================================
-- 6. §2.6 — public.public_get_menu(text) -> jsonb
-- STABLE. Raises QR001 (404) · QR002/QR003/QR004 (423).
--
-- The token's BRANCH only, in one round trip. Unavailable items are INCLUDED and
-- flagged (brief §5): the UI greys them out rather than discovering them by
-- absence. Promotions are display-only metadata (§1.3) - no discount field is
-- emitted and public_place_order never reads the table, so a forged promotion id
-- cannot move a price.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_get_menu(p_token TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c        app_private.table_context;
  v_local  TIME;
  v_cats   JSONB;
  v_promos JSONB;
BEGIN
  c := app_private.resolve_token(p_token, false);

  v_local := (now() AT TIME ZONE c.branch_timezone)::time;

  SELECT COALESCE(jsonb_agg(s.cat ORDER BY s.cat_sort, s.cat_id), '[]'::jsonb)
  INTO v_cats
  FROM (
    SELECT
      mc.sort_order AS cat_sort,
      mc.id         AS cat_id,
      jsonb_build_object(
        'id',          mc.id,
        'name',        mc.name::jsonb,
        'description', mc.description::jsonb,
        'image_url',   mc.image_url,
        'icon',        mc.icon,
        'sort_order',  mc.sort_order,
        'items', COALESCE((
          SELECT jsonb_agg(
                   jsonb_build_object(
                     'id',               mi.id,
                     'category_id',      mi.category_id,
                     'name',             mi.name::jsonb,
                     'description',      mi.description::jsonb,
                     'ingredients',      mi.ingredients::jsonb,
                     'price',            mi.price,
                     'compare_at_price', mi.compare_at_price,
                     'image_url',        mi.image_url,
                     'spicy_level',      mi.spicy_level,
                     'preparation_time', mi.preparation_time,
                     'calories',         mi.calories,
                     'dietary_tags',     to_jsonb(mi.dietary_tags),
                     -- The item-level clauses of the binding orderability rule
                     -- (01 §6.8), evaluated in the BRANCH's timezone.
                     'is_available',
                        (mi.is_available
                         OR (mi.unavailable_until IS NOT NULL AND now() >= mi.unavailable_until))
                        AND (mi.available_from IS NULL
                             OR (v_local >= mi.available_from AND v_local <= mi.available_until)),
                     'is_featured',      mi.is_featured,
                     'is_popular',       mi.is_popular,
                     'sort_order',       mi.sort_order,
                     'option_groups', COALESCE((
                       SELECT jsonb_agg(
                                jsonb_build_object(
                                  'group_key',      g.group_key,
                                  'group_label',    g.group_label::jsonb,
                                  'selection_type', g.selection_type,
                                  'min_select',     g.min_select,
                                  'max_select',     g.max_select,
                                  'is_required',    (g.min_select >= 1),
                                  'sort_order',     g.group_sort_order,
                                  'options',        g.options)
                                ORDER BY g.group_sort_order, g.group_key)
                       FROM (
                         SELECT
                           mio.group_key,
                           min(mio.group_sort_order)                                          AS group_sort_order,
                           (array_agg(mio.group_label    ORDER BY mio.sort_order, mio.id))[1] AS group_label,
                           (array_agg(mio.selection_type ORDER BY mio.sort_order, mio.id))[1] AS selection_type,
                           min(mio.group_min_select)                                          AS min_select,
                           min(mio.group_max_select)                                          AS max_select,
                           jsonb_agg(
                             jsonb_build_object(
                               'id',           mio.id,
                               'name',         mio.name::jsonb,
                               'price_delta',  mio.price_delta,
                               'max_quantity', mio.max_quantity,
                               'is_default',   mio.is_default,
                               'is_available', mio.is_available,
                               'sort_order',   mio.sort_order)
                             ORDER BY mio.sort_order, mio.id)                                 AS options
                         FROM public.menu_item_options mio
                         WHERE mio.restaurant_id = mi.restaurant_id
                           AND mio.menu_item_id  = mi.id
                           AND mio.deleted_at IS NULL
                         GROUP BY mio.group_key
                       ) g), '[]'::jsonb))
                   ORDER BY mi.sort_order, mi.id)
          FROM public.menu_items mi
          WHERE mi.restaurant_id = c.restaurant_id
            AND mi.category_id   = mc.id
            AND (mi.branch_id IS NULL OR mi.branch_id = c.branch_id)
            AND mi.deleted_at IS NULL), '[]'::jsonb)
      ) AS cat
    FROM public.menu_categories mc
    WHERE mc.restaurant_id = c.restaurant_id
      AND (mc.branch_id IS NULL OR mc.branch_id = c.branch_id)
      AND mc.is_active
      AND mc.deleted_at IS NULL
  ) s;

  SELECT COALESCE(jsonb_agg(
           jsonb_build_object(
             'id',          p.id,
             'title',       p.title::jsonb,
             'description', p.description::jsonb,
             'badge_label', p.badge_label::jsonb,
             'image_url',   p.image_url,
             'sort_order',  p.sort_order)
           ORDER BY p.sort_order, p.id), '[]'::jsonb)
  INTO v_promos
  FROM public.promotions p
  WHERE p.restaurant_id = c.restaurant_id
    AND (p.branch_id IS NULL OR p.branch_id = c.branch_id)
    AND p.is_active
    AND p.deleted_at IS NULL
    AND p.starts_at <= now()
    AND (p.ends_at IS NULL OR p.ends_at > now());

  RETURN jsonb_build_object(
    'token', p_token,
    'restaurant', jsonb_build_object(
        'name',              c.restaurant_name,
        'slug',              c.restaurant_slug,
        'logo_url',          c.restaurant_logo_url,
        'welcome_message',   c.restaurant_welcome_message,
        'default_locale',    c.restaurant_default_locale,
        'currency',          c.currency,
        'currency_decimals', c.currency_decimals),
    'branch', jsonb_build_object(
        'name',                c.branch_name,
        'timezone',            c.branch_timezone,
        'is_accepting_orders', c.branch_is_accepting_orders,
        'service_fee_enabled', c.service_fee_enabled,
        'service_fee_bps',     c.service_fee_bps),
    'table', jsonb_build_object(
        'number', c.table_number,
        'name',   c.table_name),
    'categories',   v_cats,
    'promotions',   v_promos,
    'generated_at', now());
END;
$fn$;

REVOKE ALL     ON FUNCTION public.public_get_menu(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_get_menu(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.public_get_menu(TEXT) IS
  'Public entry point 2 of 5 (02 §2.6). Returns the token''s branch menu plus the same context block. Option ids and menu_item_ids ARE emitted because the cart needs them and they are inert: public_place_order re-validates that each belongs to the token''s branch, so holding one grants nothing.';


-- =============================================================================
-- 7. §2.6 — public.public_place_order(text, jsonb, text, uuid) -> jsonb
-- VOLATILE. Raises QR001 (404) · QR002/QR003/QR004 (423) · QR023 (422)
--          · QR024 (422) · QR020 (409) · QR022 (409) · QR010 (429) · QR013 (409)
--
-- THE security boundary of the whole product. Input carries menu_item_id,
-- quantity, option_ids and note per line and NOTHING else - no price, no name,
-- no subtotal, no total, no promotion. Every amount below is read from
-- menu_items.price / menu_item_options.price_delta inside this transaction,
-- under FOR SHARE row locks so a concurrent "mark unavailable" cannot slip
-- between the check and the write.
--
-- Check order is normative (02 §5.2): resolve token -> idempotency -> payload
-- shape -> FOR UPDATE + cooldown -> hourly counters -> duplicate payload ->
-- write. Cheap rejections happen before any lock is taken; the lock is taken
-- before the counters so two submits from one table cannot both pass.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_place_order(
  p_token             TEXT,
  p_items             JSONB,
  p_note              TEXT,
  p_client_request_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c                app_private.table_context;
  v_now            TIMESTAMPTZ := now();
  v_local          TIME;
  v_existing_id    UUID;
  v_last_order     TIMESTAMPTZ;
  v_cooldown       INTERVAL;
  v_fingerprint    TEXT;
  v_note           TEXT;
  v_line           JSONB;
  v_item_id        UUID;
  v_qty            INTEGER;
  v_opt_ids        UUID[];
  v_opt_id         UUID;
  v_item           RECORD;
  v_opt            RECORD;
  v_opts_total     BIGINT;
  v_opt_sort       INTEGER;
  v_sort           INTEGER := 0;
  v_order_id       UUID;
  v_order_item_id  UUID;
  v_order_number   TEXT;
  v_public_code    TEXT;
  v_subtotal       BIGINT := 0;
  v_fee_bps        INTEGER := 0;
  v_fee            BIGINT := 0;
  v_total          BIGINT := 0;
  v_prep           SMALLINT;
BEGIN
  ---------------------------------------------------------------- 1. capability
  c := app_private.resolve_token(p_token, false);

  v_local := (v_now AT TIME ZONE c.branch_timezone)::time;

  ---------------------------------------------------------------- 2. idempotency
  -- Checked before every other refusal so that a retry of an order that was
  -- already accepted stays a 200, even if the branch has since paused ordering.
  IF p_client_request_id IS NOT NULL THEN
    SELECT o.id INTO v_existing_id
    FROM public.orders o
    WHERE o.client_request_id = p_client_request_id
      AND o.table_id          = c.table_id;

    IF FOUND THEN
      RETURN app_private.order_payload(v_existing_id);   -- a retry is free, not an error
    END IF;
  END IF;

  IF NOT c.branch_is_accepting_orders THEN
    -- The branch is reachable and browsable but has paused ordering
    -- (01 §6.2: is_accepting_orders is the hard switch, and it is a clause of
    -- the binding orderability rule of 01 §6.8).
    PERFORM app_private.raise_app_error('QR003_BRANCH_INACTIVE', 423,
      jsonb_build_object('reason', 'not_accepting_orders'));
  END IF;

  ---------------------------------------------------------------- 3. payload shape
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'items', 'reason', 'not_an_array'));
  END IF;
  IF jsonb_array_length(p_items) = 0 THEN
    PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'items', 'reason', 'empty'));
  END IF;
  IF jsonb_array_length(p_items) > 40 THEN
    PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'items', 'reason', 'too_many', 'max', 40));
  END IF;

  v_note := nullif(btrim(regexp_replace(COALESCE(p_note, ''), '[[:cntrl:]]', ' ', 'g')), '');
  IF char_length(COALESCE(v_note, '')) > 280 THEN
    PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'note', 'reason', 'too_long', 'max', 280));
  END IF;

  ---------------------------------------------------------------- 4. serialise per table
  -- The row lock is held to COMMIT, so two concurrent submits from the same
  -- table are strictly ordered and the cooldown below cannot be raced.
  SELECT t.last_order_at INTO v_last_order
  FROM public.tables t
  WHERE t.id = c.table_id
  FOR UPDATE;

  v_cooldown := make_interval(secs => GREATEST(COALESCE(c.branch_order_interval_s, 20), 0));

  IF v_cooldown > interval '0'
     AND v_last_order IS NOT NULL
     AND v_last_order > v_now - v_cooldown THEN
    PERFORM app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object(
        'scope', 'table_cooldown',
        'retry_after_seconds',
          ceil(extract(epoch FROM (v_last_order + v_cooldown - v_now)))::int));
  END IF;

  ---------------------------------------------------------------- 5. hourly ceilings
  IF NOT app_private.rate_limit_hit('order:table:' || c.table_id::text, 12, interval '1 hour') THEN
    PERFORM app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object('scope', 'table_hourly', 'retry_after_seconds', 600));
  END IF;

  IF NOT app_private.rate_limit_hit('order:branch:' || c.branch_id::text, 300, interval '1 hour') THEN
    PERFORM app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object('scope', 'branch_hourly', 'retry_after_seconds', 300));
  END IF;

  ---------------------------------------------------------------- 6. duplicate payload
  v_fingerprint := encode(
    extensions.digest(c.table_id::text || '|' || p_items::text, 'sha256'), 'hex');

  IF EXISTS (SELECT 1
             FROM public.orders o
             WHERE o.table_id            = c.table_id
               AND o.payload_fingerprint = v_fingerprint
               AND o.created_at          > v_now - interval '60 seconds'
               AND o.status <> 'cancelled') THEN
    PERFORM app_private.raise_app_error('QR013_DUPLICATE_ORDER', 409,
      jsonb_build_object('window_seconds', 60));
  END IF;

  ---------------------------------------------------------------- 7. order shell
  -- The customer, not a staff member, is the actor of the automatic
  -- order_status_history row written by trg_orders_log_status_change.
  PERFORM set_config('app.actor_kind',       'customer', true);
  PERFORM set_config('app.actor_profile_id', '',         true);
  PERFORM set_config('app.actor_role',       '',         true);

  -- order_number / order_seq / business_date come from trg_orders_assign_number;
  -- currency, currency_decimals and service_fee_bps from
  -- trg_orders_snapshot_pricing_context; public_code from its column DEFAULT.
  -- customer_session_id is required on the qr channel
  -- (ck_orders_qr_channel_has_session) and carries the per-cart uuid.
  INSERT INTO public.orders (
    restaurant_id, branch_id, table_id,
    order_type, channel, status,
    customer_session_id, customer_note,
    client_request_id, payload_fingerprint,
    subtotal, discount_total, service_fee, total,
    placed_at, created_at, updated_at)
  VALUES (
    c.restaurant_id, c.branch_id, c.table_id,
    'dine_in', 'qr', 'pending',
    COALESCE(p_client_request_id, gen_random_uuid()), v_note,
    p_client_request_id, v_fingerprint,
    0, 0, 0, 0,
    v_now, v_now, v_now)
  RETURNING id, order_number, public_code, service_fee_bps
  INTO v_order_id, v_order_number, v_public_code, v_fee_bps;

  ---------------------------------------------------------------- 8. price every line
  FOR v_line IN SELECT jsonb_array_elements(p_items) LOOP

    IF jsonb_typeof(v_line) <> 'object' THEN
      PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'items[]', 'reason', 'not_an_object'));
    END IF;

    -- Keys are extracted explicitly, never iterated: an unknown key in the JSON
    -- is ignored by construction and can carry nothing into the order (§1.3).
    BEGIN
      v_item_id := (v_line ->> 'menu_item_id')::uuid;
      v_qty     := (v_line ->> 'quantity')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'items[]', 'reason', 'bad_types'));
    END;

    IF v_item_id IS NULL THEN
      PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'menu_item_id', 'reason', 'missing'));
    END IF;

    IF v_qty IS NULL OR v_qty < 1 OR v_qty > 50 THEN
      PERFORM app_private.raise_app_error('QR024_QUANTITY_OUT_OF_RANGE', 422,
        jsonb_build_object('menu_item_id', v_item_id, 'min', 1, 'max', 50));
    END IF;

    IF v_line -> 'option_ids' IS NOT NULL
       AND jsonb_typeof(v_line -> 'option_ids') NOT IN ('array', 'null') THEN
      PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'option_ids', 'reason', 'not_an_array'));
    END IF;

    BEGIN
      SELECT COALESCE(array_agg(DISTINCT x::uuid), '{}'::uuid[])
      INTO v_opt_ids
      FROM jsonb_array_elements_text(
             CASE WHEN jsonb_typeof(COALESCE(v_line -> 'option_ids', '[]'::jsonb)) = 'array'
                  THEN v_line -> 'option_ids' ELSE '[]'::jsonb END) AS x;
    EXCEPTION WHEN invalid_text_representation THEN
      PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'option_ids', 'reason', 'bad_types'));
    END;

    IF COALESCE(array_length(v_opt_ids, 1), 0) > 20 THEN
      PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
        jsonb_build_object('field', 'option_ids', 'reason', 'too_many', 'max', 20));
    END IF;

    -- The binding orderability rule (01 §6.8) as ONE predicate: identity,
    -- tenant, branch scope, soft delete, 86-ing, daypart in branch-local time,
    -- and category state. FOR SHARE blocks a concurrent "mark unavailable" from
    -- committing under us, so there is no check-then-write window (§1.4).
    SELECT mi.id, mi.name, mi.description, mi.image_url, mi.price,
           mi.spicy_level, mi.preparation_time, mi.dietary_tags,
           mc.name AS category_name
    INTO v_item
    FROM public.menu_items mi
    JOIN public.menu_categories mc
      ON mc.restaurant_id = mi.restaurant_id AND mc.id = mi.category_id
    WHERE mi.id            = v_item_id
      AND mi.restaurant_id = c.restaurant_id
      AND (mi.branch_id IS NULL OR mi.branch_id = c.branch_id)
      AND mi.deleted_at IS NULL
      AND (mi.is_available
           OR (mi.unavailable_until IS NOT NULL AND v_now >= mi.unavailable_until))
      AND (mi.available_from IS NULL
           OR (v_local >= mi.available_from AND v_local <= mi.available_until))
      AND mc.is_active
      AND mc.deleted_at IS NULL
    FOR SHARE OF mi;

    IF NOT FOUND THEN
      PERFORM app_private.raise_app_error('QR020_ITEM_UNAVAILABLE', 409,
        jsonb_build_object('menu_item_id', v_item_id));
    END IF;

    v_sort := v_sort + 1;

    INSERT INTO public.order_items (
      restaurant_id, order_id, menu_item_id,
      name_snapshot, description_snapshot, category_name_snapshot, image_url_snapshot,
      price_snapshot, spicy_level_snapshot, preparation_time_snapshot, dietary_tags_snapshot,
      quantity, options_total, note, sort_order, created_at, updated_at)
    VALUES (
      c.restaurant_id, v_order_id, v_item.id,
      v_item.name, v_item.description, v_item.category_name, v_item.image_url,
      v_item.price, v_item.spicy_level, v_item.preparation_time, v_item.dietary_tags,
      v_qty, 0,
      nullif(btrim(left(regexp_replace(COALESCE(v_line ->> 'note', ''), '[[:cntrl:]]', ' ', 'g'), 140)), ''),
      v_sort, v_now, v_now)
    RETURNING id INTO v_order_item_id;

    v_opts_total := 0;
    v_opt_sort   := 0;

    FOREACH v_opt_id IN ARRAY v_opt_ids LOOP
      SELECT mio.id, mio.name, mio.group_key, mio.group_label, mio.price_delta
      INTO v_opt
      FROM public.menu_item_options mio
      WHERE mio.id            = v_opt_id
        AND mio.restaurant_id = c.restaurant_id
        AND mio.menu_item_id  = v_item.id      -- an option of a CHEAPER dish is not an option
        AND mio.deleted_at IS NULL
        AND mio.is_available
      FOR SHARE OF mio;

      IF NOT FOUND THEN
        PERFORM app_private.raise_app_error('QR022_INVALID_OPTION', 409,
          jsonb_build_object('menu_item_id', v_item_id, 'option_id', v_opt_id));
      END IF;

      v_opt_sort := v_opt_sort + 1;

      INSERT INTO public.order_item_options (
        restaurant_id, order_id, order_item_id, menu_item_option_id,
        group_key_snapshot, group_label_snapshot, name_snapshot, price_delta_snapshot,
        quantity, sort_order, created_at, updated_at)
      VALUES (
        c.restaurant_id, v_order_id, v_order_item_id, v_opt.id,
        v_opt.group_key, v_opt.group_label, v_opt.name, v_opt.price_delta,
        1, v_opt_sort, v_now, v_now);

      v_opts_total := v_opts_total + v_opt.price_delta;
    END LOOP;

    -- order_items.total is GENERATED as quantity * (price_snapshot + options_total),
    -- so this single UPDATE is the whole line arithmetic. money_minor forbids a
    -- negative amount, so no line can ever reduce the bill.
    UPDATE public.order_items
       SET options_total = v_opts_total
     WHERE id = v_order_item_id;
  END LOOP;

  ---------------------------------------------------------------- 9. totals, integers only
  -- Read the subtotal back from the generated column so it is exactly what the
  -- deferred assertion trg_orders_totals_consistent will recompute at COMMIT.
  SELECT COALESCE(sum(oi.total), 0)::bigint,
         COALESCE(max(oi.preparation_time_snapshot), 15)::smallint
  INTO v_subtotal, v_prep
  FROM public.order_items oi
  WHERE oi.order_id = v_order_id;

  -- discount_total is 0: promotions are display-only in the MVP (§1.3), so the
  -- fee is the snapshotted rate applied to the subtotal, half-up, in integers.
  v_fee   := round((v_subtotal::numeric * v_fee_bps) / 10000)::bigint;
  v_total := v_subtotal + v_fee;

  PERFORM set_config('app.guard_bypass', 'orders', true);
  UPDATE public.orders
     SET subtotal               = v_subtotal,
         service_fee            = v_fee,
         total                  = v_total,
         estimated_prep_minutes = GREATEST(LEAST(v_prep, 480), 1),
         updated_at             = v_now
   WHERE id = v_order_id;
  PERFORM set_config('app.guard_bypass', '', true);

  PERFORM set_config('app.guard_bypass', 'tables', true);
  UPDATE public.tables SET last_order_at = v_now WHERE id = c.table_id;
  PERFORM set_config('app.guard_bypass', '', true);

  ---------------------------------------------------------------- 10. fan-out
  -- order_status_history is written automatically by trg_orders_log_status_change
  -- (01 §7.7b) with changed_by_kind = 'customer'; writing it here too would
  -- duplicate the audit row.
  INSERT INTO public.notifications (
    restaurant_id, branch_id, target_role, type, payload, priority, order_id, created_at, updated_at)
  VALUES (
    c.restaurant_id, c.branch_id, 'KITCHEN', 'order_created',
    jsonb_build_object('order_number', v_order_number,
                       'table_number', c.table_number,
                       'total',        v_total),
    1, v_order_id, v_now, v_now);

  -- Broadcast-from-database (§7.2). Best effort: a Realtime outage must not cost
  -- the guest their order, and the KDS also receives the row via postgres_changes.
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('event', 'order.created', 'order_number', v_order_number,
                         'status', 'pending', 'table_number', c.table_number),
      'order.created', 'branch:' || c.branch_id::text, true);

    PERFORM realtime.send(
      jsonb_build_object('event', 'order.created', 'status', 'pending',
                         'order_number', v_order_number),
      'order.created', 'order:' || v_public_code, true);
  EXCEPTION WHEN undefined_function OR invalid_schema_name OR insufficient_privilege THEN
    NULL;
  END;

  RETURN app_private.order_payload(v_order_id);

EXCEPTION
  -- A concurrent retry with the same client_request_id won the race.
  WHEN unique_violation THEN
    IF p_client_request_id IS NOT NULL THEN
      SELECT o.id INTO v_existing_id
      FROM public.orders o
      WHERE o.client_request_id = p_client_request_id
        AND o.table_id          = c.table_id;
      IF FOUND THEN
        RETURN app_private.order_payload(v_existing_id);
      END IF;
    END IF;
    PERFORM app_private.raise_app_error('QR013_DUPLICATE_ORDER', 409,
      jsonb_build_object('window_seconds', 60, 'reason', 'client_request_id_conflict'));

  -- Backstops. assert_order_rate_limit (ORD05) and assert_order_item_orderable
  -- (MNU01) are the schema's own last lines; reaching them means the checks
  -- above were somehow outraced. Translate to the public error vocabulary
  -- rather than leaking a raw SQLSTATE.
  WHEN sqlstate 'ORD05' THEN
    PERFORM app_private.raise_app_error('QR010_ORDER_RATE_LIMITED', 429,
      jsonb_build_object('scope', 'table_cooldown', 'retry_after_seconds',
                         GREATEST(COALESCE(c.branch_order_interval_s, 20), 1)));
  WHEN sqlstate 'MNU01' THEN
    PERFORM app_private.raise_app_error('QR020_ITEM_UNAVAILABLE', 409,
      jsonb_build_object('menu_item_id', v_item_id));
END;
$fn$;

REVOKE ALL     ON FUNCTION public.public_place_order(TEXT, JSONB, TEXT, UUID) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_place_order(TEXT, JSONB, TEXT, UUID) TO anon, authenticated;

COMMENT ON FUNCTION public.public_place_order(TEXT, JSONB, TEXT, UUID) IS
  'Public entry point 3 of 5 and the price-integrity boundary of the product (02 §1.3, §2.6). There is no price field anywhere in its input; subtotal, service fee and total are authored here from menu_items.price, menu_item_options.price_delta and the snapshotted service_fee_bps, in BIGINT minor units. Availability, branch scope and category state are re-checked per line under FOR SHARE. Rate limits are DB-authoritative and keyed on table and branch, not IP, so spreading a flood across addresses buys nothing.';


-- =============================================================================
-- 8. §2.6 — public.public_get_order(text, text) -> jsonb
-- STABLE. Raises QR001 (404) · QR002/QR003/QR004 (423) · QR030 (404) · QR032 (410)
--
-- p_order_public_id IS orders.public_code (03 §1.1). BOTH capabilities must
-- match: an order code forwarded to a group chat is useless without the table's
-- QR token - the same trust boundary as physically sitting there (§2.4).
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_get_order(p_token TEXT, p_order_public_id TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c          app_private.table_context;
  v_order_id UUID;
  v_created  TIMESTAMPTZ;
BEGIN
  -- Read-only path: tolerates a token revoked within the last 12h so a rotation
  -- mid-meal does not strand a guest watching their order (§1.6).
  c := app_private.resolve_token(p_token, true);

  IF p_order_public_id IS NULL OR p_order_public_id !~ '^[A-Za-z0-9_-]{10,32}$' THEN
    PERFORM app_private.raise_app_error('QR030_ORDER_NOT_FOUND', 404, '{}'::jsonb);
  END IF;

  SELECT o.id, o.created_at INTO v_order_id, v_created
  FROM public.orders o
  WHERE o.public_code = p_order_public_id
    AND o.table_id    = c.table_id;          -- both capabilities, or nothing

  IF NOT FOUND THEN
    -- Wrong order code, or the right code at the wrong table: identical error.
    PERFORM app_private.raise_app_error('QR030_ORDER_NOT_FOUND', 404, '{}'::jsonb);
  END IF;

  IF v_created < now() - interval '24 hours' THEN
    PERFORM app_private.raise_app_error('QR032_ORDER_EXPIRED', 410, '{}'::jsonb);
  END IF;

  RETURN app_private.order_payload(v_order_id);
END;
$fn$;

REVOKE ALL     ON FUNCTION public.public_get_order(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_get_order(TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.public_get_order(TEXT, TEXT) IS
  'Public entry point 4 of 5 (02 §2.4, §2.6). Requires the table QR token AND the per-order public_code, and refuses orders older than 24 hours, which bounds the useful life of a leaked tracking link. Staff keep full history through the authenticated panels.';


-- =============================================================================
-- 9. §2.6 — public.public_call_waiter(text, text) -> jsonb
-- VOLATILE. Raises QR001 (404) · QR002/QR003/QR004 (423) · QR023 (422)
--          · QR011 (429) · QR012 (409)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_call_waiter(p_token TEXT, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c          app_private.table_context;
  v_now      TIMESTAMPTZ := now();
  v_last     TIMESTAMPTZ;
  v_cooldown INTERVAL;
  v_seconds  INTEGER;
  v_reason   public.waiter_call_reason;
  v_call_id  UUID;
BEGIN
  c := app_private.resolve_token(p_token, false);

  v_seconds  := GREATEST(COALESCE(c.branch_call_cooldown_s, 90), 0);
  v_cooldown := make_interval(secs => v_seconds);

  BEGIN
    v_reason := COALESCE(nullif(btrim(COALESCE(p_reason, '')), ''), 'call_waiter')
                ::public.waiter_call_reason;
  EXCEPTION WHEN invalid_text_representation THEN
    PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field', 'reason',
        'allowed', jsonb_build_array('call_waiter', 'request_bill', 'request_water',
                                     'request_cutlery', 'clean_table', 'complaint', 'other')));
  END;

  -- Serialise per table, exactly as the order path does.
  SELECT t.last_waiter_call_at INTO v_last
  FROM public.tables t
  WHERE t.id = c.table_id
  FOR UPDATE;

  IF v_cooldown > interval '0' AND v_last IS NOT NULL AND v_last > v_now - v_cooldown THEN
    PERFORM app_private.raise_app_error('QR011_WAITER_CALL_COOLDOWN', 429,
      jsonb_build_object('scope', 'table_cooldown',
        'retry_after_seconds', ceil(extract(epoch FROM (v_last + v_cooldown - v_now)))::int));
  END IF;

  IF NOT app_private.rate_limit_hit('call:table:' || c.table_id::text, 5, interval '1 hour') THEN
    PERFORM app_private.raise_app_error('QR011_WAITER_CALL_COOLDOWN', 429,
      jsonb_build_object('scope', 'table_hourly', 'retry_after_seconds', 900));
  END IF;

  BEGIN
    INSERT INTO public.waiter_calls (
      restaurant_id, branch_id, table_id, reason, status, created_at, updated_at)
    VALUES (
      c.restaurant_id, c.branch_id, c.table_id, v_reason, 'pending', v_now, v_now)
    RETURNING id INTO v_call_id;
  EXCEPTION
    -- uq_waiter_calls_open_per_table: a call is already live at this table.
    WHEN unique_violation THEN
      PERFORM app_private.raise_app_error('QR012_WAITER_CALL_ALREADY_OPEN', 409, '{}'::jsonb);
    -- assert_waiter_call_cooldown backstop.
    WHEN sqlstate 'WTC01' THEN
      PERFORM app_private.raise_app_error('QR011_WAITER_CALL_COOLDOWN', 429,
        jsonb_build_object('scope', 'table_cooldown',
                           'retry_after_seconds', GREATEST(v_seconds, 1)));
  END;

  PERFORM set_config('app.guard_bypass', 'tables', true);
  UPDATE public.tables SET last_waiter_call_at = v_now WHERE id = c.table_id;
  PERFORM set_config('app.guard_bypass', '', true);

  INSERT INTO public.notifications (
    restaurant_id, branch_id, target_role, type, payload, priority,
    waiter_call_id, created_at, updated_at)
  VALUES (
    c.restaurant_id, c.branch_id, 'WAITER', 'waiter_call_created',
    jsonb_build_object('table_number', c.table_number,
                       'table_name',   c.table_name,
                       'reason',       v_reason),
    2, v_call_id, v_now, v_now);

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('event', 'waiter_call.created',
                         'table_number', c.table_number, 'reason', v_reason),
      'waiter_call.created', 'branch:' || c.branch_id::text, true);
  EXCEPTION WHEN undefined_function OR invalid_schema_name OR insufficient_privilege THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'status',           'pending',
    'reason',           v_reason,
    'cooldown_seconds', v_seconds,
    'created_at',       v_now,
    'table',            jsonb_build_object('number', c.table_number, 'name', c.table_name));
END;
$fn$;

REVOKE ALL     ON FUNCTION public.public_call_waiter(TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_call_waiter(TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.public_call_waiter(TEXT, TEXT) IS
  'Public entry point 5 of 5 (02 §2.6, §5.3). The refusal of a spammed call is a database fact, not a disabled button: the per-table cooldown runs under SELECT ... FOR UPDATE and uq_waiter_calls_open_per_table makes a second live call a constraint violation.';


-- =============================================================================
-- 10. §2.3 — the privilege statement, restated where the functions are defined.
--
-- These five EXECUTE grants are the ENTIRE public API surface. anon holds no
-- privilege on any table, sequence or other routine in `public` or
-- `app_private`; migration 99 re-asserts that and fails the migration if a
-- sixth door has appeared.
-- =============================================================================

REVOKE ALL ON ALL TABLES   IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.public_resolve_table(TEXT)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_menu(TEXT)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_place_order(TEXT, JSONB, TEXT, UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_order(TEXT, TEXT)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_call_waiter(TEXT, TEXT)              TO anon, authenticated;

-- =============================================================================
-- End of migration 13.
-- =============================================================================
