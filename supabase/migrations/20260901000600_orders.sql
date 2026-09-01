-- =============================================================================
-- RESTAURANT QR OS — migration 6 of 10
-- File: 20260901000600_orders.sql
--
-- Implements docs/architecture/01-database-schema.md:
--   §6.12 public.branch_order_counters — race-safe per-branch daily order number
--   §6.13 public.orders                — the pivot table of the whole system
--   §6.14 public.order_items           — order lines with mandatory snapshots
--   §6.15 public.order_item_options    — chosen extras, with their own snapshots
--   §6.16 public.order_status_history  — the append-only status audit trail
--
-- Also creates §5.3 public.generate_public_code() and §5.4
-- public.is_valid_order_transition(), because §6.13 uses the former in a column
-- DEFAULT and §6.16 uses the latter in a CHECK constraint; both are resolved at
-- CREATE TABLE time. §5 explicitly permits creating the utility functions ahead
-- of the table migrations for exactly this reason. Migration 8 re-creates them
-- with CREATE OR REPLACE and identical bodies, so running both in order is a
-- no-op the second time.
--
-- Depends on: 20260901000100 (extensions `pgcrypto` in schema `extensions`;
--                             domains money_minor, bps, i18n_text; enums
--                             order_status, order_type, order_channel,
--                             app_locale, app_role, actor_kind, dietary_tag),
--             20260901000200 (branches.uq_branches_tenant (restaurant_id, id),
--                             staff.uq_staff_tenant (restaurant_id, id),
--                             profiles.id),
--             20260901000300 (tables.uq_tables_branch_identity (branch_id, id)),
--             20260901000400 (menu_items.uq_menu_items_tenant,
--                             menu_item_options.uq_menu_item_options_tenant).
--
-- NOT created here: §7 trigger functions and triggers (trg_*_set_updated_at,
-- trg_orders_assign_number, trg_orders_status_guard, trg_orders_log_status_change,
-- trg_orders_totals_consistent, trg_order_items_options_total_consistent,
-- trg_order_status_history_immutable) and every §8 index. Until migration 8 runs
-- order numbers are NOT auto-assigned, status transitions are NOT guarded, the
-- deferred totals identity is NOT asserted and the history table is NOT immutable.
--
-- Run once, in filename order. Not wrapped in an explicit transaction: Supabase
-- already runs each migration file in one.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §5.3 generate_public_code() — needed by the orders.public_code DEFAULT below
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_public_code()
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', '-_');
$$;

COMMENT ON FUNCTION public.generate_public_code() IS
  'Unguessable 12-character (72-bit) code used in the customer order-tracking URL /o/<public_code>. Brief §3 forbids exposing internal DB ids in public URLs; this keeps orders.id off the wire exactly as tables.qr_token keeps tables.id off the wire.';


