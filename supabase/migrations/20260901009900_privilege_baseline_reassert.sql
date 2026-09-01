-- =============================================================================
-- Restaurant QR OS — 99. Privilege baseline re-assertion (final migration)
-- Implements docs/architecture/02-security-and-rls.md §2.3.
--
-- Runs LAST. Every migration between the baseline and this file may have created
-- tables, sequences or routines that picked up a default grant. This file takes
-- those grants away again and then re-opens exactly what the application cannot
-- work without, and nothing else:
--   §2  the five public capability RPCs                       (anon)
--   §2b the Realtime channel predicate those RPCs' customers   (anon)
--       are authorised by                                      -- F03
--   §2c three functions that run as the CALLING role inside an
--       ordinary write: a domain CHECK body and two column
--       DEFAULT expressions                                    (authenticated)
--                                                              -- F01, F02
--   §2d the guest's own cancel RPC, when the chain defines it  (anon)
--
-- A blanket REVOKE is indiscriminate: §2b, §2c and §2d exist because it took
-- away privileges that were granted deliberately, upstream, by the migration
-- that owns the object. Anything added to §1 must be re-checked against them.
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
-- 2b. Re-open what §1's blanket REVOKE closed by accident.
--
-- closes F03. `REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM anon` above is
-- indiscriminate: it also stripped the EXECUTE that
-- 20260901001400_rate_limiting.sql granted on public.order_topic_is_valid(text).
-- That function is called by the RLS policy realtime_customer_order_read on
-- realtime.messages and exists SPECIFICALLY for the anon QR customer, so with it
-- revoked an anon Realtime subscription to 'order:<public_code>' does not read
-- an empty result — it dies with 42501 'permission denied for function
-- order_topic_is_valid', i.e. customer live order tracking is completely dead.
-- Re-granted here, after the revokes, so the order of statements in this file
-- cannot take it away again.
GRANT EXECUTE ON FUNCTION public.order_topic_is_valid(text) TO anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2c. Function-level grants that ordinary AUTHENTICATED writes cannot do without.
--
-- closes F01 and F02. These three are not an API surface — no client calls them
-- by name — but each is evaluated as the CALLING role in the middle of an
-- otherwise ordinary write, so leaving them granted to postgres alone turns
-- routine staff work into 42501:
--
--   is_i18n_text(jsonb)      is the CHECK body of DOMAIN public.i18n_text, and a
--                            domain CHECK runs as the calling role, not as the
--                            domain owner. 17 columns across restaurants,
--                            menu_categories, menu_items, menu_item_options,
--                            promotions, order_items and order_item_options use
--                            that domain, so without this grant EVERY menu and
--                            restaurant-settings write by a signed-in user fails
--                            ('permission denied for function is_i18n_text') —
--                            the whole menu-management surface is dead.
--   generate_qr_token(int)   is the DEFAULT of tables.qr_token, and a column
--                            DEFAULT is evaluated as the INSERTING role, so a
--                            manager creating a table fails.
--   generate_public_code()   is the DEFAULT of orders.public_code, latent only
--                            until staff order entry inserts an order row.
--
-- anon needs none of them: it reaches these columns exclusively through the
-- SECURITY DEFINER public_* functions above, which execute as their owner.
-- Both token generators call extensions.gen_random_bytes(), so Supabase's
-- default GRANT USAGE ON SCHEMA extensions TO authenticated must stay in place
-- (without it the next error is 'permission denied for schema extensions').
GRANT EXECUTE ON FUNCTION public.is_i18n_text(jsonb)          TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_qr_token(integer)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_public_code()       TO authenticated;

-- -----------------------------------------------------------------------------
-- 2d. The sixth customer capability, if the chain defines it.
--
-- 20260901001600_staff_and_admin_rpcs.sql grants public.public_cancel_order(
-- text, text, text) to anon (doc 03 §1.4: the guest cancels their own pending
-- order with the table token plus the order's public_code). §1 above revokes it
-- again, exactly as it did to order_topic_is_valid, which would leave that RPC
-- answering 42501 to the only role that is supposed to call it. Re-granted here,
-- guarded by an existence check so that this file — the last migration in the
-- chain — never fails because of a function another migration owns and may
-- rename or renumber.
DO $$
BEGIN
  IF to_regprocedure('public.public_cancel_order(text, text, text)') IS NOT NULL THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.public_cancel_order(text, text, text) TO anon, authenticated';
  END IF;
END
$$;

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
      'public_call_waiter',
      -- Not an entry point the customer calls, but an authorisation predicate
      -- the anon customer's own Realtime RLS policy calls FOR them
      -- (realtime_customer_order_read on realtime.messages). It takes no
      -- privileged action: it only answers "is this topic string the
      -- 'order:<public_code>' of an order that exists and is still inside the
      -- 24h tracking horizon". Listed here so §2b's grant is recognised as
      -- intended rather than reported as a violation. Closes F03.
      'order_topic_is_valid',
      -- The guest's own cancel capability (doc 03 §1.4), granted by
      -- 20260901001600 and re-granted in §2d above when it exists.
      'public_cancel_order'
    );

  IF v_extra_routines > 0 THEN
    RAISE EXCEPTION
      'privilege baseline violated: anon may execute % routine(s) outside the five public entry points',
      v_extra_routines
      USING ERRCODE = 'insufficient_privilege';
  END IF;
END
$$;
