'use client'

/**
 * src/components/waiter/waiter-board.tsx — the waiter console's live root.
 * Source: docs/architecture/05-app-structure.md §6.4 (`<WaiterBoard>` realtime
 * row: "New pending call → <CallAlert> 'TABLE 12 IS CALLING' until
 * acknowledged"); docs/architecture/06-realtime.md (channels, reconnection);
 * brief §10.
 *
 * Three areas — active orders, ready orders, table calls — plus a floor map
 * and, whenever a call is ringing, a banner that cannot be missed. Server
 * data lands as props from `page.tsx`; this component's only job past first
 * paint is staying live:
 *
 *   - `subscribeToBranch` carries both realtime lanes (doc 06 §1.6). The
 *     STATE lane (`postgres_changes` on `orders`/`waiter_calls`) never
 *     patches an item in place here — there is no per-order hydration
 *     endpoint on this console, so every state event schedules a debounced
 *     `router.refresh()`, which re-runs `page.tsx`'s three reads and hands
 *     back a fresh, fully-joined set of props. That is the same fallback the
 *     admin dashboard uses for its own realtime rows (05 §6.4).
 *   - The ALERT lane (`broadcast`) never touches a list. It only fires a
 *     toast — instantly, from the payload's own denormalized fields, with no
 *     round trip — so "a table is calling" is unmistakable the second it
 *     happens, not once the refresh lands a moment later.
 *   - `isRealtimeAvailable()` is false in demo mode or with no Supabase
 *     project; the fallback there is a 10 s poll (doc 05 §6.4's documented
 *     staff cadence), never silence.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BellRing } from 'lucide-react';

import { acknowledgeCallAction, advanceOrderAction, resolveCallAction } from '@/app/(staff)/waiter/actions';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Section } from '@/components/ui/section';
import { toast } from '@/components/ui/toast';
import { useT } from '@/lib/i18n/provider';
import {
  ALERT_DEDUPE_MS,
  BRANCH_EVENTS,
  RESYNC_DEBOUNCE_MS,
  STALE_AFTER_MS,
} from '@/lib/realtime/channels';
import { isRealtimeAvailable } from '@/lib/realtime/manager';
import { subscribeToBranch, type BranchBroadcast } from '@/lib/realtime/subscribe';
import { formatElapsed } from '@/lib/orders/lateness';
import type { KitchenTicket, WaiterCallView } from '@/types/domain';

import { ActiveOrdersPanel } from './active-orders-panel';
import { CALL_ESCALATE_AFTER_SECONDS, TableCallsPanel } from './table-calls-panel';
import { ReadyOrdersPanel } from './ready-orders-panel';
import { TableGrid, type TableGridEntry } from './table-grid';
import type { WaiterCallPendingAction } from './waiter-call-card';

/** Doc 05 §6.4: the staff poll cadence when realtime cannot be reached at all. */
const POLL_INTERVAL_MS = 10_000;

type ConnectionState = 'live' | 'connecting' | 'down';

const CONNECTION_TONE: Record<ConnectionState, BadgeTone> = {
  live: 'success',
  connecting: 'neutral',
  down: 'warning',
};

export type WaiterBoardTable = TableGridEntry;

export interface WaiterBoardProps {
  branchId: string;
  /** Live-recomputed against the shared clock; the DB value from fetch time is not reused. */
  lateThresholdMinutes: number;
  initialTickets: readonly KitchenTicket[];
  initialCalls: readonly WaiterCallView[];
  tables: readonly WaiterBoardTable[];
  /** `restaurants.is_demo` — a labelled tenant, not `isDemoMode()`'s no-Supabase fixture. */
  isDemoTenant: boolean;
}

