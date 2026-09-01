/**
 * src/components/customer/featured-carousel.tsx — FeaturedCarousel.
 * Source: docs/architecture/04-design-system.md §6.2 (`FeaturedCard`/`FeaturedRail`), §8.1, §10.5.
 *
 * The editorial counterpart to `MenuItemCard`, reused for both `is_featured`
 * ("Chef's picks") and `is_popular` ("Most ordered") — portrait 4:5 media,
 * full-bleed, the dish name in Playfair over a `--scrim-image-bottom` gradient.
 * A scroll-snapping rail of 78vw cards with a peek of the next one — never a
 * full-width one-at-a-time hero (§8.1), and no JS is needed to scroll it: CSS
 * `scroll-snap` does the whole job, which is what keeps this a Server Component.
 *
 * An empty `items` array omits the whole section, heading included — never an
 * empty carousel (§6.2).
 */

import Image from 'next/image'
import Link from 'next/link'

import { PriceTag } from '@/components/ui/price-tag'
import { cn } from '@/lib/utils/cn'
import type { MenuItemView } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'
import { FoodPlaceholder, dishSeed } from './food-placeholder'

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface FeaturedCarouselProps {
  /** Localised section heading, e.g. `t('customer.menu.featuredTitle')`. */
  title: string
  /** Localised, e.g. `t('customer.menu.featuredSubtitle')`. */
  subtitle?: string
  items: readonly MenuItemView[]
  hrefFor: (itemId: string) => string
  locale: Locale
  currency: string
  decimals: number
  /** Localised, e.g. `t('customer.menu.unavailable')`. */
  unavailableLabel: string
  className?: string
}

export function FeaturedCarousel({
  title,
  subtitle,
  items,
  hrefFor,
  locale,
  currency,
  decimals,
  unavailableLabel,
  className,
}: FeaturedCarouselProps): React.JSX.Element | null {
  if (items.length === 0) return null

  return (
    <section className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-col gap-0.5 px-(--space-gutter-sm)">
        <h2 className="font-display text-title text-text">{title}</h2>
        {subtitle !== undefined && <p className="text-body-sm text-text-muted">{subtitle}</p>}
      </div>

      <div className="u-edge-fade flex snap-x snap-mandatory gap-3 overflow-x-auto px-(--space-gutter-sm) pb-1">
        {items.map((item, index) => {
          const name = pickText(item.name, locale);
          return (
            <Link
              key={item.id}
              href={hrefFor(item.id)}
              className="relative aspect-4/5 w-[78vw] shrink-0 snap-start overflow-hidden rounded-media bg-surface-sunken sm:w-80"
            >
              <div className={cn('absolute inset-0', !item.isAvailable && 'opacity-70 grayscale-[0.5]')}>
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt={name}
                    fill
                    priority={index === 0}
                    sizes="(min-width: 640px) 320px, 78vw"
                    className="object-cover"
                  />
                ) : (
                  <FoodPlaceholder seed={dishSeed(name, item.id)} monogram={name} ratio="4:5" />
                )}
              </div>

              <div className="u-scrim-bottom absolute inset-0" />

              {!item.isAvailable && (
                <span className="absolute start-3 top-3 rounded-xs bg-elevated/90 px-2 py-0.5 text-overline uppercase text-text-muted">
                  {unavailableLabel}
                </span>
              )}

              <div className="absolute inset-x-0 bottom-0 flex flex-col gap-1 p-4">
                <h3 className="u-clamp-2 font-display text-display-sm text-text-inverse">{name}</h3>
                <PriceTag
                  amount={item.price}
                  currency={currency}
                  decimals={decimals}
                  locale={locale}
                  size="lg"
                  className="text-text-inverse"
                />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  )
}
