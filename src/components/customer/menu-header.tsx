/**
 * src/components/customer/menu-header.tsx — MenuHeader.
 * Source: docs/architecture/04-design-system.md §6.2, §8.4, §8.6.
 *
 * The one sticky piece of chrome on the customer surface: the restaurant's
 * identity on the leading edge (never centred — §8.6), the table number as a
 * small overline above it, and the language switcher on the trailing edge. It
 * is one of exactly two places `backdrop-filter` is permitted (§8.4), so it
 * reads as a pane of glass over the scrolling menu rather than another opaque
 * panel stacked on the page.
 *
 * A Server Component: every string arrives already localised from the layout,
 * which is the only file with a `Translator` for this request.
 */

import Image from 'next/image'

import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { cn } from '@/lib/utils/cn'
import { FoodPlaceholder, dishSeed } from './food-placeholder'

export interface MenuHeaderProps {
  restaurantName: string
  /** `restaurant.slug` — TableContext carries no database ids; the slug disambiguates the seed. */
  restaurantSlug: string
  tableLabel: string
  logoUrl: string | null
  /** Localised — `t('states.demo.badge')`. Present only when `isDemo`. */
  demoLabel?: string
  isDemo?: boolean
  className?: string
}

export function MenuHeader({
  restaurantName,
  restaurantSlug,
  tableLabel,
  logoUrl,
  demoLabel,
  isDemo = false,
  className,
}: MenuHeaderProps): React.JSX.Element {
  return (
    <header
      className={cn(
        'u-chrome-blur u-rule-gold sticky top-0 z-(--z-sticky) flex h-(--space-header-h) w-full shrink-0',
        'items-center justify-between gap-3 border-b px-(--space-gutter-sm)',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative size-8 shrink-0 overflow-hidden rounded-control">
          {logoUrl ? (
            <Image src={logoUrl} alt="" fill sizes="32px" className="object-cover" />
          ) : (
            <FoodPlaceholder seed={dishSeed(restaurantName, restaurantSlug)} monogram={restaurantName} showMonogram grain={false} />
          )}
        </span>
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate font-display text-body-lg text-text">{restaurantName}</span>
          <span className="truncate text-overline uppercase text-text-subtle">{tableLabel}</span>
        </span>
        {isDemo && demoLabel !== undefined && (
          <span className="shrink-0 rounded-xs bg-warning-soft px-1.5 py-0.5 text-overline uppercase text-warning">
            {demoLabel}
          </span>
        )}
      </div>

      <LanguageSwitcher variant="segmented" size="sm" className="shrink-0" />
    </header>
  )
}
