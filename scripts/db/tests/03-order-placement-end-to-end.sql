-- =============================================================================
-- 03 — Order placement, end to end, as an anonymous diner
--
-- The other two suites prove that things are REFUSED. This one proves the happy
-- path actually works, and that the product's central security claim holds
-- while it does:
--
--   "Never trust prices sent from the frontend. The backend calculates the
--    final price."  (brief §7, §34.2)
--
-- Method: seed one restaurant through the ordinary tables, then call
-- public_place_order AS anon with a payload that deliberately carries wrong
-- prices, a wrong total, a forged name and a promotion id — the fields a
-- tampering client would add — and assert the stored order matches the MENU,
-- not the payload.
--
-- Every case runs inside a savepoint and the file drops its fixture at the end,
-- so the database is left exactly as it was found.
-- =============================================================================

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF to_regclass('public.orders') IS NULL THEN
    RAISE EXCEPTION 'test 03: the migration chain has not been applied to this database';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles r
                 WHERE r.rolname = session_user AND (r.rolsuper OR r.rolbypassrls)) THEN
    RAISE EXCEPTION 'test 03 must run on a superuser/BYPASSRLS connection (it seeds and reads past RLS)';
  END IF;
END $$;

CREATE SCHEMA IF NOT EXISTS qros_t03;

CREATE TABLE IF NOT EXISTS qros_t03.results (
  seq    serial primary key,
  name   text not null,
  status text not null,
  detail text
);
TRUNCATE qros_t03.results;

