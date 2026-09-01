-- =============================================================================
-- Restaurant QR OS — 00. Privilege baseline (fail-closed default)
-- Implements docs/architecture/02-security-and-rls.md §2.3.
--
-- This migration runs FIRST, before any table exists, so that the database is
-- deny-by-default from the very first object created. A companion migration
-- (20260901009900_privilege_baseline_reassert.sql) re-asserts the same revokes
-- at the END of the migration chain, which catches any object created in
-- between that inherited a careless default grant.
--
-- The invariant this file establishes:
--   `anon` (unauthenticated QR customers) holds NO privilege on ANY table,
--   view, sequence or routine in `public`. Every public read and write goes
--   through exactly five SECURITY DEFINER functions, granted in the re-assert
--   migration once those functions exist.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Private schema for internals that must never be reachable over PostgREST.
--    Supabase exposes only `public, storage, graphql_public`; `app_private` is
--    deliberately outside that set, so even a mistaken GRANT here is not
--    addressable from the API.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS app_private;

COMMENT ON SCHEMA app_private IS
  'Sealed schema for security-sensitive internals (token generation, capability '
  'resolution, rate-limit counters). Never added to the PostgREST exposed-schema '
  'list and never granted to anon or authenticated. Callable only from '
  'SECURITY DEFINER functions in public that are owned by postgres.';

-- -----------------------------------------------------------------------------
-- 2. Nobody may create objects in `public`.
--    Without this, any role can CREATE TABLE in public and silently widen the
--    API surface, because PostgREST exposes the whole schema.
-- -----------------------------------------------------------------------------
REVOKE CREATE ON SCHEMA public FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3. anon and authenticated may traverse `public` (required to call a function
--    that lives there) and nothing else.
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. Strip every privilege anon holds today.
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL ROUTINES  IN SCHEMA public FROM anon;

-- -----------------------------------------------------------------------------
-- 5. In PostgreSQL a new function is EXECUTE-to-PUBLIC by default. Close that
--    permanently: a function becomes callable only by an explicit GRANT.
-- -----------------------------------------------------------------------------
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Future tables and sequences must not auto-grant to anon either.
-- -----------------------------------------------------------------------------
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM anon;

-- -----------------------------------------------------------------------------
-- 7. `app_private` is sealed to everyone but its owner and service_role.
-- -----------------------------------------------------------------------------
REVOKE ALL ON SCHEMA app_private                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL TABLES   IN SCHEMA app_private FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL ROUTINES IN SCHEMA app_private FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA app_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. An anonymous request is cheap or it does not run. This bounds the damage of
--    a hostile or accidental heavy query on the public capability functions and
--    makes slow-query denial of service impractical.
-- -----------------------------------------------------------------------------
ALTER ROLE anon          SET statement_timeout = '4s';
ALTER ROLE authenticated SET statement_timeout = '15s';
