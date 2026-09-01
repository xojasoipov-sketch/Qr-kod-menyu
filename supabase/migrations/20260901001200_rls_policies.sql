-- =============================================================================
-- Restaurant QR OS — 12. Row Level Security policies (staff surface)
-- Implements docs/architecture/02-security-and-rls.md
--   §3.0  the rules that apply to every policy here
--   §3.1  table-level grants for `authenticated` (defence in depth beneath RLS)
--   §3.2–§3.16  the CREATE POLICY DDL for every staff-facing table
--
-- RLS itself (ENABLE / FORCE, and the two NO FORCE exemptions of §4.2) was
-- turned on by 20260901001000_realtime_rls_enable.sql, which deliberately left
-- the schema deny-all. This migration is the file that opens the staff paths.
--
-- Invariants carried from §3.0 / §6 / §11 and NOT to be relaxed later:
--   * every policy is TO authenticated. There is no policy TO anon and no
--     policy TO public anywhere in this system. service_role bypasses RLS by
--     role attribute (BYPASSRLS) and needs no policy.
--   * every UPDATE policy carries BOTH using and with check (§6.19). A missing
--     with check permits tenant hopping and is a review-blocking defect.
--   * auth.uid() is always written as (select auth.uid()) so the planner lifts
--     it into an InitPlan and evaluates it once per query, not once per row.
--   * orders / order_items / order_item_options / order_status_history have NO
--     insert policy: those rows exist only because a SECURITY DEFINER function
--     wrote them. That is what makes price tampering structurally impossible
--     (§1.3, §6.2) and the snapshots immutable (§6.8).
--   * orders and order_status_history have NO delete policy (§6.16).
--
-- Depends on: the §4 helper functions (0004_helpers in §9.3's ordering) —
--   is_super_admin, has_restaurant_access, has_branch_access,
--   auth_role_in_branch, is_colleague, can_manage_settings, can_manage_branches,
--   can_manage_branch, can_manage_tables, can_manage_menu, can_manage_staff,
--   can_manage_staff_of_user, can_manage_orders.
-- All are STABLE SECURITY DEFINER with `set search_path = ''`, so each one is
-- evaluated once per query rather than once per row.
--
-- IDENTIFIER RECONCILIATION (02 §3 is written against the column names of its
-- own §0.3 sketch; 01-database-schema.md is the binding schema and differs in
-- six places). The authorization semantics below are unchanged; only the
-- identifiers are translated:
--   §3.7  `public.qr_tokens`              -> public.qr_token_history
--   §3.4/3.5 `staff.user_id`              -> public.staff.profile_id
--   §3.16 `notifications.target_user_id`  -> public.notifications.target_staff_id
--                                            (a staff row id, so the comparison
--                                            resolves through public.staff)
--   §3.9  `menu_items.branch_id NOT NULL` -> nullable (restaurant-wide dishes),
--                                            handled like menu_categories
--   §3.10 `menu_item_options.branch_id`   -> absent; branch scope is inherited
--                                            from the parent menu_items row
--   §3.13 `order_items.branch_id`,
--         `order_item_options.branch_id`  -> absent; branch scope is inherited
--                                            from the parent orders row
-- app_role labels are the schema's uppercase set, so §3's 'kitchen' is 'KITCHEN'.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 0. Dependency assertion.
--
-- CREATE POLICY resolves the helper functions at creation time, so a missing
-- helper would fail somewhere in the middle of this file with an error about
-- one function. Fail up front, naming the migration that must run first.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_missing text;
BEGIN
  SELECT string_agg(needed.proname, ', ' ORDER BY needed.proname) INTO v_missing
  FROM unnest(ARRAY[
    'is_super_admin', 'has_restaurant_access', 'has_branch_access',
    'auth_role_in_branch', 'is_colleague', 'can_manage_settings',
    'can_manage_branches', 'can_manage_branch', 'can_manage_tables',
    'can_manage_menu', 'can_manage_staff', 'can_manage_staff_of_user',
    'can_manage_orders'
  ]) AS needed(proname)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = needed.proname
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION
      'RLS helper function(s) missing: %. Run the §4 helper migration before this one.',
      v_missing
      USING ERRCODE = 'undefined_function';
  END IF;
END
$$;


-- =============================================================================
-- 1. §3.1 — Table-level grants for `authenticated`.
--
-- Policies decide WHICH ROWS; grants decide WHICH VERBS EXIST AT ALL. Both are
-- set, so a forgotten policy cannot become a write hole and a forgotten grant
-- cannot become one either. Appendix B: PostgREST hides a table when the role
-- holds no privilege on it — policies control rows, grants control existence.
-- =============================================================================

-- Step 1: start from nothing. Supabase's defaults grant ALL to `authenticated`
-- on newly created tables, so the baseline has to be taken away explicitly.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;

-- Step 2: SELECT everywhere the staff surface reaches (RLS narrows it to the
-- caller's tenant, branch and role).
GRANT SELECT ON
  public.restaurants,
  public.branches,
  public.profiles,
  public.staff,
  public.tables,
  public.qr_token_history,       -- §3.1 `qr_tokens`
  public.menu_categories,
  public.menu_items,
  public.menu_item_options,
  public.promotions,
  public.promotion_items,        -- see §9 below (table absent from 02 §0.3)
  public.orders,
  public.order_items,
  public.order_item_options,
  public.order_status_history,
  public.waiter_calls,
  public.notifications,
  public.notification_reads      -- see §9 below (read marks live here, not on notifications)
TO authenticated;

-- Step 3: full direct-write verbs, only where a legitimate direct-write path
-- exists AND every column of the table is legitimately client-writable. Each is
-- fenced by the policies in section 2 of this file.
GRANT INSERT, UPDATE, DELETE ON
  public.restaurants,            -- INSERT/DELETE reachable by platform admin only, per policy
  public.branches,
  public.menu_categories,
  public.menu_item_options,
  public.promotions
TO authenticated;

-- Step 3b: COLUMN-SCOPED write verbs.
--
-- These are the tables where "which rows" (policy) and "which verbs" (grant)
-- were never enough, because the illegal move is a WHICH COLUMN move: an UPDATE
-- that passes its policy on a row the caller may genuinely edit, but touches a
-- column no client may ever write. §3.18's guard triggers reject those changes
-- in the row; the grants below make the engine refuse the statement before any
-- trigger body runs. Two independent layers on purpose: a trigger can be
-- dropped, disabled with ALTER TABLE ... DISABLE TRIGGER, or short-circuited by
-- a future SECURITY DEFINER writer that sets app.guard_bypass; a column
-- privilege has none of those escape hatches. Every list below omits money,
-- identity, tenant keys, bearer tokens, GENERATED columns and audit/attribution
-- columns, so the audited exploits come back as 42501 "permission denied for
-- column" rather than as a business-rule error.
--
-- What PostgreSQL can and cannot express here (the reason some rules stay in
-- the triggers and are not duplicated as grants):
--   * UPDATE and INSERT accept column lists; SELECT does too but the staff
--     surface reads whole rows. DELETE has NO column-level form at all.
--   * A column list is a property of one ACL on one table. It CANNOT vary by
--     app_role, so any rule of the form "KITCHEN may write only X" is not
--     expressible as a grant.
--   * A grant restricts WHICH columns, never WHICH VALUES. "A MANAGER may not
--     mint a RESTAURANT_OWNER" is a value rule and stays in trg_staff_guard().
-- Where a rule is inexpressible the grant carries the widest legitimate set and
-- the guard trigger narrows it. The layers are complementary, not redundant.

-- ------------------------------------------------------------------ profiles
-- closes F05 (privilege escalation to platform admin).
-- is_platform_admin is the switch public.is_super_admin() reads, and
-- profiles_update_self admits the caller's own row by design, so a table-wide
-- grant let any signed-in staff member — a KITCHEN account was enough — PATCH
-- themselves to platform admin and own every tenant. It appears in neither list
-- below, so the column is not addressable by `authenticated` at all and the
-- PATCH fails with 42501 even if trg_profiles_guard() is ever dropped. `id` is
-- absent for the same reason: it is the auth.users identity and the join key of
-- every policy in this file.
-- `email` is settable only on the self-repair INSERT: auth.users owns the
-- address and trg_auth_user_created copies it down, so a client rewriting it
-- afterwards would only desynchronise the display copy from the identity.
-- `is_active` stays writable because a manager deactivating a colleague is a
-- real operation (profiles_update_manager); trg_profiles_guard() is what stops
-- you deactivating yourself. created_at / updated_at are audit columns.
REVOKE INSERT, UPDATE ON public.profiles FROM authenticated;
GRANT INSERT (id, email, full_name, phone, avatar_url, avatar_path, locale)
  ON public.profiles TO authenticated;   -- own row only, per profiles_insert_self
GRANT UPDATE (full_name, phone, avatar_url, avatar_path, locale,
              is_active, last_seen_at)
  ON public.profiles TO authenticated;

-- --------------------------------------------------------------------- staff
-- closes F06 (MANAGER -> RESTAURANT_OWNER escalation, last-owner removal) as
-- far as the privilege layer reaches — which is deliberately only half of it.
--
-- INSERT and DELETE stay table-wide, and the reason is worth stating rather
-- than hiding: the F06 exploits are VALUE restrictions, not column
-- restrictions. A manager must be able to write `role` to add a WAITER, so
-- `role` cannot be left out of an INSERT column list; what must be rejected is
-- the single value 'RESTAURANT_OWNER', and no GRANT can say that. DELETE has no
-- column-level form in PostgreSQL at all, so "you may not delete the last
-- active owner" is equally inexpressible. Both rules, plus "nobody edits their
-- own membership", live in trg_staff_guard() (§3.18) and only there.
-- The UPDATE grant below still removes the identity/tenant half of the attack
-- surface without any trigger: profile_id and restaurant_id are absent, so a
-- staff row can never be repointed at another person or moved to another
-- tenant, and id / created_at / updated_at are absent as identity and audit.
REVOKE UPDATE ON public.staff FROM authenticated;
GRANT INSERT, DELETE ON public.staff TO authenticated;
GRANT UPDATE (role, branch_id, permissions, display_name, employee_code,
              is_active, invited_at, joined_at)
  ON public.staff TO authenticated;

-- -------------------------------------------------------------------- tables
-- closes F13 (client-chosen QR token, client-resettable rate-limit clocks).
-- qr_token is a bearer capability carrying 128 bits of entropy (§1.13): whoever
-- holds it can order and call waiters as that table, so it may only be minted by
-- generate_qr_token() inside admin_rotate_table_token(). last_order_at and
-- last_waiter_call_at are the §5.2/§5.3 cooldown clocks that public_place_order
-- and public_call_waiter read FOR UPDATE; a client that can NULL them has no
-- rate limit. Those five, plus qr_token_issued_at and qr_rotation_count (the
-- rotation audit trail), appear in neither list.
-- The INSERT list matters as much as the UPDATE list: trg_tables_guard() is
-- BEFORE UPDATE only, so with a table-wide INSERT a manager could reach exactly
-- the same capability by the other verb — create a table WITH a chosen
-- qr_token. restaurant_id and branch_id are in the INSERT list because they are
-- NOT NULL with no default (the row cannot exist without them) and
-- tables_insert_manager's WITH CHECK is what validates them; they are absent
-- from the UPDATE list, so the row can never be moved afterwards.
REVOKE INSERT, UPDATE ON public.tables FROM authenticated;
GRANT INSERT (restaurant_id, branch_id, number, name, zone, seats,
              sort_order, is_active)
  ON public.tables TO authenticated;
GRANT UPDATE (number, name, zone, seats, sort_order, is_active, deleted_at)
  ON public.tables TO authenticated;
GRANT DELETE ON public.tables TO authenticated;

-- ---------------------------------------------------------------- menu_items
-- closes F09 (kitchen staff rewriting menu prices).
-- The full management set stays: menu_items_insert_manager,
-- menu_items_delete_manager and the can_manage_menu arm of
-- menu_items_update_menu_or_kitchen are legitimately allowed to move every
-- column below, `price` included — a menu manager setting prices IS the
-- feature. NOTE, and this is the load-bearing caveat of this whole section: the
-- same policy also admits KITCHEN of the branch, and a column-level grant is
-- one ACL on one table that CANNOT vary by role. Narrowing KITCHEN to
-- is_available / unavailable_until ("86 this dish") is therefore NOT expressible
-- here and is enforced by trg_menu_items_guard() (§3.18). What the grant closes
-- for every role, trigger or no trigger: id / restaurant_id / branch_id
-- (identity and tenancy), popularity_score (a system-maintained sales counter),
-- search_vector (GENERATED — writable by nobody) and created_at / updated_at.
REVOKE UPDATE ON public.menu_items FROM authenticated;
GRANT INSERT, DELETE ON public.menu_items TO authenticated;
GRANT UPDATE (category_id, name, description, ingredients,
              price, compare_at_price,
              image_url, image_path, spicy_level, preparation_time, calories,
              dietary_tags, is_available, unavailable_until,
              available_from, available_until,
              is_featured, is_popular, sort_order, deleted_at)
  ON public.menu_items TO authenticated;

-- -------------------------------------------------------------------- orders
-- closes F07 (bill zeroing and order-identity rewriting by any branch staff).
-- Money is the point of this one: subtotal, discount_total, service_fee,
-- service_fee_bps, total, currency and currency_decimals are computed inside
-- public_place_order() / staff_place_order() from server-side prices (§1.3,
-- §6.2) and are absent here, so `{"discount_total": <subtotal>, "total": 0}` is
-- a 42501 rather than a free meal — the CHECK constraints it was engineered to
-- satisfy are never even reached. Absent for the same reason: the identity and
-- idempotency columns (id, restaurant_id, branch_id, table_id, order_number,
-- order_seq, business_date, public_code, client_request_id, payload_fingerprint,
-- customer_session_id — rewriting the last two silently defeats the §5.2
-- idempotency guard) and every lifecycle timestamp (created_at, placed_at,
-- confirmed_at … cancelled_at, updated_at), which orders_status_guard() stamps
-- and which decide the kitchen's 24h visibility window.
-- confirmed_by_staff_id / served_by_staff_id / cancelled_by_staff_id are absent
-- too: since F10 they are stamped from the acting staff row inside
-- orders_status_guard(), so a client able to write them could only forge
-- attribution in the audit trail.
-- What remains is the status machine plus the service columns a waiter really
-- does edit at the table. WHICH transitions each role may drive is a value rule,
-- not a column rule, and belongs to order_transition_allowed() (§3.17).
REVOKE UPDATE ON public.orders FROM authenticated;
GRANT UPDATE (status, cancellation_reason,
              customer_name, customer_phone, customer_note, guest_count,
              estimated_prep_minutes, due_at)
  ON public.orders TO authenticated;

-- ------------------------------------------------------------- notifications
-- closes F11 — by removing the verb entirely rather than narrowing it.
-- 02 §3.1 annotates its grant "read_at only", but the binding schema puts no
-- read_at on notifications: the per-staff read mark is a row in
-- public.notification_reads (§9 below), which has its own INSERT grant and a
-- self-scoped policy. There is therefore NO legitimate client-writable column
-- left to name in a column list — payload, type, priority, order_id,
-- waiter_call_id, expires_at and the target_* addressing are all
-- producer-owned — while notifications_update_addressee is satisfied by
-- target_staff_id IS NULL, i.e. by every broadcast row in the caller's branch.
-- An empty column list is not expressible in SQL, and the honest expression of
-- "no column is writable" is no UPDATE privilege at all.
-- The policy itself is deliberately left standing: it is not this section's to
-- remove, it grants nothing at all without the verb (PostgREST returns 42501),
-- and it records who the addressee would be if a genuinely client-writable
-- column is ever added — at which point grant that one column by name here.
REVOKE UPDATE ON public.notifications FROM authenticated;

-- Step 4: narrow verbs where only one kind of change is legal and the column
-- surface is already safe.
GRANT UPDATE          ON public.waiter_calls      TO authenticated;  -- acknowledge / resolve; column rules in trg_waiter_calls_guard()
GRANT INSERT          ON public.notification_reads TO authenticated; -- marking one notification read

-- Step 5: everything not granted above stays denied. In particular NO role ever
-- receives:
--   INSERT / UPDATE / DELETE on order_items, order_item_options, order_status_history
--   INSERT / UPDATE / DELETE on qr_token_history
--   INSERT / DELETE          on orders, waiter_calls, notifications
--   UPDATE                   on notifications (no client-writable column exists)
--   DELETE                   on profiles, notification_reads
--   any verb at all          on branch_order_counters, promotion_items (write side)
--   any column not named in the column lists of step 3b, on any table there
-- Those rows exist only because a SECURITY DEFINER function created them.

-- Step 6: one EXECUTE grant the policies above cannot work without.
--
-- orders_update_staff below is enforced at the row level by RLS and at the
-- column/transition level by trg_orders_status_guard(), a SECURITY INVOKER
-- trigger function that calls public.is_valid_order_transition(old, new). A
-- plpgsql trigger body calls that as the *invoking* role, so without EXECUTE
-- every staff status change dies with 42501 "permission denied for function
-- is_valid_order_transition" and the whole order state machine is unreachable
-- from the client. 02 §4.6 grants exactly this to `authenticated` for the
-- function it calls order_transition_allowed(); this is the same grant against
-- the binding schema's name for it. The function is IMMUTABLE and returns only
-- whether a transition is legal, so it leaks nothing.
REVOKE ALL ON FUNCTION public.is_valid_order_transition(public.order_status, public.order_status)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_valid_order_transition(public.order_status, public.order_status)
  TO authenticated;

-- `anon` holds nothing in this schema and never will (§2.3, §6.1). Re-asserted
-- here because step 1 above touches the same catalog rows.
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;


-- =============================================================================
-- 2. The policies.
--
-- Each block drops its own policies first so the file is safe to re-run during
-- local development; PostgreSQL 15 has no CREATE POLICY ... IF NOT EXISTS. Only
-- policies created by this file are dropped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §3.2 public.restaurants
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS restaurants_select_staff      ON public.restaurants;
DROP POLICY IF EXISTS restaurants_insert_superadmin ON public.restaurants;
DROP POLICY IF EXISTS restaurants_update_owner      ON public.restaurants;
DROP POLICY IF EXISTS restaurants_delete_superadmin ON public.restaurants;

CREATE POLICY restaurants_select_staff ON public.restaurants
  FOR SELECT TO authenticated
  USING ( public.has_restaurant_access(id) );

CREATE POLICY restaurants_insert_superadmin ON public.restaurants
  FOR INSERT TO authenticated
  WITH CHECK ( public.is_super_admin() );

CREATE POLICY restaurants_update_owner ON public.restaurants
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_settings(id) )
  WITH CHECK ( public.can_manage_settings(id) );

CREATE POLICY restaurants_delete_superadmin ON public.restaurants
  FOR DELETE TO authenticated
  USING ( public.is_super_admin() );


-- -----------------------------------------------------------------------------
-- §3.3 public.branches
--
-- A waiter/kitchen member sees only their own branch; owners and restaurant-wide
-- managers see every branch of their restaurant (current_branch_ids() expands a
-- branch_id IS NULL membership to all branches of that restaurant).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS branches_select_staff   ON public.branches;
DROP POLICY IF EXISTS branches_insert_owner   ON public.branches;
DROP POLICY IF EXISTS branches_update_manager ON public.branches;
DROP POLICY IF EXISTS branches_delete_owner   ON public.branches;

CREATE POLICY branches_select_staff ON public.branches
  FOR SELECT TO authenticated
  USING ( public.has_branch_access(id) );

CREATE POLICY branches_insert_owner ON public.branches
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_branches(restaurant_id) );

