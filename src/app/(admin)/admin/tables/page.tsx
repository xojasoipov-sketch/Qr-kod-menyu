/**
 * `/admin/tables` — QR codes and table numbers (brief §13, §14, §34.9-10).
 *
 * A Server Component: `requireCapability('admin')` gates the route, then
 * `listTables` seeds `<TableList>`'s first paint, scoped to the caller's
 * active branch (a table always belongs to exactly one branch).
 */
import { Store } from 'lucide-react'

import { TableList } from '@/components/admin/table-list'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { listTables } from '@/lib/services/table-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminTablesPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const branchId = context.activeBranchId

  let body: React.JSX.Element
  if (!branchId) {
    body = (
      <EmptyState
        icon={<Store aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
        title={t('waiter.noBranch.title')}
        description={t('waiter.noBranch.body')}
      />
    )
  } else {
    const result = await listTables(branchId)
    body = result.ok ? (
      <TableList initialTables={result.data} branchId={branchId} />
    ) : (
      <ErrorState
        code={result.error.wire ?? 'unknown'}
        title={t('states.error.tables.title')}
        description={t('states.error.tables.body')}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.tables.title')} description={t('admin.tables.subtitle')} />
      {body}
    </div>
  )
}
