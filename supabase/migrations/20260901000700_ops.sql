-- =============================================================================
-- RESTAURANT QR OS — migration 7 of 10
-- File: 20260901000700_ops.sql
--
-- Implements docs/architecture/01-database-schema.md:
--   §6.17 public.waiter_calls       — a table asking for a waiter (brief §10)
--   §6.18 public.notifications      — staff feed addressed by role / branch /
--                                     staff member, resolved at read time
--   §6.19 public.notification_reads — per-person read state for those
--
-- Scope note: §8 explicit indexes (idx_waiter_calls_*, idx_notifications_*,
-- idx_notification_reads_*) and §7 triggers (trg_*_set_updated_at,
-- trg_waiter_calls_cooldown) are NOT created here; they belong to migrations 9
-- and 8 respectively. The only index created below is
-- uq_waiter_calls_open_per_table, which §8.2 lists as "declared with its
-- table", plus the indexes PRIMARY KEY / UNIQUE build implicitly.
--
-- Anti-spam is two independent mechanisms: uq_waiter_calls_open_per_table
-- (at most one OPEN call per table) lives here; the time window lives in
-- public.assert_waiter_call_cooldown() (§7.11) and reads its tuning value from
-- branches.waiter_call_cooldown_seconds / branches.waiter_call_expiry_minutes,
-- both defined in migration 2. No cooldown column belongs on waiter_calls.
--
-- No money columns in this file.
--
-- Depends on: 20260901000100 (pgcrypto gen_random_uuid(); enums
--                             public.waiter_call_reason, public.waiter_call_status,
--                             public.app_role, public.notification_type),
--             20260901000200 (branches.uq_branches_tenant (restaurant_id, id),
--                             staff.uq_staff_tenant (restaurant_id, id)),
--             20260901000300 (tables.uq_tables_branch_identity (branch_id, id)),
--             20260901000600 (orders.uq_orders_tenant (restaurant_id, id)).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- §6.17 waiter_calls
--
-- Tenant closure: the branch FK is composite on (restaurant_id, branch_id) and
-- the table FK is composite on (branch_id, table_id), so a call can never name
-- a table outside its own branch, nor a branch outside its own tenant
-- (Invariants T1/T2). Staff and order references are likewise composite on
-- restaurant_id.
-- ---------------------------------------------------------------------------

