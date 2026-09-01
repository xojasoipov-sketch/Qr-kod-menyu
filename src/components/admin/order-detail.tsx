'use client'

/**
 * src/components/admin/order-detail.tsx — one order, staff-side (brief §11,
 * §26).
 *
 * Seeded server-side with a real `OrderView`; every status button on screen
 * comes straight from `nextStatuses(order.status, actor)`
 * (`@/lib/orders/state-machine`) — the same table `assertTransition` checks
 * against — so a button that would produce QR040 never renders in the first
 * place. The tap still round-trips through `updateOrderStatusAction` /
 * `cancelOrderAction`, whose compare-and-swap in `order-service.ts` is the
 * real authority: this component reconciles against whatever comes back
 * rather than trusting its own optimism.
 */

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, ClipboardX, Users } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { StatusPill } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { formatDateTime, formatMoney, type Translator } from '@/lib/i18n/format'
import { useLocale, useT } from '@/lib/i18n/provider'
import type { Locale } from '@/lib/i18n/types'
import { RESYNC_DEBOUNCE_MS } from '@/lib/realtime/channels'
import { isRealtimeAvailable } from '@/lib/realtime/manager'
import { subscribeToBranch } from '@/lib/realtime/subscribe'
import { nextStatuses, type ActorRole } from '@/lib/orders/state-machine'
import type { AppError } from '@/lib/result'
import type { I18nText } from '@/types/i18n'
import type { OrderStatus } from '@/types/database'
import type { OrderView } from '@/types/domain'

import { cancelOrderAction, updateOrderStatusAction } from '@/app/(admin)/admin/actions'

export interface OrderDetailProps {
  orderId: string
  order: OrderView
  branchId: string
  actor: ActorRole
  currency: string
  currencyDecimals: number
  timezone: string
}

