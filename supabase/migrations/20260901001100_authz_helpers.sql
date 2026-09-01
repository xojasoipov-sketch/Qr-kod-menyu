-- =============================================================================
-- RESTAURANT QR OS — 11. Authorization helper functions
-- File: supabase/migrations/20260901001100_authz_helpers.sql
--
-- Implements docs/architecture/02-security-and-rls.md:
--   §4.1 Non-negotiable properties of every helper
--        (SECURITY DEFINER, owner = the owner of public.staff/public.profiles,
--         STABLE, PARALLEL SAFE, SET search_path = '')
--   §4.2 THE RECURSION TRAP — the mitigation, asserted here, not just described
--   §4.3 Identity and membership helpers
--        is_super_admin, current_restaurant_ids, current_branch_ids, auth_role,
--        auth_role_in_restaurant, auth_role_in_branch, is_colleague
--   §4.4 Access predicates       has_restaurant_access, has_branch_access
--   §4.5 Capability predicates   can_manage_menu, can_manage_tables,
--        can_manage_branches, can_manage_branch, can_manage_settings,
--        can_manage_staff, can_manage_staff_of_user, can_manage_orders,
--        can_work_branch
--   §4.6 Grants for the helper set (REVOKE from PUBLIC/anon, GRANT to
--        authenticated — never to anon)
--
-- Per §9.3 this is `0004_helpers.sql`: it MUST precede any policy that calls
-- these functions. §4.7 (staff-side SECURITY DEFINER RPCs) and §4.8 (the
-- app_private.security_events audit sink) are deliberately NOT in this file —
-- §9.3 places them in the public-RPC and private-machinery migrations, and both
-- depend on machinery (app_private.raise_app_error, public.public_place_order)
-- that does not exist yet.
--
-- IDENTIFIER RECONCILIATION (docs/architecture/03-domain-and-types.md §1.1,
-- which is binding where a doc-02 SQL body names an identifier doc 01 does not
-- define). Applied throughout this file:
--     doc 02 `staff.user_id`            -> `public.staff.profile_id`
--     doc 02 `profiles.is_super_admin`  -> `public.profiles.is_platform_admin`
--     doc 02 role labels                -> app_role is UPPER_SNAKE:
--       super_admin -> SUPER_ADMIN, owner -> RESTAURANT_OWNER,
--       manager -> MANAGER, waiter -> WAITER, kitchen -> KITCHEN
-- Function names, argument names, argument types and return types are doc-02
-- verbatim; only column and enum-label identifiers were rewritten.
--
-- No money is touched here.
--
-- Depends on: 20260901000100 (public.app_role),
--             20260901000200 (public.restaurants, public.branches,
--                             public.profiles, public.staff),
--             20260901001000 (RLS enablement; NO FORCE on profiles and staff).
-- =============================================================================


-- =============================================================================
-- §4.2 THE RECURSION TRAP — the mitigation, made load-bearing here
--
-- The policy on public.staff will read `restaurant_id = any(current_restaurant_ids())`,
-- and current_restaurant_ids() reads public.staff. PostgreSQL answers that with
-- SQLSTATE 42P17 `infinite recursion detected in policy for relation "staff"`,
-- and the failure is global: every policy that calls a staff-reading helper
-- starts erroring.
--
-- SECURITY DEFINER alone does NOT break the cycle. It changes current_user to
-- the function owner, and the owner is exempt from RLS only while the table is
-- not FORCE ROW LEVEL SECURITY. The mitigation therefore has two halves and
-- both must hold simultaneously:
--
--   (a) public.staff and public.profiles are ENABLE but NO FORCE row level
--       security (every other public table is FORCE). Established in
--       20260901001000; re-asserted immediately below because this file's
--       correctness depends on it and ALTER ... NO FORCE is idempotent.
--   (b) every helper below is SECURITY DEFINER owned by the role that owns
--       those two tables, so inside a helper current_user = table owner +
--       not forced => RLS is skipped => the helper reads complete staff and
--       profiles rows => no recursion, in one hop. Asserted at the end of this
--       file, so a mis-owned helper fails the migration instead of failing
--       every request at runtime.
--
-- The exemption is safe because `authenticated` is never the owner: PostgREST
-- connects as `authenticator` and SET ROLE authenticated, which is fully policy
-- controlled. Compensating controls for the two exempted tables live in §3.1
-- (REVOKE DELETE on profiles), §3.18 (trg_profiles_guard / trg_staff_guard,
-- which run for all roles including the owner) and §9.2(f) (CI asserts exactly
-- these two tables report relforcerowsecurity = false).
--
-- CONSTRAINT ON THE POLICY AUTHOR (§4.2 rule 5, restated because it is easy to
-- undo from another file): a policy on public.staff may call ONLY helpers that
-- read staff, and may never reference public.staff directly in a subquery. An
-- `EXISTS (SELECT 1 FROM public.staff ...)` inside a staff policy re-arms the
-- trap even with the owner exemption in place, because that subquery sits
-- inside staff's own policy rather than inside a definer function.
-- =============================================================================

