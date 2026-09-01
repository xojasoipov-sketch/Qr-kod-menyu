-- =============================================================================
-- Restaurant QR OS — 15. Guard triggers and the role-aware order state machine
--
-- Implements docs/architecture/02-security-and-rls.md §3.17 and §3.18, which
-- every earlier migration already assumes exists:
--
--   * 20260901001100_authz_helpers.sql — the COMMENT on can_manage_staff() says
--     the anti-escalation rules live in trg_staff_guard().
--   * 20260901001200_rls_policies.sql  — five table-wide GRANTs (profiles,
--     staff, orders, menu_items, tables, notifications) carry the comment
--     "guarded by trigger" and name the §3.18 functions. Until this file, those
--     triggers existed in no migration, so the GRANTs were entirely unguarded.
--   * 20260901001300_public_api.sql    — public_place_order (line ~916, ~926)
--     and public_call_waiter (line ~1122) already execute the guard-bypass
--     protocol these triggers are specified to read:
--         PERFORM set_config('app.guard_bypass', 'orders', true);   -- money
--         PERFORM set_config('app.guard_bypass', 'tables', true);   -- clocks
--         PERFORM set_config('app.guard_bypass', '',       true);   -- release
--
-- WHY TRIGGERS AND NOT RLS: RLS decides which ROWS a role may see and write. It
-- cannot say "you may change THIS COLUMN but not that one", and it cannot
-- compare OLD to NEW. Every invariant below is one of those two shapes.
--
-- Closes F05, F06, F07, F08, F09, F11 and F13 of docs/audit/01-database-findings.md.
--
-- NOTE ON public.orders_status_guard(): that function is created by
-- 20260901000800_functions_triggers.sql, which this file deliberately does NOT
-- edit (exclusive file ownership). §3.17/§3.18 require the guard to be actor
-- aware, so this migration supersedes the BODY with CREATE OR REPLACE FUNCTION.
-- This file sorts after 000800, so this definition is the one that survives the
-- chain. The trigger object trg_orders_status_guard created in 000800 keeps
-- pointing at the same function OID and therefore picks the new body up with no
-- further change. Everything 000800's version did (graph check, lifecycle
-- timestamps, mandatory cancellation reason) is preserved verbatim below, plus
-- the actor stamping F10 asks for, so replacing it regresses nothing.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §0. Who is exempt from the guards
--
-- Every guard below must let service_role and direct administrative connections
-- (migrations, seeds, pg_cron jobs, psql) through untouched, while enforcing
-- against anon and authenticated — including when they are inside one of the
-- SECURITY DEFINER public_* RPCs, which is exactly why those RPCs use the
-- app.guard_bypass protocol instead of relying on being SECURITY DEFINER.
--
-- HOW: a SECURITY DEFINER frame swaps current_user for the function owner, so
-- current_user is useless here. PostgREST issues `SET LOCAL ROLE <jwt role>` on
-- every request, and the `role` GUC is NOT reset when entering a SECURITY
-- DEFINER function (verified on this cluster), so it is the one reliable view of
-- who is actually driving the statement.
--
--   role GUC = 'service_role'                  -> exempt (trusted backend)
--   role GUC = 'anon' / 'authenticated'        -> ENFORCED (a client request)
--   role GUC = 'none' (no SET ROLE at all)     -> exempt only if the session
--                                                 user is a superuser or holds
--                                                 BYPASSRLS, i.e. a direct
--                                                 owner/admin connection
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_private.guard_actor_is_exempt()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT CASE COALESCE(pg_catalog.current_setting('role', true), 'none')
    WHEN 'service_role'  THEN true
    WHEN 'anon'          THEN false
    WHEN 'authenticated' THEN false
    ELSE EXISTS (
      SELECT 1 FROM pg_catalog.pg_roles r
      WHERE r.rolname = session_user
        AND (r.rolsuper OR r.rolbypassrls))
  END;
$fn$;

REVOKE ALL ON FUNCTION app_private.guard_actor_is_exempt()
  FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION app_private.guard_actor_is_exempt() IS
  'The single exemption predicate of the §3.18 guard triggers. True for service_role and for direct superuser/BYPASSRLS connections; false for every anon and authenticated request, including inside a SECURITY DEFINER RPC (those use the app.guard_bypass GUC instead). Reads the `role` GUC rather than current_user because a SECURITY DEFINER frame rewrites current_user to the function owner. Closes the service_role-exemption requirement of F05-F09, F11, F13.';


