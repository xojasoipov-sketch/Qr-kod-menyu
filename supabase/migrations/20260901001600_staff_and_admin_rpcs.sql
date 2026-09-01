-- =============================================================================
-- RESTAURANT QR OS — migration 16
-- File: 20260901001600_staff_and_admin_rpcs.sql
--
-- closes F12 — the four RPCs the application layer calls by name that exist in
-- no migration:
--
--   public.public_cancel_order(text, text, text)   doc 03 §1.4  (anon capability)
--   public.admin_rotate_table_token(uuid)          doc 02 §4.7  (staff)
--   public.staff_place_order(uuid, jsonb, text)    doc 02 §4.7  (staff)
--   public.staff_void_order_item(uuid, text)       doc 02 §4.7  (staff)
--
-- Bound to server actions by docs/architecture/05-app-structure.md:
-- cancelOrderAction (:1844), voidOrderLineAction (:1866) and
-- rotateTableTokenAction (:1904); without these functions each of those fails
-- at runtime with PostgREST PGRST202 "function not found".
--
-- Every function here is SECURITY DEFINER with `SET search_path = ''`, declares
-- its volatility, is REVOKEd from PUBLIC and granted only to the roles named in
-- the spec, and signals failure exclusively through app_private.raise_app_error
-- so the error catalogue of doc 02 §10 stays the whole of the public error
-- surface.
--
-- Reconciliation of doc 02 §4.7 against the schema doc 01 actually emitted
-- (the same reconciliation table 20260901001300_public_api.sql applies):
--   * there is no `public.qr_tokens` table — the live token is
--     public.tables.qr_token and retired tokens are rows in
--     public.qr_token_history, written by trg_tables_rotate_qr_token. Rotation
--     is therefore ONE UPDATE of tables.qr_token, not an insert/update pair.
--   * there is no app_private.generate_token(); the sanctioned token source is
--     public.generate_qr_token(18) (144 bits, base64url), used by the
--     tables.qr_token DEFAULT as well.
--   * app_role labels are UPPER_SNAKE; §4.7's lowercase
--     ('super_admin','owner','manager') are not members of public.app_role and
--     would not compile. The schema's named predicate for the front-of-house
--     order book is public.can_manage_orders(branch), which is
--     SUPER_ADMIN / RESTAURANT_OWNER / MANAGER / WAITER and deliberately
--     excludes KITCHEN.
--   * order_items carries no branch_id; the branch is read from its order.
--   * §4.7's void draft recomputes the service fee from the BRANCH's current
--     service_fee_bps. That is a latent ORD02 at COMMIT: the deferred assertion
--     trg_orders_totals_consistent recomputes from the ORDER's snapshotted
--     orders.service_fee_bps. This file uses the snapshot, so the two agree by
--     construction.
--
-- Guard-bypass protocol (doc 02 §4.7, and the F07/F13 triggers created by
-- 20260901001500_guard_triggers.sql): the immutable-column guards on
-- public.orders and public.tables short-circuit when
-- current_setting('app.guard_bypass', true) equals the table name. The two
-- writers below that need it set the GUC transaction-locally with the same key
-- and values 20260901001300_public_api.sql already uses ('app.guard_bypass' ->
-- 'orders' / 'tables') and clear it again immediately, so the window is one
-- statement wide. anon can execute nothing that sets it.
--
-- !! DEPLOYMENT NOTE (F12, second half) !!
-- 20260901009900_privilege_baseline_reassert.sql runs after this file and does
-- `REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon`, then re-grants only
-- the five public_* entry points. public.public_cancel_order(text,text,text)
-- MUST be added to that GRANT block (§2 of that file) and to the proname
-- NOT IN list of its self-check (§3), or the guest cancel path is dead at the
-- end of the chain even though the function exists. The three staff RPCs need
-- nothing there: 9900 does not revoke from `authenticated`.
--
-- Run once, in filename order. Not wrapped in an explicit transaction:
-- Supabase already runs each migration file in one.
-- =============================================================================


