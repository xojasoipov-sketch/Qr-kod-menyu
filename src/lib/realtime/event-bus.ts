import { Order, WaiterCall, OrderStatus, Table } from '@/types/database';

/**
 * Hodisa turlarining YAGONA manbasi.
 *
 * Bu ro'yxat va `RealtimeEventType` turi bir joydan kelib chiqadi, brauzer
 * tomoni ham (`@/lib/use-realtime`) shu ro'yxatni import qiladi. Ilgari
 * ro'yxat ikki joyda qo'lda saqlanardi va aynan shu sabab yangi hodisalar
 * brauzergacha yetib bormay qolgan edi: tur qo'shilgan, ro'yxat esa eski
 * qolgan. Endi yangi hodisa qo'shish uchun faqat shu massivga qator
 * qo'shiladi — qolgan hamma joy avtomatik yangilanadi.
 */
export const REALTIME_EVENT_TYPES = [
  'ORDER_CREATED',
  'ORDER_STATUS_CHANGED',
  'WAITER_CALLED',
  'WAITER_CALL_ACKNOWLEDGED',
  'MENU_UPDATED',
  'TABLE_UPDATED',
  'TABLE_CLAIMED',
  'TABLE_RELEASED',
  'ORDER_ACCEPTED',
  'ORDER_REJECTED',
] as const;

export type RealtimeEventType = (typeof REALTIME_EVENT_TYPES)[number];

export interface RealtimePayload {
  type: RealtimeEventType;
  timestamp: string;
  restaurant_id: string;
  branch_id?: string;
  order?: Order;
  waiterCall?: WaiterCall;
  orderId?: string;
  newStatus?: OrderStatus;
  tableId?: string;
  /** Stol bilan bog'liq hodisalarda (TABLE_CLAIMED / TABLE_RELEASED) stolning to'liq holati. */
  table?: Table;
  /** Amalni bajargan xodim id si. */
  staffId?: string;
  /** Amalni bajargan xodim ismi. */
  staffName?: string;
  /** Rad etish yoki bekor qilish sababi. */
  reason?: string;
  data?: Record<string, unknown>;
}

type EventListener = (payload: RealtimePayload) => void;

class RealtimeEventBus {
  private listeners: Set<EventListener> = new Set();

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(payload: RealtimePayload) {
    // Notify in-process listeners
    this.listeners.forEach((listener) => {
      try {
        listener(payload);
      } catch (err) {
        console.error('Error in realtime event listener:', err);
      }
    });
  }
}

// Global singleton across server/module lifecycle
const globalForBus = globalThis as unknown as { __eventBus?: RealtimeEventBus };
export const eventBus = globalForBus.__eventBus || (globalForBus.__eventBus = new RealtimeEventBus());
