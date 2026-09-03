import type {
  Branch,
  MenuCategory,
  MenuItem,
  Order,
  OrderStatus,
  Restaurant,
  SessionRole,
  Staff,
  Table,
  TableResolution,
  WaiterCall,
} from '@/types/database';

// Browser-safe typed client for the server API. Never imports the store.

export interface PopularDish {
  name: string;
  quantity: number;
  revenue: number;
  image: string;
}

export interface Analytics {
  todayRevenue: number;
  todayOrders: number;
  averageOrderValue: number;
  pendingOrdersCount: number;
  activeTables: number;
  popularDishes: PopularDish[];
}

export interface GetOrdersFilters {
  restaurantId?: string;
  branchId?: string;
  tableId?: string;
  /** Faqat shu ofitsiantga biriktirilgan buyurtmalar. */
  waiterId?: string;
  /** Bitta holat yoki holatlar ro'yxati: `['pending', 'confirmed']`. */
  status?: OrderStatus | OrderStatus[];
}

/** Joriy sessiya — `GET /api/auth/me` qaytaradigan ma'lumot. */
export interface SessionInfo {
  role: SessionRole;
  staffId?: string;
  name: string;
}

function buildQuery(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      search.set(key, value);
    }
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

async function request<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body: unknown = await res.json();
      if (
        typeof body === 'object' &&
        body !== null &&
        'error' in body &&
        typeof (body as { error: unknown }).error === 'string'
      ) {
        message = (body as { error: string }).error;
      }
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

async function mutate<T>(url: string, method: 'POST' | 'PATCH', body: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const responseBody: unknown = await res.json();
      if (
        typeof responseBody === 'object' &&
        responseBody !== null &&
        'error' in responseBody &&
        typeof (responseBody as { error: unknown }).error === 'string'
      ) {
        message = (responseBody as { error: string }).error;
      }
    } catch {
      // Non-JSON error body; keep the status-based message.
    }
    throw new Error(message);
  }

  return (await res.json()) as T;
}

export async function getOrders(filters: GetOrdersFilters = {}): Promise<Order[]> {
  const status = Array.isArray(filters.status) ? filters.status.join(',') : filters.status;
  const data = await request<{ orders: Order[] }>(
    `/api/orders${buildQuery({
      restaurant_id: filters.restaurantId,
      branch_id: filters.branchId,
      table_id: filters.tableId,
      waiter_id: filters.waiterId,
      status,
    })}`
  );
  return data.orders;
}

export async function getOrder(id: string): Promise<Order> {
  const data = await request<{ order: Order }>(`/api/orders/${encodeURIComponent(id)}`);
  return data.order;
}

export async function getTables(branchId: string, waiterId?: string): Promise<Table[]> {
  const data = await request<{ tables: Table[] }>(
    `/api/tables${buildQuery({ branch_id: branchId, waiter_id: waiterId })}`
  );
  return data.tables;
}

export async function resolveTable(token: string): Promise<TableResolution> {
  const data = await request<{ resolution: TableResolution }>(
    `/api/tables/resolve${buildQuery({ token })}`
  );
  return data.resolution;
}

export async function getBranches(restaurantId: string): Promise<Branch[]> {
  const data = await request<{ branches: Branch[] }>(
    `/api/branches${buildQuery({ restaurant_id: restaurantId })}`
  );
  return data.branches;
}

export async function getRestaurant(id: string): Promise<Restaurant> {
  const data = await request<{ restaurant: Restaurant }>(
    `/api/restaurants/${encodeURIComponent(id)}`
  );
  return data.restaurant;
}

export type RestaurantUpdate = Partial<
  Omit<Restaurant, 'id' | 'created_at' | 'updated_at'>
>;

export async function updateRestaurant(
  id: string,
  updates: RestaurantUpdate
): Promise<Restaurant> {
  const data = await mutate<{ restaurant: Restaurant }>(
    `/api/restaurants/${encodeURIComponent(id)}`,
    'PATCH',
    updates
  );
  return data.restaurant;
}

