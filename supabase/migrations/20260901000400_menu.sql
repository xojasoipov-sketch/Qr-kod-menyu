-- =============================================================================
-- 20260901000400_menu.sql
--
-- RESTAURANT QR OS — the menu layer.
-- Implements 01-database-schema.md §6.7 menu_categories, §6.8 menu_items,
-- §6.9 menu_item_options, plus the one partial unique index §8.2 lists as
-- "declared with its table" (uq_menu_item_options_single_default), which the
-- spec emits inline in §6.9.
--
-- Invariant T1 (tenant closure): every table here carries restaurant_id and
-- exposes the redundant UNIQUE (restaurant_id, id) key that downstream
-- composite FKs (promotion_items, order_items, order_item_options) target.
-- Invariant T2 (branch closure): branch_id is validated only together with
-- restaurant_id, through the composite FK to branches (restaurant_id, id);
-- MATCH SIMPLE (the default) makes a NULL branch_id skip that check, which is
-- how "sold at every branch" is expressed.
--
-- All money is BIGINT minor currency units via the public.money_minor domain.
--
-- Depends on migration 20260901000100 (§3 domains i18n_text / money_minor,
-- §4 enums dietary_tag / option_selection_type) and on 20260901000200
-- (restaurants, branches).
-- No §7 triggers and no §8.3 indexes are created here; they arrive in
-- 20260901000800 and 20260901000900 respectively.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- §6.7 menu_categories
-- -----------------------------------------------------------------------------
CREATE TABLE public.menu_categories (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id  UUID        NOT NULL,
  branch_id      UUID,

  name           public.i18n_text NOT NULL,
  description    public.i18n_text,
  image_url      TEXT,
  image_path     TEXT,
  icon           TEXT,

  sort_order     INTEGER     NOT NULL DEFAULT 0,
  is_active      BOOLEAN     NOT NULL DEFAULT true,

  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_menu_categories_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_menu_categories_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_menu_categories_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_menu_categories_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_menu_categories_icon_format
    CHECK (icon IS NULL OR icon ~ '^[a-z0-9-]{1,40}$'),

  CONSTRAINT ck_menu_categories_urls_len
    CHECK (
      (image_url  IS NULL OR char_length(image_url)  <= 1024) AND
      (image_path IS NULL OR char_length(image_path) <= 512)
    )
);

COMMENT ON TABLE  public.menu_categories IS
  'Menu sections (Popular, Uzbek Cuisine, Fast Food, Salads, Drinks, Desserts - brief §4). Reorderable and deactivatable per brief §12.';
COMMENT ON COLUMN public.menu_categories.branch_id IS
  'NULL = the category exists at every branch of the restaurant (the common case for a chain with one menu). NOT NULL = branch-exclusive category. The composite FK is MATCH SIMPLE, so NULL skips the branch check while fk_menu_categories_restaurant still pins the tenant.';
COMMENT ON COLUMN public.menu_categories.sort_order IS
  'Ascending display order, ties broken by name. CHECK >= 0. Reordering in the admin panel rewrites this column for the affected rows in one transaction.';
COMMENT ON COLUMN public.menu_categories.icon IS
  'Kebab-case key into the client icon registry (e.g. "flame", "leaf", "cup"). A key, never markup or a URL - the customer app must not render arbitrary strings as icons.';
COMMENT ON COLUMN public.menu_categories.is_active IS
  'Deactivating hides the category and, transitively, its items from the customer app. It does not cascade to menu_items.is_available - the two switches are independent and the orderability rule in §6.8 ANDs them.';

