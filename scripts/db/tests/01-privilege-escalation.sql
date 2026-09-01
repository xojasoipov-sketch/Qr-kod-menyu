-- =============================================================================
-- Restaurant QR OS — executable security test 01: PRIVILEGE ESCALATION
--
-- Run:
--     source scripts/db/local-env.sh && ./scripts/db/verify.sh --keep
--
-- verify.sh applies the whole migration chain to a throwaway database and then
-- runs every file in scripts/db/tests/ with psql -v ON_ERROR_STOP=1. This file
-- therefore exits non-zero — and fails the chain — the moment an exploit that
-- MUST be refused succeeds, or a legitimate operation that MUST be permitted is
-- refused.
--
-- WHAT THIS FILE IS
-- -----------------
-- It is an adversary, not a regression suite for the fixes. It does not read
-- the guard triggers, the column GRANTs or the RLS policies and assert that
-- they exist; it seeds a real tenant, impersonates real staff accounts exactly
-- the way PostgREST does, issues the nine documented attacks from
-- docs/audit/01-database-findings.md (F05, F06, F07, F09, F11, F13) as if they
-- arrived over the wire, and then re-reads the rows as superuser to prove
-- nothing moved. A defence that is present but does not bite is a FAIL here.
--
-- HOW IMPERSONATION WORKS
-- -----------------------
-- PostgREST parses the JWT, does
--     SELECT set_config('request.jwt.claims', '<claims json>', true);
--     SET LOCAL ROLE authenticated;
-- and then runs the statement. Each case below reproduces exactly that, inside
-- a subtransaction, so the attacker's privileges, the `role` GUC that
-- app_private.guard_actor_is_exempt() reads, and auth.uid() are all identical
-- to a live request. Running the statement as the superuser that applies the
-- migrations would prove nothing: that connection is exempt from every guard by
-- design.
--
-- WHY EVERY CASE IS ROLLED BACK
-- -----------------------------
-- Each attempt runs inside a plpgsql BEGIN ... EXCEPTION block, which is a
-- savepoint. Whether the statement is refused or succeeds, the block always
-- ends by raising, so the subtransaction is rolled back and the next case sees
-- the pristine fixture. A successful exploit is recorded, never committed.
--
-- REFUSED HOW, NOT JUST REFUSED
-- -----------------------------
-- Every refusal is classified by the layer that produced it:
--     GRANT   — 42501 "permission denied for table X" (a column/table ACL)
--     RLS     — 42501 "new row violates row-level security policy", or an
--               UPDATE/DELETE that matched 0 rows
--     TRIGGER — PT403/PT409 QR0xx from a §3.18 guard trigger
-- Six cases are run twice: once as the wire sees them, and once with the
-- missing column privilege temporarily GRANTed inside the savepoint, which
-- strips the ACL layer away and forces the guard trigger to answer on its own.
-- That is what turns "refused" into "refused in depth", and it is the only way
-- to notice that one of two layers has quietly stopped working.
--
-- IDEMPOTENCY AND CLEANUP
-- -----------------------
-- All fixture rows use fixed 7e57xxxx ("test") UUIDs and a dedicated slug /
-- e-mail domain. The file deletes them before seeding and again at the end, so
-- it can be run any number of times against the same database, and leaves it
-- exactly as it found it. The result ledger lives in a TEMP table, which is why
-- the per-case rollbacks cannot erase it.
-- =============================================================================

\set ON_ERROR_STOP on
\pset pager off
\timing off

-- -----------------------------------------------------------------------------
-- §0. Preconditions
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT (SELECT rolsuper OR rolbypassrls FROM pg_catalog.pg_roles
          WHERE rolname = session_user) THEN
    RAISE EXCEPTION
      'test 01 must run on a superuser/BYPASSRLS connection (it seeds fixtures and reads them back past RLS); session_user is %',
      session_user;
  END IF;
  IF to_regclass('public.staff') IS NULL OR to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION 'test 01: the migration chain has not been applied to this database';
  END IF;
END;
$$;


-- -----------------------------------------------------------------------------
-- §0b. Teardown, used both before seeding (idempotency) and at the end
--      (cleanup). It is a function so the two are guaranteed identical.
--
-- public.order_status_history and public.qr_token_history are append-only:
-- trg_*_immutable / forbid_mutation() refuses DELETE even for a superuser, and
-- that refusal fires on the CASCADE from orders and tables, not just on a direct
-- DELETE. The fixture rows are purged with those two triggers momentarily
-- disabled and unconditionally re-enabled afterwards; nothing outside the
-- 7e57xxxx fixture is touched, and the triggers are back in force before the
-- function returns even if a DELETE raises.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pg_temp.qros_pe_teardown()
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  ALTER TABLE public.order_status_history DISABLE TRIGGER trg_order_status_history_immutable;
  ALTER TABLE public.qr_token_history     DISABLE TRIGGER trg_qr_token_history_immutable;
  BEGIN
    DELETE FROM public.order_status_history
      WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001';
    DELETE FROM public.qr_token_history
      WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001';
    -- orders before branches: fk_orders_branch is ON DELETE RESTRICT.
    DELETE FROM public.orders
      WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001';
    DELETE FROM public.restaurants WHERE slug = 'qros-privesc-a';
    DELETE FROM auth.users         WHERE email LIKE '%@qros-priv-esc.test';
  EXCEPTION WHEN OTHERS THEN
    ALTER TABLE public.order_status_history ENABLE TRIGGER trg_order_status_history_immutable;
    ALTER TABLE public.qr_token_history     ENABLE TRIGGER trg_qr_token_history_immutable;
    RAISE;
  END;
  ALTER TABLE public.order_status_history ENABLE TRIGGER trg_order_status_history_immutable;
  ALTER TABLE public.qr_token_history     ENABLE TRIGGER trg_qr_token_history_immutable;
END;
$fn$;



-- =============================================================================
-- §1. Fixture — one tenant, one branch, the four staff roles, one of everything
--     the nine attacks need to bite on.
-- =============================================================================