-- Owners may edit any branch of their restaurant; a branch manager may edit
-- their own branch. Both sides are checked on USING and on WITH CHECK, so a
-- branch cannot be moved to another restaurant by an UPDATE (§6.6).
CREATE POLICY branches_update_manager ON public.branches
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_branches(restaurant_id) OR public.can_manage_branch(id) )
  WITH CHECK ( public.can_manage_branches(restaurant_id) OR public.can_manage_branch(id) );

CREATE POLICY branches_delete_owner ON public.branches
  FOR DELETE TO authenticated
  USING ( public.can_manage_branches(restaurant_id) );


-- -----------------------------------------------------------------------------
-- §3.4 public.profiles   (RLS enabled, NOT forced — §4.2 recursion trap)
--
-- public.trg_profiles_guard() (§3.18) blocks changes to is_platform_admin and
-- to id. There is no DELETE policy and no DELETE grant: profiles are removed
-- only by cascade from auth.users.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS profiles_select_self       ON public.profiles;
DROP POLICY IF EXISTS profiles_select_colleagues ON public.profiles;
DROP POLICY IF EXISTS profiles_select_superadmin ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_self       ON public.profiles;
DROP POLICY IF EXISTS profiles_update_self       ON public.profiles;
DROP POLICY IF EXISTS profiles_update_manager    ON public.profiles;

