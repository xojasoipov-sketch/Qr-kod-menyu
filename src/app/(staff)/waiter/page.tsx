/**
 * src/app/(staff)/waiter/page.tsx — the waiter console (`/waiter`).
 * Source: docs/architecture/05-app-structure.md §6.3 ("active orders, ready
 * orders, open WaiterCallView[]"); brief §10.
 *
 * Three areas, one screen: orders being cooked, orders ready to serve, and
 * table calls. A WAITER's session is pinned to one branch (`ck_staff_role_scope`
 * in the database); this page never reads any other branch's data and never
 * offers a switcher, whatever role is actually looking at it.
 *
 * All three lists are fetched here, in parallel, through the RLS-scoped
 * services (`waiter-service`, `order-service`, `table-service`) — never
 * `createAdminClient()`. `<WaiterBoard>` takes it from there client-side,
 * staying live via `subscribeToBranch`.
 */
import type { Metadata } from 'next'
import { Store } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { WaiterBoard, type WaiterBoardTable } from '@/components/waiter/waiter-board'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { AppErrorException } from '@/lib/result'
import { listKitchenTickets } from '@/lib/services/order-service'
import { listTables } from '@/lib/services/table-service'
import { listWaiterCalls } from '@/lib/services/waiter-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)
  return { title: t('waiter.title') }
}

export default async function WaiterPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('waiter')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const branchId = context.activeBranchId

  // ck_staff_role_scope forbids a WAITER row with no branch_id, but a MANAGER
  // or RESTAURANT_OWNER who has never picked one can still land here with
  // `branchId === null`. Nothing in this console makes sense without one.
  if (branchId === null) {
    return (
      <div className="flex min-h-[60dvh] w-full items-center justify-center p-6">
        <EmptyState
          icon={<Store className="size-7" strokeWidth={1.75} />}
          title={t('waiter.noBranch.title')}
          description={t('waiter.noBranch.body')}
          align="center"
        />
      </div>
    )
  }

  const branch = context.branches.find((candidate) => candidate.id === branchId) ?? null

  const [ticketsResult, callsResult, tablesResult] = await Promise.all([
    listKitchenTickets(branchId),
    listWaiterCalls(branchId, true, { limit: 200 }),
    listTables(branchId),
  ])

  // A read failure at this point (session valid, branch in scope) is
  // transient — network, a dropped connection — and belongs to error.tsx,
  // which offers a real retry. It is not a "this branch has no data" state.
  if (!ticketsResult.ok) throw new AppErrorException(ticketsResult.error)
  if (!callsResult.ok) throw new AppErrorException(callsResult.error)
  if (!tablesResult.ok) throw new AppErrorException(tablesResult.error)

  const tables: WaiterBoardTable[] = tablesResult.data
    .filter((table) => table.isActive)
    .map((table) => ({ id: table.id, number: table.number, name: table.name }))

  return (
    <WaiterBoard
      branchId={branchId}
      lateThresholdMinutes={branch?.lateOrderThresholdMinutes ?? 25}
      initialTickets={ticketsResult.data}
      initialCalls={callsResult.data}
      tables={tables}
      isDemoTenant={context.restaurant.isDemo}
    />
  )
}