-- -----------------------------------------------------------------------------
-- §6.8 menu_items
-- -----------------------------------------------------------------------------
CREATE TABLE public.menu_items (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id       UUID        NOT NULL,
  branch_id           UUID,
  category_id         UUID        NOT NULL,

  name                public.i18n_text NOT NULL,
  description         public.i18n_text,
  ingredients         public.i18n_text,

  price               public.money_minor NOT NULL,
  compare_at_price    public.money_minor,

  image_url           TEXT,
  image_path          TEXT,

  spicy_level         SMALLINT    NOT NULL DEFAULT 0,
  preparation_time    SMALLINT    NOT NULL DEFAULT 15,
  calories            INTEGER,
  dietary_tags        public.dietary_tag[] NOT NULL DEFAULT '{}',

  is_available        BOOLEAN     NOT NULL DEFAULT true,
  unavailable_until   TIMESTAMPTZ,
  available_from      TIME,
  available_until     TIME,

  is_featured         BOOLEAN     NOT NULL DEFAULT false,
  is_popular          BOOLEAN     NOT NULL DEFAULT false,
  popularity_score    INTEGER     NOT NULL DEFAULT 0,

  sort_order          INTEGER     NOT NULL DEFAULT 0,

  search_vector       tsvector GENERATED ALWAYS AS (
                        to_tsvector('simple',
                          coalesce((name::jsonb)        ->> 'uz', '') || ' ' ||
                          coalesce((name::jsonb)        ->> 'ru', '') || ' ' ||
                          coalesce((name::jsonb)        ->> 'en', '') || ' ' ||
                          coalesce((description::jsonb) ->> 'uz', '') || ' ' ||
                          coalesce((description::jsonb) ->> 'ru', '') || ' ' ||
                          coalesce((description::jsonb) ->> 'en', '')
                        )
                      ) STORED,

  deleted_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_menu_items_restaurant
    FOREIGN KEY (restaurant_id) REFERENCES public.restaurants (id) ON DELETE CASCADE,

  CONSTRAINT fk_menu_items_branch
    FOREIGN KEY (restaurant_id, branch_id)
    REFERENCES public.branches (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT fk_menu_items_category
    FOREIGN KEY (restaurant_id, category_id)
    REFERENCES public.menu_categories (restaurant_id, id)
    ON DELETE RESTRICT,

  CONSTRAINT uq_menu_items_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_menu_items_spicy_level_range
    CHECK (spicy_level BETWEEN 0 AND 3),

  CONSTRAINT ck_menu_items_preparation_time_range
    CHECK (preparation_time BETWEEN 1 AND 240),

  CONSTRAINT ck_menu_items_calories_range
    CHECK (calories IS NULL OR (calories >= 0 AND calories <= 20000)),

  CONSTRAINT ck_menu_items_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_menu_items_popularity_score_non_negative
    CHECK (popularity_score >= 0),

  CONSTRAINT ck_menu_items_compare_at_price_higher
    CHECK (compare_at_price IS NULL OR compare_at_price > price),

  CONSTRAINT ck_menu_items_daypart_pair
    CHECK ((available_from IS NULL) = (available_until IS NULL)),

  CONSTRAINT ck_menu_items_daypart_order
    CHECK (available_from IS NULL OR available_from < available_until),

  CONSTRAINT ck_menu_items_unavailable_until_requires_unavailable
    CHECK (unavailable_until IS NULL OR is_available = false),

  CONSTRAINT ck_menu_items_dietary_tags_no_nulls
    CHECK (array_position(dietary_tags, NULL) IS NULL),

  CONSTRAINT ck_menu_items_urls_len
    CHECK (
      (image_url  IS NULL OR char_length(image_url)  <= 1024) AND
      (image_path IS NULL OR char_length(image_path) <= 512)
    )
);

COMMENT ON TABLE  public.menu_items IS
  'A dish. The centre of the customer experience (brief §5, §6) and the source of every order_items snapshot.';
COMMENT ON COLUMN public.menu_items.price IS
  'Base price in MINOR CURRENCY UNITS of restaurants.currency (UZS, currency_decimals=0, so 45000 means 45 000 so''m). Exact BIGINT integer; never a float. CHECK >= 0 via the money_minor domain. This is the ONLY authoritative price: brief §7 and §34.2 require the server to recompute every total from this column and to ignore any price sent by the client.';
COMMENT ON COLUMN public.menu_items.compare_at_price IS
  'Optional strike-through "was" price in MINOR CURRENCY UNITS, for promotional display only. CHECK forces it strictly above price so a "discount" can never read as an increase.';
COMMENT ON COLUMN public.menu_items.branch_id IS
  'NULL = the dish is sold at every branch. NOT NULL = branch-exclusive. Must be no wider than its category''s scope; trg_menu_items_scope_consistency enforces that a branch-scoped category cannot hold a restaurant-wide item.';
COMMENT ON COLUMN public.menu_items.spicy_level IS
  'Ordinal heat scale: 0 = not spicy, 1 = mild, 2 = medium, 3 = hot. SMALLINT rather than an enum because the customer filter is a range query (spicy_level <= 1) and the UI renders it as N chilli glyphs. CHECK 0..3.';
COMMENT ON COLUMN public.menu_items.preparation_time IS
  'Expected preparation time in MINUTES. Shown on the product detail sheet (brief §6) and summed into orders.estimated_prep_minutes, which sets orders.due_at and therefore the KDS late flag.';
COMMENT ON COLUMN public.menu_items.dietary_tags IS
  'Closed set of dietary markers as an enum array. GIN-indexed (idx_menu_items_dietary_tags) so the customer filter "vegetarian AND gluten_free" is a single containment query dietary_tags @> ARRAY[...]::dietary_tag[].';
COMMENT ON COLUMN public.menu_items.is_available IS
  'The hard availability switch (brief §12). false = cannot be ordered, and the card renders in the visually-distinct unavailable style (brief §5) rather than disappearing.';
COMMENT ON COLUMN public.menu_items.unavailable_until IS
  'Temporary 86-ing with an automatic return: "out of lamb until 18:00". Only meaningful while is_available = false (enforced by CHECK). The orderability rule treats an item as back in stock once now() >= unavailable_until, so staff do not have to remember to flip the switch back.';
COMMENT ON COLUMN public.menu_items.available_from IS
  'Start of the daily serving window (daypart), as a LOCAL time interpreted in branches.timezone. NULL = all day. Paired with available_until by CHECK. Breakfast items are the motivating case.';
COMMENT ON COLUMN public.menu_items.available_until IS
  'End of the daily serving window, local time in branches.timezone. Windows do not wrap past midnight (CHECK available_from < available_until); a late-night menu is modelled as a separate branch-scoped category.';
COMMENT ON COLUMN public.menu_items.is_featured IS
  'Editorial pick. Drives the "featured food" hero rail on the customer home (brief §4). Manually curated by staff - never computed.';
COMMENT ON COLUMN public.menu_items.is_popular IS
  'Manual override forcing a dish into the "popular dishes" rail (brief §4) regardless of sales. Sorting is: is_popular DESC, popularity_score DESC, sort_order ASC.';
COMMENT ON COLUMN public.menu_items.popularity_score IS
  'Computed sales rank over a trailing window, refreshed by the analytics job (owned by 06-analytics.md); never written by request handlers. Kept as a plain column rather than a materialized view so the customer menu query needs no extra join.';
COMMENT ON COLUMN public.menu_items.search_vector IS
  'Stored generated tsvector over all six translated name/description strings using the ''simple'' configuration (no stemming dictionary, which is correct for mixed Latin-Uzbek / Cyrillic-Russian / English text). Queried with to_tsquery(''simple'', <term> || '':*'') for as-you-type prefix search. GIN-indexed by idx_menu_items_search_vector.';
COMMENT ON COLUMN public.menu_items.deleted_at IS
  'Soft delete. Hard deletion is avoided because order_items references this row; if a hard delete ever happens, fk_order_items_menu_item nulls ONLY menu_item_id and the order_items snapshots keep the historical record intact (brief §34.4).';

-- Orderability (§6.8, binding) is evaluated in the application
-- (src/lib/menu/orderability.ts) and backstopped in the database by
-- trg_order_items_item_orderable (§7.9), created in 20260901000800.

-- -----------------------------------------------------------------------------
-- §6.9 menu_item_options — extras, sizes, modifiers
--
-- Group-level attributes (group_label, selection_type, group_min_select,
-- group_max_select, group_sort_order) are carried on EVERY row of a group and
-- kept identical by trg_menu_item_options_group_consistency (§7.8), so the
-- brief's single-table model holds without losing group semantics.
-- -----------------------------------------------------------------------------
CREATE TABLE public.menu_item_options (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id     UUID        NOT NULL,
  menu_item_id      UUID        NOT NULL,

  group_key         TEXT        NOT NULL DEFAULT 'extras',
  group_label       public.i18n_text NOT NULL,
  selection_type    public.option_selection_type NOT NULL DEFAULT 'multiple',
  group_min_select  SMALLINT    NOT NULL DEFAULT 0,
  group_max_select  SMALLINT,
  group_sort_order  INTEGER     NOT NULL DEFAULT 0,

  name              public.i18n_text NOT NULL,
  price_delta       public.money_minor NOT NULL DEFAULT 0,
  max_quantity      SMALLINT    NOT NULL DEFAULT 1,

  is_default        BOOLEAN     NOT NULL DEFAULT false,
  is_available      BOOLEAN     NOT NULL DEFAULT true,
  sort_order        INTEGER     NOT NULL DEFAULT 0,

  deleted_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT fk_menu_item_options_item
    FOREIGN KEY (restaurant_id, menu_item_id)
    REFERENCES public.menu_items (restaurant_id, id)
    ON DELETE CASCADE,

  CONSTRAINT uq_menu_item_options_tenant UNIQUE (restaurant_id, id),

  CONSTRAINT ck_menu_item_options_group_key_format
    CHECK (group_key ~ '^[a-z0-9_]{1,32}$'),

  CONSTRAINT ck_menu_item_options_min_select_range
    CHECK (group_min_select BETWEEN 0 AND 20),

  CONSTRAINT ck_menu_item_options_max_select_range
    CHECK (group_max_select IS NULL OR (group_max_select >= 1 AND group_max_select <= 20)),

  CONSTRAINT ck_menu_item_options_select_bounds
    CHECK (group_max_select IS NULL OR group_max_select >= group_min_select),

  CONSTRAINT ck_menu_item_options_single_select_bounds
    CHECK (selection_type <> 'single' OR (group_max_select = 1 AND max_quantity = 1)),

  CONSTRAINT ck_menu_item_options_max_quantity_range
    CHECK (max_quantity BETWEEN 1 AND 20),

  CONSTRAINT ck_menu_item_options_sort_order_non_negative
    CHECK (sort_order >= 0),

  CONSTRAINT ck_menu_item_options_group_sort_order_non_negative
    CHECK (group_sort_order >= 0)
);

-- §8.2: partial unique index declared with its table (spec emits it inline in §6.9).
CREATE UNIQUE INDEX uq_menu_item_options_single_default
  ON public.menu_item_options (menu_item_id, group_key)
  WHERE selection_type = 'single' AND is_default AND deleted_at IS NULL;

COMMENT ON TABLE  public.menu_item_options IS
  'Optional extras and required choices for a dish (brief §6, §12): "Extra cheese +5000", "Size: Small / Large". Group-level attributes (group_label, selection_type, min/max select) are replicated onto every row of a group and kept consistent by trg_menu_item_options_group_consistency, so the brief''s single-table model holds without losing group semantics.';
COMMENT ON COLUMN public.menu_item_options.group_key IS
  'Stable machine key that partitions the options of one dish into groups ("size", "extras", "sauce"). All rows sharing (menu_item_id, group_key) MUST agree on group_label, selection_type, group_min_select, group_max_select and group_sort_order.';
COMMENT ON COLUMN public.menu_item_options.selection_type IS
  'single = radio group, the guest picks exactly one (a size); multiple = checkboxes (extras). ck_menu_item_options_single_select_bounds forces a single-select group to have group_max_select = 1 and max_quantity = 1, so "pick one size, twice" is unrepresentable.';
COMMENT ON COLUMN public.menu_item_options.group_min_select IS
  'Minimum options the guest must choose from this group. 1 makes the group mandatory (a size must be picked before ADD TO CART). Validated by the cart/order service, which reads it from any row of the group.';
COMMENT ON COLUMN public.menu_item_options.group_max_select IS
  'Maximum distinct options selectable from this group. NULL = unlimited (typical for extras).';
COMMENT ON COLUMN public.menu_item_options.price_delta IS
  'Price ADDED to the dish per single unit of this option, in MINOR CURRENCY UNITS (UZS: 5000 = 5 000 so''m). CHECK >= 0 via money_minor: options never reduce a price - a cheaper size is modelled as a lower base price on a separate item or as the zero-delta default of a single-select group.';
COMMENT ON COLUMN public.menu_item_options.max_quantity IS
  'How many of this one option may be attached to a single unit of the dish ("extra cheese x2"). 1 for the overwhelming majority; forced to 1 for single-select groups.';
COMMENT ON COLUMN public.menu_item_options.is_default IS
  'Pre-selected when the product sheet opens. uq_menu_item_options_single_default guarantees at most ONE default per single-select group, so a radio group can never open with two buttons lit.';
COMMENT ON COLUMN public.menu_item_options.is_available IS
  'Per-option 86-ing ("no bacon today") without hiding the dish. An unavailable option is rendered disabled, never removed, so the layout does not jump.';