-- =============================================================================
-- 1. public.public_cancel_order(text, text, text) -> jsonb
--
-- doc 03 §1.4, the ONE public write doc 02 does not define. A guest withdraws
-- an order they have not been served. Brief §26 wants explicit cancellation
-- rules; brief §11 forbids customer accounts, so the only identity available is
-- the pair of bearer capabilities the guest physically holds:
--   (a) the table's QR token, resolved strictly (a revoked token may READ an
--       order for 12h but may not cancel one), and
--   (b) the order's own public_code.
-- Both must match, exactly as in public_get_order: an order code forwarded to a
-- group chat cannot cancel anything without the table's token, and the token
-- alone cannot guess a code.
--
-- The window is `pending` and nothing else: once the kitchen has accepted,
-- food and labour are committed (doc 03 §1.4 / §1841 actor matrix). That check
-- is expressed as a REFUSAL here so the guest gets QR040 with {from,to,actor},
-- and the write itself still goes THROUGH trg_orders_status_guard — no
-- app.guard_bypass is set on this path, so the status machine, the mandatory
-- cancellation_reason (ORD04) and the automatic cancelled_at stamp all apply.
-- The two raw SQLSTATEs that guard can raise are translated at the bottom so a
-- customer never sees ORD01/ORD04.
--
-- Raises: QR001 (404) · QR002/QR003/QR004 (423) · QR030_ORDER_NOT_FOUND (404)
--       · QR040_INVALID_STATUS_TRANSITION (409) · QR042_CANCEL_REASON_REQUIRED (422)
-- Returns: app_private.order_payload(order_id)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.public_cancel_order(
  p_token           TEXT,
  p_order_public_id TEXT,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  c          app_private.table_context;
  v_order_id UUID;
  v_status   public.order_status;
  v_reason   TEXT;
BEGIN
  ---------------------------------------------------------------- 1. capability
  -- Strict: p_allow_revoked = false. Cancelling is a WRITE, and §1.6's 12-hour
  -- grace for a rotated token covers the read-only tracking path only.
  c := app_private.resolve_token(p_token, false);

  ---------------------------------------------------------------- 2. the order
  IF p_order_public_id IS NULL OR p_order_public_id !~ '^[A-Za-z0-9_-]{10,32}$' THEN
    PERFORM app_private.raise_app_error('QR030_ORDER_NOT_FOUND', 404, '{}'::jsonb);
  END IF;

  -- FOR UPDATE: two taps of the cancel button, or a cancel racing a kitchen
  -- accept, are strictly ordered instead of both reading `pending`.
  SELECT o.id, o.status INTO v_order_id, v_status
  FROM public.orders o
  WHERE o.public_code = p_order_public_id
    AND o.table_id    = c.table_id             -- both capabilities, or nothing
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Wrong code, or the right code at the wrong table: identical error, so the
    -- function cannot be used to test whether a code exists (§1.13).
    PERFORM app_private.raise_app_error('QR030_ORDER_NOT_FOUND', 404, '{}'::jsonb);
  END IF;

  ---------------------------------------------------------------- 3. the window
  IF v_status <> 'pending' THEN
    PERFORM app_private.raise_app_error('QR040_INVALID_STATUS_TRANSITION', 409,
      jsonb_build_object('from', v_status, 'to', 'cancelled', 'actor', 'customer'));
  END IF;

  ---------------------------------------------------------------- 4. the reason
  -- ck_orders_cancellation_reason_len caps this at 300 characters; control
  -- characters are stripped because the value is rendered back to the guest and
  -- printed on the staff console.
  v_reason := nullif(
                btrim(left(regexp_replace(COALESCE(p_reason, ''), '[[:cntrl:]]', ' ', 'g'), 300)),
                '');

  IF v_reason IS NULL THEN
    PERFORM app_private.raise_app_error('QR042_CANCEL_REASON_REQUIRED', 422, '{}'::jsonb);
  END IF;

  ---------------------------------------------------------------- 5. the write
  -- Actor contract of trg_orders_log_status_change (01 §7.7b): the guest has no
  -- auth.users row, so kind = customer with a NULL actor and NULL role — which
  -- is exactly what ck_order_status_history_customer_actor requires, and what
  -- doc 03 §1.4 specifies.
  PERFORM set_config('app.actor_kind',       'customer', true);
  PERFORM set_config('app.actor_profile_id', '',         true);
  PERFORM set_config('app.actor_role',       '',         true);
  PERFORM set_config('app.actor_note',       v_reason,   true);

  BEGIN
    -- No app.guard_bypass here, deliberately: this UPDATE must pass through
    -- trg_orders_status_guard (transition legality + cancelled_at) and through
    -- the immutable-column guard, which leaves status and cancellation_reason
    -- writable and everything that carries money or identity closed.
    -- cancelled_by_staff_id stays NULL: no staff member cancelled this.
    UPDATE public.orders
       SET status              = 'cancelled',
           cancellation_reason = v_reason
     WHERE id = v_order_id;
  EXCEPTION
    -- Backstops. Reaching either means the checks above were outraced; a
    -- customer must never see a raw internal SQLSTATE (§10).
    WHEN sqlstate 'ORD01' THEN
      PERFORM app_private.raise_app_error('QR040_INVALID_STATUS_TRANSITION', 409,
        jsonb_build_object('from', v_status, 'to', 'cancelled', 'actor', 'customer'));
    WHEN sqlstate 'ORD04' THEN
      PERFORM app_private.raise_app_error('QR042_CANCEL_REASON_REQUIRED', 422, '{}'::jsonb);
  END;

  -- Best effort, as in public_place_order: a Realtime outage must not cost the
  -- guest their cancellation.
  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('event', 'order.cancelled', 'status', 'cancelled',
                         'public_code', p_order_public_id),
      'order.cancelled', 'order:' || p_order_public_id, true);
    PERFORM realtime.send(
      jsonb_build_object('event', 'order.cancelled', 'status', 'cancelled',
                         'public_code', p_order_public_id,
                         'table_number', c.table_number),
      'order.cancelled', 'branch:' || c.branch_id::text, true);
  EXCEPTION WHEN undefined_function OR invalid_schema_name OR insufficient_privilege THEN
    NULL;
  END;

  RETURN app_private.order_payload(v_order_id);
