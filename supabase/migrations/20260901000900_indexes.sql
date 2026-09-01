-- =============================================================================
-- RESTAURANT QR OS — migration 9 of 10
-- File: 20260901000900_indexes.sql
--
-- Implements docs/architecture/01-database-schema.md §8.3 "Explicit indexes".
--
-- Creates every explicitly-declared index of the schema, by the exact name the
-- spec gives, in the spec's order, each with its rationale.
--
-- Deliberately NOT created here:
--   §8.1 — indexes PostgreSQL builds implicitly for PRIMARY KEY / UNIQUE
--          constraints (restaurants_pkey, uq_branches_tenant, uq_tables_qr_token,
--          uq_orders_public_code, pk_branch_order_counters, ...). They already
--          exist under the constraint name; recreating them would duplicate.
--   §8.2 — the five partial UNIQUE indexes declared with their tables
--          (uq_staff_operational_single_branch, uq_staff_employee_code,
--           uq_tables_branch_number, uq_menu_item_options_single_default,
--           uq_waiter_calls_open_per_table). Those live in migrations 2, 3, 4
--          and 7 alongside the tables they constrain.
--
-- Every index below is either (a) an FK-covering index, so ON DELETE CASCADE /
-- SET NULL never degenerates into a sequential scan of the child table, or
-- (b) the access path of a named panel query, or both. See the FK coverage
-- audit at the end of §8.3.
--
-- No functions, no money columns, no DDL on other agents' objects.
--
-- Depends on: 20260901000100 (enums public.order_status, public.waiter_call_status,
--                             public.option_selection_type, public.dietary_tag),
--             20260901000200 (restaurants, branches, profiles, staff),
--             20260901000300 (tables, qr_token_history),
--             20260901000400 (menu_categories, menu_items, menu_item_options),
--             20260901000500 (promotions, promotion_items),
--             20260901000600 (orders, order_items, order_item_options,
--                             order_status_history),
--             20260901000700 (waiter_calls, notifications, notification_reads).
--
-- CONCURRENTLY is not used: a Supabase migration runs inside one transaction,
-- and these tables are empty at migration time.
-- =============================================================================

-- ===========================================================================
-- restaurants / branches / profiles / staff
-- ===========================================================================

-- Platform-admin tenant list, newest first, excluding offboarded tenants.
CREATE INDEX IF NOT EXISTS idx_restaurants_active
  ON public.restaurants (created_at DESC)
  WHERE is_active AND deleted_at IS NULL;

-- Branch switcher in the admin shell and the branch picker in staff invites.
CREATE INDEX IF NOT EXISTS idx_branches_restaurant_active
  ON public.branches (restaurant_id, name)
  WHERE is_active AND deleted_at IS NULL;

-- Tiny partial index behind the "or the caller is a platform admin" branch of
-- every RLS policy: an index probe over a handful of rows, not a full scan.
CREATE INDEX IF NOT EXISTS idx_profiles_platform_admin
  ON public.profiles (id)
  WHERE is_platform_admin;

-- THE authorization index: "which memberships does auth.uid() have?", evaluated
-- on every RLS-checked row. Covering, so the check is index-only.
CREATE INDEX IF NOT EXISTS idx_staff_profile_active
  ON public.staff (profile_id, restaurant_id, branch_id, role)
  WHERE is_active;

-- FK index for fk_staff_branch; also the admin Staff page grouped by branch.
CREATE INDEX IF NOT EXISTS idx_staff_restaurant_branch
  ON public.staff (restaurant_id, branch_id);

-- "Who is on shift as KITCHEN at branch X" — notification targeting and the
-- staff presence strip on the waiter console.
CREATE INDEX IF NOT EXISTS idx_staff_branch_role
  ON public.staff (branch_id, role)
  WHERE is_active AND branch_id IS NOT NULL;

-- ===========================================================================
-- tables / qr_token_history
-- ===========================================================================

-- FK index for fk_tables_branch.
CREATE INDEX IF NOT EXISTS idx_tables_restaurant_branch
  ON public.tables (restaurant_id, branch_id);

-- Admin table grid and waiter floor map, in display order, in one scan.
CREATE INDEX IF NOT EXISTS idx_tables_branch_sorted
  ON public.tables (branch_id, sort_order, number)
  WHERE deleted_at IS NULL;

-- FK index for fk_qr_token_history_branch.
CREATE INDEX IF NOT EXISTS idx_qr_token_history_restaurant_branch
  ON public.qr_token_history (restaurant_id, branch_id);