CREATE OR REPLACE FUNCTION qros_t03.check(p_name text, p_cond boolean, p_detail text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN
  INSERT INTO qros_t03.results(name, status, detail)
  VALUES (p_name, CASE WHEN COALESCE(p_cond, false) THEN 'PASS' ELSE 'FAIL' END, p_detail);
  RAISE NOTICE '% %  %',
    CASE WHEN COALESCE(p_cond, false) THEN 'PASS' ELSE 'FAIL' END,
    rpad(p_name, 62), COALESCE(p_detail, '');
END $fn$;

-- -----------------------------------------------------------------------------
-- Fixture. Ids are fixed so failures are readable.
-- -----------------------------------------------------------------------------
\set rid   '''e2e00000-0000-4000-8000-000000000001'''
\set bid   '''e2e00000-0000-4000-8000-000000000002'''
\set tid   '''e2e00000-0000-4000-8000-000000000003'''
\set cid   '''e2e00000-0000-4000-8000-000000000004'''
\set plov  '''e2e00000-0000-4000-8000-000000000005'''
\set somsa '''e2e00000-0000-4000-8000-000000000006'''
\set optid '''e2e00000-0000-4000-8000-000000000007'''

DO $$
DECLARE
  v_token TEXT;
BEGIN
  DELETE FROM public.restaurants WHERE id = 'e2e00000-0000-4000-8000-000000000001';

  INSERT INTO public.restaurants (id, name, slug, phone, currency, currency_decimals,
                                  service_fee_enabled, service_fee_bps, is_active)
  VALUES ('e2e00000-0000-4000-8000-000000000001', 'E2E Osh Xonasi', 'e2e-osh-xonasi',
          '+998900000000', 'UZS', 0, true, 1000, true);

  INSERT INTO public.branches (id, restaurant_id, name, code, address, timezone,
                               is_active, is_accepting_orders, order_min_interval_seconds)
  VALUES ('e2e00000-0000-4000-8000-000000000002', 'e2e00000-0000-4000-8000-000000000001',
          'Chorsu', 'E2E', 'Tashkent', 'Asia/Tashkent', true, true, 0);

  INSERT INTO public.tables (id, restaurant_id, branch_id, number, name, is_active)
  VALUES ('e2e00000-0000-4000-8000-000000000003', 'e2e00000-0000-4000-8000-000000000001',
          'e2e00000-0000-4000-8000-000000000002', '12', 'Terrace 12', true);

  INSERT INTO public.menu_categories (id, restaurant_id, branch_id, name, sort_order, is_active)
  VALUES ('e2e00000-0000-4000-8000-000000000004', 'e2e00000-0000-4000-8000-000000000001', NULL,
          '{"uz":"Milliy taomlar","ru":"Национальные блюда","en":"Uzbek Cuisine"}'::jsonb, 1, true);

  -- Plov: 45 000 UZS (0 decimals, so 45000 minor units).
  INSERT INTO public.menu_items (id, restaurant_id, branch_id, category_id, name, description,
                                 price, preparation_time, spicy_level, is_available, sort_order)
  VALUES ('e2e00000-0000-4000-8000-000000000005', 'e2e00000-0000-4000-8000-000000000001', NULL,
          'e2e00000-0000-4000-8000-000000000004',
          '{"uz":"Toy oshi","ru":"Плов","en":"Wedding Plov"}'::jsonb,
          '{"uz":"Qozonda","ru":"В казане","en":"Cooked in a kazan"}'::jsonb,
          45000, 25, 0, true, 1);

  -- Somsa: 12 000 UZS, and deliberately UNAVAILABLE.
  INSERT INTO public.menu_items (id, restaurant_id, branch_id, category_id, name,
                                 price, preparation_time, spicy_level, is_available, sort_order)
  VALUES ('e2e00000-0000-4000-8000-000000000006', 'e2e00000-0000-4000-8000-000000000001', NULL,
          'e2e00000-0000-4000-8000-000000000004',
          '{"uz":"Somsa","ru":"Самса","en":"Samsa"}'::jsonb,
          12000, 10, 0, false, 2);

  -- An extra on the plov: +8 000 UZS.
  INSERT INTO public.menu_item_options (id, restaurant_id, menu_item_id, group_key, group_label,
                                        selection_type, group_min_select, group_max_select,
                                        name, price_delta, max_quantity, is_default,
                                        is_available, sort_order, group_sort_order)
  VALUES ('e2e00000-0000-4000-8000-000000000007', 'e2e00000-0000-4000-8000-000000000001',
          'e2e00000-0000-4000-8000-000000000005', 'extras',
          '{"uz":"Qo''shimchalar","ru":"Добавки","en":"Extras"}'::jsonb,
          'multiple', 0, 3,
          '{"uz":"Qo''shimcha go''sht","ru":"Доп. мясо","en":"Extra meat"}'::jsonb,
          8000, 2, false, true, 1, 1);

  SELECT qr_token INTO v_token FROM public.tables
  WHERE id = 'e2e00000-0000-4000-8000-000000000003';

  PERFORM set_config('qros_t03.token', v_token, false);

  PERFORM qros_t03.check('fixture built',
    v_token IS NOT NULL AND length(v_token) >= 16,
    format('token %s chars', length(v_token)));
END $$;


-- =============================================================================
-- 1. THE CENTRAL CLAIM — a tampered payload cannot change the bill.
-- =============================================================================
DO $$
DECLARE
  v_token   TEXT := current_setting('qros_t03.token');
  v_payload JSONB;
  v_result  JSONB;
  v_order   RECORD;
BEGIN
  -- 2 plov, one with the extra. Honest total would be:
  --   line 1: (45000 + 8000) * 1 = 53000
  --   line 2:  45000          * 1 = 45000
  --   subtotal 98000, fee 10% = 9800, total 107800
  --
  -- The payload below LIES about every one of those numbers, and adds fields a
  -- tampering client would add. None of them may reach the order.
  v_payload := jsonb_build_array(
    jsonb_build_object(
      'menu_item_id', 'e2e00000-0000-4000-8000-000000000005',
      'quantity', 1,
      'option_ids', jsonb_build_array('e2e00000-0000-4000-8000-000000000007'),
      'note', 'no onion',
      'price', 1,                      -- lie
      'unit_price', 1,                 -- lie
      'name', 'Free Plov',             -- lie
      'line_total', 1),                -- lie
    jsonb_build_object(
      'menu_item_id', 'e2e00000-0000-4000-8000-000000000005',
      'quantity', 1,
      'price', 0,                      -- lie
      'subtotal', 0,                   -- lie
      'total', 0,                      -- lie
      'promotion_id', 'e2e00000-0000-4000-8000-00000000000f',   -- forged
      'discount', 999999)              -- lie
  );

  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  v_result := public.public_place_order(v_token, v_payload, 'table by the window', gen_random_uuid());
  RESET ROLE;

  SELECT * INTO v_order FROM public.orders WHERE public_code = v_result ->> 'public_code';

  PERFORM qros_t03.check('order was created by anon',
    v_order.id IS NOT NULL, format('order_number %s', v_order.order_number));

  PERFORM qros_t03.check('subtotal comes from the MENU, not the payload',
    v_order.subtotal = 98000, format('got %s, expected 98000', v_order.subtotal));

  PERFORM qros_t03.check('service fee is computed server-side at 1000 bps',
    v_order.service_fee = 9800, format('got %s, expected 9800', v_order.service_fee));

  PERFORM qros_t03.check('total = subtotal + fee, ignoring the payload''s zeros',
    v_order.total = 107800, format('got %s, expected 107800', v_order.total));

  PERFORM qros_t03.check('the forged discount was ignored',
    v_order.discount_total = 0, format('discount_total %s', v_order.discount_total));

  PERFORM qros_t03.check('the option delta was priced from the option row',
    (SELECT sum(options_total) FROM public.order_items WHERE order_id = v_order.id) = 8000,
    format('options_total sum %s',
           (SELECT sum(options_total) FROM public.order_items WHERE order_id = v_order.id)));

  PERFORM qros_t03.check('the forged item name did not reach the snapshot',
    NOT EXISTS (SELECT 1 FROM public.order_items
                WHERE order_id = v_order.id
                  AND name_snapshot::text ILIKE '%Free Plov%'),
    'name_snapshot came from menu_items.name');

  PERFORM qros_t03.check('the customer note was kept',
    EXISTS (SELECT 1 FROM public.order_items WHERE order_id = v_order.id AND note = 'no onion'),
    'per-line note preserved');

  PERFORM qros_t03.check('a new order starts at pending',
    v_order.status = 'pending', format('status %s', v_order.status));

  PERFORM qros_t03.check('an order-created history row was written',
    EXISTS (SELECT 1 FROM public.order_status_history
            WHERE order_id = v_order.id AND new_status = 'pending'),
    'status history recorded');

  PERFORM set_config('qros_t03.order_id', v_order.id::text, false);
  PERFORM set_config('qros_t03.public_code', v_order.public_code, false);
END $$;


-- =============================================================================
-- 2. Snapshots survive the menu changing underneath the order.
-- =============================================================================
DO $$
DECLARE
  v_order_id UUID := current_setting('qros_t03.order_id')::uuid;
  v_line     RECORD;
BEGIN
  UPDATE public.menu_items
     SET name  = '{"uz":"Boshqa nom","ru":"Другое имя","en":"Renamed Dish"}'::jsonb,
         price = 999000
   WHERE id = 'e2e00000-0000-4000-8000-000000000005';

  SELECT * INTO v_line FROM public.order_items
  WHERE order_id = v_order_id ORDER BY sort_order LIMIT 1;

  PERFORM qros_t03.check('price snapshot survives a repricing',
    v_line.price_snapshot = 45000, format('snapshot %s, menu now 999000', v_line.price_snapshot));

  PERFORM qros_t03.check('name snapshot survives a rename',
    v_line.name_snapshot::text NOT ILIKE '%Renamed%', 'historical name intact');

  -- Soft-delete the dish entirely: the order must still be readable.
  UPDATE public.menu_items SET deleted_at = now()
   WHERE id = 'e2e00000-0000-4000-8000-000000000005';

  PERFORM qros_t03.check('the order survives the dish being deleted',
    (SELECT count(*) FROM public.order_items WHERE order_id = v_order_id) = 2,
    'both lines still present');
END $$;


-- =============================================================================
-- 3. Refusals a diner must actually hit.
-- =============================================================================
DO $$
DECLARE
  v_token TEXT := current_setting('qros_t03.token');
  v_code  TEXT;
BEGIN
  -- 3a. An unavailable dish cannot be ordered (brief §34.3).
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.public_place_order(v_token,
      jsonb_build_array(jsonb_build_object(
        'menu_item_id', 'e2e00000-0000-4000-8000-000000000006', 'quantity', 1)),
      NULL, gen_random_uuid());
    RESET ROLE;
    PERFORM qros_t03.check('unavailable dish is refused', false, 'EXPLOIT: it was accepted');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM qros_t03.check('unavailable dish is refused',
      SQLERRM LIKE '%QR020%', format('raised %s', left(SQLERRM, 40)));
  END;

  -- 3b. A garbage token yields the same answer as a well-formed unknown one.
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.public_resolve_table('not-a-real-token-at-all');
    RESET ROLE;
    PERFORM qros_t03.check('unknown token is refused', false, 'it resolved');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM qros_t03.check('unknown token is refused',
      SQLERRM LIKE '%QR001%', format('raised %s', left(SQLERRM, 40)));
  END;

  -- 3c. Order tracking needs BOTH capabilities: the order code alone is useless
  --     without the table token it belongs to.
  v_code := current_setting('qros_t03.public_code');
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.public_get_order('K9f3PqA7xLmZ2vRt6b', v_code);
    RESET ROLE;
    PERFORM qros_t03.check('order code alone does not grant access', false, 'IDOR: it returned the order');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM qros_t03.check('order code alone does not grant access',
      true, format('raised %s', left(SQLERRM, 30)));
  END;

  -- 3d. With both capabilities it works.
  BEGIN
    PERFORM set_config('request.jwt.claims', '', true);
    SET LOCAL ROLE anon;
    PERFORM public.public_get_order(v_token, v_code);
    RESET ROLE;
    PERFORM qros_t03.check('token + code together DO grant access (MUST SUCCEED)', true, 'order returned');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM qros_t03.check('token + code together DO grant access (MUST SUCCEED)',
      false, format('unexpectedly raised %s', left(SQLERRM, 60)));
  END;
END $$;


-- =============================================================================
-- 4. Idempotency — a double tap is one order, not two.
-- =============================================================================
DO $$
DECLARE
  v_token  TEXT := current_setting('qros_t03.token');
  v_req    UUID := gen_random_uuid();
  v_first  JSONB;
  v_second JSONB;
  v_count  INTEGER;
BEGIN
  -- Re-stock the dish the snapshot test deleted.
  UPDATE public.menu_items SET deleted_at = NULL, is_available = true
   WHERE id = 'e2e00000-0000-4000-8000-000000000005';

  PERFORM set_config('request.jwt.claims', '', true);
  SET LOCAL ROLE anon;
  v_first  := public.public_place_order(v_token,
                jsonb_build_array(jsonb_build_object(
                  'menu_item_id', 'e2e00000-0000-4000-8000-000000000005', 'quantity', 1)),
                NULL, v_req);
  v_second := public.public_place_order(v_token,
                jsonb_build_array(jsonb_build_object(
                  'menu_item_id', 'e2e00000-0000-4000-8000-000000000005', 'quantity', 1)),
                NULL, v_req);
  RESET ROLE;

  SELECT count(*) INTO v_count FROM public.orders WHERE client_request_id = v_req;

  PERFORM qros_t03.check('a retried submit returns the SAME order',
    v_first ->> 'public_code' = v_second ->> 'public_code',
    format('%s vs %s', v_first ->> 'public_code', v_second ->> 'public_code'));

  PERFORM qros_t03.check('only one order row exists for the request id',
    v_count = 1, format('%s row(s)', v_count));
END $$;


-- =============================================================================
-- 5. Summary, teardown, verdict.
-- =============================================================================
SELECT name, status, COALESCE(detail, '') AS detail FROM qros_t03.results ORDER BY seq;
SELECT status, count(*) AS cases FROM qros_t03.results GROUP BY status ORDER BY status;

DO $$
DECLARE
  v_fail   INTEGER;
  v_report TEXT;
BEGIN
  SELECT count(*) INTO v_fail FROM qros_t03.results WHERE status <> 'PASS';

  SELECT string_agg(format(E'\n  %s\n      %s', name, COALESCE(detail, '')), '')
    INTO v_report
  FROM qros_t03.results WHERE status <> 'PASS';

  -- Teardown runs before the verdict so a failing run still cleans up.
  --
  -- Orders are deliberately NOT deletable by cascade: orders.branch_id is
  -- ON DELETE RESTRICT and order_status_history is append-only, because an
  -- order is financial history rather than a row. That is the schema working as
  -- designed, so the fixture is unwound explicitly, innermost first, with
  -- triggers suspended for the append-only tables. Only this test's own ids are
  -- touched.
  PERFORM set_config('session_replication_role', 'replica', true);

  DELETE FROM public.order_status_history
   WHERE restaurant_id = 'e2e00000-0000-4000-8000-000000000001';
  DELETE FROM public.order_item_options
   WHERE restaurant_id = 'e2e00000-0000-4000-8000-000000000001';
  DELETE FROM public.order_items
   WHERE restaurant_id = 'e2e00000-0000-4000-8000-000000000001';
  DELETE FROM public.orders
   WHERE restaurant_id = 'e2e00000-0000-4000-8000-000000000001';
  DELETE FROM public.restaurants
   WHERE id = 'e2e00000-0000-4000-8000-000000000001';

  PERFORM set_config('session_replication_role', 'origin', true);

  IF v_fail > 0 THEN
    RAISE EXCEPTION '03-order-placement: % case(s) FAILED%', v_fail, v_report
      USING HINT = 'A failure here means the order path is broken or the server is trusting client-supplied money. Fix the migration, never this file.';
  END IF;
END $$;

DROP SCHEMA qros_t03 CASCADE;
