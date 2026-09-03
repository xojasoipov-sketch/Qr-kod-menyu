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
  NotificationLog
} from '@/types/database';
import { 
  INITIAL_RESTAURANTS, 
  INITIAL_BRANCHES, 
  INITIAL_TABLES, 
  INITIAL_STAFF, 
  INITIAL_CATEGORIES, 
  INITIAL_MENU_ITEMS, 
  INITIAL_ORDERS, 
  INITIAL_WAITER_CALLS 
} from './seed-data';
import { assertValidTransition, STATUS_DISPLAY_INFO } from '../order-state-machine';
import { eventBus, RealtimeEventType } from '../realtime/event-bus';
import { nanoid } from 'nanoid';

/** Stolga oid amallar natijasi — istisno tashlamaydi, doim natija qaytaradi. */
export type TableActionResult =
  | { ok: true; table: Table }
  | { ok: false; error: string };

/** Buyurtmaga oid amallar natijasi — istisno tashlamaydi, doim natija qaytaradi. */
export type OrderActionResult =
  | { ok: true; order: Order }
  | { ok: false; error: string };

/** Hali yakunlanmagan (stol band hisoblanadigan) buyurtma holatlari. */
const UNFINISHED_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready'];

class RestaurantDataStore {
  public restaurants: Restaurant[] = [...INITIAL_RESTAURANTS];
  public branches: Branch[] = [...INITIAL_BRANCHES];
  public tables: Table[] = [...INITIAL_TABLES];
  public staff: Staff[] = [...INITIAL_STAFF];
  public categories: MenuCategory[] = [...INITIAL_CATEGORIES];
  public menuItems: MenuItem[] = [...INITIAL_MENU_ITEMS];
  public orders: Order[] = [...INITIAL_ORDERS];
  public statusHistory: OrderStatusHistory[] = [];
  public waiterCalls: WaiterCall[] = [...INITIAL_WAITER_CALLS];

  /** Xotiradagi fayl ombori: rasm yuklashlar (id -> yozuv + baytlar). */
  public uploads = new Map<string, { record: UploadRecord; bytes: Buffer }>();

  /** Yuborilgan bildirishnomalar jurnali (eng yangisi birinchi, maksimum 200 ta). */
  public notifications: NotificationLog[] = [];

  private orderSeq = 1045;

  // --- RESTAURANT & TENANT RESOLUTION ---
  getRestaurant(id: string): Restaurant | undefined {
    return this.restaurants.find((r) => r.id === id);
  }

  getBranch(id: string): Branch | undefined {
    return this.branches.find((b) => b.id === id);
  }

  getBranchesByRestaurant(restaurantId: string): Branch[] {
    return this.branches.filter((b) => b.restaurant_id === restaurantId);
  }

  // --- TABLE & QR RESOLUTION ---
  getTableByQrToken(qrToken: string): TableResolution | null {
    const table = this.tables.find((t) => t.qr_token === qrToken && t.is_active);
    if (!table) return null;

    const branch = this.branches.find((b) => b.id === table.branch_id && b.is_active);
    if (!branch) return null;

    const restaurant = this.restaurants.find((r) => r.id === branch.restaurant_id && r.is_active);
    if (!restaurant) return null;

    const categories = this.categories
      .filter((c) => c.restaurant_id === restaurant.id && c.is_active)
      .sort((a, b) => a.sort_order - b.sort_order);

    const items = this.menuItems.filter((i) => i.restaurant_id === restaurant.id);

    return {
      restaurant,
      branch,
      table,
      categories,
      items,
    };
  }

  getTable(id: string): Table | undefined {
    return this.tables.find((t) => t.id === id);
  }

  getTablesByBranch(branchId: string): Table[] {
    return this.tables.filter((t) => t.branch_id === branchId);
  }

  // --- STOLNI OFITSIANTGA BIRIKTIRISH (CLAIM / RELEASE / TRANSFER) ---

  /** Ofitsiantga biriktirilgan stollar ro'yxati. */
  getTablesByWaiter(staffId: string): Table[] {
    if (!staffId) return [];
    return this.tables.filter((t) => t.claimed_by === staffId);
  }

  /** Stoldagi hali yakunlanmagan buyurtmalar (pending/confirmed/preparing/ready). */
  private getUnfinishedOrdersByTable(tableId: string): Order[] {
    return this.orders.filter(
      (o) => o.table_id === tableId && UNFINISHED_ORDER_STATUSES.includes(o.status)
    );
  }

