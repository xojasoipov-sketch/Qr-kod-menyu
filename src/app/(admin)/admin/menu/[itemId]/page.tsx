/**
 * `/admin/menu/[itemId]` — create or edit one dish (brief §12).
 *
 * `itemId === 'new'` renders the create form; anything else is looked up
 * with `getMenuItem`, and a miss calls `notFound()` — deliberately
 * indistinguishable from a dish belonging to another tenant
 * (05-app-structure.md §2.6, boundary-file table).
 */
import { notFound } from 'next/navigation'

import { MenuItemForm } from '@/components/admin/menu-item-form'
import { PageHeader } from '@/components/ui/page-header'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { getMenuItem, listCategories } from '@/lib/services/menu-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminMenuItemPage({
  params,
}: {
  params: Promise<{ itemId: string }>
}): Promise<React.JSX.Element> {
  const { itemId } = await params
  const context = await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const categoriesResult = await listCategories(context.activeBranchId)
  if (!categoriesResult.ok) notFound()
  const categories = categoriesResult.data.map((category) => ({
    id: category.view.id,
    name: category.view.name,
  }))

  const isNew = itemId === 'new'
  const itemResult = isNew ? null : await getMenuItem(itemId)
  if (!isNew && (!itemResult || !itemResult.ok)) notFound()

  const initial = isNew ? null : itemResult && itemResult.ok ? itemResult.data : null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={isNew ? t('admin.menu.newItem') : t('admin.menu.editItem')}
        breadcrumbs={[
          { label: t('admin.menu.title'), href: '/admin/menu' },
          { label: isNew ? t('admin.menu.newItem') : t('admin.menu.editItem') },
        ]}
        breadcrumbsLabel={t('a11y.mainNavigation')}
      />

      <MenuItemForm
        initial={initial}
        categories={categories}
        branches={context.branches.map((branch) => ({ id: branch.id, name: branch.name }))}
        currency={context.restaurant.currency}
        currencyDecimals={context.restaurant.currencyDecimals}
        locale={locale}
        listHref="/admin/menu"
      />
    </div>
  )
}
