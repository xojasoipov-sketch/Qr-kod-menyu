/**
 * src/components/admin/dashboard-stats.tsx — the StatCard row (brief §11).
 *
 * Every value here is read straight off `DashboardStats` — nothing is
 * estimated, nothing is a placeholder, and `stats.isDemo` (never a local
 * guess) decides whether each tile carries the demo badge. There is no
 * `delta` on any tile: `getDashboardStats` computes exactly one business date
 * at a time, so a "vs yesterday" figure would have to be invented, and brief
 * §11 forbids that outright.
 *
 * A Server Component — `t` and `locale` are passed in from the page's server
 * translator rather than read through `useT()`, so nothing here needs
 * `'use client'`.
 */

import { BellRing, Clock3, Receipt, Table2, Wallet, XCircle } from 'lucide-react'

import { StatCard } from '@/components/ui/stat-card'
import type { Translator } from '@/lib/i18n/format'
import { formatMoney, formatNumber } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/types'
import type { DashboardStats as DashboardStatsData } from '@/types/domain'

export interface DashboardStatsProps {
  stats: DashboardStatsData
  t: Translator
  locale: Locale
}

const ICON_CLASS = 'size-4'

/** `StatCard`'s `isDemo`/`demoLabel` pair is a discriminated union — this is
 *  the one place that satisfies it from a plain boolean. */
function demoProps(isDemo: boolean, label: string): { isDemo: true; demoLabel: string } | Record<string, never> {
  return isDemo ? { isDemo: true, demoLabel: label } : {}
}

export function DashboardStats({ stats, t, locale }: DashboardStatsProps): React.JSX.Element {
  const demoLabel = t('states.demo.badge')
  const demo = demoProps(stats.isDemo, demoLabel)
  const money = (amount: number): string =>
    formatMoney(amount, stats.currency, stats.currencyDecimals, locale)

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard
        label={t('admin.dashboard.todayRevenue')}
        value={money(stats.todayRevenue)}
        icon={<Wallet className={ICON_CLASS} strokeWidth={1.75} />}
        {...demo}
      />
      <StatCard
        label={t('admin.dashboard.todayOrders')}
        value={formatNumber(stats.todayOrderCount, locale)}
        icon={<Receipt className={ICON_CLASS} strokeWidth={1.75} />}
        {...demo}
      />
      <StatCard
        label={t('admin.dashboard.avgOrderValue')}
        value={stats.todayOrderCount === 0 ? null : money(stats.averageOrderValue)}
        icon={<Wallet className={ICON_CLASS} strokeWidth={1.75} />}
        {...demo}
      />
      <StatCard
        label={t('admin.dashboard.activeTables')}
        value={`${formatNumber(stats.activeTableCount, locale)} / ${formatNumber(stats.totalTableCount, locale)}`}
        icon={<Table2 className={ICON_CLASS} strokeWidth={1.75} />}
        {...demo}
      />
      <StatCard
        label={t('admin.dashboard.pendingOrders')}
        value={formatNumber(stats.pendingOrderCount, locale)}
        icon={<Clock3 className={ICON_CLASS} strokeWidth={1.75} />}
        tone={stats.pendingOrderCount > 0 ? 'accent' : 'default'}
        {...demo}
      />
      <StatCard
        label={t('admin.dashboard.openCalls')}
        value={formatNumber(stats.openWaiterCallCount, locale)}
        icon={<BellRing className={ICON_CLASS} strokeWidth={1.75} />}
        tone={stats.openWaiterCallCount > 0 ? 'accent' : 'default'}
        {...demo}
      />
      <StatCard
        label={t('status.order.cancelled')}
        value={formatNumber(stats.cancelledOrderCount, locale)}
        icon={<XCircle className={ICON_CLASS} strokeWidth={1.75} />}
        {...demo}
      />
    </div>
  )
}