-- =============================================================================
-- §1. public.trg_profiles_guard()  —  BEFORE UPDATE ON public.profiles
--
-- Closes F05 (PRIVILEGE ESCALATION TO PLATFORM ADMIN).
--
-- 20260901001200_rls_policies.sql grants UPDATE on public.profiles to
-- authenticated with no column list, and profiles_update_self admits the
-- caller's own row. Without this trigger public.profiles.is_platform_admin is a
-- plain client-writable boolean: any authenticated staff member (a KITCHEN
-- account is enough) could PATCH their own row with {"is_platform_admin": true},
-- after which public.is_super_admin() returns true and every has_*/can_manage_*
-- helper short-circuits true for EVERY tenant. profiles_update_manager made it
-- worse: a MANAGER could set the flag on a colleague.
--
-- Rules:
--   1. id is immutable (it is the auth.users FK and the identity of the row).
--   2. is_platform_admin may only be changed by an existing platform admin, and
--      NEVER on their own row — no self-promotion, and no self-demotion that
--      would lock the platform out of its last admin.
--   3. is_active may not be flipped on your own row (self-lockout / self-revive).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_profiles_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF app_private.guard_actor_is_exempt() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- 1. Identity is immutable.
  IF NEW.id IS DISTINCT FROM OLD.id THEN
    PERFORM app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table', 'profiles', 'column', 'id'));
  END IF;

  -- 2. The platform-admin flag: admins only, never on your own row.
  IF NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin THEN
    IF NOT public.is_super_admin() OR OLD.id = (SELECT auth.uid()) THEN
      PERFORM app_private.raise_app_error('QR052_FORBIDDEN_FIELD', 403,
        jsonb_build_object('field', 'is_platform_admin'));
    END IF;
  END IF;

  -- 3. No self-deactivation / self-reactivation.
  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     AND OLD.id = (SELECT auth.uid())
     AND NOT public.is_super_admin() THEN
    PERFORM app_private.raise_app_error('QR052_FORBIDDEN_FIELD', 403,
      jsonb_build_object('field', 'is_active'));
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_profiles_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_profiles_guard ON public.profiles;

CREATE TRIGGER trg_profiles_guard
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.trg_profiles_guard();

COMMENT ON FUNCTION public.trg_profiles_guard() IS
  'Doc 02 §3.18. Defends the platform-admin boundary that RLS structurally cannot: profiles.id is immutable, and profiles.is_platform_admin may be changed only by an existing platform admin and never on their own row (no self-promotion, no self-demotion lockout). Closes F05.';


