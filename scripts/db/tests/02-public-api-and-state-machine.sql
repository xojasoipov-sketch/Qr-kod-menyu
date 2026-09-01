-- =============================================================================
-- RESTAURANT QR OS — executable security test 02
-- File: scripts/db/tests/02-public-api-and-state-machine.sql
--
-- WHAT THIS FILE IS
--   An adversarial, self-contained regression suite for the ANONYMOUS capability
--   API (docs/architecture/02-security-and-rls.md §2) and for the ORDER STATE
--   MACHINE (§3.17 / §3.18). It is deliberately written against the SPECS, not
--   against the migrations: nothing here reads a migration to decide what the
--   right answer is. Every expectation below is a quotation of doc 01 / doc 02 /
--   docs/audit/01-database-findings.md.
--
--   It closes the loop on these audit findings by attacking them from outside:
--     F03  anon must be able to reach realtime.messages via order_topic_is_valid
--     F07  a client must not be able to rewrite an order's money or identity
--     F08  the state machine must be ROLE-aware, not just graph-aware
--     F12  the sanctioned RPC set is the whole anon surface, and no more
--     F13  QR tokens and the per-table cooldown clocks are server-owned
--     F14  no routine in public/app_private is world-executable
--
-- HOW IT RUNS
--   scripts/db/verify.sh applies the whole migration chain to a throwaway
--   database, then runs every file in this directory with `psql -v
--   ON_ERROR_STOP=1`. This file therefore:
--     * opens ONE transaction, builds its own fixture, and ROLLBACKs at the end,
--       so it leaves the database exactly as it found it;
--     * wraps every hostile statement in a plpgsql BEGIN/EXCEPTION block, which
--       is an implicit SAVEPOINT — a refusal never poisons the run;
--     * prints one `PASS <name>` / `FAIL <name>` / `GAP  <name>` line per
--       assertion as it happens (RAISE NOTICE), plus a summary table;
--     * RAISEs at the very end when anything FAILed, so psql exits non-zero and
--       verify.sh reports FAIL.
--
--   The suite runs as a superuser (that is how verify.sh connects), so every
--   hostile statement is executed through qros_t02.run_as(), which sets
--   `request.jwt.claims` and `SET LOCAL ROLE` exactly the way PostgREST does.
--   A statement that is not wrapped in run_as() is fixture setup, not a test.
--
-- PASS / FAIL / GAP
--   FAIL  the database is more PERMISSIVE than the spec, or a documented
--         guarantee does not hold. Fails the build.
--   GAP   a spec deviation that grants nobody anything through the product's
--         real request shape: either the database REFUSING something §3.17
--         permits, or a latent defect that PostgREST's one-transaction-per-
--         request model currently makes unreachable. Every gap is declared and
--         justified in writing at the point it is checked; an UNDECLARED
--         deviation is a FAIL, and a declared gap that has since been closed is
--         reported too, so the list cannot rot into a licence to fail.
--         Gaps do not fail the build; they are printed in their own table and
--         counted in the summary line.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off
-- Assertion helpers are void functions called with SELECT; the PASS/FAIL stream
-- is the NOTICE output, so silence psql's own per-call result rows.
\pset tuples_only on
\pset footer off

\echo ''
\echo '== 02-public-api-and-state-machine.sql =============================='

BEGIN;

-- Keep NOTICE output (the PASS/FAIL stream) visible under verify.sh.
SET LOCAL client_min_messages = notice;

CREATE SCHEMA qros_t02;

CREATE TABLE qros_t02.results (
  seq    serial PRIMARY KEY,
  part   text   NOT NULL,
  name   text   NOT NULL,
  status text   NOT NULL CHECK (status IN ('PASS', 'FAIL', 'GAP')),
  detail text
);

CREATE TABLE qros_t02.part (cur text);
INSERT INTO qros_t02.part VALUES ('0. setup');

