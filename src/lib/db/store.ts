import {
  Restaurant,
  Branch,
  Table,
  Staff,
  MenuCategory,
  MenuItem,
  Order,
  OrderItem,
  OrderStatusHistory,
  WaiterCall,
  TableResolution,
  OrderStatus,
  SelectedOption,
  UploadRecord,
  NotificationLog,
  UserRole,
} from '@/types/database';
import type { Analytics, PopularDish } from '../api';
import { assertValidTransition, STATUS_DISPLAY_INFO } from '../order-state-machine';
import { eventBus, RealtimeEventType } from '../realtime/event-bus';
import { nanoid } from 'nanoid';
import { query, withTransaction } from './pg';

/**
 * Stolga oid amallar natijasi — istisno tashlamaydi, doim natija qaytaradi.
 * Muvaffaqiyatsizlikda `forbidden` — bu ruxsat (403) xatosimi yoki holat (409) xatosimi ekanini
 * chaqiruvchi (API route) alohida, eskirib qolishi mumkin bo'lgan oldindan o'qishsiz aniqlay olishi
 * uchun — qulflangan tranzaksiya ichida, xato aniq shu yerda yuzaga kelgan paytda belgilanadi.
 */
export type TableActionResult =
  | { ok: true; table: Table }
  | { ok: false; error: string; forbidden?: boolean };

/** Buyurtmaga oid amallar natijasi — istisno tashlamaydi, doim natija qaytaradi. */
export type OrderActionResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

/** Hali yakunlanmagan (stol band hisoblanadigan) buyurtma holatlari. */
const UNFINISHED_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready'];

// ==========================================
// RAW ROW SHAPES (mos jadval ustunlari)
// ==========================================

