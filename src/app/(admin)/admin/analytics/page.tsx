/**
 * `/admin/analytics` — brief §11's analytics, over a chosen date range
 * (05-app-structure.md §10). A Server Component.
 *
 * `getDashboardStats` computes exactly one business date per call; there is
 * no range-aggregation service in this codebase (see EXPORTS.md — only
 * `getDashboardStats(branchId, options)` exists), so a range is built here by
 * calling it once per day, in parallel, and summing the REAL results. Every
 * number on this page is therefore a real query result — nothing here is
 * estimated, interpolated or invented, satisfying brief §11's "no fake
 * analytics" the same way the dashboard does, just over more than one day.
 */
import { Store } from 'lucide-react'

import { AnalyticsCharts, type AnalyticsSeriesPoint } from '@/components/admin/analytics-charts'
import { DemoDataNotice } from '@/components/admin/demo-data-notice'
import { OrderStatusOverview } from '@/components/admin/order-status-overview'
import { PopularDishes } from '@/components/admin/popular-dishes'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { cn } from '@/lib/utils/cn'
import Link from 'next/link'

import { requireRole } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { formatNumber, formatMoney } from '@/lib/i18n/format'
import { sumMoney } from '@/lib/money'
import { getDashboardStats } from '@/lib/services/dashboard-service'
import { businessDateFor } from '@/lib/utils/datetime'
import { ORDER_STATUSES, type OrderStatus } from '@/types/database'
import type { DashboardTopItem } from '@/types/domain'
import type { I18nText } from '@/types/i18n'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Range = 'today' | 'week' | 'month'
const RANGE_DAYS: Readonly<Record<Range, number>> = { today: 1, week: 7, month: 30 }

function isRange(value: string | undefined): value is Range {
  return value === 'today' || value === 'week' || value === 'month'
}

function businessDatesFor(timezone: string, days: number, now: Date): string[] {
  const seen = new Set<string>()
  for (let i = 0; i < days; i += 1) {
    const at = new Date(now.getTime() - i * 86_400_000)
    seen.add(businessDateFor(timezone, at))
  }
  return [...seen].sort()
}

function zeroByStatus(): Record<OrderStatus, number> {
  const counts = {} as Record<OrderStatus, number>
  for (const status of ORDER_STATUSES) counts[status] = 0
  return counts
}

function mergeTopItems(days: readonly DashboardTopItem[][]): DashboardTopItem[] {
  const buckets = new Map<string, { menuItemId: string | null; name: I18nText; quantity: number; revenue: number[] }>()
  for (const items of days) {
    for (const item of items) {
      const key = item.menuItemId ?? `name:${JSON.stringify(item.name)}`
      const bucket = buckets.get(key) ?? { menuItemId: item.menuItemId, name: item.name, quantity: 0, revenue: [] }
      bucket.quantity += item.quantitySold
      bucket.revenue.push(item.revenue)
      buckets.set(key, bucket)
    }
  }
  return [...buckets.values()]
    .map((bucket) => ({
      menuItemId: bucket.menuItemId,
      name: bucket.name,
      quantitySold: bucket.quantity,
      revenue: sumMoney(bucket.revenue),
    }))
    .sort((a, b) => b.quantitySold - a.quantitySold || b.revenue - a.revenue)
    .slice(0, 5)
}

