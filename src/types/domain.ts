// src/types/domain.ts
import type { Money } from '@/lib/money';
import type { I18nText, Locale } from '@/types/i18n';
import type {
  DietaryTag, OptionSelectionType, OrderChannel, OrderStatus, OrderType,
  StaffRole, WaiterCallReason, WaiterCallStatus,
} from '@/types/database';

/* ================================================================== */
/* TableContext — the result of resolving a QR token                   */
/* ================================================================== */

export interface TableContextRestaurant {
  name: string;
  slug: string;
  logoUrl: string | null;
  welcomeMessage: I18nText | null;
  /** ISO-4217, e.g. 'UZS'. */
  currency: string;
  /** 0 for UZS, 2 for USD. Every formatMoney call in this session uses it. */
  currencyDecimals: number;
  defaultLocale: Locale;
}

export interface TableContextBranch {
  name: string;
  /** IANA zone; all customer-facing times render in it. */
  timezone: string;
  serviceFeeEnabled: boolean;
  /** Basis points. 0 when disabled. */
  serviceFeeBps: number;
  isAcceptingOrders: boolean;
}

export interface TableContextTable {
  /** Human label shown as "Table 12". */
  number: string;
  name: string | null;
}

/**
 * Carries NO ids. The only identifier a customer ever holds is `token`.
 * Produced by mapPublicTableContext(); never constructed by hand in a component.
 */
export interface TableContext {
  token: string;
  restaurant: TableContextRestaurant;
  branch: TableContextBranch;
  table: TableContextTable;
  /** When this context was resolved; drives stale-context revalidation. */
  resolvedAt: string;
}

/* ================================================================== */
/* MenuTree                                                            */
/* ================================================================== */

export interface MenuOptionView {
  id: string;
  name: I18nText;
  priceDelta: Money;
  maxQuantity: number;
  isDefault: boolean;
  isAvailable: boolean;
  sortOrder: number;
}

export interface MenuOptionGroupView {
  groupKey: string;
  groupLabel: I18nText;
  selectionType: OptionSelectionType;
  minSelect: number;
  /** null = unbounded. */
  maxSelect: number | null;
  /** Derived: minSelect >= 1. */
  isRequired: boolean;
  sortOrder: number;
  options: MenuOptionView[];
}

export interface MenuItemView {
  id: string;
  categoryId: string;
  name: I18nText;
  description: I18nText | null;
  ingredients: I18nText | null;
  price: Money;
  compareAtPrice: Money | null;
  imageUrl: string | null;
  /** 0..3. */
  spicyLevel: number;
  /** Minutes. */
  preparationTime: number;
  calories: number | null;
  dietaryTags: DietaryTag[];
  /** false renders the card dimmed with the add button disabled — never hidden (brief §5). */
  isAvailable: boolean;
  isFeatured: boolean;
  isPopular: boolean;
  sortOrder: number;
  optionGroups: MenuOptionGroupView[];
}

export interface MenuCategoryView {
  id: string;
  name: I18nText;
  description: I18nText | null;
  imageUrl: string | null;
  icon: string | null;
  sortOrder: number;
  items: MenuItemView[];
  /** items.length; cached so a category chip does not walk the array. */
  itemCount: number;
  /** items.filter(i => i.isAvailable).length. */
  availableItemCount: number;
}

export interface PromotionView {
  id: string;
  title: I18nText;
  description: I18nText | null;
  badgeLabel: I18nText | null;
  imageUrl: string | null;
  sortOrder: number;
}

export interface MenuTree {
  context: TableContext;
  categories: MenuCategoryView[];
  promotions: PromotionView[];
  /** Flat index for search and for cart-line revalidation. Key is MenuItemView.id. */
  itemsById: Readonly<Record<string, MenuItemView>>;
  featuredItemIds: string[];
  popularItemIds: string[];
  generatedAt: string;
}

/* ================================================================== */
/* Cart — client-side only. Never a source of truth for price.         */
/* ================================================================== */

export interface CartLineOption {
  optionId: string;
  groupKey: string;
  name: I18nText;
  priceDelta: Money;
  quantity: number;
}

export interface CartLine {
  /** Client-generated line identity. Two lines of the same dish with different options coexist. */
  lineId: string;
  menuItemId: string;
  name: I18nText;
  imageUrl: string | null;
  /** Advisory copy of MenuItemView.price. The server re-reads the real price. */
  unitPrice: Money;
  options: CartLineOption[];
  /** Per-unit sum of option deltas. */
  optionsTotal: Money;
  quantity: number;
  note: string | null;
  /** Advisory: quantity * (unitPrice + optionsTotal). */
  lineTotal: Money;
  /** Last-known availability; refreshed on every menu load. false blocks checkout. */
  isAvailable: boolean;
  spicyLevel: number;
  addedAt: string;
}

export interface CartTotals {
  subtotal: Money;
  serviceFee: Money;
  discountTotal: Money;
  total: Money;
}

export interface CartState {
  /** The QR token this cart belongs to. A cart never survives a change of table. */
  token: string;
  restaurantSlug: string;
  currency: string;
  currencyDecimals: number;
  serviceFeeEnabled: boolean;
  serviceFeeBps: number;
  lines: CartLine[];
  /** Sum of line quantities — the badge on the cart button. */
  itemCount: number;
  /** Advisory preview from src/lib/orders/pricing.ts. NOT authoritative. */
  totals: CartTotals;
  /** Order-level note, max 280 chars. */
  note: string | null;
  /** v4 UUID, generated once per cart, reused on every retry. The idempotency key. */
  clientRequestId: string;
  locale: Locale;
  updatedAt: string;
}

