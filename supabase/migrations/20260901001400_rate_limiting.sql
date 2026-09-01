-- =============================================================================
-- RESTAURANT QR OS — 14. Rate limiting + Realtime authorization
-- File: supabase/migrations/20260901001400_rate_limiting.sql
--
-- Implements docs/architecture/02-security-and-rls.md:
--   §5.0 The three anti-spam mechanisms and where each one lives
--   §5.1 app_private.rate_limits (fixed-window counter store),
--        app_private.rate_limit_hit(text, integer, interval),
--        app_private.rate_limits_gc() + its pg_cron job
--   §5.2 Order-spam supporting schema (per-table cooldown clock, idempotency
--        key, duplicate-payload fingerprint and their indexes)
--   §5.3 Waiter-call-spam supporting schema + app_private.expire_waiter_calls()
--        and its pg_cron job, plus the scheduler-independent inline expiry
--        (app_private.expire_waiter_calls_for_table + trg_waiter_calls_autoexpire)
--        that keeps §5.3 correct when that job was never scheduled — closes F16
--   §7.1 supabase_realtime publication membership for the staff live screens
--   §7.2 public.order_topic_is_valid(text) + RLS on realtime.messages
--
-- Also declares, defensively and idempotently, §4.8's app_private.security_events
-- because §5.1's rate_limit_hit() writes a 'ratelimit.tripped' row into it and
-- §9.3 places §4.8 and §5.1 in the same migration. Every statement for it is
-- IF NOT EXISTS, so the §4.8 owner re-emitting the identical DDL is a no-op.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT CONTAIN
-- --------------------------------------------
-- The order and waiter-call limits are NOT enforced here. §5.2 fixes a normative
-- ordering of checks — resolve token -> idempotency -> payload shape -> FOR
-- UPDATE + cooldown -> counters -> dedupe -> write — and §2.6 puts every one of
-- those steps inline in public.public_place_order() / public.public_call_waiter().
-- Those two functions are therefore the single caller of everything below, and
-- they own the literal budgets:
--
--   ORDER      (public_place_order, §5.2)
--     per-table minimum interval  20 s   tables.last_order_at, under FOR UPDATE
--     per-table hourly ceiling    12     rate_limit_hit('order:table:<uuid>',  12, interval '1 hour')
--     per-branch circuit breaker  300    rate_limit_hit('order:branch:<uuid>', 300, interval '1 hour')
--     identical-payload dedupe    60 s   (table_id, payload_fingerprint) -> QR013_DUPLICATE_ORDER
--     idempotency                        orders.client_request_id, unique -> replay returns 200 OK
--
--   WAITER CALL (public_call_waiter, §5.3)
--     per-table cooldown          90 s   tables.last_waiter_call_at, under FOR UPDATE
--     per-table hourly ceiling    5      rate_limit_hit('call:table:<uuid>', 5, interval '1 hour')
--     one open call per table            uq_waiter_calls_open_per_table (migration 07)
--     auto-expiry                 30 min app_private.expire_waiter_calls(), below
--
-- The 20 s and 90 s cooldowns are additionally enforced, independently of the
-- RPC layer, by public.assert_order_rate_limit() / public.assert_waiter_call_cooldown()
-- (migration 08), which read branches.order_min_interval_seconds (default 20)
-- and branches.waiter_call_cooldown_seconds (default 90).
--
-- IDENTIFIER RECONCILIATION (docs/architecture/03-domain-and-types.md §1.1):
--     doc 02 `orders.public_token`          -> `public.orders.public_code`
--     doc 02 `waiter_calls.status = 'open'` -> `'pending'` and `'acknowledged'`
--                                              (the two OPEN labels, per doc 01)
--     doc 02 index `orders_client_request_id_uk` -> `uq_orders_client_request_id`
--     doc 02 index `orders_dup_guard_idx`        -> `idx_orders_dup_guard`
--       (doc 03 §1.2 names; they also match this repo's uq_/idx_ convention)
--
-- No money is touched in this file.
--
-- Depends on: 20260901000000 (schema app_private, the privilege baseline),
--             20260901000200 (public.branches — the tuning columns),
--             20260901000300 (public.tables),
--             20260901000600 (public.orders),
--             20260901000700 (public.waiter_calls, uq_waiter_calls_open_per_table),
--             20260901001000 (supabase_realtime publication membership),
--             20260901001100 (public.has_branch_access(uuid)).
-- =============================================================================


-- =============================================================================
-- 1. §4.8 — the audit sink (declared defensively; see the header)
--
-- rate_limit_hit() below writes exactly one 'ratelimit.tripped' row per bucket
-- per window, on the hit that crosses the ceiling. Without the table, tripping a
-- limit would raise 42P01 and turn a rate-limit refusal into a 500.
--
-- RLS on + FORCE with zero policies and zero grants: reachable only by
-- service_role (BYPASSRLS) and by postgres. Deliberate — it is an audit sink,
-- not an API resource.
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_private.security_events (
  id            UUID        PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  kind          TEXT        NOT NULL,
  actor_id      UUID,
  restaurant_id UUID,
  branch_id     UUID,
  ip            INET,
  payload       JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS security_events_created_idx
  ON app_private.security_events (created_at DESC);

CREATE INDEX IF NOT EXISTS security_events_kind_idx
  ON app_private.security_events (kind, created_at DESC);

ALTER TABLE app_private.security_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.security_events FORCE  ROW LEVEL SECURITY;

REVOKE ALL ON TABLE app_private.security_events FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE app_private.security_events IS
  'Doc 02 §4.8. Append-only audit sink for security-relevant events. Recorded '
  'kinds: qr_token.rotated, order_item.voided, staff.role_changed, '
  'profile.super_admin_changed, auth.failed_resolve_burst, ratelimit.tripped, '
  'policy.violation, cron.unscheduled. No policies and no grants, by design.';


-- =============================================================================
-- 2. §5.1 — the fixed-window counter store
--
-- One row per bucket. The bucket key is the resource the limit protects
-- ('order:table:<uuid>', 'order:branch:<uuid>', 'call:table:<uuid>'), never an
-- IP or a session id: §5.0 is explicit that the DB limits are keyed on things an
-- attacker cannot rotate, so spreading a flood across browsers buys nothing.
--
-- The table is bounded by (live tables x 2 + live branches), so it is small by
-- construction; rate_limits_gc() below keeps expired rows from accumulating.
-- =============================================================================

CREATE TABLE IF NOT EXISTS app_private.rate_limits (
  bucket       TEXT        PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  hits         INTEGER     NOT NULL,
  expires_at   TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS rate_limits_expires_idx
  ON app_private.rate_limits (expires_at);

ALTER TABLE app_private.rate_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.rate_limits FORCE  ROW LEVEL SECURITY;

-- No policies, no grants. Reachable only from SECURITY DEFINER functions.
REVOKE ALL ON TABLE app_private.rate_limits FROM PUBLIC, anon, authenticated;

COMMENT ON TABLE app_private.rate_limits IS
  'Doc 02 §5.1. Fixed-window hit counters, one row per protected resource. '
  'Written only by app_private.rate_limit_hit(); pruned by '
  'app_private.rate_limits_gc(). RLS on with zero policies and zero grants: '
  'unreachable from PostgREST and from anon/authenticated by construction.';

COMMENT ON COLUMN app_private.rate_limits.bucket IS
  'Namespaced key of the protected resource, e.g. order:table:<uuid>, '
  'order:branch:<uuid>, call:table:<uuid>. Never an IP or a session id — those '
  'are rotatable and are limited in the app layer only (doc 02 §5.4).';

COMMENT ON COLUMN app_private.rate_limits.expires_at IS
  'End of the current fixed window. A hit arriving at or after this instant '
  'starts a new window rather than incrementing the old one.';


-- -----------------------------------------------------------------------------
-- §5.1 — the counting function.
--
-- Returns true when the caller is still inside its budget, false when the call
-- must be refused. It never raises: shaping the refusal (QR010 vs QR011, the
-- scope label, retry_after_seconds) is the caller's job, because only the caller
-- knows which budget it just asked about.
--
-- clock_timestamp() rather than now(): now() is the transaction start, so a long
-- transaction would pin the window open and let a burst inside it run free.
--
-- The window is FIXED, not sliding. A burst straddling a boundary can briefly
-- reach 2x the nominal rate. That is accepted: the tight interval is enforced by
-- the cooldown column under FOR UPDATE, and this counter only caps the hour.
--
-- The whole read-modify-write is one INSERT ... ON CONFLICT DO UPDATE, so two
-- concurrent hits on the same bucket serialise on the row lock and cannot both
-- read the same stale `hits`.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.rate_limit_hit(
  p_bucket TEXT,
  p_limit  INTEGER,
  p_window INTERVAL
) RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_now  timestamptz := clock_timestamp();
  v_hits integer;
BEGIN
  INSERT INTO app_private.rate_limits AS rl (bucket, window_start, hits, expires_at)
  VALUES (p_bucket, v_now, 1, v_now + p_window)
  ON CONFLICT (bucket) DO UPDATE
    SET window_start = CASE WHEN rl.expires_at <= v_now THEN v_now            ELSE rl.window_start END,
        hits         = CASE WHEN rl.expires_at <= v_now THEN 1                ELSE rl.hits + 1     END,
        expires_at   = CASE WHEN rl.expires_at <= v_now THEN v_now + p_window ELSE rl.expires_at   END
  RETURNING rl.hits INTO v_hits;

  -- Exactly once per window, on the hit that crosses the ceiling. Logging every
  -- subsequent refusal would let an attacker choose how much we write.
  IF v_hits = p_limit + 1 THEN
    INSERT INTO app_private.security_events (id, kind, payload, created_at)
    VALUES (pg_catalog.gen_random_uuid(), 'ratelimit.tripped',
            jsonb_build_object('bucket', p_bucket, 'limit', p_limit), v_now);
  END IF;

  RETURN v_hits <= p_limit;
END;
$fn$;

REVOKE ALL ON FUNCTION app_private.rate_limit_hit(TEXT, INTEGER, INTERVAL)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.rate_limit_hit(TEXT, INTEGER, INTERVAL) IS
  'Doc 02 §5.1. Records one hit against a fixed-window bucket and returns '
  'whether the caller is still within p_limit. Callers and their budgets: '
  'public_place_order -> (order:table:<uuid>, 12, 1 hour) and '
  '(order:branch:<uuid>, 300, 1 hour); public_call_waiter -> '
  '(call:table:<uuid>, 5, 1 hour). Never raises — the caller shapes the refusal.';


-- -----------------------------------------------------------------------------
-- §5.1 — housekeeping. Keeps the counter table from becoming a scan hazard.
-- A one-hour grace after expiry keeps a row available for post-incident reading.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.rate_limits_gc()
RETURNS INTEGER
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH d AS (
    DELETE FROM app_private.rate_limits
     WHERE expires_at < now() - interval '1 hour'
    RETURNING 1)
  SELECT count(*)::int FROM d;
$fn$;

REVOKE ALL ON FUNCTION app_private.rate_limits_gc() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.rate_limits_gc() IS
  'Doc 02 §5.1. Prunes expired rate-limit windows. Scheduled every 10 minutes '
  'via pg_cron. Returns the number of rows removed.';


-- =============================================================================
-- 3. §5.0 / §5.2 / §5.3 — the supporting columns the RPC layer locks and writes
--
-- These are the "cooldown column" and "uniqueness / idempotency" rows of the
-- §5.0 mechanism table. They are declared here, with the counter store, so all
-- three mechanisms live in one reviewable place; public_place_order() and
-- public_call_waiter() are their only writers.
--
-- ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS throughout, matching the
-- inline DDL doc 02 §2.6 carries, so whichever migration lands first wins and
-- the other is a no-op.
--
-- Doc 02 §3.18's trg_tables_guard() rejects any direct client write to
-- last_order_at / last_waiter_call_at, and trg_orders_guard() makes
-- client_request_id and payload_fingerprint immutable after insert.
-- =============================================================================

ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS last_order_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_waiter_call_at TIMESTAMPTZ;

COMMENT ON COLUMN public.tables.last_order_at IS
  'Clock for the per-table order cooldown (branches.order_min_interval_seconds, '
  'default 20 s — doc 02 §5.2). Read under SELECT ... FOR UPDATE and written '
  'only by public_place_order(). The row lock is the concurrency control: '
  'without it two simultaneous taps both see a stale timestamp and both insert.';

COMMENT ON COLUMN public.tables.last_waiter_call_at IS
  'Clock for the per-table waiter-call cooldown '
  '(branches.waiter_call_cooldown_seconds, default 90 s — doc 02 §5.3). Read '
  'under SELECT ... FOR UPDATE and written only by public_call_waiter().';

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS client_request_id   UUID,
  ADD COLUMN IF NOT EXISTS payload_fingerprint TEXT;

COMMENT ON COLUMN public.orders.client_request_id IS
  'Client-generated v4 UUID, one per cart, reused across retries. The unique '
  'partial index makes a retry idempotent: public_place_order() returns the '
  'original order with 200 OK instead of raising QR013_DUPLICATE_ORDER.';

COMMENT ON COLUMN public.orders.payload_fingerprint IS
  'Hash of the normalised item payload. Detects an accidental double submit from '
  'the SAME table with a DIFFERENT client_request_id inside the 60-second '
  'duplicate window (doc 02 §5.2) -> QR013_DUPLICATE_ORDER.';

-- Idempotency key. Partial, so the overwhelmingly common NULL (staff- and
-- admin-entered orders) does not collide with itself.
CREATE UNIQUE INDEX IF NOT EXISTS uq_orders_client_request_id
  ON public.orders (client_request_id)
  WHERE client_request_id IS NOT NULL;

-- Duplicate-payload guard. created_at DESC because the dedupe lookup asks only
-- for the most recent match inside a 60-second window.
CREATE INDEX IF NOT EXISTS idx_orders_dup_guard
  ON public.orders (table_id, payload_fingerprint, created_at DESC);


-- =============================================================================
-- 4. §5.3 — waiter-call auto-expiry
--
-- uq_waiter_calls_open_per_table (migration 07) is the real anti-spam defence:
-- while a call is open, a second tap is a 23505 in the database rather than a
-- check in JavaScript. That index is also a liveness hazard — a call nobody ever
-- resolves would wedge the table's button forever — so open calls are aged out.
--
-- "Open" is two labels in this schema, pending and acknowledged, exactly the set
-- the partial unique index covers; expiring only 'pending' would leave an
-- abandoned acknowledged call holding the lock.
--
-- The window comes from branches.waiter_call_expiry_minutes (default 30, doc 01
-- §6.2), which is the same 30 minutes doc 02 §5.3 states, made per-branch.
--
-- Runs as postgres, so trg_waiter_calls_guard() sees auth.uid() IS NULL and
-- pending/acknowledged -> expired is an allowed system transition.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_private.expire_waiter_calls()
RETURNS INTEGER
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH u AS (
    UPDATE public.waiter_calls w
       SET status     = 'expired',
           updated_at = now()
      FROM public.branches b
     WHERE b.id = w.branch_id
       AND w.status IN ('pending', 'acknowledged')
       AND w.created_at < now() - make_interval(mins => b.waiter_call_expiry_minutes)
    RETURNING 1)
  SELECT count(*)::int FROM u;
$fn$;

REVOKE ALL ON FUNCTION app_private.expire_waiter_calls() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.expire_waiter_calls() IS
  'Doc 02 §5.3. Ages out open waiter calls (pending + acknowledged) older than '
  'branches.waiter_call_expiry_minutes so uq_waiter_calls_open_per_table can '
  'never wedge a table''s CALL WAITER button. Scheduled every 5 minutes via '
  'pg_cron WHEN pg_cron exists — which section 5 cannot guarantee, so §4b''s '
  'trg_waiter_calls_autoexpire performs the same expiry inline on the write '
  'path (F16). Returns the number of calls expired.';


-- =============================================================================
-- 4b. §5.3 — the scheduler-independent safety valve            (closes F16)
--
-- Everything above assumes something calls expire_waiter_calls(). Section 5
-- below tries to make pg_cron do that and is allowed to fail, which means the
-- assumption can quietly evaporate: F16 verified a completed chain in which
-- pg_extension holds no pg_cron row and no job is registered. The consequence
-- is not cosmetic. uq_waiter_calls_open_per_table treats pending AND
-- acknowledged as open, so ONE call that staff never resolve permanently blocks
-- that table from ever calling a waiter again — every later tap is a 23505 that
-- public_call_waiter reports as QR012_WAITER_CALL_ALREADY_OPEN, forever.
--
-- So the expiry is made a property of the write path itself, not of a
-- scheduler: immediately before a new call is evaluated, any open call at that
-- table that is already older than the branch's waiter_call_expiry_minutes is
-- aged out. With no cron at all, the FIRST tap after the window has elapsed
-- clears the wedge and succeeds; cron, when present, only makes that happen
-- earlier and keeps the waiter console honest in the meantime.
--
-- Why a separate BEFORE INSERT trigger rather than an edit to
-- public.assert_waiter_call_cooldown() (migration 08):
--   * that function short-circuits on branches.waiter_call_cooldown_seconds = 0
--     (a venue that wants no throttle), which is exactly the venue that would
--     then have no safety valve either;
--   * the valve must run for EVERY insert path — public_call_waiter, staff
--     entry, seed data — not only the ones that go through the RPC; and
--   * BEFORE-row triggers fire in name order, so `trg_waiter_calls_autoexpire`
--     is guaranteed to run before `trg_waiter_calls_cooldown` and before the
--     unique index is consulted, which is what makes the wedge clear itself.
--
-- The status change is the same one the cron job would have made, written by
-- the same SECURITY DEFINER owner, so the waiter console and any status guard
-- see an ordinary system expiry (doc 02 §5.3: it runs as postgres, so
-- auth.uid() IS NULL and pending/acknowledged -> expired is a system
-- transition).
-- =============================================================================

CREATE OR REPLACE FUNCTION app_private.expire_waiter_calls_for_table(p_table_id UUID)
RETURNS INTEGER
LANGUAGE sql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  WITH u AS (
    UPDATE public.waiter_calls w
       SET status     = 'expired',
           updated_at = now()
      FROM public.branches b
     WHERE b.id = w.branch_id
       AND w.table_id = p_table_id
       AND w.status IN ('pending', 'acknowledged')
       AND w.created_at < now() - make_interval(mins => b.waiter_call_expiry_minutes)
    RETURNING 1)
  SELECT count(*)::int FROM u;
$fn$;

REVOKE ALL ON FUNCTION app_private.expire_waiter_calls_for_table(UUID)
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.expire_waiter_calls_for_table(UUID) IS
  'Doc 02 §5.3, closes F16. The per-table half of app_private.expire_waiter_calls(): '
  'ages out open calls (pending + acknowledged) at ONE table that are older than '
  'that branch''s waiter_call_expiry_minutes. Called inline from '
  'trg_waiter_calls_autoexpire so a forgotten call cannot wedge '
  'uq_waiter_calls_open_per_table even on a deployment where pg_cron never '
  'scheduled the housekeeping job. Returns the number of calls expired.';


CREATE OR REPLACE FUNCTION public.waiter_calls_expire_stale()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  PERFORM app_private.expire_waiter_calls_for_table(NEW.table_id);
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS trg_waiter_calls_autoexpire ON public.waiter_calls;

-- Name chosen so it sorts BEFORE trg_waiter_calls_cooldown: PostgreSQL fires
-- BEFORE-row triggers in name order, and the cooldown check should see the
-- post-expiry world.
CREATE TRIGGER trg_waiter_calls_autoexpire
  BEFORE INSERT ON public.waiter_calls
  FOR EACH ROW EXECUTE FUNCTION public.waiter_calls_expire_stale();

COMMENT ON FUNCTION public.waiter_calls_expire_stale() IS
  'Doc 02 §5.3, closes F16. BEFORE INSERT on public.waiter_calls: expires open '
  'calls at the same table that have outlived branches.waiter_call_expiry_minutes, '
  'so uq_waiter_calls_open_per_table can never wedge a table''s CALL WAITER button '
  'when app_private.expire_waiter_calls() is not scheduled. Correctness of the '
  'one-open-call-per-table rule therefore does not depend on pg_cron existing.';


-- =============================================================================
-- 5. §5.1 / §5.3 — the two cron jobs
--
-- pg_cron is a superuser-installed, shared_preload_libraries extension. It is
-- present on Supabase and absent on a bare Postgres used for schema-only CI, so
-- both the CREATE EXTENSION and the schedules are attempted and degraded to a
-- WARNING plus an audit row rather than failing the migration chain (see F16
-- below; it used to be a NOTICE). cron.schedule() upserts by job
-- name, so re-running this file re-points an existing job instead of duplicating
-- it. Jobs run as the scheduling role (postgres), which is what lets them reach
-- into app_private.
--
-- F16: the old form of this block degraded to RAISE NOTICE, which no deploy log
-- is read closely enough to catch, and both functions then sat unscheduled with
-- nothing recording the fact. It now (a) RAISEs WARNING, (b) writes a
-- 'cron.unscheduled' row into app_private.security_events so the omission is
-- discoverable after the deploy rather than only during it, and (c) leans on
-- §4b: the waiter-call wedge — the one failure mode that is not merely
-- housekeeping — is already handled inline by trg_waiter_calls_autoexpire, so
-- an unscheduled deployment degrades in bounded ways instead of breaking a
-- table's CALL WAITER button permanently.
--
-- Still true and still required: without rate_limits_gc the counter table is
-- never pruned (it stays small — one row per live table and branch — but its
-- expired rows accumulate), and without expire_waiter_calls the waiter console
-- keeps showing calls that the write path will only expire on the next tap. Both
-- jobs MUST be scheduled by other means when this block warns.
-- =============================================================================

DO $cron$
DECLARE
  v_reason TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      EXECUTE 'CREATE EXTENSION IF NOT EXISTS pg_cron';
    EXCEPTION WHEN OTHERS THEN
      v_reason := 'pg_cron extension unavailable: ' || SQLERRM;
    END;
  END IF;

  IF v_reason IS NULL THEN
    BEGIN
      EXECUTE $sched$
        SELECT cron.schedule('rate-limits-gc', '*/10 * * * *',
                             $job$ SELECT app_private.rate_limits_gc(); $job$)
      $sched$;

      EXECUTE $sched$
        SELECT cron.schedule('waiter-calls-expire', '*/5 * * * *',
                             $job$ SELECT app_private.expire_waiter_calls(); $job$)
      $sched$;
    EXCEPTION WHEN OTHERS THEN
      v_reason := 'cron.schedule failed: ' || SQLERRM;
    END;
  END IF;

  IF v_reason IS NULL THEN
    RETURN;                              -- both jobs scheduled; nothing to report
  END IF;

  RAISE WARNING
    'doc 02 §5.1/§5.3 NOT scheduled (%): app_private.rate_limits_gc() and '
    'app_private.expire_waiter_calls() exist but no pg_cron job runs them. '
    'The waiter-call wedge is still covered inline by trg_waiter_calls_autoexpire '
    '(§4b), but rate_limits is never pruned and open calls are only aged out on '
    'the next tap at that table. Schedule both externally before production; '
    'an app_private.security_events row of kind cron.unscheduled records this.',
    v_reason;

  -- Make the omission survive the deploy log. Recorded, never fatal: a
  -- migration must not fail because its own audit trail could not be written.
  BEGIN
    INSERT INTO app_private.security_events (id, kind, payload, created_at)
    VALUES (pg_catalog.gen_random_uuid(), 'cron.unscheduled',
            jsonb_build_object(
              'reason',   v_reason,
              'jobs',     jsonb_build_array(
                            jsonb_build_object('name', 'rate-limits-gc',
                                               'schedule', '*/10 * * * *',
                                               'calls', 'app_private.rate_limits_gc()'),
                            jsonb_build_object('name', 'waiter-calls-expire',
                                               'schedule', '*/5 * * * *',
                                               'calls', 'app_private.expire_waiter_calls()')),
              'mitigated_by', 'trg_waiter_calls_autoexpire',
              'finding',  'F16',
              'source',   '20260901001400_rate_limiting.sql'),
            now());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING
      'could not record the cron.unscheduled event in app_private.security_events '
      '(%); the WARNING above is the only trace.', SQLERRM;
  END;
END
$cron$;


-- =============================================================================
-- 6. §7.1 — Realtime for staff (`authenticated`)
--
-- Staff panels subscribe with postgres_changes on their cookie-bound client.
-- Supabase Realtime re-evaluates the subscriber's own RLS before emitting each
-- change, so §3's policies are the authorization control and no extra object is
-- needed: a kitchen subscriber cannot receive another branch's order, and cannot
-- receive a completed order because it fails orders_select_kitchen. Client-side
-- `filter: 'branch_id=eq.<uuid>'` is bandwidth tuning, never security.
--
-- Publication membership is normally established by migration 10 (which
-- publishes a superset: the five below plus order_status_history and tables).
-- This block only repairs a missing entry, so it is a no-op on a healthy
-- database and does not take ownership of that migration's decision.
-- =============================================================================

DO $publication$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE
      'publication supabase_realtime does not exist; doc 02 §7.1 membership not verified.';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'orders',
    'order_items',
    'waiter_calls',
    'notifications',
    'menu_items'          -- so a KDS reflects an availability toggle without a refetch
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_publication_tables
      WHERE pubname    = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = v_table
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', v_table);
      RAISE NOTICE 'doc 02 §7.1: added public.% to supabase_realtime', v_table;
    END IF;
  END LOOP;
END
$publication$;


-- =============================================================================
-- 7. §7.2 — Realtime for customers (`anon`), Broadcast from Database
--
-- anon holds no SELECT on public.orders, so it cannot use postgres_changes at
-- all — which is correct. Customer tracking rides on realtime.send() to the
-- topic 'order:<orders.public_code>'. The topic name IS the capability, so the
-- authorization question reduces to: does this topic name correspond to a real,
-- recent order? anon cannot answer that itself, hence a definer function.
--
-- The 24-hour horizon bounds the capability: a tracking URL from last week
-- still renders (public_get_order is a separate check) but can no longer be
-- used to hold a live channel open.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.order_topic_is_valid(p_topic TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.orders o
    WHERE p_topic LIKE 'order:%'
      AND o.public_code = substr(p_topic, 7)
      AND o.created_at > now() - interval '24 hours');
$fn$;

REVOKE ALL     ON FUNCTION public.order_topic_is_valid(TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.order_topic_is_valid(TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.order_topic_is_valid(TEXT) IS
  'Doc 02 §7.2. Channel-authorization predicate for realtime.messages: is this '
  'topic name a real, recent order tracking topic? SECURITY DEFINER because anon '
  'has no SELECT on public.orders. The equality is written as '
  'public_code = substr(topic, 7) rather than topic = ''order:'' || public_code '
  'so uq_orders_public_code answers it with an index lookup — the predicate runs '
  'on every message a customer channel reads. This is the ONE public function '
  'besides the five capability RPCs that anon may execute; doc 02 §9.2 query (b) '
  'whitelists it by name.';


-- -----------------------------------------------------------------------------
-- §7.2 — RLS on realtime.messages.
--
-- Read-only for both audiences. There is deliberately NO INSERT policy for anon
-- or authenticated: clients listen, only the database publishes. That closes
-- channel injection — a customer cannot broadcast a fake order.status_changed
-- onto another diner's tracker, and a diner cannot inject a fake order.created
-- onto a branch channel.
--
-- realtime.messages belongs to the Supabase Realtime stack, which may be absent
-- on a bare Postgres. The block degrades to a NOTICE rather than failing the
-- chain. DROP POLICY IF EXISTS makes re-running this migration safe; both
-- policies are created by this file and owned by it.
-- -----------------------------------------------------------------------------

DO $realtime$
BEGIN
  IF to_regclass('realtime.messages') IS NULL THEN
    RAISE NOTICE
      'realtime.messages does not exist; doc 02 §7.2 channel policies skipped. '
      'Customer broadcast tracking will not be authorized until they are created.';
    RETURN;
  END IF;

  IF to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE NOTICE
      'realtime.topic() does not exist; doc 02 §7.2 channel policies skipped.';
    RETURN;
  END IF;

  EXECUTE 'ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY';

  EXECUTE 'DROP POLICY IF EXISTS realtime_customer_order_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY realtime_customer_order_read ON realtime.messages
      FOR SELECT TO anon
      USING ( realtime.topic() LIKE 'order:%'
              AND public.order_topic_is_valid(realtime.topic()) )
  $pol$;

  EXECUTE 'DROP POLICY IF EXISTS realtime_staff_branch_read ON realtime.messages';
  EXECUTE $pol$
    CREATE POLICY realtime_staff_branch_read ON realtime.messages
      FOR SELECT TO authenticated
      USING (
        (realtime.topic() LIKE 'branch:%'
         AND public.has_branch_access(nullif(split_part(realtime.topic(), ':', 2), '')::uuid))
        OR (realtime.topic() LIKE 'order:%'
            AND public.order_topic_is_valid(realtime.topic())) )
  $pol$;

EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE
      'insufficient privilege to author policies on realtime.messages (%). '
      'doc 02 §7.2 must be applied by a role that owns that table.', SQLERRM;
  WHEN OTHERS THEN
    RAISE NOTICE
      'doc 02 §7.2 channel policies could not be applied (%). Customer broadcast '
      'tracking is unauthorized until realtime_customer_order_read and '
      'realtime_staff_branch_read exist on realtime.messages.', SQLERRM;
END
$realtime$;


-- =============================================================================
-- 8. Self-check — the §5 invariants that must not silently regress.
-- =============================================================================

DO $verify$
DECLARE
  -- The complete set of routines `anon` is allowed to execute: doc 02 §2.3's
  -- five capability RPCs, §7.2's channel predicate (doc 02 §9.2 query (b)
  -- whitelists it by name), and doc 03 §1.4's public_cancel_order, which does
  -- not exist yet at this point in the chain (20260901001600 creates it) and is
  -- listed only so re-running this file on a migrated database does not report
  -- it. 20260901009900 must re-grant exactly this set and nothing else.
  c_anon_api CONSTANT text[] := ARRAY[
    'public_resolve_table', 'public_get_menu', 'public_place_order',
    'public_get_order', 'public_call_waiter', 'order_topic_is_valid',
    'public_cancel_order'];
  v_bad text;
BEGIN
  -- (a) Neither counter table may be reachable by anon or authenticated, and
  --     both must have RLS on and forced.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_bad
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'app_private'
    AND c.relname IN ('rate_limits', 'security_events')
    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'doc 02 §5.1/§4.8 violated: RLS not enabled+forced on app_private.%', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT string_agg(format('%s->%s', table_name, grantee), ', ')
    INTO v_bad
  FROM information_schema.role_table_grants
  WHERE table_schema = 'app_private'
    AND grantee IN ('anon', 'authenticated', 'PUBLIC');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'doc 02 §5.1 violated: app_private table privileges leaked (%)', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) The §7.2 channel predicate must be reachable by anon, or the customer
  --     tracking channel is authorized by a policy that always errors.
  IF NOT has_function_privilege('anon', 'public.order_topic_is_valid(text)', 'execute') THEN
    RAISE EXCEPTION
      'doc 02 §7.2 violated: anon cannot execute public.order_topic_is_valid(text); '
      'realtime_customer_order_read would fail for every customer channel'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) Nothing outside the six anon doors may be anon-executable.
  --
  --     F03 + F14: this check used to report every function PostgreSQL's
  --     built-in EXECUTE-to-PUBLIC still covers — 21 of them mid-chain — with a
  --     message that read like a live vulnerability. It is not one, and the
  --     alarm was inaccurate in a way that trains a reader to ignore it. The
  --     ALTER DEFAULT PRIVILEGES revokes in 20260901000000 are inert (a
  --     revoke-only default ACL computes to an empty ACL, which PostgreSQL
  --     stores as no row at all, so the built-in default reapplies), and the
  --     single enforcement point for `anon` is the explicit
  --       REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon, PUBLIC
  --     in 20260901009900_privilege_baseline_reassert.sql, which runs last and
  --     hard-asserts the end state.
  --
  --     So the check is split by what the re-assert can actually repair:
  --       c1  reachable only through the built-in PUBLIC grant, or through an
  --           explicit grant to anon, in a schema 9900 sweeps -> WARNING that
  --           names the functions and names 9900 as the enforcement point;
  --       c2  reachable in a way 9900's revoke would NOT undo -> EXCEPTION,
  --           because a chain that ends here ships an open door.
  SELECT string_agg(format('%s.%s', n.nspname, p.proname), ', '
                    ORDER BY n.nspname, p.proname)
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'app_private')
    AND NOT (p.proname = ANY (c_anon_api))
    AND has_function_privilege('anon', p.oid, 'execute');

  IF v_bad IS NOT NULL THEN
    RAISE WARNING
      'doc 02 §6.10: anon can currently execute % outside the public capability '
      'API. '
      'Expected at this point in the chain — every function is created '
      'EXECUTE-to-PUBLIC (F14: the ALTER DEFAULT PRIVILEGES revokes in the '
      'baseline store no ACL row and so never take effect). The enforcement '
      'point is 20260901009900_privilege_baseline_reassert.sql, which revokes '
      'these and fails the migration if any survive. This warning is a '
      'FYI-until-9900, not a live finding; check (c2) below is the one that '
      'fails the chain.', v_bad;
  END IF;

  -- (c2) The teeth. 9900 repairs an over-broad grant by revoking, from anon and
  --      from PUBLIC, on schemas public and app_private. Two things escape that:
  --      a privilege anon holds by MEMBERSHIP in some other role (the revoke
  --      names anon, not the group), and a routine in a project schema 9900 does
  --      not sweep at all. Either one means the end of the chain is already
  --      broken, so it fails here, where the offending migration is still
  --      obvious, rather than 4 files later.
  SELECT string_agg(format('%s.%s (via role %s)', n.nspname, p.proname,
                           a.grantee::regrole::text), ', '
                    ORDER BY n.nspname, p.proname)
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(p.proacl) a
  WHERE n.nspname IN ('public', 'app_private')
    AND NOT (p.proname = ANY (c_anon_api))
    AND a.privilege_type = 'EXECUTE'
    AND a.grantee <> 0                                  -- 0 = PUBLIC; 9900 revokes it
    AND a.grantee <> 'anon'::regrole::oid              -- 9900 revokes anon by name
    AND pg_has_role('anon', a.grantee, 'USAGE');        -- ... but not this path

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'doc 02 §2.3/§6.10 violated: anon reaches % through a role membership, '
      'which 20260901009900''s REVOKE ... FROM anon, PUBLIC does not undo', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT string_agg(format('%s.%s', n.nspname, p.proname), ', '
                    ORDER BY n.nspname, p.proname)
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname NOT IN ('public', 'app_private')      -- the schemas 9900 sweeps
    AND n.nspname NOT LIKE 'pg\_%'
    AND n.nspname NOT IN (                              -- platform-owned, not ours
      'information_schema', 'auth', 'storage', 'realtime', 'extensions',
      'graphql', 'graphql_public', 'vault', 'cron', 'net', 'pgsodium',
      'pgsodium_masks', 'supabase_functions', 'supabase_migrations',
      'pgbouncer', '_analytics', '_realtime')
    AND has_function_privilege('anon', p.oid, 'execute');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'doc 02 §2.3 violated: anon may execute % in a schema that '
      '20260901009900_privilege_baseline_reassert.sql does not revoke '
      '(it sweeps only public and app_private)', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (d) Every SECURITY DEFINER function this file created pins search_path
  --     (doc 02 §6.9, §9.2 (c)).
  SELECT string_agg(format('%s.%s', n.nspname, p.proname), ', ')
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE p.prosecdef
    AND ((n.nspname = 'app_private'
          AND p.proname IN ('rate_limit_hit', 'rate_limits_gc', 'expire_waiter_calls',
                            'expire_waiter_calls_for_table'))
      OR (n.nspname = 'public'
          AND p.proname IN ('order_topic_is_valid', 'waiter_calls_expire_stale')))
    AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%';

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'doc 02 §6.9 violated: unpinned search_path on %', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (e) F16: the scheduler-independent safety valve must exist and must fire
  --     before the cooldown check (BEFORE-row triggers fire in name order).
  --     Without it, correctness of §5.3 silently depends on pg_cron, which
  --     section 5 is explicitly allowed to fail to install.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    WHERE t.tgrelid = 'public.waiter_calls'::regclass
      AND t.tgname  = 'trg_waiter_calls_autoexpire'
      AND NOT t.tgisinternal)
  THEN
    RAISE EXCEPTION
      'doc 02 §5.3 violated: trg_waiter_calls_autoexpire is missing, so an '
      'unresolved waiter call would wedge uq_waiter_calls_open_per_table for '
      'that table until pg_cron ran app_private.expire_waiter_calls() — which '
      'this file cannot guarantee ever happens (F16)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ... and it must still be the FIRST BEFORE-INSERT row trigger, or a later
  --     migration has inserted a check that sees the pre-expiry world.
  --     tgtype bits: ROW = 1, BEFORE = 2, INSERT = 4.
  SELECT string_agg(t.tgname, ', ' ORDER BY t.tgname)
    INTO v_bad
  FROM pg_trigger t
  WHERE t.tgrelid = 'public.waiter_calls'::regclass
    AND NOT t.tgisinternal
    AND (t.tgtype & 7) = 7
    AND t.tgname < 'trg_waiter_calls_autoexpire';

  IF v_bad IS NOT NULL THEN
    RAISE WARNING
      'BEFORE INSERT trigger(s) % now fire before trg_waiter_calls_autoexpire '
      'on public.waiter_calls; they see open calls the valve has not aged out '
      'yet. Rename so the valve stays first (BEFORE-row triggers fire in name '
      'order).', v_bad;
  END IF;
