-- =============================================================================
-- RESTAURANT QR OS — migration 5 of 10
-- File: 20260901000500_promotions.sql
--
-- Implements docs/architecture/01-database-schema.md:
--   §6.10 public.promotions       — campaign banners on the customer home rail
--   §6.11 public.promotion_items  — which dishes a promotion covers
--
-- Scope note: §8 indexes (idx_promotions_restaurant_branch,
-- idx_promotions_active_window, idx_promotion_items_*) and §7 triggers
-- (trg_*_set_updated_at) are NOT created here; they belong to their own
-- migrations. Only the constraint-backed indexes implied by PRIMARY KEY /
-- UNIQUE declarations appear below.
--
-- Money is BIGINT in minor currency units via public.money_minor; percentage
-- discounts are integer basis points via public.bps. No NUMERIC/FLOAT anywhere.
--
-- Depends on: 20260901000100 (domains public.i18n_text, public.money_minor,
--                             public.bps; enum public.promotion_type;
--                             pgcrypto gen_random_uuid()),
--             20260901000200 (restaurants(id),
--                             branches.uq_branches_tenant (restaurant_id, id)),
--             20260901000400 (menu_items.uq_menu_items_tenant
--                             (restaurant_id, id)).
-- =============================================================================


-- ---------------------------------------------------------------------------
-- §6.10 promotions
-- ---------------------------------------------------------------------------
CREATE TABLE public.promotions (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  branch_id         UUID,

  promo_type        public.promotion_type NOT NULL DEFAULT 'announcement',

  title             public.i18n_text NOT NULL,
  description       public.i18n_text,
  badge_label       public.i18n_text,

  image_url         TEXT,
  image_path        TEXT,

  discount_bps      public.bps,
  discount_amount   public.money_minor,
  special_price     public.money_minor,

  starts_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at           TIMESTAMPTZ,

  sort_order        INTEGER     NOT NULL DEFAULT 0,
  is_active         BOOLEAN     NOT NULL DEFAULT true,

  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_promotions_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_promotions_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_promotions_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_promotions_window_order
    CHECK (ends_at IS NULL OR ends_at > starts_at),

  CONSTRAINT ck_promotions_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_promotions_value_shape
    CHECK (
      CASE promo_type
        WHEN 'announcement'  THEN discount_bps IS NULL AND discount_amount IS NULL AND special_price IS NULL
        WHEN 'percentage'    THEN discount_bps IS NOT NULL AND discount_amount IS NULL AND special_price IS NULL
        WHEN 'fixed_amount'  THEN discount_bps IS NULL AND discount_amount IS NOT NULL AND special_price IS NULL
        WHEN 'special_price' THEN discount_bps IS NULL AND discount_amount IS NULL AND special_price IS NOT NULL
      END
    ),

  CONSTRAINT ck_promotions_percentage_range
    CHECK (discount_bps IS NULL OR discount_bps BETWEEN 1 AND 10000),

  CONSTRAINT ck_promotions_urls_len
    CHECK (
      (image_url  IS NULL OR char_length(image_url)  <= 1024) AND
      (image_path IS NULL OR char_length(image_path) <= 512)
    )
);

COMMENT ON TABLE  public.promotions IS
  'Campaigns surfaced on the customer home rail (brief §4 "active promotions"). MVP SCOPE: promotions are DISPLAY-ONLY. The order pricing service does not auto-apply them; orders.discount_total is written as 0. The numeric columns exist so a later pricing engine has a schema to read instead of a migration to write.';
COMMENT ON COLUMN public.promotions.promo_type IS
  'Selects which value column must be populated; ck_promotions_value_shape makes every other combination unrepresentable, so a "percentage" promotion with a NULL percentage cannot exist.';
COMMENT ON COLUMN public.promotions.branch_id IS
  'NULL = the promotion runs at every branch. NOT NULL = one branch only (a grand-opening offer).';
COMMENT ON COLUMN public.promotions.badge_label IS
  'Short overlay text for the item card ("-20%", "YANGI", "НОВИНКА"). Translatable because it is customer-visible; kept separate from title so the card badge is not a truncated headline.';
COMMENT ON COLUMN public.promotions.discount_bps IS
  'Percentage discount in basis points (2000 = 20.00%) for promo_type = percentage. Basis points, not NUMERIC percent, so that any future discount arithmetic stays integral: discount = round(base * discount_bps / 10000).';
COMMENT ON COLUMN public.promotions.discount_amount IS
  'Flat discount in MINOR CURRENCY UNITS for promo_type = fixed_amount (UZS: 10000 = 10 000 so''m off).';
COMMENT ON COLUMN public.promotions.special_price IS
  'Replacement price in MINOR CURRENCY UNITS for promo_type = special_price ("this dish is 39 000 so''m this week").';
COMMENT ON COLUMN public.promotions.starts_at IS
  'Campaign start. "Active" is evaluated as is_active AND deleted_at IS NULL AND starts_at <= now() AND (ends_at IS NULL OR ends_at > now()); idx_promotions_active_window serves exactly that predicate.';
COMMENT ON COLUMN public.promotions.ends_at IS
  'Campaign end, exclusive. NULL = open-ended. CHECK forces it strictly after starts_at, so an empty window is unrepresentable.';


-- ---------------------------------------------------------------------------
-- §6.11 promotion_items — which dishes a promotion covers
-- ---------------------------------------------------------------------------
CREATE TABLE public.promotion_items (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL,
  promotion_id   UUID        NOT NULL,
  menu_item_id   UUID        NOT NULL,

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_promotion_items_promotion
    FOREIGN KEY (restaurant_id, promotion_id)
    REFERENCES public.promotions (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_promotion_items_menu_item
    FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES public.menu_items (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_promotion_items_pair UNIQUE (promotion_id, menu_item_id)
);

COMMENT ON TABLE  public.promotion_items IS
  'Many-to-many link from a promotion to the dishes it covers. An empty set means the promotion is a whole-menu banner. Both FKs are composite on restaurant_id, so a promotion can never be attached to another tenant''s dish (Invariant T1).';
COMMENT ON COLUMN public.promotion_items.restaurant_id IS
  'Denormalised tenant key. Present so both foreign keys can be composite and so the RLS policy is a single-column predicate rather than a two-hop join.';
