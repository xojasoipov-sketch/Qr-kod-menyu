'use client'

/**
 * The live order tracker.
 *
 * Seeded with a server-rendered `OrderView` so the first paint is correct with
 * JavaScript disabled, then:
 *   - subscribes to `order:<publicCode>` through `subscribeToOrder` (never the
 *     browser client directly) and re-fetches the authoritative order on every
 *     inbound message — the broadcast payload is a nudge to resync, not a
 *     source of truth on its own;
 *   - falls back to polling when realtime is unavailable (demo mode, or no
 *     Supabase project) or fails to join within `JOIN_TIMEOUT_MS`, and while
 *     reconnecting after having been live;
 *   - renders the seven statuses as a progress stepper, with `cancelled`
 *     rendered as an off-path banner rather than a step (its `statusIndex` is
 *     -1);
 *   - shows the cancel affordance ONLY when
 *     `canTransition(order.status, 'cancelled', 'CUSTOMER')` is true;
 *   - releases its channel the moment the order reaches a terminal status —
 *     nothing is left subscribed to a topic that will never publish again.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, CheckCheck, Clock, CookingPot, HandPlatter } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ErrorState } from '@/components/ui/error-state'
import { OrderLineList } from '@/components/customer/order-line-list'
import { OrderStatusCard, type ConnectionState } from '@/components/customer/order-status-card'
import { cancelOrderAction } from '@/app/t/[token]/actions'
import { demoRepository } from '@/lib/demo/demo-mode'
import { isDemoMode } from '@/lib/env'
import type { Translator } from '@/lib/i18n/format'
import { useT } from '@/lib/i18n/provider'
import { toOrderView } from '@/lib/mappers/order-mapper'
import { JOIN_TIMEOUT_MS } from '@/lib/realtime/channels'
import { isRealtimeAvailable, type ChannelHandle } from '@/lib/realtime/manager'
import { subscribeToOrder } from '@/lib/realtime/subscribe'
import { canTransition, isTerminalStatus, ORDER_FORWARD_PATH } from '@/lib/orders/state-machine'
import { getOrder } from '@/lib/rpc/public'
import { cn } from '@/lib/utils/cn'
import { ok, type AppError, type Result } from '@/lib/result'
import type { OrderStatus } from '@/types/database'
import type { OrderView } from '@/types/domain'

const POLL_INTERVAL_MS = 15_000
const NOW_TICK_MS = 30_000

const STEP_ICON: Record<(typeof ORDER_FORWARD_PATH)[number], LucideIcon> = {
  pending: Clock,
  confirmed: Check,
  preparing: CookingPot,
  ready: CheckCheck,
  delivered: HandPlatter,
  completed: CheckCheck,
}

function statusLabelKey(status: OrderStatus): `status.order.${OrderStatus}` {
  return `status.order.${status}`
}

/** `cause.message` from a rejected `onConfirm` is shown verbatim by `<ConfirmDialog>`,
 *  so it must already be the localised sentence, not a wire code or English detail. */