-- FK index for fk_qr_token_history_table, and the per-table rotation history in
-- the admin audit drawer.
CREATE INDEX IF NOT EXISTS idx_qr_token_history_table_revoked
  ON public.qr_token_history (branch_id, table_id, revoked_at DESC);

-- FK index for fk_qr_token_history_revoked_by; keeps profile deletion from
-- degrading into a sequential scan of the history table.
CREATE INDEX IF NOT EXISTS idx_qr_token_history_revoked_by
  ON public.qr_token_history (revoked_by)
  WHERE revoked_by IS NOT NULL;

-- ===========================================================================
-- menu
-- ===========================================================================

-- FK index for fk_menu_categories_branch.
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant_branch
  ON public.menu_categories (restaurant_id, branch_id);

-- The customer menu's category rail, already ordered. NULL branch_id (shared
-- categories) is indexable and sorts together with branch-specific rows.
CREATE INDEX IF NOT EXISTS idx_menu_categories_active_sorted
  ON public.menu_categories (restaurant_id, branch_id, sort_order)
  WHERE is_active AND deleted_at IS NULL;

-- FK index for fk_menu_items_branch.
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_branch
  ON public.menu_items (restaurant_id, branch_id);

-- FK index for fk_menu_items_category.
CREATE INDEX IF NOT EXISTS idx_menu_items_restaurant_category
  ON public.menu_items (restaurant_id, category_id);

-- The main customer menu query: all live items of a category, in display order.
CREATE INDEX IF NOT EXISTS idx_menu_items_category_sorted
  ON public.menu_items (category_id, sort_order, id)
  WHERE deleted_at IS NULL;

-- The "featured food" hero rail on the customer home (brief §4).
CREATE INDEX IF NOT EXISTS idx_menu_items_featured
  ON public.menu_items (restaurant_id, branch_id, sort_order)
  WHERE is_featured AND deleted_at IS NULL;

-- The "popular dishes" rail by analytics-maintained score. Deliberately NOT
-- partial on is_popular: the rail falls back to top-scoring items when nothing
-- is manually pinned.
CREATE INDEX IF NOT EXISTS idx_menu_items_popular
  ON public.menu_items (restaurant_id, branch_id, popularity_score DESC)
  WHERE deleted_at IS NULL;

-- The customer search field. Prefix queries:
--   WHERE search_vector @@ to_tsquery('simple', quote_literal(term) || ':*')
CREATE INDEX IF NOT EXISTS idx_menu_items_search_vector
  ON public.menu_items USING GIN (search_vector);

-- Dietary filter chips: dietary_tags @> ARRAY['vegetarian']::dietary_tag[].
-- GIN over an enum array uses the default array_ops opclass.
CREATE INDEX IF NOT EXISTS idx_menu_items_dietary_tags
  ON public.menu_items USING GIN (dietary_tags);

-- The housekeeping job that flips temporarily-86-ed dishes back to available
-- scans exactly this partial index, never the whole menu.
CREATE INDEX IF NOT EXISTS idx_menu_items_unavailable_until
  ON public.menu_items (unavailable_until)
  WHERE unavailable_until IS NOT NULL;

-- FK index for fk_menu_item_options_item.
CREATE INDEX IF NOT EXISTS idx_menu_item_options_restaurant_item
  ON public.menu_item_options (restaurant_id, menu_item_id);

-- Product-detail sheet: every option of a dish, already grouped and ordered.
CREATE INDEX IF NOT EXISTS idx_menu_item_options_item_grouped
  ON public.menu_item_options (menu_item_id, group_sort_order, sort_order)
  WHERE deleted_at IS NULL;

-- ===========================================================================
-- promotions
-- ===========================================================================

-- FK index for fk_promotions_branch.
CREATE INDEX IF NOT EXISTS idx_promotions_restaurant_branch
  ON public.promotions (restaurant_id, branch_id);

-- "Active promotions" on the customer home. now() is not IMMUTABLE, so the time
-- window cannot be an index predicate: starts_at/ends_at are index columns and
-- the query filters on them.
CREATE INDEX IF NOT EXISTS idx_promotions_active_window
  ON public.promotions (restaurant_id, branch_id, starts_at DESC, ends_at)
  WHERE is_active AND deleted_at IS NULL;

-- FK index for fk_promotion_items_promotion.
CREATE INDEX IF NOT EXISTS idx_promotion_items_restaurant_promotion
  ON public.promotion_items (restaurant_id, promotion_id);

-- FK index for fk_promotion_items_menu_item; also "is this dish on promotion?"
-- when rendering a menu card badge.
CREATE INDEX IF NOT EXISTS idx_promotion_items_restaurant_menu_item
  ON public.promotion_items (restaurant_id, menu_item_id);

