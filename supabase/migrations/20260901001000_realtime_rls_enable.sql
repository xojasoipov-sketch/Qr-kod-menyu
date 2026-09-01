-- =============================================================================
-- Restaurant QR OS — 10. Realtime publication + RLS enablement
-- Implements docs/architecture/01-database-schema.md §9
--   §9.1 REPLICA IDENTITY FULL + `supabase_realtime` publication membership
--        for the seven live-screen tables.
--   §9.2 ENABLE / FORCE ROW LEVEL SECURITY on all 19 public tables, plus the
--        two targeted REVOKEs that keep the concurrency primitive and the QR
--        audit trail out of client reach.
--
-- FORCE ROW LEVEL SECURITY follows docs/architecture/02-security-and-rls.md
-- §3.0(1): every table gets it, with the two documented exceptions
-- `public.profiles` and `public.staff` (§4.2 — the recursion trap: the helper
-- functions that policies call must be able to read membership as the table
-- owner without re-entering those tables' own policies).
--
-- DELIBERATELY DENY-ALL. This migration enables RLS and creates NO policies.
-- With RLS enabled and zero policies, every role except `service_role` (which
-- holds BYPASSRLS) sees nothing and can write nothing on every table below.
-- That is the correct fail-closed state. The policies arrive in a later
-- migration implementing docs/architecture/02-security-and-rls.md §3; until it
-- lands, the only working data paths are the service-role Node route handlers
-- and the `public_*` SECURITY DEFINER capability functions.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. §9.1 — Replica identity for the realtime-published tables.
--
-- Realtime needs the OLD row, not just the primary key, to (a) diff a status
-- change and (b) evaluate an RLS predicate against the pre-image so a client
-- may be told about an UPDATE/DELETE at all. Without FULL, a DELETE event
-- carries only `id` — the KDS could not tell which branch it belonged to.
-- The roughly doubled WAL volume on these seven tables is an accepted cost.
-- REPLICA IDENTITY is a setting, not an object, so re-running is a no-op.
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders               REPLICA IDENTITY FULL;
ALTER TABLE public.order_items          REPLICA IDENTITY FULL;
ALTER TABLE public.order_status_history REPLICA IDENTITY FULL;
ALTER TABLE public.waiter_calls         REPLICA IDENTITY FULL;
ALTER TABLE public.notifications        REPLICA IDENTITY FULL;
ALTER TABLE public.menu_items           REPLICA IDENTITY FULL;
ALTER TABLE public.tables               REPLICA IDENTITY FULL;


-- -----------------------------------------------------------------------------
-- 2. §9.1 — Publication membership.
--
-- Each entry costs WAL decoding on every write to that table, so only tables a
-- live screen actually reacts to are published:
--   orders               → KDS new-order alert, customer tracker, waiter Ready list
--   order_items          → KDS card contents when a line is amended mid-service
--   order_status_history → customer tracker timeline appends without a refetch
--   waiter_calls         → "TABLE 12 IS CALLING" on the waiter console
--   notifications        → badge/toast feed on all three staff panels
--   menu_items           → customer menu reacts when a dish is 86-ed mid-browse
--   tables               → admin grid reflects QR rotation from another session
-- Not published (refetched on navigation instead): restaurants, branches,
-- profiles, staff, menu_categories, menu_item_options, promotions,
-- promotion_items, order_item_options, qr_token_history, branch_order_counters,
-- notification_reads.
--
-- `ALTER PUBLICATION ... ADD TABLE` errors if the table is already a member, so
-- membership is added only where absent. The publication itself is created by
-- Supabase; if it is missing (bare Postgres, a local stack without Realtime)
-- this block does nothing rather than failing the migration chain.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE
      'publication supabase_realtime does not exist; skipping realtime membership. '
      'Create it and re-add these tables before relying on live updates.';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'orders',
    'order_items',
    'order_status_history',
    'waiter_calls',
    'notifications',
    'menu_items',
    'tables'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname     = 'supabase_realtime'
        AND schemaname  = 'public'
        AND tablename   = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
    END IF;
  END LOOP;
END
$$;


-- -----------------------------------------------------------------------------
-- 3. §9.2 — Row-Level Security on every table, fail closed.
--
-- ENABLE makes the policy set authoritative for ordinary roles; FORCE extends
-- it to the table owner too, so a SECURITY DEFINER function owned by `postgres`
-- cannot accidentally become a tenant-isolation bypass. `service_role` still
-- bypasses via its BYPASSRLS role attribute — that is the intended server path.
-- Both are settings, not objects: re-running this file is a no-op.
-- -----------------------------------------------------------------------------
ALTER TABLE public.restaurants           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurants           FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.branches              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branches              FORCE  ROW LEVEL SECURITY;

-- profiles and staff are ENABLE-only, never FORCE: 02-security-and-rls.md §4.2.
-- The membership helpers (has_restaurant_access / has_branch_access) read these
-- two tables as owner; forcing RLS here would make every policy that calls a
-- helper re-enter the same table's policy and recurse.
ALTER TABLE public.profiles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles              NO FORCE ROW LEVEL SECURITY;

ALTER TABLE public.staff                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff                 NO FORCE ROW LEVEL SECURITY;

ALTER TABLE public.tables                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tables                FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.qr_token_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_token_history      FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.menu_categories       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_categories       FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.menu_items            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items            FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.menu_item_options     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_item_options     FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.promotions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotions            FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.promotion_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_items       FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.branch_order_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.branch_order_counters FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.orders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders                FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.order_items           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items           FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.order_item_options    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_item_options    FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.order_status_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_status_history  FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.waiter_calls          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.waiter_calls          FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.notifications         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications         FORCE  ROW LEVEL SECURITY;

ALTER TABLE public.notification_reads    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_reads    FORCE  ROW LEVEL SECURITY;


-- -----------------------------------------------------------------------------
-- 4. §9.2 — Grants removed where no client role may ever hold one.
--
-- RLS narrows rows; grants decide whether the verb exists at all. These two
-- tables have no legitimate client verb, so the grant is taken away rather than
-- left to be fenced off by a policy someone might later write too widely.
-- -----------------------------------------------------------------------------

-- branch_order_counters is a concurrency primitive (the race-safe daily
-- order-number sequence, §6.12). It is touched only by
-- app_private.next_order_number() under service_role; no client reads it ever.
REVOKE ALL ON public.branch_order_counters FROM anon, authenticated;

-- qr_token_history is an append-only audit table read only through server
-- routes (§6.6). `anon` never touches it; `authenticated` keeps the ability to
-- be granted SELECT by the policy migration so admins can see rotation history.
REVOKE ALL ON public.qr_token_history FROM anon;

-- Belt and braces on the whole schema: `anon` holds no table privilege in
-- `public` at all (02-security-and-rls.md §2.3). Every public customer path —
-- the /t/[token] resolver, the menu query, order creation — runs through the
-- `public_*` SECURITY DEFINER capability functions or a service-role Node route
-- handler, so the browser client needs no table privilege here. Re-asserted
-- again by 20260901009900_privilege_baseline_reassert.sql.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;


-- -----------------------------------------------------------------------------
-- 5. Guard: prove the fail-closed state actually holds.
--    Every table in `public` must have relrowsecurity set. A table added later
--    without RLS makes `supabase db reset` fail here rather than ship a hole.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_missing
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relrowsecurity;

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS enablement incomplete: public table(s) without row level security: %', v_missing
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