CREATE FUNCTION qros_t02.record(p_name text, p_status text, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_part text;
BEGIN
  SELECT cur INTO v_part FROM qros_t02.part;
  INSERT INTO qros_t02.results (part, name, status, detail)
  VALUES (v_part, p_name, p_status, p_detail);
  RAISE NOTICE '%  %  %', rpad(p_status, 4), rpad(p_name, 62), COALESCE(p_detail, '');
END $fn$;

CREATE FUNCTION qros_t02.assert(p_name text, p_cond boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM qros_t02.record(p_name,
    CASE WHEN COALESCE(p_cond, false) THEN 'PASS' ELSE 'FAIL' END,
    p_detail);
END $fn$;

-- PostgREST runs every request in its OWN transaction, so the request-scoped
-- GUCs a SECURITY DEFINER function sets with set_config(..., is_local => true)
-- die with that request. This suite runs the whole run in ONE transaction, so it
-- has to clear them by hand between simulated requests — otherwise, for example,
-- the app.actor_kind = 'customer' that public_place_order installs would still be
-- in force when a waiter later touches the same order, and every assertion after
-- the first guest order would be measuring the harness rather than the database.
-- Part 10 asserts that leak explicitly rather than only papering over it.
CREATE FUNCTION qros_t02.reset_request()
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  PERFORM set_config('request.jwt.claims',  '', true);
  PERFORM set_config('app.actor_kind',      '', true);
  PERFORM set_config('app.actor_profile_id','', true);
  PERFORM set_config('app.actor_role',      '', true);
  PERFORM set_config('app.actor_note',      '', true);
  PERFORM set_config('app.guard_bypass',    '', true);
END $fn$;

-- Impersonate a PostgREST request. p_dbrole NULL leaves the superuser session
-- alone (fixture work); 'anon' / 'authenticated' switch role AND install the
-- JWT claims that auth.uid() reads.
CREATE FUNCTION qros_t02.run_as(p_uid uuid, p_dbrole text, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_rows integer;
BEGIN
  PERFORM qros_t02.reset_request();
  IF p_dbrole IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_uid IS NULL THEN ''
           ELSE json_build_object('sub', p_uid::text, 'role', p_dbrole)::text END,
      true);
    EXECUTE format('SET LOCAL ROLE %I', p_dbrole);
  END IF;
  EXECUTE p_sql;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RESET ROLE;
  PERFORM qros_t02.reset_request();
  RETURN v_rows;
END $fn$;

-- Expect p_sql to be REFUSED with a specific MESSAGE (the QRxxx machine code)
-- and, when given, a specific SQLSTATE (PostgREST maps 'PTnnn' to HTTP nnn).
CREATE FUNCTION qros_t02.expect_error(
  p_name     text,
  p_sql      text,
  p_message  text,
  p_sqlstate text DEFAULT NULL,
  p_uid      uuid DEFAULT NULL,
  p_dbrole   text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM qros_t02.run_as(p_uid, p_dbrole, p_sql);
    PERFORM qros_t02.record(p_name, 'FAIL',
      format('statement SUCCEEDED; expected %s / %s',
             COALESCE(p_sqlstate, '*'), COALESCE(p_message, '*')));
    RETURN;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;

  IF (p_message IS NULL OR v_msg = p_message)
     AND (p_sqlstate IS NULL OR v_state = p_sqlstate) THEN
    PERFORM qros_t02.record(p_name, 'PASS', format('%s %s', v_state, v_msg));
  ELSE
    PERFORM qros_t02.record(p_name, 'FAIL',
      format('got %s / %s ; expected %s / %s',
             v_state, v_msg, COALESCE(p_sqlstate, '*'), COALESCE(p_message, '*')));
  END IF;
END $fn$;

-- Expect p_sql to be ACCEPTED (a positive control — a test suite that only ever
-- asserts refusals passes trivially on a database where nothing works).
CREATE FUNCTION qros_t02.expect_ok(
  p_name   text,
  p_sql    text,
  p_uid    uuid DEFAULT NULL,
  p_dbrole text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql AS $fn$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    PERFORM qros_t02.run_as(p_uid, p_dbrole, p_sql);
    PERFORM qros_t02.record(p_name, 'PASS', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM qros_t02.record(p_name, 'FAIL', format('unexpected %s %s', v_state, v_msg));
  END;
END $fn$;

-- Capture a jsonb result of an RPC call made under an impersonated role.
CREATE FUNCTION qros_t02.call_json(p_uid uuid, p_dbrole text, p_sql text)
RETURNS jsonb LANGUAGE plpgsql AS $fn$
DECLARE v jsonb;
BEGIN
  PERFORM qros_t02.reset_request();
  IF p_dbrole IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_uid IS NULL THEN ''
           ELSE json_build_object('sub', p_uid::text, 'role', p_dbrole)::text END,
      true);
    EXECUTE format('SET LOCAL ROLE %I', p_dbrole);
  END IF;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM qros_t02.reset_request();
  RETURN v;
END $fn$;


-- =============================================================================
-- FIXTURE
--
-- Two tenants plus a deactivated one. Everything is created by the superuser
-- session (that is setup, not a test); every ASSERTION below goes through
-- run_as()/call_json() as anon or authenticated.
--
-- B_MAIN sets order_min_interval_seconds = 0 so the per-table order cooldown
-- (a separate control, exercised by test file 01's scope) does not mask the
-- pricing and payload assertions here. The waiter-call cooldown is left at its
-- default 90s because part 9 tests it directly.
-- =============================================================================

INSERT INTO public.restaurants
  (id, name, slug, default_locale, currency, currency_decimals,
   service_fee_bps, service_fee_enabled, is_active)
VALUES
  ('02000000-0000-4000-8000-000000000001', 'T02 Main',  't02-main',  'uz', 'UZS', 0, 1000, true,  true),
  ('02000000-0000-4000-8000-000000000002', 'T02 Rival', 't02-rival', 'uz', 'UZS', 0,    0, false, true),
  ('02000000-0000-4000-8000-000000000003', 'T02 Dead',  't02-dead',  'uz', 'UZS', 0,    0, false, false);

INSERT INTO public.branches
  (id, restaurant_id, name, code, timezone,
   waiter_call_cooldown_seconds, waiter_call_expiry_minutes,
   order_min_interval_seconds, is_active, is_accepting_orders)
VALUES
  ('02000000-0000-4000-8100-000000000001', '02000000-0000-4000-8000-000000000001',
   'Main',    'A', 'UTC', 90, 30, 0, true,  true),
  ('02000000-0000-4000-8100-000000000002', '02000000-0000-4000-8000-000000000001',
   'Paused',  'B', 'UTC', 90, 30, 0, true,  false),   -- reachable, ordering paused
  ('02000000-0000-4000-8100-000000000003', '02000000-0000-4000-8000-000000000001',
   'Closed',  'C', 'UTC', 90, 30, 0, false, true),    -- branch deactivated
  ('02000000-0000-4000-8100-000000000004', '02000000-0000-4000-8000-000000000002',
   'Rival',   'A', 'UTC', 90, 30, 0, true,  true),
  ('02000000-0000-4000-8100-000000000005', '02000000-0000-4000-8000-000000000003',
   'Dead',    'A', 'UTC', 90, 30, 0, true,  true);

INSERT INTO public.menu_categories (id, restaurant_id, branch_id, name)
VALUES
  ('02000000-0000-4000-8200-000000000001', '02000000-0000-4000-8000-000000000001', NULL,
   '{"uz":"Asosiy","en":"Mains"}'::jsonb),
  ('02000000-0000-4000-8200-000000000002', '02000000-0000-4000-8000-000000000002', NULL,
   '{"uz":"Raqib","en":"Rival"}'::jsonb);

INSERT INTO public.menu_items
  (id, restaurant_id, branch_id, category_id, name, price, is_available, preparation_time)
VALUES
  ('02000000-0000-4000-8300-000000000001', '02000000-0000-4000-8000-000000000001', NULL,
   '02000000-0000-4000-8200-000000000001', '{"uz":"Osh","en":"Plov"}'::jsonb,  50000, true,  20),
  ('02000000-0000-4000-8300-000000000002', '02000000-0000-4000-8000-000000000001', NULL,
   '02000000-0000-4000-8200-000000000001', '{"uz":"Non","en":"Bread"}'::jsonb,  5000, true,  5),
  ('02000000-0000-4000-8300-000000000003', '02000000-0000-4000-8000-000000000001', NULL,
   '02000000-0000-4000-8200-000000000001', '{"uz":"Tugadi","en":"Sold out"}'::jsonb, 7000, false, 10),
  ('02000000-0000-4000-8300-000000000004', '02000000-0000-4000-8000-000000000002', NULL,
   '02000000-0000-4000-8200-000000000002', '{"uz":"Raqib taomi","en":"Rival dish"}'::jsonb, 1, true, 10),
  ('02000000-0000-4000-8300-000000000005', '02000000-0000-4000-8000-000000000001', NULL,
   '02000000-0000-4000-8200-000000000001', '{"uz":"Original nomi","en":"Original name"}'::jsonb, 30000, true, 12);

-- Tables. Tokens are fixed and legal (^[A-Za-z0-9_-]{22,64}$) so the assertions
-- can quote them verbatim.
INSERT INTO public.tables (id, restaurant_id, branch_id, number, qr_token, is_active)
VALUES
  ('02000000-0000-4000-8400-000000000001','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','1',  'T02TOK0000000000000001', true),
  ('02000000-0000-4000-8400-000000000002','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','2',  'T02TOK0000000000000002', true),
  ('02000000-0000-4000-8400-000000000003','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','3',  'T02TOK0000000000000003', true),
  ('02000000-0000-4000-8400-000000000004','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','4',  'T02TOK0000000000000004', true),
  ('02000000-0000-4000-8400-000000000005','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','5',  'T02TOK0000000000000005', true),
  ('02000000-0000-4000-8400-000000000006','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','6',  'T02TOK0000000000000006', false),
  ('02000000-0000-4000-8400-000000000007','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','7',  'T02TOK0000000000000007', true),
  ('02000000-0000-4000-8400-000000000008','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000002','8',  'T02TOK0000000000000008', true),
  ('02000000-0000-4000-8400-000000000009','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000003','9',  'T02TOK0000000000000009', true),
  ('02000000-0000-4000-8400-000000000010','02000000-0000-4000-8000-000000000003','02000000-0000-4000-8100-000000000005','10', 'T02TOK0000000000000010', true),
  ('02000000-0000-4000-8400-000000000011','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','11', 'T02TOK0000000000000011', true),
  ('02000000-0000-4000-8400-000000000012','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','12', 'T02TOK0000000000000012', true),
  ('02000000-0000-4000-8400-000000000013','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','13', 'T02TOK0000000000000013', true),
  ('02000000-0000-4000-8400-000000000014','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','14', 'T02TOK0000000000000014', true),
  ('02000000-0000-4000-8400-000000000015','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','15', 'T02TOK0000000000000015', true),
  ('02000000-0000-4000-8400-000000000016','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','16', 'T02TOK0000000000000016', true),
  ('02000000-0000-4000-8400-000000000017','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001','17', 'T02TOK0000000000000017', true),
  ('02000000-0000-4000-8400-000000000018','02000000-0000-4000-8000-000000000002','02000000-0000-4000-8100-000000000004','1',  'T02TOK0000000000000018', true);

-- Staff. auth.users rows create the profiles through trg_auth_user_created.
INSERT INTO auth.users (id, email) VALUES
  ('02000000-0000-4000-8500-000000000001', 't02-owner@example.com'),
  ('02000000-0000-4000-8500-000000000002', 't02-manager@example.com'),
  ('02000000-0000-4000-8500-000000000003', 't02-waiter@example.com'),
  ('02000000-0000-4000-8500-000000000004', 't02-kitchen@example.com'),
  ('02000000-0000-4000-8500-000000000005', 't02-stranger@example.com');

INSERT INTO public.staff (id, restaurant_id, branch_id, profile_id, role, is_active)
VALUES
  ('02000000-0000-4000-8600-000000000001','02000000-0000-4000-8000-000000000001', NULL,
   '02000000-0000-4000-8500-000000000001','RESTAURANT_OWNER', true),
  ('02000000-0000-4000-8600-000000000002','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001',
   '02000000-0000-4000-8500-000000000002','MANAGER', true),
  ('02000000-0000-4000-8600-000000000003','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001',
   '02000000-0000-4000-8500-000000000003','WAITER', true),
  ('02000000-0000-4000-8600-000000000004','02000000-0000-4000-8000-000000000001','02000000-0000-4000-8100-000000000001',
   '02000000-0000-4000-8500-000000000004','KITCHEN', true);

-- A zero-money order in an arbitrary state, with the one order_item that
-- assert_order_totals_consistent (ORD03) demands. Money is all zero so the
-- deferred totals assertion holds for any snapshotted service_fee_bps; these
-- rows exist to be TRANSITIONED, not to be priced.
CREATE FUNCTION qros_t02.mk_order(p_id uuid, p_status public.order_status)
RETURNS uuid LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO public.orders (
    id, restaurant_id, branch_id, table_id, order_type, channel, status,
    subtotal, discount_total, service_fee, total,
    confirmed_at, preparing_at, ready_at, delivered_at, completed_at,
    cancelled_at, cancellation_reason, placed_at)
  VALUES (
    p_id,
    '02000000-0000-4000-8000-000000000001',
    '02000000-0000-4000-8100-000000000001',
    '02000000-0000-4000-8400-000000000015',
    'dine_in', 'waiter', p_status,
    0, 0, 0, 0,
    CASE WHEN p_status IN ('confirmed','preparing','ready','delivered','completed') THEN now() END,
    CASE WHEN p_status IN ('preparing','ready','delivered','completed')             THEN now() END,
    CASE WHEN p_status IN ('ready','delivered','completed')                         THEN now() END,
    CASE WHEN p_status IN ('delivered','completed')                                 THEN now() END,
    CASE WHEN p_status  = 'completed'                                               THEN now() END,
    CASE WHEN p_status  = 'cancelled'                                               THEN now() END,
    CASE WHEN p_status  = 'cancelled' THEN 'fixture' END,
    now());

  INSERT INTO public.order_items (
    restaurant_id, order_id, menu_item_id, name_snapshot,
    price_snapshot, quantity, options_total)
  VALUES (
    '02000000-0000-4000-8000-000000000001', p_id,
    '02000000-0000-4000-8300-000000000001', '{"uz":"Osh"}'::jsonb, 0, 1, 0);

  RETURN p_id;
END $fn$;

DO $fixture$
BEGIN
  PERFORM qros_t02.record('fixture built', 'PASS',
    format('%s restaurants / %s tables / %s staff',
      (SELECT count(*) FROM public.restaurants WHERE slug LIKE 't02-%'),
      (SELECT count(*) FROM public.tables WHERE qr_token LIKE 'T02TOK%'),
      (SELECT count(*) FROM public.staff  WHERE restaurant_id = '02000000-0000-4000-8000-000000000001')));
END $fixture$;


-- =============================================================================
-- PART 1 — THE ANONYMOUS SURFACE (doc 02 §2.3, §2.6; findings F03, F12, F14)
--
-- "anon holds no privilege on any table, sequence or other routine in `public`
--  or `app_private`" — 20260901001300_public_api.sql §10, restating doc 02 §2.3.
--
-- This is asserted from the CATALOG (so a grant that no test happens to exercise
-- is still caught) AND behaviourally (so a catalog reading that is subtly wrong
-- is caught too).
-- =============================================================================
UPDATE qros_t02.part SET cur = '1. anon surface';

-- 1.1 — table privileges, every verb, every relation kind.
DO $t$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s:%s', n.nspname, c.relname, p.priv), ', ' ORDER BY 1)
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE',
                                  'TRUNCATE','REFERENCES','TRIGGER']) p(priv)
  WHERE n.nspname IN ('public','app_private')
    AND c.relkind IN ('r','p','v','m','f')
    AND has_table_privilege('anon', c.oid, p.priv);

  PERFORM qros_t02.assert('anon holds zero TABLE privileges in public/app_private',
    v_bad IS NULL, COALESCE('found: ' || v_bad, 'none'));
END $t$;

-- 1.2 — column privileges. A column-level GRANT is invisible in pg_class.relacl,
--       so it has to be swept separately or it hides in plain sight.
DO $t$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s.%s:%s', n.nspname, c.relname, a.attname, p.priv), ', ' ORDER BY 1)
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  CROSS JOIN LATERAL unnest(ARRAY['SELECT','INSERT','UPDATE','REFERENCES']) p(priv)
  WHERE n.nspname IN ('public','app_private')
    AND c.relkind IN ('r','p','v','m','f')
    AND has_column_privilege('anon', c.oid, a.attname, p.priv);

  PERFORM qros_t02.assert('anon holds zero COLUMN privileges in public/app_private',
    v_bad IS NULL, COALESCE('found: ' || v_bad, 'none'));
END $t$;

-- 1.3 — sequences (a USAGE grant here would let anon burn order numbers).
DO $t$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s:%s', n.nspname, c.relname, p.priv), ', ' ORDER BY 1)
  INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL unnest(ARRAY['USAGE','SELECT','UPDATE']) p(priv)
  WHERE n.nspname IN ('public','app_private')
    AND c.relkind = 'S'
    AND has_sequence_privilege('anon', c.oid, p.priv);

  PERFORM qros_t02.assert('anon holds zero SEQUENCE privileges in public/app_private',
    v_bad IS NULL, COALESCE('found: ' || v_bad, 'none'));
END $t$;

-- 1.4 — app_private is not even reachable by name.
DO $t$
BEGIN
  PERFORM qros_t02.assert('anon has no USAGE on schema app_private',
    NOT has_schema_privilege('anon', 'app_private', 'USAGE'));
END $t$;

-- 1.5 — the executable set is EXACTLY the sanctioned entry points.
--       doc 02 §2.3 names five; doc 03 §1.4 / finding F12 add public_cancel_order;
--       finding F03 adds order_topic_is_valid, which the realtime.messages policy
--       evaluates as the calling role. Anything else is a door nobody declared.
DO $t$
DECLARE
  v_expected text[] := ARRAY[
    'public_resolve_table', 'public_get_menu', 'public_place_order',
    'public_get_order', 'public_call_waiter',      -- doc 02 §2.3, the five
    'public_cancel_order',                          -- doc 03 §1.4 / F12
    'order_topic_is_valid'];                        -- realtime policy / F03
  v_actual   text[];
  v_extra    text[];
  v_missing  text[];
BEGIN
  SELECT COALESCE(array_agg(DISTINCT p.proname ORDER BY p.proname), '{}')
  INTO v_actual
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public','app_private')
    AND has_function_privilege('anon', p.oid, 'EXECUTE');

  SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_extra
  FROM unnest(v_actual) x WHERE x <> ALL (v_expected);

  SELECT COALESCE(array_agg(x ORDER BY x), '{}') INTO v_missing
  FROM unnest(v_expected) x WHERE x <> ALL (v_actual);

  PERFORM qros_t02.assert('anon may execute NOTHING beyond the sanctioned entry points',
    cardinality(v_extra) = 0, 'extra: ' || v_extra::text);
  PERFORM qros_t02.assert('every sanctioned entry point IS executable by anon',
    cardinality(v_missing) = 0, 'missing: ' || v_missing::text);
END $t$;

-- 1.6 — F14's end state: nothing in these schemas is world-executable.
DO $t$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s.%s', n.nspname, p.proname), ', ' ORDER BY 1)
  INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a
  WHERE n.nspname IN ('public','app_private')
    AND a.grantee = 0                       -- 0 == PUBLIC
    AND a.privilege_type = 'EXECUTE';

  PERFORM qros_t02.assert('no routine in public/app_private is executable by PUBLIC',
    v_bad IS NULL, COALESCE('found: ' || v_bad, 'none'));
END $t$;

-- 1.7 — behavioural: the catalog says no, and so does the server.
SELECT qros_t02.expect_error(
  'anon cannot SELECT public.orders',
  'SELECT count(*) FROM public.orders', NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot SELECT public.menu_items',
  'SELECT count(*) FROM public.menu_items', NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot SELECT public.tables (QR tokens)',
  'SELECT count(*) FROM public.tables', NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot INSERT public.orders directly',
  $q$INSERT INTO public.orders (restaurant_id, branch_id, table_id)
     VALUES ('02000000-0000-4000-8000-000000000001',
             '02000000-0000-4000-8100-000000000001',
             '02000000-0000-4000-8400-000000000001')$q$,
  NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot reach app_private.resolve_token',
  $q$SELECT app_private.resolve_token('T02TOK0000000000000001', false)$q$,
  NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot execute public.order_transition_allowed (doc 02 §3.17 grant)',
  $q$SELECT public.order_transition_allowed('pending','confirmed','WAITER')$q$,
  NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot execute public.admin_rotate_table_token',
  $q$SELECT public.admin_rotate_table_token('02000000-0000-4000-8400-000000000001')$q$,
  NULL, '42501', NULL, 'anon');
SELECT qros_t02.expect_error(
  'anon cannot execute public.staff_place_order',
  $q$SELECT public.staff_place_order('02000000-0000-4000-8400-000000000001','[]'::jsonb,NULL)$q$,
  NULL, '42501', NULL, 'anon');

-- 1.8 — F03: the realtime policy's predicate must be callable BY anon, or every
--       guest order-tracking subscription 42501s.
SELECT qros_t02.expect_ok(
  'anon CAN execute public.order_topic_is_valid (F03)',
  $q$SELECT public.order_topic_is_valid('order:ABCDEFGHIJ')$q$, NULL, 'anon');

-- 1.9 — authenticated must hold the §3.17 predicate, or the guard cannot run for
--       a signed-in caller.
DO $t$
BEGIN
  PERFORM qros_t02.assert(
    'authenticated CAN execute public.order_transition_allowed (doc 02 §3.17)',
    has_function_privilege('authenticated',
      'public.order_transition_allowed(public.order_status, public.order_status, public.app_role)',
      'EXECUTE'));
END $t$;


-- =============================================================================
-- PART 2 — public_resolve_table REFUSES A TOKEN IT SHOULD NOT HONOUR
--
-- doc 02 §1.6 / §1.13 and 20260901001300 §3:
--   "Malformed, unknown, revoked-too-long-ago and soft-deleted all raise the
--    SAME QR001, so an enumerator cannot tell them apart."
--   QR002/QR003/QR004 (423) distinguish a table/branch/restaurant that is
--   switched off — those are states the guest is allowed to be told about.
--
-- PostgREST maps SQLSTATE 'PTnnn' to HTTP nnn, so the SQLSTATE is part of the
-- contract, not an implementation detail.
-- =============================================================================
UPDATE qros_t02.part SET cur = '2. resolve_table';

-- Positive control first: the suite must be able to tell a working token from a
-- broken one.
SELECT qros_t02.expect_ok(
  'resolve_table accepts a live token',
  $q$SELECT public.public_resolve_table('T02TOK0000000000000001')$q$, NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses an UNKNOWN but well-formed token',
  $q$SELECT public.public_resolve_table('T02NOSUCHTOKEN000000ZZ')$q$,
  'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses a MALFORMED token (too short)',
  $q$SELECT public.public_resolve_table('short')$q$,
  'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses a MALFORMED token (illegal characters)',
  $q$SELECT public.public_resolve_table('T02TOK'''' or 1=1 --00000')$q$,
  'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses a NULL token',
  $q$SELECT public.public_resolve_table(NULL)$q$,
  'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses an INACTIVE table',
  $q$SELECT public.public_resolve_table('T02TOK0000000000000006')$q$,
  'QR002_TABLE_INACTIVE', 'PT423', NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses a table in a DEACTIVATED branch',
  $q$SELECT public.public_resolve_table('T02TOK0000000000000009')$q$,
  'QR003_BRANCH_INACTIVE', 'PT423', NULL, 'anon');

SELECT qros_t02.expect_error(
  'resolve_table refuses a table in a DEACTIVATED restaurant',
  $q$SELECT public.public_resolve_table('T02TOK0000000000000010')$q$,
  'QR004_RESTAURANT_INACTIVE', 'PT423', NULL, 'anon');

-- REVOKED token. Table 7 gets an order first, then its token is rotated (the
-- rotation trigger archives the old value into qr_token_history). doc 02 §1.6:
-- a retired token is dead on every write path, but the READ-ONLY order path
-- honours it for 12 hours so a rotation mid-meal does not strand a guest.
DO $t$
DECLARE v_code text;
BEGIN
  v_code := (qros_t02.call_json(NULL, 'anon', $q$
      SELECT public.public_place_order(
        'T02TOK0000000000000007',
        '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}]'::jsonb,
        NULL, NULL)$q$) ->> 'public_code');
  PERFORM set_config('qros_t02.revoked_order_code', v_code, true);

  UPDATE public.tables
     SET qr_token = 'T02TOKROTATED00000000A'
   WHERE id = '02000000-0000-4000-8400-000000000007';

  PERFORM qros_t02.assert('rotating a token archives the old one in qr_token_history',
    EXISTS (SELECT 1 FROM public.qr_token_history
             WHERE token = 'T02TOK0000000000000007'
               AND revoked_at IS NOT NULL));
END $t$;

SELECT qros_t02.expect_error(
  'resolve_table refuses a REVOKED token',
  $q$SELECT public.public_resolve_table('T02TOK0000000000000007')$q$,
  'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a REVOKED token (write path has no 12h grace)',
  $q$SELECT public.public_place_order('T02TOK0000000000000007',
        '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}]'::jsonb,
        NULL, NULL)$q$,
  'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

DO $t$
DECLARE v_ok boolean;
BEGIN
  BEGIN
    PERFORM qros_t02.call_json(NULL, 'anon', format(
      $q$SELECT public.public_get_order('T02TOK0000000000000007', %L)$q$,
      current_setting('qros_t02.revoked_order_code', true)));
    v_ok := true;
  EXCEPTION WHEN OTHERS THEN
    v_ok := false;
  END;
  PERFORM qros_t02.assert(
    'get_order still honours a token revoked <12h ago (doc 02 §1.6)', v_ok);
END $t$;

SELECT qros_t02.expect_ok(
  'the NEW token resolves after rotation',
  $q$SELECT public.public_resolve_table('T02TOKROTATED00000000A')$q$, NULL, 'anon');


-- =============================================================================
-- PART 3 — PRICE INTEGRITY: THE SERVER PRICES THE ORDER, THE CLIENT DOES NOT
--
-- doc 02 §1.3 and 20260901001300 §7:
--   "There is no price field anywhere in its input; subtotal, service fee and
--    total are authored here from menu_items.price, menu_item_options.price_delta
--    and the snapshotted service_fee_bps, in BIGINT minor units."
--
-- The payload below is hostile in every way a browser can be: it carries price,
-- unit_price, total, subtotal, service_fee, service_fee_bps, discount_total,
-- currency and name keys, all lying. None of them may reach the order.
--
-- Menu: Osh = 50000, Non = 5000. Service fee = 1000 bps (10%) on the tenant.
-- Correct answer: subtotal 105000, fee 10500, total 115500.
-- The payload asks for:  subtotal 1,     fee 0,     total 1.
-- =============================================================================
UPDATE qros_t02.part SET cur = '3. server-side pricing';

DO $t$
DECLARE
  v_doc      jsonb;
  v_order    public.orders%ROWTYPE;
  v_lines    bigint;
  v_bad      bigint;
BEGIN
  v_doc := qros_t02.call_json(NULL, 'anon', $q$
    SELECT public.public_place_order(
      'T02TOK0000000000000002',
      '[{"menu_item_id":"02000000-0000-4000-8300-000000000001",
         "quantity":2,
         "price":1, "unit_price":1, "line_total":1, "total":1,
         "name":{"uz":"Bepul"}, "price_snapshot":1, "options_total":-100000},
        {"menu_item_id":"02000000-0000-4000-8300-000000000002",
         "quantity":1,
         "price":0, "unit_price":0, "total":0,
         "subtotal":1, "service_fee":0, "service_fee_bps":0,
         "discount_total":999999, "currency":"XXX"}]'::jsonb,
      'attacker note', NULL)$q$);

  SELECT * INTO v_order FROM public.orders WHERE public_code = v_doc ->> 'public_code';

  PERFORM qros_t02.assert('place_order: subtotal is priced from menu_items (105000)',
    v_order.subtotal = 105000, format('got %s', v_order.subtotal));
  PERFORM qros_t02.assert('place_order: service fee is the snapshotted rate (10500)',
    v_order.service_fee = 10500, format('got %s (bps %s)', v_order.service_fee, v_order.service_fee_bps));
  PERFORM qros_t02.assert('place_order: total is subtotal - discount + fee (115500)',
    v_order.total = 115500, format('got %s', v_order.total));
  PERFORM qros_t02.assert('place_order: the payload''s discount_total is ignored (0)',
    v_order.discount_total = 0, format('got %s', v_order.discount_total));
  PERFORM qros_t02.assert('place_order: the payload''s service_fee_bps is ignored (1000)',
    v_order.service_fee_bps = 1000, format('got %s', v_order.service_fee_bps));
  PERFORM qros_t02.assert('place_order: the payload''s currency is ignored (UZS)',
    v_order.currency = 'UZS', format('got %s', v_order.currency));

  -- The returned document must agree with the stored row; a client that trusted
  -- the RPC's answer must not be told a different number from the one billed.
  PERFORM qros_t02.assert('place_order: the returned document quotes the stored total',
    (v_doc ->> 'total')::bigint = v_order.total
    AND (v_doc ->> 'subtotal')::bigint = v_order.subtotal,
    format('doc total %s / subtotal %s', v_doc ->> 'total', v_doc ->> 'subtotal'));

  SELECT count(*), count(*) FILTER (WHERE oi.price_snapshot <= 1 OR oi.total <= 1)
  INTO v_lines, v_bad
  FROM public.order_items oi WHERE oi.order_id = v_order.id;

  PERFORM qros_t02.assert('place_order: both lines were written', v_lines = 2,
    format('got %s', v_lines));
  PERFORM qros_t02.assert('place_order: no line took the attacker''s price',
    v_bad = 0, format('%s suspicious line(s)', v_bad));

  PERFORM qros_t02.assert('place_order: the line price_snapshot equals menu_items.price',
    (SELECT oi.price_snapshot FROM public.order_items oi
      WHERE oi.order_id = v_order.id
        AND oi.menu_item_id = '02000000-0000-4000-8300-000000000001') = 50000);
  PERFORM qros_t02.assert('place_order: the line name_snapshot is the menu name, not the payload''s',
    (SELECT oi.name_snapshot::jsonb ->> 'uz' FROM public.order_items oi
      WHERE oi.order_id = v_order.id
        AND oi.menu_item_id = '02000000-0000-4000-8300-000000000001') = 'Osh');

  -- The customer's own text IS honoured — the control is on money, not on notes.
  PERFORM qros_t02.assert('place_order: the customer note is kept',
    v_order.customer_note = 'attacker note', COALESCE(v_order.customer_note, '<null>'));
END $t$;


-- =============================================================================
-- PART 4 — WHAT public_place_order MUST REFUSE
--
-- doc 01 §6.8 (the binding orderability rule) and doc 02 §1.4 / §2.6.
-- Every refusal below is checked for its documented machine code AND SQLSTATE.
-- =============================================================================
UPDATE qros_t02.part SET cur = '4. place_order refusals';

SELECT qros_t02.expect_error(
  'place_order refuses an UNAVAILABLE (86''d) item',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000003","quantity":1}]'::jsonb,
       NULL, NULL)$q$,
  'QR020_ITEM_UNAVAILABLE', 'PT409', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses an item belonging to ANOTHER restaurant',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000004","quantity":1}]'::jsonb,
       NULL, NULL)$q$,
  'QR020_ITEM_UNAVAILABLE', 'PT409', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses an item that does not exist at all',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-0000000000ff","quantity":1}]'::jsonb,
       NULL, NULL)$q$,
  'QR020_ITEM_UNAVAILABLE', 'PT409', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a branch that has PAUSED ordering (is_accepting_orders)',
  $q$SELECT public.public_place_order('T02TOK0000000000000008',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}]'::jsonb,
       NULL, NULL)$q$,
  'QR003_BRANCH_INACTIVE', 'PT423', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a DEACTIVATED branch',
  $q$SELECT public.public_place_order('T02TOK0000000000000009',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}]'::jsonb,
       NULL, NULL)$q$,
  'QR003_BRANCH_INACTIVE', 'PT423', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a DEACTIVATED restaurant',
  $q$SELECT public.public_place_order('T02TOK0000000000000010',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}]'::jsonb,
       NULL, NULL)$q$,
  'QR004_RESTAURANT_INACTIVE', 'PT423', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses quantity = 0',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":0}]'::jsonb,
       NULL, NULL)$q$,
  'QR024_QUANTITY_OUT_OF_RANGE', 'PT422', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a NEGATIVE quantity (a credit line)',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":-5}]'::jsonb,
       NULL, NULL)$q$,
  'QR024_QUANTITY_OUT_OF_RANGE', 'PT422', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses an ABSURD quantity (1000000)',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1000000}]'::jsonb,
       NULL, NULL)$q$,
  'QR024_QUANTITY_OUT_OF_RANGE', 'PT422', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a quantity that does not fit in an integer',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":99999999999999}]'::jsonb,
       NULL, NULL)$q$,
  'QR023_INVALID_PAYLOAD', 'PT422', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a missing quantity',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '[{"menu_item_id":"02000000-0000-4000-8300-000000000002"}]'::jsonb,
       NULL, NULL)$q$,
  'QR024_QUANTITY_OUT_OF_RANGE', 'PT422', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses an empty cart',
  $q$SELECT public.public_place_order('T02TOK0000000000000017', '[]'::jsonb, NULL, NULL)$q$,
  'QR023_INVALID_PAYLOAD', 'PT422', NULL, 'anon');

SELECT qros_t02.expect_error(
  'place_order refuses a payload that is not an array',
  $q$SELECT public.public_place_order('T02TOK0000000000000017',
       '{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}'::jsonb,
       NULL, NULL)$q$,
  'QR023_INVALID_PAYLOAD', 'PT422', NULL, 'anon');

-- Nothing above may have left a row behind: a refused order is not a cancelled
-- order, it never existed.
DO $t$
DECLARE v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM public.orders
  WHERE table_id IN ('02000000-0000-4000-8400-000000000017',
                     '02000000-0000-4000-8400-000000000008',
                     '02000000-0000-4000-8400-000000000009',
                     '02000000-0000-4000-8400-000000000010');
  PERFORM qros_t02.assert('a refused place_order leaves NO orders row behind',
    v_n = 0, format('%s row(s)', v_n));
END $t$;


-- =============================================================================
-- PART 5 — order_items ARE SNAPSHOTS, NOT POINTERS
--
-- doc 01 §7 / doc 02 §2.6: every order line carries name_snapshot,
-- description_snapshot, price_snapshot ... so that repricing or renaming a dish
-- tomorrow cannot rewrite what a guest ordered and was billed today.
--
-- The repricing below is performed by a real MANAGER through the ordinary write
-- path, not by the superuser session, so this doubles as the positive control
-- that a menu manager can still do their job after the column-grant narrowing.
-- =============================================================================
UPDATE qros_t02.part SET cur = '5. price/name snapshots';

DO $t$
DECLARE v_doc jsonb;
BEGIN
  v_doc := qros_t02.call_json(NULL, 'anon', $q$
    SELECT public.public_place_order(
      'T02TOK0000000000000003',
      '[{"menu_item_id":"02000000-0000-4000-8300-000000000005","quantity":3}]'::jsonb,
      NULL, NULL)$q$);
  PERFORM set_config('qros_t02.snap_code', v_doc ->> 'public_code', true);

  PERFORM qros_t02.assert('snapshot: the order was billed at the price of the day (90000)',
    (v_doc ->> 'subtotal')::bigint = 90000, format('got %s', v_doc ->> 'subtotal'));
END $t$;

SELECT qros_t02.expect_ok(
  'a MANAGER can rename and reprice a menu item (positive control)',
  $q$UPDATE public.menu_items
        SET name  = '{"uz":"Qayta nomlangan","en":"Renamed"}'::jsonb,
            price = 999000
      WHERE id = '02000000-0000-4000-8300-000000000005'$q$,
  '02000000-0000-4000-8500-000000000002', 'authenticated');

DO $t$
DECLARE
  v_item public.menu_items%ROWTYPE;
  v_line public.order_items%ROWTYPE;
  v_ord  public.orders%ROWTYPE;
  v_doc  jsonb;
BEGIN
  SELECT * INTO v_item FROM public.menu_items
   WHERE id = '02000000-0000-4000-8300-000000000005';
  SELECT * INTO v_ord  FROM public.orders
   WHERE public_code = current_setting('qros_t02.snap_code', true);
  SELECT * INTO v_line FROM public.order_items WHERE order_id = v_ord.id;

  -- Guard against a vacuous test: the menu really did change.
  PERFORM qros_t02.assert('snapshot: the menu item really was repriced (999000)',
    v_item.price = 999000, format('menu price now %s', v_item.price));
  PERFORM qros_t02.assert('snapshot: the menu item really was renamed',
    v_item.name::jsonb ->> 'uz' = 'Qayta nomlangan', v_item.name::text);

  PERFORM qros_t02.assert('snapshot: the ORDER LINE keeps the original price (30000)',
    v_line.price_snapshot = 30000, format('got %s', v_line.price_snapshot));
  PERFORM qros_t02.assert('snapshot: the ORDER LINE keeps the original name',
    v_line.name_snapshot::jsonb ->> 'uz' = 'Original nomi', v_line.name_snapshot::text);
  PERFORM qros_t02.assert('snapshot: the ORDER LINE total is unchanged (90000)',
    v_line.total = 90000, format('got %s', v_line.total));
  PERFORM qros_t02.assert('snapshot: the ORDER total is unchanged (90000 + 10 percent fee = 99000)',
    v_ord.subtotal = 90000 AND v_ord.total = 99000,
    format('subtotal %s total %s', v_ord.subtotal, v_ord.total));

  -- ... and the customer-facing document tells the same story.
  v_doc := qros_t02.call_json(NULL, 'anon', format(
    $q$SELECT public.public_get_order('T02TOK0000000000000003', %L)$q$,
    current_setting('qros_t02.snap_code', true)));
  PERFORM qros_t02.assert('snapshot: public_get_order still shows the original name and price',
    v_doc #>> '{lines,0,name,uz}' = 'Original nomi'
    AND (v_doc #>> '{lines,0,unit_price}')::bigint = 30000,
    format('%s / %s', v_doc #>> '{lines,0,name,uz}', v_doc #>> '{lines,0,unit_price}'));
END $t$;


-- =============================================================================
-- PART 6 — public_get_order NEEDS BOTH CAPABILITIES
--
-- doc 02 §2.4 / 20260901001300 §8:
--   "BOTH capabilities must match: an order code forwarded to a group chat is
--    useless without the table's QR token — the same trust boundary as
--    physically sitting there."
--   "Wrong order code, or the right code at the wrong table: identical error."
-- =============================================================================
UPDATE qros_t02.part SET cur = '6. get_order capabilities';

DO $t$
DECLARE v_doc jsonb;
BEGIN
  v_doc := qros_t02.call_json(NULL, 'anon', $q$
    SELECT public.public_place_order(
      'T02TOK0000000000000004',
      '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":2}]'::jsonb,
      NULL, NULL)$q$);
  PERFORM set_config('qros_t02.track_code', v_doc ->> 'public_code', true);
END $t$;

DO $t$
DECLARE v_code text := current_setting('qros_t02.track_code', true);
BEGIN
  -- Positive control: token 4 + its own code.
  PERFORM qros_t02.expect_ok('get_order accepts token + its own order code',
    format($q$SELECT public.public_get_order('T02TOK0000000000000004', %L)$q$, v_code),
    NULL, 'anon');

  -- The order code alone is not a capability: there is no one-argument form, and
  -- an empty or absent token is refused before the code is even looked at.
  PERFORM qros_t02.expect_error('get_order refuses the order code with a NULL token',
    format($q$SELECT public.public_get_order(NULL, %L)$q$, v_code),
    'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');
  PERFORM qros_t02.expect_error('get_order refuses the order code with an EMPTY token',
    format($q$SELECT public.public_get_order('', %L)$q$, v_code),
    'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');
  PERFORM qros_t02.expect_error('get_order refuses the order code with a FORGED token',
    format($q$SELECT public.public_get_order('T02NOSUCHTOKEN000000ZZ', %L)$q$, v_code),
    'QR001_INVALID_QR_TOKEN', 'PT404', NULL, 'anon');

  -- The right code presented at the WRONG table (table 5, same branch, same
  -- tenant) must be indistinguishable from a code that does not exist.
  PERFORM qros_t02.expect_error(
    'get_order refuses a valid code from a DIFFERENT table (same branch)',
    format($q$SELECT public.public_get_order('T02TOK0000000000000005', %L)$q$, v_code),
    'QR030_ORDER_NOT_FOUND', 'PT404', NULL, 'anon');
  PERFORM qros_t02.expect_error(
    'get_order refuses a valid code from a table in ANOTHER restaurant',
    format($q$SELECT public.public_get_order('T02TOK0000000000000018', %L)$q$, v_code),
    'QR030_ORDER_NOT_FOUND', 'PT404', NULL, 'anon');

  -- A wrong code at the right table gets the SAME error, so the pair cannot be
  -- probed apart.
  PERFORM qros_t02.expect_error('get_order refuses an unknown order code',
    $q$SELECT public.public_get_order('T02TOK0000000000000004', 'ZZZZZZZZZZ')$q$,
    'QR030_ORDER_NOT_FOUND', 'PT404', NULL, 'anon');
  PERFORM qros_t02.expect_error('get_order refuses a malformed order code',
    $q$SELECT public.public_get_order('T02TOK0000000000000004', 'x')$q$,
    'QR030_ORDER_NOT_FOUND', 'PT404', NULL, 'anon');
  PERFORM qros_t02.expect_error('get_order refuses a NULL order code',
    $q$SELECT public.public_get_order('T02TOK0000000000000004', NULL)$q$,
    'QR030_ORDER_NOT_FOUND', 'PT404', NULL, 'anon');
END $t$;

-- The customer document must not leak internal identity (doc 02 §2.5: the
-- resolved ids "are NEVER emitted to anon").
DO $t$
DECLARE v_doc jsonb; v_leaks text;
BEGIN
  v_doc := qros_t02.call_json(NULL, 'anon', format(
    $q$SELECT public.public_get_order('T02TOK0000000000000004', %L)$q$,
    current_setting('qros_t02.track_code', true)));

  SELECT string_agg(k, ', ' ORDER BY k) INTO v_leaks
  FROM jsonb_object_keys(v_doc) k
  WHERE k IN ('id','restaurant_id','branch_id','table_id','customer_session_id',
              'client_request_id','payload_fingerprint','confirmed_by_staff_id',
              'served_by_staff_id','cancelled_by_staff_id');

  PERFORM qros_t02.assert('get_order emits no tenant ids or staff identities',
    v_leaks IS NULL, COALESCE('leaked: ' || v_leaks, 'none'));
END $t$;


-- =============================================================================
-- PART 7 — THE ORDER STATE MACHINE IS ROLE-AWARE (doc 02 §3.17 / §3.18, F08)
--
-- F08: "THE STATUS STATE MACHINE IS NOT ROLE-AWARE ... a KITCHEN account PATCHes
-- a `preparing` order to {status:cancelled} ... a WAITER cancels a `ready` order
-- ... a KITCHEN account drives ready -> delivered -> completed."
--
-- qros_t02.spec_transition_allowed() below is doc 02 §3.17 TRANSCRIBED, with the
-- lowercase role labels of the doc mapped onto the binding UPPER_SNAKE members of
-- public.app_role (doc 03 §1 reconciliation). It is the oracle; nothing in it is
-- read from a migration.
-- =============================================================================
UPDATE qros_t02.part SET cur = '7. state machine';

CREATE FUNCTION qros_t02.spec_transition_allowed(
  p_from  public.order_status,
  p_to    public.order_status,
  p_actor public.app_role
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE
    -- terminal states are terminal for everybody
    WHEN p_actor IS NULL                      THEN false
    WHEN p_from IN ('completed','cancelled')  THEN false
    WHEN p_from = p_to                        THEN false

    -- cancellation
    WHEN p_to = 'cancelled' THEN CASE p_actor
      WHEN 'SUPER_ADMIN'      THEN p_from IN ('pending','confirmed','preparing','ready','delivered')
      WHEN 'RESTAURANT_OWNER' THEN p_from IN ('pending','confirmed','preparing','ready','delivered')
      WHEN 'MANAGER'          THEN p_from IN ('pending','confirmed','preparing','ready')
      WHEN 'WAITER'           THEN p_from IN ('pending','confirmed')
      ELSE false                              -- kitchen may never cancel
    END

    -- forward path
    WHEN p_from = 'pending'   AND p_to = 'confirmed' THEN
      p_actor IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN')
    WHEN p_from = 'confirmed' AND p_to = 'preparing' THEN
      p_actor IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','KITCHEN')
    WHEN p_from = 'preparing' AND p_to = 'ready'     THEN
      p_actor IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','KITCHEN')
    WHEN p_from = 'ready'     AND p_to = 'delivered' THEN
      p_actor IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','WAITER')
    WHEN p_from = 'delivered' AND p_to = 'completed' THEN
      p_actor IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','WAITER')
    ELSE false
  END;
$fn$;

-- ---------------------------------------------------------------------------
-- DECLARED GAPS — the ONLY places this suite tolerates the database being
-- stricter than doc 02 §3.17. Each entry must be justified here in writing.
--
--   (delivered -> cancelled, SUPER_ADMIN | RESTAURANT_OWNER)
--     §3.17 permits it and the reference graph in the same section draws the
--     cancel arrow from `delivered`. The database does not: the structural graph
--     public.is_valid_order_transition() (20260901000800_functions_triggers.sql)
--     has `WHEN 'delivered' THEN p_to = 'completed'`, and BOTH
--     public.order_transition_allowed() and the CHECK constraint
--     ck_order_status_history_transition_legal are built on it. So an owner
--     cannot walk back an order that has already been handed to the guest.
--     This is RESTRICTIVE, not permissive — it grants nobody anything — so it
--     does not fail the build. Closing it needs a change to the graph function
--     AND to the history CHECK, which is a schema migration, not a test fix.
-- ---------------------------------------------------------------------------
CREATE FUNCTION qros_t02.declared_gap(
  p_from public.order_status, p_to public.order_status, p_actor public.app_role
) RETURNS boolean LANGUAGE sql IMMUTABLE AS $fn$
  SELECT p_from = 'delivered' AND p_to = 'cancelled'
     AND p_actor IN ('SUPER_ADMIN','RESTAURANT_OWNER');
$fn$;

-- ---------------------------------------------------------------------------
-- 7A. The predicate itself, over the COMPLETE grid: 7 statuses x 7 statuses x
--     5 roles = 245 triples, plus the NULL actor.
-- ---------------------------------------------------------------------------
DO $t$
DECLARE
  v_permissive  text;
  v_undeclared  text;
  v_gap_rows    text;
  v_closed      text;
  v_n           bigint;
BEGIN
  CREATE TEMP TABLE t02_grid ON COMMIT DROP AS
  SELECT f.s AS from_s, t.s AS to_s, r.r AS actor,
         qros_t02.spec_transition_allowed(f.s, t.s, r.r)  AS spec,
         public.order_transition_allowed(f.s, t.s, r.r)   AS actual,
         qros_t02.declared_gap(f.s, t.s, r.r)             AS declared
  FROM   (SELECT unnest(enum_range(NULL::public.order_status)) s) f,
         (SELECT unnest(enum_range(NULL::public.order_status)) s) t,
         (SELECT unnest(enum_range(NULL::public.app_role))     r) r;

  SELECT count(*) INTO v_n FROM t02_grid;
  PERFORM qros_t02.assert('§3.17 grid was evaluated in full (245 triples)',
    v_n = 245, format('%s triples', v_n));

  -- (a) PERMISSIVE drift: the database allows what §3.17 forbids. Always a FAIL.
  SELECT string_agg(format('%s->%s/%s', from_s, to_s, actor), ', ' ORDER BY from_s, to_s, actor)
  INTO v_permissive FROM t02_grid WHERE COALESCE(actual, false) AND NOT spec;
  PERFORM qros_t02.assert('§3.17: the database allows NOTHING the spec forbids',
    v_permissive IS NULL, COALESCE('extra: ' || v_permissive, 'none'));

  -- (b) RESTRICTIVE drift that is NOT declared above. Also a FAIL: an
  --     undocumented refusal is a broken feature.
  SELECT string_agg(format('%s->%s/%s', from_s, to_s, actor), ', ' ORDER BY from_s, to_s, actor)
  INTO v_undeclared FROM t02_grid
  WHERE spec AND NOT COALESCE(actual, false) AND NOT declared;
  PERFORM qros_t02.assert('§3.17: every refusal beyond the spec is a DECLARED gap',
    v_undeclared IS NULL, COALESCE('undeclared: ' || v_undeclared, 'none'));

  -- (c) the declared gaps, reported loudly so they cannot be forgotten.
  SELECT string_agg(format('%s->%s/%s', from_s, to_s, actor), ', ' ORDER BY from_s, to_s, actor)
  INTO v_gap_rows FROM t02_grid WHERE declared AND spec AND NOT COALESCE(actual, false);
  IF v_gap_rows IS NOT NULL THEN
    PERFORM qros_t02.record('§3.17 declared gap: spec permits, database refuses',
      'GAP', v_gap_rows || '  (is_valid_order_transition has no delivered->cancelled edge)');
  END IF;

  -- (d) a gap that has since been CLOSED must be removed from the list, or the
  --     list quietly becomes a licence to fail.
  SELECT string_agg(format('%s->%s/%s', from_s, to_s, actor), ', ' ORDER BY from_s, to_s, actor)
  INTO v_closed FROM t02_grid WHERE declared AND spec AND COALESCE(actual, false);
  IF v_closed IS NOT NULL THEN
    PERFORM qros_t02.record('§3.17 declared gap is now CLOSED — delete it from qros_t02.declared_gap',
      'GAP', v_closed);
  END IF;

  -- (e) the named exploits of F08, asserted individually so a regression names
  --     itself rather than hiding in an aggregate.
  PERFORM qros_t02.assert('§3.17: KITCHEN may never cancel (any source state)',
    NOT EXISTS (SELECT 1 FROM t02_grid
                 WHERE actor = 'KITCHEN' AND to_s = 'cancelled' AND COALESCE(actual, false)));
  PERFORM qros_t02.assert('§3.17: WAITER may cancel only pending/confirmed',
    NOT EXISTS (SELECT 1 FROM t02_grid
                 WHERE actor = 'WAITER' AND to_s = 'cancelled'
                   AND from_s NOT IN ('pending','confirmed') AND COALESCE(actual, false)));
  PERFORM qros_t02.assert('§3.17: MANAGER may not cancel a delivered order',
    NOT public.order_transition_allowed('delivered','cancelled','MANAGER'));
  PERFORM qros_t02.assert('§3.17: KITCHEN may not drive ready -> delivered',
    NOT public.order_transition_allowed('ready','delivered','KITCHEN'));
  PERFORM qros_t02.assert('§3.17: KITCHEN may not drive delivered -> completed',
    NOT public.order_transition_allowed('delivered','completed','KITCHEN'));
  PERFORM qros_t02.assert('§3.17: WAITER may not drive preparing -> ready',
    NOT public.order_transition_allowed('preparing','ready','WAITER'));
  PERFORM qros_t02.assert('§3.17: completed -> preparing is refused for every role',
    NOT EXISTS (SELECT 1 FROM t02_grid
                 WHERE from_s = 'completed' AND to_s = 'preparing' AND COALESCE(actual, false)));
  PERFORM qros_t02.assert('§3.17: cancelled -> ready is refused for every role',
    NOT EXISTS (SELECT 1 FROM t02_grid
                 WHERE from_s = 'cancelled' AND to_s = 'ready' AND COALESCE(actual, false)));
  PERFORM qros_t02.assert('§3.17: no transition OUT of a terminal state, for anybody',
    NOT EXISTS (SELECT 1 FROM t02_grid
                 WHERE from_s IN ('completed','cancelled') AND COALESCE(actual, false)));
  PERFORM qros_t02.assert('§3.17: a NULL actor (not staff) is allowed nothing',
    NOT EXISTS (SELECT 1
                FROM (SELECT unnest(enum_range(NULL::public.order_status)) s) f,
                     (SELECT unnest(enum_range(NULL::public.order_status)) s) t
                WHERE COALESCE(public.order_transition_allowed(f.s, t.s, NULL), true)));

  -- The suite must not be vacuous: SOMETHING has to be allowed.
  SELECT count(*) INTO v_n FROM t02_grid WHERE COALESCE(actual, false);
  PERFORM qros_t02.assert('§3.17: the matrix is not uniformly false (sanity)',
    v_n > 0, format('%s allowed triples', v_n));
END $t$;


-- ---------------------------------------------------------------------------
-- 7B. The predicate could be perfect and still never be consulted (that is
--     exactly what F08 found). So drive every transition END TO END, as a real
--     signed-in staff member, through an ordinary UPDATE — the same statement
--     PostgREST issues for `PATCH /rest/v1/orders?id=eq.<x>`.
--
--     A refusal counts whether it arrives as an exception (the guard trigger) or
--     as zero rows (RLS made the row invisible or unwritable); both leave the
--     order in its original state, which is the property that matters. The
--     mechanism is recorded either way, and the named F08 exploits below assert
--     the exact error code as well.
-- ---------------------------------------------------------------------------
CREATE FUNCTION qros_t02.probe_transition(
  p_from public.order_status,
  p_to   public.order_status,
  p_uid  uuid,
  OUT o_allowed boolean, OUT o_state text, OUT o_msg text, OUT o_rows integer,
  OUT o_final public.order_status)
RETURNS record LANGUAGE plpgsql AS $fn$
DECLARE v_id uuid := gen_random_uuid();
BEGIN
  PERFORM qros_t02.mk_order(v_id, p_from);
  o_rows := 0;
  BEGIN
    o_rows := qros_t02.run_as(p_uid, 'authenticated', format(
      'UPDATE public.orders SET status = %L%s WHERE id = %L',
      p_to,
      CASE WHEN p_to = 'cancelled' THEN ', cancellation_reason = ''t02 probe''' ELSE '' END,
      v_id));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS o_state = RETURNED_SQLSTATE, o_msg = MESSAGE_TEXT;
    o_rows := 0;
  END;
  SELECT status INTO o_final FROM public.orders WHERE id = v_id;
  o_allowed := (o_state IS NULL AND o_rows = 1 AND o_final = p_to);
END $fn$;

DO $t$
DECLARE
  r          record;
  v_probe    record;
  v_permit   text;
  v_undecl   text;
  v_gap      text;
  v_stuck    text;
  v_n        bigint;
BEGIN
  CREATE TEMP TABLE t02_behaviour (
    from_s   public.order_status,
    to_s     public.order_status,
    actor    public.app_role,
    spec     boolean,
    declared boolean,
    allowed  boolean,
    final_s  public.order_status,
    mech     text
  ) ON COMMIT DROP;

  FOR r IN
    SELECT g.from_s, g.to_s, g.actor, g.spec, g.declared, a.uid
    FROM t02_grid g
    JOIN (VALUES
            ('RESTAURANT_OWNER'::public.app_role, '02000000-0000-4000-8500-000000000001'::uuid),
            ('MANAGER',                           '02000000-0000-4000-8500-000000000002'),
            ('WAITER',                            '02000000-0000-4000-8500-000000000003'),
            ('KITCHEN',                           '02000000-0000-4000-8500-000000000004')
         ) a(role, uid) ON a.role = g.actor
    WHERE g.from_s <> g.to_s
    ORDER BY g.from_s, g.to_s, g.actor
  LOOP
    SELECT * INTO v_probe FROM qros_t02.probe_transition(r.from_s, r.to_s, r.uid);
    INSERT INTO t02_behaviour
    VALUES (r.from_s, r.to_s, r.actor, r.spec, r.declared,
            v_probe.o_allowed, v_probe.o_final,
            CASE WHEN v_probe.o_allowed THEN 'accepted'
                 WHEN v_probe.o_state IS NOT NULL THEN v_probe.o_state || ' ' || v_probe.o_msg
                 ELSE 'refused by RLS (0 rows)' END);
  END LOOP;

  SELECT count(*) INTO v_n FROM t02_behaviour;
  PERFORM qros_t02.assert('every legal-and-illegal transition was driven end to end',
    v_n = 168, format('%s attempts (7x6 pairs x 4 roles)', v_n));

  -- (a) EXPLOITABLE: the server accepted something §3.17 forbids.
  SELECT string_agg(format('%s->%s/%s', from_s, to_s, actor), ', ' ORDER BY from_s, to_s, actor)
  INTO v_permit FROM t02_behaviour WHERE allowed AND NOT spec;
  PERFORM qros_t02.assert('end to end: the server ACCEPTS nothing §3.17 forbids',
    v_permit IS NULL, COALESCE('accepted: ' || v_permit, 'none'));

  -- (b) BROKEN FEATURE: the server refused something §3.17 permits, and it is
  --     not on the declared list.
  SELECT string_agg(format('%s->%s/%s [%s]', from_s, to_s, actor, mech), ' | ' ORDER BY from_s, to_s, actor)
  INTO v_undecl FROM t02_behaviour WHERE spec AND NOT allowed AND NOT declared;
  PERFORM qros_t02.assert('end to end: the server ACCEPTS everything §3.17 permits',
    v_undecl IS NULL, COALESCE('refused: ' || v_undecl, 'none'));

  SELECT string_agg(format('%s->%s/%s [%s]', from_s, to_s, actor, mech), ' | ' ORDER BY from_s, to_s, actor)
  INTO v_gap FROM t02_behaviour WHERE spec AND NOT allowed AND declared;
  IF v_gap IS NOT NULL THEN
    PERFORM qros_t02.record('end to end: declared §3.17 gap reproduced', 'GAP', v_gap);
  END IF;

  -- (c) a refused transition must leave the order EXACTLY where it was. A guard
  --     that raises after a partial write would be worse than no guard.
  SELECT string_agg(format('%s->%s/%s ended as %s', from_s, to_s, actor, final_s), ', ')
  INTO v_stuck FROM t02_behaviour WHERE NOT allowed AND final_s IS DISTINCT FROM from_s;
  PERFORM qros_t02.assert('end to end: a refused transition never moves the order',
    v_stuck IS NULL, COALESCE(v_stuck, 'none'));

  SELECT count(*) INTO v_n FROM t02_behaviour WHERE allowed;
  PERFORM qros_t02.assert('end to end: the run is not vacuous (some transitions succeed)',
    v_n > 0, format('%s accepted', v_n));
END $t$;

-- The named F08 exploits, each asserting the documented error, so that a
-- regression names itself instead of vanishing into an aggregate.
DO $t$
DECLARE p record;
BEGIN
  -- EXPLOIT 1: a KITCHEN account cancels the ticket off the pass.
  SELECT * INTO p FROM qros_t02.probe_transition('preparing','cancelled',
    '02000000-0000-4000-8500-000000000004');
  PERFORM qros_t02.assert('F08/1: KITCHEN cannot cancel a preparing order',
    NOT p.o_allowed AND p.o_msg = 'QR040_INVALID_STATUS_TRANSITION' AND p.o_state = 'PT409',
    format('%s %s', p.o_state, p.o_msg));

  SELECT * INTO p FROM qros_t02.probe_transition('confirmed','cancelled',
    '02000000-0000-4000-8500-000000000004');
  PERFORM qros_t02.assert('F08/1: KITCHEN cannot cancel a confirmed order',
    NOT p.o_allowed AND p.o_msg = 'QR040_INVALID_STATUS_TRANSITION' AND p.o_state = 'PT409',
    format('%s %s', p.o_state, p.o_msg));

  -- EXPLOIT 2: a WAITER cancels an order the kitchen has already plated.
  SELECT * INTO p FROM qros_t02.probe_transition('ready','cancelled',
    '02000000-0000-4000-8500-000000000003');
  PERFORM qros_t02.assert('F08/2: WAITER cannot cancel a ready order',
    NOT p.o_allowed AND p.o_msg = 'QR040_INVALID_STATUS_TRANSITION' AND p.o_state = 'PT409',
    format('%s %s', p.o_state, p.o_msg));

  -- EXPLOIT 3: a KITCHEN account closes out orders it never served.
  SELECT * INTO p FROM qros_t02.probe_transition('ready','delivered',
    '02000000-0000-4000-8500-000000000004');
  PERFORM qros_t02.assert('F08/3: KITCHEN cannot mark an order delivered',
    NOT p.o_allowed AND p.o_msg = 'QR040_INVALID_STATUS_TRANSITION' AND p.o_state = 'PT409',
    format('%s %s', p.o_state, p.o_msg));

  SELECT * INTO p FROM qros_t02.probe_transition('delivered','completed',
    '02000000-0000-4000-8500-000000000004');
  PERFORM qros_t02.assert('F08/3: KITCHEN cannot complete an order',
    NOT p.o_allowed, format('%s %s rows=%s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-'), p.o_rows));

  -- The floor does not cook: a waiter cannot declare food ready.
  SELECT * INTO p FROM qros_t02.probe_transition('preparing','ready',
    '02000000-0000-4000-8500-000000000003');
  PERFORM qros_t02.assert('§3.17: WAITER cannot mark food ready',
    NOT p.o_allowed AND p.o_msg = 'QR040_INVALID_STATUS_TRANSITION' AND p.o_state = 'PT409',
    format('%s %s', p.o_state, p.o_msg));

  -- Terminal is terminal, even for the owner. These are refused by the
  -- structural graph (ERRCODE 'ORD01'), before the role matrix is consulted.
  SELECT * INTO p FROM qros_t02.probe_transition('completed','preparing',
    '02000000-0000-4000-8500-000000000001');
  PERFORM qros_t02.assert('brief §26: completed -> preparing is refused (owner)',
    NOT p.o_allowed AND p.o_state = 'ORD01', format('%s %s', p.o_state, p.o_msg));

  SELECT * INTO p FROM qros_t02.probe_transition('cancelled','ready',
    '02000000-0000-4000-8500-000000000001');
  PERFORM qros_t02.assert('brief §26: cancelled -> ready is refused (owner)',
    NOT p.o_allowed AND p.o_state = 'ORD01', format('%s %s', p.o_state, p.o_msg));

  -- Skipping a step is not a shortcut.
  SELECT * INTO p FROM qros_t02.probe_transition('pending','ready',
    '02000000-0000-4000-8500-000000000001');
  PERFORM qros_t02.assert('graph: pending -> ready (skipping states) is refused',
    NOT p.o_allowed AND p.o_state = 'ORD01', format('%s %s', p.o_state, p.o_msg));

  -- Positive controls: the roles that SHOULD be able to work, can.
  SELECT * INTO p FROM qros_t02.probe_transition('pending','confirmed',
    '02000000-0000-4000-8500-000000000003');
  PERFORM qros_t02.assert('control: WAITER accepts a pending ticket', p.o_allowed,
    format('%s %s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-')));

  SELECT * INTO p FROM qros_t02.probe_transition('confirmed','preparing',
    '02000000-0000-4000-8500-000000000004');
  PERFORM qros_t02.assert('control: KITCHEN starts cooking', p.o_allowed,
    format('%s %s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-')));

  SELECT * INTO p FROM qros_t02.probe_transition('preparing','ready',
    '02000000-0000-4000-8500-000000000004');
  PERFORM qros_t02.assert('control: KITCHEN marks food ready', p.o_allowed,
    format('%s %s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-')));

  SELECT * INTO p FROM qros_t02.probe_transition('ready','delivered',
    '02000000-0000-4000-8500-000000000003');
  PERFORM qros_t02.assert('control: WAITER serves the food', p.o_allowed,
    format('%s %s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-')));

  SELECT * INTO p FROM qros_t02.probe_transition('delivered','completed',
    '02000000-0000-4000-8500-000000000003');
  PERFORM qros_t02.assert('control: WAITER closes the order', p.o_allowed,
    format('%s %s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-')));

  SELECT * INTO p FROM qros_t02.probe_transition('ready','cancelled',
    '02000000-0000-4000-8500-000000000002');
  PERFORM qros_t02.assert('control: MANAGER may still cancel a ready order', p.o_allowed,
    format('%s %s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-')));