CREATE POLICY profiles_select_self ON public.profiles
  FOR SELECT TO authenticated
  USING ( id = (SELECT auth.uid()) );

CREATE POLICY profiles_select_colleagues ON public.profiles
  FOR SELECT TO authenticated
  USING ( public.is_colleague(id) );

CREATE POLICY profiles_select_superadmin ON public.profiles
  FOR SELECT TO authenticated
  USING ( public.is_super_admin() );

-- The row is normally created by the trg_auth_user_created trigger on
-- auth.users; this policy covers self-repair when that row is missing.
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK ( id = (SELECT auth.uid()) );

CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE TO authenticated
  USING      ( id = (SELECT auth.uid()) )
  WITH CHECK ( id = (SELECT auth.uid()) );

CREATE POLICY profiles_update_manager ON public.profiles
  FOR UPDATE TO authenticated
  USING      ( public.is_super_admin() OR public.can_manage_staff_of_user(id) )
  WITH CHECK ( public.is_super_admin() OR public.can_manage_staff_of_user(id) );


-- -----------------------------------------------------------------------------
-- §3.5 public.staff   (RLS enabled, NOT forced — §4.2 recursion trap)
--
-- §4.2(5) is binding here: a policy on `staff` may only call helpers that read
-- `staff`, and may never reference `staff` in a subquery of its own — that
-- re-arms the recursion trap (SQLSTATE 42P17) even with the NO FORCE exemption.
-- Nothing below does.
--
-- public.trg_staff_guard() (§3.18) enforces what RLS cannot express: no
-- privilege escalation, no editing your own role, no orphaning the last owner.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS staff_select_self    ON public.staff;
DROP POLICY IF EXISTS staff_select_manager ON public.staff;
DROP POLICY IF EXISTS staff_insert_manager ON public.staff;
DROP POLICY IF EXISTS staff_update_manager ON public.staff;
DROP POLICY IF EXISTS staff_delete_manager ON public.staff;

