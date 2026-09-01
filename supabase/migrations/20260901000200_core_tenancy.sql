-- =============================================================================
-- 20260901000200_core_tenancy.sql
--
-- RESTAURANT QR OS — core tenancy tables.
-- Implements 01-database-schema.md §6.1 restaurants, §6.2 branches,
-- §6.3 profiles, §6.4 staff (plus the two partial unique indexes §8.2 declares
-- as "declared with their tables", which the spec emits inline in §6.4).
--
-- Establishes Invariant T1 (tenant closure) for this layer: restaurants is the
-- tenant root; branches and staff each expose the redundant UNIQUE
-- (restaurant_id, id) key that every downstream composite FK targets.
--
-- Depends on migration 20260901000100 (§3 domains i18n_text / bps, §4 enums
-- app_locale / app_role) and on Supabase's auth.users.
-- Triggers (§7) and the remaining indexes (§8.3) are created in later
-- migrations; none are created here.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §6.1 restaurants — the tenant root
-- -----------------------------------------------------------------------------
CREATE TABLE public.restaurants (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  name               TEXT        NOT NULL,
  slug               TEXT        NOT NULL,
  logo_url           TEXT,
  logo_path          TEXT,
  cover_image_url    TEXT,
  phone              TEXT,
  email              TEXT,

  welcome_message    public.i18n_text,
  description        public.i18n_text,

  default_locale     public.app_locale NOT NULL DEFAULT 'uz',
  currency           CHAR(3)     NOT NULL DEFAULT 'UZS',
  currency_decimals  SMALLINT    NOT NULL DEFAULT 0,

  service_fee_bps    public.bps  NOT NULL DEFAULT 0,
  service_fee_enabled BOOLEAN    NOT NULL DEFAULT false,

  settings           JSONB       NOT NULL DEFAULT '{}'::jsonb,

  is_active          BOOLEAN     NOT NULL DEFAULT true,
  is_demo            BOOLEAN     NOT NULL DEFAULT false,

  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT ck_restaurants_name_len
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),

  CONSTRAINT ck_restaurants_slug_format
    CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,60}[a-z0-9]$'),

  CONSTRAINT ck_restaurants_slug_not_reserved
    CHECK (slug NOT IN (
      't', 'o', 'api', 'auth', 'admin', 'login', 'logout', 'signup', 'kitchen',
      'waiter', 'app', 'www', 'static', 'assets', 'public', 'health', 'favicon'
    )),

  CONSTRAINT ck_restaurants_currency_format
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT ck_restaurants_currency_decimals
    CHECK (currency_decimals BETWEEN 0 AND 4),

  CONSTRAINT ck_restaurants_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{5,24}$'),

  CONSTRAINT ck_restaurants_email_format
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  CONSTRAINT ck_restaurants_settings_object
    CHECK (jsonb_typeof(settings) = 'object'),

  CONSTRAINT ck_restaurants_urls_len
    CHECK (
      (logo_url        IS NULL OR char_length(logo_url)        <= 1024) AND
      (cover_image_url IS NULL OR char_length(cover_image_url) <= 1024) AND
      (logo_path       IS NULL OR char_length(logo_path)       <= 512)
    ),

  CONSTRAINT uq_restaurants_slug UNIQUE (slug)
);

COMMENT ON TABLE  public.restaurants IS
  'The tenant root. Every tenant-scoped row in this database traces to exactly one row here (Invariant T1).';
COMMENT ON COLUMN public.restaurants.slug IS
  'URL-safe tenant handle used in admin routes (/admin/<slug>/...). Reserved words are rejected so a slug can never shadow an application route - notably /t/ (QR resolution) and /o/ (order tracking).';
COMMENT ON COLUMN public.restaurants.currency IS
  'ISO-4217 alphabetic code. Governs how every money_minor value in this tenant is FORMATTED; it never changes how one is STORED (always minor units).';
COMMENT ON COLUMN public.restaurants.currency_decimals IS
  'Number of decimal places for currency. 0 for UZS (45000 minor units renders as "45 000 so''m"); 2 for USD (4500 renders as "$45.00"). Formatting divisor is 10^currency_decimals.';
COMMENT ON COLUMN public.restaurants.service_fee_bps IS
  'Default service charge in basis points (10000 = 100.00%). Branches may override (branches.service_fee_bps). Snapshotted onto every order as orders.service_fee_bps.';
COMMENT ON COLUMN public.restaurants.service_fee_enabled IS
  'Master switch for the "service fee (if enabled)" line in the cart (brief §7). When false the order pricing service writes service_fee_bps = 0 onto the order regardless of the configured rate.';