END $t$;

-- An authenticated user with a valid JWT but NO staff row anywhere is not an
-- actor at all (doc 02 §3.18: "if v_actor is null ... QR050_FORBIDDEN").
DO $t$
DECLARE p record;
BEGIN
  SELECT * INTO p FROM qros_t02.probe_transition('pending','confirmed',
    '02000000-0000-4000-8500-000000000005');
  PERFORM qros_t02.assert('a signed-in NON-STAFF user cannot move an order',
    NOT p.o_allowed AND p.o_final = 'pending',
    format('%s %s rows=%s final=%s', COALESCE(p.o_state,'-'), COALESCE(p.o_msg,'-'),
           p.o_rows, p.o_final));
END $t$;

-- Cancelling always costs a reason (doc 02 §3.18 QR042 / ERRCODE 'ORD04').
DO $t$
DECLARE v_id uuid := gen_random_uuid(); v_state text; v_msg text;
BEGIN
  PERFORM qros_t02.mk_order(v_id, 'pending');
  BEGIN
    PERFORM qros_t02.run_as('02000000-0000-4000-8500-000000000003', 'authenticated',
      format('UPDATE public.orders SET status = ''cancelled'' WHERE id = %L', v_id));
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  PERFORM qros_t02.assert('cancelling without a reason is refused',
    v_state IS NOT NULL
    AND (SELECT status FROM public.orders WHERE id = v_id) = 'pending',
    format('%s %s', COALESCE(v_state,'-'), COALESCE(v_msg,'-')));