-- Everyone can always see their own memberships: this is what the app
-- bootstraps its session context from.
CREATE POLICY staff_select_self ON public.staff
  FOR SELECT TO authenticated
  USING ( profile_id = (SELECT auth.uid()) );

-- Owners and managers see the roster of the restaurants they manage.
CREATE POLICY staff_select_manager ON public.staff
  FOR SELECT TO authenticated
  USING ( public.can_manage_staff(restaurant_id) );

CREATE POLICY staff_insert_manager ON public.staff
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_staff(restaurant_id) );

CREATE POLICY staff_update_manager ON public.staff
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_staff(restaurant_id) )
  WITH CHECK ( public.can_manage_staff(restaurant_id) );

CREATE POLICY staff_delete_manager ON public.staff
  FOR DELETE TO authenticated
  USING ( public.can_manage_staff(restaurant_id) );


-- -----------------------------------------------------------------------------
-- §3.6 public.tables
--
-- public.trg_tables_guard() (§3.18) rejects any direct write to qr_token,
-- last_order_at or last_waiter_call_at — those columns are owned by
-- admin_rotate_table_token() and by the public RPCs.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS tables_select_staff   ON public.tables;
DROP POLICY IF EXISTS tables_insert_manager ON public.tables;
DROP POLICY IF EXISTS tables_update_manager ON public.tables;
DROP POLICY IF EXISTS tables_delete_manager ON public.tables;