-- psql runs in autocommit, so the seed must be one explicit transaction:
-- trg_orders_totals_consistent is a DEFERRABLE INITIALLY DEFERRED constraint
-- trigger and would fire at the end of a bare INSERT INTO orders, before the
-- matching order_items row exists.
BEGIN;

-- Idempotent teardown of any previous run.
SELECT pg_temp.qros_pe_teardown();

INSERT INTO public.restaurants (id, name, slug, service_fee_bps, service_fee_enabled)
VALUES ('7e57a000-0000-4000-8000-000000000001', 'PrivEsc Fixture', 'qros-privesc-a', 1000, true);

INSERT INTO public.branches (id, restaurant_id, name, code)
VALUES ('7e57b000-0000-4000-8000-000000000001',
        '7e57a000-0000-4000-8000-000000000001', 'Main', 'A');

-- profiles are created by trg_auth_user_created / handle_new_auth_user().
INSERT INTO auth.users (id, email) VALUES
  ('7e57c000-0000-4000-8000-000000000001', 'owner@qros-priv-esc.test'),
  ('7e57c000-0000-4000-8000-000000000002', 'manager@qros-priv-esc.test'),
  ('7e57c000-0000-4000-8000-000000000003', 'waiter@qros-priv-esc.test'),
  ('7e57c000-0000-4000-8000-000000000004', 'kitchen@qros-priv-esc.test'),
  ('7e57c000-0000-4000-8000-000000000005', 'accomplice@qros-priv-esc.test');

