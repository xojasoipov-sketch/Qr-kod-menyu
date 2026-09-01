/**
 * src/components/admin/revenue-summary.tsx — the money half of brief §11's
 * dashboard, spelled out: revenue, average order, and what cancellations cost
 * today. Deliberately carries no trend arrow and no sparkline —
 * `getDashboardStats` computes exactly one business date, so a "vs
 * yesterday" figure exists nowhere upstream, and inventing one is exactly
 * what brief §11 forbids ("no invented trend percentages").
 *
 * A Server Component.
 */

import { formatMoney, formatNumber } from '@/lib/i18n/format'
import type { Translator } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/types'
import type { DashboardStats } from '@/types/domain'

export interface RevenueSummaryProps {
  stats: DashboardStats
  t: Translator
  locale: Locale
}

function Row({ label, value, muted = false }: { label: string; value: string; muted?: boolean }): React.JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border-subtle py-2 last:border-b-0">
      <span className="text-admin-body text-text-muted">{label}</span>
      <span className={`u-tnum text-admin-body ${muted ? 'text-text-subtle' : 'font-medium text-text'}`}>
        {value}
      </span>
    </div>
  )
}

export function RevenueSummary({ stats, t, locale }: RevenueSummaryProps): React.JSX.Element {
  const money = (amount: number): string => formatMoney(amount, stats.currency, stats.currencyDecimals, locale)

  return (
    <div className="flex flex-col">
      <Row label={t('admin.dashboard.todayRevenue')} value={money(stats.todayRevenue)} />
      <Row label={t('admin.dashboard.todayOrders')} value={formatNumber(stats.todayOrderCount, locale)} />
      <Row
        label={t('admin.dashboard.avgOrderValue')}
        value={stats.todayOrderCount === 0 ? '—' : money(stats.averageOrderValue)}
      />
      <Row
        label={t('status.order.cancelled')}
        value={t.n('plurals.orders', stats.cancelledOrderCount)}
        muted
      />
      <Row label={`${t('status.order.cancelled')} · ${t('common.total')}`} value={money(stats.cancelledRevenue)} muted />
    </div>
  )
}