  private emitTableEvent(
    type: Extract<RealtimeEventType, 'TABLE_CLAIMED' | 'TABLE_RELEASED'>,
    table: Table,
    staff: { id: string; name: string },
    timestamp: string,
    data?: Record<string, unknown>
  ) {
    const branch = this.getBranch(table.branch_id);
    eventBus.emit({
      type,
      timestamp,
      restaurant_id: branch?.restaurant_id || '',
      branch_id: table.branch_id,
      tableId: table.id,
      table,
      staffId: staff.id,
      staffName: staff.name,
      data,
    });
  }

  /**
   * Stolni ofitsiantga biriktiradi. Idempotent: o'sha ofitsiant qayta chaqirsa ham muvaffaqiyat.
   * Stol boshqa ofitsiantda bo'lsa — xato qaytadi (istisno tashlanmaydi).
   */
  claimTable(tableId: string, staff: { id: string; name: string }): TableActionResult {
    const table = this.getTable(tableId);
    if (!table) {
      return { ok: false, error: 'Stol topilmadi.' };
    }
    if (!table.is_active) {
      return { ok: false, error: 'Bu stol hozirda faol emas.' };
    }
    if (table.claimed_by && table.claimed_by !== staff.id) {
      const owner = table.claimed_by_name || 'boshqa ofitsiant';
      return {
        ok: false,
        error: `Bu stolni ${owner} olgan. Avval u bo'shatishi kerak.`,
      };
    }

    const now = new Date().toISOString();
    const alreadyMine = table.claimed_by === staff.id;

    table.claimed_by = staff.id;
    table.claimed_by_name = staff.name;
    table.claimed_at = alreadyMine ? table.claimed_at || now : now;
    table.updated_at = now;

    this.emitTableEvent('TABLE_CLAIMED', table, staff, now, {
      action: alreadyMine ? 'CLAIM_REPEATED' : 'CLAIMED',
    });

    return { ok: true, table };
  }

  /**
   * Stolni bo'shatadi. Faqat stolni olgan ofitsiant yoki administrator bo'shata oladi.
   * Stolda tugallanmagan buyurtma bo'lsa — hech kimga (admin uchun ham) ruxsat berilmaydi.
   */
  releaseTable(
    tableId: string,
    staff: { id: string; name: string },
    isAdmin: boolean
  ): TableActionResult {
    const table = this.getTable(tableId);
    if (!table) {
      return { ok: false, error: 'Stol topilmadi.' };
    }
    if (!table.claimed_by) {
      return { ok: false, error: 'Bu stol allaqachon bo\'sh — biriktirilgan ofitsiant yo\'q.' };
    }
    if (!isAdmin && table.claimed_by !== staff.id) {
      const owner = table.claimed_by_name || 'boshqa ofitsiant';
      return {
        ok: false,
        error: `Bu stol ${owner} ga biriktirilgan. Uni faqat o'sha ofitsiant yoki administrator bo'shata oladi.`,
      };
    }

    const unfinished = this.getUnfinishedOrdersByTable(table.id);
    if (unfinished.length > 0) {
      const numbers = unfinished.map((o) => o.order_number).join(', ');
      return {
        ok: false,
        error: `Bu stolda ${unfinished.length} ta tugallanmagan buyurtma bor (${numbers}). Avval ularni yakunlang yoki bekor qiling, so'ng stolni bo'shating.`,
      };
    }

    const now = new Date().toISOString();
    const previousOwner = { id: table.claimed_by, name: table.claimed_by_name || '' };

    delete table.claimed_by;
    delete table.claimed_by_name;
    delete table.claimed_at;
    delete table.guest_count;
    table.updated_at = now;

    this.emitTableEvent('TABLE_RELEASED', table, staff, now, {
      action: 'RELEASED',
      released_by_admin: isAdmin && previousOwner.id !== staff.id,
      previous_staff_id: previousOwner.id,
      previous_staff_name: previousOwner.name,
    });

    return { ok: true, table };
  }

