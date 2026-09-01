-- =============================================================================
-- Restaurant QR OS — local Supabase-compatible bootstrap
--
-- `supabase start` provides these roles, schemas and helper functions before any
-- project migration runs. This file recreates the subset the migration chain
-- actually depends on, so the chain can be applied and exercised on a stock
-- PostgreSQL 15+ instance in CI, with no Docker and no Supabase account.
--
-- It is NOT a migration. It is never applied to a real Supabase project, where
-- the platform owns every object below.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Roles. `anon` and `authenticated` are the two PostgREST request roles;
-- `authenticator` is the login role that switches into them; `service_role`
-- bypasses RLS the way the platform's does.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator LOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_admin') THEN
    CREATE ROLE supabase_admin SUPERUSER LOGIN;
  END IF;
END
$$;

GRANT anon, authenticated, service_role TO authenticator;

-- -----------------------------------------------------------------------------
-- Schemas the platform creates.
-- -----------------------------------------------------------------------------
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS realtime;
CREATE SCHEMA IF NOT EXISTS graphql_public;

GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- -----------------------------------------------------------------------------
-- auth.users — only the columns the project chain touches.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS auth.users (
  id                 uuid PRIMARY KEY DEFAULT extensions.gen_random_uuid(),
  email              text UNIQUE,
  raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- -----------------------------------------------------------------------------
-- auth.uid() / auth.jwt() / auth.role() read the request JWT claims exactly as
-- the platform's do, so a test can impersonate a user with:
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--   SET LOCAL ROLE authenticated;
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION auth.jwt()
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(auth.jwt() ->> 'sub', '')::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(nullif(auth.jwt() ->> 'role', ''), current_setting('role', true))
$$;

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION auth.jwt(), auth.uid(), auth.role() TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- realtime.messages + realtime.topic() — the broadcast surface the customer's
-- live order tracking subscribes to. RLS on this table is what authorises a
-- channel, so the project chain adds policies to it.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS realtime.messages (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  topic      text NOT NULL,
  extension  text NOT NULL DEFAULT 'broadcast',
  payload    jsonb,
  event      text,
  private    boolean NOT NULL DEFAULT true,
  inserted_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION realtime.topic()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT nullif(current_setting('realtime.topic', true), '')
$$;

-- realtime.send() is what a trigger calls to publish onto a channel.
CREATE OR REPLACE FUNCTION realtime.send(
  payload jsonb,
  event   text,
  topic   text,
  private boolean DEFAULT true
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO realtime.messages (topic, extension, payload, event, private)
  VALUES (topic, 'broadcast', payload, event, private);
END
$$;

GRANT USAGE ON SCHEMA realtime TO anon, authenticated, service_role;
GRANT SELECT ON realtime.messages TO anon, authenticated;
GRANT EXECUTE ON FUNCTION realtime.topic() TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- The publication Supabase Realtime reads Postgres changes from.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END
$$;