CREATE POLICY tables_select_staff ON public.tables
  FOR SELECT TO authenticated
  USING ( public.has_branch_access(branch_id) );

CREATE POLICY tables_insert_manager ON public.tables
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_tables(branch_id) );

CREATE POLICY tables_update_manager ON public.tables
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_tables(branch_id) )
  WITH CHECK ( public.can_manage_tables(branch_id) );

CREATE POLICY tables_delete_manager ON public.tables
  FOR DELETE TO authenticated
  USING ( public.can_manage_tables(branch_id) );


-- -----------------------------------------------------------------------------
-- §3.7 public.qr_token_history   (02 §3.7 calls this table `qr_tokens`)
--
-- Only people who can manage tables may read raw tokens — they need them to
-- print QR codes. Waiters and kitchen staff have no business reading them, and
-- a leaked token is a capability to order as that table (§1.13).
--
-- No INSERT / UPDATE / DELETE policy anywhere, and no such grant: rotation and
-- revocation happen only inside public.admin_rotate_table_token() (§4.7), and
-- trg_qr_token_history_immutable makes the audit rows append-only.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS qr_token_history_select_manager ON public.qr_token_history;

CREATE POLICY qr_token_history_select_manager ON public.qr_token_history
  FOR SELECT TO authenticated
  USING ( public.can_manage_tables(branch_id) );


-- -----------------------------------------------------------------------------
-- §3.8 public.menu_categories
--
-- branch_id IS NULL means a restaurant-wide category: visible to every member
-- of the restaurant, editable by anyone who can manage the menu.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS menu_categories_select_staff   ON public.menu_categories;
DROP POLICY IF EXISTS menu_categories_insert_manager ON public.menu_categories;
DROP POLICY IF EXISTS menu_categories_update_manager ON public.menu_categories;
DROP POLICY IF EXISTS menu_categories_delete_manager ON public.menu_categories;

CREATE POLICY menu_categories_select_staff ON public.menu_categories
  FOR SELECT TO authenticated
  USING ( public.has_restaurant_access(restaurant_id)
          AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY menu_categories_insert_manager ON public.menu_categories
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY menu_categories_update_manager ON public.menu_categories
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) )
  WITH CHECK ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY menu_categories_delete_manager ON public.menu_categories
  FOR DELETE TO authenticated
  USING ( public.can_manage_menu(restaurant_id)
          AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );


-- -----------------------------------------------------------------------------
-- §3.9 public.menu_items
--
-- 02 §3.9 assumes menu_items.branch_id NOT NULL and tests has_branch_access()
-- alone. In the binding schema branch_id is NULLABLE (a restaurant-wide dish),
-- and has_branch_access(NULL) is false for everyone but a platform admin, so
-- the literal predicate would hide every restaurant-wide dish from its own
-- staff. The menu_categories shape of §3.8 is used instead: restaurant access
-- plus branch access when the row names a branch. Tenant isolation is
-- unchanged — a NULL branch still requires has_restaurant_access().
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS menu_items_select_staff             ON public.menu_items;
DROP POLICY IF EXISTS menu_items_insert_manager           ON public.menu_items;
DROP POLICY IF EXISTS menu_items_update_menu_or_kitchen   ON public.menu_items;
DROP POLICY IF EXISTS menu_items_delete_manager           ON public.menu_items;

