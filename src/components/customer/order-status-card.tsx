'use client'

/**
 * The headline card of the order-tracking page: order number, table, current
 * status in plain language, the realtime connection state, and the "Call the
 * waiter" trigger (which owns its own `<WaiterCallSheet>`).
 *
 * Purely presentational for the order itself — `<OrderProgressTracker>` is the
 * one place that owns the live subscription and hands this component whatever
 * it currently believes the order's state is.
 */

import { useState } from 'react'
import { BellRing, Wifi, WifiOff } from 'lucide-react'

import { Badge, StatusPill, type BadgeTone } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { WaiterCallSheet } from '@/components/customer/waiter-call-sheet'
import { formatNumber, formatRelativeTime } from '@/lib/i18n/format'
import { useLocale, useT } from '@/lib/i18n/provider'
import { isOpen } from '@/lib/orders/lateness'
import type { OrderStatus } from '@/types/database'
import type { OrderView } from '@/types/domain'

export type ConnectionState = 'connecting' | 'live' | 'reconnecting' | 'polling'

const CONNECTION_TONE: Record<ConnectionState, BadgeTone> = {
  connecting: 'neutral',
  live: 'success',
  reconnecting: 'warning',
  polling: 'info',
}

export interface OrderStatusCardProps {
  token: string
  order: OrderView
  connection: ConnectionState
  /** epoch ms, ticked periodically by the parent so relative time stays fresh. */
  now: number
}

function statusHeadlineKey(status: OrderStatus): `status.orderCustomer.${OrderStatus}` {
  return `status.orderCustomer.${status}`
}

function statusLabelKey(status: OrderStatus): `status.order.${OrderStatus}` {
  return `status.order.${status}`
}

export function OrderStatusCard({ token, order, connection, now }: OrderStatusCardProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const [waiterSheetOpen, setWaiterSheetOpen] = useState(false)

  const etaMinutes =
    order.dueAt !== null
      ? Math.max(0, Math.round((Date.parse(order.dueAt) - now) / 60_000))
      : null

  return (
    <Card padding="md" as="section" className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-caption text-text-subtle">{t('customer.tracking.orderNumber', { number: order.orderNumber })}</p>
          {order.tableNumber && (
            <p className="text-caption text-text-subtle">
              {t('customer.tracking.tableLabel', { number: order.tableNumber })}
            </p>
          )}
          <p className="text-caption text-text-subtle">
            {t('customer.tracking.placedAt', { time: formatRelativeTime(order.placedAt, locale, now) })}
          </p>
        </div>
        <StatusPill kind="order" status={order.status} label={t(statusLabelKey(order.status))} size="md" />
      </div>

      <p className="text-body-lg font-medium text-text">{t(statusHeadlineKey(order.status))}</p>

      {isOpen(order.status) && (
        <p className="text-body-sm text-text-muted">
          {etaMinutes !== null && etaMinutes > 0
            ? t('customer.cart.estimatedTime', { minutes: formatNumber(etaMinutes, locale) })
            : t('customer.tracking.readyNow')}
        </p>
      )}

      <div className="flex items-center gap-1.5">
        {connection === 'live' ? (
          <Wifi aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-3.5 text-success" />
        ) : (
          <WifiOff aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-3.5 text-text-subtle" />
        )}
        <Badge tone={CONNECTION_TONE[connection]} size="sm" variant="soft">
          {connection === 'live'
            ? t('customer.tracking.live')
            : connection === 'reconnecting'
              ? t('customer.tracking.reconnecting')
              : connection === 'polling'
                ? t('customer.tracking.polling')
                : t('states.loading.tracking')}
        </Badge>
      </div>

      {order.tableNumber && (
        <Button
          variant="secondary"
          size="md"
          iconStart={<BellRing className="size-4" strokeWidth={1.75} />}
          onClick={() => setWaiterSheetOpen(true)}
        >
          {t('customer.tracking.callWaiter')}
        </Button>
      )}

      {order.tableNumber && (
        <WaiterCallSheet
          token={token}
          tableNumber={order.tableNumber}
          open={waiterSheetOpen}
          onOpenChange={setWaiterSheetOpen}
        />
      )}
    </Card>
  )
}
