/**
 * src/components/customer/promotion-banner.tsx — PromotionBanner.
 * Source: docs/architecture/04-design-system.md §6.2, §10.7, §8.1.
 *
 * A scroll-snapping rail of the branch's active promotions/announcements —
 * 16:9 media, the title in Playfair over the same `--scrim-image-bottom` scrim
 * `FeaturedCarousel` uses, so the two rails read as one visual language. Display
 * only: placing an order never reads a promotion (doc 03 §2.6), so this
 * component carries no discount arithmetic and is not a link into anything —
 * `promotions` are announcements, not products.
 *
 * An empty list omits the section entirely, heading included.
 */

import { PartyPopper } from 'lucide-react'

import { cn } from '@/lib/utils/cn'
import type { PromotionView } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'
import { FoodPlaceholder, dishSeed } from './food-placeholder'

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface PromotionBannerProps {
  /** Localised, e.g. `t('customer.menu.promotionsTitle')`. */
  title: string
  promotions: readonly PromotionView[]
  locale: Locale
  className?: string
}

export function PromotionBanner({
  title,
  promotions,
  locale,
  className,
}: PromotionBannerProps): React.JSX.Element | null {
  if (promotions.length === 0) return null

  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <h2 className="px-(--space-gutter-sm) font-display text-title text-text">{title}</h2>

      <div className="u-edge-fade flex snap-x snap-mandatory gap-3 overflow-x-auto px-(--space-gutter-sm) pb-1">
        {promotions.map((promo) => {
          const promoTitle = pickText(promo.title, locale);
          const description = promo.description ? pickText(promo.description, locale) : null;

          return (
            <article
              key={promo.id}
              className="relative aspect-16/9 w-[86vw] shrink-0 snap-start overflow-hidden rounded-media bg-surface-sunken sm:w-96"
            >
              <div className="absolute inset-0">
                <FoodPlaceholder seed={dishSeed(promoTitle, promo.id)} monogram={promoTitle} ratio="16:9" />
              </div>
              <div className="u-scrim-bottom absolute inset-0" />

              {promo.badgeLabel && (
                <span className="absolute start-3 top-3 inline-flex items-center gap-1 rounded-xs bg-accent-strong px-2 py-0.5 text-overline uppercase text-accent-contrast">
                  <PartyPopper aria-hidden="true" focusable="false" strokeWidth={1.5} className="size-3" />
                  {pickText(promo.badgeLabel, locale)}
                </span>
              )}

              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4">
                <h3 className="u-clamp-2 font-display text-display-sm text-text-inverse">{promoTitle}</h3>
                {description !== null && description !== '' && (
                  <p className="u-clamp-2 text-body-sm text-text-inverse/85">{description}</p>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  )
}