CREATE POLICY menu_items_select_staff ON public.menu_items
  FOR SELECT TO authenticated
  USING ( public.has_restaurant_access(restaurant_id)
          AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY menu_items_insert_manager ON public.menu_items
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

-- Managers/owners edit everything. Kitchen staff of the same branch also pass
-- this policy, but trg_menu_items_guard() restricts them to the is_available
-- column ("86 this dish"). A restaurant-wide dish (branch_id IS NULL) is not
-- 86-able by kitchen: auth_role_in_branch(NULL) matches no branch.
CREATE POLICY menu_items_update_menu_or_kitchen ON public.menu_items
  FOR UPDATE TO authenticated
  USING      ( (public.can_manage_menu(restaurant_id)
                AND (branch_id IS NULL OR public.has_branch_access(branch_id)))
               OR public.auth_role_in_branch(branch_id) = 'KITCHEN' )
  WITH CHECK ( (public.can_manage_menu(restaurant_id)
                AND (branch_id IS NULL OR public.has_branch_access(branch_id)))
               OR public.auth_role_in_branch(branch_id) = 'KITCHEN' );

CREATE POLICY menu_items_delete_manager ON public.menu_items
  FOR DELETE TO authenticated
  USING ( public.can_manage_menu(restaurant_id)
          AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );


-- -----------------------------------------------------------------------------
-- §3.10 public.menu_item_options
--
-- 02 §3.10 scopes these by their own branch_id column. The binding schema has
-- no such column: an option group hangs off exactly one menu_items row and
-- inherits its branch scope. The EXISTS below reproduces §3.9's predicate
-- against the parent, so an option can never be read or written by staff who
-- could not read or write the dish it belongs to.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS menu_item_options_select_staff   ON public.menu_item_options;
DROP POLICY IF EXISTS menu_item_options_insert_manager ON public.menu_item_options;
DROP POLICY IF EXISTS menu_item_options_update_manager ON public.menu_item_options;
DROP POLICY IF EXISTS menu_item_options_delete_manager ON public.menu_item_options;

CREATE POLICY menu_item_options_select_staff ON public.menu_item_options
  FOR SELECT TO authenticated
  USING ( public.has_restaurant_access(menu_item_options.restaurant_id)
          AND EXISTS (
            SELECT 1
            FROM public.menu_items mi
            WHERE mi.restaurant_id = menu_item_options.restaurant_id
              AND mi.id            = menu_item_options.menu_item_id
              AND (mi.branch_id IS NULL OR public.has_branch_access(mi.branch_id))
          ) );

CREATE POLICY menu_item_options_insert_manager ON public.menu_item_options
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_menu(menu_item_options.restaurant_id)
               AND EXISTS (
                 SELECT 1
                 FROM public.menu_items mi
                 WHERE mi.restaurant_id = menu_item_options.restaurant_id
                   AND mi.id            = menu_item_options.menu_item_id
                   AND (mi.branch_id IS NULL OR public.has_branch_access(mi.branch_id))
               ) );

CREATE POLICY menu_item_options_update_manager ON public.menu_item_options
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_menu(menu_item_options.restaurant_id)
               AND EXISTS (
                 SELECT 1
                 FROM public.menu_items mi
                 WHERE mi.restaurant_id = menu_item_options.restaurant_id
                   AND mi.id            = menu_item_options.menu_item_id
                   AND (mi.branch_id IS NULL OR public.has_branch_access(mi.branch_id))
               ) )
  WITH CHECK ( public.can_manage_menu(menu_item_options.restaurant_id)
               AND EXISTS (
                 SELECT 1
                 FROM public.menu_items mi
                 WHERE mi.restaurant_id = menu_item_options.restaurant_id
                   AND mi.id            = menu_item_options.menu_item_id
                   AND (mi.branch_id IS NULL OR public.has_branch_access(mi.branch_id))
               ) );

CREATE POLICY menu_item_options_delete_manager ON public.menu_item_options
  FOR DELETE TO authenticated
  USING ( public.can_manage_menu(menu_item_options.restaurant_id)
          AND EXISTS (
            SELECT 1
            FROM public.menu_items mi
            WHERE mi.restaurant_id = menu_item_options.restaurant_id
              AND mi.id            = menu_item_options.menu_item_id
              AND (mi.branch_id IS NULL OR public.has_branch_access(mi.branch_id))
          ) );


-- -----------------------------------------------------------------------------
-- §3.11 public.promotions
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS promotions_select_staff   ON public.promotions;
DROP POLICY IF EXISTS promotions_insert_manager ON public.promotions;
DROP POLICY IF EXISTS promotions_update_manager ON public.promotions;
DROP POLICY IF EXISTS promotions_delete_manager ON public.promotions;

CREATE POLICY promotions_select_staff ON public.promotions
  FOR SELECT TO authenticated
  USING ( public.has_restaurant_access(restaurant_id)
          AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY promotions_insert_manager ON public.promotions
  FOR INSERT TO authenticated
  WITH CHECK ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY promotions_update_manager ON public.promotions
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) )
  WITH CHECK ( public.can_manage_menu(restaurant_id)
               AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );

CREATE POLICY promotions_delete_manager ON public.promotions
  FOR DELETE TO authenticated
  USING ( public.can_manage_menu(restaurant_id)
          AND (branch_id IS NULL OR public.has_branch_access(branch_id)) );


-- -----------------------------------------------------------------------------
-- §3.12 public.orders
--
-- Brief §34.7: "kitchen sees only relevant orders". That is a policy, not a UI
-- filter.
--
-- NO INSERT POLICY and no INSERT grant. Orders are created only by
-- public.public_place_order() and public.staff_place_order(), both SECURITY
-- DEFINER, which read prices from menu_items / menu_item_options. That is what
-- makes price tampering structurally impossible (§1.3, §6.2).
--
-- NO DELETE POLICY and no DELETE grant. Orders are cancelled, never deleted
-- (§6.16).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS orders_select_front_of_house ON public.orders;
DROP POLICY IF EXISTS orders_select_kitchen        ON public.orders;
DROP POLICY IF EXISTS orders_update_staff          ON public.orders;

-- Owners, managers and waiters of the branch see the full order book.
CREATE POLICY orders_select_front_of_house ON public.orders
  FOR SELECT TO authenticated
  USING ( public.can_manage_orders(branch_id) );

