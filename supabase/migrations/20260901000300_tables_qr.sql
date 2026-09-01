-- =============================================================================
-- RESTAURANT QR OS — migration 3 of 10
-- File: 20260901000300_tables_qr.sql
--
-- Implements docs/architecture/01-database-schema.md:
--   §6.5 public.tables            — physical tables and their live QR tokens
--   §6.6 public.qr_token_history  — retired (revoked) QR tokens, append-only
--   §8.2 uq_tables_branch_number  — the one partial unique index the spec
--                                   declares inline with §6.5
--
-- Also creates §5.2 public.generate_qr_token(), because §6.5 uses it in a
-- column DEFAULT and the DEFAULT is resolved at CREATE TABLE time. §5 says the
-- utility functions may be created ahead of the table migrations for exactly
-- this reason; migration 8 re-creates it with CREATE OR REPLACE and the
-- identical body, so running both in order is a no-op the second time.
--
-- Depends on: 20260901000100 (pgcrypto in schema `extensions`),
--             20260901000200 (branches.uq_branches_tenant (restaurant_id, id),
--                             profiles.id).
--
-- Not created here: §7 triggers (trg_tables_set_updated_at,
-- trg_tables_prevent_token_reuse, trg_tables_rotate_qr_token,
-- trg_qr_token_history_immutable) and the §8.3 explicit indexes. Until
-- migration 8 runs, qr_token rotation is NOT archived and reuse is NOT blocked.
-- Run once, in filename order. Not wrapped in an explicit transaction:
-- Supabase already runs each migration file in one.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- §5.2 generate_qr_token() — 144-bit URL-safe token (needed by the DEFAULT below)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.generate_qr_token(p_bytes INTEGER DEFAULT 18)
RETURNS TEXT
LANGUAGE sql
VOLATILE
SET search_path = public, extensions, pg_temp
AS $$
  SELECT translate(encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/=', '-_');
$$;

COMMENT ON FUNCTION public.generate_qr_token(INTEGER) IS
  'Cryptographically secure QR token (brief §13, §14, §34.9). 18 bytes = 144 bits = exactly 24 base64 characters with no padding, translated to the base64url alphabet ([A-Za-z0-9_-]). translate() with a 3-char FROM and 2-char TO deletes any ''='' should p_bytes ever not be a multiple of 3.';


-- -----------------------------------------------------------------------------
-- §6.5 tables — physical tables and their QR tokens
--
-- Tenancy: restaurant_id is denormalised alongside branch_id and the pair is
-- validated by the composite FK against branches (restaurant_id, id), so a row
-- can never claim a branch belonging to another tenant (Invariant T1/T2).
-- This table in turn publishes both closure keys that downstream tables use:
--   uq_tables_tenant          (restaurant_id, id) — tenant closure
--   uq_tables_branch_identity (branch_id, id)     — branch closure, the FK
--                             target of orders, waiter_calls and
--                             qr_token_history below.
-- -----------------------------------------------------------------------------
CREATE TABLE public.tables (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      UUID        NOT NULL,
  branch_id          UUID        NOT NULL,

  number             TEXT        NOT NULL,
  name               TEXT,
  zone               TEXT,
  seats              SMALLINT,
  sort_order         INTEGER     NOT NULL DEFAULT 0,

  qr_token           TEXT        NOT NULL DEFAULT public.generate_qr_token(),
  qr_token_issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  qr_rotation_count  INTEGER     NOT NULL DEFAULT 0,

  is_active          BOOLEAN     NOT NULL DEFAULT true,

  deleted_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_tables_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_tables_qr_token        UNIQUE (qr_token),
  CONSTRAINT uq_tables_tenant          UNIQUE (restaurant_id, id),
  CONSTRAINT uq_tables_branch_identity UNIQUE (branch_id, id),

  CONSTRAINT ck_tables_number_format
    CHECK (number ~ '^[A-Za-z0-9][A-Za-z0-9 _-]{0,15}$'),

  CONSTRAINT ck_tables_name_len
    CHECK (name IS NULL OR char_length(btrim(name)) BETWEEN 1 AND 60),

  CONSTRAINT ck_tables_zone_len
    CHECK (zone IS NULL OR char_length(btrim(zone)) BETWEEN 1 AND 40),

  CONSTRAINT ck_tables_seats_range
    CHECK (seats IS NULL OR seats BETWEEN 1 AND 100),

  CONSTRAINT ck_tables_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_tables_qr_token_format
    CHECK (qr_token ~ '^[A-Za-z0-9_-]{22,64}$'),

  CONSTRAINT ck_tables_qr_rotation_count_non_negative
    CHECK (qr_rotation_count >= 0)
);

-- §8.2: declared with the table, not in the index migration. Allows a retired
-- "12" and a live "12" to coexist because soft-deleted rows are excluded.
CREATE UNIQUE INDEX uq_tables_branch_number
  ON public.tables (branch_id, number)
  WHERE deleted_at IS NULL;

COMMENT ON TABLE  public.tables IS
  'A physical table. The QR token on this row is the ONLY public entry point into the whole system (brief §3, §14): token -> table -> branch -> restaurant.';
COMMENT ON COLUMN public.tables.restaurant_id IS
  'Denormalised tenant key. Validated against branch_id by fk_tables_branch, which targets branches (restaurant_id, id); a mismatched pair is rejected by the database, so RLS can trust restaurant_id alone (Invariant T1).';
COMMENT ON COLUMN public.tables.branch_id IS
  'Owning branch. Exposed together with id as uq_tables_branch_identity, the branch-closure key that orders, waiter_calls and qr_token_history reference (Invariant T2).';
COMMENT ON COLUMN public.tables.number IS
  'Human table designation as printed on the table tent: "12", "A4", "Terrace 2". TEXT, not INTEGER, because real venues number tables alphanumerically by zone. Unique per branch among non-deleted rows (uq_tables_branch_number).';
COMMENT ON COLUMN public.tables.name IS
  'Optional descriptive label ("Window booth"). The customer welcome screen shows number first and name as a subtitle.';
COMMENT ON COLUMN public.tables.sort_order IS
  'Display order in the admin table grid and the waiter console floor list. CHECK >= 0.';
COMMENT ON COLUMN public.tables.qr_token IS
  'Cryptographically random, URL-safe, 144-bit public token (brief §13, §34.9). Appears in the public URL as /t/<qr_token>. UNIQUE across the ENTIRE platform, not per tenant, because the resolver looks it up with no other context. Never sequential, never derived from any id. Regenerating writes the old value into qr_token_history and increments qr_rotation_count.';
COMMENT ON CONSTRAINT uq_tables_qr_token ON public.tables IS
  'Platform-wide uniqueness of the live token. Not scoped to a tenant: the /t/<token> resolver has no tenant context and must reach exactly one table from the token alone. Combined with uq_qr_token_history_token and trg_tables_prevent_token_reuse (§7.10), a token value is live on at most one table and, once retired, never live again.';
COMMENT ON CONSTRAINT ck_tables_qr_token_format ON public.tables IS
  'Shape guard, not an entropy guard: base64url alphabet only, 22-64 characters. generate_qr_token() emits 24 characters (144 bits). The lower bound rejects hand-written or truncated tokens; the upper bound bounds the public URL. Entropy itself comes from pgcrypto gen_random_bytes(), never from a sequence or a hash of any id.';
COMMENT ON COLUMN public.tables.qr_token_issued_at IS
  'When the CURRENT token was minted. Drives the "QR printed on" line of the downloadable QR sheet and lets an operator see which tables still carry a stale print run.';
COMMENT ON COLUMN public.tables.qr_rotation_count IS
  'How many times this table''s QR has been regenerated. Maintained by trg_tables_rotate_qr_token; never written by application code.';
COMMENT ON COLUMN public.tables.is_active IS
  'A false value keeps the token resolvable but makes the resolver return the "table inactive" state (brief §32) instead of the menu. Deactivating is NOT the same as revoking the token.';
COMMENT ON COLUMN public.tables.deleted_at IS
  'Soft delete. Hard deletion is forbidden while orders reference the table (fk_orders_table is ON DELETE RESTRICT); retiring a table sets this and the resolver treats it as an unknown table.';


-- -----------------------------------------------------------------------------
-- §6.6 qr_token_history — retired tokens
--
-- Revocation is represented by the MOVE of a token value out of
-- tables.qr_token and into this table, not by a flag: a row here exists if and
-- only if that token has been retired. Rotation is a single application
-- statement (UPDATE tables SET qr_token = public.generate_qr_token() ...);
-- trg_tables_rotate_qr_token (§7.10) performs the archival, and
-- trg_tables_prevent_token_reuse (§7.10) rejects any token that already
-- appears here. Append-only: trg_qr_token_history_immutable (§7.7) blocks
-- UPDATE and DELETE, because deleting a retired token would make it
-- re-issuable.
-- -----------------------------------------------------------------------------
CREATE TABLE public.qr_token_history (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID        NOT NULL,
  branch_id           UUID        NOT NULL,
  table_id            UUID        NOT NULL,

  token               TEXT        NOT NULL,
  issued_at           TIMESTAMPTZ NOT NULL,
  revoked_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_by          UUID,
  revoke_reason       TEXT,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_qr_token_history_table
    FOREIGN KEY (branch_id, table_id)
    REFERENCES public.tables (branch_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_qr_token_history_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_qr_token_history_revoked_by
    FOREIGN KEY (revoked_by) REFERENCES public.profiles (id) ON DELETE SET NULL,

  CONSTRAINT uq_qr_token_history_token UNIQUE (token),

  CONSTRAINT ck_qr_token_history_token_format
    CHECK (token ~ '^[A-Za-z0-9_-]{22,64}$'),

  CONSTRAINT ck_qr_token_history_revoke_reason_len
    CHECK (revoke_reason IS NULL OR char_length(revoke_reason) <= 200),

  CONSTRAINT ck_qr_token_history_time_order
    CHECK (revoked_at >= issued_at)
);

COMMENT ON TABLE  public.qr_token_history IS
  'Every QR token this platform has ever retired. Two jobs: (1) let the /t/<token> resolver answer 410 Gone with a useful message instead of 404 for a token from an old print run (brief §14, §34.10); (2) guarantee no token is ever re-issued - trg_tables_prevent_token_reuse rejects any tables.qr_token that appears here.';
COMMENT ON COLUMN public.qr_token_history.restaurant_id IS
  'Denormalised tenant key, validated against branch_id by fk_qr_token_history_branch (Invariant T1). Lets RLS scope the audit drawer without joining tables.';
COMMENT ON COLUMN public.qr_token_history.table_id IS
  'The table the token was printed for. Referenced through the branch-closure key (branch_id, table_id) -> tables (branch_id, id), so a history row can never point at a table in another branch (Invariant T2).';
COMMENT ON COLUMN public.qr_token_history.token IS
  'The retired token value. UNIQUE platform-wide, mirroring uq_tables_qr_token. Cross-table uniqueness (a token being in exactly one of the two tables) cannot be a single constraint in PostgreSQL, so it is enforced by trg_tables_prevent_token_reuse on insert/update of tables.qr_token.';
COMMENT ON COLUMN public.qr_token_history.issued_at IS
  'Copied from tables.qr_token_issued_at at rotation time, so the row records the full lifetime of the retired token; ck_qr_token_history_time_order keeps revoked_at >= issued_at.';
COMMENT ON COLUMN public.qr_token_history.revoked_at IS
  'When the token stopped resolving. From this moment /t/<token> is 410 Gone (QR_REPLACED), never 404 and never a menu.';
COMMENT ON COLUMN public.qr_token_history.revoked_by IS
  'Profile that performed the rotation, read from the app.actor_profile_id transaction setting by trg_tables_rotate_qr_token. NULL for system rotations.';
COMMENT ON COLUMN public.qr_token_history.revoke_reason IS
  'Free-text operator note ("reprinted after refurbishment", "QR sticker damaged"). Shown in the table audit drawer of the admin panel.';
