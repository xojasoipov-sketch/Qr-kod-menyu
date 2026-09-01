// src/types/database.ts
import type { I18nText, Locale } from '@/types/i18n';
import type { Money } from '@/lib/money';

/** PostgREST JSON scalar. */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

/* ------------------------------------------------------------------ */
/* Postgres enums (01 §4). Labels are binding.                         */
/* ------------------------------------------------------------------ */

/** public.app_role. SUPER_ADMIN is never stored in staff.role (ck_staff_no_super_admin). */
export type AppRole =
  | 'SUPER_ADMIN'
  | 'RESTAURANT_OWNER'
  | 'MANAGER'
  | 'WAITER'
  | 'KITCHEN';

/** Roles actually storable in public.staff.role. */
export type StaffRole = Exclude<AppRole, 'SUPER_ADMIN'>;

/** public.order_status. Declaration order is display order only — never compare with < or >. */
export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'completed'
  | 'cancelled';

/** public.order_type */
export type OrderType = 'dine_in' | 'takeaway';

/** public.order_channel */
export type OrderChannel = 'qr' | 'waiter' | 'admin';

/** public.dietary_tag */
export type DietaryTag =
  | 'vegetarian'
  | 'vegan'
  | 'halal'
  | 'gluten_free'
  | 'lactose_free'
  | 'nut_free'
  | 'contains_nuts'
  | 'contains_seafood'
  | 'contains_pork'
  | 'contains_alcohol';

/** public.waiter_call_reason */
export type WaiterCallReason =
  | 'call_waiter'
  | 'request_bill'
  | 'request_water'
  | 'request_cutlery'
  | 'clean_table'
  | 'complaint'
  | 'other';

/** public.waiter_call_status. pending + acknowledged are the two OPEN states. */
export type WaiterCallStatus =
  | 'pending'
  | 'acknowledged'
  | 'resolved'
  | 'cancelled'
  | 'expired';

/** public.actor_kind */
export type ActorKind = 'customer' | 'staff' | 'system';

/** public.option_selection_type */
export type OptionSelectionType = 'single' | 'multiple';

/** public.promotion_type */
export type PromotionType =
  | 'announcement'
  | 'percentage'
  | 'fixed_amount'
  | 'special_price';

/** public.notification_type */
export type NotificationType =
  | 'order_created'
  | 'order_confirmed'
  | 'order_preparing'
  | 'order_ready'
  | 'order_delivered'
  | 'order_completed'
  | 'order_cancelled'
  | 'order_late'
  | 'waiter_call_created'
  | 'waiter_call_acknowledged'
  | 'menu_item_unavailable'
  | 'system';

/** public.app_locale — identical to the UI Locale union by construction. */
export type AppLocale = Locale;

/* Runtime value arrays. The ONLY runtime exports in this file; used by zod z.enum(). */
export const APP_ROLES = [
  'SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN',
] as const satisfies readonly AppRole[];

export const STAFF_ROLES = [
  'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN',
] as const satisfies readonly StaffRole[];

export const ORDER_STATUSES = [
  'pending', 'confirmed', 'preparing', 'ready', 'delivered', 'completed', 'cancelled',
] as const satisfies readonly OrderStatus[];

export const ORDER_TYPES = ['dine_in', 'takeaway'] as const satisfies readonly OrderType[];

export const ORDER_CHANNELS = ['qr', 'waiter', 'admin'] as const satisfies readonly OrderChannel[];

export const DIETARY_TAGS = [
  'vegetarian', 'vegan', 'halal', 'gluten_free', 'lactose_free', 'nut_free',
  'contains_nuts', 'contains_seafood', 'contains_pork', 'contains_alcohol',
] as const satisfies readonly DietaryTag[];

export const WAITER_CALL_REASONS = [
  'call_waiter', 'request_bill', 'request_water', 'request_cutlery',
  'clean_table', 'complaint', 'other',
] as const satisfies readonly WaiterCallReason[];

export const WAITER_CALL_STATUSES = [
  'pending', 'acknowledged', 'resolved', 'cancelled', 'expired',
] as const satisfies readonly WaiterCallStatus[];

export const OPTION_SELECTION_TYPES = [
  'single', 'multiple',
] as const satisfies readonly OptionSelectionType[];

