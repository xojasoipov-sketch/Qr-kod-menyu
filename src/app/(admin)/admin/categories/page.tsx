/**
 * `/admin/categories` — how the menu is grouped (brief §12).
 *
 * A Server Component: `requireCapability('admin')` gates the route, then
 * `listCategories` seeds `<CategoryReorder>`'s first paint. Every mutation —
 * create, edit, delete, activate, reorder — is a Server Action; this page
 * only reads.
 */
import { CategoryReorder } from '@/components/admin/category-reorder'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { listCategories } from '@/lib/services/menu-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminCategoriesPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const result = await listCategories(context.activeBranchId)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.categories.title')} description={t('admin.categories.subtitle')} />

      {result.ok ? (
        <CategoryReorder
          initialCategories={result.data}
          branches={context.branches.map((branch) => ({ id: branch.id, name: branch.name }))}
          locale={locale}
        />
      ) : (
        <ErrorState
          code={result.error.wire ?? 'unknown'}
          title={t('states.error.menuAdmin.title')}
          description={t('states.error.menuAdmin.body')}
        />
      )}
    </div>
  )
}