-- -----------------------------------------------------------------------------
-- §5.4 is_valid_order_transition() — the state machine, as data.
-- Needed by ck_order_status_history_transition_legal in §6.16 below.
-- IMMUTABLE (a CHECK constraint may only call an immutable function) and
-- deliberately without a SET search_path clause, exactly as §5.4 declares it:
-- the body resolves nothing by name — only enum literals coerced to the
-- declared parameter type — so there is no search_path to hijack, and leaving
-- the clause off keeps the SQL function inlinable inside the constraint.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_valid_order_transition(
  p_from public.order_status,
  p_to   public.order_status
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT CASE p_from
    WHEN 'pending'   THEN p_to IN ('confirmed', 'cancelled')
    WHEN 'confirmed' THEN p_to IN ('preparing', 'cancelled')
    WHEN 'preparing' THEN p_to IN ('ready',     'cancelled')
    WHEN 'ready'     THEN p_to IN ('delivered', 'cancelled')
    WHEN 'delivered' THEN p_to  = 'completed'
    WHEN 'completed' THEN false
    WHEN 'cancelled' THEN false
  END;
$$;

COMMENT ON FUNCTION public.is_valid_order_transition(public.order_status, public.order_status) IS
  'The single source of truth for brief §26. Forward path: pending->confirmed->preparing->ready->delivered->completed. CANCELLATION RULE (explicit, as the brief demands): an order may be cancelled from pending, confirmed, preparing or ready - i.e. at any point until the food has physically left the pass. Once delivered, the only legal move is completed; delivered->cancelled is a refund, which is an accounting event this MVP does not model. completed and cancelled are absorbing states with no outgoing edges, so completed->preparing and cancelled->ready are rejected. Same-status "transitions" never reach this function (the guard trigger only fires on an actual change).';


-- -----------------------------------------------------------------------------
-- §6.12 branch_order_counters — the race-safe daily order-number sequence
--
-- Deliberate exception to the uuid-id rule: the natural key
-- (branch_id, business_date) IS the lock identity that public.next_order_number()
-- serialises on via INSERT ... ON CONFLICT DO UPDATE ... RETURNING.
-- -----------------------------------------------------------------------------
CREATE TABLE public.branch_order_counters (
  branch_id      UUID        NOT NULL,
  business_date  DATE        NOT NULL,
  last_number    INTEGER     NOT NULL DEFAULT 0,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_branch_order_counters PRIMARY KEY (branch_id, business_date),

  CONSTRAINT fk_branch_order_counters_branch
    FOREIGN KEY (branch_id) REFERENCES public.branches (id) ON DELETE CASCADE,

  CONSTRAINT ck_branch_order_counters_last_number_positive
    CHECK (last_number >= 0)
);

COMMENT ON TABLE  public.branch_order_counters IS
  'One counter row per branch per local business date. DELIBERATE EXCEPTION to the uuid-id rule: this is not a business entity, it is a concurrency primitive, and its natural key (branch_id, business_date) IS the lock identity. Adding a surrogate uuid would let two counter rows exist for the same branch-day, which is precisely the illegal state this table exists to prevent.';
COMMENT ON COLUMN public.branch_order_counters.business_date IS
  'The LOCAL calendar date at the branch, computed as (now() AT TIME ZONE branches.timezone)::date. Local, not UTC: a Tashkent branch open until 02:00 must keep numbering the same evening rather than rolling to #A-001 at 05:00 local when UTC midnight passes.';
COMMENT ON COLUMN public.branch_order_counters.last_number IS
  'Highest sequence number issued for this branch-day. Written only by public.next_order_number(); no application code touches this table directly.';


-- -----------------------------------------------------------------------------
-- §6.13 orders — one guest order
--
-- Tenancy: restaurant_id + branch_id are validated together against
-- branches (restaurant_id, id); table_id is validated against
-- tables (branch_id, id). A row therefore cannot name a branch of another tenant
-- nor a table of another branch (Invariant T1/T2).
--
-- Money: every amount is a public.money_minor (BIGINT, minor currency units).
-- The immediate totals CHECK is total = subtotal - discount_total + service_fee;
-- the remaining links of the identity (subtotal vs order_items, service_fee vs
-- service_fee_bps, options_total vs order_item_options) are asserted at COMMIT
-- by the §7.5/§7.6 deferred constraint triggers, created in migration 8.
--
-- public_code is the account-free tracking identifier used in /o/<public_code>.
-- -----------------------------------------------------------------------------
CREATE TABLE public.orders (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id             UUID        NOT NULL,
  branch_id                 UUID        NOT NULL,
  table_id                  UUID,

  public_code               TEXT        NOT NULL DEFAULT public.generate_public_code(),

  order_number              TEXT        NOT NULL,
  order_seq                 INTEGER     NOT NULL,
  business_date             DATE        NOT NULL,

  order_type                public.order_type    NOT NULL DEFAULT 'dine_in',
  channel                   public.order_channel NOT NULL DEFAULT 'qr',
  status                    public.order_status  NOT NULL DEFAULT 'pending',

  customer_session_id       UUID,
  customer_name             TEXT,
  customer_phone            TEXT,
  customer_note             TEXT,
  guest_count               SMALLINT,
  locale                    public.app_locale NOT NULL DEFAULT 'uz',

  currency                  CHAR(3)     NOT NULL,
  currency_decimals         SMALLINT    NOT NULL,

  subtotal                  public.money_minor NOT NULL DEFAULT 0,
  discount_total            public.money_minor NOT NULL DEFAULT 0,
  service_fee               public.money_minor NOT NULL DEFAULT 0,
  service_fee_bps           public.bps  NOT NULL DEFAULT 0,
  total                     public.money_minor NOT NULL DEFAULT 0,

  estimated_prep_minutes    SMALLINT    NOT NULL DEFAULT 15,
  due_at                    TIMESTAMPTZ,

  placed_at                 TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at              TIMESTAMPTZ,
  preparing_at              TIMESTAMPTZ,
  ready_at                  TIMESTAMPTZ,
  delivered_at              TIMESTAMPTZ,
  completed_at              TIMESTAMPTZ,
  cancelled_at              TIMESTAMPTZ,

  cancellation_reason       TEXT,
  confirmed_by_staff_id     UUID,
  served_by_staff_id        UUID,
  cancelled_by_staff_id     UUID,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_orders_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_orders_table
    FOREIGN KEY (branch_id, table_id)
    REFERENCES public.tables (branch_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT fk_orders_confirmed_by_staff
    FOREIGN KEY (restaurant_id, confirmed_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (confirmed_by_staff_id),

  CONSTRAINT fk_orders_served_by_staff
    FOREIGN KEY (restaurant_id, served_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (served_by_staff_id),

  CONSTRAINT fk_orders_cancelled_by_staff
    FOREIGN KEY (restaurant_id, cancelled_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (cancelled_by_staff_id),

  CONSTRAINT uq_orders_tenant            UNIQUE (restaurant_id, id),
  CONSTRAINT uq_orders_public_code       UNIQUE (public_code),
  CONSTRAINT uq_orders_branch_day_seq    UNIQUE (branch_id, business_date, order_seq),
  CONSTRAINT uq_orders_branch_day_number UNIQUE (branch_id, business_date, order_number),

  CONSTRAINT ck_orders_public_code_format
    CHECK (public_code ~ '^[A-Za-z0-9_-]{10,32}$'),

  CONSTRAINT ck_orders_order_number_format
    CHECK (order_number ~ '^[A-Z][A-Z0-9]{0,3}-[0-9]{3,6}$'),

  CONSTRAINT ck_orders_order_seq_positive
    CHECK (order_seq >= 1),

  CONSTRAINT ck_orders_table_required
    CHECK (order_type <> 'dine_in' OR table_id IS NOT NULL),

  CONSTRAINT ck_orders_totals_arithmetic
    CHECK (total = subtotal - discount_total + service_fee),

  CONSTRAINT ck_orders_discount_within_subtotal
    CHECK (discount_total <= subtotal),

  CONSTRAINT ck_orders_currency_format
    CHECK (currency ~ '^[A-Z]{3}$'),

  CONSTRAINT ck_orders_currency_decimals_range
    CHECK (currency_decimals BETWEEN 0 AND 4),

  CONSTRAINT ck_orders_guest_count_range
    CHECK (guest_count IS NULL OR guest_count BETWEEN 1 AND 100),

  CONSTRAINT ck_orders_estimated_prep_range
    CHECK (estimated_prep_minutes BETWEEN 1 AND 480),

  CONSTRAINT ck_orders_customer_note_len
    CHECK (customer_note IS NULL OR char_length(customer_note) <= 500),

  CONSTRAINT ck_orders_customer_name_len
    CHECK (customer_name IS NULL OR char_length(btrim(customer_name)) BETWEEN 1 AND 80),

  CONSTRAINT ck_orders_customer_phone_format
    CHECK (customer_phone IS NULL OR customer_phone ~ '^\+?[0-9 ()-]{5,24}$'),

  CONSTRAINT ck_orders_cancellation_reason_len
    CHECK (cancellation_reason IS NULL OR char_length(btrim(cancellation_reason)) BETWEEN 1 AND 300),

  CONSTRAINT ck_orders_cancelled_shape
    CHECK (
      (status = 'cancelled')
      = (cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)
    ),

  CONSTRAINT ck_orders_terminal_timestamps
    CHECK (
      (status <> 'completed' OR completed_at IS NOT NULL)
      AND (completed_at IS NULL OR delivered_at IS NOT NULL)
      AND (delivered_at  IS NULL OR ready_at     IS NOT NULL)
      AND (ready_at      IS NULL OR preparing_at IS NOT NULL)
      AND (preparing_at  IS NULL OR confirmed_at IS NOT NULL)
    ),

  CONSTRAINT ck_orders_qr_channel_has_session
    CHECK (channel <> 'qr' OR customer_session_id IS NOT NULL)
);

COMMENT ON TABLE  public.orders IS
  'One guest order. The pivot of the whole system: written by the public customer app, read live by the KDS and the waiter console, aggregated by the admin dashboard.';
COMMENT ON COLUMN public.orders.public_code IS
  'Unguessable 12-character public identifier used in the customer tracking URL /o/<public_code>. Exists so brief §3 ("public URL must not expose internal DB ids") holds for order tracking exactly as qr_token makes it hold for tables. Never shown to staff - they use order_number.';
COMMENT ON COLUMN public.orders.order_number IS
  'Human-friendly number, unique per branch per business_date: branches.code || ''-'' || lpad(order_seq,3,''0'') => "A-014". Displayed as #A-014. Assigned by trg_orders_assign_number; application code MUST NOT set it.';
COMMENT ON COLUMN public.orders.order_seq IS
  'The raw daily counter behind order_number, from public.next_order_number(). Kept as its own column so the KDS can sort numerically without parsing a string.';
COMMENT ON COLUMN public.orders.business_date IS
  'Local calendar date at the branch when the order was placed, in branches.timezone. The partition key of the daily numbering AND the grouping key of every "today" figure on the admin dashboard, so both agree by construction.';
COMMENT ON COLUMN public.orders.customer_session_id IS
  'Anonymous guest identity from an HttpOnly cookie set by the server on first QR scan. Brief §11 forbids customer accounts, yet the tracking page must show "my orders" and the rate limiter must recognise a repeat offender; this UUID does both without an account. Required for channel = qr (ck_orders_qr_channel_has_session), absent for staff-entered orders.';
COMMENT ON COLUMN public.orders.locale IS
  'Locale the guest was using when ordering. Lets a staff-facing reprint or a follow-up message address the guest in the language they chose.';
COMMENT ON COLUMN public.orders.currency IS
  'SNAPSHOT of restaurants.currency at order time. Snapshotted because a tenant may change currency and every historical total must keep rendering in the money it was actually taken in.';
COMMENT ON COLUMN public.orders.currency_decimals IS
  'SNAPSHOT of restaurants.currency_decimals at order time. The divisor (10^currency_decimals) needed to render this order''s minor-unit amounts.';
COMMENT ON COLUMN public.orders.subtotal IS
  'Sum of order_items.total, in MINOR CURRENCY UNITS. Computed exclusively on the server from menu_items.price (brief §7, §34.2); a client-supplied value is never trusted. Equality with the children is enforced at COMMIT by the deferred constraint trigger trg_orders_totals_consistent.';
COMMENT ON COLUMN public.orders.discount_total IS
  'Total discount applied, in MINOR CURRENCY UNITS. ALWAYS 0 in the MVP - promotions are display-only (§6.10). The column exists so the totals identity below is already correct when discounts arrive, instead of requiring a migration that rewrites every historical total. CHECK: 0 <= discount_total <= subtotal.';
COMMENT ON COLUMN public.orders.service_fee IS
  'Service charge in MINOR CURRENCY UNITS (brief §7). Derived, not free: trg_orders_totals_consistent asserts service_fee = round((subtotal - discount_total) * service_fee_bps / 10000).';
COMMENT ON COLUMN public.orders.service_fee_bps IS
  'SNAPSHOT of the effective service-fee rate in basis points (branch override, else restaurant default, else 0 when restaurants.service_fee_enabled is false). Snapshotted so changing the rate tomorrow cannot retroactively invalidate today''s totals.';
COMMENT ON COLUMN public.orders.total IS
  'Amount payable in MINOR CURRENCY UNITS. Bound by ck_orders_totals_arithmetic to total = subtotal - discount_total + service_fee, so a total inconsistent with its parts is not storable.';
COMMENT ON COLUMN public.orders.estimated_prep_minutes IS
  'Expected preparation time for the whole order: max(menu_items.preparation_time) across its lines, falling back to branches.default_prep_minutes. Set once at creation.';
COMMENT ON COLUMN public.orders.due_at IS
  'When the order is expected to be READY. Set to now() + estimated_prep_minutes at the pending->confirmed transition by trg_orders_status_guard. A PLAIN column, not GENERATED: timestamptz + interval is STABLE (not IMMUTABLE) in PostgreSQL and is therefore rejected in a generated-column expression.';
COMMENT ON COLUMN public.orders.placed_at IS
  'When the guest pressed PLACE ORDER. The KDS elapsed-time badge and the late flag (now() - placed_at > branches.late_order_threshold_minutes) both read this, never created_at, so a backfilled row cannot masquerade as a late order.';
COMMENT ON COLUMN public.orders.confirmed_at IS
  'Kitchen accepted the order. Set automatically by trg_orders_status_guard on entering confirmed; never written by application code.';
COMMENT ON COLUMN public.orders.preparing_at IS
  'Cooking started. Set automatically on entering preparing.';
COMMENT ON COLUMN public.orders.ready_at IS
  'Food is on the pass; this is the moment the waiter panel must light up (brief §28). Set automatically on entering ready.';
COMMENT ON COLUMN public.orders.delivered_at IS
  'Waiter put the food on the table. Set automatically on entering delivered.';
COMMENT ON COLUMN public.orders.completed_at IS
  'Order closed. Set automatically on entering completed.';
COMMENT ON COLUMN public.orders.cancelled_at IS
  'Set automatically on entering cancelled. ck_orders_cancelled_shape makes status = cancelled, cancelled_at and cancellation_reason a single atomic fact: an order cannot be cancelled without a reason, and cannot carry a reason without being cancelled.';
COMMENT ON COLUMN public.orders.cancellation_reason IS
  'Mandatory human explanation for a cancellation, surfaced to the guest on the tracking screen so a cancelled order is never an unexplained dead end (brief §32).';
COMMENT ON COLUMN public.orders.confirmed_by_staff_id IS
  'Kitchen staff member who accepted the order (brief §9 "accept order"). Composite FK on restaurant_id, so a foreign tenant''s staff row is unassignable. ON DELETE SET NULL names only this column, which PostgreSQL 15+ permits on a composite FK - without the column list the delete would try to null restaurant_id and violate NOT NULL.';
COMMENT ON COLUMN public.orders.served_by_staff_id IS
  'Waiter who delivered the order. Feeds per-waiter service analytics.';
COMMENT ON COLUMN public.orders.cancelled_by_staff_id IS
  'Staff member who cancelled. NULL when the guest cancelled their own pending order (channel = qr, actor_kind = customer).';


-- -----------------------------------------------------------------------------
-- §6.14 order_items — order lines with mandatory snapshots
--
-- Every customer-visible attribute is snapshotted, so a deleted or repriced
-- menu item cannot alter history: fk_order_items_menu_item is
-- ON DELETE SET NULL (menu_item_id) — the PG 15+ column-list form, required
-- because the FK is composite and nulling restaurant_id would violate NOT NULL.
-- The order line survives; only the analytics back-reference goes away.
--
-- Publishes two closure keys: uq_order_items_tenant (restaurant_id, id) and
-- uq_order_items_in_order (order_id, id), the latter being the FK target of
-- order_item_options below.
-- -----------------------------------------------------------------------------
CREATE TABLE public.order_items (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id               UUID        NOT NULL,
  order_id                    UUID        NOT NULL,
  menu_item_id                UUID,

  name_snapshot               public.i18n_text NOT NULL,
  description_snapshot        public.i18n_text,
  category_name_snapshot      public.i18n_text,
  image_url_snapshot          TEXT,
  price_snapshot              public.money_minor NOT NULL,
  spicy_level_snapshot        SMALLINT    NOT NULL DEFAULT 0,
  preparation_time_snapshot   SMALLINT    NOT NULL DEFAULT 15,
  dietary_tags_snapshot       public.dietary_tag[] NOT NULL DEFAULT '{}',

  quantity                    INTEGER     NOT NULL,
  options_total               public.money_minor NOT NULL DEFAULT 0,

  total                       public.money_minor
                              GENERATED ALWAYS AS
                              (quantity::BIGINT * (price_snapshot + options_total)) STORED,

  note                        TEXT,
  sort_order                  INTEGER     NOT NULL DEFAULT 0,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_order_items_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_items_menu_item
    FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES public.menu_items (restaurant_id, id)
    ON DELETE SET NULL (menu_item_id),

  CONSTRAINT uq_order_items_tenant   UNIQUE (restaurant_id, id),
  CONSTRAINT uq_order_items_in_order UNIQUE (order_id, id),

  CONSTRAINT ck_order_items_quantity_positive
    CHECK (quantity > 0 AND quantity <= 999),

  CONSTRAINT ck_order_items_spicy_level_range
    CHECK (spicy_level_snapshot BETWEEN 0 AND 3),

  CONSTRAINT ck_order_items_prep_time_range
    CHECK (preparation_time_snapshot BETWEEN 1 AND 240),

  CONSTRAINT ck_order_items_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_order_items_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),

  CONSTRAINT ck_order_items_image_url_len
    CHECK (image_url_snapshot IS NULL OR char_length(image_url_snapshot) <= 1024),

  CONSTRAINT ck_order_items_dietary_tags_no_nulls
    CHECK (array_position(dietary_tags_snapshot, NULL) IS NULL)
);

COMMENT ON TABLE  public.order_items IS
  'One line of an order. Every customer-visible attribute is SNAPSHOTTED at order time. Brief §25 and §34.4 make this mandatory: renaming, repricing, 86-ing or deleting a dish must never alter what a historical order says was sold. A reader can render a complete kitchen ticket or receipt from this table alone, with menu_item_id NULL.';
COMMENT ON COLUMN public.order_items.menu_item_id IS
  'Link back to the live dish, for analytics ("most popular dishes"). NULLABLE and non-authoritative: it is a reference, not the record. ON DELETE SET NULL (menu_item_id) - the PG 15+ column-list form, needed because the FK is composite and nulling restaurant_id too would violate NOT NULL. Soft delete (menu_items.deleted_at) is the preferred path; this is the backstop.';
COMMENT ON COLUMN public.order_items.name_snapshot IS
  'Full trilingual name as it was at order time, e.g. {"uz":"Osh","ru":"Плов","en":"Plov"}. All three locales are captured in this one column, so a receipt reprinted for a Russian-speaking manager still renders correctly for an order taken in Uzbek.';
COMMENT ON COLUMN public.order_items.description_snapshot IS
  'Trilingual short description at order time. Kept so the guest-facing tracking screen and the reprinted receipt show the dish exactly as it was sold.';
COMMENT ON COLUMN public.order_items.category_name_snapshot IS
  'Trilingual category name at order time. Lets the kitchen ticket group lines by section (Starters / Mains / Drinks) even after the category is renamed or deleted.';
COMMENT ON COLUMN public.order_items.image_url_snapshot IS
  'Image URL at order time, for the cart and tracking views (brief §7 lists the image as part of a cart line). A URL, not a Storage path: the historical view must survive the object being replaced.';
COMMENT ON COLUMN public.order_items.price_snapshot IS
  'Unit base price in MINOR CURRENCY UNITS at order time, copied from menu_items.price by the server. This - not the live menu - is what the order was sold at. Never sourced from client input (brief §34.2).';
COMMENT ON COLUMN public.order_items.spicy_level_snapshot IS
  'Heat level 0..3 at order time, so the kitchen ticket carries the chilli marks that were promised to the guest.';
COMMENT ON COLUMN public.order_items.preparation_time_snapshot IS
  'Preparation minutes at order time, feeding orders.estimated_prep_minutes and the KDS timing without a join to a menu that may have changed.';
COMMENT ON COLUMN public.order_items.dietary_tags_snapshot IS
  'Dietary markers at order time. An allergy-relevant claim must be reproducible from the order record itself, not re-derived from a menu that has since been edited.';
COMMENT ON COLUMN public.order_items.quantity IS
  'Units of this dish on this line. CHECK quantity > 0 (a zero-quantity line is an illegal state - removal is a DELETE) and <= 999 as an abuse ceiling on an anonymous public write path.';
COMMENT ON COLUMN public.order_items.options_total IS
  'Sum of the chosen options'' per-unit price deltas for ONE unit of this line, in MINOR CURRENCY UNITS. Equality with the order_item_options children is asserted at COMMIT by trg_order_items_options_total_consistent.';
COMMENT ON COLUMN public.order_items.total IS
  'Line total in MINOR CURRENCY UNITS. A STORED GENERATED column: quantity * (price_snapshot + options_total). Generated rather than CHECK-validated so that an inconsistent line total is not merely rejected, it is unwritable. INSERT and UPDATE statements MUST NOT mention this column - PostgreSQL raises 428C9 if they do.';
COMMENT ON COLUMN public.order_items.note IS
  'Per-line customer instruction ("No onion", brief §6). Printed prominently on the kitchen ticket. Length-capped at 300 chars because it comes from an anonymous public client.';
COMMENT ON COLUMN public.order_items.sort_order IS
  'Order in which lines were added to the cart, preserved so the ticket and the receipt read the way the guest built the order. CHECK >= 0.';


-- -----------------------------------------------------------------------------
-- §6.15 order_item_options — the extras actually chosen, with their own snapshots
--
-- The (order_id, order_item_id) FK makes attaching an option to a line of a
-- DIFFERENT order structurally impossible; the composite tenant FK to orders
-- keeps Invariant T1 closed. As with order_items, deleting the live
-- menu_item_options row only nulls the analytics reference.
-- -----------------------------------------------------------------------------
CREATE TABLE public.order_item_options (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id           UUID        NOT NULL,
  order_id                UUID        NOT NULL,
  order_item_id           UUID        NOT NULL,
  menu_item_option_id     UUID,

  group_key_snapshot      TEXT        NOT NULL,
  group_label_snapshot    public.i18n_text NOT NULL,
  name_snapshot           public.i18n_text NOT NULL,
  price_delta_snapshot    public.money_minor NOT NULL,

  quantity                SMALLINT    NOT NULL DEFAULT 1,

  total_per_unit          public.money_minor
                          GENERATED ALWAYS AS
                          (quantity::BIGINT * price_delta_snapshot) STORED,

  sort_order              INTEGER     NOT NULL DEFAULT 0,

  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_order_item_options_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_item_options_order_item
    FOREIGN KEY (order_id, order_item_id)
    REFERENCES public.order_items (order_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_item_options_menu_item_option
    FOREIGN KEY (restaurant_id, menu_item_option_id)
    REFERENCES public.menu_item_options (restaurant_id, id)
    ON DELETE SET NULL (menu_item_option_id),

  CONSTRAINT uq_order_item_options_line_option
    UNIQUE NULLS NOT DISTINCT (order_item_id, menu_item_option_id),

  CONSTRAINT ck_order_item_options_quantity_positive
    CHECK (quantity > 0 AND quantity <= 20),

  CONSTRAINT ck_order_item_options_group_key_format
    CHECK (group_key_snapshot ~ '^[a-z0-9_]{1,32}$'),

  CONSTRAINT ck_order_item_options_sort_order_non_negative
    CHECK (sort_order >= 0)
);

COMMENT ON TABLE  public.order_item_options IS
  'The extras a guest actually chose on one order line, each with its own price and name SNAPSHOT. Required for historical accuracy (brief §34.4): "Extra cheese +5 000" must still read +5 000 on a receipt printed after the extra was repriced to 7 000 or deleted from the menu.';
COMMENT ON COLUMN public.order_item_options.order_id IS
  'Denormalised parent order. Two jobs: it makes the tenant FK to orders composite (Invariant T1), and it lets the receipt/KDS query fetch every option of an order in one indexed scan instead of joining through order_items.';
COMMENT ON COLUMN public.order_item_options.order_item_id IS
  'The line this option belongs to. The FK is (order_id, order_item_id) -> order_items (order_id, id), which makes attaching an option to a line of a DIFFERENT order structurally impossible.';
COMMENT ON COLUMN public.order_item_options.menu_item_option_id IS
  'Reference to the live option row, for analytics only. NULLABLE; ON DELETE SET NULL (menu_item_option_id). The snapshots above are the record.';
COMMENT ON COLUMN public.order_item_options.group_key_snapshot IS
  'The option group this choice came from ("size", "extras"), captured so the receipt can still group choices under their headings after the menu is restructured.';
COMMENT ON COLUMN public.order_item_options.group_label_snapshot IS
  'Trilingual group heading at order time ("O''lcham" / "Размер" / "Size").';
COMMENT ON COLUMN public.order_item_options.name_snapshot IS
  'Trilingual option name at order time ("Qo''shimcha pishloq" / "Доп. сыр" / "Extra cheese").';
COMMENT ON COLUMN public.order_item_options.price_delta_snapshot IS
  'Per-unit price of this option in MINOR CURRENCY UNITS at order time, copied from menu_item_options.price_delta by the server. CHECK >= 0 via money_minor.';
COMMENT ON COLUMN public.order_item_options.quantity IS
  'How many of this option per ONE unit of the parent line ("extra cheese x2"). Not multiplied by the line quantity here - the line quantity multiplies once, in order_items.total.';
COMMENT ON COLUMN public.order_item_options.total_per_unit IS
  'quantity * price_delta_snapshot, in MINOR CURRENCY UNITS, for ONE unit of the parent line. STORED GENERATED, so an inconsistent value is unwritable. The sum of these across a line must equal order_items.options_total (trg_order_items_options_total_consistent).';
COMMENT ON CONSTRAINT uq_order_item_options_line_option ON public.order_item_options IS
  'One row per (line, option). Choosing "extra cheese" twice is expressed as quantity = 2, never as two rows. NULLS NOT DISTINCT (PG 15+) means at most one free-text/orphaned option row per line as well.';


-- -----------------------------------------------------------------------------
-- §6.16 order_status_history — the append-only status audit trail
--
-- previous_status / new_status record the transition; changed_by names the
-- profile responsible, disambiguated by changed_by_kind when NULL (customer or
-- system actors have no auth.users row). Immutability itself is enforced by
-- trg_order_status_history_immutable in migration 8, not here.
-- -----------------------------------------------------------------------------
CREATE TABLE public.order_status_history (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  branch_id         UUID        NOT NULL,
  order_id          UUID        NOT NULL,

  previous_status   public.order_status,
  new_status        public.order_status NOT NULL,

  changed_by        UUID,
  changed_by_kind   public.actor_kind NOT NULL DEFAULT 'system',
  changed_by_role   public.app_role,
  note              TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_order_status_history_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_status_history_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_order_status_history_changed_by
    FOREIGN KEY (changed_by) REFERENCES public.profiles (id) ON DELETE SET NULL,

  CONSTRAINT ck_order_status_history_actual_change
    CHECK (previous_status IS DISTINCT FROM new_status),

  CONSTRAINT ck_order_status_history_staff_actor
    CHECK (changed_by_kind <> 'staff' OR changed_by_role IS NOT NULL),

  CONSTRAINT ck_order_status_history_customer_actor
    CHECK (changed_by_kind <> 'customer' OR (changed_by IS NULL AND changed_by_role IS NULL)),

  CONSTRAINT ck_order_status_history_note_len
    CHECK (note IS NULL OR char_length(note) <= 300),

  CONSTRAINT ck_order_status_history_transition_legal
    CHECK (
      previous_status IS NULL
      OR public.is_valid_order_transition(previous_status, new_status)
    )
);

COMMENT ON TABLE  public.order_status_history IS
  'Every status transition of every order (brief §25 "every important status transition recorded"). APPEND-ONLY: trg_order_status_history_immutable rejects UPDATE and DELETE, so the audit trail cannot be rewritten. Rows are written ONLY by trg_orders_log_status_change, never by application code, which means no code path can change a status without leaving a trace.';
COMMENT ON COLUMN public.order_status_history.previous_status IS
  'Status before the change. NULL on exactly one row per order: the creation row written by the AFTER INSERT trigger, whose new_status is pending. ck_order_status_history_transition_legal re-validates every non-creation row against the state machine, so even a direct SQL write cannot record an impossible history.';
COMMENT ON COLUMN public.order_status_history.changed_by IS
  'Profile that made the change; the brief''s changed_by column. NULL for customer and system actors, who have no auth.users row - see changed_by_kind.';
COMMENT ON COLUMN public.order_status_history.changed_by_kind IS
  'Disambiguates a NULL changed_by. customer = the anonymous guest cancelled their own pending order (legal, and accountless per brief §11); system = a trigger or cron job; staff = an authenticated employee, which then requires changed_by_role.';
COMMENT ON COLUMN public.order_status_history.changed_by_role IS
  'The staff role in force at the time of the change. Snapshotted here rather than joined from staff, because roles are reassigned and the audit answer to "who was allowed to do this then" must not change afterwards.';
COMMENT ON COLUMN public.order_status_history.note IS
  'Optional free-text reason ("out of lamb"), read by the logging trigger from the app.actor_note transaction setting. For cancellations this mirrors orders.cancellation_reason.';
COMMENT ON COLUMN public.order_status_history.updated_at IS
  'Present only to satisfy the platform-wide "every business table carries created_at and updated_at" rule. It is ALWAYS equal to created_at, because trg_order_status_history_immutable forbids UPDATE. Do not read meaning into it.';