END
$verify$;

-- =============================================================================
-- End of migration 14.
--
-- WHAT THIS FILE CLOSES
--   F16  the pg_cron block now warns instead of whispering, records a
--        'cron.unscheduled' row in app_private.security_events, and — the part
--        that actually matters — no longer owns the liveness of §5.3: §4b's
--        trg_waiter_calls_autoexpire ages a wedged table's open call out inline,
--        so a deployment with no cron at all still cannot disable a table's
--        CALL WAITER button permanently.
--   F14  self-check (c) no longer reports the built-in EXECUTE-to-PUBLIC set as
--        if it were a live breach. It names the functions, names
--        20260901009900 as the enforcement point, and keeps real teeth in (c2),
--        which fails the chain for exactly the cases that revoke cannot repair.
--
-- STANDING CROSS-FILE REQUIREMENT (F03), asserted by check (b) above:
-- 20260901009900_privilege_baseline_reassert.sql runs
--   REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon
-- and then re-grants the public capability API. That revoke also strips the
-- EXECUTE granted above on public.order_topic_is_valid(text) — without which
-- realtime_customer_order_read raises 42501 for every customer channel instead
-- of authorizing it. Doc 02 §9.2 query (b) whitelists order_topic_is_valid by
-- name, so that file must carry
--   GRANT EXECUTE ON FUNCTION public.order_topic_is_valid(text) TO anon, authenticated;
-- and list 'order_topic_is_valid' in its own self-check whitelist. Verify with:
--   SELECT has_function_privilege('anon','public.order_topic_is_valid(text)','execute');
-- against a fully migrated database — it must return true.
-- =============================================================================