-- Kitchen staff see only cookable orders from the last 24h of their own branch.
CREATE POLICY orders_select_kitchen ON public.orders
  FOR SELECT TO authenticated
  USING ( public.auth_role_in_branch(branch_id) = 'KITCHEN'
          AND status IN ('pending', 'confirmed', 'preparing', 'ready')
          AND created_at > now() - interval '24 hours' );

-- UPDATE is the status machine only. Which columns may move, and which
-- transitions are legal for the caller's role, live in trg_orders_guard()
-- (§3.18) which calls public.order_transition_allowed(old, new, actor).
CREATE POLICY orders_update_staff ON public.orders
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_orders(branch_id)
               OR public.auth_role_in_branch(branch_id) = 'KITCHEN' )
  WITH CHECK ( public.can_manage_orders(branch_id)
               OR public.auth_role_in_branch(branch_id) = 'KITCHEN' );


-- -----------------------------------------------------------------------------
-- §3.13 public.order_items and public.order_item_options
--
-- Neither table carries branch_id in the binding schema, so branch scope is
-- inherited from the parent orders row. The subquery is itself subject to the
-- orders policies above, which means a kitchen member reaches the lines of
-- exactly the orders the KDS may show them — never more.
--
-- NO INSERT / UPDATE / DELETE POLICY and no such grant on either table. They
-- are written only by SECURITY DEFINER functions, so name_snapshot and
-- price_snapshot are immutable by construction (brief §34.4, §6.8).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS order_items_select_staff        ON public.order_items;
DROP POLICY IF EXISTS order_item_options_select_staff ON public.order_item_options;

CREATE POLICY order_items_select_staff ON public.order_items
  FOR SELECT TO authenticated
  USING ( EXISTS (
            SELECT 1
            FROM public.orders o
            WHERE o.restaurant_id = order_items.restaurant_id
              AND o.id            = order_items.order_id
              AND (public.can_manage_orders(o.branch_id)
                   OR public.auth_role_in_branch(o.branch_id) = 'KITCHEN')
          ) );

CREATE POLICY order_item_options_select_staff ON public.order_item_options
  FOR SELECT TO authenticated
  USING ( EXISTS (
            SELECT 1
            FROM public.orders o
            WHERE o.restaurant_id = order_item_options.restaurant_id
              AND o.id            = order_item_options.order_id
              AND (public.can_manage_orders(o.branch_id)
                   OR public.auth_role_in_branch(o.branch_id) = 'KITCHEN')
          ) );


-- -----------------------------------------------------------------------------
-- §3.14 public.order_status_history
--
-- NO INSERT / UPDATE / DELETE POLICY and no such grant. Rows are written
-- exclusively by trg_orders_log_status_change() and by public_place_order();
-- trg_order_status_history_immutable blocks UPDATE for every role. The audit
-- trail cannot be edited or erased by any application role (§6.16).
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS order_status_history_select_staff ON public.order_status_history;

CREATE POLICY order_status_history_select_staff ON public.order_status_history
  FOR SELECT TO authenticated
  USING ( public.can_manage_orders(branch_id)
          OR public.auth_role_in_branch(branch_id) = 'KITCHEN' );


-- -----------------------------------------------------------------------------
-- §3.15 public.waiter_calls
--
-- NO INSERT POLICY and no INSERT grant: calls are created only by
-- public.public_call_waiter(), which owns the per-table cooldown (§5.3).
-- NO DELETE POLICY.
--
-- The two indexes printed in 02 §3.15 are NOT created here: the binding schema
-- already ships them under its own names — uq_waiter_calls_open_per_table
-- (one live call per table) and idx_waiter_calls_branch_open — in
-- 20260901000700_ops.sql and 20260901000900_indexes.sql.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS waiter_calls_select_staff   ON public.waiter_calls;
DROP POLICY IF EXISTS waiter_calls_update_service ON public.waiter_calls;

CREATE POLICY waiter_calls_select_staff ON public.waiter_calls
  FOR SELECT TO authenticated
  USING ( public.has_branch_access(branch_id) );

-- Acknowledge / resolve. trg_waiter_calls_guard() constrains which columns and
-- which transitions are legal, and stamps acknowledged_by from auth.uid()
-- rather than from the payload.
CREATE POLICY waiter_calls_update_service ON public.waiter_calls
  FOR UPDATE TO authenticated
  USING      ( public.can_manage_orders(branch_id) )
  WITH CHECK ( public.can_manage_orders(branch_id) );


-- -----------------------------------------------------------------------------
-- §3.16 public.notifications
--
-- 02 §3.16 addresses a notification with target_user_id (an auth user id). The
-- binding schema addresses it with target_staff_id (a public.staff row id), so
-- "addressed to me" resolves through the caller's own staff rows. The staff
-- subquery is safe: it lives in a policy on notifications, not on staff, so it
-- does not re-arm the §4.2 recursion trap, and staff_select_self already makes
-- the caller's own memberships visible.
--
-- NO INSERT / DELETE POLICY and no such grant: notifications are written by
-- triggers and definer functions and pruned by pg_cron.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS notifications_select_addressee ON public.notifications;
DROP POLICY IF EXISTS notifications_update_addressee ON public.notifications;

CREATE POLICY notifications_select_addressee ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.has_branch_access(branch_id)
    AND (target_staff_id IS NULL
         OR EXISTS (SELECT 1
                    FROM public.staff s
                    WHERE s.id         = notifications.target_staff_id
                      AND s.profile_id = (SELECT auth.uid())))
    AND (target_role IS NULL
         OR target_role = public.auth_role_in_branch(branch_id)
         OR public.can_manage_orders(branch_id))
  );