END $t$;


-- =============================================================================
-- PART 8 — THE AUDIT TRAIL NAMES THE ACTOR (doc 01 §7.7b, finding F08/F10)
--
-- F08: "The audit trail records these as legitimate: orders_log_status_change
-- writes changed_by_role from current_setting('app.actor_role'), which a
-- PostgREST caller never sets, so the row is stamped 'system'/NULL rather than
-- naming the kitchen account."
--
-- A state machine that is enforced but not attributed is only half a control:
-- you can stop the wrong move, but you cannot say who tried.
-- =============================================================================
UPDATE qros_t02.part SET cur = '8. audit attribution';

DO $t$
DECLARE
  v_doc   jsonb;
  v_ord   public.orders%ROWTYPE;
  v_h     public.order_status_history%ROWTYPE;
BEGIN
  -- A guest places the order: the creation row is the CUSTOMER's, and the schema
  -- forbids it from naming a person (ck_order_status_history_customer_actor).
  v_doc := qros_t02.call_json(NULL, 'anon', $q$
    SELECT public.public_place_order(
      'T02TOK0000000000000014',
      '[{"menu_item_id":"02000000-0000-4000-8300-000000000001","quantity":1}]'::jsonb,
      NULL, NULL)$q$);
  SELECT * INTO v_ord FROM public.orders WHERE public_code = v_doc ->> 'public_code';

  SELECT * INTO v_h FROM public.order_status_history
   WHERE order_id = v_ord.id ORDER BY created_at, id LIMIT 1;
  PERFORM qros_t02.assert('history: the creation row is attributed to the customer',
    v_h.new_status = 'pending' AND v_h.changed_by_kind = 'customer'
    AND v_h.changed_by IS NULL AND v_h.changed_by_role IS NULL,
    format('%s / kind=%s / by=%s / role=%s',
           v_h.new_status, v_h.changed_by_kind, v_h.changed_by, v_h.changed_by_role));

  -- The WAITER accepts it, through the ordinary PATCH-equivalent UPDATE.
  PERFORM qros_t02.run_as('02000000-0000-4000-8500-000000000003', 'authenticated',
    format('UPDATE public.orders SET status = ''confirmed'' WHERE id = %L', v_ord.id));

  SELECT * INTO v_h FROM public.order_status_history
   WHERE order_id = v_ord.id AND new_status = 'confirmed'
   ORDER BY created_at DESC, id DESC LIMIT 1;

  PERFORM qros_t02.assert('history: a staff transition is NOT attributed to ''system''',
    v_h.changed_by_kind = 'staff',
    format('kind=%s', v_h.changed_by_kind));
  PERFORM qros_t02.assert('history: the staff transition names the acting PROFILE',
    v_h.changed_by = '02000000-0000-4000-8500-000000000003',
    format('changed_by=%s', v_h.changed_by));
  PERFORM qros_t02.assert('history: the staff transition records the acting ROLE',
    v_h.changed_by_role = 'WAITER', format('role=%s', v_h.changed_by_role));
  PERFORM qros_t02.assert('history: previous_status is recorded (pending -> confirmed)',
    v_h.previous_status = 'pending' AND v_h.new_status = 'confirmed',
    format('%s -> %s', v_h.previous_status, v_h.new_status));

  -- F10's other half: the order row itself must name the staff member.
  SELECT * INTO v_ord FROM public.orders WHERE id = v_ord.id;
  PERFORM qros_t02.assert('F10: orders.confirmed_by_staff_id is stamped, not left NULL',
    v_ord.confirmed_by_staff_id = '02000000-0000-4000-8600-000000000003',
    format('confirmed_by_staff_id=%s', v_ord.confirmed_by_staff_id));

  -- A different role, so the attribution is not a constant.
  PERFORM qros_t02.run_as('02000000-0000-4000-8500-000000000004', 'authenticated',
    format('UPDATE public.orders SET status = ''preparing'' WHERE id = %L', v_ord.id));
  SELECT * INTO v_h FROM public.order_status_history
   WHERE order_id = v_ord.id AND new_status = 'preparing'
   ORDER BY created_at DESC, id DESC LIMIT 1;
  PERFORM qros_t02.assert('history: a KITCHEN transition names the kitchen account',
    v_h.changed_by_kind = 'staff'
    AND v_h.changed_by = '02000000-0000-4000-8500-000000000004'
    AND v_h.changed_by_role = 'KITCHEN',
    format('kind=%s by=%s role=%s', v_h.changed_by_kind, v_h.changed_by, v_h.changed_by_role));

  -- The history table is append-only (doc 01 §7.7b): an actor cannot launder
  -- their own row afterwards.
  PERFORM qros_t02.expect_error(
    'history: a staff member cannot rewrite an audit row',
    format($q$UPDATE public.order_status_history
                 SET changed_by_role = 'RESTAURANT_OWNER' WHERE id = %L$q$, v_h.id),
    NULL, NULL, '02000000-0000-4000-8500-000000000002', 'authenticated');
  PERFORM qros_t02.expect_error(
    'history: a staff member cannot delete an audit row',
    format('DELETE FROM public.order_status_history WHERE id = %L', v_h.id),
    NULL, NULL, '02000000-0000-4000-8500-000000000002', 'authenticated');

  PERFORM qros_t02.assert('history: the audit row survived both attempts',
    EXISTS (SELECT 1 FROM public.order_status_history
             WHERE id = v_h.id AND changed_by_role = 'KITCHEN'));