-- =============================================================================
-- §2. public.trg_staff_guard()  —  BEFORE INSERT OR UPDATE OR DELETE ON public.staff
--
-- Closes F06 (PRIVILEGE ESCALATION MANAGER -> OWNER, AND LAST-OWNER REMOVAL).
--
-- staff_insert_manager / staff_update_manager / staff_delete_manager are all
-- gated on can_manage_staff(restaurant_id), which is true for MANAGER, and the
-- GRANT is table-wide. Without this trigger a MANAGER could
--   (1) INSERT {profile_id: self, branch_id: null, role: RESTAURANT_OWNER},
--   (2) PATCH their own membership row to RESTAURANT_OWNER, and
--   (3) DELETE every RESTAURANT_OWNER row, leaving the tenant unadministrable.
--
-- Rules (§3.18, reconciled to this schema's binding identifiers: profile_id
-- rather than user_id, and the UPPER_SNAKE public.app_role labels):
--   0. Platform admins and exempt roles pass through.
--   1. The actor must be an active RESTAURANT_OWNER or MANAGER of the very
--      restaurant the row belongs to.
--   2. Nobody may grant a role at or above their own rank. A MANAGER may
--      therefore mint only WAITER and KITCHEN.
--   3. Nobody edits or deletes their own membership row (self-promotion and
--      self-demotion both).
--   4. profile_id and restaurant_id of a membership row are immutable — a row
--      may not be re-pointed at another person or another tenant.
--   5. A restaurant must always retain at least one ACTIVE RESTAURANT_OWNER.
--
-- NEW is unassigned on DELETE and OLD is unassigned on INSERT, so neither is
-- ever dereferenced without a TG_OP test.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_staff_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor_role  public.app_role;
  v_target_role public.app_role;
  v_restaurant  uuid;
  v_rank        CONSTANT public.app_role[] :=
                  ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_target_role := OLD.role;
    v_restaurant  := OLD.restaurant_id;
  ELSE
    v_target_role := NEW.role;
    v_restaurant  := NEW.restaurant_id;
  END IF;

  -- 0. service_role, direct admin connections and platform admins are exempt.
  IF app_private.guard_actor_is_exempt() OR public.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    IF TG_OP = 'UPDATE' THEN NEW.updated_at := now(); END IF;
    RETURN NEW;
  END IF;

  -- 1. Only staff managers of THIS restaurant may touch its membership rows.
  v_actor_role := public.auth_role_in_restaurant(v_restaurant);

  IF v_actor_role IS NULL
     OR v_actor_role NOT IN ('RESTAURANT_OWNER', 'MANAGER') THEN
    PERFORM app_private.raise_app_error('QR050_FORBIDDEN', 403,
      jsonb_build_object('reason', 'not_staff_manager'));
  END IF;

  -- 2. Never grant a role at or above your own rank. array_position on v_rank
  --    gives 1 for RESTAURANT_OWNER .. 4 for KITCHEN, so "lower position" means
  --    "more powerful". The second arm additionally stops a MANAGER cloning
  --    their own rank, which the first arm alone would permit.
  IF array_position(v_rank, v_target_role) < array_position(v_rank, v_actor_role)
     OR (v_actor_role = 'MANAGER'
         AND v_target_role IN ('RESTAURANT_OWNER', 'MANAGER')) THEN
    PERFORM app_private.raise_app_error('QR055_PRIVILEGE_ESCALATION', 403,
      jsonb_build_object('actor', v_actor_role, 'target', v_target_role));
  END IF;

  -- 3. Nobody edits their own membership row.
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.profile_id = (SELECT auth.uid()) THEN
    PERFORM app_private.raise_app_error('QR056_SELF_MODIFICATION', 403, '{}'::jsonb);
  END IF;

  -- 4. Tenancy and subject of a membership row are immutable.
  IF TG_OP = 'UPDATE'
     AND (NEW.profile_id    IS DISTINCT FROM OLD.profile_id
          OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id) THEN
    PERFORM app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table', 'staff',
        'hint_fields', jsonb_build_array('profile_id', 'restaurant_id')));
  END IF;

  -- 5. The last active owner may be neither deleted, demoted nor deactivated.
  --    Without this, a tenant can be left with nobody who can manage settings,
  --    branches, currency or the service fee.
  IF (TG_OP = 'DELETE' AND OLD.role = 'RESTAURANT_OWNER')
     OR (TG_OP = 'UPDATE' AND OLD.role = 'RESTAURANT_OWNER'
         AND (NEW.role <> 'RESTAURANT_OWNER' OR NEW.is_active = false)) THEN
    IF (SELECT count(*) FROM public.staff s
         WHERE s.restaurant_id = OLD.restaurant_id
           AND s.role = 'RESTAURANT_OWNER'
           AND s.is_active
           AND s.id <> OLD.id) = 0 THEN
      PERFORM app_private.raise_app_error('QR051_LAST_OWNER', 409,
        jsonb_build_object('restaurant_id', OLD.restaurant_id));
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_staff_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_staff_guard ON public.staff;

CREATE TRIGGER trg_staff_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.trg_staff_guard();

COMMENT ON FUNCTION public.trg_staff_guard() IS
  'Doc 02 §3.18. The anti-escalation half of staff management that RLS cannot express: no MANAGER may mint or promote a RESTAURANT_OWNER (or another MANAGER), nobody may edit their own membership row, profile_id/restaurant_id are immutable, and a restaurant always keeps at least one active RESTAURANT_OWNER. Platform admins and service_role are exempt. Closes F06.';


