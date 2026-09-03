export type UserRole = 
  | 'SUPER_ADMIN' 
  | 'RESTAURANT_OWNER' 
  | 'MANAGER' 
  | 'WAITER' 
  | 'KITCHEN';

export type OrderStatus = 
  | 'pending' 
  | 'confirmed' 
  | 'preparing' 
  | 'ready' 
  | 'delivered' 
  | 'completed' 
  | 'cancelled';

export interface Restaurant {
  id: string;
  name: string;
  slug: string;
  logo_url: string;
  banner_url?: string;
  tagline?: string;
  currency: string;
  currency_symbol: string;
  service_fee_percentage: number;
  phone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Branch {
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

export interface Table {
  id: string;
  branch_id: string;
  name: string;
  number: number;
  qr_token: string;
  capacity?: number;
  zone?: string; // e.g. 'Indoor Main Hall', 'Terrace', 'VIP Lounge'
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Staff {
  id: string;
  restaurant_id: string;
  branch_id?: string;
  user_id: string;
  name: string;
  email: string;
  role: UserRole;
  phone?: string;
  /** 4-digit staff login code used by the PIN login screen. */
  pin?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuCategory {
  id: string;
  restaurant_id: string;
  branch_id?: string;
  name: string;
  slug: string;
  icon?: string;
  image_url?: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MenuItemOption {
  id: string;
  name: string; // e.g. "Extra Truffle Sauce", "Medium Rare", "Double Cheese"
  price: number;
}

export interface MenuItemOptionGroup {
  id: string;
  name: string; // e.g. "Preparation Preference", "Choose Extra Toppings"
  required: boolean;
  multiple: boolean;
  options: MenuItemOption[];
}

export interface MenuItem {
  id: string;
  restaurant_id: string;
  branch_id?: string;
  category_id: string;
  name: string;
  description: string;
  price: number;
  image_url: string;
  ingredients: string[];
  dietary_flags?: ('halal' | 'vegan' | 'vegetarian' | 'gluten_free' | 'chef_special')[];
  spicy_level: number; // 0 to 3
  preparation_time: number; // in minutes
  is_available: boolean;
  is_featured?: boolean;
  option_groups?: MenuItemOptionGroup[];
  created_at: string;
  updated_at: string;
}

export interface SelectedOption {
  group_id: string;
  group_name: string;
  option_id: string;
  option_name: string;
  price: number;
}

export interface CartItem {
  item: MenuItem;
  quantity: number;
  selected_options: SelectedOption[];
  notes?: string;
}

export interface OrderItem {
  id: string;
  order_id: string;
  menu_item_id: string;
  name_snapshot: string;
  price_snapshot: number;
  quantity: number;
  selected_options?: SelectedOption[];
  notes?: string;
  total: number;
  created_at: string;
}

export interface Order {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  order_number: string; // human-readable e.g. "#1042"
  status: OrderStatus;
  subtotal: number;
  service_fee: number;
  total: number;
  customer_notes?: string;
  items: OrderItem[];
  table_name?: string;
  table_number?: number;
  created_at: string;
  updated_at: string;
}

export interface OrderStatusHistory {
  id: string;
  order_id: string;
  previous_status: OrderStatus | null;
  new_status: OrderStatus;
  changed_by: string; // 'CUSTOMER' | 'KITCHEN' | 'WAITER' | 'ADMIN'
  reason?: string;
  created_at: string;
}

export interface WaiterCall {
  id: string;
  restaurant_id: string;
  branch_id: string;
  table_id: string;
  table_number: number;
  table_name: string;
  status: 'PENDING' | 'ACKNOWLEDGED' | 'COMPLETED';
  call_type: 'SERVICE' | 'BILL' | 'ASSISTANCE';
  created_at: string;
  acknowledged_at?: string;
}

export interface TableResolution {
  restaurant: Restaurant;
  branch: Branch;
  table: Table;
  categories: MenuCategory[];
  items: MenuItem[];
}

// ==========================================
// SESSIYA / AUTENTIFIKATSIYA
// ==========================================

export type SessionRole = 'ADMIN' | 'WAITER' | 'KITCHEN';

// ==========================================
// FAYL YUKLASH (UPLOAD)
// ==========================================

export interface UploadRecord {
  id: string;
  content_type: string;
  size: number;
  created_at: string;
}

// ==========================================
// BILDIRISHNOMALAR (NOTIFICATIONS)
// ==========================================

export type NotificationChannel = 'console' | 'email' | 'sms' | 'telegram';

export interface NotificationLog {
  id: string;
  channel: NotificationChannel;
  to: string;
  subject: string;
  body: string;
  status: 'sent' | 'failed' | 'skipped';
  error?: string;
  created_at: string;
}
