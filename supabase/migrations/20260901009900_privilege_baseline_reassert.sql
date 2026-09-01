-- =============================================================================
-- Restaurant QR OS — 99. Privilege baseline re-assertion (final migration)
-- Implements docs/architecture/02-security-and-rls.md §2.3.
--
-- Runs LAST. Every migration between the baseline and this file may have created
-- tables, sequences or routines that picked up a default grant. This file takes
-- those grants away again and then opens exactly five doors — the public
-- capability API — and nothing else.
--
-- Keep this file as the highest-numbered migration in the directory. If a new
-- migration is added later, renumber so this one still runs last.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Re-strip anon. Anything created since the baseline is closed here.
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM PUBLIC;

REVOKE ALL ON ALL TABLES   IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. The ONLY five things an unauthenticated QR customer may do.
--    Each is a SECURITY DEFINER function that takes the table's QR token as a
--    bearer capability and returns a fixed, reviewed JSON shape scoped to that
--    one table's restaurant and branch.
-- -----------------------------------------------------------------------------
GRANT EXECUTE ON FUNCTION public.public_resolve_table(text)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_menu(text)                       TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_place_order(text, jsonb, text, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_get_order(text, text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_call_waiter(text, text)              TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. Self-check. These two queries MUST return zero rows on a correct database.
--    They are asserted here so that `supabase db reset` fails loudly rather than
--    silently shipping an over-permissive API.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_table_grants   integer;
  v_extra_routines integer;
BEGIN
  -- Scoped to the schemas this project owns. Supabase legitimately grants anon
  -- SELECT on realtime.messages (channel authorisation is done by RLS on that
  -- table), and storage has its own platform-managed grants; neither is ours to
  -- assert on.
  SELECT count(*) INTO v_table_grants
  FROM information_schema.role_table_grants
  WHERE grantee = 'anon'
    AND table_schema IN ('public', 'app_private');

  IF v_table_grants > 0 THEN
    RAISE EXCEPTION
      'privilege baseline violated: anon holds % table privilege(s) in public/app_private; expected 0',
      v_table_grants
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT count(*) INTO v_extra_routines
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE has_function_privilege('anon', p.oid, 'execute')
    AND n.nspname IN ('public', 'app_private')
    AND p.proname NOT IN (
      'public_resolve_table',
      'public_get_menu',
      'public_place_order',
      'public_get_order',
      'public_call_waiter'
    );

  IF v_extra_routines > 0 THEN
    RAISE EXCEPTION
      'privilege baseline violated: anon may execute % routine(s) outside the five public entry points',
      v_extra_routines
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