-- =============================================================================
-- §3. public.trg_orders_guard()  —  BEFORE UPDATE ON public.orders
--
-- Closes F07 (ORDER MONEY AND IDENTITY ARE CLIENT-WRITABLE BY STAFF).
--
-- orders_update_staff restricts only the ROW (can_manage_orders(branch_id) OR
-- the branch KITCHEN), and the GRANT carries no column list. Without this
-- trigger a WAITER of the branch could PATCH
--     {discount_total: <subtotal>, service_fee: 0, total: 0}
-- and satisfy ck_orders_totals_arithmetic, ck_orders_discount_within_subtotal
-- and the deferred trg_orders_totals_consistent all at once — the bill is zero
-- and every constraint agrees. The same PATCH could rewrite table_id,
-- public_code, order_number, created_at (moving the order in or out of the
-- kitchen's 24h window and public_get_order's 24h horizon), and
-- client_request_id / payload_fingerprint (silently breaking the §5.2
-- idempotency and duplicate-payload guards).
--
-- Money and identity are therefore write-once. The ONLY writer allowed to move
-- them after INSERT is the pricing path inside the SECURITY DEFINER RPCs, which
-- announces itself with the documented GUC protocol
--     PERFORM set_config('app.guard_bypass', 'orders', true);
-- exactly as public_place_order does at 20260901001300_public_api.sql:916.
-- A PostgREST client cannot issue a bare SET, and no anon- or authenticated-
-- executable routine sets that GUC on the caller's behalf.
--
-- Staff keep the operational columns: status (further constrained by
-- orders_status_guard below), cancellation_reason, the *_by_staff_id stamps,
-- guest_count, customer_name/phone/note, estimated_prep_minutes, due_at and the
-- lifecycle timestamps.
--
-- Trigger NAME matters: PostgreSQL fires BEFORE ROW triggers in name order, and
-- 'trg_orders_guard' < 'trg_orders_set_updated_at' < 'trg_orders_status_guard',
-- so immutability is asserted before anything else can rewrite NEW.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_orders_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  -- The pricing RPCs (SECURITY DEFINER, owned by postgres) announce themselves.
  IF COALESCE(pg_catalog.current_setting('app.guard_bypass', true), '') = 'orders'
     OR app_private.guard_actor_is_exempt() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id                  IS DISTINCT FROM OLD.id
     OR NEW.restaurant_id       IS DISTINCT FROM OLD.restaurant_id
     OR NEW.branch_id           IS DISTINCT FROM OLD.branch_id
     OR NEW.table_id            IS DISTINCT FROM OLD.table_id
     OR NEW.order_number        IS DISTINCT FROM OLD.order_number
     OR NEW.order_seq           IS DISTINCT FROM OLD.order_seq
     OR NEW.business_date       IS DISTINCT FROM OLD.business_date
     OR NEW.public_code         IS DISTINCT FROM OLD.public_code
     OR NEW.client_request_id   IS DISTINCT FROM OLD.client_request_id
     OR NEW.payload_fingerprint IS DISTINCT FROM OLD.payload_fingerprint
     OR NEW.customer_session_id IS DISTINCT FROM OLD.customer_session_id
     OR NEW.subtotal            IS DISTINCT FROM OLD.subtotal
     OR NEW.discount_total      IS DISTINCT FROM OLD.discount_total
     OR NEW.service_fee         IS DISTINCT FROM OLD.service_fee
     OR NEW.service_fee_bps     IS DISTINCT FROM OLD.service_fee_bps
     OR NEW.total               IS DISTINCT FROM OLD.total
     OR NEW.currency            IS DISTINCT FROM OLD.currency
     OR NEW.currency_decimals   IS DISTINCT FROM OLD.currency_decimals
     OR NEW.placed_at           IS DISTINCT FROM OLD.placed_at
     OR NEW.created_at          IS DISTINCT FROM OLD.created_at
  THEN
    PERFORM app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table', 'orders',
        'hint_fields', jsonb_build_array(
          'id', 'restaurant_id', 'branch_id', 'table_id', 'order_number',
          'order_seq', 'business_date', 'public_code', 'client_request_id',
          'payload_fingerprint', 'customer_session_id', 'subtotal',
          'discount_total', 'service_fee', 'service_fee_bps', 'total',
          'currency', 'currency_decimals', 'placed_at', 'created_at')));
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_orders_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_orders_guard ON public.orders;

CREATE TRIGGER trg_orders_guard
  BEFORE UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.trg_orders_guard();

COMMENT ON FUNCTION public.trg_orders_guard() IS
  'Doc 02 §3.18 and §1.3/§6.2. Order money (subtotal, discount_total, service_fee, service_fee_bps, total, currency, currency_decimals), order identity (id, restaurant_id, branch_id, table_id, order_number, order_seq, business_date, public_code), the idempotency keys (client_request_id, payload_fingerprint, customer_session_id) and the audit anchors (placed_at, created_at) are write-once. Only the SECURITY DEFINER pricing RPCs may move them, and only while app.guard_bypass = ''orders''. Closes F07.';


