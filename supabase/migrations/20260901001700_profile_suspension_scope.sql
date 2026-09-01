-- =============================================================================
-- Restaurant QR OS — 17. Fix the profile-suspension escalation
--
-- Closes cases 4j and 4l of scripts/db/tests/01-privilege-escalation.sql, which
-- the guard-trigger migration left open.
--
-- THE DEFECT
-- ----------
-- `public.profiles.is_active` was in the column GRANT to `authenticated`, and
-- the `profiles_update_manager` policy admits any profile that shares a
-- restaurant with the caller. `trg_profiles_guard` only forbade changing your
-- OWN is_active. So:
--
--   4j  A MANAGER could set is_active = false on their restaurant's sole
--       RESTAURANT_OWNER. The staff row still reads "active owner", but the
--       human behind it is switched off — exactly the ownerless-tenant state
--       QR051_LAST_OWNER exists to prevent, reached through a different table.
--       The victim cannot undo it, because rule 3 blocks changing is_active on
--       your own row. The lockout is one-way.
--
--   4l  Worse, and cross-tenant. `can_manage_staff_of_user()` is an EXISTS over
--       ANY shared restaurant, while `profiles.is_active` is GLOBAL. If the
--       owner of a large restaurant also holds a humble WAITER job at a small
--       one, the small restaurant's MANAGER can switch off their account
--       everywhere — including the restaurant they own. A per-restaurant
--       permission was governing a platform-wide field.
--
-- THE FIX
-- -------
-- Suspension has two different meanings and they need two different columns:
--
--   public.staff.is_active     per-restaurant. "This person no longer works at
--                              this branch." A manager's call, already guarded
--                              by trg_staff_guard, and scoped to one tenant.
--   public.profiles.is_active  platform-wide. "This account is disabled
--                              everywhere." Only a platform administrator.
--
-- So `authenticated` loses the column entirely, and the guard enforces the same
-- rule independently — a manager who somehow regained the GRANT still cannot
-- write it. Belt and braces, because the GRANT is one line in a policy file and
-- the trigger is what makes the rule true regardless.
--
-- Deactivating the last functioning owner of a restaurant is refused even for a
-- platform admin, for the same reason it is refused on the staff table: a tenant
-- nobody can administer is a support incident, not an operation.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Take the column away from ordinary staff.
--    Column-level privileges are additive and independently revocable, so this
--    removes is_active without disturbing the other columns a user legitimately
--    edits on their own profile (name, phone, avatar, locale, last_seen_at).
-- -----------------------------------------------------------------------------
REVOKE UPDATE (is_active) ON public.profiles FROM authenticated;

COMMENT ON COLUMN public.profiles.is_active IS
  'Platform-wide account suspension. NOT writable by `authenticated`: per-restaurant '
  'suspension is public.staff.is_active, which is scoped to one tenant and guarded by '
  'trg_staff_guard. Writable only by a platform administrator or service_role, and never '
  'when it would leave a restaurant with no functioning owner. See migration 001700.';


-- -----------------------------------------------------------------------------
-- 2. Re-state the guard with the suspension rules included.
--
--    Rules 1 and 2 are carried over verbatim from migration 001500; rule 3 is
--    replaced. CREATE OR REPLACE keeps the existing trigger binding, so no
--    DROP TRIGGER is needed and no window exists where the table is unguarded.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_profiles_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_orphaned_restaurant UUID;
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

  -- 3. Account suspension is a PLATFORM act, not a tenant one.
  --
  --    Previously this rule only blocked changing your own is_active, which
  --    left the whole "switch off somebody else" case open (cases 4j, 4l).
  --    A restaurant manager's power to remove someone is staff.is_active, which
  --    is scoped to their own tenant; profiles.is_active is global and belongs
  --    to platform administration alone.
  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    IF NOT public.is_super_admin() THEN
      PERFORM app_private.raise_app_error('QR052_FORBIDDEN_FIELD', 403,
        jsonb_build_object(
          'field', 'is_active',
          'hint',  'Per-restaurant suspension is staff.is_active; profiles.is_active is platform-wide.'));
    END IF;

    -- 3b. Not even a platform admin may switch off their own account: a
    --     self-lockout cannot be undone from inside, exactly as with rule 2.
    IF OLD.id = (SELECT auth.uid()) THEN
      PERFORM app_private.raise_app_error('QR056_SELF_MODIFICATION', 403,
        jsonb_build_object('field', 'is_active'));
    END IF;

    -- 3c. Suspending a person must not orphan a tenant. This mirrors the
    --     last-owner rule on public.staff; without it the same ownerless state
    --     is simply reached through a different table, which is precisely how
    --     case 4j worked.
    IF NEW.is_active = false THEN
      SELECT s.restaurant_id INTO v_orphaned_restaurant
      FROM public.staff s
      WHERE s.profile_id = OLD.id
        AND s.role = 'RESTAURANT_OWNER'
        AND s.is_active
        AND NOT EXISTS (
          SELECT 1
          FROM public.staff other
          JOIN public.profiles op ON op.id = other.profile_id
          WHERE other.restaurant_id = s.restaurant_id
            AND other.role = 'RESTAURANT_OWNER'
            AND other.is_active
            AND other.profile_id <> OLD.id
            AND op.is_active)
      LIMIT 1;

      IF v_orphaned_restaurant IS NOT NULL THEN
        PERFORM app_private.raise_app_error('QR051_LAST_OWNER', 409,
          jsonb_build_object(
            'restaurant_id', v_orphaned_restaurant,
            'reason', 'suspending this account would leave the restaurant with no active owner'));
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$fn$;

REVOKE ALL ON FUNCTION public.trg_profiles_guard() FROM PUBLIC, anon, authenticated;

COMMENT ON FUNCTION public.trg_profiles_guard() IS
  'Doc 02 §3.18, extended by migration 001700. Defends the platform boundaries RLS cannot: '
  'profiles.id is immutable; is_platform_admin may be changed only by an existing platform admin '
  'and never on their own row; and is_active — a PLATFORM-WIDE suspension — may be changed only by '
  'a platform admin, never on their own row, and never when it would leave a restaurant with no '
  'active owner. Per-restaurant suspension is staff.is_active. Closes F05 and test cases 4j/4l.';
