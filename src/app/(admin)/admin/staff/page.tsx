/**
 * `/admin/staff` — who can do what, and where (brief §16).
 *
 * A Server Component: `requireCapability('admin')` gates the route, then
 * `listStaff` seeds `<StaffList>`'s first paint. `assignableRoles` mirrors
 * `staff-service.ts`'s `assertNoEscalation` in the UI: only an owner (or a
 * platform admin) ever sees `RESTAURANT_OWNER` as an option, so the form
 * never offers a choice the server is guaranteed to refuse.
 */
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { StaffList } from '@/components/admin/staff-list'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { listStaff } from '@/lib/services/staff-service'
import { STAFF_ROLES } from '@/types/database'
import type { StaffRole } from '@/types/database'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminStaffPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const result = await listStaff()

  const assignableRoles: readonly StaffRole[] =
    context.isPlatformAdmin || context.role === 'RESTAURANT_OWNER'
      ? STAFF_ROLES
      : STAFF_ROLES.filter((role) => role !== 'RESTAURANT_OWNER')

  const timezone = context.branches.find((branch) => branch.id === context.activeBranchId)?.timezone ?? 'UTC'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.staff.title')} description={t('admin.staff.subtitle')} />

      {result.ok ? (
        <StaffList
          initialStaff={result.data}
          branches={context.branches.map((branch) => ({ id: branch.id, name: branch.name }))}
          assignableRoles={assignableRoles}
          currentStaffId={context.session.staffId}
          locale={locale}
          timezone={timezone}
        />
      ) : (
        <ErrorState
          code={result.error.wire ?? 'unknown'}
          title={t('states.error.staff.title')}
          description={t('states.error.staff.body')}
        />
      )}
    </div>
  )
}