export const PROMOTION_TYPES = [
  'announcement', 'percentage', 'fixed_amount', 'special_price',
] as const satisfies readonly PromotionType[];

export const NOTIFICATION_TYPES = [
  'order_created', 'order_confirmed', 'order_preparing', 'order_ready',
  'order_delivered', 'order_completed', 'order_cancelled', 'order_late',
  'waiter_call_created', 'waiter_call_acknowledged', 'menu_item_unavailable', 'system',
] as const satisfies readonly NotificationType[];

/* ------------------------------------------------------------------ */
/* Shape helpers                                                       */
/* ------------------------------------------------------------------ */

/** Columns the caller must supply on INSERT; everything else is defaulted or nullable. */
export type Insertable<TRow, TRequired extends keyof TRow> =
  Pick<TRow, TRequired> & Partial<Omit<TRow, TRequired>>;

/** UPDATE payload: everything optional except the columns no client may ever rewrite. */
export type Updatable<TRow, TImmutable extends keyof TRow = never> =
  Partial<Omit<TRow, TImmutable | 'id' | 'created_at'>>;

/** Columns the database computes and no client may write. */
type Computed = 'total' | 'total_per_unit';

/* ------------------------------------------------------------------ */
/* 6.1 restaurants                                                     */
/* ------------------------------------------------------------------ */

export type RestaurantRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  logo_path: string | null;
  cover_image_url: string | null;
  phone: string | null;
  email: string | null;
  welcome_message: I18nText | null;
  description: I18nText | null;
  default_locale: AppLocale;
  /** CHAR(3), ISO-4217, e.g. 'UZS'. */
  currency: string;
  /** 0 for UZS, 2 for USD/EUR. Drives every formatMoney call for this tenant. */
  currency_decimals: number;
  /** Basis points: 10000 = 100.00%. */
  service_fee_bps: number;
  service_fee_enabled: boolean;
  settings: Json;
  is_active: boolean;
  is_demo: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type RestaurantInsert = Insertable<RestaurantRow, 'name' | 'slug'>;
export type RestaurantUpdate = Updatable<RestaurantRow, 'slug'>;

/* ------------------------------------------------------------------ */
/* 6.2 branches                                                        */
/* ------------------------------------------------------------------ */

export type BranchRow = {
  id: string;
  restaurant_id: string;
  name: string;
  /** ^[A-Z][A-Z0-9]{0,3}$ — the prefix of order_number, e.g. 'C' in 'C-014'. */
  code: string;
  address: string | null;
  phone: string | null;
  /** IANA zone, default 'Asia/Tashkent'. Business date and KDS clocks use it. */
  timezone: string;
  /** NUMERIC(9,6) — PostgREST returns a string. */
  latitude: string | null;
  longitude: string | null;
  /** NULL = inherit restaurants.service_fee_bps. */
  service_fee_bps: number | null;
  opening_hours: Json;
  waiter_call_cooldown_seconds: number;
  waiter_call_expiry_minutes: number;
  order_min_interval_seconds: number;
  default_prep_minutes: number;
  late_order_threshold_minutes: number;
  is_active: boolean;
  is_accepting_orders: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type BranchInsert = Insertable<BranchRow, 'restaurant_id' | 'name' | 'code'>;
export type BranchUpdate = Updatable<BranchRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.3 profiles                                                        */
/* ------------------------------------------------------------------ */

export type ProfileRow = {
  /** Equals auth.users.id. Not defaulted. */
  id: string;
  email: string | null;
  full_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  avatar_path: string | null;
  locale: AppLocale;
  /** Platform admin. This, not staff.role, is what SUPER_ADMIN means. */
  is_platform_admin: boolean;
  is_active: boolean;
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}
export type ProfileInsert = Insertable<ProfileRow, 'id'>;
export type ProfileUpdate = Updatable<ProfileRow, 'is_platform_admin'>;

/* ------------------------------------------------------------------ */
/* 6.4 staff                                                           */
/* ------------------------------------------------------------------ */

export type StaffRow = {
  id: string;
  restaurant_id: string;
  /** NULL for RESTAURANT_OWNER and restaurant-wide MANAGER; NOT NULL for WAITER/KITCHEN. */
  branch_id: string | null;
  profile_id: string;
  role: StaffRole;
  permissions: Json;
  display_name: string | null;
  employee_code: string | null;
  is_active: boolean;
  invited_at: string | null;
  joined_at: string | null;
  created_at: string;
  updated_at: string;
}
export type StaffInsert = Insertable<StaffRow, 'restaurant_id' | 'profile_id' | 'role'>;
export type StaffUpdate = Updatable<StaffRow, 'restaurant_id' | 'profile_id'>;

/* ------------------------------------------------------------------ */
/* 6.5 tables                                                          */
/* ------------------------------------------------------------------ */

export type TableRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  /** Human label, e.g. '12' or 'A3'. */
  number: string;
  name: string | null;
  zone: string | null;
  seats: number | null;
  sort_order: number;
  /** 144-bit base64url capability. NEVER sent to a staff list view; only to the QR generator. */
  qr_token: string;
  qr_token_issued_at: string;
  qr_rotation_count: number;
  is_active: boolean;
  /** REQUIRED ADDITION §1.2 — per-table order cooldown clock. */
  last_order_at: string | null;
  /** REQUIRED ADDITION §1.2 — per-table waiter-call cooldown clock. */
  last_waiter_call_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type TableInsert = Insertable<TableRow, 'restaurant_id' | 'branch_id' | 'number'>;
/** qr_token is rotated only by admin_rotate_table_token(); never by a direct UPDATE. */
export type TableUpdate = Updatable<
  TableRow,
  'restaurant_id' | 'branch_id' | 'qr_token' | 'qr_token_issued_at' | 'qr_rotation_count'
  | 'last_order_at' | 'last_waiter_call_at'
>;

/* ------------------------------------------------------------------ */
/* 6.6 qr_token_history                                                */
/* ------------------------------------------------------------------ */

export type QrTokenHistoryRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  token: string;
  issued_at: string;
  revoked_at: string;
  revoked_by: string | null;
  revoke_reason: string | null;
  created_at: string;
  updated_at: string;
}
/** Written only by admin_rotate_table_token(); no client Insert/Update type is exported. */