END $t$;


-- =============================================================================
-- PART 9 — WAITER CALLS: SPAM IS REFUSED, BUT A TABLE IS NEVER WEDGED
--
-- doc 02 §1.8 / §5.3 and finding F16. Two opposite failure modes, both real:
--   * no cooldown  -> the waiter console is a doorbell anyone can hold down;
--   * no expiry    -> ONE abandoned call holds uq_waiter_calls_open_per_table
--                     forever and that table can never call a waiter again.
-- =============================================================================
UPDATE qros_t02.part SET cur = '9. waiter calls';

-- 9.1 / 9.2 — the cooldown.
DO $t$
DECLARE v jsonb; v_n bigint;
BEGIN
  v := qros_t02.call_json(NULL, 'anon',
    $q$SELECT public.public_call_waiter('T02TOK0000000000000011','call_waiter')$q$);
  PERFORM qros_t02.assert('waiter call: the first call is accepted',
    v ->> 'status' = 'pending', v::text);

  SELECT count(*) INTO v_n FROM public.waiter_calls
   WHERE table_id = '02000000-0000-4000-8400-000000000011' AND status = 'pending';
  PERFORM qros_t02.assert('waiter call: exactly one open call exists', v_n = 1,
    format('%s', v_n));

  PERFORM qros_t02.assert('waiter call: the per-table clock was stamped by the server',
    (SELECT last_waiter_call_at IS NOT NULL FROM public.tables
      WHERE id = '02000000-0000-4000-8400-000000000011'));