COMMENT ON COLUMN public.restaurants.logo_path IS
  'Supabase Storage object path (bucket-relative) backing logo_url. Kept alongside the public URL so that replacing or deleting a logo can remove the old object instead of orphaning it.';
COMMENT ON COLUMN public.restaurants.is_demo IS
  'Marks seeded demonstration tenants. Brief §11 requires that demo data be clearly separated from real analytics; every analytics query filters is_demo = false unless explicitly asked otherwise.';
COMMENT ON COLUMN public.restaurants.is_active IS
  'Operational switch. A false value makes every QR of this tenant resolve to the "restaurant unavailable" state (brief §32) without deleting anything.';
COMMENT ON COLUMN public.restaurants.deleted_at IS
  'Soft delete. Hard-deleting a tenant would cascade into historical orders; offboarding sets this and disables is_active instead.';

-- -----------------------------------------------------------------------------
-- §6.2 branches
-- -----------------------------------------------------------------------------
CREATE TABLE public.branches (
  id                            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id                 UUID        NOT NULL,

  name                          TEXT        NOT NULL,
  code                          TEXT        NOT NULL,
  address                       TEXT,
  phone                         TEXT,
  timezone                      TEXT        NOT NULL DEFAULT 'Asia/Tashkent',

  latitude                      NUMERIC(9,6),
  longitude                     NUMERIC(9,6),

  service_fee_bps               public.bps,

  opening_hours                 JSONB       NOT NULL DEFAULT '{}'::jsonb,

  waiter_call_cooldown_seconds  INTEGER     NOT NULL DEFAULT 90,
  waiter_call_expiry_minutes    INTEGER     NOT NULL DEFAULT 30,
  order_min_interval_seconds    INTEGER     NOT NULL DEFAULT 20,
  default_prep_minutes          SMALLINT    NOT NULL DEFAULT 15,
  late_order_threshold_minutes  SMALLINT    NOT NULL DEFAULT 25,

  is_active                     BOOLEAN     NOT NULL DEFAULT true,
  is_accepting_orders           BOOLEAN     NOT NULL DEFAULT true,

  deleted_at                    TIMESTAMPTZ,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_branches_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT uq_branches_tenant UNIQUE (restaurant_id, id),
  CONSTRAINT uq_branches_code   UNIQUE (restaurant_id, code),

  CONSTRAINT ck_branches_name_len
    CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),

  CONSTRAINT ck_branches_code_format
    CHECK (code ~ '^[A-Z][A-Z0-9]{0,3}$'),

  CONSTRAINT ck_branches_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{5,24}$'),

  CONSTRAINT ck_branches_opening_hours_object
    CHECK (jsonb_typeof(opening_hours) = 'object'),

  CONSTRAINT ck_branches_geo_pair
    CHECK ((latitude IS NULL) = (longitude IS NULL)),

  CONSTRAINT ck_branches_latitude_range
    CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),

  CONSTRAINT ck_branches_longitude_range
    CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),

  CONSTRAINT ck_branches_cooldown_range
    CHECK (waiter_call_cooldown_seconds BETWEEN 0 AND 3600),

  CONSTRAINT ck_branches_expiry_range
    CHECK (waiter_call_expiry_minutes BETWEEN 1 AND 1440),

  CONSTRAINT ck_branches_order_interval_range
    CHECK (order_min_interval_seconds BETWEEN 0 AND 3600),

  CONSTRAINT ck_branches_prep_minutes_range
    CHECK (default_prep_minutes BETWEEN 1 AND 240),

  CONSTRAINT ck_branches_late_threshold_range
    CHECK (late_order_threshold_minutes BETWEEN 1 AND 480)
);

COMMENT ON TABLE  public.branches IS
  'A physical location of a restaurant. The unit of operational scoping: waiters, kitchen staff, tables, orders and waiter calls are all branch-scoped.';
COMMENT ON COLUMN public.branches.code IS
  'Short human branch code, 1-4 uppercase chars (A, B, MAIN, C2). Unique per restaurant. This is the letter in the human-friendly order number #A-014 (see §7.3) and MUST be short enough to fit a kitchen ticket header.';
COMMENT ON COLUMN public.branches.timezone IS
  'IANA timezone name. Load-bearing, not cosmetic: the daily order-number counter rolls over at local midnight in THIS timezone (§7.3), and analytics "today" is computed here. Validity is enforced against pg_timezone_names by trg_branches_validate_timezone, because a CHECK cannot call the non-immutable timezone machinery.';