/* ------------------------------------------------------------------ */
/* 6.7 menu_categories                                                 */
/* ------------------------------------------------------------------ */

export type MenuCategoryRow = {
  id: string;
  restaurant_id: string;
  /** NULL = the category belongs to every branch of the restaurant. */
  branch_id: string | null;
  name: I18nText;
  description: I18nText | null;
  image_url: string | null;
  image_path: string | null;
  /** lucide icon slug, ^[a-z0-9-]{1,40}$. */
  icon: string | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type MenuCategoryInsert = Insertable<MenuCategoryRow, 'restaurant_id' | 'name'>;
export type MenuCategoryUpdate = Updatable<MenuCategoryRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.8 menu_items                                                      */
/* ------------------------------------------------------------------ */

export type MenuItemRow = {
  id: string;
  restaurant_id: string;
  /** NULL = available at every branch. */
  branch_id: string | null;
  category_id: string;
  name: I18nText;
  description: I18nText | null;
  ingredients: I18nText | null;
  /** BIGINT minor units. */
  price: Money;
  /** Strike-through "was" price; must be > price when present. */
  compare_at_price: Money | null;
  image_url: string | null;
  image_path: string | null;
  /** 0 none · 1 mild · 2 medium · 3 hot. */
  spicy_level: number;
  /** Minutes, 1..240. */
  preparation_time: number;
  calories: number | null;
  dietary_tags: DietaryTag[];
  is_available: boolean;
  unavailable_until: string | null;
  /** TIME 'HH:MM:SS' daypart window. */
  available_from: string | null;
  available_until: string | null;
  is_featured: boolean;
  is_popular: boolean;
  popularity_score: number;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  // search_vector is intentionally absent: tsvector, generated, never selected.
}
export type MenuItemInsert = Insertable<
  MenuItemRow, 'restaurant_id' | 'category_id' | 'name' | 'price'
>;
export type MenuItemUpdate = Updatable<MenuItemRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.9 menu_item_options                                               */
/* ------------------------------------------------------------------ */

export type MenuItemOptionRow = {
  id: string;
  restaurant_id: string;
  menu_item_id: string;
  /** Group discriminator, ^[a-z0-9_]{1,32}$, e.g. 'size', 'extras'. */
  group_key: string;
  group_label: I18nText;
  selection_type: OptionSelectionType;
  /** >= 1 means the group is REQUIRED (this replaces doc 02's is_required). */
  group_min_select: number;
  /** NULL = unbounded (this replaces doc 02's max_select). */
  group_max_select: number | null;
  group_sort_order: number;
  name: I18nText;
  /** Added to the item price, minor units. Never negative. */
  price_delta: Money;
  max_quantity: number;
  is_default: boolean;
  is_available: boolean;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type MenuItemOptionInsert = Insertable<
  MenuItemOptionRow, 'restaurant_id' | 'menu_item_id' | 'group_label' | 'name'
>;
export type MenuItemOptionUpdate = Updatable<
  MenuItemOptionRow, 'restaurant_id' | 'menu_item_id'
>;

/* ------------------------------------------------------------------ */
/* 6.10 promotions                                                     */
/* ------------------------------------------------------------------ */

export type PromotionRow = {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  promo_type: PromotionType;
  title: I18nText;
  description: I18nText | null;
  badge_label: I18nText | null;
  image_url: string | null;
  image_path: string | null;
  discount_bps: number | null;
  discount_amount: Money | null;
  special_price: Money | null;
  starts_at: string;
  ends_at: string | null;
  sort_order: number;
  is_active: boolean;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}
export type PromotionInsert = Insertable<PromotionRow, 'restaurant_id' | 'title'>;
export type PromotionUpdate = Updatable<PromotionRow, 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* 6.11 promotion_items                                                */
/* ------------------------------------------------------------------ */

export type PromotionItemRow = {
  id: string;
  restaurant_id: string;
  promotion_id: string;
  menu_item_id: string;
  created_at: string;
  updated_at: string;
}
export type PromotionItemInsert = Insertable<
  PromotionItemRow, 'restaurant_id' | 'promotion_id' | 'menu_item_id'
>;

/* ------------------------------------------------------------------ */
/* 6.12 branch_order_counters                                          */
/* ------------------------------------------------------------------ */

/** No id column. PK is (branch_id, business_date). Written only by the order-number trigger. */
export type BranchOrderCounterRow = {
  branch_id: string;
  /** 'YYYY-MM-DD' in the branch timezone. */
  business_date: string;
  last_number: number;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* 6.13 orders                                                         */
/* ------------------------------------------------------------------ */

export type OrderRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  /** NULL only for order_type='takeaway'. */
  table_id: string | null;
  /** Customer tracking capability. 12 chars / 72 bits. Never orders.id in a URL. */
  public_code: string;
  /** Human-friendly, e.g. 'C-014'. Unique per (branch, business_date). */
  order_number: string;
  order_seq: number;
  business_date: string;
  order_type: OrderType;
  channel: OrderChannel;
  status: OrderStatus;
  /** Anonymous browser session; required when channel='qr'. */
  customer_session_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  /** The order-level note ("No onion"). Doc 02 calls this orders.note — see §1.1. */
  customer_note: string | null;
  guest_count: number | null;
  locale: AppLocale;
  /** Frozen at placement so an historical receipt never re-renders in a new currency. */
  currency: string;
  currency_decimals: number;
  subtotal: Money;
  discount_total: Money;
  service_fee: Money;
  service_fee_bps: number;
  /** Always subtotal - discount_total + service_fee (ck_orders_totals_arithmetic). */
  total: Money;
  estimated_prep_minutes: number;
  due_at: string | null;
  placed_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  confirmed_by_staff_id: string | null;
  served_by_staff_id: string | null;
  cancelled_by_staff_id: string | null;
  /** REQUIRED ADDITION §1.2 — idempotency key, one per cart. */
  client_request_id: string | null;
  /** REQUIRED ADDITION §1.2 — normalised payload hash for the duplicate guard. */
  payload_fingerprint: string | null;
  created_at: string;
  updated_at: string;
}
/**
 * No OrderInsert is exported. Orders are created ONLY by public_place_order() /
 * staff_place_order(). A direct client INSERT into orders is a bug and is refused by RLS.
 */
export type OrderStatusUpdate = Pick<OrderRow, 'status'> &
  Partial<Pick<OrderRow, 'cancellation_reason'>>;

/* ------------------------------------------------------------------ */
/* 6.14 order_items                                                    */
/* ------------------------------------------------------------------ */

export type OrderItemRow = {
  id: string;
  restaurant_id: string;
  order_id: string;
  /** NULL once the menu item is deleted — the snapshots below are why that is safe. */
  menu_item_id: string | null;
  name_snapshot: I18nText;
  description_snapshot: I18nText | null;
  category_name_snapshot: I18nText | null;
  image_url_snapshot: string | null;
  /** Unit price at placement time. Minor units. */
  price_snapshot: Money;
  spicy_level_snapshot: number;
  preparation_time_snapshot: number;
  dietary_tags_snapshot: DietaryTag[];
  quantity: number;
  /** Per-unit sum of chosen option deltas. */
  options_total: Money;
  /** GENERATED: quantity * (price_snapshot + options_total). Read-only. */
  total: Money;
  note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type OrderItemInsert = Omit<
  Insertable<OrderItemRow, 'restaurant_id' | 'order_id' | 'name_snapshot' | 'price_snapshot' | 'quantity'>,
  Computed
>;

/* ------------------------------------------------------------------ */
/* 6.15 order_item_options                                             */
/* ------------------------------------------------------------------ */

export type OrderItemOptionRow = {
  id: string;
  restaurant_id: string;
  order_id: string;
  order_item_id: string;
  menu_item_option_id: string | null;
  group_key_snapshot: string;
  group_label_snapshot: I18nText;
  name_snapshot: I18nText;
  price_delta_snapshot: Money;
  quantity: number;
  /** GENERATED: quantity * price_delta_snapshot. Read-only. */
  total_per_unit: Money;
  sort_order: number;
  created_at: string;
  updated_at: string;
}
export type OrderItemOptionInsert = Omit<
  Insertable<
    OrderItemOptionRow,
    'restaurant_id' | 'order_id' | 'order_item_id' | 'group_key_snapshot'
    | 'group_label_snapshot' | 'name_snapshot' | 'price_delta_snapshot'
  >,
  Computed
>;

/* ------------------------------------------------------------------ */
/* 6.16 order_status_history                                           */
/* ------------------------------------------------------------------ */

export type OrderStatusHistoryRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  order_id: string;
  /** NULL only for the very first row (order creation). */
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  /** profiles.id of the staff member; NULL for customer and system actors. */
  changed_by: string | null;
  changed_by_kind: ActorKind;
  /** NOT NULL when changed_by_kind='staff'; NULL for customer. */
  changed_by_role: AppRole | null;
  note: string | null;
  created_at: string;
  updated_at: string;
}
/** Append-only, written by trg_orders_write_history(). No Insert type is exported. */

/* ------------------------------------------------------------------ */
/* 6.17 waiter_calls                                                   */
/* ------------------------------------------------------------------ */

export type WaiterCallRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  order_id: string | null;
  reason: WaiterCallReason;
  status: WaiterCallStatus;
  note: string | null;
  customer_session_id: string | null;
  acknowledged_at: string | null;
  acknowledged_by_staff_id: string | null;
  resolved_at: string | null;
  resolved_by_staff_id: string | null;
  created_at: string;
  updated_at: string;
}
/** Created only by public_call_waiter(). Staff may only advance status. */
export type WaiterCallUpdate = Pick<WaiterCallRow, 'status'>;

/* ------------------------------------------------------------------ */
/* 6.18 notifications                                                  */
/* ------------------------------------------------------------------ */

export type NotificationRow = {
  id: string;
  restaurant_id: string;
  branch_id: string;
  /** Addressed to a role OR to one staff member; at least one is non-null. */
  target_role: StaffRole | null;
  target_staff_id: string | null;
  /** Doc 02 calls this column `kind` — see §1.1. */
  type: NotificationType;
  /** Rendered text is NOT stored; the client localises from type + payload. */
  payload: Json;
  /** 0 low · 1 normal · 2 urgent. */
  priority: number;
  order_id: string | null;
  waiter_call_id: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* 6.19 notification_reads                                             */
/* ------------------------------------------------------------------ */

/** Junction with a natural PK (notification_id, staff_id). No id column. */
export type NotificationReadRow = {
  notification_id: string;
  staff_id: string;
  restaurant_id: string;
  read_at: string;
  created_at: string;
  updated_at: string;
}
export type NotificationReadInsert =
  Pick<NotificationReadRow, 'notification_id' | 'staff_id' | 'restaurant_id'>;

/* ------------------------------------------------------------------ */
/* The Database interface for createClient<Database>()                 */
/* ------------------------------------------------------------------ */

export type Database = {
  public: {
    Tables: {
      restaurants:           { Row: RestaurantRow;        Insert: RestaurantInsert;        Update: RestaurantUpdate; Relationships: [] };
      branches:              { Row: BranchRow;            Insert: BranchInsert;            Update: BranchUpdate; Relationships: [] };
      profiles:              { Row: ProfileRow;           Insert: ProfileInsert;           Update: ProfileUpdate; Relationships: [] };
      staff:                 { Row: StaffRow;             Insert: StaffInsert;             Update: StaffUpdate; Relationships: [] };
      tables:                { Row: TableRow;             Insert: TableInsert;             Update: TableUpdate; Relationships: [] };
      qr_token_history:      { Row: QrTokenHistoryRow;    Insert: never;                   Update: never; Relationships: [] };
      menu_categories:       { Row: MenuCategoryRow;      Insert: MenuCategoryInsert;      Update: MenuCategoryUpdate; Relationships: [] };
      menu_items:            { Row: MenuItemRow;          Insert: MenuItemInsert;          Update: MenuItemUpdate; Relationships: [] };
      menu_item_options:     { Row: MenuItemOptionRow;    Insert: MenuItemOptionInsert;    Update: MenuItemOptionUpdate; Relationships: [] };
      promotions:            { Row: PromotionRow;         Insert: PromotionInsert;         Update: PromotionUpdate; Relationships: [] };
      promotion_items:       { Row: PromotionItemRow;     Insert: PromotionItemInsert;     Update: never; Relationships: [] };
      branch_order_counters: { Row: BranchOrderCounterRow; Insert: never;                  Update: never; Relationships: [] };
      orders:                { Row: OrderRow;             Insert: never;                   Update: OrderStatusUpdate; Relationships: [] };
      order_items:           { Row: OrderItemRow;         Insert: OrderItemInsert;         Update: never; Relationships: [] };
      order_item_options:    { Row: OrderItemOptionRow;   Insert: OrderItemOptionInsert;   Update: never; Relationships: [] };
      order_status_history:  { Row: OrderStatusHistoryRow; Insert: never;                  Update: never; Relationships: [] };
      waiter_calls:          { Row: WaiterCallRow;        Insert: never;                   Update: WaiterCallUpdate; Relationships: [] };
      notifications:         { Row: NotificationRow;      Insert: never;                   Update: never; Relationships: [] };
      notification_reads:    { Row: NotificationReadRow;  Insert: NotificationReadInsert;  Update: never; Relationships: [] };
    };
    Views: Record<string, never>;
    Functions: {
      public_resolve_table:     { Args: { p_token: string }; Returns: Json };
      public_get_menu:          { Args: { p_token: string }; Returns: Json };
      public_place_order: {
        Args: {
          p_token: string;
          p_items: Json;
          p_note: string | null;
          p_client_request_id?: string;
        };
        Returns: Json;
      };
      public_get_order:         { Args: { p_token: string; p_order_public_id: string }; Returns: Json };
      public_cancel_order:      { Args: { p_token: string; p_order_public_id: string; p_reason: string }; Returns: Json };
      public_call_waiter:       { Args: { p_token: string; p_reason: string }; Returns: Json };
      admin_rotate_table_token: { Args: { p_table_id: string }; Returns: Json };
      staff_place_order:        { Args: { p_table_id: string; p_items: Json; p_note: string | null }; Returns: Json };
      staff_void_order_item:    { Args: { p_order_item_id: string; p_reason: string }; Returns: Json };
    };
    Enums: {
      app_role: AppRole;
      order_status: OrderStatus;
      order_type: OrderType;
      order_channel: OrderChannel;
      dietary_tag: DietaryTag;
      waiter_call_reason: WaiterCallReason;
      waiter_call_status: WaiterCallStatus;
      actor_kind: ActorKind;
      option_selection_type: OptionSelectionType;
      promotion_type: PromotionType;
      notification_type: NotificationType;
      app_locale: AppLocale;
    };
    CompositeTypes: Record<string, never>;
  };
}