END $t$;

SELECT qros_t02.expect_error(
  'waiter call: a second call inside the cooldown window is refused',
  $q$SELECT public.public_call_waiter('T02TOK0000000000000011','call_waiter')$q$,
  'QR011_WAITER_CALL_COOLDOWN', 'PT429', NULL, 'anon');

SELECT qros_t02.expect_error(
  'waiter call: an unknown reason is refused',
  $q$SELECT public.public_call_waiter('T02TOK0000000000000012','give_me_free_food')$q$,
  'QR023_INVALID_PAYLOAD', 'PT422', NULL, 'anon');

-- 9.3 — past the cooldown but the call is still genuinely open: the one-open-
--       call-per-table rule must still hold, or the expiry valve has simply
--       disabled the anti-spam control.
DO $t$
BEGIN
  INSERT INTO public.waiter_calls
    (restaurant_id, branch_id, table_id, reason, status, created_at, updated_at)
  VALUES ('02000000-0000-4000-8000-000000000001',
          '02000000-0000-4000-8100-000000000001',
          '02000000-0000-4000-8400-000000000013',
          'call_waiter', 'pending', now() - interval '5 minutes', now() - interval '5 minutes');
  UPDATE public.tables SET last_waiter_call_at = now() - interval '5 minutes'
   WHERE id = '02000000-0000-4000-8400-000000000013';
