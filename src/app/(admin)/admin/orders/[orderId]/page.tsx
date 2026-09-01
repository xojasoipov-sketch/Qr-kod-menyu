/**
 * `/admin/orders/[orderId]` — one order, staff-side (brief §11, §26).
 *
 * NOTE ON THE ROUTE PARAM: `OrderView` (`@/lib/mappers/order-mapper.ts`)
 * deliberately carries no raw `orders.id` — it is the same view model the
 * customer tracker reads, and that surface must never learn one. `getOrder`
 * (`@/lib/services/order-service.ts`) is keyed by that id, so this route
 * resolves `[orderId]` — actually the order's `public_code`, already visible
 * to staff in the orders list and never a secret internally — to its id with
 * one minimal, still RLS-scoped `createServerClient()` read before handing
 * off to the real service for everything else. See `unresolved` in this
 * slice's handoff: `OrderView` should probably carry `id` for staff surfaces.
 */
import { notFound } from 'next/navigation'

import { OrderDetail } from '@/components/admin/order-detail'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireRole } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import type { ActorRole } from '@/lib/orders/state-machine'
import { getOrder } from '@/lib/services/order-service'
import { createServerClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ orderId: string }>
}): Promise<React.JSX.Element> {
  const context = await requireRole('RESTAURANT_OWNER', 'MANAGER')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)
  const { orderId: publicCode } = await params

  const supabase = await createServerClient()
  const { data: located } = await supabase
    .from('orders')
    .select('id, branch_id')
    .eq('public_code', publicCode)
    .maybeSingle()

  if (!located) notFound()

  const result = await getOrder(located.id)
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('admin.orders.title')} />
        <ErrorState code={result.error.wire ?? 'unknown'} size="md" align="center" />
      </div>
    )
  }

  const order = result.data
  const branch = context.branches.find((candidate) => candidate.id === located.branch_id)
  const actor: ActorRole = context.isPlatformAdmin ? 'SUPER_ADMIN' : context.role

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.orders.detailTitle', { number: order.orderNumber })}
        breadcrumbs={[
          { label: t('admin.orders.title'), href: '/admin/orders' },
          { label: order.orderNumber },
        ]}
        breadcrumbsLabel={t('a11y.mainNavigation')}
      />

      <OrderDetail
        orderId={located.id}
        order={order}
        branchId={located.branch_id}
        actor={actor}
        currency={context.restaurant.currency}
        currencyDecimals={context.restaurant.currencyDecimals}
        timezone={branch?.timezone ?? 'UTC'}
      />
    </div>
  )
}