ALTER TABLE public.profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE public.staff    NO FORCE ROW LEVEL SECURITY;


-- =============================================================================
-- §4.3 IDENTITY AND MEMBERSHIP HELPERS
-- =============================================================================

-- ---------------------------------------------------------------------------
-- is the caller a platform admin
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = (SELECT auth.uid())
      AND p.is_platform_admin
      AND p.is_active);
$fn$;

COMMENT ON FUNCTION public.is_super_admin() IS
  'Doc 02 §4.3. True when the caller holds the platform-admin flag AND is active. '
  'SUPER_ADMIN is not storable in staff.role (ck_staff_no_super_admin); it is the '
  'boolean profiles.is_platform_admin.';

-- ---------------------------------------------------------------------------
-- every restaurant the caller belongs to
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_restaurant_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce(array_agg(DISTINCT s.restaurant_id), '{}'::uuid[])
  FROM public.staff s
  JOIN public.profiles p ON p.id = s.profile_id
  WHERE s.profile_id = (SELECT auth.uid())
    AND s.is_active
    AND p.is_active;
$fn$;

COMMENT ON FUNCTION public.current_restaurant_ids() IS
  'Doc 02 §4.3. Tenant set of the caller. Never NULL — an empty array, so '
  '`restaurant_id = any(...)` is a clean false rather than NULL. Used as '
  '`col = any(public.current_restaurant_ids())`; STABLE so it is an InitPlan '
  'evaluated once per query, not once per row.';

-- ---------------------------------------------------------------------------
-- every branch the caller may touch
-- A staff row with branch_id IS NULL (owner, restaurant-wide manager) expands to
-- all branches of that restaurant. Inactive branches are included: admins must
-- still be able to manage them.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_branch_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT coalesce(array_agg(DISTINCT b.id), '{}'::uuid[])
  FROM public.staff s
  JOIN public.profiles p ON p.id = s.profile_id
  JOIN public.branches b
    ON b.restaurant_id = s.restaurant_id
   AND (s.branch_id IS NULL OR b.id = s.branch_id)
  WHERE s.profile_id = (SELECT auth.uid())
    AND s.is_active
    AND p.is_active;
$fn$;

COMMENT ON FUNCTION public.current_branch_ids() IS
  'Doc 02 §4.3. Branch set of the caller. A restaurant-wide membership '
  '(staff.branch_id IS NULL) expands to every branch of that restaurant. '
  'Deactivated branches are deliberately included so an owner can still '
  'administer them.';

-- ---------------------------------------------------------------------------
-- caller's highest role overall
-- Rank order: SUPER_ADMIN > RESTAURANT_OWNER > MANAGER > WAITER > KITCHEN.
-- Used for coarse UI-independent branching and as the fallback actor in
-- trg_orders_guard().
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN public.is_super_admin() THEN 'SUPER_ADMIN'::public.app_role
    ELSE (
      SELECT s.role
      FROM public.staff s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE s.profile_id = (SELECT auth.uid())
        AND s.is_active
        AND p.is_active
      ORDER BY array_position(
        ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[], s.role)
      LIMIT 1)
  END;
$fn$;

COMMENT ON FUNCTION public.auth_role() IS
  'Doc 02 §4.3. The caller''s strongest role across all tenants, or NULL when the '
  'caller holds no active membership. Coarse: authorization decisions must use the '
  'scoped variants (auth_role_in_restaurant / auth_role_in_branch), never this one.';