END;
$fn$;

REVOKE ALL     ON FUNCTION public.public_cancel_order(TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.public_cancel_order(TEXT, TEXT, TEXT) TO anon, authenticated;

COMMENT ON FUNCTION public.public_cancel_order(TEXT, TEXT, TEXT) IS
  'Doc 03 §1.4, closes F12. The sixth and last capability an anonymous guest holds: withdraw an order that is still pending. Requires BOTH the table QR token (resolved strictly — a rotated token may read an order for 12h but may not cancel one) and the order public_code, so the capability is the same one a person sitting at that table has. Goes THROUGH trg_orders_status_guard rather than around it: no app.guard_bypass is set, so the transition machine, the mandatory reason and the automatic cancelled_at stamp all still apply, and the audit row is written with changed_by_kind = customer, changed_by = NULL. Raises QR001/QR002/QR003/QR004, QR030_ORDER_NOT_FOUND, QR040_INVALID_STATUS_TRANSITION and QR042_CANCEL_REASON_REQUIRED.';


-- =============================================================================
-- 2. public.admin_rotate_table_token(uuid) -> jsonb
--
-- doc 02 §4.7. THE ONLY SANCTIONED WRITER OF public.tables.qr_token.
--
-- F13: tables.qr_token, qr_token_issued_at, qr_rotation_count, last_order_at
-- and last_waiter_call_at are frozen against direct writes by trg_tables_guard
-- (20260901001500_guard_triggers.sql), because a client-chosen token destroys
-- the 144 bits of entropy the whole /t/<token> capability rests on (§1.13,
-- §6.14) and clearing the two clocks disarms the §5.2/§5.3 cooldowns. Rotation
-- therefore cannot be `PATCH /rest/v1/tables`; it is this function, which sets
-- app.guard_bypass = 'tables' for exactly one statement.
--
-- Archival is NOT performed here: trg_tables_rotate_qr_token (01 §7.10) already
-- moves the old value into public.qr_token_history with issued_at/revoked_at
-- and bumps qr_rotation_count on any change of tables.qr_token, and
-- trg_tables_prevent_token_reuse guarantees a retired token can never come
-- back. This function's job is to authorise the rotation, mint the new token
-- from the approved source, name the revoker, and audit it.
--
-- Raises: QR030_NOT_FOUND (404, entity=table) · QR050_FORBIDDEN (403)
-- Returns: {token, path, rotation_count, issued_at}
--          (05 §5.2.8 rotateTableTokenAction consumes token + rotation_count)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.admin_rotate_table_token(p_table_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_branch     UUID;
  v_rest       UUID;
  v_actor      UUID := (SELECT auth.uid());
  v_prev_actor TEXT := COALESCE(current_setting('app.actor_profile_id', true), '');
  v_prev_note  TEXT := COALESCE(current_setting('app.actor_note', true), '');
  v_token      TEXT;
  v_issued     TIMESTAMPTZ;
  v_count      INTEGER;
BEGIN
  ---------------------------------------------------------------- 1. the table
  -- FOR UPDATE serialises two managers hitting "regenerate" at once; without it
  -- both would archive the same old token and one of the two INSERTs into
  -- qr_token_history would fail on uq_qr_token_history_token.
  SELECT t.branch_id, t.restaurant_id INTO v_branch, v_rest
  FROM public.tables t
  WHERE t.id = p_table_id
    AND t.deleted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity', 'table'));
  END IF;

  ---------------------------------------------------------------- 2. authority
  -- Branch-scoped: RESTAURANT_OWNER and MANAGER of THIS branch (02 §4.5).
  -- A WAITER or KITCHEN account, or a manager of another branch or tenant, is
  -- refused even though it is a perfectly valid authenticated session.
  -- COALESCE is load-bearing: auth_role_in_branch() returns NULL for a caller
  -- with no membership at that branch, so can_manage_tables() returns NULL, and
  -- a bare `NOT NULL` is NULL — an IF that is NOT TAKEN. Without the COALESCE an
  -- authenticated stranger would fall straight through this gate. (RLS treats a
  -- NULL USING as false, which is why the policies can omit it and this cannot.)
  IF v_actor IS NULL OR NOT COALESCE(public.can_manage_tables(v_branch), false) THEN
    PERFORM app_private.raise_app_error('QR050_FORBIDDEN', 403,
      jsonb_build_object('reason', 'cannot_manage_tables'));
  END IF;

  ---------------------------------------------------------------- 3. the token
  -- The approved source (§6.14): pgcrypto gen_random_bytes, base64url, 144 bits.
  -- Never random(), never a sequence, never derived from p_table_id.
  v_token := public.generate_qr_token(18);

  -- trg_tables_rotate_qr_token reads these two settings to fill
  -- qr_token_history.revoked_by / revoke_reason. They are transaction-local and
  -- restored below so this function cannot colour an unrelated status change
  -- later in the same transaction.
  PERFORM set_config('app.actor_profile_id', v_actor::text,             true);
  PERFORM set_config('app.actor_note',       'admin_rotate_table_token', true);

  PERFORM set_config('app.guard_bypass', 'tables', true);
  UPDATE public.tables
     SET qr_token = v_token
   WHERE id = p_table_id
  RETURNING qr_token_issued_at, qr_rotation_count INTO v_issued, v_count;
  PERFORM set_config('app.guard_bypass', '', true);

  PERFORM set_config('app.actor_profile_id', v_prev_actor, true);
  PERFORM set_config('app.actor_note',       v_prev_note,  true);

  ---------------------------------------------------------------- 4. audit
  INSERT INTO app_private.security_events (kind, actor_id, restaurant_id, branch_id, payload)
  VALUES ('qr_token.rotated', v_actor, v_rest, v_branch,
          jsonb_build_object('table_id', p_table_id, 'rotation_count', v_count));

  RETURN jsonb_build_object(
    'token',          v_token,
    'path',           '/t/' || v_token,
    'rotation_count', v_count,
    'issued_at',      v_issued);
END;
$fn$;

REVOKE ALL     ON FUNCTION public.admin_rotate_table_token(UUID) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_rotate_table_token(UUID) TO authenticated;

COMMENT ON FUNCTION public.admin_rotate_table_token(UUID) IS
  'Doc 02 §4.7, closes F12 and completes the F13 fix. The ONLY sanctioned writer of public.tables.qr_token: trg_tables_guard freezes that column (and qr_token_issued_at, qr_rotation_count and the two anti-spam clocks) against every direct write, and this function is the one caller that sets app.guard_bypass = ''tables'', for exactly one statement. Authority is can_manage_tables(branch) — RESTAURANT_OWNER and MANAGER of that branch. The new value comes from generate_qr_token(18); archival of the old token into qr_token_history, the revoked_by stamp and the rotation counter are performed by trg_tables_rotate_qr_token, and trg_tables_prevent_token_reuse makes a retired token permanently unissuable. Raises QR030_NOT_FOUND and QR050_FORBIDDEN.';


-- =============================================================================
-- 3. public.staff_place_order(uuid, jsonb, text) -> jsonb
--
-- doc 02 §4.7. A waiter or manager entering a phone / walk-in / verbal order on
-- behalf of a table.
--
-- The pricing loop is NOT reimplemented here. Doc 02 §6.2 ("never let a price,
-- subtotal, service fee or total arrive from a client") and §6.24 ("never
-- bypass the rate limiter for staff-entered orders") both rest on there being
-- exactly ONE order writer to audit: public.public_place_order, which reads
-- every amount from menu_items / menu_item_options under FOR SHARE, re-checks
-- the binding orderability rule per line, and applies the per-table and
-- per-branch limits. This function is a capability wrapper around it:
-- authorise, hand it the table's live token, then stamp the two facts that
-- differ for a staff-entered order (channel + who entered it).
--
-- KITCHEN cannot reach this: can_manage_orders() is
-- SUPER_ADMIN / RESTAURANT_OWNER / MANAGER / WAITER by construction (02 §4.5).
--
-- Raises: everything public_place_order raises, plus
--         QR030_NOT_FOUND (404, entity=table) · QR050_FORBIDDEN (403)
-- Returns: app_private.order_payload(order_id), channel already 'waiter'
-- =============================================================================

CREATE OR REPLACE FUNCTION public.staff_place_order(
  p_table_id UUID,
  p_items    JSONB,
  p_note     TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_branch     UUID;
  v_rest       UUID;
  v_token      TEXT;
  v_actor      UUID := (SELECT auth.uid());
  v_staff_id   UUID;
  v_payload    JSONB;
  v_public     TEXT;
  v_order_id   UUID;
BEGIN
  ---------------------------------------------------------------- 1. the table
  -- doc 01 has no qr_tokens table; the live token is tables.qr_token.
  SELECT t.branch_id, t.restaurant_id, t.qr_token INTO v_branch, v_rest, v_token
  FROM public.tables t
  WHERE t.id = p_table_id
    AND t.deleted_at IS NULL;

  IF NOT FOUND THEN
    PERFORM app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity', 'table'));
  END IF;

  ---------------------------------------------------------------- 2. authority
  -- COALESCE: can_manage_orders() is NULL, not false, for a caller with no
  -- membership at this branch, and `NOT NULL` is an IF that is not taken.
  IF v_actor IS NULL OR NOT COALESCE(public.can_manage_orders(v_branch), false) THEN
    PERFORM app_private.raise_app_error('QR050_FORBIDDEN', 403,
      jsonb_build_object('reason', 'cannot_manage_orders'));
  END IF;

  -- The acting membership, for the audit row below. Composite (restaurant, id)
  -- so a colleague's row from another tenant can never be named here.
  SELECT s.id INTO v_staff_id
  FROM public.staff s
  WHERE s.profile_id    = v_actor
    AND s.restaurant_id = v_rest
    AND s.is_active
    AND (s.branch_id IS NULL OR s.branch_id = v_branch)
  ORDER BY s.branch_id NULLS LAST
  LIMIT 1;

  ---------------------------------------------------------------- 3. the engine
  -- One pricing implementation, one place to audit (§4.7). A fresh
  -- client_request_id per call: the idempotency key belongs to a cart, and a
  -- waiter re-entering an order is a new cart, not a retry.
  v_payload := public.public_place_order(
                 v_token, p_items, p_note, pg_catalog.gen_random_uuid());

  ---------------------------------------------------------------- 4. the stamp
  v_public := v_payload ->> 'public_code';

  SELECT o.id INTO v_order_id
  FROM public.orders o
  WHERE o.public_code = v_public;

  IF FOUND THEN
    -- channel is not in the immutable set of trg_orders_guard, but the guard is
    -- a whole-row BEFORE UPDATE trigger, so the bypass is still declared for
    -- the one statement — the same protocol public_place_order uses for its own
    -- totals write.
    PERFORM set_config('app.guard_bypass', 'orders', true);
    UPDATE public.orders
       SET channel = 'waiter'
     WHERE id = v_order_id;
    PERFORM set_config('app.guard_bypass', '', true);

    -- Who entered it. order_status_history's creation row is written inside
    -- public_place_order with changed_by_kind = 'customer' and that table is
    -- append-only (trg_order_status_history_immutable), so the staff identity
    -- is recorded in the §4.8 audit sink instead of being back-patched into an
    -- audit trail. orders has no "entered_by" column to reconcile against;
    -- confirmed_by/served_by/cancelled_by_staff_id all mean something else.
    INSERT INTO app_private.security_events (kind, actor_id, restaurant_id, branch_id, payload)
    VALUES ('order.staff_placed', v_actor, v_rest, v_branch,
            jsonb_build_object('order_id',     v_order_id,
                               'order_number', v_payload ->> 'order_number',
                               'table_id',     p_table_id,
                               'staff_id',     v_staff_id,
                               'total',        v_payload -> 'total'));

    RETURN app_private.order_payload(v_order_id);
  END IF;

  RETURN v_payload;
END;
$fn$;

REVOKE ALL     ON FUNCTION public.staff_place_order(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.staff_place_order(UUID, JSONB, TEXT) TO authenticated;

COMMENT ON FUNCTION public.staff_place_order(UUID, JSONB, TEXT) IS
  'Doc 02 §4.7, closes F12. A waiter or manager entering an order for a table. Delegates the whole pricing path to public_place_order so there is exactly one server-side pricing implementation to audit (§6.2) and so the per-table and per-branch rate limits still apply (§6.24) — the only differences are order_channel = waiter and an app_private.security_events row naming the acting staff member. Table identity is a parameter here rather than a QR token because the actor is authenticated, but authority is still branch-scoped: can_manage_orders(branch), which excludes KITCHEN by construction. Raises QR030_NOT_FOUND and QR050_FORBIDDEN on top of everything public_place_order raises.';


-- =============================================================================
-- 4. public.staff_void_order_item(uuid, text) -> jsonb
--
-- doc 02 §4.7 and §6.8. `authenticated` holds NO INSERT/UPDATE/DELETE on
-- public.order_items or public.order_item_options and neither table has a write
-- policy for any role, so this function is the ONLY way a line can leave an
-- order. Keep it that way: the snapshot columns are the historical record
-- (brief §25, §34.4), so a correction is a DELETE plus a re-derivation of the
-- totals, never an edit of a snapshot.
--
-- The totals are re-derived server-side from the surviving lines and from the
-- ORDER's snapshotted service_fee_bps — not from the branch's current rate —
-- because that is exactly what the deferred assertion
-- trg_orders_totals_consistent recomputes at COMMIT. Using the live branch rate
-- (as §4.7's draft does) would raise ORD02 on any order placed before a fee
-- change.
--
-- Voiding the LAST line is refused rather than attempted: an order with zero
-- lines is an illegal state (ORD03), and the operation the user wants there is
-- cancelling the order.
--
-- Raises: QR030_NOT_FOUND (404, entity=order_item) · QR050_FORBIDDEN (403)
--       · QR043_ORDER_CLOSED (409, status) · QR023_INVALID_PAYLOAD (422)
-- Returns: the order document, whose top-level subtotal / service_fee / total
--          are the recomputed amounts (05 §5.2.5 voidOrderLineAction -> OrderView)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.staff_void_order_item(
  p_order_item_id UUID,
  p_reason        TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_oi       public.order_items%ROWTYPE;
  v_order    public.orders%ROWTYPE;
  v_actor    UUID := (SELECT auth.uid());
  v_lines    INTEGER;
  v_sub      BIGINT;
  v_fee      BIGINT;
  v_reason   TEXT;
BEGIN
  ---------------------------------------------------------------- 1. the line
  SELECT * INTO v_oi
  FROM public.order_items oi
  WHERE oi.id = p_order_item_id;

  IF NOT FOUND THEN
    PERFORM app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity', 'order_item'));
  END IF;

  -- FOR UPDATE on the parent: two waiters voiding two lines of the same order
  -- concurrently must not both recompute the subtotal from a stale read.
  SELECT * INTO v_order
  FROM public.orders o
  WHERE o.id = v_oi.order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    PERFORM app_private.raise_app_error('QR030_NOT_FOUND', 404,
      jsonb_build_object('entity', 'order'));
  END IF;

  ---------------------------------------------------------------- 2. authority
  -- order_items carries no branch_id (doc 01); the branch comes from the order.
  -- COALESCE: NULL (no membership) must read as false, not as "not taken".
  IF v_actor IS NULL OR NOT COALESCE(public.can_manage_orders(v_order.branch_id), false) THEN
    PERFORM app_private.raise_app_error('QR050_FORBIDDEN', 403,
      jsonb_build_object('reason', 'cannot_manage_orders'));
  END IF;

  ---------------------------------------------------------------- 3. the window
  -- A line may still change while the order is open. Once the order is
  -- completed or cancelled its money is history and is not re-derivable.
  IF v_order.status IN ('completed', 'cancelled') THEN
    PERFORM app_private.raise_app_error('QR043_ORDER_CLOSED', 409,
      jsonb_build_object('status', v_order.status));
  END IF;

  SELECT count(*) INTO v_lines
  FROM public.order_items oi
  WHERE oi.order_id = v_oi.order_id;

  IF v_lines <= 1 THEN
    -- assert_order_totals_consistent (ORD03) would reject this at COMMIT, as an
    -- empty order is an illegal state rather than a zero-total order. Say so up
    -- front, in the public vocabulary.
    PERFORM app_private.raise_app_error('QR023_INVALID_PAYLOAD', 422,
      jsonb_build_object('field',  'p_order_item_id',
                         'reason', 'last_line_of_order',
                         'hint',   'cancel_the_order_instead'));
  END IF;

  v_reason := nullif(
                btrim(left(regexp_replace(COALESCE(p_reason, ''), '[[:cntrl:]]', ' ', 'g'), 200)),
                '');

  ---------------------------------------------------------------- 4. the void
  DELETE FROM public.order_item_options WHERE order_item_id = p_order_item_id;
  DELETE FROM public.order_items        WHERE id            = p_order_item_id;

  ---------------------------------------------------------------- 5. re-derive
  -- Read the surviving lines back from the GENERATED order_items.total column,
  -- so the number written here is the same number the deferred assertion will
  -- recompute at COMMIT. Integers throughout; numeric is only the intermediate
  -- of the rounding division, exactly as in public_place_order.
  SELECT COALESCE(sum(oi.total), 0)::bigint INTO v_sub
  FROM public.order_items oi
  WHERE oi.order_id = v_oi.order_id;

  v_fee := round(
             ((v_sub - v_order.discount_total)::numeric * v_order.service_fee_bps) / 10000
           )::bigint;

  PERFORM set_config('app.guard_bypass', 'orders', true);
  UPDATE public.orders
     SET subtotal    = v_sub,
         service_fee = v_fee,
         total       = v_sub - v_order.discount_total + v_fee,
         updated_at  = now()
   WHERE id = v_order.id;
  PERFORM set_config('app.guard_bypass', '', true);

  ---------------------------------------------------------------- 6. audit
  INSERT INTO app_private.security_events (kind, actor_id, restaurant_id, branch_id, payload)
  VALUES ('order_item.voided', v_actor, v_oi.restaurant_id, v_order.branch_id,
          jsonb_build_object('order_id',      v_oi.order_id,
                             'order_item_id', p_order_item_id,
                             'name',          v_oi.name_snapshot::jsonb,
                             'quantity',      v_oi.quantity,
                             'total',         v_oi.total,
                             'reason',        v_reason));

  BEGIN
    PERFORM realtime.send(
      jsonb_build_object('event', 'order.updated', 'order_number', v_order.order_number,
                         'status', v_order.status, 'total', v_sub - v_order.discount_total + v_fee),
      'order.updated', 'branch:' || v_order.branch_id::text, true);
  EXCEPTION WHEN undefined_function OR invalid_schema_name OR insufficient_privilege THEN
    NULL;
  END;

  -- The three keys doc 02 §4.7 names, on top of the customer-facing order
  -- document the staff console re-renders from.
  RETURN app_private.order_payload(v_order.id)
         || jsonb_build_object('subtotal',    v_sub,
                               'service_fee', v_fee,
                               'total',       v_sub - v_order.discount_total + v_fee);
END;
$fn$;

REVOKE ALL     ON FUNCTION public.staff_void_order_item(UUID, TEXT) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.staff_void_order_item(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.staff_void_order_item(UUID, TEXT) IS
  'Doc 02 §4.7 and §6.8, closes F12. The ONLY path by which a line leaves an order: authenticated holds no INSERT/UPDATE/DELETE on order_items or order_item_options and neither table has a write policy, so a correction cannot be an edit of a snapshot — it is a DELETE plus a server-side re-derivation of the order totals. The fee is recomputed from the ORDER''s snapshotted service_fee_bps, which is what the deferred assertion trg_orders_totals_consistent checks at COMMIT; using the branch''s current rate would raise ORD02 on any order older than a fee change. Voiding the last line is refused because an order with no lines is an illegal state (ORD03) — cancel the order instead. Raises QR030_NOT_FOUND, QR050_FORBIDDEN, QR043_ORDER_CLOSED and QR023_INVALID_PAYLOAD.';


-- =============================================================================
-- 5. Self-check — the four functions exist with the exact signatures the app
--    calls, are SECURITY DEFINER with a pinned search_path, and are reachable
--    by the right roles and by nobody else.
-- =============================================================================

DO $$
DECLARE
  v_bad TEXT;
BEGIN
  SELECT string_agg(sig, ', ') INTO v_bad
  FROM (
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('public_cancel_order', 'admin_rotate_table_token',
                        'staff_place_order', 'staff_void_order_item')
      AND (NOT p.prosecdef
           OR p.proconfig IS NULL
           OR NOT ('search_path=' = ANY (SELECT left(c, 12) FROM unnest(p.proconfig) c)))
  ) q;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'F12 RPCs not SECURITY DEFINER with a pinned search_path: %', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF to_regprocedure('public.public_cancel_order(text,text,text)')      IS NULL
     OR to_regprocedure('public.admin_rotate_table_token(uuid)')        IS NULL
     OR to_regprocedure('public.staff_place_order(uuid,jsonb,text)')    IS NULL
     OR to_regprocedure('public.staff_void_order_item(uuid,text)')      IS NULL THEN
    RAISE EXCEPTION 'F12 RPC signature missing: the application calls these by name'
      USING ERRCODE = 'undefined_function';
  END IF;

  -- anon may reach the guest cancel and nothing else here.
  IF has_function_privilege('anon', 'public.admin_rotate_table_token(uuid)',     'execute')
     OR has_function_privilege('anon', 'public.staff_place_order(uuid,jsonb,text)',  'execute')
     OR has_function_privilege('anon', 'public.staff_void_order_item(uuid,text)',    'execute') THEN
    RAISE EXCEPTION 'privilege baseline violated: anon may execute a staff RPC'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT has_function_privilege('anon', 'public.public_cancel_order(text,text,text)', 'execute') THEN
    RAISE EXCEPTION 'public_cancel_order must be executable by anon (doc 03 §1.4)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.admin_rotate_table_token(uuid)',    'execute')
     OR NOT has_function_privilege('authenticated', 'public.staff_place_order(uuid,jsonb,text)', 'execute')
     OR NOT has_function_privilege('authenticated', 'public.staff_void_order_item(uuid,text)',   'execute')
     OR NOT has_function_privilege('authenticated', 'public.public_cancel_order(text,text,text)','execute') THEN
    RAISE EXCEPTION 'staff RPCs must be executable by authenticated'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
