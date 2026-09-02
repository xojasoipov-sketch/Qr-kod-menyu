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
  SelectedOption
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
import { assertValidTransition } from '../order-state-machine';
import { eventBus } from '../realtime/event-bus';
import { nanoid } from 'nanoid';

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