export async function getCategories(restaurantId: string): Promise<MenuCategory[]> {
  const data = await request<{ categories: MenuCategory[] }>(
    `/api/categories${buildQuery({ restaurant_id: restaurantId })}`
  );
  return data.categories;
}

export async function getMenuItems(restaurantId: string): Promise<MenuItem[]> {
  const data = await request<{ items: MenuItem[] }>(
    `/api/menu-items${buildQuery({ restaurant_id: restaurantId })}`
  );
  return data.items;
}

export async function getWaiterCalls(branchId: string): Promise<WaiterCall[]> {
  const data = await request<{ calls: WaiterCall[] }>(
    `/api/waiter-calls${buildQuery({ branch_id: branchId })}`
  );
  return data.calls;
}

export async function getStaff(restaurantId: string): Promise<Staff[]> {
  const data = await request<{ staff: Staff[] }>(
    `/api/staff${buildQuery({ restaurant_id: restaurantId })}`
  );
  return data.staff;
}

export type NewStaffInput = Pick<Staff, 'restaurant_id' | 'name' | 'email' | 'role'> &
  Partial<Pick<Staff, 'branch_id'>>;

export async function createStaff(input: NewStaffInput): Promise<Staff> {
  const data = await mutate<{ staff: Staff }>('/api/staff', 'POST', input);
  return data.staff;
}

export async function getAnalytics(restaurantId: string): Promise<Analytics> {
  const data = await request<{ analytics: Analytics }>(
    `/api/analytics${buildQuery({ restaurant_id: restaurantId })}`
  );
  return data.analytics;
}

// ==========================================
// ZAL XIZMATI: STOL VA BUYURTMA AMALLARI
// ==========================================

/** Stolni o'z zimmasiga oladi. Xato bo'lsa — o'zbekcha xabar bilan istisno. */
export async function claimTable(tableId: string): Promise<Table> {
  const data = await mutate<{ table: Table }>(
    `/api/tables/${encodeURIComponent(tableId)}/claim`,
    'POST',
    {}
  );
  return data.table;
}

/** Stolni bo'shatadi (faqat stolni olgan ofitsiant yoki administrator). */
export async function releaseTable(tableId: string): Promise<Table> {
  const data = await mutate<{ table: Table }>(
    `/api/tables/${encodeURIComponent(tableId)}/release`,
    'POST',
    {}
  );
  return data.table;
}

/** Stolni boshqa ofitsiantga uzatadi. */
export async function transferTable(tableId: string, toStaffId: string): Promise<Table> {
  const data = await mutate<{ table: Table }>(
    `/api/tables/${encodeURIComponent(tableId)}/transfer`,
    'POST',
    { to_staff_id: toStaffId }
  );
  return data.table;
}

/** Buyurtmani tasdiqlaydi: 'pending' -> 'confirmed'. */
export async function acceptOrder(orderId: string): Promise<Order> {
  const data = await mutate<{ order: Order }>(
    `/api/orders/${encodeURIComponent(orderId)}/accept`,
    'POST',
    {}
  );
  return data.order;
}

/** Buyurtmani rad etadi: 'pending' -> 'cancelled'. Sabab majburiy. */
export async function rejectOrder(orderId: string, reason: string): Promise<Order> {
  const data = await mutate<{ order: Order }>(
    `/api/orders/${encodeURIComponent(orderId)}/reject`,
    'POST',
    { reason }
  );
  return data.order;
}

/**
 * Joriy sessiyani o'qiydi. Kirilmagan bo'lsa (yoki so'rov muvaffaqiyatsiz bo'lsa)
 * `null` qaytaradi — chaqiruvchi tomonda try/catch shart emas.
 */
export async function getSession(): Promise<SessionInfo | null> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' });
    if (!res.ok) return null;
    const data = (await res.json()) as { session?: SessionInfo | null };
    return data.session ?? null;
  } catch {
    return null;
  }
}