interface RestaurantRow {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
  banner_url: string | null;
  tagline: string | null;
  currency: string;
  currency_symbol: string;
  service_fee_percentage: number;
  phone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface BranchRow {
  id: string;
  restaurant_id: string;
  name: string;
  address: string;
  phone: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface StaffRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  user_id: string;
  name: string;
  email: string;
  phone: string | null;
  pin: string | null;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface TableRow {
  id: string;
  branch_id: string;
  name: string;
  number: number;
  qr_token: string;
  capacity: number | null;
  zone: string | null;
  is_active: boolean;
  claimed_by: string | null;
  claimed_by_name: string | null;
  claimed_at: string | null;
  guest_count: number | null;
  created_at: string;
  updated_at: string;
}

interface CategoryRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  name: string;
  slug: string;
  icon: string | null;
  image_url: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface MenuItemRow {
  id: string;
  restaurant_id: string;
  branch_id: string | null;
  category_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  ingredients: string[] | null;
  dietary_flags: MenuItem['dietary_flags'] | null;
  spicy_level: number;
  preparation_time: number;
  is_available: boolean;
  is_featured: boolean | null;
  option_groups: MenuItem['option_groups'] | null;
  created_at: string;
  updated_at: string;
}

interface OrderRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  order_number: string;
  status: OrderStatus;
  subtotal: number;
  service_fee: number;
  total: number;
  customer_notes: string | null;
  waiter_id: string | null;
  waiter_name: string | null;
  accepted_at: string | null;
  rejection_reason: string | null;
  table_name: string | null;
  table_number: number | null;
  created_at: string;
  updated_at: string;
}

interface OrderItemRow {
  id: string;
  order_id: string;
  menu_item_id: string;
  name_snapshot: string;
  price_snapshot: number;
  quantity: number;
  selected_options: SelectedOption[] | null;
  notes: string | null;
  total: number;
  created_at: string;
}

interface OrderStatusHistoryRow {
  id: string;
  order_id: string;
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by: string;
  reason: string | null;
  created_at: string;
}

interface WaiterCallRow {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  table_number: number;
  table_name: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED';
  call_type: 'SERVICE' | 'BILL' | 'ASSISTANCE';
  created_at: string;
  acknowledged_at: string | null;
}

interface UploadMetaRow {
  id: string;
  content_type: string;
  size: number;
  created_at: string;
}

interface UploadRow extends UploadMetaRow {
  bytes: Buffer;
}

interface NotificationRow {
  id: string;
  channel: NotificationLog['channel'];
  to: string;
  subject: string;
  body: string;
  status: NotificationLog['status'];
  error: string | null;
  created_at: string;
}

// ==========================================
// MAPPERS (DB qatori -> ilova turi)
// ==========================================

function orUndef<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

function mapRestaurant(row: RestaurantRow): Restaurant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logo_url: row.logo_url,
    banner_url: orUndef(row.banner_url),
    tagline: orUndef(row.tagline),
    currency: row.currency,
    currency_symbol: row.currency_symbol,
    service_fee_percentage: row.service_fee_percentage,
    phone: row.phone,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    name: row.name,
    address: row.address,
    phone: row.phone,
    timezone: row.timezone,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapStaff(row: StaffRow): Staff {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    branch_id: orUndef(row.branch_id),
    user_id: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role,
    phone: orUndef(row.phone),
    pin: orUndef(row.pin),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapTable(row: TableRow): Table {
  return {
    id: row.id,
    branch_id: row.branch_id,
    name: row.name,
    number: row.number,
    qr_token: row.qr_token,
    capacity: orUndef(row.capacity),
    zone: orUndef(row.zone),
    is_active: row.is_active,
    claimed_by: orUndef(row.claimed_by),
    claimed_by_name: orUndef(row.claimed_by_name),
    claimed_at: orUndef(row.claimed_at),
    guest_count: orUndef(row.guest_count),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapCategory(row: CategoryRow): MenuCategory {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    branch_id: orUndef(row.branch_id),
    name: row.name,
    slug: row.slug,
    icon: orUndef(row.icon),
    image_url: orUndef(row.image_url),
    sort_order: row.sort_order,
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    branch_id: orUndef(row.branch_id),
    category_id: row.category_id,
    name: row.name,
    description: row.description,
    price: row.price,
    image_url: row.image_url,
    ingredients: row.ingredients ?? [],
    dietary_flags: orUndef(row.dietary_flags),
    spicy_level: row.spicy_level,
    preparation_time: row.preparation_time,
    is_available: row.is_available,
    is_featured: orUndef(row.is_featured),
    option_groups: orUndef(row.option_groups),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapOrderItem(row: OrderItemRow): OrderItem {
  return {
    id: row.id,
    order_id: row.order_id,
    menu_item_id: row.menu_item_id,
    name_snapshot: row.name_snapshot,
    price_snapshot: row.price_snapshot,
    quantity: row.quantity,
    selected_options: orUndef(row.selected_options),
    notes: orUndef(row.notes),
    total: row.total,
    created_at: row.created_at,
  };
}

function mapOrder(row: OrderRow, items: OrderItem[]): Order {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    branch_id: row.branch_id,
    table_id: row.table_id,
    order_number: row.order_number,
    status: row.status,
    subtotal: row.subtotal,
    service_fee: row.service_fee,
    total: row.total,
    customer_notes: orUndef(row.customer_notes),
    items,
    table_name: orUndef(row.table_name),
    table_number: orUndef(row.table_number),
    waiter_id: orUndef(row.waiter_id),
    waiter_name: orUndef(row.waiter_name),
    accepted_at: orUndef(row.accepted_at),
    rejection_reason: orUndef(row.rejection_reason),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function mapOrderStatusHistory(row: OrderStatusHistoryRow): OrderStatusHistory {
  return {
    id: row.id,
    order_id: row.order_id,
    previous_status: row.previous_status,
    new_status: row.new_status,
    changed_by: row.changed_by,
    reason: orUndef(row.reason),
    created_at: row.created_at,
  };
}

function mapWaiterCall(row: WaiterCallRow): WaiterCall {
  return {
    id: row.id,
    restaurant_id: row.restaurant_id,
    branch_id: row.branch_id,
    table_id: row.table_id,
    table_number: row.table_number,
    table_name: row.table_name,
    status: row.status,
    call_type: row.call_type,
    created_at: row.created_at,
    acknowledged_at: orUndef(row.acknowledged_at),
  };
}

function mapUpload(row: UploadMetaRow): UploadRecord {
  return { id: row.id, content_type: row.content_type, size: row.size, created_at: row.created_at };
}

function mapNotification(row: NotificationRow): NotificationLog {
  return {
    id: row.id,
    channel: row.channel,
    to: row.to,
    subject: row.subject,
    body: row.body,
    status: row.status,
    error: orUndef(row.error),
    created_at: row.created_at,
  };
}

// ==========================================
// HELPERS
// ==========================================

function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}

/** Hech kimga biriktirilmagan tasodifiy 4 xonali PIN kod hosil qiladi (restoran doirasida). */
async function generateUniquePin(restaurantId: string): Promise<string> {
  const takenRes = await query<{ pin: string }>(
    'SELECT pin FROM rest_staff WHERE restaurant_id = $1 AND pin IS NOT NULL',
    [restaurantId]
  );
  const taken = new Set(takenRes.rows.map((r) => r.pin));
  for (let attempt = 0; attempt < 10000; attempt++) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    if (!taken.has(candidate)) return candidate;
  }
  // Deyarli imkonsiz holat: bo'sh qolgan birinchi kodni ketma-ket qidiramiz.
  for (let n = 1000; n <= 9999; n++) {
    const candidate = String(n);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("Bo'sh PIN kod qolmadi.");
}

/** Buyurtmalarni items bilan birga oladi (N+1 querydan qochish uchun bitta qo'shimcha so'rov). */
async function fetchOrdersWithItems(whereClause: string, params: unknown[]): Promise<Order[]> {
  const ordersRes = await query<OrderRow>(`SELECT * FROM rest_orders WHERE ${whereClause}`, params);
  if (ordersRes.rows.length === 0) return [];
  const ids = ordersRes.rows.map((r) => r.id);
  const itemsRes = await query<OrderItemRow>(
    'SELECT * FROM rest_order_items WHERE order_id = ANY($1::text[])',
    [ids]
  );
  const itemsByOrder = new Map<string, OrderItem[]>();
  for (const itemRow of itemsRes.rows) {
    const oi = mapOrderItem(itemRow);
    const list = itemsByOrder.get(oi.order_id);
    if (list) list.push(oi);
    else itemsByOrder.set(oi.order_id, [oi]);
  }
  return ordersRes.rows.map((row) => mapOrder(row, itemsByOrder.get(row.id) || []));
}

function emitOrderStaffEvent(
  type: Extract<RealtimeEventType, 'ORDER_ACCEPTED' | 'ORDER_REJECTED'>,
  order: Order,
  staff: { id: string; name: string },
  timestamp: string,
  reason?: string
) {
  eventBus.emit({
    type,
    timestamp,
    restaurant_id: order.restaurant_id,
    branch_id: order.branch_id,
    order,
    orderId: order.id,
    newStatus: order.status,
    tableId: order.table_id,
    staffId: staff.id,
    staffName: staff.name,
    reason,
  });
}

// --- Partial-update helper'lar (aniq ustunlar bilan, index-signature muammosidan qochish uchun) ---

async function updateTableRow(id: string, updates: Partial<Table>): Promise<Table | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    idx += 1;
    sets.push(`${col} = $${idx}`);
    values.push(val);
  };
  if (updates.branch_id !== undefined) push('branch_id', updates.branch_id);
  if (updates.name !== undefined) push('name', updates.name);
  if (updates.number !== undefined) push('number', updates.number);
  if (updates.qr_token !== undefined) push('qr_token', updates.qr_token);
  if (updates.capacity !== undefined) push('capacity', updates.capacity ?? null);
  if (updates.zone !== undefined) push('zone', updates.zone ?? null);
  if (updates.is_active !== undefined) push('is_active', updates.is_active);
  if (updates.claimed_by !== undefined) push('claimed_by', updates.claimed_by ?? null);
  if (updates.claimed_by_name !== undefined) push('claimed_by_name', updates.claimed_by_name ?? null);
  if (updates.claimed_at !== undefined) push('claimed_at', updates.claimed_at ?? null);
  if (updates.guest_count !== undefined) push('guest_count', updates.guest_count ?? null);
  push('updated_at', new Date().toISOString());
  const res = await query<TableRow>(
    `UPDATE rest_tables SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return res.rows[0] ? mapTable(res.rows[0]) : null;
}

async function updateRestaurantRow(
  id: string,
  updates: Partial<Omit<Restaurant, 'id' | 'created_at'>>
): Promise<Restaurant | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    idx += 1;
    sets.push(`${col} = $${idx}`);
    values.push(val);
  };
  if (updates.name !== undefined) push('name', updates.name);
  if (updates.slug !== undefined) push('slug', updates.slug);
  if (updates.logo_url !== undefined) push('logo_url', updates.logo_url);
  if (updates.banner_url !== undefined) push('banner_url', updates.banner_url ?? null);
  if (updates.tagline !== undefined) push('tagline', updates.tagline ?? null);
  if (updates.currency !== undefined) push('currency', updates.currency);
  if (updates.currency_symbol !== undefined) push('currency_symbol', updates.currency_symbol);
  if (updates.service_fee_percentage !== undefined)
    push('service_fee_percentage', updates.service_fee_percentage);
  if (updates.phone !== undefined) push('phone', updates.phone);
  if (updates.is_active !== undefined) push('is_active', updates.is_active);
  push('updated_at', new Date().toISOString());
  const res = await query<RestaurantRow>(
    `UPDATE rest_restaurants SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return res.rows[0] ? mapRestaurant(res.rows[0]) : null;
}

async function updateCategoryRow(id: string, updates: Partial<MenuCategory>): Promise<MenuCategory | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    idx += 1;
    sets.push(`${col} = $${idx}`);
    values.push(val);
  };
  if (updates.restaurant_id !== undefined) push('restaurant_id', updates.restaurant_id);
  if (updates.branch_id !== undefined) push('branch_id', updates.branch_id ?? null);
  if (updates.name !== undefined) push('name', updates.name);
  if (updates.slug !== undefined) push('slug', updates.slug);
  if (updates.icon !== undefined) push('icon', updates.icon ?? null);
  if (updates.image_url !== undefined) push('image_url', updates.image_url ?? null);
  if (updates.sort_order !== undefined) push('sort_order', updates.sort_order);
  if (updates.is_active !== undefined) push('is_active', updates.is_active);
  push('updated_at', new Date().toISOString());
  const res = await query<CategoryRow>(
    `UPDATE rest_categories SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return res.rows[0] ? mapCategory(res.rows[0]) : null;
}

async function updateMenuItemRow(id: string, updates: Partial<MenuItem>): Promise<MenuItem | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  const push = (col: string, val: unknown) => {
    idx += 1;
    sets.push(`${col} = $${idx}`);
    values.push(val);
  };
  if (updates.restaurant_id !== undefined) push('restaurant_id', updates.restaurant_id);
  if (updates.branch_id !== undefined) push('branch_id', updates.branch_id ?? null);
  if (updates.category_id !== undefined) push('category_id', updates.category_id);
  if (updates.name !== undefined) push('name', updates.name);
  if (updates.description !== undefined) push('description', updates.description);
  if (updates.price !== undefined) push('price', updates.price);
  if (updates.image_url !== undefined) push('image_url', updates.image_url);
  if (updates.ingredients !== undefined) push('ingredients', JSON.stringify(updates.ingredients ?? []));
  if (updates.dietary_flags !== undefined)
    push('dietary_flags', JSON.stringify(updates.dietary_flags ?? null));
  if (updates.spicy_level !== undefined) push('spicy_level', updates.spicy_level);
  if (updates.preparation_time !== undefined) push('preparation_time', updates.preparation_time);
  if (updates.is_available !== undefined) push('is_available', updates.is_available);
  if (updates.is_featured !== undefined) push('is_featured', updates.is_featured ?? null);
  if (updates.option_groups !== undefined)
    push('option_groups', JSON.stringify(updates.option_groups ?? null));
  push('updated_at', new Date().toISOString());
  const res = await query<MenuItemRow>(
    `UPDATE rest_menu_items SET ${sets.join(', ')} WHERE id = $1 RETURNING *`,
    [id, ...values]
  );
  return res.rows[0] ? mapMenuItem(res.rows[0]) : null;
}

// ==========================================
// DB — asosiy eksport
// ==========================================

export const db = {
  // --- RESTAURANT & TENANT RESOLUTION ---
  async getRestaurant(id: string): Promise<Restaurant | undefined> {
    const res = await query<RestaurantRow>('SELECT * FROM rest_restaurants WHERE id = $1', [id]);
    return res.rows[0] ? mapRestaurant(res.rows[0]) : undefined;
  },

  async getBranch(id: string): Promise<Branch | undefined> {
    const res = await query<BranchRow>('SELECT * FROM rest_branches WHERE id = $1', [id]);
    return res.rows[0] ? mapBranch(res.rows[0]) : undefined;
  },

  async getBranchesByRestaurant(restaurantId: string): Promise<Branch[]> {
    const res = await query<BranchRow>('SELECT * FROM rest_branches WHERE restaurant_id = $1', [restaurantId]);
    return res.rows.map(mapBranch);
  },

  // --- TABLE & QR RESOLUTION ---
  async getTableByQrToken(qrToken: string): Promise<TableResolution | null> {
    const tableRes = await query<TableRow>(
      'SELECT * FROM rest_tables WHERE qr_token = $1 AND is_active = true',
      [qrToken]
    );
    const tableRow = tableRes.rows[0];
    if (!tableRow) return null;

    const branchRes = await query<BranchRow>(
      'SELECT * FROM rest_branches WHERE id = $1 AND is_active = true',
      [tableRow.branch_id]
    );
    const branchRow = branchRes.rows[0];
    if (!branchRow) return null;

    const restaurantRes = await query<RestaurantRow>(
      'SELECT * FROM rest_restaurants WHERE id = $1 AND is_active = true',
      [branchRow.restaurant_id]
    );
    const restaurantRow = restaurantRes.rows[0];
    if (!restaurantRow) return null;

    const categoriesRes = await query<CategoryRow>(
      'SELECT * FROM rest_categories WHERE restaurant_id = $1 AND is_active = true ORDER BY sort_order ASC',
      [restaurantRow.id]
    );
    const itemsRes = await query<MenuItemRow>('SELECT * FROM rest_menu_items WHERE restaurant_id = $1', [
      restaurantRow.id,
    ]);

    return {
      restaurant: mapRestaurant(restaurantRow),
      branch: mapBranch(branchRow),
      table: mapTable(tableRow),
      categories: categoriesRes.rows.map(mapCategory),
      items: itemsRes.rows.map(mapMenuItem),
    };
  },

  async getTable(id: string): Promise<Table | undefined> {
    const res = await query<TableRow>('SELECT * FROM rest_tables WHERE id = $1', [id]);
    return res.rows[0] ? mapTable(res.rows[0]) : undefined;
  },

  async getTablesByBranch(branchId: string): Promise<Table[]> {
    const res = await query<TableRow>('SELECT * FROM rest_tables WHERE branch_id = $1', [branchId]);
    return res.rows.map(mapTable);
  },

  /** Ofitsiantga biriktirilgan stollar ro'yxati. */
  async getTablesByWaiter(staffId: string): Promise<Table[]> {
    if (!staffId) return [];
    const res = await query<TableRow>('SELECT * FROM rest_tables WHERE claimed_by = $1', [staffId]);
    return res.rows.map(mapTable);
  },

  // --- STOLNI OFITSIANTGA BIRIKTIRISH (CLAIM / RELEASE / TRANSFER) ---

  /**
   * Stolni ofitsiantga biriktiradi. Idempotent: o'sha ofitsiant qayta chaqirsa ham muvaffaqiyat.
   * Stol boshqa ofitsiantda bo'lsa — xato qaytadi (istisno tashlanmaydi).
   * Ikki ofitsiant bir vaqtda bir stolni olmasligi uchun stol qatori FOR UPDATE bilan qulflanadi.
   */
  async claimTable(tableId: string, staff: { id: string; name: string }): Promise<TableActionResult> {
    type TxResult =
      | { ok: true; table: Table; restaurantId: string; action: 'CLAIMED' | 'CLAIM_REPEATED' }
      | { ok: false; error: string };

    const result = await withTransaction<TxResult>(async (client) => {
      const res = await client.query<TableRow>('SELECT * FROM rest_tables WHERE id = $1 FOR UPDATE', [
        tableId,
      ]);
      const row = res.rows[0];
      if (!row) return { ok: false, error: 'Stol topilmadi.' };
      if (!row.is_active) return { ok: false, error: 'Bu stol hozirda faol emas.' };
      if (row.claimed_by && row.claimed_by !== staff.id) {
        const owner = row.claimed_by_name || 'boshqa ofitsiant';
        return { ok: false, error: `Bu stolni ${owner} olgan. Avval u bo'shatishi kerak.` };
      }

      const now = new Date().toISOString();
      const alreadyMine = row.claimed_by === staff.id;
      const claimedAt = alreadyMine ? row.claimed_at || now : now;

      const upd = await client.query<TableRow>(
        `UPDATE rest_tables SET claimed_by = $1, claimed_by_name = $2, claimed_at = $3, updated_at = $4 WHERE id = $5 RETURNING *`,
        [staff.id, staff.name, claimedAt, now, tableId]
      );

      const branchRes = await client.query<{ restaurant_id: string }>(
        'SELECT restaurant_id FROM rest_branches WHERE id = $1',
        [upd.rows[0].branch_id]
      );

      return {
        ok: true,
        table: mapTable(upd.rows[0]),
        restaurantId: branchRes.rows[0]?.restaurant_id || '',
        action: alreadyMine ? 'CLAIM_REPEATED' : 'CLAIMED',
      };
    });