COMMENT ON COLUMN public.branches.service_fee_bps IS
  'Per-branch service-charge override in basis points. NULL means inherit restaurants.service_fee_bps. Resolution happens once, server-side, at order creation, and the result is snapshotted onto orders.service_fee_bps.';
COMMENT ON COLUMN public.branches.opening_hours IS
  'Weekly schedule as {"mon":[{"open":"10:00","close":"23:00"}], ...}. Advisory for the customer app ("closed now") and for the menu daypart resolver; it does not itself block ordering. is_accepting_orders is the hard switch.';
COMMENT ON COLUMN public.branches.waiter_call_cooldown_seconds IS
  'Anti-spam window for CALL WAITER (brief §10, §27). Enforced in the database by trg_waiter_calls_cooldown, so the protection survives any API bug or direct client call.';
COMMENT ON COLUMN public.branches.waiter_call_expiry_minutes IS
  'A pending/acknowledged waiter call older than this is auto-set to expired by the housekeeping job, so a forgotten call cannot ring on the console forever and cannot permanently block the table via uq_waiter_calls_open_per_table.';
COMMENT ON COLUMN public.branches.order_min_interval_seconds IS
  'Minimum gap between two orders from the same anonymous customer session at the same table. Order-spam protection (brief §27), enforced by trg_orders_rate_limit.';
COMMENT ON COLUMN public.branches.default_prep_minutes IS
  'Fallback preparation time used when no line item declares one; feeds orders.estimated_prep_minutes and therefore orders.due_at.';
COMMENT ON COLUMN public.branches.late_order_threshold_minutes IS
  'A KDS card is flagged LATE (brief §9) once now() - orders.placed_at exceeds this. Configurable per branch because a pizza kitchen and a plov kitchen have different normal.';
COMMENT ON COLUMN public.branches.is_accepting_orders IS
  'Panic switch, separate from is_active. is_active = false hides the branch entirely; is_accepting_orders = false keeps the menu browsable but rejects order creation ("kitchen is closed"), which is a real and frequent operational state.';

-- -----------------------------------------------------------------------------
-- §6.3 profiles — the human identity (1:1 with auth.users)
-- -----------------------------------------------------------------------------
CREATE TABLE public.profiles (
  id                 UUID        PRIMARY KEY,

  email              TEXT,
  full_name          TEXT,
  phone              TEXT,
  avatar_url         TEXT,
  avatar_path        TEXT,
  locale             public.app_locale NOT NULL DEFAULT 'uz',

  is_platform_admin  BOOLEAN     NOT NULL DEFAULT false,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  last_seen_at       TIMESTAMPTZ,

  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_profiles_auth_user
    FOREIGN KEY (id) REFERENCES auth.users (id) ON DELETE CASCADE,

  CONSTRAINT ck_profiles_full_name_len
    CHECK (full_name IS NULL OR char_length(btrim(full_name)) BETWEEN 1 AND 120),

  CONSTRAINT ck_profiles_email_format
    CHECK (email IS NULL OR email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),

  CONSTRAINT ck_profiles_email_lowercase
    CHECK (email IS NULL OR email = lower(email)),

  CONSTRAINT ck_profiles_phone_format
    CHECK (phone IS NULL OR phone ~ '^\+?[0-9 ()-]{5,24}$')
);

COMMENT ON TABLE  public.profiles IS
  'Application-level identity, 1:1 with auth.users. Only STAFF have profiles - customers never authenticate (brief §11) and therefore never appear here.';
COMMENT ON COLUMN public.profiles.id IS
  'DELIBERATE EXCEPTION to the "id uuid default gen_random_uuid()" rule. This is auth.users.id verbatim, with NO default. Two reasons: (1) it makes auth.uid() = profiles.id, so every RLS policy in 02-rls-and-authorization.md is one join shorter and reads as a direct equality; (2) a second, generated PK would allow two profile rows for one auth user, an illegal state this eliminates structurally rather than by unique index.';
COMMENT ON COLUMN public.profiles.email IS
  'Lower-cased display copy of auth.users.email. NOT UNIQUE and not authoritative: auth.users owns email uniqueness, and a second unique index here would create a write-ordering hazard during signup and social-account linking.';
COMMENT ON COLUMN public.profiles.is_platform_admin IS
  'SUPER_ADMIN (brief §16). Modelled as a profile boolean rather than a staff row because staff.restaurant_id is NOT NULL, and that non-nullability is the multi-tenant invariant every FK and every RLS policy depends on. Allowing one role to null it would poison the entire authorization model for a single actor type. RLS grants platform admins access via a separate branch of each policy.';
