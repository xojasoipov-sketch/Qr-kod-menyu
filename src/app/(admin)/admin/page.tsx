/**
 * `/admin` — the dashboard (brief §11; 05-app-structure.md §2.6).
 *
 * A Server Component: `requireRole` gates the route (mirrors the layout's own
 * check — cheap, since `getStaffContext()` is `React.cache()`d per request),
 * then `getDashboardStats` seeds every number on the page for the caller's
 * active branch and today's business date in that branch's own timezone.
 * Nothing here is estimated: a failed read renders `<ErrorState>`, an empty
 * business date renders the real empty state, and a demo tenant's numbers
 * carry `stats.isDemo` into every tile via `<DashboardStats>` and
 * `<DemoDataNotice>`.
 */
import { CalendarDays, Store } from 'lucide-react'

import { DashboardStats } from '@/components/admin/dashboard-stats'
import { DemoDataNotice } from '@/components/admin/demo-data-notice'
import { OrderStatusOverview } from '@/components/admin/order-status-overview'
import { PopularDishes } from '@/components/admin/popular-dishes'
import { RevenueSummary } from '@/components/admin/revenue-summary'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { Section } from '@/components/ui/section'
import { requireRole } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { getDashboardStats } from '@/lib/services/dashboard-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminDashboardPage(): Promise<React.JSX.Element> {
  const context = await requireRole('RESTAURANT_OWNER', 'MANAGER')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const branchId = context.activeBranchId

  if (!branchId) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('admin.dashboard.title')} description={t('admin.dashboard.subtitle')} />
        <EmptyState
          icon={<Store className="size-7" strokeWidth={1.75} />}
          title={t('waiter.noBranch.title')}
          description={t('waiter.noBranch.body')}
          align="center"
        />
      </div>
    )
  }

  const result = await getDashboardStats(branchId)

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('admin.dashboard.title')} description={t('admin.dashboard.subtitle')} />
        <ErrorState code={result.error.wire ?? 'unknown'} size="md" align="center" />
      </div>
    )
  }

  const stats = result.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.dashboard.title')}
        description={t('admin.dashboard.subtitle')}
        meta={
          <span className="inline-flex items-center gap-1.5 text-admin-sm text-text-subtle">
            <CalendarDays aria-hidden="true" focusable="false" className="u-icon-align size-3.5" strokeWidth={1.75} />
            {stats.businessDate}
          </span>
        }
      />

      {stats.isDemo && (
        <DemoDataNotice
          isDemo
          variant="banner"
          label={t('states.demo.badge')}
          description={t('states.demo.body')}
        />
      )}

      <DashboardStats stats={stats} t={t} locale={locale} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t('admin.dashboard.statusOverview')} level={2}>
          <OrderStatusOverview ordersByStatus={stats.ordersByStatus} t={t} locale={locale} />
        </Section>

        <Section title={t('admin.dashboard.popularDishes')} level={2}>
          <PopularDishes
            items={stats.topItems}
            currency={stats.currency}
            currencyDecimals={stats.currencyDecimals}
            t={t}
            locale={locale}
          />
        </Section>
      </div>

      <Section title={t('admin.dashboard.revenueTrend')} level={2}>
        <RevenueSummary stats={stats} t={t} locale={locale} />
      </Section>
    </div>
  )
}