    if (!result.ok) return result;

    eventBus.emit({
      type: 'TABLE_CLAIMED',
      timestamp: result.table.updated_at,
      restaurant_id: result.restaurantId,
      branch_id: result.table.branch_id,
      tableId: result.table.id,
      table: result.table,
      staffId: staff.id,
      staffName: staff.name,
      data: { action: result.action },
    });

    return { ok: true, table: result.table };
  },

  /**
   * Stolni bo'shatadi. Faqat stolni olgan ofitsiant yoki administrator bo'shata oladi.
   * Stolda tugallanmagan buyurtma bo'lsa — hech kimga (admin uchun ham) ruxsat berilmaydi.
   */
  async releaseTable(
    tableId: string,
    staff: { id: string; name: string },
    isAdmin: boolean
  ): Promise<TableActionResult> {
    type TxResult =
      | { ok: true; table: Table; restaurantId: string; previousOwner: { id: string; name: string } }
      | { ok: false; error: string; forbidden?: boolean };

    const result = await withTransaction<TxResult>(async (client) => {
      const res = await client.query<TableRow>('SELECT * FROM rest_tables WHERE id = $1 FOR UPDATE', [
        tableId,
      ]);
      const row = res.rows[0];
      if (!row) return { ok: false, error: 'Stol topilmadi.' };
      if (!row.claimed_by) {
        return { ok: false, error: "Bu stol allaqachon bo'sh — biriktirilgan ofitsiant yo'q." };
      }
      if (!isAdmin && row.claimed_by !== staff.id) {
        const owner = row.claimed_by_name || 'boshqa ofitsiant';
        return {
          ok: false,
          forbidden: true,
          error: `Bu stol ${owner} ga biriktirilgan. Uni faqat o'sha ofitsiant yoki administrator bo'shata oladi.`,
        };
      }

      const unfinishedRes = await client.query<{ order_number: string }>(
        `SELECT order_number FROM rest_orders WHERE table_id = $1 AND status = ANY($2::text[])`,
        [tableId, UNFINISHED_ORDER_STATUSES]
      );
      if (unfinishedRes.rows.length > 0) {
        const numbers = unfinishedRes.rows.map((r) => r.order_number).join(', ');
        return {
          ok: false,
          error: `Bu stolda ${unfinishedRes.rows.length} ta tugallanmagan buyurtma bor (${numbers}). Avval ularni yakunlang yoki bekor qiling, so'ng stolni bo'shating.`,
        };
      }

      const now = new Date().toISOString();
      const previousOwner = { id: row.claimed_by, name: row.claimed_by_name || '' };

      const upd = await client.query<TableRow>(
        `UPDATE rest_tables SET claimed_by = NULL, claimed_by_name = NULL, claimed_at = NULL, guest_count = NULL, updated_at = $1 WHERE id = $2 RETURNING *`,
        [now, tableId]
      );

      const branchRes = await client.query<{ restaurant_id: string }>(
        'SELECT restaurant_id FROM rest_branches WHERE id = $1',
        [upd.rows[0].branch_id]
      );

      return {
        ok: true,
        table: mapTable(upd.rows[0]),
        restaurantId: branchRes.rows[0]?.restaurant_id || '',
        previousOwner,
      };
    });

    if (!result.ok) return result;

    eventBus.emit({
      type: 'TABLE_RELEASED',
      timestamp: result.table.updated_at,
      restaurant_id: result.restaurantId,
      branch_id: result.table.branch_id,
      tableId: result.table.id,
      table: result.table,
      staffId: staff.id,
      staffName: staff.name,
      data: {
        action: 'RELEASED',
        released_by_admin: isAdmin && result.previousOwner.id !== staff.id,
        previous_staff_id: result.previousOwner.id,
        previous_staff_name: result.previousOwner.name,
      },
    });

    return { ok: true, table: result.table };
  },

  /**
   * Stolni boshqa ofitsiantga uzatadi. Faqat stolni olgan ofitsiant yoki administrator uzata oladi.
   */
  async transferTable(
    tableId: string,
    fromStaffId: string,
    toStaff: { id: string; name: string },
    isAdmin: boolean
  ): Promise<TableActionResult> {
    type TxResult =
      | {
          ok: true;
          table: Table;
          restaurantId: string;
          action: 'TRANSFERRED' | 'TRANSFER_REPEATED';
          toStaffId: string;
          toStaffName: string;
          previousOwner: { id: string; name: string };
        }
      | { ok: false; error: string; forbidden?: boolean };

    const result = await withTransaction<TxResult>(async (client) => {
      const res = await client.query<TableRow>('SELECT * FROM rest_tables WHERE id = $1 FOR UPDATE', [
        tableId,
      ]);
      const row = res.rows[0];
      if (!row) return { ok: false, error: 'Stol topilmadi.' };
      if (!row.is_active) return { ok: false, error: 'Bu stol hozirda faol emas.' };
      if (!toStaff?.id) return { ok: false, error: 'Stol uzatiladigan ofitsiantni tanlang.' };

      const targetRes = await client.query<StaffRow>('SELECT * FROM rest_staff WHERE id = $1', [
        toStaff.id,
      ]);
      const target = targetRes.rows[0];
      if (!target) return { ok: false, error: 'Ofitsiant topilmadi.' };
      if (!target.is_active) {
        return { ok: false, error: `${target.name} hozir faol emas, stolni unga uzatib bo'lmaydi.` };
      }
      // Oshxona xodimi zalda stolga xizmat qilmaydi (uning uchun `/waiter` sahifasi ham yopiq),
      // shuning uchun stol unga biriktirilsa — stol ham, undagi buyurtmalar ham egasiz qoladi.
      if (target.role === 'KITCHEN') {
        return {
          ok: false,
          error: `${target.name} oshxona xodimi — stolni faqat ofitsiantga uzatish mumkin.`,
        };
      }
      const targetName = (toStaff.name || '').trim() || target.name;

      if (!isAdmin) {
        if (!row.claimed_by) {
          return {
            ok: false,
            error: "Bu stol hech kimga biriktirilmagan. Avval stolni o'zingizga oling.",
          };
        }
        if (row.claimed_by !== fromStaffId) {
          const owner = row.claimed_by_name || 'boshqa ofitsiant';
          return {
            ok: false,
            forbidden: true,
            error: `Bu stol ${owner} ga biriktirilgan. Uni faqat o'sha ofitsiant yoki administrator uzata oladi.`,
          };
        }
      }

      const now = new Date().toISOString();
      const previousOwner = { id: row.claimed_by || '', name: row.claimed_by_name || '' };

      let updatedRow: TableRow;
      let action: 'TRANSFERRED' | 'TRANSFER_REPEATED';

      if (previousOwner.id === toStaff.id) {
        // Idempotent: stol allaqachon o'sha ofitsiantda.
        const upd = await client.query<TableRow>(
          `UPDATE rest_tables SET claimed_by_name = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
          [targetName, now, tableId]
        );
        updatedRow = upd.rows[0];
        action = 'TRANSFER_REPEATED';
      } else {
        const upd = await client.query<TableRow>(
          `UPDATE rest_tables SET claimed_by = $1, claimed_by_name = $2, claimed_at = $3, updated_at = $3 WHERE id = $4 RETURNING *`,
          [toStaff.id, targetName, now, tableId]
        );
        updatedRow = upd.rows[0];
        action = 'TRANSFERRED';
      }

      const branchRes = await client.query<{ restaurant_id: string }>(
        'SELECT restaurant_id FROM rest_branches WHERE id = $1',
        [updatedRow.branch_id]
      );

      return {
        ok: true,
        table: mapTable(updatedRow),
        restaurantId: branchRes.rows[0]?.restaurant_id || '',
        action,
        toStaffId: toStaff.id,
        toStaffName: targetName,
        previousOwner,
      };
    });

    if (!result.ok) return result;

    eventBus.emit({
      type: 'TABLE_CLAIMED',
      timestamp: result.table.updated_at,
      restaurant_id: result.restaurantId,
      branch_id: result.table.branch_id,
      tableId: result.table.id,
      table: result.table,
      staffId: result.toStaffId,
      staffName: result.toStaffName,
      data:
        result.action === 'TRANSFER_REPEATED'
          ? { action: 'TRANSFER_REPEATED' }
          : {
              action: 'TRANSFERRED',
              previous_staff_id: result.previousOwner.id,
              previous_staff_name: result.previousOwner.name,
            },
    });

    return { ok: true, table: result.table };
  },

  async createTable(
    data: Omit<Table, 'id' | 'created_at' | 'updated_at' | 'qr_token'> & { qr_token?: string }
  ): Promise<Table> {
    const id = `tbl-${nanoid(8)}`;
    const qrToken = data.qr_token || nanoid(10);
    const isActive = data.is_active ?? true;
    const now = new Date().toISOString();
    const res = await query<TableRow>(
      `INSERT INTO rest_tables
        (id, branch_id, name, number, qr_token, capacity, zone, is_active, claimed_by, claimed_by_name, claimed_at, guest_count, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13) RETURNING *`,
      [
        id,
        data.branch_id,
        data.name,
        data.number,
        qrToken,
        data.capacity ?? null,
        data.zone ?? null,
        isActive,
        data.claimed_by ?? null,
        data.claimed_by_name ?? null,
        data.claimed_at ?? null,
        data.guest_count ?? null,
        now,
      ]
    );
    return mapTable(res.rows[0]);
  },

  async updateTable(id: string, updates: Partial<Table>): Promise<Table | null> {
    return updateTableRow(id, updates);
  },

  async updateRestaurant(
    id: string,
    updates: Partial<Omit<Restaurant, 'id' | 'created_at'>>
  ): Promise<Restaurant | null> {
    return updateRestaurantRow(id, updates);
  },

  // --- STAFF (XODIMLAR) ---
  /** PIN kod bo'yicha xodimni topadi. Faqat faol (is_active) xodimlar qidiriladi. */
  async getStaffByPin(pin: string): Promise<Staff | undefined> {
    const normalized = String(pin ?? '').trim();
    if (!normalized) return undefined;
    const res = await query<StaffRow>(
      'SELECT * FROM rest_staff WHERE is_active = true AND pin = $1 LIMIT 1',
      [normalized]
    );
    return res.rows[0] ? mapStaff(res.rows[0]) : undefined;
  },

  async getStaffById(id: string): Promise<Staff | undefined> {
    const res = await query<StaffRow>('SELECT * FROM rest_staff WHERE id = $1', [id]);
    return res.rows[0] ? mapStaff(res.rows[0]) : undefined;
  },

  async getStaffByRestaurant(restaurantId: string): Promise<Staff[]> {
    const res = await query<StaffRow>('SELECT * FROM rest_staff WHERE restaurant_id = $1', [restaurantId]);
    return res.rows.map(mapStaff);
  },

  async staffEmailTaken(restaurantId: string, email: string): Promise<boolean> {
    const res = await query<{ found: number }>(
      'SELECT 1 AS found FROM rest_staff WHERE restaurant_id = $1 AND LOWER(email) = LOWER($2) LIMIT 1',
      [restaurantId, email]
    );
    return res.rows.length > 0;
  },

  async createStaff(
    data: Omit<Staff, 'id' | 'user_id' | 'is_active' | 'created_at' | 'updated_at'>
  ): Promise<Staff> {
    const requestedPin = data.pin ? String(data.pin).trim() : '';
    if (requestedPin) {
      const takenRes = await query<{ pin: string }>(
        'SELECT pin FROM rest_staff WHERE restaurant_id = $1 AND pin = $2',
        [data.restaurant_id, requestedPin]
      );
      if (takenRes.rows.length > 0) {
        throw new Error('Bu PIN kod allaqachon band. Boshqa kod tanlang.');
      }
    }

    const pin = requestedPin || (await generateUniquePin(data.restaurant_id));
    const id = `staff-${nanoid(8)}`;
    const userId = `usr-${nanoid(8)}`;
    const now = new Date().toISOString();

    try {
      const res = await query<StaffRow>(
        `INSERT INTO rest_staff (id, restaurant_id, branch_id, user_id, name, email, phone, pin, role, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$10) RETURNING *`,
        [
          id,
          data.restaurant_id,
          data.branch_id ?? null,
          userId,
          data.name,
          data.email,
          data.phone ?? null,
          pin,
          data.role,
          now,
        ]
      );
      return mapStaff(res.rows[0]);
    } catch (err: unknown) {
      // Pre-check bilan insert orasidagi poyga holatiga qarshi backstop — qaysi ustun to'qnashgani
      // (constraint nomi orqali) aniqlanadi, aks holda email to'qnashuvi ham noto'g'ri "PIN band"
      // xabari bilan qaytardi.
      if (isUniqueViolation(err)) {
        const constraint = (err as { constraint?: string }).constraint || '';
        if (constraint.includes('email')) {
          throw new Error('Bu elektron pochta bilan xodim allaqachon mavjud.');
        }
        throw new Error('Bu PIN kod allaqachon band. Boshqa kod tanlang.');
      }
      throw err;
    }
  },

  async regenerateQrToken(tableId: string): Promise<{ table: Table; oldToken: string } | null> {
    const existing = await query<{ qr_token: string; branch_id: string }>(
      'SELECT qr_token, branch_id FROM rest_tables WHERE id = $1',
      [tableId]
    );
    const existingRow = existing.rows[0];
    if (!existingRow) return null;

    const oldToken = existingRow.qr_token;
    const newToken = nanoid(10);
    const now = new Date().toISOString();

    const upd = await query<TableRow>(
      'UPDATE rest_tables SET qr_token = $1, updated_at = $2 WHERE id = $3 RETURNING *',
      [newToken, now, tableId]
    );
    const table = mapTable(upd.rows[0]);

    const branchRes = await query<{ restaurant_id: string }>(
      'SELECT restaurant_id FROM rest_branches WHERE id = $1',
      [table.branch_id]
    );

    eventBus.emit({
      type: 'TABLE_UPDATED',
      timestamp: now,
      restaurant_id: branchRes.rows[0]?.restaurant_id || '',
      tableId: table.id,
      data: { action: 'QR_REGENERATED', new_token: table.qr_token },
    });

    return { table, oldToken };
  },

  // --- MENU CATEGORIES ---
  async getCategories(restaurantId: string): Promise<MenuCategory[]> {
    const res = await query<CategoryRow>(
      'SELECT * FROM rest_categories WHERE restaurant_id = $1 ORDER BY sort_order ASC',
      [restaurantId]
    );
    return res.rows.map(mapCategory);
  },

  async createCategory(data: Omit<MenuCategory, 'id' | 'created_at' | 'updated_at'>): Promise<MenuCategory> {
    const id = `cat-${nanoid(8)}`;
    const now = new Date().toISOString();
    // slug/sort_order/is_active NOT NULL ustunlar — jadvalning o'zida DEFAULT bo'lsa ham, INSERT
    // ularni aniq qiymat (shu jumladan undefined->null) bilan yozadi va DEFAULT'ni chetlab
    // o'tadi. Shu sabab bu yerda ham xuddi shunday standart qiymatlar qo'llanadi (admin panel
    // formasi ularni allaqachon to'ldirib yuboradi, lekin API'ni to'g'ridan-to'g'ri chaqirgan
    // boshqa chaqiruvchi uchun ham ishlashi kerak).
    const slug = data.slug || data.name.toLowerCase().trim().replace(/\s+/g, '-');
    const res = await query<CategoryRow>(
      `INSERT INTO rest_categories (id, restaurant_id, branch_id, name, slug, icon, image_url, sort_order, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING *`,
      [
        id,
        data.restaurant_id,
        data.branch_id ?? null,
        data.name,
        slug,
        data.icon ?? null,
        data.image_url ?? null,
        data.sort_order ?? 0,
        data.is_active ?? true,
        now,
      ]
    );
    return mapCategory(res.rows[0]);
  },

  async updateCategory(id: string, updates: Partial<MenuCategory>): Promise<MenuCategory | null> {
    return updateCategoryRow(id, updates);
  },

  async deleteCategory(id: string): Promise<boolean> {
    const res = await query('DELETE FROM rest_categories WHERE id = $1', [id]);
    return res.rowCount > 0;
  },

  // --- MENU ITEMS ---
  async getMenuItems(restaurantId: string): Promise<MenuItem[]> {
    const res = await query<MenuItemRow>('SELECT * FROM rest_menu_items WHERE restaurant_id = $1', [
      restaurantId,
    ]);
    return res.rows.map(mapMenuItem);
  },

  async getMenuItem(id: string): Promise<MenuItem | undefined> {
    const res = await query<MenuItemRow>('SELECT * FROM rest_menu_items WHERE id = $1', [id]);
    return res.rows[0] ? mapMenuItem(res.rows[0]) : undefined;
  },

  async createMenuItem(data: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>): Promise<MenuItem> {
    const id = `item-${nanoid(8)}`;
    const now = new Date().toISOString();
    const res = await query<MenuItemRow>(
      `INSERT INTO rest_menu_items
        (id, restaurant_id, branch_id, category_id, name, description, price, image_url, ingredients, dietary_flags, spicy_level, preparation_time, is_available, is_featured, option_groups, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16) RETURNING *`,
      [
        id,
        data.restaurant_id,
        data.branch_id ?? null,
        data.category_id,
        data.name,
        // NOT NULL ustunlar (description/image_url/spicy_level/preparation_time/is_available)
        // jadvalda DEFAULT'ga ega, lekin INSERT ularni aniq qiymat bilan yozgani uchun bu yerda
        // ham mos standart qiymatlar qo'llanadi — createCategory'dagi izohga qarang.
        data.description ?? '',
        data.price,
        data.image_url ?? '',
        JSON.stringify(data.ingredients ?? []),
        JSON.stringify(data.dietary_flags ?? null),
        data.spicy_level ?? 0,
        data.preparation_time ?? 0,
        data.is_available ?? true,
        data.is_featured ?? null,
        JSON.stringify(data.option_groups ?? null),
        now,
      ]
    );
    return mapMenuItem(res.rows[0]);
  },

  async updateMenuItem(id: string, updates: Partial<MenuItem>): Promise<MenuItem | null> {
    const updated = await updateMenuItemRow(id, updates);
    if (!updated) return null;

    eventBus.emit({
      type: 'MENU_UPDATED',
      timestamp: new Date().toISOString(),
      restaurant_id: updated.restaurant_id,
      data: { item: updated },
    });

    return updated;
  },

  async deleteMenuItem(id: string): Promise<boolean> {
    const res = await query('DELETE FROM rest_menu_items WHERE id = $1', [id]);
    return res.rowCount > 0;
  },

  async toggleItemAvailability(id: string): Promise<MenuItem | null> {
    // Bitta atomik UPDATE — avval o'qib keyin yozish (read-then-write) emas, aks holda ikki
    // so'rov bir vaqtda kelsa (masalan ikki marta tez bosilsa), ikkalasi ham eski qiymatni o'qib,
    // bir xil natijaga yozib qo'yishi mumkin va bitta almashtirish yo'qolib ketadi.
    const now = new Date().toISOString();
    const res = await query<MenuItemRow>(
      'UPDATE rest_menu_items SET is_available = NOT is_available, updated_at = $2 WHERE id = $1 RETURNING *',
      [id, now]
    );
    const row = res.rows[0];
    if (!row) return null;
    const updated = mapMenuItem(row);

    eventBus.emit({
      type: 'MENU_UPDATED',
      timestamp: now,
      restaurant_id: updated.restaurant_id,
      data: { item: updated },
    });

    return updated;
  },

  // --- ORDERS (WITH SERVER-SIDE SECURITY & PRICE VERIFICATION) ---
  async createOrder(params: {
    table_id: string;
    customer_notes?: string;
    items: {
      menu_item_id: string;
      quantity: number;
      selected_options?: SelectedOption[];
      notes?: string;
    }[];
  }): Promise<Order> {
    const order = await withTransaction<Order>(async (client) => {
      // FOR UPDATE: releaseTable ham xuddi shu qatorni qulflaydi — shu orqali ikkalasi bir stolda
      // bir vaqtda ishlasa (masalan mijoz buyurtma yuborayotganda ofitsiant stolni bo'shatsa),
      // ular navbat bilan ishlaydi, "bo'shatilgan stolda egasiz buyurtma qolib ketishi" mumkin
      // bo'lgan poyga holati oldini olinadi.
      const tableRes = await client.query<TableRow>(
        'SELECT * FROM rest_tables WHERE id = $1 FOR UPDATE',
        [params.table_id]
      );
      const tableRow = tableRes.rows[0];
      if (!tableRow || !tableRow.is_active) {
        throw new Error('Ushbu stol hozirda faol emas.');
      }

      const branchRes = await client.query<BranchRow>('SELECT * FROM rest_branches WHERE id = $1', [
        tableRow.branch_id,
      ]);
      const branchRow = branchRes.rows[0];
      if (!branchRow || !branchRow.is_active) {
        throw new Error('Filial faol emas.');
      }

      const restaurantRes = await client.query<RestaurantRow>(
        'SELECT * FROM rest_restaurants WHERE id = $1',
        [branchRow.restaurant_id]
      );
      const restaurantRow = restaurantRes.rows[0];
      if (!restaurantRow || !restaurantRow.is_active) {
        throw new Error('Restoran ayni paytda yopiq.');
      }

      if (!params.items || params.items.length === 0) {
        throw new Error("Buyurtmada kamida bitta taom bo'lishi shart.");
      }

      // Buyurtma qilinayotgan menyu taomlarini FOR UPDATE bilan qulflaymiz — shu orqali admin
      // to'lov paytida taomni "sotuvda yo'q" qilib qo'ysa ham, narx/mavjudlik tekshiruvi
      // hech qanday poyga holatisiz, qulflangan qatorlardan hisoblanadi.
      const menuItemIds = [...new Set(params.items.map((i) => i.menu_item_id))];
      const menuRes = await client.query<MenuItemRow>(
        'SELECT * FROM rest_menu_items WHERE id = ANY($1::text[]) FOR UPDATE',
        [menuItemIds]
      );
      const menuById = new Map(menuRes.rows.map((r) => [r.id, r]));

      let calculatedSubtotal = 0;
      const orderItems: OrderItem[] = [];
      const orderId = `ord-${nanoid(10)}`;
      const now = new Date().toISOString();

      for (const orderItemInput of params.items) {
        const dbMenuItem = menuById.get(orderItemInput.menu_item_id);
        if (!dbMenuItem) {
          throw new Error('Bunday taom menyuda topilmadi.');
        }
        if (!dbMenuItem.is_available) {
          throw new Error(`"${dbMenuItem.name}" taomi ayni paytda sotuvda tugagan.`);
        }
        if (orderItemInput.quantity < 1) {
          throw new Error("Noto'g'ri miqdor kiritildi.");
        }

        // Calculate unit price + options delta strictly from server (locked) data
        let itemUnitPrice = dbMenuItem.price;
        const verifiedOptions: SelectedOption[] = [];

        if (orderItemInput.selected_options && orderItemInput.selected_options.length > 0) {
          for (const opt of orderItemInput.selected_options) {
            const group = dbMenuItem.option_groups?.find((g) => g.id === opt.group_id);
            const foundOpt = group?.options.find((o) => o.id === opt.option_id);
            if (foundOpt) {
              itemUnitPrice += foundOpt.price;
              verifiedOptions.push({
                group_id: group!.id,
                group_name: group!.name,
                option_id: foundOpt.id,
                option_name: foundOpt.name,
                price: foundOpt.price,
              });
            }
          }
        }

        const itemTotal = parseFloat((itemUnitPrice * orderItemInput.quantity).toFixed(2));
        calculatedSubtotal += itemTotal;

        orderItems.push({
          id: `oi-${nanoid(8)}`,
          order_id: orderId,
          menu_item_id: dbMenuItem.id,
          name_snapshot: dbMenuItem.name,
          price_snapshot: itemUnitPrice,
          quantity: orderItemInput.quantity,
          selected_options: verifiedOptions,
          notes: orderItemInput.notes,
          total: itemTotal,
          created_at: now,
        });
      }

      calculatedSubtotal = parseFloat(calculatedSubtotal.toFixed(2));
      const serviceFee = parseFloat(
        ((calculatedSubtotal * (restaurantRow.service_fee_percentage || 0)) / 100).toFixed(2)
      );
      const grandTotal = parseFloat((calculatedSubtotal + serviceFee).toFixed(2));

      const seqRes = await client.query<{ nextval: number }>(
        "SELECT nextval('rest_order_number_seq') AS nextval"
      );
      const orderNumber = `#${seqRes.rows[0].nextval}`;

      const waiterId = orUndef(tableRow.claimed_by);
      const waiterName = orUndef(tableRow.claimed_by_name);

      await client.query(
        `INSERT INTO rest_orders
          (id, restaurant_id, branch_id, table_id, order_number, status, subtotal, service_fee, total, customer_notes, waiter_id, waiter_name, table_name, table_number, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$14)`,
        [
          orderId,
          restaurantRow.id,
          branchRow.id,
          tableRow.id,
          orderNumber,
          calculatedSubtotal,
          serviceFee,
          grandTotal,
          params.customer_notes ?? null,
          waiterId ?? null,
          waiterName ?? null,
          tableRow.name,
          tableRow.number,
          now,
        ]
      );

      for (const oi of orderItems) {
        await client.query(
          `INSERT INTO rest_order_items (id, order_id, menu_item_id, name_snapshot, price_snapshot, quantity, selected_options, notes, total, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            oi.id,
            oi.order_id,
            oi.menu_item_id,
            oi.name_snapshot,
            oi.price_snapshot,
            oi.quantity,
            JSON.stringify(oi.selected_options ?? null),
            oi.notes ?? null,
            oi.total,
            oi.created_at,
          ]
        );
      }

      await client.query(
        `INSERT INTO rest_order_status_history (id, order_id, previous_status, new_status, changed_by, reason, created_at)
         VALUES ($1,$2,NULL,'pending','MIJOZ',$3,$4)`,
        [`osh-${nanoid(8)}`, orderId, 'QR kod orqali buyurtma berildi', now]
      );

      return {
        id: orderId,
        restaurant_id: restaurantRow.id,
        branch_id: branchRow.id,
        table_id: tableRow.id,
        order_number: orderNumber,
        status: 'pending',
        subtotal: calculatedSubtotal,
        service_fee: serviceFee,
        total: grandTotal,
        customer_notes: orUndef(params.customer_notes),
        items: orderItems,
        table_name: tableRow.name,
        table_number: tableRow.number,
        waiter_id: waiterId,
        waiter_name: waiterName,
        created_at: now,
        updated_at: now,
      };
    });

    eventBus.emit({
      type: 'ORDER_CREATED',
      timestamp: order.created_at,
      restaurant_id: order.restaurant_id,
      branch_id: order.branch_id,
      order,
    });

    return order;
  },

  async getOrder(id: string): Promise<Order | undefined> {
    const res = await query<OrderRow>('SELECT * FROM rest_orders WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) return undefined;
    const itemsRes = await query<OrderItemRow>('SELECT * FROM rest_order_items WHERE order_id = $1', [id]);
    return mapOrder(row, itemsRes.rows.map(mapOrderItem));
  },

  async getOrdersByBranch(branchId: string): Promise<Order[]> {
    return fetchOrdersWithItems('branch_id = $1 ORDER BY created_at DESC', [branchId]);
  },

  async getOrdersByRestaurant(restaurantId: string): Promise<Order[]> {
    return fetchOrdersWithItems('restaurant_id = $1 ORDER BY created_at DESC', [restaurantId]);
  },

  /** Ofitsiantga biriktirilgan buyurtmalar. */
  async getOrdersByWaiter(staffId: string): Promise<Order[]> {
    if (!staffId) return [];
    return fetchOrdersWithItems('waiter_id = $1 ORDER BY created_at DESC', [staffId]);
  },

  async updateOrderStatus(
    orderId: string,
    targetStatus: OrderStatus,
    changedBy: string,
    reason?: string
  ): Promise<Order> {
    const order = await withTransaction<Order>(async (client) => {
      const res = await client.query<OrderRow>('SELECT * FROM rest_orders WHERE id = $1 FOR UPDATE', [
        orderId,
      ]);
      const row = res.rows[0];
      if (!row) {
        throw new Error('Buyurtma topilmadi.');
      }

      assertValidTransition(row.status, targetStatus);

      const now = new Date().toISOString();
      const prevStatus = row.status;

      const upd = await client.query<OrderRow>(
        `UPDATE rest_orders SET status = $1, updated_at = $2 WHERE id = $3 RETURNING *`,
        [targetStatus, now, orderId]
      );

      await client.query(
        `INSERT INTO rest_order_status_history (id, order_id, previous_status, new_status, changed_by, reason, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [`osh-${nanoid(8)}`, orderId, prevStatus, targetStatus, changedBy, reason ?? null, now]
      );

      const itemsRes = await client.query<OrderItemRow>(
        'SELECT * FROM rest_order_items WHERE order_id = $1',
        [orderId]
      );
      return mapOrder(upd.rows[0], itemsRes.rows.map(mapOrderItem));
    });

    eventBus.emit({
      type: 'ORDER_STATUS_CHANGED',
      timestamp: order.updated_at,
      restaurant_id: order.restaurant_id,
      branch_id: order.branch_id,
      order,
      orderId: order.id,
      newStatus: targetStatus,
    });

    return order;
  },

  /**
   * Ofitsiant buyurtmani tasdiqlaydi: faqat 'pending' holatdan 'confirmed' ga.
   * Shundan keyingina oshxona tayyorlashni boshlay oladi.
   */
  async acceptOrder(orderId: string, staff: { id: string; name: string }): Promise<OrderActionResult> {
    type TxResult = { ok: true; order: Order } | { ok: false; error: string };

    const result = await withTransaction<TxResult>(async (client) => {
      const res = await client.query<OrderRow>('SELECT * FROM rest_orders WHERE id = $1 FOR UPDATE', [
        orderId,
      ]);
      const row = res.rows[0];
      if (!row) return { ok: false, error: 'Buyurtma topilmadi.' };
      if (row.status !== 'pending') {
        return {
          ok: false,
          error: `Bu buyurtmani tasdiqlab bo'lmaydi — u allaqachon "${STATUS_DISPLAY_INFO[row.status].label}" holatida.`,
        };
      }

      const now = new Date().toISOString();
      const prevStatus = row.status;
      // Stolni olgan ofitsiant buyurtmaga biriktirilgan bo'lsa — o'sha saqlanadi;
      // bo'sh bo'lsa — amalni bajargan ofitsiant biriktiriladi.
      const waiterId = row.waiter_id ?? staff.id;
      const waiterName = row.waiter_id ? row.waiter_name : staff.name;

      const upd = await client.query<OrderRow>(
        `UPDATE rest_orders SET status = 'confirmed', accepted_at = $1, waiter_id = $2, waiter_name = $3, updated_at = $1 WHERE id = $4 RETURNING *`,
        [now, waiterId, waiterName, orderId]
      );

      await client.query(
        `INSERT INTO rest_order_status_history (id, order_id, previous_status, new_status, changed_by, reason, created_at)
         VALUES ($1,$2,$3,'confirmed','OFITSIANT',$4,$5)`,
        [`osh-${nanoid(8)}`, orderId, prevStatus, `${staff.name} buyurtmani tasdiqladi`, now]
      );

      const itemsRes = await client.query<OrderItemRow>(
        'SELECT * FROM rest_order_items WHERE order_id = $1',
        [orderId]
      );
      const order = mapOrder(upd.rows[0], itemsRes.rows.map(mapOrderItem));
      return { ok: true, order };
    });

    if (!result.ok) return result;

    emitOrderStaffEvent('ORDER_ACCEPTED', result.order, staff, result.order.updated_at);

    return result;
  },

  /**
   * Ofitsiant buyurtmani rad etadi: faqat 'pending' holatdan 'cancelled' ga.
   * Sabab majburiy — u buyurtmada saqlanadi va mijozga ko'rsatiladi.
   */
  async rejectOrder(
    orderId: string,
    staff: { id: string; name: string },
    reason: string
  ): Promise<OrderActionResult> {
    type TxResult = { ok: true; order: Order } | { ok: false; error: string };

    const result = await withTransaction<TxResult>(async (client) => {
      const res = await client.query<OrderRow>('SELECT * FROM rest_orders WHERE id = $1 FOR UPDATE', [
        orderId,
      ]);
      const row = res.rows[0];
      if (!row) return { ok: false, error: 'Buyurtma topilmadi.' };

      const trimmedReason = String(reason ?? '').trim();
      if (!trimmedReason) {
        return { ok: false, error: 'Rad etish sababini yozing.' };
      }

      if (row.status !== 'pending') {
        return {
          ok: false,
          error: `Bu buyurtmani rad etib bo'lmaydi — u allaqachon "${STATUS_DISPLAY_INFO[row.status].label}" holatida.`,
        };
      }

      const now = new Date().toISOString();
      const prevStatus = row.status;
      const waiterId = row.waiter_id ?? staff.id;
      const waiterName = row.waiter_id ? row.waiter_name : staff.name;

      const upd = await client.query<OrderRow>(
        `UPDATE rest_orders SET status = 'cancelled', rejection_reason = $1, waiter_id = $2, waiter_name = $3, updated_at = $4 WHERE id = $5 RETURNING *`,
        [trimmedReason, waiterId, waiterName, now, orderId]
      );

      await client.query(
        `INSERT INTO rest_order_status_history (id, order_id, previous_status, new_status, changed_by, reason, created_at)
         VALUES ($1,$2,$3,'cancelled','OFITSIANT',$4,$5)`,
        [`osh-${nanoid(8)}`, orderId, prevStatus, `${staff.name} rad etdi: ${trimmedReason}`, now]
      );

      const itemsRes = await client.query<OrderItemRow>(
        'SELECT * FROM rest_order_items WHERE order_id = $1',
        [orderId]
      );
      const order = mapOrder(upd.rows[0], itemsRes.rows.map(mapOrderItem));
      return { ok: true, order };
    });

    if (!result.ok) return result;

    emitOrderStaffEvent('ORDER_REJECTED', result.order, staff, result.order.updated_at, result.order.rejection_reason);

    return result;
  },

  async getOrderHistory(orderId: string): Promise<OrderStatusHistory[]> {
    const res = await query<OrderStatusHistoryRow>(
      'SELECT * FROM rest_order_status_history WHERE order_id = $1 ORDER BY created_at ASC',
      [orderId]
    );
    return res.rows.map(mapOrderStatusHistory);
  },

  // --- WAITER CALLS ---
  async callWaiter(params: {
    table_id: string;
    call_type?: 'SERVICE' | 'BILL' | 'ASSISTANCE';
  }): Promise<WaiterCall> {
    const tableRes = await query<TableRow>(
      'SELECT * FROM rest_tables WHERE id = $1 AND is_active = true',
      [params.table_id]
    );
    const tableRow = tableRes.rows[0];
    if (!tableRow) throw new Error('Stol topilmadi');

    const branchRes = await query<BranchRow>('SELECT * FROM rest_branches WHERE id = $1', [
      tableRow.branch_id,
    ]);
    const branchRow = branchRes.rows[0];
    if (!branchRow) throw new Error('Filial topilmadi');

    // Anti-spam check: 45s — bazadan so'raymiz, xotiradagi holatga tayanmaymiz.
    const existingRes = await query<WaiterCallRow>(
      `SELECT * FROM rest_waiter_calls WHERE table_id = $1 AND status = 'PENDING' ORDER BY created_at DESC LIMIT 1`,
      [tableRow.id]
    );
    const existing = existingRes.rows[0];
    if (existing) {
      const elapsed = Date.now() - new Date(existing.created_at).getTime();
      if (elapsed < 45000) {
        throw new Error('Ofitsiantga allaqachon xabar berilgan. Iltimos, ozgina kuting.');
      }
    }

    const id = `wc-${nanoid(8)}`;
    const now = new Date().toISOString();
    const callType = params.call_type || 'SERVICE';
    const tableName = `${tableRow.name}${tableRow.zone ? ` (${tableRow.zone})` : ''}`;

    const insertRes = await query<WaiterCallRow>(
      `INSERT INTO rest_waiter_calls (id, restaurant_id, branch_id, table_id, table_number, table_name, status, call_type, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8) RETURNING *`,
      [id, branchRow.restaurant_id, branchRow.id, tableRow.id, tableRow.number, tableName, callType, now]
    );
    const call = mapWaiterCall(insertRes.rows[0]);

    eventBus.emit({
      type: 'WAITER_CALLED',
      timestamp: call.created_at,
      restaurant_id: call.restaurant_id,
      branch_id: call.branch_id,
      waiterCall: call,
    });

    return call;
  },

  async acknowledgeWaiterCall(callId: string): Promise<WaiterCall> {
    const now = new Date().toISOString();
    const res = await query<WaiterCallRow>(
      `UPDATE rest_waiter_calls SET status = 'ACKNOWLEDGED', acknowledged_at = $1 WHERE id = $2 RETURNING *`,
      [now, callId]
    );
    const row = res.rows[0];
    if (!row) throw new Error('Chaqiruv topilmadi');
    const call = mapWaiterCall(row);

    eventBus.emit({
      type: 'WAITER_CALL_ACKNOWLEDGED',
      timestamp: call.acknowledged_at || now,
      restaurant_id: call.restaurant_id,
      branch_id: call.branch_id,
      waiterCall: call,
    });

    return call;
  },

  async getWaiterCalls(branchId: string): Promise<WaiterCall[]> {
    const res = await query<WaiterCallRow>(
      `SELECT * FROM rest_waiter_calls WHERE branch_id = $1 AND status = 'PENDING' ORDER BY created_at DESC`,
      [branchId]
    );
    return res.rows.map(mapWaiterCall);
  },

  // --- UPLOADS (RASM YUKLASH) ---
  async saveUpload(bytes: Buffer, contentType: string): Promise<UploadRecord> {
    const id = `up-${nanoid(10)}`;
    const now = new Date().toISOString();
    const res = await query<UploadMetaRow>(
      `INSERT INTO rest_uploads (id, content_type, size, bytes, created_at) VALUES ($1,$2,$3,$4,$5)
       RETURNING id, content_type, size, created_at`,
      [id, contentType, bytes.length, bytes, now]
    );
    return mapUpload(res.rows[0]);
  },

  async getUpload(id: string): Promise<{ record: UploadRecord; bytes: Buffer } | undefined> {
    const res = await query<UploadRow>('SELECT * FROM rest_uploads WHERE id = $1', [id]);
    const row = res.rows[0];
    if (!row) return undefined;
    return { record: mapUpload(row), bytes: row.bytes };
  },

  // --- NOTIFICATIONS (BILDIRISHNOMALAR) ---
  async logNotification(entry: Omit<NotificationLog, 'id' | 'created_at'>): Promise<NotificationLog> {
    const id = `ntf-${nanoid(8)}`;
    const now = new Date().toISOString();
    const res = await query<NotificationRow>(
      `INSERT INTO rest_notifications (id, channel, "to", subject, body, status, error, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, entry.channel, entry.to, entry.subject, entry.body, entry.status, entry.error ?? null, now]
    );
    return mapNotification(res.rows[0]);
  },

  async getNotifications(limit = 50): Promise<NotificationLog[]> {
    const res = await query<NotificationRow>(
      'SELECT * FROM rest_notifications ORDER BY created_at DESC LIMIT $1',
      [Math.max(0, limit)]
    );
    return res.rows.map(mapNotification);
  },

  // --- ANALYTICS ---
  async getAnalytics(restaurantId: string): Promise<Analytics> {
    const restaurantOrders = await db.getOrdersByRestaurant(restaurantId);
    const validOrders = restaurantOrders.filter((o) => o.status !== 'cancelled');

    const totalRevenue = validOrders.reduce((sum, o) => sum + o.total, 0);
    const totalOrdersCount = validOrders.length;
    const averageOrderValue = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0;

    const pendingOrdersCount = restaurantOrders.filter(
      (o) => o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'
    ).length;

    // Har bir taom uchun alohida so'rov (N+1) o'rniga — kerakli menu_item_id'larni bitta so'rovda
    // oldindan olib, JS xaritasida qidiramiz.
    const uniqueMenuItemIds = [
      ...new Set(validOrders.flatMap((o) => o.items.map((i) => i.menu_item_id))),
    ];
    const menuItemsRes = uniqueMenuItemIds.length
      ? await query<MenuItemRow>('SELECT * FROM rest_menu_items WHERE id = ANY($1::text[])', [
          uniqueMenuItemIds,
        ])
      : { rows: [] as MenuItemRow[] };
    const menuItemById = new Map(menuItemsRes.rows.map((r) => [r.id, mapMenuItem(r)]));

    const itemSales: Record<string, PopularDish> = {};
    for (const order of validOrders) {
      for (const item of order.items) {
        if (!itemSales[item.name_snapshot]) {
          const menuItem = menuItemById.get(item.menu_item_id);
          itemSales[item.name_snapshot] = {
            name: item.name_snapshot,
            quantity: 0,
            revenue: 0,
            image:
              menuItem?.image_url ||
              'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80',
          };
        }
        itemSales[item.name_snapshot].quantity += item.quantity;
        itemSales[item.name_snapshot].revenue += item.total;
      }
    }

    const popularDishes = Object.values(itemSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    const activeTables = new Set(
      restaurantOrders
        .filter((o) => ['pending', 'confirmed', 'preparing', 'ready', 'delivered'].includes(o.status))
        .map((o) => o.table_id)
    ).size;

    return {
      // "todayRevenue" nomi ilgaridan qolgan — aslida bu jami (all-time) tushum, atayin
      // to'g'irlanmagan (vazifa doirasidan tashqarida).
      todayRevenue: totalRevenue,
      todayOrders: totalOrdersCount,
      averageOrderValue,
      pendingOrdersCount,
      activeTables,
      popularDishes,
    };
  },
};
