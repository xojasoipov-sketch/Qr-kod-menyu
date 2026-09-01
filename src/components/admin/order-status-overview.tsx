/**
 * src/components/admin/order-status-overview.tsx — brief §11's "order status
 * overview": how today's orders are distributed across the state machine.
 *
 * A proportional bar list rather than a pie: seven categories read faster as
 * ranked bars than as wedges, and a bar's length needs no legend to decode.
 * Colour follows the exact tone `StatusPill` (`@/components/ui/badge.tsx`,
 * "order_status → colour is mapped here and nowhere else") already assigns
 * each status, via the same design tokens, so the same status reads the same
 * everywhere in the product. Every bar's value is a real count from
 * `DashboardStats.ordersByStatus` — never a percentage guessed from a sample.
 *
 * A Server Component.
 */

import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/badge'
import { PackageSearch } from 'lucide-react'

import type { Translator } from '@/lib/i18n/format'
import { formatNumber } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/types'
import { ORDER_FORWARD_PATH } from '@/lib/orders/state-machine'
import type { OrderStatus } from '@/types/database'

export interface OrderStatusOverviewProps {
  ordersByStatus: Readonly<Record<OrderStatus, number>>
  t: Translator
  locale: Locale
}

/** Bar fill per status — the same tone `StatusPill` assigns each one (badge.tsx). */
const STATUS_BAR_CLASS: Readonly<Record<OrderStatus, string>> = {
  pending: 'bg-warning',
  confirmed: 'bg-info',
  preparing: 'bg-info',
  ready: 'bg-success',
  delivered: 'bg-success',
  completed: 'bg-text-subtle',
  cancelled: 'bg-danger',
}

const DISPLAY_ORDER: readonly OrderStatus[] = [...ORDER_FORWARD_PATH, 'cancelled']

export function OrderStatusOverview({
  ordersByStatus,
  t,
  locale,
}: OrderStatusOverviewProps): React.JSX.Element {
  const total = DISPLAY_ORDER.reduce((sum, status) => sum + ordersByStatus[status], 0)

  if (total === 0) {
    return (
      <EmptyState
        icon={<PackageSearch className="size-7" strokeWidth={1.75} />}
        title={t('admin.dashboard.noData.title')}
        description={t('admin.dashboard.noData.body')}
        size="sm"
      />
    )
  }

  const max = Math.max(...DISPLAY_ORDER.map((status) => ordersByStatus[status]))

  return (
    <ul className="flex flex-col gap-2.5">
      {DISPLAY_ORDER.map((status) => {
        const count = ordersByStatus[status]
        const width = max === 0 ? 0 : Math.round((count / max) * 100)
        return (
          <li key={status} className="flex items-center gap-3">
            <StatusPill kind="order" status={status} label={t(`status.order.${status}`)} size="sm" showDot={false} />
            <span className="h-2 min-w-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <span
                className={`block h-full rounded-full ${STATUS_BAR_CLASS[status]}`}
                style={{ width: `${width}%` }}
              />
            </span>
            <span className="w-10 shrink-0 text-end text-admin-sm u-tnum text-text">
              {formatNumber(count, locale)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}