  /**
   * Stolni boshqa ofitsiantga uzatadi. Faqat stolni olgan ofitsiant yoki administrator uzata oladi.
   */
  transferTable(
    tableId: string,
    fromStaffId: string,
    toStaff: { id: string; name: string },
    isAdmin: boolean
  ): TableActionResult {
    const table = this.getTable(tableId);
    if (!table) {
      return { ok: false, error: 'Stol topilmadi.' };
    }
    if (!table.is_active) {
      return { ok: false, error: 'Bu stol hozirda faol emas.' };
    }
    if (!toStaff?.id) {
      return { ok: false, error: 'Stol uzatiladigan ofitsiantni tanlang.' };
    }

    const target = this.staff.find((s) => s.id === toStaff.id);
    if (!target) {
      return { ok: false, error: 'Ofitsiant topilmadi.' };
    }
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
      if (!table.claimed_by) {
        return {
          ok: false,
          error: 'Bu stol hech kimga biriktirilmagan. Avval stolni o\'zingizga oling.',
        };
      }
      if (table.claimed_by !== fromStaffId) {
        const owner = table.claimed_by_name || 'boshqa ofitsiant';
        return {
          ok: false,
          error: `Bu stol ${owner} ga biriktirilgan. Uni faqat o'sha ofitsiant yoki administrator uzata oladi.`,
        };
      }
    }

    const now = new Date().toISOString();
    const previousOwner = {
      id: table.claimed_by || '',
      name: table.claimed_by_name || '',
    };

    if (previousOwner.id === toStaff.id) {
      // Idempotent: stol allaqachon o'sha ofitsiantda.
      table.claimed_by_name = targetName;
      table.updated_at = now;
      this.emitTableEvent('TABLE_CLAIMED', table, { id: toStaff.id, name: targetName }, now, {
        action: 'TRANSFER_REPEATED',
      });
      return { ok: true, table };
    }

    table.claimed_by = toStaff.id;
    table.claimed_by_name = targetName;
    table.claimed_at = now;
    table.updated_at = now;

    this.emitTableEvent('TABLE_CLAIMED', table, { id: toStaff.id, name: targetName }, now, {
      action: 'TRANSFERRED',
      previous_staff_id: previousOwner.id,
      previous_staff_name: previousOwner.name,
    });

