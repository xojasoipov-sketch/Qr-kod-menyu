/**
 * src/app/t/[token]/page.tsx — the menu.
 * Source: docs/architecture/05-app-structure.md §3.3.1; brief §4.
 *
 * Identity and welcome message, table number, search, featured, popular,
 * categories, active promotions — in that order, all Server-rendered so the
 * menu ships as HTML rather than as JSON plus a client renderer. Unavailable
 * dishes are shown, never hidden (brief §5); an empty menu, an empty category
 * and a paused kitchen each get their own designed state, never a blank page.
 */
import { notFound } from 'next/navigation'
import { BookOpen } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { CategoryRail, type CategoryRailItem } from '@/components/customer/category-rail'
import { FeaturedCarousel } from '@/components/customer/featured-carousel'
import { MenuItemCard } from '@/components/customer/menu-item-card'
import { MenuSearch, type MenuSearchIndexItem } from '@/components/customer/menu-search'
import { PromotionBanner } from '@/components/customer/promotion-banner'
import { AppErrorException } from '@/lib/result'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { toMenuTree } from '@/lib/mappers/menu-mapper'
import type { MenuCategoryView } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'
import { getCachedMenu } from './data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

interface TokenParams {
  token: string
}

export default async function MenuPage({
  params,
}: {
  params: Promise<TokenParams>
}): Promise<React.JSX.Element> {
  const { token } = await params
  const [menuResult, locale] = await Promise.all([getCachedMenu(token), resolveRequestLocale()])

  if (!menuResult.ok) {
    // The table itself already resolved (the layout would have rendered its own
    // failure screen otherwise); a menu-fetch failure at this point is either a
    // transient error (caught by error.tsx) or a genuine not-found.
    if (menuResult.error.code === 'NOT_FOUND') notFound()
    throw new AppErrorException(menuResult.error)
  }

  const t = getServerTranslator(locale)
  const menu = toMenuTree(menuResult.data)
  const { context, categories, promotions, itemsById, featuredItemIds, popularItemIds } = menu

  const hrefFor = (itemId: string): string => `/t/${token}/item/${itemId}`

  const searchIndex: MenuSearchIndexItem[] = Object.values(itemsById).map((item) => ({
    id: item.id,
    name: item.name,
    isAvailable: item.isAvailable,
    price: item.price,
    imageUrl: item.imageUrl,
  }))

  const railItems: CategoryRailItem[] = categories
    .filter((category) => category.itemCount > 0)
    .map((category) => ({ id: category.id, label: pickText(category.name, locale), count: category.itemCount }))

  const featured = featuredItemIds.map((id) => itemsById[id]).filter((item) => item !== undefined)
  const popular = popularItemIds.map((id) => itemsById[id]).filter((item) => item !== undefined)

  return (
    <>
      <div className="flex flex-col gap-1.5 px-(--space-gutter-sm) pt-6">
        <span className="text-overline uppercase text-text-subtle">
          {t('customer.welcome.eyebrow')} · {t('customer.welcome.tableLabel', { number: context.table.number })}
        </span>
        <h1 className="max-w-(--measure-narrow) font-display text-display-md text-text">
          {t('customer.welcome.greeting', { restaurant: context.restaurant.name })}
        </h1>
        <p className="max-w-(--measure-narrow) text-body-sm text-text-muted text-pretty">
          {t('customer.welcome.intro')}
        </p>
      </div>

      {!context.branch.isAcceptingOrders && (
        <div className="mx-(--space-gutter-sm) mt-4 flex flex-col gap-1 rounded-control border border-warning-line bg-warning-soft px-3 py-2.5">
          <p className="text-body-sm font-medium text-warning">{t('customer.welcome.notAcceptingTitle')}</p>
          <p className="text-caption text-warning">{t('customer.welcome.notAcceptingBody')}</p>
        </div>
      )}

      <div className="mt-5">
        <MenuSearch index={searchIndex} hrefFor={hrefFor} locale={locale} currency={context.restaurant.currency} decimals={context.restaurant.currencyDecimals}>
          <div className="flex flex-col gap-8 pb-10">
            <PromotionBanner title={t('customer.menu.promotionsTitle')} promotions={promotions} locale={locale} />

            {railItems.length > 0 && <CategoryRail items={railItems} />}

            <FeaturedCarousel
              title={t('customer.menu.featuredTitle')}
              subtitle={t('customer.menu.featuredSubtitle')}
              items={featured}
              hrefFor={hrefFor}
              locale={locale}
              currency={context.restaurant.currency}
              decimals={context.restaurant.currencyDecimals}
              unavailableLabel={t('customer.menu.unavailable')}
            />

            <FeaturedCarousel
              title={t('customer.menu.popularTitle')}
              subtitle={t('customer.menu.popularSubtitle')}
              items={popular}
              hrefFor={hrefFor}
              locale={locale}
              currency={context.restaurant.currency}
              decimals={context.restaurant.currencyDecimals}
              unavailableLabel={t('customer.menu.unavailable')}
            />

            {categories.length === 0 ? (
              <div className="px-(--space-gutter-sm)">
                <EmptyState
                  align="center"
                  icon={<BookOpen className="size-7" strokeWidth={1.75} />}
                  title={t('states.empty.title')}
                  description={t('states.empty.body')}
                />
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                <h2 className="px-(--space-gutter-sm) font-display text-title text-text">
                  {t('customer.menu.categoriesTitle')}
                </h2>
                {categories
                  .filter((category) => category.itemCount > 0)
                  .map((category) => (
                    <CategorySection
                      key={category.id}
                      category={category}
                      hrefFor={hrefFor}
                      locale={locale}
                      currency={context.restaurant.currency}
                      decimals={context.restaurant.currencyDecimals}
                      unavailableNote={t('customer.menu.unavailable')}
                    />
                  ))}
              </div>
            )}
          </div>
        </MenuSearch>
      </div>
    </>
  )
}

function CategorySection({
  category,
  hrefFor,
  locale,
  currency,
  decimals,
  unavailableNote,
}: {
  category: MenuCategoryView
  hrefFor: (itemId: string) => string
  locale: Locale
  currency: string
  decimals: number
  unavailableNote: string
}): React.JSX.Element {
  const name = pickText(category.name, locale)
  const allUnavailable = category.availableItemCount === 0

  return (
    <section id={category.id} className="flex scroll-mt-(--space-header-h) flex-col gap-3 px-(--space-gutter-sm)">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display text-display-sm text-text">{name}</h3>
        {allUnavailable && <span className="text-caption text-text-subtle">{unavailableNote}</span>}
      </div>
      <div className="flex flex-col gap-2.5">
        {category.items.map((item) => (
          <MenuItemCard
            key={item.id}
            item={item}
            href={hrefFor(item.id)}
            locale={locale}
            currency={currency}
            decimals={decimals}
          />
        ))}
      </div>
    </section>
  )
}
