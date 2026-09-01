/**
 * `/admin/menu` — the dish list (brief §12; 05-app-structure.md §2.6).
 *
 * A Server Component: `requireCapability('admin')` gates the route, then
 * `listCategories` and `listMenuItems` seed the table's first paint.
 * Filtering happens client-side inside `<MenuItemList>` — the branch's whole
 * catalogue is fetched once, matching `menu-service.ts`'s own note that a
 * server round trip per keystroke is pointless at this cardinality.
 */
import { UtensilsCrossed } from 'lucide-react'

import { MenuItemList } from '@/components/admin/menu-item-list'
import { EmptyState } from '@/components/ui/empty-state'
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { listCategories, listMenuItems } from '@/lib/services/menu-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminMenuPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const branchId = context.activeBranchId

  const [categoriesResult, itemsResult] = await Promise.all([
    listCategories(branchId),
    listMenuItems(branchId),
  ])

  if (!categoriesResult.ok || !itemsResult.ok) {
    const error = !categoriesResult.ok ? categoriesResult.error : itemsResult.ok ? undefined : itemsResult.error
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title={t('admin.menu.title')} description={t('admin.menu.subtitle')} />
        <ErrorState
          code={error?.wire ?? 'unknown'}
          title={t('states.error.menuAdmin.title')}
          description={t('states.error.menuAdmin.body')}
        />
      </div>
    )
  }

  const categories = categoriesResult.data
  const items = itemsResult.data

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title={t('admin.menu.title')} description={t('admin.menu.subtitle')} />

      {categories.length === 0 ? (
        <EmptyState
          icon={<UtensilsCrossed aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
          title={t('admin.categories.empty.title')}
          description={t('admin.categories.empty.body')}
          action={{ label: t('admin.categories.emptyCta'), href: '/admin/categories' }}
        />
      ) : (
        <MenuItemList
          items={items}
          categories={categories.map((category) => ({ id: category.view.id, name: category.view.name }))}
          locale={locale}
          currency={context.restaurant.currency}
          currencyDecimals={context.restaurant.currencyDecimals}
          newHref="/admin/menu/new"
          editHref={(itemId) => `/admin/menu/${itemId}`}
        />
      )}
    </div>
  )
}