-- =============================================================================
-- §4. public.trg_menu_items_guard()  —  BEFORE UPDATE ON public.menu_items
--
-- Closes F09 (KITCHEN STAFF CAN REWRITE MENU PRICES).
--
-- menu_items_update_menu_or_kitchen admits auth_role_in_branch(branch_id) =
-- 'KITCHEN' in both USING and WITH CHECK for the WHOLE row, and the GRANT has no
-- column list. Without this trigger a KITCHEN account could PATCH
-- {"price": 1} and the next public_place_order would snapshot that price inside
-- its SECURITY DEFINER pricing loop — doc 02 §1.3's "prices are read
-- server-side" is defeated one level down, because the server-side source of
-- truth is itself client-writable by the lowest-privileged staff role.
--
-- §3.18 is explicit: kitchen staff may toggle availability AND NOTHING ELSE.
-- The allow-list is deliberately just is_available (plus updated_at, which is
-- machine-set): 86-ing a dish is the whole of the kitchen's menu authority.
-- Roles that pass can_manage_menu() are unaffected by the second block.
--
-- Identity/tenancy immutability in the first block applies to EVERY client role,
-- because moving a dish between branches or restaurants would carry its price
-- history and its order-item references with it.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_menu_items_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF app_private.guard_actor_is_exempt() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id            IS DISTINCT FROM OLD.id
     OR NEW.restaurant_id IS DISTINCT FROM OLD.restaurant_id
     OR NEW.branch_id     IS DISTINCT FROM OLD.branch_id THEN
    PERFORM app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table', 'menu_items',
        'hint_fields', jsonb_build_array('id', 'restaurant_id', 'branch_id')));
  END IF;

  IF public.auth_role_in_branch(OLD.branch_id) = 'KITCHEN'
     AND NOT public.can_manage_menu(OLD.restaurant_id) THEN
    -- Whole-row diff: any column other than the allow-listed ones is a rejection,
    -- so a column added by a future migration is closed by default rather than
    -- silently opened.
    --
    -- search_vector must be excluded, and excluding it is safe. It is a STORED
    -- GENERATED column, and PostgreSQL computes generated columns AFTER all
    -- BEFORE ROW triggers have run, so NEW.search_vector is always NULL here
    -- while OLD.search_vector holds the stored tsvector — every single UPDATE
    -- would otherwise look like a forbidden column change. It is not a hole:
    -- the column is derived from name/description/ingredients, all of which
    -- this same diff protects, and a client cannot write it at all.
    IF to_jsonb(NEW) - 'is_available' - 'updated_at' - 'search_vector'
       IS DISTINCT FROM
       to_jsonb(OLD) - 'is_available' - 'updated_at' - 'search_vector' THEN
      PERFORM app_private.raise_app_error('QR054_COLUMN_NOT_ALLOWED', 403,
        jsonb_build_object('table', 'menu_items',
          'allowed', jsonb_build_array('is_available')));
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_menu_items_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_menu_items_guard ON public.menu_items;

CREATE TRIGGER trg_menu_items_guard
  BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.trg_menu_items_guard();

COMMENT ON FUNCTION public.trg_menu_items_guard() IS
  'Doc 02 §3.18. The column half of menu_items_update_menu_or_kitchen: a KITCHEN account may toggle is_available and nothing else, so it cannot rewrite price, name, category_id or preparation_time and thereby poison the server-side pricing snapshot public_place_order takes. id/restaurant_id/branch_id are immutable for every client role. Closes F09.';


-- =============================================================================
-- §5. public.trg_tables_guard()  —  BEFORE UPDATE ON public.tables
--
-- Closes F13 (QR TOKEN IS CLIENT-CHOSEN, AND THE PER-TABLE RATE-LIMIT CLOCKS
-- ARE CLIENT-RESETTABLE).
--
-- tables_update_manager is row-scoped only and the GRANT is table-wide, so
-- without this trigger a MANAGER of the branch could
--   (1) PATCH {"qr_token": "aaaaaaaaaaaaaaaaaaaaaa"} — ck_tables_qr_token_format
--       only demands 22-64 base64url characters, so doc 02 §1.13's "128 bits,
--       never sequential, never derived from ids" becomes a client-supplied and
--       therefore guessable string, and /t/<token> lets anyone order and call
--       waiters as that table; and
--   (2) PATCH {"last_order_at": null, "last_waiter_call_at": null} — clearing
--       the two cooldown clocks that public_place_order and public_call_waiter
--       read under SELECT ... FOR UPDATE, making the §5.2 20s order cooldown and
--       the §5.3 90s waiter-call cooldown unenforceable.
--
-- qr_token_issued_at and qr_rotation_count are protected with it: they are the
-- rotation audit trail written by trg_tables_rotate_qr_token, and a client that
-- could forge them could hide a rotation.
--
-- The three legitimate writers all announce themselves with
--     PERFORM set_config('app.guard_bypass', 'tables', true);
-- exactly as 20260901001300_public_api.sql already does at line 926
-- (public_place_order stamping last_order_at) and line 1122 (public_call_waiter
-- stamping last_waiter_call_at). The token-rotation RPC (§4.7
-- admin_rotate_table_token, added by the F12 migration) uses the same protocol.
-- Note the GUC key and value are read here EXACTLY as those call sites write
-- them: key 'app.guard_bypass', value 'tables', transaction-local.
--
-- Trigger name order: 'trg_tables_guard' < 'trg_tables_prevent_token_reuse' <
-- 'trg_tables_rotate_qr_token' < 'trg_tables_set_updated_at', so this guard is
-- the first BEFORE trigger to see the row.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_tables_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF COALESCE(pg_catalog.current_setting('app.guard_bypass', true), '') = 'tables'
     OR app_private.guard_actor_is_exempt() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.qr_token             IS DISTINCT FROM OLD.qr_token
     OR NEW.qr_token_issued_at  IS DISTINCT FROM OLD.qr_token_issued_at
     OR NEW.qr_rotation_count   IS DISTINCT FROM OLD.qr_rotation_count
     OR NEW.last_order_at       IS DISTINCT FROM OLD.last_order_at
     OR NEW.last_waiter_call_at IS DISTINCT FROM OLD.last_waiter_call_at
     OR NEW.branch_id           IS DISTINCT FROM OLD.branch_id
     OR NEW.restaurant_id       IS DISTINCT FROM OLD.restaurant_id THEN
    PERFORM app_private.raise_app_error('QR053_IMMUTABLE_COLUMN', 403,
      jsonb_build_object('table', 'tables',
        'hint_fields', jsonb_build_array('qr_token', 'qr_token_issued_at',
          'qr_rotation_count', 'last_order_at', 'last_waiter_call_at',
          'branch_id', 'restaurant_id')));
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_tables_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_tables_guard ON public.tables;