CREATE TABLE public.waiter_calls (
  id                        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id             UUID        NOT NULL,
  branch_id                 UUID        NOT NULL,
  table_id                  UUID        NOT NULL,
  order_id                  UUID,

  reason                    public.waiter_call_reason NOT NULL DEFAULT 'call_waiter',
  status                    public.waiter_call_status NOT NULL DEFAULT 'pending',
  note                      TEXT,

  customer_session_id       UUID,

  acknowledged_at           TIMESTAMPTZ,
  acknowledged_by_staff_id  UUID,
  resolved_at               TIMESTAMPTZ,
  resolved_by_staff_id      UUID,

  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_waiter_calls_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_waiter_calls_table
    FOREIGN KEY (branch_id, table_id)
    REFERENCES public.tables (branch_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_waiter_calls_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE SET NULL (order_id),

  CONSTRAINT fk_waiter_calls_acknowledged_by
    FOREIGN KEY (restaurant_id, acknowledged_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (acknowledged_by_staff_id),

  CONSTRAINT fk_waiter_calls_resolved_by
    FOREIGN KEY (restaurant_id, resolved_by_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE SET NULL (resolved_by_staff_id),

  CONSTRAINT uq_waiter_calls_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_waiter_calls_note_len
    CHECK (note IS NULL OR char_length(note) <= 200),

  CONSTRAINT ck_waiter_calls_pending_not_acknowledged
    CHECK (status <> 'pending' OR acknowledged_at IS NULL),

  CONSTRAINT ck_waiter_calls_acknowledged_pair
    CHECK (status <> 'acknowledged' OR acknowledged_at IS NOT NULL),

  CONSTRAINT ck_waiter_calls_resolved_pair
    CHECK ((resolved_at IS NOT NULL) = (status = 'resolved')),

  CONSTRAINT ck_waiter_calls_time_order
    CHECK (
      (acknowledged_at IS NULL OR acknowledged_at >= created_at)
      AND (resolved_at IS NULL OR resolved_at >= created_at)
      AND (resolved_at IS NULL OR acknowledged_at IS NULL OR resolved_at >= acknowledged_at)
    )
);

-- At most ONE open call per table, at any moment. Spam protection, structurally.
CREATE UNIQUE INDEX uq_waiter_calls_open_per_table
  ON public.waiter_calls (table_id)
  WHERE status IN ('pending', 'acknowledged');

COMMENT ON TABLE  public.waiter_calls IS
  'A table asking for a waiter (brief §10). Created by the anonymous customer app, consumed live by the waiter console ("TABLE 12 IS CALLING"). Two independent anti-spam mechanisms: uq_waiter_calls_open_per_table (at most one open call per table) and trg_waiter_calls_cooldown (a time window between calls), both in the database so neither depends on the API being correct.';
COMMENT ON COLUMN public.waiter_calls.table_id IS
  'The calling table. FK is (branch_id, table_id) -> tables (branch_id, id), so a call can never reference a table outside its own branch - which is what makes the waiter console''s single branch_id filter sufficient for isolation (brief §34.6).';
COMMENT ON COLUMN public.waiter_calls.order_id IS
  'Optional link to the order the guest is calling about (typically request_bill). ON DELETE SET NULL (order_id) so purging an order never destroys the service record.';
COMMENT ON COLUMN public.waiter_calls.reason IS
  'Why the guest called. Drives icon, colour and sort priority on the waiter console; request_bill outranks request_water.';
COMMENT ON COLUMN public.waiter_calls.status IS
  'pending and acknowledged are the OPEN states - exactly those two appear in the partial unique index and in the console''s live query. resolved/cancelled/expired are closed states that release the table for a new call.';
COMMENT ON COLUMN public.waiter_calls.note IS
  'Optional free text from the guest, capped at 200 chars. The reason enum carries the meaning; this only adds detail. An anonymous public write path never gets an unbounded text column.';
COMMENT ON COLUMN public.waiter_calls.customer_session_id IS
  'The anonymous guest session that raised the call, matching orders.customer_session_id. Used by the cooldown trigger and by the tracking screen to show the guest their own call state ("a waiter is on the way").';
COMMENT ON COLUMN public.waiter_calls.acknowledged_at IS
  'When a waiter tapped "I am coming" (brief §10). This timestamp minus created_at is the response-time metric on the admin dashboard.';
COMMENT ON COLUMN public.waiter_calls.acknowledged_by_staff_id IS
  'Which waiter acknowledged. Composite FK on restaurant_id, so another tenant''s staff id is unassignable.';
COMMENT ON COLUMN public.waiter_calls.resolved_by_staff_id IS
  'Which waiter closed the call. Usually, but not necessarily, the same person who acknowledged it.';


-- ---------------------------------------------------------------------------
-- §6.18 notifications — addressed to a role, a branch, or one staff member
--
-- Audience is (restaurant_id -> branch_id) plus at least one of target_role /
-- target_staff_id, resolved at READ time rather than fanned out on write; see
-- §6.18 for why. Per-person read state therefore lives in §6.19.
-- ---------------------------------------------------------------------------

CREATE TABLE public.notifications (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  branch_id         UUID        NOT NULL,

  target_role       public.app_role,
  target_staff_id   UUID,

  type              public.notification_type NOT NULL,
  payload           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  priority          SMALLINT    NOT NULL DEFAULT 1,

  order_id          UUID,
  waiter_call_id    UUID,

  expires_at        TIMESTAMPTZ,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_notifications_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_target_staff
    FOREIGN KEY (restaurant_id, target_staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_order
    FOREIGN KEY (restaurant_id, order_id)
    REFERENCES public.orders (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notifications_waiter_call
    FOREIGN KEY (restaurant_id, waiter_call_id)
    REFERENCES public.waiter_calls (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_notifications_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_notifications_addressed
    CHECK (target_role IS NOT NULL OR target_staff_id IS NOT NULL),

  CONSTRAINT ck_notifications_target_role_not_super_admin
    CHECK (target_role IS NULL OR target_role <> 'SUPER_ADMIN'),

  CONSTRAINT ck_notifications_payload_object
    CHECK (jsonb_typeof(payload) = 'object'),

  CONSTRAINT ck_notifications_priority_range
    CHECK (priority BETWEEN 0 AND 2),

  CONSTRAINT ck_notifications_expiry_after_creation
    CHECK (expires_at IS NULL OR expires_at > created_at)
);

COMMENT ON TABLE  public.notifications IS
  'Staff-facing event feed powering the KDS incoming-order alert (brief §9), the waiter ready/call alerts (brief §10, §28) and the admin bell. Addressed by (branch_id + role) or (branch_id + specific staff); resolved at read time, with per-person read state in notification_reads.';
COMMENT ON COLUMN public.notifications.branch_id IS
  'NOT NULL always. Every notification this product produces is about something happening at one physical location, and every panel that consumes them is bound to one location. Making it non-nullable removes an entire class of "which branch is this for" ambiguity from the panels.';
COMMENT ON COLUMN public.notifications.target_role IS
  'Role broadcast within the branch: KITCHEN for new orders, WAITER for ready orders and table calls, MANAGER/RESTAURANT_OWNER for escalations. NULL when the notification is for one named person. SUPER_ADMIN is rejected - platform admins are not on a branch rota.';
COMMENT ON COLUMN public.notifications.target_staff_id IS
  'Direct address to one staff member (e.g. "the order you accepted is now late"). NULL for role broadcasts. At least one of target_role / target_staff_id must be set; both may be, meaning "the WAITER role, but highlight it for this person".';
COMMENT ON COLUMN public.notifications.type IS
  'Event discriminator. Together with payload it is everything the client needs to render.';
COMMENT ON COLUMN public.notifications.payload IS
  'Structured data for rendering: {"order_number":"A-014","table_number":"12","item_count":3}. NO RENDERED TEXT IS STORED - the client composes the localised string from type + payload. Storing a sentence would freeze one of three locales into the row and go stale the moment the underlying entity changes.';
COMMENT ON COLUMN public.notifications.priority IS
  '0 = informational (badge only), 1 = normal (toast), 2 = urgent (persistent banner + sound; new order on the KDS, table calling on the waiter console). CHECK 0..2.';
COMMENT ON COLUMN public.notifications.order_id IS
  'Deep-link target. ON DELETE CASCADE: a notification about a purged order has nothing to point at and should go with it.';
COMMENT ON COLUMN public.notifications.waiter_call_id IS
  'Deep-link target for waiter-call notifications, cascading for the same reason.';
COMMENT ON COLUMN public.notifications.expires_at IS
  'Optional auto-hide time. The housekeeping job deletes expired rows so the feed cannot grow without bound; NULL means keep until the retention job trims by age.';


-- ---------------------------------------------------------------------------
-- §6.19 notification_reads — per-person read state
--
-- Deliberate exception to the surrogate-uuid-id rule: a pure junction whose
-- natural key IS its uniqueness requirement. "Mark as read" is
-- INSERT ... ON CONFLICT DO NOTHING against pk_notification_reads.
-- ---------------------------------------------------------------------------

CREATE TABLE public.notification_reads (
  notification_id  UUID        NOT NULL,
  staff_id         UUID        NOT NULL,
  restaurant_id    UUID        NOT NULL,
  read_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT pk_notification_reads PRIMARY KEY (notification_id, staff_id),

  CONSTRAINT fk_notification_reads_notification
    FOREIGN KEY (restaurant_id, notification_id)
    REFERENCES public.notifications (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_notification_reads_staff
    FOREIGN KEY (restaurant_id, staff_id)
    REFERENCES public.staff (restaurant_id, id)
    ON DELETE CASCADE
);

COMMENT ON TABLE  public.notification_reads IS
  'One row per (notification, staff member) that has seen it. DELIBERATE EXCEPTION to the uuid-id rule: this is a pure junction whose natural key (notification_id, staff_id) is also its uniqueness requirement; a surrogate id would permit duplicate read marks. A notification is unread FOR ME when no row exists for (notification.id, my staff id).';
COMMENT ON COLUMN public.notification_reads.restaurant_id IS
  'Denormalised tenant key, present so both FKs are composite (Invariant T1) and so the RLS policy is a single-column predicate.';
COMMENT ON COLUMN public.notification_reads.read_at IS
  'When this person saw it. Distinct from created_at so a backfill or a "mark all as read" sweep can record the real observation time.';
