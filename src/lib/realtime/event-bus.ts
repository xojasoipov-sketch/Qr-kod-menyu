import { Order, WaiterCall, OrderStatus } from '@/types/database';

export type RealtimeEventType = 
  | 'ORDER_CREATED' 
  | 'ORDER_STATUS_CHANGED' 
  | 'WAITER_CALLED' 
  | 'WAITER_CALL_ACKNOWLEDGED' 
  | 'MENU_UPDATED'
  | 'TABLE_UPDATED';

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