/* ================================================================== */
/* Orders — customer tracking view                                     */
/* ================================================================== */

export interface OrderLineOptionView {
  name: I18nText;
  priceDelta: Money;
  quantity: number;
}

export interface OrderLineView {
  id: string;
  name: I18nText;
  description: I18nText | null;
  imageUrl: string | null;
  /** price_snapshot. */
  unitPrice: Money;
  quantity: number;
  optionsTotal: Money;
  /** Generated by the DB: quantity * (unitPrice + optionsTotal). */
  lineTotal: Money;
  note: string | null;
  spicyLevel: number;
  options: OrderLineOptionView[];
}

export interface OrderStatusEvent {
  status: OrderStatus;
  at: string;
}

export interface OrderView {
  /** Human-friendly, e.g. 'C-014'. */
  orderNumber: string;
  /** The tracking capability. This, never orders.id, appears in a URL. */
  publicCode: string;
  /** '/t/<qrToken>/order/<publicCode>'. */
  trackingPath: string;
  status: OrderStatus;
  /** Position on the forward path, 0..5; -1 for cancelled. Drives the tracker stepper. */
  statusIndex: number;
  isTerminal: boolean;
  orderType: OrderType;
  channel: OrderChannel;
  tableNumber: string | null;
  tableName: string | null;
  currency: string;
  currencyDecimals: number;
  subtotal: Money;
  discountTotal: Money;
  serviceFee: Money;
  total: Money;
  note: string | null;
  guestCount: number | null;
  estimatedPrepMinutes: number;
  dueAt: string | null;
  placedAt: string;
  confirmedAt: string | null;
  readyAt: string | null;
  deliveredAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: string | null;
  lines: OrderLineView[];
  history: OrderStatusEvent[];
}

/* ================================================================== */
/* KitchenTicket — the KDS card                                        */
/* ================================================================== */

export interface KitchenTicketLine {
  id: string;
  name: I18nText;
  quantity: number;
  note: string | null;
  spicyLevel: number;
  preparationTime: number;
  /** Rendered as a compact second line under the dish name. */
  options: OrderLineOptionView[];
}

export interface KitchenTicket {
  orderId: string;
  orderNumber: string;
  publicCode: string;
  branchId: string;
  tableNumber: string | null;
  tableName: string | null;
  status: OrderStatus;
  channel: OrderChannel;
  placedAt: string;
  confirmedAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  /** now - placedAt, recomputed client-side on a 1s tick. */
  ageSeconds: number;
  estimatedPrepMinutes: number;
  dueAt: string | null;
  /** ageSeconds > branches.late_order_threshold_minutes * 60. Flags the card red (brief §9). */
  isLate: boolean;
  lateBySeconds: number;
  customerNote: string | null;
  guestCount: number | null;
  lines: KitchenTicketLine[];
  /** Sum of line quantities — the big number on the card. */
  itemCount: number;
}

/* ================================================================== */
/* WaiterCallView                                                      */
/* ================================================================== */

export interface WaiterCallView {
  id: string;
  branchId: string;
  tableId: string;
  tableNumber: string;
  tableName: string | null;
  reason: WaiterCallReason;
  status: WaiterCallStatus;
  /** true for 'pending' and 'acknowledged'. */
  isOpen: boolean;
  note: string | null;
  createdAt: string;
  /** now - createdAt, recomputed on a 1s tick. */
  ageSeconds: number;
  acknowledgedAt: string | null;
  acknowledgedByStaffId: string | null;
  acknowledgedByName: string | null;
  resolvedAt: string | null;
  resolvedByStaffId: string | null;
  /** Set when the guest raised the call from an order-tracking screen. */
  orderId: string | null;
  orderNumber: string | null;
}

/* ================================================================== */
/* DashboardStats — brief §11, real data only                          */
/* ================================================================== */

export interface DashboardTopItem {
  menuItemId: string | null;
  name: I18nText;
  quantitySold: number;
  revenue: Money;
}

export interface DashboardStats {
  /** Scope of every number below. */
  restaurantId: string;
  branchId: string | null;
  /** 'YYYY-MM-DD' in the branch timezone. */
  businessDate: string;
  timezone: string;
  currency: string;
  currencyDecimals: number;
  /** Sum of orders.total for the business date, excluding cancelled. */
  todayRevenue: Money;
  /** Count of orders placed on the business date, excluding cancelled. */
  todayOrderCount: number;
  /** todayRevenue / todayOrderCount, integer division; 0 when no orders. */
  averageOrderValue: Money;
  /** Tables with at least one non-terminal order right now. */
  activeTableCount: number;
  totalTableCount: number;
  pendingOrderCount: number;
  /** Non-terminal orders past their late threshold. */
  lateOrderCount: number;
  openWaiterCallCount: number;
  /** Every OrderStatus key present, zero-filled. */
  ordersByStatus: Readonly<Record<OrderStatus, number>>;
  /** Top 5 by quantitySold on the business date. */
  topItems: DashboardTopItem[];
  cancelledOrderCount: number;
  cancelledRevenue: Money;
  /** True when the scope contains demo tenants; the UI shows a DEMO DATA banner (brief §11). */
  isDemo: boolean;
  generatedAt: string;
}

/* ================================================================== */
/* Staff session — who is looking at an admin screen                   */
/* ================================================================== */

export interface StaffSession {
  profileId: string;
  staffId: string;
  restaurantId: string;
  /** null for RESTAURANT_OWNER and restaurant-wide MANAGER. */
  branchId: string | null;
  role: StaffRole;
  isPlatformAdmin: boolean;
  displayName: string;
  email: string | null;
  avatarUrl: string | null;
  locale: Locale;
}