function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`, { seconds: error.retryAfterSeconds ?? 0 })
  return t(`errors.app.${error.code}`, { seconds: error.retryAfterSeconds ?? 0 })
}

async function fetchOrder(token: string, publicCode: string): Promise<Result<OrderView>> {
  const result = isDemoMode()
    ? await demoRepository.getOrder(token, publicCode)
    : await getOrder(token, publicCode)
  if (!result.ok) return result
  return ok(toOrderView(result.data, { qrToken: token }))
}

export interface OrderProgressTrackerProps {
  token: string
  initial: OrderView
}

export function OrderProgressTracker({ token, initial }: OrderProgressTrackerProps): React.JSX.Element {
  const t = useT()
  const publicCode = initial.publicCode

  const [order, setOrder] = useState(initial)
  const [connection, setConnection] = useState<ConnectionState>(
    isRealtimeAvailable() ? 'connecting' : 'polling',
  )
  const [now, setNow] = useState(() => Date.now())

  const [cancelOpen, setCancelOpen] = useState(false)

  const handleRef = useRef<ChannelHandle | null>(null)

  const refetch = useCallback(async () => {
    const result = await fetchOrder(token, publicCode)
    if (result.ok) setOrder(result.data)
  }, [token, publicCode])

  // Keep "placed 5 minutes ago" honest without re-rendering on every tick.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), NOW_TICK_MS)
    return () => clearInterval(id)
  }, [])

  // The subscription itself. Mounts once per order; a status change updates
  // `order` in place rather than re-subscribing.
  useEffect(() => {
    if (isTerminalStatus(initial.status)) {
      setConnection('live')
      return
    }

    if (!isRealtimeAvailable()) {
      setConnection('polling')
      const id = setInterval(() => void refetch(), POLL_INTERVAL_MS)
      return () => clearInterval(id)
    }

    let everLive = false
    let joinTimer: ReturnType<typeof setTimeout> | null = null
    let pollTimer: ReturnType<typeof setInterval> | null = null

    const stopPoll = () => {
      if (pollTimer) {
        clearInterval(pollTimer)
        pollTimer = null
      }
    }
    const startPoll = () => {
      if (!pollTimer) pollTimer = setInterval(() => void refetch(), POLL_INTERVAL_MS)
    }

    const handle = subscribeToOrder(publicCode, {
      onLive: () => {
        everLive = true
        if (joinTimer) {
          clearTimeout(joinTimer)
          joinTimer = null
        }
        stopPoll()
        setConnection('live')
        void refetch()
      },
      onDown: () => {
        setConnection(everLive ? 'reconnecting' : 'connecting')
        startPoll()
      },
      onProtocolMismatch: () => void refetch(),
      onMessage: () => void refetch(),
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
      stopPoll()
      handle.release()
      handleRef.current = null
    }
    // Only the identity of the order being tracked matters here; `refetch` is
    // stable enough (it only closes over `token`/`publicCode`, both fixed for
    // the life of this page) that including it would just churn the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicCode])

  // The moment a live update carries the order into a terminal status, this
  // channel has nothing left to say — release it rather than let it idle.
  useEffect(() => {
    if (isTerminalStatus(order.status) && handleRef.current) {
      handleRef.current.release()
      handleRef.current = null
      setConnection('live')
    }
  }, [order.status])

  const showCancel = canTransition(order.status, 'cancelled', 'CUSTOMER')

  const handleCancel = useCallback(async () => {
    const result = await cancelOrderAction({
      token,
      public_code: publicCode,
      reason: 'Cancelled by the guest from the tracking page.',
    })
    if (!result.ok) {
      // <ConfirmDialog> catches this, stays open and shows the message.
      throw new Error(localizedErrorMessage(t, result.error))
    }
    setOrder(toOrderView(result.data, { qrToken: token }))
    // <ConfirmDialog> closes itself on a resolved onConfirm.
  }, [token, publicCode, t])

  const currentIndex = order.statusIndex

  return (
    <div className="flex flex-col gap-5">
      <OrderStatusCard token={token} order={order} connection={connection} now={now} />

      {order.status === 'cancelled' ? (
        <ErrorState
          title={t('customer.tracking.cancelledTitle')}
          description={order.cancellationReason ?? t('customer.tracking.cancelledBody')}
        />
      ) : (
        <ol className="flex items-start justify-between gap-1">
          {ORDER_FORWARD_PATH.map((status, index) => {
            const Icon = STEP_ICON[status]
            const reached = currentIndex >= index
            const active = currentIndex === index
            return (
              <li key={status} className="flex flex-1 flex-col items-center gap-1.5 text-center">
                <span
                  aria-current={active ? 'step' : undefined}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-full border-2 transition-colors',
                    reached
                      ? 'border-accent bg-accent-strong text-accent-contrast'
                      : 'border-border bg-surface-sunken text-text-subtle',
                    active && 'animate-pulse',
                  )}
                >
                  <Icon aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />
                </span>
                <span className={cn('text-overline uppercase', reached ? 'text-text' : 'text-text-subtle')}>
                  {t(statusLabelKey(status))}
                </span>
              </li>
            )
          })}
        </ol>
      )}

      {showCancel && (
        <>
          <Button variant="danger" size="md" onClick={() => setCancelOpen(true)}>
            {t('customer.tracking.cancelOrder')}
          </Button>

          <ConfirmDialog
            open={cancelOpen}
            onOpenChange={setCancelOpen}
            tone="danger"
            title={t('customer.tracking.cancelConfirmTitle')}
            description={t('customer.tracking.cancelConfirmBody')}
            confirmLabel={t('customer.tracking.cancelOrder')}
            cancelLabel={t('common.cancel')}
            busyLabel={t('common.saving')}
            onConfirm={() => handleCancel()}
          />
        </>
      )}

      <OrderLineList order={order} />
    </div>
  )
}