-- Marking as read only. trg_notifications_guard() rejects any change other than
-- the read state — and since F11 there is no such change: `authenticated` holds
-- NO update privilege on this table at all (section 1, step 3b), because the
-- read mark lives in public.notification_reads. This policy is kept as the
-- documented addressee predicate for a future column-scoped grant; with no
-- UPDATE verb behind it, it currently admits nothing.
CREATE POLICY notifications_update_addressee ON public.notifications
  FOR UPDATE TO authenticated
  USING      ( public.has_branch_access(branch_id)
               AND (target_staff_id IS NULL
                    OR EXISTS (SELECT 1
                               FROM public.staff s
                               WHERE s.id         = notifications.target_staff_id
                                 AND s.profile_id = (SELECT auth.uid()))) )
  WITH CHECK ( public.has_branch_access(branch_id)
               AND (target_staff_id IS NULL
                    OR EXISTS (SELECT 1
                               FROM public.staff s
                               WHERE s.id         = notifications.target_staff_id
                                 AND s.profile_id = (SELECT auth.uid()))) );


-- =============================================================================
-- 3. Tables present in the binding schema but absent from 02 §0.3.
--
-- 02 §3 predates three tables of 01-database-schema.md. CI gate (e) of §9.2
-- requires EVERY table in `public` to have RLS on AND at least one policy — a
-- table with RLS on and zero policies is a silent outage, not a security win
-- (§6.20). Each policy below is the minimum that keeps its parent table's
-- authorization rule intact; none of them widens any rule in §3.
-- =============================================================================

-- ----------------------------------------------------------- promotion_items
-- The promotion -> menu_item link table. Read scope mirrors
-- promotions_select_staff (§3.11); it is restaurant-scoped because a promotion
-- row already decides branch visibility. No write policy and no write grant:
-- attaching or detaching items is a service-role route, so a client cannot
-- point a promotion at a dish it may not see.
DROP POLICY IF EXISTS promotion_items_select_staff ON public.promotion_items;

CREATE POLICY promotion_items_select_staff ON public.promotion_items
  FOR SELECT TO authenticated
  USING ( public.has_restaurant_access(restaurant_id) );

-- -------------------------------------------------------- notification_reads
-- 02 §3.1 grants `update on public.notifications -- read_at only`. In the
-- binding schema notifications carries no read_at: the per-staff read mark is a
-- row here. This pair of policies is that grant's translation — a member may
-- see and create read marks for their OWN staff rows and nobody else's. No
-- UPDATE and no DELETE: a read mark is created once and never edited or
-- retracted.
DROP POLICY IF EXISTS notification_reads_select_self ON public.notification_reads;
DROP POLICY IF EXISTS notification_reads_insert_self ON public.notification_reads;

CREATE POLICY notification_reads_select_self ON public.notification_reads
  FOR SELECT TO authenticated
  USING ( EXISTS (SELECT 1
                  FROM public.staff s
                  WHERE s.id         = notification_reads.staff_id
                    AND s.profile_id = (SELECT auth.uid())) );

CREATE POLICY notification_reads_insert_self ON public.notification_reads
  FOR INSERT TO authenticated
  WITH CHECK ( EXISTS (SELECT 1
                       FROM public.staff s
                       WHERE s.id         = notification_reads.staff_id
                         AND s.profile_id = (SELECT auth.uid())) ) ;

-- ----------------------------------------------------- branch_order_counters
-- The race-safe daily order-number sequence: a concurrency primitive, not a
-- business entity. Every privilege on it was revoked from anon and
-- authenticated in 20260901001000; only next_order_number() under service_role
-- touches it. This policy exists solely so CI gate (e) sees a policy on the
-- table, and it grants nothing: `false` never admits a row. Do not "fix" it by
-- making it permissive.
DROP POLICY IF EXISTS branch_order_counters_select_none ON public.branch_order_counters;

CREATE POLICY branch_order_counters_select_none ON public.branch_order_counters
  FOR SELECT TO authenticated
  USING ( false );


-- =============================================================================
-- 4. Post-conditions. These mirror CI gates (d), (e) and (f) of §9.2 so a
--    mistake in this file fails `supabase db reset` instead of shipping.
-- =============================================================================
DO $$
DECLARE
  v_bad text;
BEGIN
  -- (d) no UPDATE policy without WITH CHECK — §6.19: a missing WITH CHECK
  -- permits tenant hopping.
  SELECT string_agg(tablename || '.' || policyname, ', ' ORDER BY tablename, policyname)
    INTO v_bad
  FROM pg_catalog.pg_policies
  WHERE schemaname = 'public' AND cmd = 'UPDATE' AND with_check IS NULL;

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'UPDATE policy without WITH CHECK: %', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- §3.0(2): no policy may target anon or PUBLIC. `{0}` in polroles is PUBLIC.
  SELECT string_agg(c.relname || '.' || p.polname, ', ' ORDER BY c.relname, p.polname)
    INTO v_bad
  FROM pg_catalog.pg_policy p
  JOIN pg_catalog.pg_class c     ON c.oid = p.polrelid
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND (p.polroles = '{0}'::oid[]
         OR EXISTS (SELECT 1 FROM unnest(p.polroles) r
                    WHERE r = COALESCE(to_regrole('anon')::oid, 0)));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'policy granted to anon or PUBLIC: %', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (e) every table in public has RLS on and at least one policy.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND (NOT c.relrowsecurity
         OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = c.oid));

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'table(s) with RLS off or zero policies: %', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (f) FORCE everywhere except the two §4.2 exemptions.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_bad
  FROM pg_catalog.pg_class c
  JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND NOT c.relforcerowsecurity
    AND c.relname NOT IN ('profiles', 'staff');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'table(s) without FORCE ROW LEVEL SECURITY: %', v_bad
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