function pickText(text: I18nText, locale: Locale): string {
  return text[locale] ?? text.en ?? text.ru ?? text.uz ?? ''
}

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`, { seconds: error.retryAfterSeconds ?? 0 })
  return t(`errors.app.${error.code}`, { seconds: error.retryAfterSeconds ?? 0 })
}

export function OrderDetail({
  orderId,
  order: initialOrder,
  branchId,
  actor,
  currency,
  currencyDecimals,
  timezone,
}: OrderDetailProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()

  const [order, setOrder] = useState(initialOrder)
  const [pendingStatus, setPendingStatus] = useState<OrderStatus | null>(null)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelBusy, setCancelBusy] = useState(false)

  useEffect(() => setOrder(initialOrder), [initialOrder])

  const money = useCallback((amount: number) => formatMoney(amount, currency, currencyDecimals, locale), [
    currency,
    currencyDecimals,
    locale,
  ])

  useEffect(() => {
    if (!isRealtimeAvailable()) return
    let resyncTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleResync = (): void => {
      if (resyncTimer) return
      resyncTimer = setTimeout(() => {
        resyncTimer = null
        router.refresh()
      }, RESYNC_DEBOUNCE_MS)
    }
    const handle = subscribeToBranch(branchId, {
      onLive: () => {},
      onDown: () => {},
      onProtocolMismatch: () => scheduleResync(),
      onPostgres: (event) => {
        if (event.table === 'orders') scheduleResync()
      },
      onBroadcast: () => {},
    })
    return () => {
      if (resyncTimer) clearTimeout(resyncTimer)
      handle.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId])

  const advance = useCallback(
    async (next: OrderStatus) => {
      setPendingStatus(next)
      const result = await updateOrderStatusAction({
        order_id: orderId,
        expected_status: order.status,
        next_status: next,
      })
      setPendingStatus(null)
      if (result.ok) {
        setOrder(result.data)
        toast.success(t('toasts.statusUpdated', { number: result.data.orderNumber, status: t(`status.order.${result.data.status}`) }))
      } else {
        toast.error(localizedErrorMessage(t, result.error))
        router.refresh()
      }
    },
    [order.status, orderId, router, t],
  )

  const confirmCancel = useCallback(async () => {
    const trimmed = cancelReason.trim()
    if (trimmed.length === 0) return
    setCancelBusy(true)
    const result = await cancelOrderAction({
      order_id: orderId,
      expected_status: order.status,
      reason: trimmed,
    })
    setCancelBusy(false)
    if (result.ok) {
      setOrder(result.data)
      setCancelOpen(false)
      setCancelReason('')
      toast.success(t('toasts.orderCancelled', { number: result.data.orderNumber }))
    } else {
      toast.error(localizedErrorMessage(t, result.error))
    }
  }, [cancelReason, order.status, orderId, t])

  const forward = nextStatuses(order.status, actor).filter((status) => status !== 'cancelled')
  const canCancel = nextStatuses(order.status, actor).includes('cancelled')

  return (
    <div className="flex flex-col gap-6">
      <Card padding="md" className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <StatusPill kind="order" status={order.status} label={t(`status.order.${order.status}`)} size="md" />
          <span className="inline-flex items-center gap-1.5 text-admin-sm text-text-muted">
            <CalendarClock aria-hidden="true" focusable="false" className="u-icon-align size-4" strokeWidth={1.75} />
            {formatDateTime(order.placedAt, locale, timezone)}
          </span>
          {order.guestCount !== null && (
            <span className="inline-flex items-center gap-1.5 text-admin-sm text-text-muted">
              <Users aria-hidden="true" focusable="false" className="u-icon-align size-4" strokeWidth={1.75} />
              {t.n('plurals.guests', order.guestCount)}
            </span>
          )}
          {order.tableNumber && (
            <span className="text-admin-sm text-text-muted">{order.tableNumber}</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {forward.map((status) => (
            <Button
              key={status}
              variant="primary"
              size="sm"
              loading={pendingStatus === status}
              onClick={() => void advance(status)}
            >
              {t(`status.order.${status}`)}
            </Button>
          ))}
          {canCancel && (
            <Button
              variant="danger"
              size="sm"
              iconStart={<ClipboardX className="size-4" strokeWidth={1.75} />}
              onClick={() => setCancelOpen(true)}
            >
              {t('admin.orders.cancelOrder')}
            </Button>
          )}
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card padding="md" className="flex flex-col gap-3 lg:col-span-2">
          <h2 className="text-admin-h3 text-text">{t('admin.orders.detailItems')}</h2>
          <ul className="flex flex-col divide-y divide-border-subtle">
            {order.lines.map((line) => (
              <li key={line.id} className="flex flex-col gap-1 py-3 first:pt-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-admin-body text-text">
                    <span className="me-2 u-tnum text-text-subtle">{line.quantity}×</span>
                    {pickText(line.name, locale)}
                  </span>
                  <span className="u-tnum text-admin-body text-text">{money(line.lineTotal)}</span>
                </div>
                {line.options.length > 0 && (
                  <p className="text-admin-sm text-text-subtle">
                    {line.options.map((option) => pickText(option.name, locale)).join(' · ')}
                  </p>
                )}
                {line.note && <p className="text-admin-sm text-text-muted">{line.note}</p>}
              </li>
            ))}
          </ul>

          {order.note && (
            <p className="rounded-control bg-surface-sunken p-3 text-admin-sm text-text-muted">{order.note}</p>
          )}
        </Card>

        <div className="flex flex-col gap-4">
          <Card padding="md" className="flex flex-col gap-2">
            <h2 className="text-admin-h3 text-text">{t('admin.orders.detailTotals')}</h2>
            <div className="flex items-baseline justify-between text-admin-body">
              <span className="text-text-muted">{t('customer.cart.subtotal')}</span>
              <span className="u-tnum text-text">{money(order.subtotal)}</span>
            </div>
            {order.discountTotal > 0 && (
              <div className="flex items-baseline justify-between text-admin-body">
                <span className="text-text-muted">{t('customer.cart.discount')}</span>
                <span className="u-tnum text-text">-{money(order.discountTotal)}</span>
              </div>
            )}
            {order.serviceFee > 0 && (
              <div className="flex items-baseline justify-between text-admin-body">
                <span className="text-text-muted">{t('customer.cart.serviceFee')}</span>
                <span className="u-tnum text-text">{money(order.serviceFee)}</span>
              </div>
            )}
            <div className="flex items-baseline justify-between border-t border-border pt-2 text-admin-body font-medium">
              <span className="text-text">{t('common.total')}</span>
              <span className="u-tnum text-text">{money(order.total)}</span>
            </div>
            {order.cancellationReason && (
              <p className="mt-1 text-admin-sm text-danger">{order.cancellationReason}</p>
            )}
          </Card>

          <Card padding="md" className="flex flex-col gap-2">
            <h2 className="text-admin-h3 text-text">{t('admin.orders.detailTimeline')}</h2>
            <ol className="flex flex-col gap-2">
              {order.history.map((event, index) => (
                <li key={`${event.status}-${index}`} className="flex items-center justify-between gap-3 text-admin-sm">
                  <StatusPill
                    kind="order"
                    status={event.status}
                    label={t(`status.order.${event.status}`)}
                    size="sm"
                    showDot={false}
                  />
                  <span className="u-tnum text-text-subtle">{formatDateTime(event.at, locale, timezone)}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Dialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('admin.orders.cancelOrder')}
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCancelOpen(false)} disabled={cancelBusy}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              loading={cancelBusy}
              disabled={cancelReason.trim().length === 0}
              onClick={() => void confirmCancel()}
            >
              {t('common.confirm')}
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
          maxLength={400}
          hint={t('admin.orders.cancelReasonRequired')}
        />
      </Dialog>
    </div>
  )
}
