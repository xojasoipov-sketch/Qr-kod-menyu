/**
 * `/admin/branches` — locations, hours and service rules (brief §17-25).
 *
 * A Server Component: `requireCapability('admin')` gates the route, then
 * `listBranches` seeds `<BranchList>`'s first paint. RLS already scopes the
 * result to the caller's own restaurant, so there is no id to pass.
 */
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { BranchList } from '@/components/admin/branch-list'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { listBranches } from '@/lib/services/branch-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminBranchesPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const result = await listBranches()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.branches.title')} description={t('admin.branches.subtitle')} />

      {result.ok ? (
        <BranchList initialBranches={result.data} restaurantServiceFeeBps={context.restaurant.serviceFeeBps} />
      ) : (
        <ErrorState
          code={result.error.wire ?? 'unknown'}
          title={t('states.error.branches.title')}
          description={t('states.error.branches.body')}
        />
      )}
    </div>
  )
}