CREATE TRIGGER trg_tables_guard
  BEFORE UPDATE ON public.tables
  FOR EACH ROW EXECUTE FUNCTION public.trg_tables_guard();

COMMENT ON FUNCTION public.trg_tables_guard() IS
  'Doc 02 §3.18 and §1.13. qr_token is a bearer capability, not user data: it may only be minted by generate_qr_token() through the rotation RPC. last_order_at and last_waiter_call_at are the §5.2/§5.3 rate-limit clocks and may only be stamped by public_place_order / public_call_waiter. All three, plus the rotation audit columns and the row''s tenancy, are unwritable by any client role; the trusted writers short-circuit this guard with set_config(''app.guard_bypass'', ''tables'', true). Closes F13.';


-- =============================================================================
-- §6. public.trg_notifications_guard()  —  BEFORE UPDATE ON public.notifications
--
-- Closes F11.
--
-- 20260901001200_rls_policies.sql grants UPDATE on public.notifications to
-- authenticated "guarded by trigger", intending a read_at-only write. But
-- public.notifications HAS NO read_at COLUMN — the per-staff read mark lives in
-- public.notification_reads, which has its own INSERT grant and a self-scoped
-- policy. So no client-writable column remains on this table at all.
--
-- Meanwhile notifications_update_addressee is satisfied by
-- target_staff_id IS NULL, which is true of every broadcast notification, so
-- without this trigger any staff member with branch access could rewrite the
-- payload, type, priority, order_id, waiter_call_id and expires_at of every
-- notification in their branch (verified: an owner session rewrote four live
-- rows).
--
-- This guard therefore rejects a client UPDATE of every column of the table. It
-- is deliberately an explicit column list rather than a whole-row diff so the
-- error names the field, and so a genuinely writable column added later has to
-- be opened on purpose.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.trg_notifications_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
BEGIN
  IF app_private.guard_actor_is_exempt() THEN
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  IF NEW.id             IS DISTINCT FROM OLD.id
     OR NEW.restaurant_id  IS DISTINCT FROM OLD.restaurant_id
     OR NEW.branch_id      IS DISTINCT FROM OLD.branch_id
     OR NEW.target_role    IS DISTINCT FROM OLD.target_role
     OR NEW.target_staff_id IS DISTINCT FROM OLD.target_staff_id
     OR NEW.type           IS DISTINCT FROM OLD.type
     OR NEW.payload        IS DISTINCT FROM OLD.payload
     OR NEW.priority       IS DISTINCT FROM OLD.priority
     OR NEW.order_id       IS DISTINCT FROM OLD.order_id
     OR NEW.waiter_call_id IS DISTINCT FROM OLD.waiter_call_id
     OR NEW.expires_at     IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at     IS DISTINCT FROM OLD.created_at THEN
    PERFORM app_private.raise_app_error('QR054_COLUMN_NOT_ALLOWED', 403,
      jsonb_build_object('table', 'notifications',
        'allowed', '[]'::jsonb,
        'hint', 'the read mark lives in public.notification_reads'));
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_notifications_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_notifications_guard ON public.notifications;

CREATE TRIGGER trg_notifications_guard
  BEFORE UPDATE ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.trg_notifications_guard();

COMMENT ON FUNCTION public.trg_notifications_guard() IS
  'Doc 02 §3.18. The UPDATE grant on public.notifications exists so a staff member can mark a notification read, but the read mark is modelled by public.notification_reads, so no column of this table is client-writable. Every client UPDATE is rejected; notifications are written only by triggers and SECURITY DEFINER functions and pruned by cron. Closes F11.';