END $t$;

SELECT qros_t02.expect_error(
  'waiter call: a still-open call blocks a new one (anti-spam intact)',
  $q$SELECT public.public_call_waiter('T02TOK0000000000000013','call_waiter')$q$,
  'QR012_WAITER_CALL_ALREADY_OPEN', 'PT409', NULL, 'anon');

-- 9.4 — the abandoned call. branches.waiter_call_expiry_minutes is 30; this one
--       is 40 minutes old and nobody ever acknowledged it. Without an expiry
--       path the table is wedged permanently (F16).
DO $t$
DECLARE v jsonb; v_expired bigint; v_open bigint;
BEGIN
  INSERT INTO public.waiter_calls
    (id, restaurant_id, branch_id, table_id, reason, status, created_at, updated_at)
  VALUES ('02000000-0000-4000-8800-000000000001',
          '02000000-0000-4000-8000-000000000001',
          '02000000-0000-4000-8100-000000000001',
          '02000000-0000-4000-8400-000000000012',
          'call_waiter', 'pending', now() - interval '40 minutes', now() - interval '40 minutes');
  UPDATE public.tables SET last_waiter_call_at = now() - interval '40 minutes'
   WHERE id = '02000000-0000-4000-8400-000000000012';

  BEGIN
    v := qros_t02.call_json(NULL, 'anon',
      $q$SELECT public.public_call_waiter('T02TOK0000000000000012','request_bill')$q$);
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;

  PERFORM qros_t02.assert(
    'waiter call: an ABANDONED open call does not wedge the table forever (F16)',
    v IS NOT NULL AND v ->> 'status' = 'pending', COALESCE(v::text, 'refused'));

  SELECT count(*) FILTER (WHERE status = 'expired'),
         count(*) FILTER (WHERE status IN ('pending','acknowledged'))
  INTO v_expired, v_open
  FROM public.waiter_calls WHERE table_id = '02000000-0000-4000-8400-000000000012';

  PERFORM qros_t02.assert('waiter call: the abandoned call was retired as ''expired''',
    v_expired = 1 AND (SELECT status FROM public.waiter_calls
                        WHERE id = '02000000-0000-4000-8800-000000000001') = 'expired',
    format('%s expired', v_expired));
  PERFORM qros_t02.assert('waiter call: exactly one call is open again afterwards',
    v_open = 1, format('%s open', v_open));