function callAge(call: WaiterCallView, now: Date): number {
  const started = Date.parse(call.createdAt);
  if (Number.isNaN(started)) return call.ageSeconds;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

function withPending(ids: ReadonlySet<string>, id: string, add: boolean): ReadonlySet<string> {
  const next = new Set(ids);
  if (add) next.add(id);
  else next.delete(id);
  return next;
}

function withCallAction(
  actions: ReadonlyMap<string, WaiterCallPendingAction>,
  id: string,
  action: WaiterCallPendingAction,
): ReadonlyMap<string, WaiterCallPendingAction> {
  const next = new Map(actions);
  if (action === null) next.delete(id);
  else next.set(id, action);
  return next;
}

export function WaiterBoard({
  branchId,
  lateThresholdMinutes,
  initialTickets,
  initialCalls,
  tables,
  isDemoTenant,
}: WaiterBoardProps): React.JSX.Element {
  const t = useT();
  const router = useRouter();

  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const [connection, setConnection] = useState<ConnectionState>(
    isRealtimeAvailable() ? 'connecting' : 'down',
  );
  // Which of a call's two buttons (acknowledge / resolve) is in flight, keyed
  // by call id — a single boolean cannot tell the card which one to spin.
  const [callActionPending, setCallActionPending] = useState<
    ReadonlyMap<string, WaiterCallPendingAction>
  >(new Map());
  const [pendingOrderIds, setPendingOrderIds] = useState<ReadonlySet<string>>(new Set());

  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scheduleRefresh = useCallback((): void => {
    if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      router.refresh();
    }, RESYNC_DEBOUNCE_MS);
  }, [router]);

  // 0, not Date.now(): the staleness effect below only ever runs its interval
  // while connection === 'live', and connection cannot become 'live' without
  // onLive first stamping this ref with a real timestamp — so the initial
  // value is provably never read. Calling Date.now() here would just be an
  // impure call during render for a value nothing observes.
  const lastTrafficRef = useRef<number>(0);
  const alertSeenRef = useRef<Map<string, number>>(new Map());
  const shouldAlert = useCallback((key: string): boolean => {
    const at = Date.now();
    const last = alertSeenRef.current.get(key);
    if (last !== undefined && at - last < ALERT_DEDUPE_MS) return false;
    alertSeenRef.current.set(key, at);
    return true;
  }, []);

  const handleBroadcast = useCallback(
    (payload: BranchBroadcast): void => {
      if (payload.event === BRANCH_EVENTS.waiterCallCreated) {
        const key = `call:${payload.call_id ?? payload.table_number ?? ''}`;
        if (!shouldAlert(key)) return;
        toast({
          tone: 'danger',
          title: t('waiter.newCallTitle', { number: payload.table_number ?? '' }),
          description: payload.reason ? t(`labels.callReason.${payload.reason}`) : undefined,
          duration: 8000,
        });
        return;
      }
      if (payload.event === BRANCH_EVENTS.orderReady) {
        const key = `ready:${payload.order_id ?? payload.order_number ?? ''}`;
        if (!shouldAlert(key)) return;
        toast.success(t('waiter.orderReadyTitle', { number: payload.order_number ?? '' }));
      }
    },
    [shouldAlert, t],
  );

  useEffect(() => {
    if (!isRealtimeAvailable()) {
      setConnection('down');
      const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS);
      return () => clearInterval(id);
    }

    const handle = subscribeToBranch(branchId, {
      onLive: () => {
        setConnection('live');
        lastTrafficRef.current = Date.now();
        scheduleRefresh();
      },
      onDown: () => setConnection('down'),
      onTraffic: () => {
        lastTrafficRef.current = Date.now();
      },
      onProtocolMismatch: () => scheduleRefresh(),
      onPostgres: () => scheduleRefresh(),
      onBroadcast: (payload) => {
        handleBroadcast(payload);
        scheduleRefresh();
      },
    });

    return () => {
      handle.release();
      if (refreshTimerRef.current !== null) clearTimeout(refreshTimerRef.current);
    };
  }, [branchId, handleBroadcast, router, scheduleRefresh]);

  // A channel can sit at SUBSCRIBED while the socket has quietly stopped
  // delivering. Nothing for STALE_AFTER_MS while we believe we are live is
  // the signal to resync anyway, silently.
  useEffect(() => {
    if (connection !== 'live') return;
    const id = setInterval(() => {
      if (Date.now() - lastTrafficRef.current > STALE_AFTER_MS) scheduleRefresh();
    }, 5000);
    return () => clearInterval(id);
  }, [connection, scheduleRefresh]);

  const activeTickets = useMemo(
    () => initialTickets.filter((ticket) => ticket.status !== 'ready'),
    [initialTickets],
  );
  const readyTickets = useMemo(
    () => initialTickets.filter((ticket) => ticket.status === 'ready'),
    [initialTickets],
  );

  const pendingCalls = useMemo(
    () => initialCalls.filter((call) => call.status === 'pending'),
    [initialCalls],
  );
  const oldestPendingCall = useMemo(() => {
    if (pendingCalls.length === 0) return null;
    return [...pendingCalls].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0] ?? null;
  }, [pendingCalls]);

  const handleAcknowledge = useCallback(
    (callId: string) => {
      setCallActionPending((prev) => withCallAction(prev, callId, 'acknowledge'));
      void acknowledgeCallAction({ waiter_call_id: callId }).then((result) => {
        setCallActionPending((prev) => withCallAction(prev, callId, null));
        if (!result.ok) {
          toast.error(t('toasts.actionFailed'));
          return;
        }
        router.refresh();
      });
    },
    [router, t],
  );

  const handleResolve = useCallback(
    (callId: string) => {
      setCallActionPending((prev) => withCallAction(prev, callId, 'resolve'));
      void resolveCallAction({ waiter_call_id: callId }).then((result) => {
        setCallActionPending((prev) => withCallAction(prev, callId, null));
        if (!result.ok) {
          toast.error(t('toasts.actionFailed'));
          return;
        }
        router.refresh();
      });
    },
    [router, t],
  );

  const handleServe = useCallback(
    (orderId: string) => {
      setPendingOrderIds((prev) => withPending(prev, orderId, true));
      void advanceOrderAction({ order_id: orderId, next_status: 'delivered' }).then((result) => {
        setPendingOrderIds((prev) => withPending(prev, orderId, false));
        if (!result.ok) {
          toast.error(t('toasts.actionFailed'));
          return;
        }
        router.refresh();
      });
    },
    [router, t],
  );

  const callingTableNumbers = useMemo(
    () => new Set(initialCalls.filter((call) => call.isOpen).map((call) => call.tableNumber)),
    [initialCalls],
  );
  const activeTableNumbers = useMemo(
    () =>
      new Set(
        activeTickets.map((ticket) => ticket.tableNumber).filter((n): n is string => n !== null),
      ),
    [activeTickets],
  );
  const readyTableNumbers = useMemo(
    () =>
      new Set(
        readyTickets.map((ticket) => ticket.tableNumber).filter((n): n is string => n !== null),
      ),
    [readyTickets],
  );

  return (
    <div className="flex flex-col gap-5 p-4 sm:p-6">
      {/* Assertive, independent of the toast stack (04 §9.5 — one of the four
          places `assertive` is used in the whole product). */}
      <p aria-live="assertive" className="sr-only">
        {oldestPendingCall
          ? `${t('waiter.tableCalling', { number: oldestPendingCall.tableNumber })}. ${t(`labels.callReason.${oldestPendingCall.reason}`)}`
          : ''}
      </p>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {isDemoTenant && (
            <Badge tone="warning" variant="solid">
              {t('states.demo.badge')}
            </Badge>
          )}
        </div>
        <Badge tone={CONNECTION_TONE[connection]} variant="soft">
          {connection === 'live'
            ? t('kitchen.connectionLive')
            : connection === 'connecting'
              ? t('kitchen.connectionReconnecting')
              : t('kitchen.connectionOffline')}
        </Badge>
      </div>

      {oldestPendingCall && (
        <CallBanner
          call={oldestPendingCall}
          ageSeconds={callAge(oldestPendingCall, now)}
          extraCount={pendingCalls.length - 1}
          pending={callActionPending.get(oldestPendingCall.id) === 'acknowledge'}
          onAcknowledge={handleAcknowledge}
        />
      )}

      {tables.length > 0 && (
        <TableGrid
          tables={tables}
          callingNumbers={callingTableNumbers}
          activeNumbers={activeTableNumbers}
          readyNumbers={readyTableNumbers}
        />
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <Section
          title={t('waiter.tabActive')}
          meta={<Badge tone="neutral" variant="soft" size="md">{activeTickets.length}</Badge>}
          contentClassName="lg:max-h-[70dvh] lg:overflow-y-auto"
        >
          <ActiveOrdersPanel tickets={activeTickets} now={now} lateThresholdMinutes={lateThresholdMinutes} />
        </Section>

        <Section
          title={t('waiter.tabReady')}
          meta={<Badge tone="accent" variant="soft" size="md">{readyTickets.length}</Badge>}
          contentClassName="lg:max-h-[70dvh] lg:overflow-y-auto"
        >
          <ReadyOrdersPanel tickets={readyTickets} now={now} pendingIds={pendingOrderIds} onServe={handleServe} />
        </Section>

        <Section
          title={t('waiter.tabCalls')}
          meta={
            <Badge tone={pendingCalls.length > 0 ? 'danger' : 'neutral'} variant="soft" size="md">
              {initialCalls.length}
            </Badge>
          }
          contentClassName="lg:max-h-[70dvh] lg:overflow-y-auto"
        >
          <TableCallsPanel
            calls={initialCalls}
            now={now}
            pendingActions={callActionPending}
            onAcknowledge={handleAcknowledge}
            onResolve={handleResolve}
          />
        </Section>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The banner brief §10 asks for by name.                              */
/* ------------------------------------------------------------------ */

interface CallBannerProps {
  call: WaiterCallView;
  ageSeconds: number;
  extraCount: number;
  pending: boolean;
  onAcknowledge: (id: string) => void;
}

function CallBanner({ call, ageSeconds, extraCount, pending, onAcknowledge }: CallBannerProps): React.JSX.Element {
  const t = useT();
  const escalated = ageSeconds >= CALL_ESCALATE_AFTER_SECONDS;

  return (
    <div role="alert" className="relative flex flex-col gap-3 overflow-hidden rounded-card border border-danger-line bg-danger-soft p-4 ps-6 sm:flex-row sm:items-center sm:justify-between">
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 start-0 w-1.5 bg-danger ${escalated ? 'animate-late-blink' : ''}`}
      />

      <div className="flex items-center gap-3">
        <BellRing aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-10 shrink-0 text-danger" />
        <div className="flex flex-col gap-0.5">
          <p className="text-kds-lg font-bold uppercase text-danger">
            {t('waiter.callBannerTitle', { number: call.tableNumber })}
          </p>
          <p className="text-kds-sm text-text-muted u-tnum">
            {t('waiter.callBannerBody', {
              reason: t(`labels.callReason.${call.reason}`),
              age: t('waiter.callAge', { age: formatElapsed(ageSeconds) }),
            })}
          </p>
          {extraCount > 0 && (
            <p className="text-kds-sm text-text-subtle">
              {t('waiter.tabCalls')} · +{extraCount}
            </p>
          )}
        </div>
      </div>

      <Button variant="danger" size="xl" loading={pending} loadingLabel={t('waiter.acknowledging')} onClick={() => onAcknowledge(call.id)}>
        {t('waiter.acknowledge')}
      </Button>
    </div>
  );
}