    return { ok: true, table };
  }

  createTable(data: Omit<Table, 'id' | 'created_at' | 'updated_at' | 'qr_token'> & { qr_token?: string }): Table {
    const newTable: Table = {
      id: `tbl-${nanoid(8)}`,
      ...data,
      qr_token: data.qr_token || nanoid(10),
      is_active: data.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.tables.push(newTable);
    return newTable;
  }

  updateTable(id: string, updates: Partial<Table>): Table | null {
    const idx = this.tables.findIndex((t) => t.id === id);
    if (idx === -1) return null;
    this.tables[idx] = {
      ...this.tables[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    return this.tables[idx];
  }

  updateRestaurant(id: string, updates: Partial<Omit<Restaurant, 'id' | 'created_at'>>): Restaurant | null {
    const idx = this.restaurants.findIndex((r) => r.id === id);
    if (idx === -1) return null;
    this.restaurants[idx] = {
      ...this.restaurants[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    return this.restaurants[idx];
  }

  // --- STAFF (XODIMLAR) ---
  /**
   * PIN kod bo'yicha xodimni topadi. Faqat faol (is_active) xodimlar qidiriladi.
   */
  getStaffByPin(pin: string): Staff | undefined {
    const normalized = String(pin ?? '').trim();
    if (!normalized) return undefined;
    return this.staff.find((s) => s.is_active && s.pin === normalized);
  }

  /** Hech kimga biriktirilmagan tasodifiy 4 xonali PIN kod hosil qiladi. */
  private generateUniquePin(): string {
    const taken = new Set(this.staff.map((s) => s.pin).filter(Boolean) as string[]);
    for (let attempt = 0; attempt < 10000; attempt++) {
      const candidate = String(Math.floor(1000 + Math.random() * 9000));
      if (!taken.has(candidate)) return candidate;
    }
    // Deyarli imkonsiz holat: bo'sh qolgan birinchi kodni ketma-ket qidiramiz.
    for (let n = 1000; n <= 9999; n++) {
      const candidate = String(n);
      if (!taken.has(candidate)) return candidate;
    }
    throw new Error('Bo\'sh PIN kod qolmadi.');
  }

  createStaff(
    data: Omit<Staff, 'id' | 'user_id' | 'is_active' | 'created_at' | 'updated_at'>
  ): Staff {
    const requestedPin = data.pin ? String(data.pin).trim() : '';
    if (requestedPin && this.staff.some((s) => s.pin === requestedPin)) {
      throw new Error('Bu PIN kod allaqachon band. Boshqa kod tanlang.');
    }

    const newStaff: Staff = {
      id: `staff-${nanoid(8)}`,
      user_id: `usr-${nanoid(8)}`,
      ...data,
      phone: data.phone,
      pin: requestedPin || this.generateUniquePin(),
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.staff.push(newStaff);
    return newStaff;
  }

  regenerateQrToken(tableId: string): { table: Table; oldToken: string } | null {
    const table = this.tables.find((t) => t.id === tableId);
    if (!table) return null;
    const oldToken = table.qr_token;
    table.qr_token = nanoid(10);
    table.updated_at = new Date().toISOString();

    eventBus.emit({
      type: 'TABLE_UPDATED',
      timestamp: new Date().toISOString(),
      restaurant_id: this.getBranch(table.branch_id)?.restaurant_id || '',
      tableId: table.id,
      data: { action: 'QR_REGENERATED', new_token: table.qr_token },
    });

    return { table, oldToken };
  }

  // --- MENU CATEGORIES ---
  getCategories(restaurantId: string): MenuCategory[] {
    return this.categories
      .filter((c) => c.restaurant_id === restaurantId)
      .sort((a, b) => a.sort_order - b.sort_order);
  }

  createCategory(data: Omit<MenuCategory, 'id' | 'created_at' | 'updated_at'>): MenuCategory {
    const newCategory: MenuCategory = {
      id: `cat-${nanoid(8)}`,
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.categories.push(newCategory);
    return newCategory;
  }

  updateCategory(id: string, updates: Partial<MenuCategory>): MenuCategory | null {
    const idx = this.categories.findIndex((c) => c.id === id);
    if (idx === -1) return null;
    this.categories[idx] = {
      ...this.categories[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };
    return this.categories[idx];
  }

  deleteCategory(id: string): boolean {
    const initialLen = this.categories.length;
    this.categories = this.categories.filter((c) => c.id !== id);
    return this.categories.length < initialLen;
  }

  // --- MENU ITEMS ---
  getMenuItems(restaurantId: string): MenuItem[] {
    return this.menuItems.filter((i) => i.restaurant_id === restaurantId);
  }

  getMenuItem(id: string): MenuItem | undefined {
    return this.menuItems.find((i) => i.id === id);
  }

  createMenuItem(data: Omit<MenuItem, 'id' | 'created_at' | 'updated_at'>): MenuItem {
    const newItem: MenuItem = {
      id: `item-${nanoid(8)}`,
      ...data,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    this.menuItems.push(newItem);
    return newItem;
  }

  updateMenuItem(id: string, updates: Partial<MenuItem>): MenuItem | null {
    const idx = this.menuItems.findIndex((i) => i.id === id);
    if (idx === -1) return null;
    this.menuItems[idx] = {
      ...this.menuItems[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };

    eventBus.emit({
      type: 'MENU_UPDATED',
      timestamp: new Date().toISOString(),
      restaurant_id: this.menuItems[idx].restaurant_id,
      data: { item: this.menuItems[idx] },
    });

    return this.menuItems[idx];
  }

  deleteMenuItem(id: string): boolean {
    const initialLen = this.menuItems.length;
    this.menuItems = this.menuItems.filter((i) => i.id !== id);
    return this.menuItems.length < initialLen;
  }

  toggleItemAvailability(id: string): MenuItem | null {
    const item = this.getMenuItem(id);
    if (!item) return null;
    return this.updateMenuItem(id, { is_available: !item.is_available });
  }

  // --- ORDERS (WITH SERVER-SIDE SECURITY & PRICE VERIFICATION) ---
  createOrder(params: {
    table_id: string;
    customer_notes?: string;
    items: {
      menu_item_id: string;
      quantity: number;
      selected_options?: SelectedOption[];
      notes?: string;
    }[];
  }): Order {
    const table = this.tables.find((t) => t.id === params.table_id && t.is_active);
    if (!table) {
      throw new Error('Ushbu stol hozirda faol emas.');
    }

    const branch = this.branches.find((b) => b.id === table.branch_id && b.is_active);
    if (!branch) {
      throw new Error('Filial faol emas.');
    }

    const restaurant = this.restaurants.find((r) => r.id === branch.restaurant_id && r.is_active);
    if (!restaurant) {
      throw new Error('Restoran ayni paytda yopiq.');
    }

    if (!params.items || params.items.length === 0) {
      throw new Error('Buyurtmada kamida bitta taom bo\'lishi shart.');
    }

    let calculatedSubtotal = 0;
    const orderItems: OrderItem[] = [];

    for (const orderItemInput of params.items) {
      const dbMenuItem = this.menuItems.find((i) => i.id === orderItemInput.menu_item_id);
      if (!dbMenuItem) {
        throw new Error(`Bunday taom menyuda topilmadi.`);
      }
      if (!dbMenuItem.is_available) {
        throw new Error(`"${dbMenuItem.name}" taomi ayni paytda sotuvda tugagan.`);
      }
      if (orderItemInput.quantity < 1) {
        throw new Error(`Noto'g'ri miqdor kiritildi.`);
      }

      // Calculate unit price + options delta strictly from server data
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
        order_id: '',
        menu_item_id: dbMenuItem.id,
        name_snapshot: dbMenuItem.name,
        price_snapshot: itemUnitPrice,
        quantity: orderItemInput.quantity,
        selected_options: verifiedOptions,
        notes: orderItemInput.notes,
        total: itemTotal,
        created_at: new Date().toISOString(),
      });
    }

    calculatedSubtotal = parseFloat(calculatedSubtotal.toFixed(2));
    const serviceFee = parseFloat(
      ((calculatedSubtotal * (restaurant.service_fee_percentage || 0)) / 100).toFixed(2)
    );
    const grandTotal = parseFloat((calculatedSubtotal + serviceFee).toFixed(2));

    const orderId = `ord-${nanoid(10)}`;
    const orderNumber = `#${this.orderSeq++}`;

    // Attach order_id to items
    orderItems.forEach((oi) => (oi.order_id = orderId));

    const newOrder: Order = {
      id: orderId,
      restaurant_id: restaurant.id,
      branch_id: branch.id,
      table_id: table.id,
      order_number: orderNumber,
      status: 'pending',
      subtotal: calculatedSubtotal,
      service_fee: serviceFee,
      total: grandTotal,
      customer_notes: params.customer_notes,
      items: orderItems,
      table_name: table.name,
      table_number: table.number,
      // Stolni olgan ofitsiant buyurtmaga biriktiriladi. Stol hech kimda bo'lmasa,
      // buyurtma baribir yaratiladi — ofitsiant maydonlari bo'sh qoladi.
      waiter_id: table.claimed_by,
      waiter_name: table.claimed_by_name,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    this.orders.unshift(newOrder);

    this.statusHistory.push({
      id: `osh-${nanoid(8)}`,
      order_id: orderId,
      previous_status: null,
      new_status: 'pending',
      changed_by: 'MIJOZ',
      reason: 'QR kod orqali buyurtma berildi',
      created_at: new Date().toISOString(),
    });

    eventBus.emit({
      type: 'ORDER_CREATED',
      timestamp: newOrder.created_at,
      restaurant_id: restaurant.id,
      branch_id: branch.id,
      order: newOrder,
    });

    return newOrder;
  }

  getOrder(id: string): Order | undefined {
    return this.orders.find((o) => o.id === id);
  }

  getOrdersByBranch(branchId: string): Order[] {
    return this.orders.filter((o) => o.branch_id === branchId);
  }

  getOrdersByRestaurant(restaurantId: string): Order[] {
    return this.orders.filter((o) => o.restaurant_id === restaurantId);
  }

  updateOrderStatus(
    orderId: string,
    targetStatus: OrderStatus,
    changedBy: string,
    reason?: string
  ): Order {
    const order = this.getOrder(orderId);
    if (!order) {
      throw new Error(`Buyurtma topilmadi.`);
    }

    assertValidTransition(order.status, targetStatus);

    const prevStatus = order.status;
    order.status = targetStatus;
    order.updated_at = new Date().toISOString();

    this.statusHistory.push({
      id: `osh-${nanoid(8)}`,
      order_id: order.id,
      previous_status: prevStatus,
      new_status: targetStatus,
      changed_by: changedBy,
      reason,
      created_at: order.updated_at,
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
  }

  /** Ofitsiantga biriktirilgan buyurtmalar. */
  getOrdersByWaiter(staffId: string): Order[] {
    if (!staffId) return [];
    return this.orders.filter((o) => o.waiter_id === staffId);
  }

  private emitOrderStaffEvent(
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

  /**
   * Buyurtmaga ofitsiant biriktiradi. Buyurtma tushganda stol allaqachon kimningdir
   * zimmasida bo'lsa, o'sha biriktiruv saqlanadi; bo'sh bo'lsa — amalni bajargan
   * ofitsiant biriktiriladi (kim tasdiqlagani status tarixida ham qoladi).
   */
  private attachWaiterIfUnassigned(order: Order, staff: { id: string; name: string }) {
    if (!order.waiter_id) {
      order.waiter_id = staff.id;
      order.waiter_name = staff.name;
    }
  }

  /**
   * Ofitsiant buyurtmani tasdiqlaydi: faqat 'pending' holatdan 'confirmed' ga.
   * Shundan keyingina oshxona tayyorlashni boshlay oladi.
   */
  acceptOrder(orderId: string, staff: { id: string; name: string }): OrderActionResult {
    const order = this.getOrder(orderId);
    if (!order) {
      return { ok: false, error: 'Buyurtma topilmadi.' };
    }
    if (order.status !== 'pending') {
      return {
        ok: false,
        error: `Bu buyurtmani tasdiqlab bo'lmaydi — u allaqachon "${STATUS_DISPLAY_INFO[order.status].label}" holatida.`,
      };
    }

    const now = new Date().toISOString();
    const prevStatus = order.status;

    order.status = 'confirmed';
    order.accepted_at = now;
    this.attachWaiterIfUnassigned(order, staff);
    order.updated_at = now;

    this.statusHistory.push({
      id: `osh-${nanoid(8)}`,
      order_id: order.id,
      previous_status: prevStatus,
      new_status: 'confirmed',
      changed_by: 'OFITSIANT',
      reason: `${staff.name} buyurtmani tasdiqladi`,
      created_at: now,
    });

    this.emitOrderStaffEvent('ORDER_ACCEPTED', order, staff, now);

    return { ok: true, order };
  }

  /**
   * Ofitsiant buyurtmani rad etadi: faqat 'pending' holatdan 'cancelled' ga.
   * Sabab majburiy — u buyurtmada saqlanadi va mijozga ko'rsatiladi.
   */
  rejectOrder(
    orderId: string,
    staff: { id: string; name: string },
    reason: string
  ): OrderActionResult {
    const order = this.getOrder(orderId);
    if (!order) {
      return { ok: false, error: 'Buyurtma topilmadi.' };
    }

    const trimmedReason = String(reason ?? '').trim();
    if (!trimmedReason) {
      return { ok: false, error: 'Rad etish sababini yozing.' };
    }

    if (order.status !== 'pending') {
      return {
        ok: false,
        error: `Bu buyurtmani rad etib bo'lmaydi — u allaqachon "${STATUS_DISPLAY_INFO[order.status].label}" holatida.`,
      };
    }

    const now = new Date().toISOString();
    const prevStatus = order.status;

    order.status = 'cancelled';
    order.rejection_reason = trimmedReason;
    this.attachWaiterIfUnassigned(order, staff);
    order.updated_at = now;

    this.statusHistory.push({
      id: `osh-${nanoid(8)}`,
      order_id: order.id,
      previous_status: prevStatus,
      new_status: 'cancelled',
      changed_by: 'OFITSIANT',
      reason: `${staff.name} rad etdi: ${trimmedReason}`,
      created_at: now,
    });

    this.emitOrderStaffEvent('ORDER_REJECTED', order, staff, now, trimmedReason);

    return { ok: true, order };
  }

  // --- WAITER CALLS ---
  callWaiter(params: { table_id: string; call_type?: 'SERVICE' | 'BILL' | 'ASSISTANCE' }): WaiterCall {
    const table = this.tables.find((t) => t.id === params.table_id && t.is_active);
    if (!table) throw new Error('Stol topilmadi');

    const branch = this.branches.find((b) => b.id === table.branch_id);
    if (!branch) throw new Error('Filial topilmadi');

    // Anti-spam check: 45s
    const existingCall = this.waiterCalls.find(
      (c) => c.table_id === table.id && c.status === 'PENDING'
    );
    if (existingCall) {
      const elapsed = Date.now() - new Date(existingCall.created_at).getTime();
      if (elapsed < 45000) {
        throw new Error('Ofitsiantga allaqachon xabar berilgan. Iltimos, ozgina kuting.');
      }
    }

    const newCall: WaiterCall = {
      id: `wc-${nanoid(8)}`,
      restaurant_id: branch.restaurant_id,
      branch_id: branch.id,
      table_id: table.id,
      table_number: table.number,
      table_name: `${table.name}${table.zone ? ` (${table.zone})` : ''}`,
      status: 'PENDING',
      call_type: params.call_type || 'SERVICE',
      created_at: new Date().toISOString(),
    };

    this.waiterCalls.unshift(newCall);

    eventBus.emit({
      type: 'WAITER_CALLED',
      timestamp: newCall.created_at,
      restaurant_id: branch.restaurant_id,
      branch_id: branch.id,
      waiterCall: newCall,
    });

    return newCall;
  }

  acknowledgeWaiterCall(callId: string): WaiterCall {
    const call = this.waiterCalls.find((c) => c.id === callId);
    if (!call) throw new Error('Chaqiruv topilmadi');

    call.status = 'ACKNOWLEDGED';
    call.acknowledged_at = new Date().toISOString();

    eventBus.emit({
      type: 'WAITER_CALL_ACKNOWLEDGED',
      timestamp: call.acknowledged_at,
      restaurant_id: call.restaurant_id,
      branch_id: call.branch_id,
      waiterCall: call,
    });

    return call;
  }

  getWaiterCalls(branchId: string): WaiterCall[] {
    return this.waiterCalls.filter((c) => c.branch_id === branchId && c.status === 'PENDING');
  }

  // --- UPLOADS (RASM YUKLASH) ---
  saveUpload(bytes: Buffer, contentType: string): UploadRecord {
    const record: UploadRecord = {
      id: `up-${nanoid(10)}`,
      content_type: contentType,
      size: bytes.length,
      created_at: new Date().toISOString(),
    };
    this.uploads.set(record.id, { record, bytes });
    return record;
  }

  getUpload(id: string): { record: UploadRecord; bytes: Buffer } | undefined {
    return this.uploads.get(id);
  }

  // --- NOTIFICATIONS (BILDIRISHNOMALAR) ---
  logNotification(entry: Omit<NotificationLog, 'id' | 'created_at'>): NotificationLog {
    const log: NotificationLog = {
      id: `ntf-${nanoid(8)}`,
      ...entry,
      created_at: new Date().toISOString(),
    };
    this.notifications.unshift(log);
    if (this.notifications.length > 200) {
      this.notifications.length = 200;
    }
    return log;
  }

  getNotifications(limit = 50): NotificationLog[] {
    return this.notifications.slice(0, Math.max(0, limit));
  }

  // --- ANALYTICS ---
  getAnalytics(restaurantId: string) {
    const restaurantOrders = this.getOrdersByRestaurant(restaurantId);
    const validOrders = restaurantOrders.filter((o) => o.status !== 'cancelled');

    const totalRevenue = validOrders.reduce((sum, o) => sum + o.total, 0);
    const totalOrdersCount = validOrders.length;
    const averageOrderValue = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0;

    const pendingOrdersCount = restaurantOrders.filter(
      (o) => o.status === 'pending' || o.status === 'confirmed' || o.status === 'preparing'
    ).length;

    const itemSales: Record<string, { name: string; quantity: number; revenue: number; image: string }> = {};
    validOrders.forEach((order) => {
      order.items.forEach((item) => {
        if (!itemSales[item.name_snapshot]) {
          const menuItem = this.menuItems.find((m) => m.id === item.menu_item_id);
          itemSales[item.name_snapshot] = {
            name: item.name_snapshot,
            quantity: 0,
            revenue: 0,
            image: menuItem?.image_url || 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=400&q=80',
          };
        }
        itemSales[item.name_snapshot].quantity += item.quantity;
        itemSales[item.name_snapshot].revenue += item.total;
      });
    });

    const popularDishes = Object.values(itemSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    const activeTables = new Set(
      restaurantOrders
        .filter((o) => ['pending', 'confirmed', 'preparing', 'ready', 'delivered'].includes(o.status))
        .map((o) => o.table_id)
    ).size;

    return {
      todayRevenue: totalRevenue,
      todayOrders: totalOrdersCount,
      averageOrderValue,
      pendingOrdersCount,
      activeTables,
      popularDishes,
    };
  }
}

const globalForStore = globalThis as unknown as { __store?: RestaurantDataStore };
export const db = globalForStore.__store || (globalForStore.__store = new RestaurantDataStore());