export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>
}): Promise<React.JSX.Element> {
  const context = await requireRole('RESTAURANT_OWNER', 'MANAGER')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)
  const params = await searchParams
  const range: Range = isRange(params.range) ? params.range : 'week'

  const header = (
    <PageHeader
      title={t('admin.analytics.title')}
      description={t('admin.analytics.subtitle')}
      meta={context.restaurant.isDemo ? <DemoDataNotice isDemo label={t('states.demo.badge')} /> : undefined}
      tabs={
        <div className="flex gap-1 border-b border-border">
          {(['today', 'week', 'month'] as const).map((option) => (
            <Link
              key={option}
              href={`/admin/analytics?range=${option}`}
              aria-current={range === option ? 'page' : undefined}
              className={cn(
                'border-b-2 px-3 py-2 text-admin-sm transition-colors duration-(--duration-fast)',
                range === option
                  ? 'border-accent font-medium text-text'
                  : 'border-transparent text-text-muted hover:text-text',
              )}
            >
              {t(`admin.analytics.range${option === 'today' ? 'Today' : option === 'week' ? 'Week' : 'Month'}`)}
            </Link>
          ))}
        </div>
      }
    />
  )

  const branchId = context.activeBranchId
  if (!branchId) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <EmptyState
          icon={<Store className="size-7" strokeWidth={1.75} />}
          title={t('waiter.noBranch.title')}
          description={t('waiter.noBranch.body')}
          align="center"
        />
      </div>
    )
  }

  const branch = context.branches.find((candidate) => candidate.id === branchId)
  const timezone = branch?.timezone ?? 'UTC'
  const now = new Date()
  const dates = businessDatesFor(timezone, RANGE_DAYS[range], now)

  const results = await Promise.all(dates.map((date) => getDashboardStats(branchId, { businessDate: date, now })))

  const failed = results.find((result) => !result.ok)
  if (failed && !failed.ok) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState code={failed.error.wire ?? 'unknown'} size="md" align="center" />
      </div>
    )
  }

  const stats = results.flatMap((result) => (result.ok ? [result.data] : []))
  const isDemo = stats.some((day) => day.isDemo)

  const series: AnalyticsSeriesPoint[] = stats.map((day) => ({
    date: day.businessDate,
    revenue: day.todayRevenue,
    orderCount: day.todayOrderCount,
  }))

  const totalRevenue = sumMoney(stats.map((day) => day.todayRevenue))
  const totalOrders = stats.reduce((sum, day) => sum + day.todayOrderCount, 0)
  const avgTicket = totalOrders === 0 ? 0 : Math.floor(totalRevenue / totalOrders)

  const ordersByStatus = zeroByStatus()
  for (const day of stats) {
    for (const status of ORDER_STATUSES) ordersByStatus[status] += day.ordersByStatus[status]
  }

  const topItems = mergeTopItems(stats.map((day) => day.topItems))

  const currency = context.restaurant.currency
  const currencyDecimals = context.restaurant.currencyDecimals
  const hasData = totalOrders > 0

  return (
    <div className="flex flex-col gap-6">
      {header}

      {isDemo && (
        <DemoDataNotice
          isDemo
          variant="banner"
          label={t('states.demo.badge')}
          description={t('states.demo.body')}
        />
      )}

      {!hasData ? (
        <EmptyState
          icon={<Store className="size-7" strokeWidth={1.75} />}
          title={t('admin.analytics.noData.title')}
          description={t('admin.analytics.noData.body')}
          align="center"
        />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex flex-col gap-1 rounded-card border border-border bg-elevated p-4">
              <span className="text-admin-xs uppercase text-text-subtle">{t('admin.analytics.revenue')}</span>
              <p className="u-tnum text-admin-metric text-text">
                {formatMoney(totalRevenue, currency, currencyDecimals, locale)}
              </p>
            </div>
            <div className="flex flex-col gap-1 rounded-card border border-border bg-elevated p-4">
              <span className="text-admin-xs uppercase text-text-subtle">{t('admin.analytics.orders')}</span>
              <p className="u-tnum text-admin-metric text-text">{formatNumber(totalOrders, locale)}</p>
            </div>
            <div className="flex flex-col gap-1 rounded-card border border-border bg-elevated p-4">
              <span className="text-admin-xs uppercase text-text-subtle">{t('admin.analytics.avgTicket')}</span>
              <p className="u-tnum text-admin-metric text-text">
                {totalOrders === 0 ? '—' : formatMoney(avgTicket, currency, currencyDecimals, locale)}
              </p>
            </div>
          </div>

          <Section title={t('admin.analytics.revenue')} level={2}>
            <AnalyticsCharts
              series={series}
              currency={currency}
              currencyDecimals={currencyDecimals}
              locale={locale}
              t={t}
            />
          </Section>

          <div className="grid gap-4 lg:grid-cols-2">
            <Section title={t('admin.analytics.byStatus')} level={2}>
              <OrderStatusOverview ordersByStatus={ordersByStatus} t={t} locale={locale} />
            </Section>
            <Section title={t('admin.analytics.topItems')} level={2}>
              <PopularDishes items={topItems} currency={currency} currencyDecimals={currencyDecimals} t={t} locale={locale} />
            </Section>
          </div>
        </>
      )}
    </div>
  )
}