-- handle_new_auth_user() swallows every error into a WARNING (F04's fix), so a
-- missing profile would silently turn every case below into a vacuous pass.
DO $$
DECLARE v_n integer;
BEGIN
  SELECT count(*) INTO v_n FROM public.profiles
  WHERE id::text LIKE '7e57c000-0000-4000-8000-%';
  IF v_n <> 5 THEN
    RAISE EXCEPTION 'fixture: expected 5 profiles from handle_new_auth_user(), got % - the rest of this file would test nothing', v_n;
  END IF;
END;
$$;

INSERT INTO public.staff (id, restaurant_id, branch_id, profile_id, role) VALUES
  ('7e57d000-0000-4000-8000-000000000001', '7e57a000-0000-4000-8000-000000000001',
   NULL,                                   '7e57c000-0000-4000-8000-000000000001', 'RESTAURANT_OWNER'),
  ('7e57d000-0000-4000-8000-000000000002', '7e57a000-0000-4000-8000-000000000001',
   '7e57b000-0000-4000-8000-000000000001', '7e57c000-0000-4000-8000-000000000002', 'MANAGER'),
  ('7e57d000-0000-4000-8000-000000000003', '7e57a000-0000-4000-8000-000000000001',
   '7e57b000-0000-4000-8000-000000000001', '7e57c000-0000-4000-8000-000000000003', 'WAITER'),
  ('7e57d000-0000-4000-8000-000000000004', '7e57a000-0000-4000-8000-000000000001',
   '7e57b000-0000-4000-8000-000000000001', '7e57c000-0000-4000-8000-000000000004', 'KITCHEN');

INSERT INTO public.tables (id, restaurant_id, branch_id, number, qr_token,
                           last_order_at, last_waiter_call_at)
VALUES ('7e57e000-0000-4000-8000-000000000001',
        '7e57a000-0000-4000-8000-000000000001',
        '7e57b000-0000-4000-8000-000000000001',
        '1', 'PrivEscFixtureTokenAAAAA',
        -- The §5.2/§5.3 cooldown clocks MUST be seeded non-NULL. trg_tables_guard
        -- compares OLD to NEW, so "reset the clocks to NULL" on an already-NULL
        -- clock is not a change and would pass the guard for the wrong reason.
        now() - interval '5 minutes',
        now() - interval '5 minutes');

INSERT INTO public.menu_categories (id, restaurant_id, name) VALUES
  ('7e57f000-0000-4000-8000-000000000001', '7e57a000-0000-4000-8000-000000000001', '{"uz":"Salatlar"}'),
  ('7e57f000-0000-4000-8000-000000000002', '7e57a000-0000-4000-8000-000000000001', '{"uz":"Ichimliklar"}');

-- branch_id is set so that menu_items_update_menu_or_kitchen's KITCHEN arm
-- (auth_role_in_branch(branch_id) = 'KITCHEN') actually admits the row; with a
-- restaurant-wide dish the kitchen attacks would be refused by RLS and the
-- column rules in trg_menu_items_guard would never be exercised.
INSERT INTO public.menu_items (id, restaurant_id, branch_id, category_id, name, price)
VALUES ('7e570000-0000-4000-8000-000000000001',
        '7e57a000-0000-4000-8000-000000000001',
        '7e57b000-0000-4000-8000-000000000001',
        '7e57f000-0000-4000-8000-000000000001',
        '{"uz":"Olivye"}', 50000);

-- 50 000 subtotal + 10.00% service fee = 55 000 total, backed by one line so
-- the deferred trg_orders_totals_consistent is satisfiable.
INSERT INTO public.orders (id, restaurant_id, branch_id, table_id, customer_session_id,
                           subtotal, discount_total, service_fee, total, status)
VALUES ('7e571000-0000-4000-8000-000000000001',
        '7e57a000-0000-4000-8000-000000000001',
        '7e57b000-0000-4000-8000-000000000001',
        '7e57e000-0000-4000-8000-000000000001',
        '7e574000-0000-4000-8000-000000000001',
        50000, 0, 5000, 55000, 'pending');

INSERT INTO public.order_items (id, restaurant_id, order_id, menu_item_id,
                                name_snapshot, price_snapshot, quantity)
VALUES ('7e572000-0000-4000-8000-000000000001',
        '7e57a000-0000-4000-8000-000000000001',
        '7e571000-0000-4000-8000-000000000001',
        '7e570000-0000-4000-8000-000000000001',
        '{"uz":"Olivye"}', 50000, 1);

-- target_staff_id IS NULL: the broadcast shape that satisfies
-- notifications_update_addressee for every member of the branch (F11).
INSERT INTO public.notifications (id, restaurant_id, branch_id, target_role, type, payload)
VALUES ('7e573000-0000-4000-8000-000000000001',
        '7e57a000-0000-4000-8000-000000000001',
        '7e57b000-0000-4000-8000-000000000001',
        'KITCHEN', 'order_created', '{"order_number":"A-001"}');

-- Surface any deferred-constraint problem here, in the fixture, rather than
-- three hundred lines later inside a case.
SET CONSTRAINTS ALL IMMEDIATE;

COMMIT;


-- =============================================================================
-- §2. The harness
-- =============================================================================

DROP TABLE IF EXISTS pg_temp.qros_pe_results;
CREATE TEMP TABLE pg_temp.qros_pe_results (
  seq        serial PRIMARY KEY,
  case_id    text NOT NULL,
  label      text NOT NULL,
  expected   text NOT NULL,          -- 'refused' | 'allowed'
  status     text NOT NULL,          -- 'PASS' | 'FAIL'
  defence    text,                   -- GRANT | RLS | TRIGGER | none
  detail     text,
  statement  text NOT NULL
);

-- Classify a refusal by the layer that produced it. This is what makes a
-- silently-removed guard trigger visible even while the column ACL still holds.
CREATE OR REPLACE FUNCTION pg_temp.qros_pe_defence(p_sqlstate text, p_msg text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
  SELECT CASE
    WHEN p_sqlstate IS NULL                                      THEN 'none'
    WHEN p_msg LIKE 'QR0%'                                       THEN 'TRIGGER'
    WHEN p_sqlstate IN ('PT403','PT409','PT404','PT400','PT422') THEN 'TRIGGER'
    WHEN p_msg LIKE '%row-level security%'                       THEN 'RLS'
    WHEN p_sqlstate = '42501'                                    THEN 'GRANT'
    ELSE 'OTHER(' || p_sqlstate || ')'
  END;
$fn$;

-- The impersonating executor.
--
--   p_setup   optional DDL run as the SUPERUSER inside the same savepoint,
--             before the role switch. Used only to widen a column GRANT so the
--             guard trigger has to answer alone; it is rolled back with
--             everything else.
--   p_sql     the attacker's statement, exactly as PostgREST would emit it.
--   p_expect  'refused' — an error, or an UPDATE/DELETE matching 0 rows.
--             'allowed' — must succeed, touch >= 1 row, and satisfy p_witness.
--   p_witness a boolean query evaluated INSIDE the savepoint (the savepoint is
--             about to be rolled back, so this is the only place the effect of
--             a legitimately-permitted write can be observed).
CREATE OR REPLACE FUNCTION pg_temp.qros_pe_case(
  p_case_id text,
  p_label   text,
  p_uid     uuid,
  p_sql     text,
  p_expect  text          DEFAULT 'refused',
  p_witness text          DEFAULT NULL,
  p_setup   text          DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE
  v_rows     bigint;
  v_state    text;
  v_msg      text;
  v_witness  boolean;
  v_defence  text;
  v_status   text;
  v_detail   text;
BEGIN
  BEGIN                                   -- <-- savepoint
    IF p_setup IS NOT NULL THEN
      EXECUTE p_setup;                    -- still the superuser here
    END IF;

    -- Become the request, the way PostgREST does.
    PERFORM pg_catalog.set_config(
      'request.jwt.claims',
      pg_catalog.jsonb_build_object('sub', p_uid::text, 'role', 'authenticated')::text,
      true);
    PERFORM pg_catalog.set_config('role', 'authenticated', true);

    EXECUTE p_sql;
    GET DIAGNOSTICS v_rows = ROW_COUNT;

    v_witness := NULL;
    IF p_witness IS NOT NULL THEN
      EXECUTE p_witness INTO v_witness;
    END IF;

    -- Always unwind: the statement must never survive this call.
    RAISE EXCEPTION 'QROS_PE_NO_ERROR'
      USING ERRCODE = 'ZX001',
            DETAIL  = v_rows::text || '|' || COALESCE(v_witness::text, 'null');

  EXCEPTION
    WHEN sqlstate 'ZX001' THEN            -- the statement ran without error
      GET STACKED DIAGNOSTICS v_detail = PG_EXCEPTION_DETAIL;
      v_rows    := split_part(v_detail, '|', 1)::bigint;
      v_witness := NULLIF(split_part(v_detail, '|', 2), 'null')::boolean;

      IF p_expect = 'allowed' THEN
        IF v_rows > 0 AND COALESCE(v_witness, true) THEN
          v_status  := 'PASS';
          v_defence := 'none';
          v_detail  := format('permitted, %s row(s)%s', v_rows,
                        CASE WHEN v_witness IS NULL THEN ''
                             ELSE ', effect confirmed' END);
        ELSE
          v_status  := 'FAIL';
          v_defence := 'none';
          v_detail  := format('SHOULD HAVE WORKED: %s row(s), witness %s',
                              v_rows, COALESCE(v_witness::text, 'n/a'));
        END IF;
      ELSIF v_rows = 0 THEN
        -- No error, but the statement matched nothing: RLS filtered every row.
        v_status  := 'PASS';
        v_defence := 'RLS';
        v_detail  := 'no error, but 0 rows matched (row-level security)';
      ELSE
        v_status  := 'FAIL';
        v_defence := 'none';
        v_detail  := format('EXPLOIT SUCCEEDED: %s row(s) written%s', v_rows,
                      CASE WHEN v_witness IS NULL THEN ''
                           ELSE ', witness ' || v_witness::text END);
      END IF;

    WHEN OTHERS THEN                      -- the statement was refused
      GET STACKED DIAGNOSTICS v_state = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
      v_defence := pg_temp.qros_pe_defence(v_state, v_msg);
      v_detail  := format('%s %s', v_state, left(v_msg, 160));
      v_status  := CASE WHEN p_expect = 'refused' THEN 'PASS' ELSE 'FAIL' END;
      IF v_status = 'FAIL' THEN
        v_detail := 'SHOULD HAVE WORKED but was refused: ' || v_detail;
      END IF;
  END;

  INSERT INTO pg_temp.qros_pe_results
    (case_id, label, expected, status, defence, detail, statement)
  VALUES (p_case_id, p_label, p_expect, v_status, v_defence, v_detail,
          regexp_replace(p_sql, '\s+', ' ', 'g'));

  RAISE NOTICE '% % % [%] %',
    rpad(v_status, 4), rpad(p_case_id, 5), rpad(p_label, 58),
    COALESCE(v_defence, '-'), v_detail;
END;
$fn$;

-- Persisted-state assertion, run as the superuser after every case.
CREATE OR REPLACE FUNCTION pg_temp.qros_pe_invariant(p_case_id text, p_label text, p_sql text)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
SET search_path = pg_catalog, pg_temp
AS $fn$
DECLARE v_ok boolean; v_status text; v_detail text;
BEGIN
  BEGIN
    EXECUTE p_sql INTO v_ok;
    v_status := CASE WHEN v_ok THEN 'PASS' ELSE 'FAIL' END;
    v_detail := CASE WHEN v_ok THEN 'fixture row unchanged after every attempt'
                     ELSE 'STATE WAS MUTATED - an attempt above took effect' END;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_detail = MESSAGE_TEXT;
    v_status := 'FAIL';
    v_detail := 'invariant query failed: ' || v_detail;
  END;
  INSERT INTO pg_temp.qros_pe_results
    (case_id, label, expected, status, defence, detail, statement)
  VALUES (p_case_id, p_label, 'invariant', v_status, 'n/a', v_detail,
          regexp_replace(p_sql, '\s+', ' ', 'g'));
  RAISE NOTICE '% % % [%] %',
    rpad(v_status, 4), rpad(p_case_id, 5), rpad(p_label, 58), 'inv', v_detail;
END;
$fn$;

\echo ''
\echo '=== 01-privilege-escalation ==================================================='
\echo ''


-- =============================================================================
-- §3. POSITIVE CONTROLS
--
-- Every one of these must SUCCEED. Without them a chain that simply revoked
-- everything from `authenticated` would score a perfect green below while
-- having destroyed the product. They also prove that each fixture row really is
-- reachable by the attacking role, so that a refusal further down is a defence
-- doing its job rather than a badly built fixture.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('P1',
    'KITCHEN edits own profiles.full_name',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.profiles SET full_name = 'Oshpaz Aziz'
       WHERE id = '7e57c000-0000-4000-8000-000000000004'$q$,
    'allowed',
    $w$SELECT full_name = 'Oshpaz Aziz' FROM public.profiles
       WHERE id = '7e57c000-0000-4000-8000-000000000004'$w$);

  PERFORM pg_temp.qros_pe_case('P2',
    'MANAGER hires a WAITER (legitimate staff management)',
    '7e57c000-0000-4000-8000-000000000002',
    $q$INSERT INTO public.staff (restaurant_id, branch_id, profile_id, role)
       VALUES ('7e57a000-0000-4000-8000-000000000001',
               '7e57b000-0000-4000-8000-000000000001',
               '7e57c000-0000-4000-8000-000000000005', 'WAITER')$q$,
    'allowed',
    $w$SELECT count(*) = 1 FROM public.staff
       WHERE profile_id = '7e57c000-0000-4000-8000-000000000005' AND role = 'WAITER'$w$);

  PERFORM pg_temp.qros_pe_case('P3',
    'WAITER drives the order pending -> confirmed',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders SET status = 'confirmed'
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$,
    'allowed',
    $w$SELECT status = 'confirmed' AND total = 55000 FROM public.orders
       WHERE id = '7e571000-0000-4000-8000-000000000001'$w$);

  PERFORM pg_temp.qros_pe_case('P4',
    'MANAGER renames a table',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.tables SET name = 'Terrace 1'
       WHERE id = '7e57e000-0000-4000-8000-000000000001'$q$,
    'allowed',
    $w$SELECT name = 'Terrace 1' AND qr_token = 'PrivEscFixtureTokenAAAAA'
       FROM public.tables WHERE id = '7e57e000-0000-4000-8000-000000000001'$w$);

  PERFORM pg_temp.qros_pe_case('P5',
    'KITCHEN can read the broadcast notification (read path alive)',
    '7e57c000-0000-4000-8000-000000000004',
    $q$CREATE TEMP TABLE qros_pe_seen AS
       SELECT id FROM public.notifications
       WHERE id = '7e573000-0000-4000-8000-000000000001'$q$,
    'allowed',
    $w$SELECT count(*) = 1 FROM qros_pe_seen$w$);
END;
$$;


-- =============================================================================
-- §4. CASE 1 — F05: a KITCHEN account sets its own profiles.is_platform_admin
--
-- The whole tenancy model hangs off this boolean: is_super_admin() reads it and
-- every has_*/can_manage_*/auth_role_in_* helper short-circuits true when it is
-- set, for EVERY tenant in the database. It is one PATCH away from the lowest
-- privileged staff role.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('1a',
    'F05 KITCHEN self-promotes to platform admin',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.profiles SET is_platform_admin = true
       WHERE id = '7e57c000-0000-4000-8000-000000000004'$q$);

  PERFORM pg_temp.qros_pe_case('1b',
    'F05 MANAGER promotes a colleague (profiles_update_manager)',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.profiles SET is_platform_admin = true
       WHERE id = '7e57c000-0000-4000-8000-000000000003'$q$);

  -- profiles_insert_self + the INSERT grant: re-assert your own row with the
  -- flag on, rather than updating it.
  PERFORM pg_temp.qros_pe_case('1c',
    'F05 KITCHEN re-inserts its own profile row carrying the flag',
    '7e57c000-0000-4000-8000-000000000004',
    $q$INSERT INTO public.profiles (id, email, is_platform_admin)
       VALUES ('7e57c000-0000-4000-8000-000000000004', 'kitchen@qros-priv-esc.test', true)
       ON CONFLICT (id) DO UPDATE SET is_platform_admin = true$q$);

  -- Strip the ACL layer: does trg_profiles_guard hold the line by itself?
  PERFORM pg_temp.qros_pe_case('1d',
    'F05 KITCHEN self-promotes with UPDATE(is_platform_admin) GRANTed',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.profiles SET is_platform_admin = true
       WHERE id = '7e57c000-0000-4000-8000-000000000004'$q$,
    'refused', NULL,
    $s$GRANT UPDATE (is_platform_admin) ON public.profiles TO authenticated$s$);

  PERFORM pg_temp.qros_pe_case('1e',
    'F05 MANAGER promotes a colleague with the column GRANTed',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.profiles SET is_platform_admin = true
       WHERE id = '7e57c000-0000-4000-8000-000000000003'$q$,
    'refused', NULL,
    $s$GRANT UPDATE (is_platform_admin) ON public.profiles TO authenticated$s$);
END;
$$;


-- =============================================================================
-- §5. CASE 2 — F06 exploit 1: a MANAGER INSERTs a staff row minting an owner
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('2a',
    'F06 MANAGER inserts a RESTAURANT_OWNER row for itself',
    '7e57c000-0000-4000-8000-000000000002',
    $q$INSERT INTO public.staff (restaurant_id, branch_id, profile_id, role)
       VALUES ('7e57a000-0000-4000-8000-000000000001', NULL,
               '7e57c000-0000-4000-8000-000000000002', 'RESTAURANT_OWNER')$q$);

  PERFORM pg_temp.qros_pe_case('2b',
    'F06 MANAGER inserts a RESTAURANT_OWNER row for an accomplice',
    '7e57c000-0000-4000-8000-000000000002',
    $q$INSERT INTO public.staff (restaurant_id, branch_id, profile_id, role)
       VALUES ('7e57a000-0000-4000-8000-000000000001', NULL,
               '7e57c000-0000-4000-8000-000000000005', 'RESTAURANT_OWNER')$q$);

  PERFORM pg_temp.qros_pe_case('2c',
    'F06 MANAGER mints a second MANAGER (equal rank)',
    '7e57c000-0000-4000-8000-000000000002',
    $q$INSERT INTO public.staff (restaurant_id, branch_id, profile_id, role)
       VALUES ('7e57a000-0000-4000-8000-000000000001',
               '7e57b000-0000-4000-8000-000000000001',
               '7e57c000-0000-4000-8000-000000000005', 'MANAGER')$q$);

  PERFORM pg_temp.qros_pe_case('2d',
    'F06 KITCHEN inserts a RESTAURANT_OWNER row for itself',
    '7e57c000-0000-4000-8000-000000000004',
    $q$INSERT INTO public.staff (restaurant_id, branch_id, profile_id, role)
       VALUES ('7e57a000-0000-4000-8000-000000000001', NULL,
               '7e57c000-0000-4000-8000-000000000004', 'RESTAURANT_OWNER')$q$);
END;
$$;


-- =============================================================================
-- §6. CASE 3 — F06 exploit 2: a MANAGER promotes its own staff.role
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('3a',
    'F06 MANAGER PATCHes own membership to RESTAURANT_OWNER',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.staff SET role = 'RESTAURANT_OWNER', branch_id = NULL
       WHERE id = '7e57d000-0000-4000-8000-000000000002'$q$);

  PERFORM pg_temp.qros_pe_case('3b',
    'F06 MANAGER promotes a WAITER to MANAGER',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.staff SET role = 'MANAGER'
       WHERE id = '7e57d000-0000-4000-8000-000000000003'$q$);

  PERFORM pg_temp.qros_pe_case('3c',
    'F06 WAITER promotes itself to MANAGER',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.staff SET role = 'MANAGER'
       WHERE id = '7e57d000-0000-4000-8000-000000000003'$q$);

  -- Identity theft rather than promotion: repoint an existing low-rank row at
  -- another human, or at another tenant.
  PERFORM pg_temp.qros_pe_case('3d',
    'F06 MANAGER repoints a staff row at another profile',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.staff SET profile_id = '7e57c000-0000-4000-8000-000000000005'
       WHERE id = '7e57d000-0000-4000-8000-000000000003'$q$);
END;
$$;


-- =============================================================================
-- §7. CASE 4 — F06 exploit 3: removing or demoting the LAST RESTAURANT_OWNER
--
-- Every route to an ownerless tenant, direct and indirect. The invariant that
-- actually matters is asserted in §12: the restaurant still has an active
-- RESTAURANT_OWNER when the dust settles.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('4a',
    'F06 MANAGER DELETEs every RESTAURANT_OWNER row',
    '7e57c000-0000-4000-8000-000000000002',
    $q$DELETE FROM public.staff
       WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001'
         AND role = 'RESTAURANT_OWNER'$q$);

  PERFORM pg_temp.qros_pe_case('4b',
    'F06 MANAGER deactivates the last owner (is_active = false)',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.staff SET is_active = false
       WHERE id = '7e57d000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('4c',
    'F06 MANAGER demotes the last owner to MANAGER',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.staff SET role = 'MANAGER',
                               branch_id = '7e57b000-0000-4000-8000-000000000001'
       WHERE id = '7e57d000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('4d',
    'F06 the sole OWNER deletes its own membership',
    '7e57c000-0000-4000-8000-000000000001',
    $q$DELETE FROM public.staff WHERE id = '7e57d000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('4e',
    'F06 the sole OWNER demotes itself',
    '7e57c000-0000-4000-8000-000000000001',
    $q$UPDATE public.staff SET role = 'MANAGER',
                               branch_id = '7e57b000-0000-4000-8000-000000000001'
       WHERE id = '7e57d000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('4f',
    'F06 the sole OWNER deactivates itself',
    '7e57c000-0000-4000-8000-000000000001',
    $q$UPDATE public.staff SET is_active = false
       WHERE id = '7e57d000-0000-4000-8000-000000000001'$q$);

  -- Indirect: reach the owner row through a cascade instead of touching it.
  PERFORM pg_temp.qros_pe_case('4g',
    'F06 MANAGER deletes the restaurant to cascade the owner away',
    '7e57c000-0000-4000-8000-000000000002',
    $q$DELETE FROM public.restaurants
       WHERE id = '7e57a000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('4h',
    'F06 MANAGER deletes the branch to cascade staff away',
    '7e57c000-0000-4000-8000-000000000002',
    $q$DELETE FROM public.branches
       WHERE id = '7e57b000-0000-4000-8000-000000000001'$q$);

  -- Same three attacks with the whole staff column ACL widened, so only
  -- trg_staff_guard is left standing. (DELETE has no column-level form at all,
  -- so 4a/4d already exercise the trigger alone.)
  PERFORM pg_temp.qros_pe_case('4i',
    'F06 MANAGER demotes the last owner, staff columns GRANTed',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.staff SET role = 'MANAGER',
                               branch_id = '7e57b000-0000-4000-8000-000000000001'
       WHERE id = '7e57d000-0000-4000-8000-000000000001'$q$,
    'refused', NULL,
    $s$GRANT UPDATE ON public.staff TO authenticated$s$);
END;
$$;


-- =============================================================================
-- §8. CASE 5 — F09: a KITCHEN account rewrites the menu
--
-- menu_items.price is the ONLY authoritative price; public_place_order snapshots
-- it inside a SECURITY DEFINER pricing loop, so "the server prices the order"
-- is worth nothing if the lowest-privileged staff role can edit the source.
--
-- Note that the column GRANT cannot help here: price, name and category_id are
-- legitimately writable by a MANAGER, a column ACL cannot vary by app_role, and
-- menu_items_update_menu_or_kitchen admits KITCHEN for the whole row. Every
-- refusal below must therefore come from trg_menu_items_guard.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('5a',
    'F09 KITCHEN sets price = 1',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET price = 1
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('5b',
    'F09 KITCHEN rewrites the dish name',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET name = '{"uz":"Bepul"}'
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  -- The second category exists precisely so this is a real change: a
  -- whole-row jsonb diff sees nothing when a column is set to its own value.
  PERFORM pg_temp.qros_pe_case('5c',
    'F09 KITCHEN moves the dish to another category',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET category_id = '7e57f000-0000-4000-8000-000000000002'
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('5d',
    'F09 KITCHEN rewrites compare_at_price',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET compare_at_price = 999999
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('5e',
    'F09 KITCHEN repoints the dish tenancy (branch_id)',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET branch_id = NULL
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('5f',
    'F09 KITCHEN soft-deletes the dish',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET deleted_at = now()
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('5g',
    'F09 KITCHEN hard-DELETEs the dish',
    '7e57c000-0000-4000-8000-000000000004',
    $q$DELETE FROM public.menu_items
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);

  -- app.guard_bypass is an ordinary user-defined GUC and set_config() is
  -- executable by PUBLIC. If a client can ever reach a SET, the menu guard must
  -- still not honour a bypass keyed to this table.
  PERFORM pg_temp.qros_pe_case('5h',
    'F09 KITCHEN sets app.guard_bypass then rewrites price',
    '7e57c000-0000-4000-8000-000000000004',
    $q$SELECT set_config('app.guard_bypass', 'menu_items', true);
       UPDATE public.menu_items SET price = 1
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$);
END;
$$;


-- =============================================================================
-- §9. CASE 6 — the one that MUST still work: KITCHEN 86s a dish
--
-- doc 02 §3.18 gives the kitchen exactly one writable menu column. A guard that
-- refused this too would be a broken product, not a secure one; the first draft
-- of trg_menu_items_guard did precisely that (menu_items.search_vector is a
-- STORED GENERATED column and reads NULL in NEW during a BEFORE trigger, so the
-- whole-row diff always fired). This case is the regression test for that.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('6a',
    'KITCHEN marks the dish unavailable  (MUST SUCCEED)',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.menu_items SET is_available = false
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$,
    'allowed',
    $w$SELECT is_available = false AND price = 50000
       FROM public.menu_items WHERE id = '7e570000-0000-4000-8000-000000000001'$w$);

  PERFORM pg_temp.qros_pe_case('6b',
    'MANAGER reprices the dish            (MUST SUCCEED)',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.menu_items SET price = 60000
       WHERE id = '7e570000-0000-4000-8000-000000000001'$q$,
    'allowed',
    $w$SELECT price = 60000 FROM public.menu_items
       WHERE id = '7e570000-0000-4000-8000-000000000001'$w$);
END;
$$;


-- =============================================================================
-- §10. CASE 7 — F07: staff rewrite order money and order identity
--
-- Bill zeroing survives every CHECK the schema has: with discount_total raised
-- to subtotal, ck_orders_totals_arithmetic holds (0 = S - S + 0),
-- ck_orders_discount_within_subtotal holds, and the deferred
-- trg_orders_totals_consistent recomputes the expected fee as 0 and agrees.
-- Only a column rule can stop it.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('7a',
    'F07 WAITER zeroes the bill (discount = subtotal, fee 0, total 0)',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders
       SET discount_total = subtotal, service_fee = 0, total = 0
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('7b',
    'F07 WAITER drops the subtotal',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders SET subtotal = 0, total = 5000
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('7c',
    'F07 WAITER removes the service charge (fee and bps)',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders SET service_fee = 0, service_fee_bps = 0, total = 50000
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('7d',
    'F07 KITCHEN rewrites the public tracking code',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.orders SET public_code = 'HACKEDCODE1'
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('7e',
    'F07 WAITER moves the order to another table and renumbers it',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders SET table_id = NULL, order_number = 'A-999'
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('7f',
    'F07 KITCHEN back-dates created_at out of the 24h visibility window',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.orders SET created_at = now() - interval '30 days'
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('7g',
    'F07 WAITER forges the idempotency keys',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders SET client_request_id = gen_random_uuid(),
                                payload_fingerprint = 'forged'
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);

  -- ACL stripped: trg_orders_guard alone.
  PERFORM pg_temp.qros_pe_case('7h',
    'F07 WAITER zeroes the bill with the money columns GRANTed',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders
       SET discount_total = subtotal, service_fee = 0, total = 0
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$,
    'refused', NULL,
    $s$GRANT UPDATE (subtotal, discount_total, service_fee, service_fee_bps, total)
       ON public.orders TO authenticated$s$);

  PERFORM pg_temp.qros_pe_case('7i',
    'F07 WAITER rewrites order identity with those columns GRANTed',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.orders SET public_code = 'HACKEDCODE1', order_number = 'A-999'
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$,
    'refused', NULL,
    $s$GRANT UPDATE (public_code, order_number, table_id, created_at)
       ON public.orders TO authenticated$s$);

  -- The bypass GUC the trusted RPCs use. A client must not be able to arm it.
  PERFORM pg_temp.qros_pe_case('7j',
    'F07 WAITER arms app.guard_bypass=orders, then zeroes the bill',
    '7e57c000-0000-4000-8000-000000000003',
    $q$SELECT set_config('app.guard_bypass', 'orders', true);
       UPDATE public.orders
       SET discount_total = subtotal, service_fee = 0, total = 0
       WHERE id = '7e571000-0000-4000-8000-000000000001'$q$);
END;
$$;


-- =============================================================================
-- §11. CASE 8 — F13: a MANAGER writes tables.qr_token / resets the cooldown clocks
--
-- The QR token is a bearer capability: /t/<token> is the entire public entry
-- point. A client-chosen token is a guessable one, and anyone who guesses it can
-- order and call waiters as that table. last_order_at / last_waiter_call_at are
-- the §5.2/§5.3 rate-limit clocks, read FOR UPDATE by public_place_order and
-- public_call_waiter; a client that can NULL them has no rate limit.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('8a',
    'F13 MANAGER writes a chosen qr_token',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.tables SET qr_token = 'aaaaaaaaaaaaaaaaaaaaaa'
       WHERE id = '7e57e000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('8b',
    'F13 MANAGER resets last_waiter_call_at / last_order_at',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.tables SET last_waiter_call_at = NULL, last_order_at = NULL
       WHERE id = '7e57e000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('8c',
    'F13 MANAGER creates a NEW table with a chosen qr_token',
    '7e57c000-0000-4000-8000-000000000002',
    $q$INSERT INTO public.tables (restaurant_id, branch_id, number, qr_token)
       VALUES ('7e57a000-0000-4000-8000-000000000001',
               '7e57b000-0000-4000-8000-000000000001', '99',
               'bbbbbbbbbbbbbbbbbbbbbb')$q$);

  PERFORM pg_temp.qros_pe_case('8d',
    'F13 MANAGER forges the rotation audit counters',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.tables SET qr_rotation_count = 0, qr_token_issued_at = now()
       WHERE id = '7e57e000-0000-4000-8000-000000000001'$q$);

  -- ACL stripped: trg_tables_guard alone.
  PERFORM pg_temp.qros_pe_case('8e',
    'F13 MANAGER writes qr_token with the column GRANTed',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.tables SET qr_token = 'aaaaaaaaaaaaaaaaaaaaaa'
       WHERE id = '7e57e000-0000-4000-8000-000000000001'$q$,
    'refused', NULL,
    $s$GRANT UPDATE (qr_token, qr_token_issued_at, qr_rotation_count,
                     last_order_at, last_waiter_call_at)
       ON public.tables TO authenticated$s$);

  PERFORM pg_temp.qros_pe_case('8f',
    'F13 MANAGER resets the clocks with the columns GRANTed',
    '7e57c000-0000-4000-8000-000000000002',
    $q$UPDATE public.tables SET last_waiter_call_at = NULL, last_order_at = NULL
       WHERE id = '7e57e000-0000-4000-8000-000000000001'$q$,
    'refused', NULL,
    $s$GRANT UPDATE (qr_token, qr_token_issued_at, qr_rotation_count,
                     last_order_at, last_waiter_call_at)
       ON public.tables TO authenticated$s$);
END;
$$;


-- =============================================================================
-- §12. CASE 9 — F11: any staff member rewrites a notification's payload / type
--
-- notifications_update_addressee is satisfied by target_staff_id IS NULL, which
-- is true of every broadcast, so the policy admits every member of the branch.
-- The feed is what the KDS and the waiter console render, so a writable payload
-- is a forgeable operational instruction.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_case('9a',
    'F11 OWNER rewrites a broadcast payload and type',
    '7e57c000-0000-4000-8000-000000000001',
    $q$UPDATE public.notifications SET payload = '{"pwned":true}', type = 'system'
       WHERE id = '7e573000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('9b',
    'F11 KITCHEN rewrites a broadcast payload',
    '7e57c000-0000-4000-8000-000000000004',
    $q$UPDATE public.notifications SET payload = '{"pwned":true}'
       WHERE id = '7e573000-0000-4000-8000-000000000001'$q$);

  PERFORM pg_temp.qros_pe_case('9c',
    'F11 WAITER re-addresses and re-prioritises a broadcast',
    '7e57c000-0000-4000-8000-000000000003',
    $q$UPDATE public.notifications SET target_role = 'WAITER', priority = 2,
                                       expires_at = now() + interval '1 year'
       WHERE id = '7e573000-0000-4000-8000-000000000001'$q$);

  -- ACL stripped: trg_notifications_guard alone.
  PERFORM pg_temp.qros_pe_case('9d',
    'F11 OWNER rewrites a broadcast with UPDATE GRANTed table-wide',
    '7e57c000-0000-4000-8000-000000000001',
    $q$UPDATE public.notifications SET payload = '{"pwned":true}', type = 'system'
       WHERE id = '7e573000-0000-4000-8000-000000000001'$q$,
    'refused', NULL,
    $s$GRANT UPDATE ON public.notifications TO authenticated$s$);
END;
$$;


-- =============================================================================
-- §13. PERSISTED-STATE INVARIANTS
--
-- Every case above rolls itself back, so these must hold even if a guard were
-- missing. They exist to catch the opposite failure: a case that reported PASS
-- because it silently wrote nothing (wrong id, wrong role, a column compared to
-- its own value) while the real hole stayed open. If a value here has moved,
-- something escaped a savepoint and the whole file is untrustworthy.
-- =============================================================================
DO $$
BEGIN
  PERFORM pg_temp.qros_pe_invariant('I1',
    'no fixture profile became a platform admin',
    $i$SELECT count(*) = 0 FROM public.profiles
       WHERE id::text LIKE '7e57c000-0000-4000-8000-%' AND is_platform_admin$i$);

  PERFORM pg_temp.qros_pe_invariant('I2',
    'the staff roster is still exactly OWNER/MANAGER/WAITER/KITCHEN',
    $i$SELECT array_agg(role::text ORDER BY role::text)
              = ARRAY['KITCHEN','MANAGER','RESTAURANT_OWNER','WAITER']
       FROM public.staff
       WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001'$i$);

  PERFORM pg_temp.qros_pe_invariant('I3',
    'the tenant still has exactly one ACTIVE RESTAURANT_OWNER',
    $i$SELECT count(*) = 1 FROM public.staff
       WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001'
         AND role = 'RESTAURANT_OWNER' AND is_active$i$);

  PERFORM pg_temp.qros_pe_invariant('I4',
    'menu item price / name / category / branch / availability untouched',
    $i$SELECT price = 50000
              AND (name::jsonb ->> 'uz') = 'Olivye'
              AND category_id = '7e57f000-0000-4000-8000-000000000001'
              AND branch_id   = '7e57b000-0000-4000-8000-000000000001'
              AND is_available
              AND deleted_at IS NULL
              AND compare_at_price IS NULL
       FROM public.menu_items WHERE id = '7e570000-0000-4000-8000-000000000001'$i$);

  PERFORM pg_temp.qros_pe_invariant('I5',
    'order money is still 50000 / 0 / 5000 / 1000bps / 55000',
    $i$SELECT subtotal = 50000 AND discount_total = 0 AND service_fee = 5000
              AND service_fee_bps = 1000 AND total = 55000
       FROM public.orders WHERE id = '7e571000-0000-4000-8000-000000000001'$i$);

  PERFORM pg_temp.qros_pe_invariant('I6',
    'order identity (public_code / number / table / status) untouched',
    $i$SELECT public_code <> 'HACKEDCODE1' AND order_number <> 'A-999'
              AND table_id = '7e57e000-0000-4000-8000-000000000001'
              AND status = 'pending'
              AND client_request_id IS NULL AND payload_fingerprint IS NULL
       FROM public.orders WHERE id = '7e571000-0000-4000-8000-000000000001'$i$);

  PERFORM pg_temp.qros_pe_invariant('I7',
    'qr_token and both rate-limit clocks untouched',
    $i$SELECT qr_token = 'PrivEscFixtureTokenAAAAA'
              AND qr_rotation_count = 0
              AND last_order_at IS NOT NULL
              AND last_waiter_call_at IS NOT NULL
       FROM public.tables WHERE id = '7e57e000-0000-4000-8000-000000000001'$i$);

  PERFORM pg_temp.qros_pe_invariant('I8',
    'no second table was minted with a chosen token',
    $i$SELECT count(*) = 0 FROM public.tables
       WHERE branch_id = '7e57b000-0000-4000-8000-000000000001'
         AND qr_token = 'bbbbbbbbbbbbbbbbbbbbbb'$i$);

  PERFORM pg_temp.qros_pe_invariant('I9',
    'notification payload / type / priority untouched',
    $i$SELECT payload = '{"order_number":"A-001"}'::jsonb
              AND type = 'order_created' AND priority = 1
              AND target_role = 'KITCHEN'
       FROM public.notifications WHERE id = '7e573000-0000-4000-8000-000000000001'$i$);

  PERFORM pg_temp.qros_pe_invariant('I10',
    'no column GRANT widened by a defence-in-depth case leaked out',
    $i$SELECT NOT has_column_privilege('authenticated', 'public.profiles',
                                       'is_platform_admin', 'UPDATE')
              AND NOT has_column_privilege('authenticated', 'public.orders', 'total', 'UPDATE')
              AND NOT has_column_privilege('authenticated', 'public.tables', 'qr_token', 'UPDATE')
              AND NOT has_table_privilege ('authenticated', 'public.notifications', 'UPDATE')$i$);
END;
$$;


-- =============================================================================
-- §14. Summary
-- =============================================================================
\echo ''
SELECT case_id, status, defence, label, detail
FROM pg_temp.qros_pe_results
ORDER BY seq;

\echo ''
SELECT status, count(*) AS cases
FROM pg_temp.qros_pe_results
GROUP BY status
ORDER BY status;
\echo ''


-- =============================================================================
-- §15. Teardown — the file leaves the database exactly as it found it.
--      Runs BEFORE the verdict so a failing run still cleans up.
-- =============================================================================
DROP TABLE IF EXISTS pg_temp.qros_pe_seen;
SELECT pg_temp.qros_pe_teardown();

DO $$
DECLARE v_left integer;
BEGIN
  SELECT count(*) INTO v_left FROM public.staff
  WHERE restaurant_id = '7e57a000-0000-4000-8000-000000000001';
  IF v_left <> 0 THEN
    RAISE EXCEPTION 'test 01: teardown left % staff row(s) behind', v_left;
  END IF;
END;
$$;


-- =============================================================================
-- §16. Verdict — non-zero exit if anything failed.
-- =============================================================================
DO $$
DECLARE
  v_fail   integer;
  v_pass   integer;
  v_report text;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'FAIL'),
         count(*) FILTER (WHERE status = 'PASS')
    INTO v_fail, v_pass
  FROM pg_temp.qros_pe_results;

  IF v_fail > 0 THEN
    SELECT string_agg(format(E'\n  [%s] %s\n      %s\n      %s',
                             case_id, label, detail, statement), '')
      INTO v_report
    FROM pg_temp.qros_pe_results WHERE status = 'FAIL';

    RAISE EXCEPTION
      '01-privilege-escalation: % of % cases FAILED%',
      v_fail, v_fail + v_pass, v_report
      USING HINT = 'A FAIL on an exploit case means the statement shown was accepted by the database. A FAIL on a positive control means a legitimate operation is now blocked.';
  END IF;

  RAISE NOTICE '';
  RAISE NOTICE '01-privilege-escalation: all % cases passed.', v_pass;
END;
$$;
