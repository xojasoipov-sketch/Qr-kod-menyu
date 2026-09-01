/**
 * `/admin/orders` — every order, live and historical (brief §11;
 * 05-app-structure.md §2.6).
 *
 * A Server Component. `listOrders` reads the caller's active branch, scoped
 * and paginated exactly as the URL's `status` / `date` / `search` / `offset`
 * describe it — reloading or sharing the URL reproduces the same page, which
 * is the point of keeping filters out of client state (see
 * `<OrdersTable>`). Next 16's `searchParams` is a Promise; it is awaited
 * before anything reads it.
 */
import { Store } from 'lucide-react'

import { DemoDataNotice } from '@/components/admin/demo-data-notice'
import { OrdersTable } from '@/components/admin/orders-table'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireRole } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { listOrders } from '@/lib/services/order-service'
import { ORDER_STATUSES, type OrderStatus } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PAGE_SIZE = 25

function isOrderStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value)
}

interface OrdersSearchParams {
  status?: string
  date?: string
  search?: string
  offset?: string
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<OrdersSearchParams>
}): Promise<React.JSX.Element> {
  const context = await requireRole('RESTAURANT_OWNER', 'MANAGER')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)
  const params = await searchParams

  const branchId = context.activeBranchId

  const statusFilter: OrderStatus | 'all' =
    params.status !== undefined && isOrderStatus(params.status) ? params.status : 'all'
  const businessDate = params.date ?? ''
  const search = params.search ?? ''
  const offset = Math.max(0, Number.parseInt(params.offset ?? '0', 10) || 0)

  const header = (
    <PageHeader
      title={t('admin.orders.title')}
      description={t('admin.orders.subtitle')}
      meta={context.restaurant.isDemo ? <DemoDataNotice isDemo label={t('states.demo.badge')} /> : undefined}
    />
  )

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

  const result = await listOrders(branchId, {
    status: statusFilter === 'all' ? undefined : [statusFilter],
    businessDate: businessDate.length > 0 ? businessDate : null,
    search: search.length > 0 ? search : null,
    limit: PAGE_SIZE,
    offset,
  })

  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ErrorState code={result.error.wire ?? 'unknown'} size="md" align="center" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {header}
      <OrdersTable
        orders={result.data.orders}
        total={result.data.total}
        limit={result.data.limit}
        offset={result.data.offset}
        branchId={branchId}
        currency={context.restaurant.currency}
        currencyDecimals={context.restaurant.currencyDecimals}
        timezone={branch?.timezone ?? 'UTC'}
        statusFilter={statusFilter}
        search={search}
        businessDate={businessDate}
      />
    </div>
  )
}