-- ===========================================================================
-- orders
-- ===========================================================================

-- FK index for fk_orders_branch.
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_branch
  ON public.orders (restaurant_id, branch_id);

-- FK index for fk_orders_table.
CREATE INDEX IF NOT EXISTS idx_orders_branch_table
  ON public.orders (branch_id, table_id);

-- THE kitchen and waiter query. The three KDS columns (NEW / PREPARING / READY)
-- and the waiter's Active + Ready lists are slices of this one partial index,
-- which stays small because completed and cancelled orders drop out of it.
CREATE INDEX IF NOT EXISTS idx_orders_kds_live
  ON public.orders (branch_id, status, placed_at)
  WHERE status IN ('pending', 'confirmed', 'preparing', 'ready');

-- Late-order detection (brief §9): the flagging sweep touches only in-flight
-- orders of one branch.
CREATE INDEX IF NOT EXISTS idx_orders_due_at
  ON public.orders (branch_id, due_at)
  WHERE status IN ('confirmed', 'preparing');

-- Every "today" figure on the admin dashboard (revenue, order count, average
-- order value, status overview), grouped by the same business_date the order
-- numbering uses, so dashboard and tickets can never disagree about the day.
CREATE INDEX IF NOT EXISTS idx_orders_branch_business_date
  ON public.orders (branch_id, business_date, status);

-- The admin Orders list across all branches, newest first.
CREATE INDEX IF NOT EXISTS idx_orders_restaurant_placed_at
  ON public.orders (restaurant_id, placed_at DESC);

-- Two consumers: the guest's own order history on the tracking screen, and the
-- rate-limit lookup in assert_order_rate_limit().
CREATE INDEX IF NOT EXISTS idx_orders_customer_session
  ON public.orders (customer_session_id, placed_at DESC)
  WHERE customer_session_id IS NOT NULL;

-- "Active tables" on the dashboard and the occupied/free state of the waiter
-- floor map: a table is busy iff it has a row in this partial index.
CREATE INDEX IF NOT EXISTS idx_orders_table_open
  ON public.orders (table_id, status)
  WHERE status IN ('pending', 'confirmed', 'preparing', 'ready', 'delivered');

-- FK indexes for the three staff attribution FKs. Partial, because most orders
-- name at most one or two of them, and because a staff-row delete must not
-- degenerate into three sequential scans of the orders table.
CREATE INDEX IF NOT EXISTS idx_orders_confirmed_by_staff
  ON public.orders (restaurant_id, confirmed_by_staff_id)
  WHERE confirmed_by_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_served_by_staff
  ON public.orders (restaurant_id, served_by_staff_id)
  WHERE served_by_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_cancelled_by_staff
  ON public.orders (restaurant_id, cancelled_by_staff_id)
  WHERE cancelled_by_staff_id IS NOT NULL;

-- ===========================================================================
-- order children
-- ===========================================================================

-- FK index for fk_order_items_order.
CREATE INDEX IF NOT EXISTS idx_order_items_restaurant_order
  ON public.order_items (restaurant_id, order_id);

-- Dual purpose: FK index for fk_order_items_menu_item, and the "most popular
-- dishes" aggregation (brief §11), counting lines per dish over a date range.
CREATE INDEX IF NOT EXISTS idx_order_items_restaurant_menu_item
  ON public.order_items (restaurant_id, menu_item_id, created_at DESC)
  WHERE menu_item_id IS NOT NULL;

-- Ticket and receipt rendering, in the order the guest built the cart.
CREATE INDEX IF NOT EXISTS idx_order_items_order_sorted
  ON public.order_items (order_id, sort_order, id);

-- FK index for fk_order_item_options_order; also fetches every option of an
-- order in one scan when printing a ticket.
CREATE INDEX IF NOT EXISTS idx_order_item_options_restaurant_order
  ON public.order_item_options (restaurant_id, order_id);

-- FK index for fk_order_item_options_order_item, and the per-line option list.
CREATE INDEX IF NOT EXISTS idx_order_item_options_order_line
  ON public.order_item_options (order_id, order_item_id, sort_order);

-- FK index for fk_order_item_options_menu_item_option; also "how often is this
-- extra chosen" for menu analytics.
CREATE INDEX IF NOT EXISTS idx_order_item_options_restaurant_option
  ON public.order_item_options (restaurant_id, menu_item_option_id)
  WHERE menu_item_option_id IS NOT NULL;

-- The customer's visual order tracker (brief §8) and the admin order timeline.
CREATE INDEX IF NOT EXISTS idx_order_status_history_order_created
  ON public.order_status_history (order_id, created_at DESC);

