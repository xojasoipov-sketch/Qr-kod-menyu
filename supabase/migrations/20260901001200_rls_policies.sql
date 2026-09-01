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
-- exists. Each is fenced by the policies in section 2 of this file.
GRANT INSERT, UPDATE, DELETE ON
  public.restaurants,            -- INSERT/DELETE reachable by platform admin only, per policy
  public.branches,
  public.staff,
  public.tables,
  public.menu_categories,
  public.menu_items,
  public.menu_item_options,
  public.promotions
TO authenticated;

-- Step 4: narrow verbs where only one kind of change is legal. The column-level
-- restriction is not expressible as a policy and lives in the guard triggers
-- (§3.18), which run for every role including the table owner.
GRANT INSERT, UPDATE ON public.profiles           TO authenticated;  -- own row; guarded by trigger
GRANT UPDATE          ON public.orders            TO authenticated;  -- status only; guarded by trigger
GRANT UPDATE          ON public.waiter_calls      TO authenticated;  -- acknowledge / resolve
GRANT UPDATE          ON public.notifications     TO authenticated;  -- guarded by trigger
GRANT INSERT          ON public.notification_reads TO authenticated; -- marking one notification read

-- Step 5: everything not granted above stays denied. In particular NO role ever
-- receives:
--   INSERT / UPDATE / DELETE on order_items, order_item_options, order_status_history
--   INSERT / UPDATE / DELETE on qr_token_history
--   INSERT / DELETE          on orders, waiter_calls, notifications
--   DELETE                   on profiles, notification_reads
--   any verb at all          on branch_order_counters, promotion_items (write side)
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
-- the read state.
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