-- ---------------------------------------------------------------------------
-- caller's role inside one restaurant
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_role_in_restaurant(p_restaurant_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN public.is_super_admin() THEN 'SUPER_ADMIN'::public.app_role
    ELSE (
      SELECT s.role
      FROM public.staff s
      JOIN public.profiles p ON p.id = s.profile_id
      WHERE s.profile_id   = (SELECT auth.uid())
        AND s.restaurant_id = p_restaurant_id
        AND s.is_active
        AND p.is_active
      ORDER BY array_position(
        ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[], s.role)
      LIMIT 1)
  END;
$fn$;

COMMENT ON FUNCTION public.auth_role_in_restaurant(uuid) IS
  'Doc 02 §4.3. The caller''s strongest active role in one tenant, NULL when they '
  'have none. A platform admin short-circuits to SUPER_ADMIN for every tenant.';

-- ---------------------------------------------------------------------------
-- caller's role inside one branch
-- A restaurant-wide membership (branch_id IS NULL) counts for every branch of
-- that restaurant.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.auth_role_in_branch(p_branch_id uuid)
RETURNS public.app_role
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT CASE
    WHEN public.is_super_admin() THEN 'SUPER_ADMIN'::public.app_role
    ELSE (
      SELECT s.role
      FROM public.staff s
      JOIN public.profiles p ON p.id = s.profile_id
      JOIN public.branches b ON b.restaurant_id = s.restaurant_id
      WHERE s.profile_id = (SELECT auth.uid())
        AND b.id         = p_branch_id
        AND (s.branch_id IS NULL OR s.branch_id = b.id)
        AND s.is_active
        AND p.is_active
      ORDER BY array_position(
        ARRAY['RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN']::public.app_role[], s.role)
      LIMIT 1)
  END;
$fn$;

COMMENT ON FUNCTION public.auth_role_in_branch(uuid) IS
  'Doc 02 §4.3. The caller''s strongest active role at one branch. The join to '
  'public.branches is what expands a restaurant-wide membership (branch_id IS NULL) '
  'across that restaurant''s branches while refusing to leak it across tenants.';

-- ---------------------------------------------------------------------------
-- do we share a restaurant?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_colleague(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
PARALLEL SAFE
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.profile_id = p_user_id
      AND s.restaurant_id = ANY (public.current_restaurant_ids()));
$fn$;

COMMENT ON FUNCTION public.is_colleague(uuid) IS
  'Doc 02 §4.3. True when the argument profile holds a membership in any tenant the '
  'caller belongs to. Backs the profiles SELECT policy: staff see each other''s '
  'profiles inside a shared restaurant and nowhere else.';


-- =============================================================================
-- §4.4 ACCESS PREDICATES
-- =============================================================================

CREATE OR REPLACE FUNCTION public.has_restaurant_access(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.is_super_admin()
      OR (p_restaurant_id IS NOT NULL
          AND p_restaurant_id = ANY (public.current_restaurant_ids()));
$fn$;

COMMENT ON FUNCTION public.has_restaurant_access(uuid) IS
  'Doc 02 §4.4. Tenant visibility predicate. The explicit NULL guard keeps the '
  'result boolean rather than NULL, so a policy using it can never accidentally '
  'evaluate to NULL and be misread.';

CREATE OR REPLACE FUNCTION public.has_branch_access(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.is_super_admin()
      OR (p_branch_id IS NOT NULL
          AND p_branch_id = ANY (public.current_branch_ids()));
$fn$;

COMMENT ON FUNCTION public.has_branch_access(uuid) IS
  'Doc 02 §4.4. Branch visibility predicate. Visibility only — the capability '
  'predicates in §4.5 decide whether the caller may change anything.';


-- =============================================================================
-- §4.5 CAPABILITY PREDICATES (the RBAC matrix, expressed once)
--
-- Every one of these is a role test, never a row test. Row scoping is the job of
-- the policy that calls them. Expressing the matrix once here is what keeps the
-- 16 policy sets in §3 from drifting apart.
-- =============================================================================

-- Menu, categories, options, promotions: owner + manager.
CREATE OR REPLACE FUNCTION public.can_manage_menu(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_restaurant(p_restaurant_id)
         IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER');
$fn$;

COMMENT ON FUNCTION public.can_manage_menu(uuid) IS
  'Doc 02 §4.5. Menu, categories, options and promotions: RESTAURANT_OWNER and '
  'MANAGER, restaurant-scoped.';

-- Tables and QR tokens: owner + manager, scoped to the branch.
CREATE OR REPLACE FUNCTION public.can_manage_tables(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_branch(p_branch_id) IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER');
$fn$;

COMMENT ON FUNCTION public.can_manage_tables(uuid) IS
  'Doc 02 §4.5. Tables and QR token rotation: RESTAURANT_OWNER and MANAGER, '
  'branch-scoped. Gate of admin_rotate_table_token() (§4.7).';

-- Creating/deleting branches, and restaurant-wide branch edits: owner only.
CREATE OR REPLACE FUNCTION public.can_manage_branches(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_restaurant(p_restaurant_id) IN ('SUPER_ADMIN','RESTAURANT_OWNER');
$fn$;

COMMENT ON FUNCTION public.can_manage_branches(uuid) IS
  'Doc 02 §4.5. Creating and deleting branches, and restaurant-wide branch edits: '
  'RESTAURANT_OWNER only. Distinct from can_manage_branch(), which is per-branch.';

-- Editing one branch's own settings: owner, or the manager assigned to that branch.
CREATE OR REPLACE FUNCTION public.can_manage_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_branch(p_branch_id) IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER');
$fn$;

COMMENT ON FUNCTION public.can_manage_branch(uuid) IS
  'Doc 02 §4.5. Editing one branch''s own settings: RESTAURANT_OWNER, or the MANAGER '
  'rostered on that branch.';

-- Restaurant settings, currency, service fee, billing: owner only.
CREATE OR REPLACE FUNCTION public.can_manage_settings(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_restaurant(p_restaurant_id) IN ('SUPER_ADMIN','RESTAURANT_OWNER');
$fn$;

COMMENT ON FUNCTION public.can_manage_settings(uuid) IS
  'Doc 02 §4.5. Restaurant settings, currency, service fee and billing: '
  'RESTAURANT_OWNER only. A MANAGER must not be able to move currency or fee, which '
  'are pricing inputs snapshotted onto every order.';

-- Staff roster: owner + manager (the escalation limits live in trg_staff_guard()).
CREATE OR REPLACE FUNCTION public.can_manage_staff(p_restaurant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_restaurant(p_restaurant_id)
         IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER');
$fn$;

COMMENT ON FUNCTION public.can_manage_staff(uuid) IS
  'Doc 02 §4.5. Roster management: RESTAURANT_OWNER and MANAGER. This predicate '
  'says only "may touch the roster" — the anti-escalation rules (a MANAGER cannot '
  'mint an owner, nobody self-promotes) live in trg_staff_guard(), §3.18.';

-- "May I edit this person's profile?" — true if we manage staff in ANY restaurant
-- they belong to.
CREATE OR REPLACE FUNCTION public.can_manage_staff_of_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff s
    WHERE s.profile_id = p_user_id
      AND public.can_manage_staff(s.restaurant_id));
$fn$;

COMMENT ON FUNCTION public.can_manage_staff_of_user(uuid) IS
  'Doc 02 §4.5. True when the caller manages the roster of at least one tenant the '
  'argument profile belongs to. Backs the profiles UPDATE policy for other people''s '
  'rows.';

-- Front-of-house order book: owner + manager + waiter of the branch.
CREATE OR REPLACE FUNCTION public.can_manage_orders(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_branch(p_branch_id)
         IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','WAITER');
$fn$;

COMMENT ON FUNCTION public.can_manage_orders(uuid) IS
  'Doc 02 §4.5. Front-of-house order book: RESTAURANT_OWNER, MANAGER and WAITER of '
  'the branch. KITCHEN is excluded on purpose — it advances status through the KDS '
  'path, it does not own the order book.';

-- Anyone rostered on the branch, kitchen included.
CREATE OR REPLACE FUNCTION public.can_work_branch(p_branch_id uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE SECURITY DEFINER SET search_path = ''
AS $fn$
  SELECT public.auth_role_in_branch(p_branch_id)
         IN ('SUPER_ADMIN','RESTAURANT_OWNER','MANAGER','WAITER','KITCHEN');
$fn$;

COMMENT ON FUNCTION public.can_work_branch(uuid) IS
  'Doc 02 §4.5. Any active membership at the branch, KITCHEN included. The read '
  'gate for the KDS and the branch order feed.';


-- =============================================================================
-- §4.6 GRANTS FOR THE HELPER SET
--
-- None of these is granted to `anon`. A public customer has no membership, so
-- every one of them would return false or NULL anyway; withholding EXECUTE also
-- keeps the roster shape out of the unauthenticated OpenAPI document.
--
-- The loop is driven from pg_proc rather than a literal signature list so it
-- covers every overload and cannot drift from the definitions above.
-- `order_transition_allowed` is listed verbatim from the spec: it is created by
-- the state-machine migration (§3.17), which issues the same REVOKE/GRANT pair
-- itself. Until that migration runs, the name simply matches nothing here.
-- =============================================================================

DO $grants$
DECLARE fn record;
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'is_super_admin','current_restaurant_ids','current_branch_ids','auth_role',
        'auth_role_in_restaurant','auth_role_in_branch','is_colleague',
        'has_restaurant_access','has_branch_access','can_manage_menu','can_manage_tables',
        'can_manage_branches','can_manage_branch','can_manage_settings','can_manage_staff',
        'can_manage_staff_of_user','can_manage_orders','can_work_branch',
        'order_transition_allowed')
  LOOP
    EXECUTE format('revoke all on function %s from public, anon', fn.sig);
    EXECUTE format('grant execute on function %s to authenticated', fn.sig);
  END LOOP;
END
$grants$;


-- =============================================================================
-- SELF-TEST — the §4.1 properties and the §4.2 recursion-trap mitigation are
-- assertions, not comments. A helper that loses SECURITY DEFINER, loses its
-- pinned search_path, becomes VOLATILE, becomes PARALLEL UNSAFE, or ends up
-- owned by a role other than the owner of public.staff / public.profiles is a
-- live authorization defect: it either re-arms the 42P17 recursion or turns
-- every RLS check into a per-row function call. Fail the migration here rather
-- than discover it as 500s in production.
-- =============================================================================

DO $verify$
DECLARE
  v_table_owner oid;
  v_bad         text;
  v_forced      text;
BEGIN
  -- (a) The two exempted tables must exist, be RLS-enabled, and be NO FORCE.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_forced
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('staff','profiles')
    AND (c.relforcerowsecurity OR NOT c.relrowsecurity);

  IF v_forced IS NOT NULL THEN
    RAISE EXCEPTION
      'authz helpers: % must be ENABLE + NO FORCE row level security (doc 02 §4.2); '
      'FORCE re-arms the 42P17 recursion in the staff policy', v_forced;
  END IF;

  -- staff and profiles share an owner by construction; take it from staff.
  SELECT c.relowner INTO STRICT v_table_owner
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname = 'staff';

  -- (b) Every helper: SECURITY DEFINER, search_path pinned, STABLE,
  --     PARALLEL SAFE, owned by the owner of the tables it reads.
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'is_super_admin','current_restaurant_ids','current_branch_ids','auth_role',
      'auth_role_in_restaurant','auth_role_in_branch','is_colleague',
      'has_restaurant_access','has_branch_access','can_manage_menu','can_manage_tables',
      'can_manage_branches','can_manage_branch','can_manage_settings','can_manage_staff',
      'can_manage_staff_of_user','can_manage_orders','can_work_branch')
    AND (
         NOT p.prosecdef
      OR p.provolatile <> 's'
      OR p.proparallel <> 's'
      OR p.proowner    <> v_table_owner
      OR coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=%'
    );

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'authz helpers: % violate doc 02 §4.1 (must be SECURITY DEFINER, STABLE, '
      'PARALLEL SAFE, SET search_path = '''', owned by the owner of public.staff)', v_bad;
  END IF;

  -- (c) anon must hold EXECUTE on none of them (doc 02 §4.6, CI gate §9.2(b)).
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text)
    INTO v_bad
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'is_super_admin','current_restaurant_ids','current_branch_ids','auth_role',
      'auth_role_in_restaurant','auth_role_in_branch','is_colleague',
      'has_restaurant_access','has_branch_access','can_manage_menu','can_manage_tables',
      'can_manage_branches','can_manage_branch','can_manage_settings','can_manage_staff',
      'can_manage_staff_of_user','can_manage_orders','can_work_branch')
    AND has_function_privilege('anon', p.oid, 'execute');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION
      'authz helpers: anon holds EXECUTE on %; doc 02 §4.6 grants these to '
      'authenticated only', v_bad;
  END IF;
END
$verify$;
