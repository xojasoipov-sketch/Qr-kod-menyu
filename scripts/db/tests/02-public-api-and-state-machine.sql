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
--   GAP   the database is more RESTRICTIVE than the spec (it refuses something
--         §3.17 permits). Not a security hole, so it does not fail the build,
--         but it is printed loudly and enumerated in a hard-coded list below —
--         an undeclared restriction is a FAIL, and a GAP that has been fixed is
--         reported too, so the list cannot rot silently.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off

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

-- Impersonate a PostgREST request. p_dbrole NULL leaves the superuser session
-- alone (fixture work); 'anon' / 'authenticated' switch role AND install the
-- JWT claims that auth.uid() reads.
CREATE FUNCTION qros_t02.run_as(p_uid uuid, p_dbrole text, p_sql text)
RETURNS integer LANGUAGE plpgsql AS $fn$
DECLARE v_rows integer;
BEGIN
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
  PERFORM set_config('request.jwt.claims', '', true);
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
  IF p_dbrole IS NOT NULL THEN
    PERFORM set_config('request.jwt.claims',
      CASE WHEN p_uid IS NULL THEN ''
           ELSE json_build_object('sub', p_uid::text, 'role', p_dbrole)::text END,
      true);
    EXECUTE format('SET LOCAL ROLE %I', p_dbrole);
  END IF;
  EXECUTE p_sql INTO v;
  RESET ROLE;
  PERFORM set_config('request.jwt.claims', '', true);
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

INSERT INTO public.menu_categories (id, restaurant_id, branch_id, name, is_active)
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

SELECT qros_t02.record('fixture built', 'PASS',
  format('%s restaurants / %s tables / %s staff',
    (SELECT count(*) FROM public.restaurants WHERE slug LIKE 't02-%'),
    (SELECT count(*) FROM public.tables WHERE qr_token LIKE 'T02TOK%'),
    (SELECT count(*) FROM public.staff  WHERE restaurant_id = '02000000-0000-4000-8000-000000000001')));