COMMENT ON COLUMN public.profiles.locale IS
  'Preferred language for the admin/kitchen/waiter UI. Public customers store locale in a cookie instead - they have no row here.';
COMMENT ON COLUMN public.profiles.is_active IS
  'Global suspension of a human, independent of their per-restaurant staff rows. Used to lock out a departed employee who holds memberships in several tenants.';

-- -----------------------------------------------------------------------------
-- §6.4 staff — membership, role and branch scope
-- -----------------------------------------------------------------------------
CREATE TABLE public.staff (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL,
  branch_id      UUID,
  profile_id     UUID        NOT NULL,

  role           public.app_role NOT NULL,
  permissions    JSONB       NOT NULL DEFAULT '{}'::jsonb,

  display_name   TEXT,
  employee_code  TEXT,

  is_active      BOOLEAN     NOT NULL DEFAULT true,
  invited_at     TIMESTAMPTZ,
  joined_at      TIMESTAMPTZ,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_staff_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_staff_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_staff_profile
    FOREIGN KEY (profile_id) REFERENCES public.profiles (id) ON DELETE CASCADE,

  CONSTRAINT uq_staff_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT uq_staff_membership
    UNIQUE NULLS NOT DISTINCT (restaurant_id, profile_id, branch_id, role),

  CONSTRAINT ck_staff_no_super_admin
    CHECK (role <> 'SUPER_ADMIN'),

  CONSTRAINT ck_staff_role_scope
    CHECK (
      (role = 'RESTAURANT_OWNER' AND branch_id IS NULL)
      OR (role = 'MANAGER')
      OR (role IN ('WAITER', 'KITCHEN') AND branch_id IS NOT NULL)
    ),

  CONSTRAINT ck_staff_permissions_object
    CHECK (jsonb_typeof(permissions) = 'object'),

  CONSTRAINT ck_staff_employee_code_format
    CHECK (employee_code IS NULL OR employee_code ~ '^[A-Za-z0-9_-]{1,16}$'),

  CONSTRAINT ck_staff_display_name_len
    CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 80)
);

-- Exactly-one-branch enforcement for operational roles (§6.4 / §8.2).
-- These two partial unique indexes are the ones the spec declares inline with
-- the table; §8.3's explicit indexes belong to migration 9, not here.
CREATE UNIQUE INDEX uq_staff_operational_single_branch
  ON public.staff (restaurant_id, profile_id, role)
  WHERE role IN ('WAITER', 'KITCHEN');

CREATE UNIQUE INDEX uq_staff_employee_code
  ON public.staff (restaurant_id, employee_code)
  WHERE employee_code IS NOT NULL;

COMMENT ON TABLE  public.staff IS
  'Ties a profile to a restaurant, with a role and an optional branch. This is the ONLY table an RLS policy needs to consult to answer "may this user touch this tenant/branch".';
COMMENT ON COLUMN public.staff.restaurant_id IS
  'NOT NULL by design. This is the anchor of the entire authorization model: every membership is scoped to exactly one tenant, with no nullable escape hatch. SUPER_ADMIN, the only role without a tenant, is therefore not representable here (ck_staff_no_super_admin) and lives on profiles.is_platform_admin.';
COMMENT ON COLUMN public.staff.branch_id IS
  'NULL = restaurant-wide scope (all branches). NOT NULL = pinned to one branch. Which is legal depends on role, per ck_staff_role_scope. The composite FK to branches (restaurant_id, id) uses MATCH SIMPLE, so a NULL branch_id skips the branch check while restaurant_id is still enforced by fk_staff_restaurant - exactly the semantics wanted.';
COMMENT ON COLUMN public.staff.role IS
  'RBAC role for this membership. A person may legitimately hold several memberships (owner of restaurant X, waiter at branch B of restaurant Y); each is its own row.';
COMMENT ON COLUMN public.staff.permissions IS
  'Fine-grained overrides for MANAGER ("menu/tables/orders/staff per permission", brief §16), e.g. {"menu":true,"staff":false,"analytics":true}. Absent keys fall back to the role default table in 02-rls-and-authorization.md. Ignored for the other roles, whose capability set is fixed.';
COMMENT ON COLUMN public.staff.display_name IS
  'Name shown on kitchen/waiter tickets ("Aziz"), which is often a short first name rather than profiles.full_name. NULL falls back to profiles.full_name.';
COMMENT ON COLUMN public.staff.is_active IS
  'Deactivating a membership must never delete it: order_status_history and waiter_calls reference staff rows and a former employee''s actions must remain attributable.';