-- FK index for fk_order_status_history_order.
CREATE INDEX IF NOT EXISTS idx_order_status_history_restaurant_order
  ON public.order_status_history (restaurant_id, order_id);

-- FK index for fk_order_status_history_branch; also the branch activity feed and
-- the kitchen throughput report (transitions per hour).
CREATE INDEX IF NOT EXISTS idx_order_status_history_restaurant_branch
  ON public.order_status_history (restaurant_id, branch_id, created_at DESC);

-- FK index for fk_order_status_history_changed_by; also per-employee activity.
CREATE INDEX IF NOT EXISTS idx_order_status_history_changed_by
  ON public.order_status_history (changed_by)
  WHERE changed_by IS NOT NULL;

-- ===========================================================================
-- waiter_calls
-- ===========================================================================

-- FK index for fk_waiter_calls_branch.
CREATE INDEX IF NOT EXISTS idx_waiter_calls_restaurant_branch
  ON public.waiter_calls (restaurant_id, branch_id);

-- The waiter console's Table Calls panel: oldest open call first. Stays tiny —
-- resolved calls leave the index.
CREATE INDEX IF NOT EXISTS idx_waiter_calls_branch_open
  ON public.waiter_calls (branch_id, created_at)
  WHERE status IN ('pending', 'acknowledged');

-- FK index for fk_waiter_calls_table, and the cooldown lookup in
-- assert_waiter_call_cooldown() (max(created_at) per table).
CREATE INDEX IF NOT EXISTS idx_waiter_calls_branch_table_created
  ON public.waiter_calls (branch_id, table_id, created_at DESC);

-- FK index for fk_waiter_calls_order.
CREATE INDEX IF NOT EXISTS idx_waiter_calls_restaurant_order
  ON public.waiter_calls (restaurant_id, order_id)
  WHERE order_id IS NOT NULL;

-- FK indexes for the two staff attribution FKs; also per-waiter response-time
-- analytics.
CREATE INDEX IF NOT EXISTS idx_waiter_calls_acknowledged_by
  ON public.waiter_calls (restaurant_id, acknowledged_by_staff_id)
  WHERE acknowledged_by_staff_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_waiter_calls_resolved_by
  ON public.waiter_calls (restaurant_id, resolved_by_staff_id)
  WHERE resolved_by_staff_id IS NOT NULL;

-- ===========================================================================
-- notifications
-- ===========================================================================

-- FK index for fk_notifications_branch; also the admin-wide feed.
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_branch
  ON public.notifications (restaurant_id, branch_id, created_at DESC);

-- The KDS and waiter console feeds (role broadcast within a branch).
CREATE INDEX IF NOT EXISTS idx_notifications_branch_role_created
  ON public.notifications (branch_id, target_role, created_at DESC)
  WHERE target_role IS NOT NULL;

-- Directly addressed notifications for one staff member.
CREATE INDEX IF NOT EXISTS idx_notifications_branch_staff_created
  ON public.notifications (branch_id, target_staff_id, created_at DESC)
  WHERE target_staff_id IS NOT NULL;

-- FK index for fk_notifications_target_staff: the branch-leading index above
-- does not serve a restaurant_id-leading FK check.
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_target_staff
  ON public.notifications (restaurant_id, target_staff_id)
  WHERE target_staff_id IS NOT NULL;

-- FK indexes for the two deep-link FKs. Both cascade on delete, so without these
-- deleting an order would sequentially scan notifications.
CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_order
  ON public.notifications (restaurant_id, order_id)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_restaurant_waiter_call
  ON public.notifications (restaurant_id, waiter_call_id)
  WHERE waiter_call_id IS NOT NULL;

-- The retention job deletes expired notifications by scanning only this index.
CREATE INDEX IF NOT EXISTS idx_notifications_expires_at
  ON public.notifications (expires_at)
  WHERE expires_at IS NOT NULL;

-- The LEFT JOIN in the notification panel query (§6.19): "has THIS staff member
-- read it".
CREATE INDEX IF NOT EXISTS idx_notification_reads_staff
  ON public.notification_reads (staff_id, notification_id);

-- FK indexes for fk_notification_reads_notification and fk_notification_reads_staff.
-- pk_notification_reads leads with notification_id, not restaurant_id, so neither
-- FK check can use it.
CREATE INDEX IF NOT EXISTS idx_notification_reads_restaurant_notification
  ON public.notification_reads (restaurant_id, notification_id);

CREATE INDEX IF NOT EXISTS idx_notification_reads_restaurant_staff
  ON public.notification_reads (restaurant_id, staff_id);