-- =============================================================================
-- §7. The ROLE-AWARE order state machine (doc 02 §3.17)
--
-- Closes F08 (THE STATUS STATE MACHINE IS NOT ROLE-AWARE).
--
-- public.is_valid_order_transition(from, to) — created in
-- 20260901000800_functions_triggers.sql and depended on by the CHECK constraint
-- on public.order_status_history — encodes the GRAPH and nothing about WHO is
-- moving the order. orders_update_staff admits every WAITER and every KITCHEN
-- member of the branch, so before this function a KITCHEN account could cancel a
-- preparing order, a WAITER could cancel a ready one, and a KITCHEN account
-- could drive ready -> delivered -> completed on orders it never served.
--
-- The 2-argument predicate is left EXACTLY as it is (the CHECK constraint
-- depends on it) and this 3-argument one BUILDS ON IT: the graph is consulted
-- first, and the role matrix can only ever narrow it.
--
-- One deliberate consequence of composing that way: §3.17 lists
-- delivered -> cancelled as permitted for super_admin and owner, but that edge
-- is absent from the binding graph in is_valid_order_transition() and from
-- ck_order_status_history_transition_valid, so the composed predicate returns
-- false for it. The role table below still names the edge, so the intent
-- survives verbatim if the graph is ever widened; the graph stays the single
-- source of truth for what is structurally reachable.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.order_transition_allowed(
  p_from  public.order_status,
  p_to    public.order_status,
  p_actor public.app_role
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = ''
AS $fn$
  SELECT
    -- The graph first: never widen what is_valid_order_transition() allows.
    public.is_valid_order_transition(p_from, p_to)
    AND CASE
      WHEN p_actor IS NULL THEN false          -- not staff => no transition
      WHEN p_from IN ('completed', 'cancelled') THEN false   -- terminal for all
      WHEN p_from = p_to THEN false

      -- Cancellation. Kitchen may NEVER cancel; a waiter may only walk back an
      -- order the kitchen has not started; a manager may not cancel once the
      -- food has left the pass; only an owner or the platform may reach further.
      WHEN p_to = 'cancelled' THEN CASE p_actor
        WHEN 'SUPER_ADMIN'      THEN p_from IN ('pending','confirmed','preparing','ready','delivered')
        WHEN 'RESTAURANT_OWNER' THEN p_from IN ('pending','confirmed','preparing','ready','delivered')
        WHEN 'MANAGER'          THEN p_from IN ('pending','confirmed','preparing','ready')
        WHEN 'WAITER'           THEN p_from IN ('pending','confirmed')
        ELSE false
      END

      -- Forward path. The kitchen owns confirmed -> preparing -> ready; the
      -- floor owns ready -> delivered -> completed; either end may accept a
      -- pending ticket.
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

REVOKE ALL ON FUNCTION
  public.order_transition_allowed(public.order_status, public.order_status, public.app_role)
  FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION
  public.order_transition_allowed(public.order_status, public.order_status, public.app_role)
  TO authenticated;

COMMENT ON FUNCTION
  public.order_transition_allowed(public.order_status, public.order_status, public.app_role) IS
  'Doc 02 §3.17. The role-aware order state machine: composes the structural graph of public.is_valid_order_transition(from, to) with the matrix of which app_role may perform which edge. Kitchen may never cancel; a waiter may cancel only pending/confirmed; ready -> delivered -> completed belongs to the floor, confirmed -> preparing -> ready to the kitchen. Returns false for a NULL actor. Closes F08.';


-- -----------------------------------------------------------------------------
-- §7.1 public.orders_status_guard() — superseded body
--
-- The function OBJECT is created by 20260901000800_functions_triggers.sql, and
-- the trigger trg_orders_status_guard (BEFORE UPDATE OF status ON public.orders)
-- created there keeps pointing at the same OID. That file is owned by another
-- workstream and is deliberately NOT edited here; because this migration sorts
-- after it, this CREATE OR REPLACE is the definition the chain ends with.
--
-- Everything the 000800 body did is preserved: the is_valid_order_transition()
-- graph check raising ORD01, the lifecycle timestamp stamping, due_at, and the
-- mandatory cancellation_reason raising ORD04. Two things are added:
--
--   (a) §3.17/§3.18 actor enforcement — the transition is re-checked against
--       coalesce(auth_role_in_branch(OLD.branch_id), auth_role()) so the graph
--       AND the actor are both enforced. It is skipped only when there is no
--       authenticated actor at all (an anon customer inside a SECURITY DEFINER
--       RPC, or a cron/system transition), or when the caller is exempt
--       (service_role, direct admin connection). Deliberately NOT skipped on
--       app.guard_bypass: bypassing money must never silently bypass the role
--       matrix.
--
--   (b) The actor's staff row is stamped onto confirmed_by_staff_id /
--       served_by_staff_id / cancelled_by_staff_id. Nothing in the chain wrote
--       those three columns, so they and their three indexes stayed permanently
--       empty (F10). Stamping them here keeps that fix from being lost when this
--       body supersedes 000800's.
--
-- Security mode is changed from INVOKER to DEFINER: the body now calls
-- auth_role_in_branch(), auth_role(), order_transition_allowed() and reads
-- public.staff, none of which an anon caller inside public_cancel_order (doc 03
-- §1.4) holds EXECUTE/SELECT on after 20260901009900 re-strips anon.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.orders_status_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_actor    public.app_role;
  v_staff_id uuid;
  v_uid      uuid;
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- 1. The structural graph (unchanged from 20260901000800; ORD01 preserved).
  IF NOT public.is_valid_order_transition(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'illegal order status transition: % -> % (order %)',
      OLD.status, NEW.status, OLD.id
      USING ERRCODE = 'ORD01';
  END IF;

  -- 2. The actor (doc 02 §3.17 + §3.18). auth_role_in_branch() resolves the
  --    caller's role AT THIS BRANCH and falls back to their strongest role
  --    anywhere; both already return SUPER_ADMIN for a platform admin.
  v_uid := (SELECT auth.uid());

  IF v_uid IS NOT NULL AND NOT app_private.guard_actor_is_exempt() THEN
    v_actor := COALESCE(public.auth_role_in_branch(OLD.branch_id), public.auth_role());

    IF v_actor IS NULL THEN
      PERFORM app_private.raise_app_error('QR050_FORBIDDEN', 403,
        jsonb_build_object('reason', 'not_staff_of_branch',
                           'branch_id', OLD.branch_id));
    END IF;

    IF NOT public.order_transition_allowed(OLD.status, NEW.status, v_actor) THEN
      PERFORM app_private.raise_app_error('QR040_INVALID_STATUS_TRANSITION', 409,
        jsonb_build_object('from', OLD.status, 'to', NEW.status, 'actor', v_actor));
    END IF;
  END IF;

  -- 3. Who did it. Resolve the acting staff row of this order's restaurant so
  --    the three *_by_staff_id columns stop being permanently NULL (F10). The
  --    FK is composite (restaurant_id, staff_id), so the row must belong to
  --    this order's restaurant.
  IF v_uid IS NOT NULL THEN
    SELECT s.id INTO v_staff_id
    FROM public.staff s
    WHERE s.profile_id    = v_uid
      AND s.restaurant_id = NEW.restaurant_id
      AND (s.branch_id IS NULL OR s.branch_id = NEW.branch_id)
      AND s.is_active
    ORDER BY array_position(
      ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[], s.role)
    LIMIT 1;
  END IF;

  -- 4. Lifecycle timestamps (unchanged from 20260901000800).
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
$fn$;

REVOKE ALL ON FUNCTION public.orders_status_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.orders_status_guard() IS
  'The database''s enforcement of brief §26/§34.8 and doc 02 §3.17/§3.18. Supersedes the body created in 20260901000800_functions_triggers.sql (same OID, same trigger) to make the state machine ACTOR aware: the transition must satisfy both the structural graph (is_valid_order_transition, ORD01) and the role matrix (order_transition_allowed, QR040_INVALID_STATUS_TRANSITION/409). A caller with a JWT who is not staff of the branch gets QR050_FORBIDDEN. Lifecycle timestamps, due_at and the mandatory cancellation_reason (ORD04) are unchanged, and the acting staff row is now stamped onto confirmed_by_staff_id / served_by_staff_id / cancelled_by_staff_id. Closes F08.';


-- =============================================================================
-- §8. Self-check — the seven objects this migration exists to create must be
--     present and attached. A silent no-op here is exactly the failure mode
--     that produced F05-F09, F11 and F13 in the first place.
-- =============================================================================
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(t.want, ', ')
  INTO v_missing
  FROM (VALUES
    ('trg_profiles_guard',      'public.profiles'::regclass),
    ('trg_staff_guard',         'public.staff'::regclass),
    ('trg_orders_guard',        'public.orders'::regclass),
    ('trg_menu_items_guard',    'public.menu_items'::regclass),
    ('trg_tables_guard',        'public.tables'::regclass),
    ('trg_notifications_guard', 'public.notifications'::regclass)
  ) AS t(want, rel)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_trigger g
    WHERE g.tgrelid = t.rel AND g.tgname = t.want AND NOT g.tgisinternal);

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'guard triggers missing: %', v_missing
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF to_regprocedure(
       'public.order_transition_allowed(public.order_status, public.order_status, public.app_role)'
     ) IS NULL THEN
    RAISE EXCEPTION 'doc 02 §3.17 order_transition_allowed/3 was not created'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- The superseded status guard must be the actor-aware one.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'orders_status_guard'
      AND p.prosrc LIKE '%order_transition_allowed%') THEN
    RAISE EXCEPTION 'public.orders_status_guard() is not actor aware'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
