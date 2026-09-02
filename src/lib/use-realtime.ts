'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimePayload, RealtimeEventType } from '@/lib/realtime/event-bus';

export interface RealtimeFilters {
  restaurantId?: string;
  branchId?: string;
  orderId?: string;
}

const KNOWN_EVENT_TYPES: ReadonlySet<RealtimeEventType> = new Set<RealtimeEventType>([
  'ORDER_CREATED',
  'ORDER_STATUS_CHANGED',
  'WAITER_CALLED',
  'WAITER_CALL_ACKNOWLEDGED',
  'MENU_UPDATED',
  'TABLE_UPDATED',
]);

function isRealtimePayload(value: unknown): value is RealtimePayload {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as { type?: unknown; restaurant_id?: unknown; timestamp?: unknown };
  return (
    typeof candidate.type === 'string' &&
    KNOWN_EVENT_TYPES.has(candidate.type as RealtimeEventType) &&
    typeof candidate.restaurant_id === 'string' &&
    typeof candidate.timestamp === 'string'
  );
}

const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;

export function useRealtime(
  filters: RealtimeFilters,
  onEvent: (payload: RealtimePayload) => void
): { connected: boolean } {
  const [connected, setConnected] = useState(false);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  const { restaurantId, branchId, orderId } = filters;

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return;

    const search = new URLSearchParams();
    if (restaurantId) search.set('restaurant_id', restaurantId);
    if (branchId) search.set('branch_id', branchId);
    if (orderId) search.set('order_id', orderId);
    const query = search.toString();
    const url = `/api/realtime${query ? `?${query}` : ''}`;

    let active = true;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = INITIAL_BACKOFF_MS;

    const closeSource = () => {
      if (source) {
        source.onopen = null;
        source.onmessage = null;
        source.onerror = null;
        source.close();
        source = null;
      }
    };

    const connect = () => {
      if (!active) return;
      closeSource();

      const es = new EventSource(url);
      source = es;

      es.onopen = () => {
        if (!active || source !== es) return;
        backoff = INITIAL_BACKOFF_MS;
        setConnected(true);
      };

      es.onmessage = (event: MessageEvent<string>) => {
        if (!active || source !== es) return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        // The server's CONNECTED keepalive and any other non-domain message are ignored.
        if (!isRealtimePayload(parsed)) return;
        onEventRef.current(parsed);
      };

      es.onerror = () => {
        if (!active || source !== es) return;
        setConnected(false);
        closeSource();
        const delay = backoff;
        backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connect();
        }, delay);
      };
    };

    connect();

    return () => {
      active = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      closeSource();
      setConnected(false);
    };
  }, [restaurantId, branchId, orderId]);

  return { connected };
}