END $t$;

-- 9.5 — the same, for a call a waiter acknowledged and then walked away from.
DO $t$
DECLARE v jsonb;
BEGIN
  INSERT INTO public.waiter_calls
    (restaurant_id, branch_id, table_id, reason, status,
     acknowledged_at, created_at, updated_at)
  VALUES ('02000000-0000-4000-8000-000000000001',
          '02000000-0000-4000-8100-000000000001',
          '02000000-0000-4000-8400-000000000016',
          'call_waiter', 'acknowledged',
          now() - interval '99 minutes', now() - interval '99 minutes',
          now() - interval '99 minutes');
  UPDATE public.tables SET last_waiter_call_at = now() - interval '99 minutes'
   WHERE id = '02000000-0000-4000-8400-000000000016';

  BEGIN
    v := qros_t02.call_json(NULL, 'anon',
      $q$SELECT public.public_call_waiter('T02TOK0000000000000016','clean_table')$q$);
  EXCEPTION WHEN OTHERS THEN
    v := NULL;
  END;

  PERFORM qros_t02.assert(
    'waiter call: an ACKNOWLEDGED-then-abandoned call also ages out',
    v IS NOT NULL AND v ->> 'status' = 'pending', COALESCE(v::text, 'refused'));
END $t$;

-- 9.6 — F13, restated as a property of this part: the clocks the cooldown reads
--       and the token the whole API is keyed on are SERVER-OWNED. A client that
--       could clear last_waiter_call_at could hold the doorbell down all night.
--
--       Two independent layers can refuse this today — the column-level UPDATE
--       grant (42501) and trg_tables_guard (PT403 QR053_IMMUTABLE_COLUMN) — and
--       which one speaks first is an implementation detail. The assertion is
--       that the write is refused AND the value does not move; the mechanism is
--       recorded in the detail column so a change of layer is visible.
SELECT qros_t02.expect_error(
  'F13: a MANAGER cannot reset the per-table cooldown clocks (any layer)',
  $q$UPDATE public.tables
        SET last_waiter_call_at = NULL, last_order_at = NULL
      WHERE id = '02000000-0000-4000-8400-000000000011'$q$,
  NULL, NULL, '02000000-0000-4000-8500-000000000002', 'authenticated');

SELECT qros_t02.expect_error(
  'F13: a MANAGER cannot hand-pick a QR token (any layer)',
  $q$UPDATE public.tables SET qr_token = 'aaaaaaaaaaaaaaaaaaaaaa'
      WHERE id = '02000000-0000-4000-8400-000000000011'$q$,
  NULL, NULL, '02000000-0000-4000-8500-000000000002', 'authenticated');

DO $t$
DECLARE v public.tables%ROWTYPE;
BEGIN
  SELECT * INTO v FROM public.tables WHERE id = '02000000-0000-4000-8400-000000000011';
  PERFORM qros_t02.assert('F13: the cooldown clock still holds the value the server wrote',
    v.last_waiter_call_at IS NOT NULL, format('%s', v.last_waiter_call_at));
  PERFORM qros_t02.assert('F13: the QR token is unchanged and is not the attacker''s string',
    v.qr_token = 'T02TOK0000000000000011', v.qr_token);
END $t$;


-- =============================================================================
-- PART 10 — REQUEST-SCOPED STATE, AND THE DEFERRED INVARIANTS
--
-- Every assertion above went through qros_t02.run_as(), which clears the
-- request-scoped GUCs first. This part removes that scaffolding and looks at
-- what the RPCs actually leave behind in the session, because the scaffolding is
-- only honest if the thing it hides is written down.
-- =============================================================================
UPDATE qros_t02.part SET cur = '10. request-scoped state';

DO $t$
DECLARE
  v_doc  jsonb;
  v_leak text;
  v_kind public.actor_kind;
  v_ord  uuid;
BEGIN
  PERFORM qros_t02.reset_request();

  -- Deliberately NOT via run_as(): this reproduces what happens if ONE
  -- transaction ever performs a guest order and a staff transition back to back.
  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  SELECT public.public_place_order(
           'T02TOK0000000000000005',
           '[{"menu_item_id":"02000000-0000-4000-8300-000000000002","quantity":1}]'::jsonb,
           NULL, NULL)
    INTO v_doc;
  RESET ROLE;

  v_leak := COALESCE(current_setting('app.actor_kind', true), '');

  PERFORM qros_t02.assert(
    'public_place_order leaves app.guard_bypass cleared',
    COALESCE(current_setting('app.guard_bypass', true), '') = '',
    format('app.guard_bypass=%L', current_setting('app.guard_bypass', true)));

  SELECT id INTO v_ord FROM public.orders WHERE public_code = v_doc ->> 'public_code';

  -- Now a staff transition in the SAME transaction, with no reset in between.
  PERFORM set_config('request.jwt.claims',
    '{"sub":"02000000-0000-4000-8500-000000000003","role":"authenticated"}', true);
  SET LOCAL ROLE authenticated;
  UPDATE public.orders SET status = 'confirmed' WHERE id = v_ord;
  RESET ROLE;

  SELECT changed_by_kind INTO v_kind
  FROM public.order_status_history
  WHERE order_id = v_ord AND new_status = 'confirmed'
  ORDER BY created_at DESC, id DESC LIMIT 1;

  -- ---------------------------------------------------------------------------
  -- DECLARED GAP — public_place_order sets app.actor_kind = 'customer' with
  -- set_config(..., is_local => true), which lasts to the end of the TRANSACTION,
  -- not to the end of the function (20260901001300_public_api.sql §7 step 7).
  -- PostgREST gives every request its own transaction, so no real client can
  -- chain a guest order and a staff transition into one — which is why this is
  -- recorded as a gap and not as an exploit. It is still a latent forgery
  -- vector for any future server-side code that batches the two, and the fix is
  -- one line: reset the three app.actor_* GUCs before public_place_order
  -- returns, the way it already resets app.guard_bypass.
  -- ---------------------------------------------------------------------------
  IF v_leak <> '' THEN
    PERFORM qros_t02.record(
      'declared gap: public_place_order leaks app.actor_kind past its own frame',
      'GAP', format('app.actor_kind is still %L after the RPC returned; '
                    || 'a staff transition batched into the same transaction '
                    || 'was logged as changed_by_kind=%L', v_leak, v_kind));
  ELSE
    PERFORM qros_t02.assert('public_place_order leaves app.actor_kind cleared',
      true, 'no leak — remove this declared gap');
    PERFORM qros_t02.assert(
      'a staff transition in the same transaction is still attributed to staff',
      v_kind = 'staff', format('kind=%s', v_kind));
  END IF;

  PERFORM qros_t02.reset_request();
END $t$;

-- The deferred constraint triggers (trg_orders_totals_consistent / ORD02, ORD03)
-- normally fire at COMMIT, and this file never commits. Force them now, or every
-- order written above would be untested arithmetic.
DO $t$
DECLARE v_state text; v_msg text;
BEGIN
  BEGIN
    SET CONSTRAINTS ALL IMMEDIATE;
    PERFORM qros_t02.record('deferred integrity holds for every order written above',
      'PASS', NULL);
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
    PERFORM qros_t02.record('deferred integrity holds for every order written above',
      'FAIL', format('%s %s', v_state, v_msg));
  END;
END $t$;

-- Nothing above may have moved money on an existing order: re-derive every
-- fixture order's totals from its own lines and its own snapshotted rate.
DO $t$
DECLARE v_bad text;
BEGIN
  SELECT string_agg(format('%s: subtotal %s vs lines %s, fee %s vs %s',
           o.public_code, o.subtotal, x.line_sum, o.service_fee, x.want_fee), '; ')
  INTO v_bad
  FROM public.orders o
  CROSS JOIN LATERAL (
    SELECT COALESCE(sum(oi.total), 0)::bigint AS line_sum,
           round((COALESCE(sum(oi.total), 0)::numeric * o.service_fee_bps) / 10000)::bigint AS want_fee
    FROM public.order_items oi WHERE oi.order_id = o.id) x
  WHERE o.restaurant_id = '02000000-0000-4000-8000-000000000001'
    AND (o.subtotal <> x.line_sum
         OR o.service_fee <> x.want_fee
         OR o.total <> o.subtotal - o.discount_total + o.service_fee);

  PERFORM qros_t02.assert('every order''s totals still re-derive from its own lines',
    v_bad IS NULL, COALESCE(v_bad, 'all consistent'));
END $t$;


-- =============================================================================
-- SUMMARY
-- =============================================================================
\pset tuples_only off
\pset footer on

\echo ''
\echo '-- results by part ---------------------------------------------------'
SELECT part,
       count(*) FILTER (WHERE status = 'PASS') AS pass,
       count(*) FILTER (WHERE status = 'FAIL') AS fail,
       count(*) FILTER (WHERE status = 'GAP')  AS gap
FROM qros_t02.results
GROUP BY part
ORDER BY part;

\echo ''
\echo '-- declared gaps (spec deviations that do not fail the build) ---------'
SELECT part, name, detail FROM qros_t02.results WHERE status = 'GAP' ORDER BY seq;

\echo ''
\echo '-- failures ----------------------------------------------------------'
SELECT part, name, detail FROM qros_t02.results WHERE status = 'FAIL' ORDER BY seq;

DO $summary$
DECLARE v_pass int; v_fail int; v_gap int;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'PASS'),
         count(*) FILTER (WHERE status = 'FAIL'),
         count(*) FILTER (WHERE status = 'GAP')
  INTO v_pass, v_fail, v_gap
  FROM qros_t02.results;

  RAISE NOTICE '02-public-api-and-state-machine.sql: % passed, % failed, % declared gap(s)',
    v_pass, v_fail, v_gap;

  IF v_fail > 0 THEN
    RAISE EXCEPTION
      '02-public-api-and-state-machine.sql FAILED: % of % assertions did not hold',
      v_fail, v_pass + v_fail
      USING HINT = 'see the failures table printed immediately above';
  END IF;
END $summary$;

-- The suite owns nothing: every row it created goes away with this ROLLBACK, so
-- verify.sh's database is exactly as it was before the file ran.
ROLLBACK;

DO $clean$
DECLARE v_left bigint;
BEGIN
  SELECT count(*) INTO v_left FROM public.restaurants WHERE slug LIKE 't02-%';
  IF v_left <> 0 THEN
    RAISE EXCEPTION '02-public-api-and-state-machine.sql left % fixture row(s) behind', v_left;
  END IF;
  RAISE NOTICE 'PASS  fixture fully rolled back (0 rows left behind)';
END $clean$;

\echo '== 02-public-api-and-state-machine.sql: done ========================='
\echo ''
