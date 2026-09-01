'use client'

/**
 * src/components/kitchen/kds-board.tsx — the KDS orchestrator.
 *
 * Seeded with a server-rendered `KitchenTicket[]` (doc 06 §6.3's "loading the
 * board" fetch happens once, in the page) so the first paint is correct
 * before any socket exists, then:
 *
 *   - subscribes to `branch:<branchId>` through `subscribeToBranch` (never
 *     the browser client directly, per the assignment brief) — `postgres_changes`
 *     on `orders` is STATE and only ever triggers a debounced full-board
 *     resync through the server action; `broadcast` `order.created` is ALERT
 *     and only ever triggers the audible + visual cue, never a list mutation
 *     (doc 06 §1.6's two-lane rule);
 *   - falls back to polling every 10 s when realtime is unavailable, fails to
 *     join within `JOIN_TIMEOUT_MS`, or drops after having been live — and
 *     says so via `<ConnectionBadge>`, never silently;
 *   - owns the ONE 1 Hz clock every ticket's elapsed timer and lateness band
 *     reads from, so a lane of forty tickets costs one `setInterval`, not
 *     forty;
 *   - renders one primary action per ticket from `nextStatuses()` (inside
 *     `<KitchenTicketCard>`) with an optimistic status move that reconciles
 *     against whatever the branch channel echoes back;
 *   - ages a `ready` ticket out of the board after `KDS_READY_TTL_MS` even
 *     with no event, because a KITCHEN session's RLS scope never receives the
 *     `ready → delivered` UPDATE that would otherwise remove it (doc 06 §3.1).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import { latenessLevel, type Timed } from '@/lib/orders/lateness'
import type { ActorRole } from '@/lib/orders/state-machine'
import {
  ALERT_DEDUPE_MS,
  BRANCH_EVENTS,
  JOIN_TIMEOUT_MS,
  KDS_READY_TTL_MS,
  KDS_STATUSES,
  RESYNC_DEBOUNCE_MS,
  STALE_AFTER_MS,
} from '@/lib/realtime/channels'
import { isRealtimeAvailable, type ChannelHandle } from '@/lib/realtime/manager'
import { subscribeToBranch } from '@/lib/realtime/subscribe'
import type { AppError, Result } from '@/lib/result'
import type { OrderStatus } from '@/types/database'
import type { KitchenTicket, OrderView } from '@/types/domain'

import { advanceOrderAction, refreshKitchenTicketsAction } from '@/app/(staff)/kitchen/actions'

import type { KdsConnectionState } from './connection-badge'
import { KdsToolbar } from './kds-toolbar'
import { NewOrderAlert, type NewOrderAlertHandle } from './new-order-alert'
import { TicketColumn } from './ticket-column'

const POLL_INTERVAL_MS = 10_000
const KDS_STATUS_SET = new Set<OrderStatus>(KDS_STATUSES)

interface CancelTarget {
  orderId: string
  orderNumber: string
  status: OrderStatus
}

/** Mirrors `order-progress-tracker.tsx`'s convention: wire code first, app code second. */
function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`, { seconds: error.retryAfterSeconds ?? 0 })
  return t(`errors.app.${error.code}`, { seconds: error.retryAfterSeconds ?? 0 })
}

export interface KdsBoardProps {
  initialTickets: readonly KitchenTicket[]
  branchId: string
  branchName: string
  timeZone: string
  lateThresholdMinutes: number
  /** The signed-in staff member's role, exactly as the server derives it. */
  actor: ActorRole
}

export function KdsBoard({
  initialTickets,
  branchId,
  branchName,
  timeZone,
  lateThresholdMinutes,
  actor,
}: KdsBoardProps): React.JSX.Element {
  const t = useT()
  const tRef = useRef(t)
  tRef.current = t

  const [tickets, setTickets] = useState<KitchenTicket[]>(() => [...initialTickets])
  const [connection, setConnection] = useState<KdsConnectionState>(() =>
    isRealtimeAvailable() ? 'connecting' : 'polling',
  )
  const [now, setNow] = useState<number>(() => Date.now())
  const [muted, setMuted] = useState(false)
  const [newIds, setNewIds] = useState<ReadonlySet<string>>(() => new Set())
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(() => new Set())
  const [cancelTarget, setCancelTarget] = useState<CancelTarget | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  const knownIdsRef = useRef<Set<string>>(new Set(initialTickets.map((ticket) => ticket.orderId)))
  const alertSeenRef = useRef<Map<string, number>>(new Map())
  const newOrderAlertRef = useRef<NewOrderAlertHandle>(null)
  const handleRef = useRef<ChannelHandle | null>(null)

  // The single shared clock. Every ticket's elapsed timer and lateness band
  // reads `now`, never `Date.now()` itself (04 §6.3).
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const applyBoard = useCallback((board: readonly KitchenTicket[]) => {
    const nextKnown = new Set<string>()
    const freshlyArrived: string[] = []
    for (const ticket of board) {
      nextKnown.add(ticket.orderId)
      if (!knownIdsRef.current.has(ticket.orderId)) freshlyArrived.push(ticket.orderId)
    }
    knownIdsRef.current = nextKnown
    setTickets([...board])

    if (freshlyArrived.length === 0) return
    setNewIds((prev) => {
      const next = new Set(prev)
      for (const id of freshlyArrived) next.add(id)
      return next
    })
    for (const id of freshlyArrived) {
      setTimeout(() => {
        setNewIds((prev) => {
          if (!prev.has(id)) return prev
          const next = new Set(prev)
          next.delete(id)
          return next
        })
      }, 4000)
    }
  }, [])

  const refetch = useCallback(async (): Promise<void> => {
    const result = await refreshKitchenTicketsAction()
    if (result.ok) applyBoard(result.data)
  }, [applyBoard])

  // The subscription. One branch channel, both transports (doc 06 §1.6):
  // postgres_changes on `orders` is STATE (debounced full resync, never a
  // hand-rolled patch of one row); broadcast `order.created`/`order.cancelled`
  // is ALERT (chime + toast, never a list mutation on its own).
  useEffect(() => {
    if (!isRealtimeAvailable()) {
      setConnection('polling')
      void refetch()
      const id = setInterval(() => void refetch(), POLL_INTERVAL_MS)
      return () => clearInterval(id)
    }

    let everLive = false
    let joinTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null
    let resyncTimer: ReturnType<typeof setTimeout> | null = null
    let staleTimer: ReturnType<typeof setTimeout> | null = null

    const stopPoll = (): void => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
    const startPoll = (): void => {
      if (!pollTimer) pollTimer = setInterval(() => void refetch(), POLL_INTERVAL_MS)
    }
    const scheduleResync = (): void => {
      if (resyncTimer) return
      resyncTimer = setTimeout(() => {
        resyncTimer = null
        void refetch()
      }, RESYNC_DEBOUNCE_MS)
    }
    const armStaleWatch = (): void => {
      if (staleTimer) clearTimeout(staleTimer)
      staleTimer = setTimeout(() => void refetch(), STALE_AFTER_MS)
    }

    const handle = subscribeToBranch(branchId, {
      onLive: () => {
        everLive = true
        if (joinTimer) {
          clearTimeout(joinTimer)
          joinTimer = null
        }
        stopPoll()
        setConnection('live')
        armStaleWatch()
        void refetch()
      },
      onDown: () => {
        setConnection(everLive ? 'reconnecting' : 'connecting')
        startPoll()
      },
      onTraffic: () => armStaleWatch(),
      onProtocolMismatch: () => scheduleResync(),
      onPostgres: (event) => {
        if (event.table === 'orders') scheduleResync()
      },
      onBroadcast: (payload) => {
        if (payload.event === BRANCH_EVENTS.orderCreated) {
          const key = payload.order_id ?? `${payload.order_number ?? ''}:${payload.at ?? ''}`
          const lastSeen = alertSeenRef.current.get(key) ?? 0
          const nowMs = Date.now()
          if (nowMs - lastSeen < ALERT_DEDUPE_MS) return
          alertSeenRef.current.set(key, nowMs)
          newOrderAlertRef.current?.notify({
            orderNumber: payload.order_number ?? '',
            tableLabel: payload.table_number ?? null,
            itemCount: payload.item_count ?? 0,
          })
        } else if (payload.event === BRANCH_EVENTS.orderCancelled && payload.order_number) {
          toast.warning(tRef.current('toasts.orderCancelled', { number: payload.order_number }))
        }
      },
    })
    handleRef.current = handle

    joinTimer = setTimeout(() => {
      if (!everLive) {
        setConnection('polling')
        startPoll()
      }
    }, JOIN_TIMEOUT_MS)

    return () => {
      if (joinTimer) clearTimeout(joinTimer)
      if (resyncTimer) clearTimeout(resyncTimer)
      if (staleTimer) clearTimeout(staleTimer)
      stopPoll()
      handle.release()
      handleRef.current = null
    }
    // `refetch` is stable (only closes over stable setters/refs); including
    // it would not change behaviour but re-subscribing on branch identity
    // alone matches the customer tracker's own convention.
  }, [branchId, refetch])

  const handleAdvance = useCallback(
    (ticket: KitchenTicket, next: OrderStatus) => {
      const { orderId, status: from } = ticket
      setPendingIds((prev) => new Set(prev).add(orderId))
      setTickets((prev) => prev.map((item) => (item.orderId === orderId ? { ...item, status: next } : item)))

      void (async () => {
        const result: Result<OrderView> = await advanceOrderAction({
          order_id: orderId,
          expected_status: from,
          next_status: next,
          cancellation_reason: null,
        })

        setPendingIds((prev) => {
          const nextSet = new Set(prev)
          nextSet.delete(orderId)
          return nextSet
        })

        if (!result.ok) {
          setTickets((prev) => prev.map((item) => (item.orderId === orderId ? { ...item, status: from } : item)))
          toast.error(t('toasts.actionFailed'), { description: localizedErrorMessage(t, result.error) })
          return
        }

        if (!KDS_STATUS_SET.has(result.data.status)) {
          setTickets((prev) => prev.filter((item) => item.orderId !== orderId))
        }
      })()
    },
    [t],
  )

  const handleRequestCancel = useCallback((ticket: KitchenTicket) => {
    setCancelReason('')
    setCancelTarget({ orderId: ticket.orderId, orderNumber: ticket.orderNumber, status: ticket.status })
  }, [])

  const handleCancelConfirm = useCallback(async () => {
    if (!cancelTarget) return
    const reason = cancelReason.trim()
    if (reason.length === 0) return

    setCancelBusy(true)
    const result = await advanceOrderAction({
      order_id: cancelTarget.orderId,
      expected_status: cancelTarget.status,
      next_status: 'cancelled' satisfies OrderStatus,
      cancellation_reason: reason,
    })
    setCancelBusy(false)

    if (!result.ok) {
      toast.error(t('toasts.actionFailed'), { description: localizedErrorMessage(t, result.error) })
      return
    }

    setTickets((prev) => prev.filter((item) => item.orderId !== cancelTarget.orderId))
    setCancelTarget(null)
  }, [cancelTarget, cancelReason, t])

  // A `ready` ticket a KITCHEN session will never see leave (doc 06 §3.1)
  // ages out of the board instead of sitting there forever.
  const visibleTickets = useMemo(
    () =>
      tickets.filter((ticket) => {
        if (ticket.status !== 'ready' || !ticket.readyAt) return true
        return now - Date.parse(ticket.readyAt) <= KDS_READY_TTL_MS
      }),
    [tickets, now],
  )

  const laneTickets = useMemo(() => {
    const lanes: { new: KitchenTicket[]; preparing: KitchenTicket[]; ready: KitchenTicket[] } = {
      new: [],
      preparing: [],
      ready: [],
    }
    for (const ticket of visibleTickets) {
      if (ticket.status === 'preparing') lanes.preparing.push(ticket)
      else if (ticket.status === 'ready') lanes.ready.push(ticket)
      else lanes.new.push(ticket)
    }
    return lanes
  }, [visibleTickets])

  const lateCount = useMemo(() => {
    const nowDate = new Date(now)
    let count = 0
    for (const ticket of visibleTickets) {
      const timed: Timed = {
        created_at: ticket.placedAt,
        confirmed_at: ticket.confirmedAt,
        preparation_minutes: ticket.estimatedPrepMinutes,
        status: ticket.status,
      }
      if (latenessLevel(timed, lateThresholdMinutes, nowDate) === 'late') count += 1
    }
    return count
  }, [visibleTickets, now, lateThresholdMinutes])

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <KdsToolbar
        branchName={branchName}
        timeZone={timeZone}
        now={now}
        connection={connection}
        lateCount={lateCount}
        muted={muted}
        onToggleMuted={() => setMuted((prev) => !prev)}
      />

      <NewOrderAlert ref={newOrderAlertRef} muted={muted} />

      <div
        id="kds-main"
        className="grid min-h-0 flex-1 grid-cols-1 gap-(--space-kds-lane-gap) overflow-hidden p-(--space-kds-lane-gap) md:grid-cols-3"
      >
        <TicketColumn
          lane="new"
          tickets={laneTickets.new}
          actor={actor}
          now={now}
          lateThresholdMinutes={lateThresholdMinutes}
          newIds={newIds}
          pendingIds={pendingIds}
          onAdvance={handleAdvance}
          onRequestCancel={handleRequestCancel}
        />
        <TicketColumn
          lane="preparing"
          tickets={laneTickets.preparing}
          actor={actor}
          now={now}
          lateThresholdMinutes={lateThresholdMinutes}
          newIds={newIds}
          pendingIds={pendingIds}
          onAdvance={handleAdvance}
          onRequestCancel={handleRequestCancel}
        />
        <TicketColumn
          lane="ready"
          tickets={laneTickets.ready}
          actor={actor}
          now={now}
          lateThresholdMinutes={lateThresholdMinutes}
          newIds={newIds}
          pendingIds={pendingIds}
          onAdvance={handleAdvance}
          onRequestCancel={handleRequestCancel}
        />
      </div>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open && !cancelBusy) setCancelTarget(null)
        }}
        title={t('admin.orders.cancelOrder')}
        description={cancelTarget ? t('admin.orders.detailTitle', { number: cancelTarget.orderNumber }) : undefined}
        dismissible={!cancelBusy}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setCancelTarget(null)} disabled={cancelBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              onClick={() => void handleCancelConfirm()}
              loading={cancelBusy}
              loadingLabel={t('common.saving')}
              disabled={cancelReason.trim().length === 0}
            >
              {t('admin.orders.cancelOrder')}
            </Button>
          </div>
        }
      >
        <Textarea
          label={t('admin.orders.cancelReasonLabel')}
          placeholder={t('admin.orders.cancelReasonPlaceholder')}
          value={cancelReason}
          onChange={(event) => setCancelReason(event.target.value)}
          rows={3}
          maxLength={300}
        />
      </Dialog>
    </div>
  )
}
