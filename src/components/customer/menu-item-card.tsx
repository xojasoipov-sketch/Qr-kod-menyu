'use client'

/**
 * src/components/customer/menu-item-card.tsx — MenuItemCard.
 * Source: docs/architecture/04-design-system.md §6.2, §8.2, §8.6, §8.12.
 *
 * A LIST ROW, deliberately not a grid of squares (§6.2): an 88×88px media well
 * on the trailing edge, text leading, so a long Cyrillic name wraps without
 * shrinking the photo and the dish name sits at the strongest scan position.
 * The add control overlaps the media well's bottom-trailing corner by 8px —
 * the one piece of visual wit that keeps the row from reading as a generic
 * e-commerce list item.
 *
 * `isAvailable: false` NEVER hides the card (brief §5): the media well dims and
 * desaturates, the add button is replaced by an "unavailable" pill, and the
 * whole row keeps its link — a diner who cannot find a dish still wants to read
 * it and ask a waiter where it went.
 *
 * The whole-card action is a real `<Link>` positioned to cover the row (§8.12 —
 * never a `<div onClick>`); the add button is a real sibling `<button>`, never
 * nested inside the anchor, so no control is nested inside another one.
 *
 * The add control quick-adds one unit directly when every option group on the
 * dish is optional; a dish with a REQUIRED group has no safe default to add, so
 * the button becomes a second link into the product detail instead.
 */

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { Clock, Plus } from 'lucide-react'

import { IconButton } from '@/components/ui/button'
import { PriceTag } from '@/components/ui/price-tag'
import { StatusPill } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { useCart } from '@/components/customer/cart-provider'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { DietaryTag } from '@/types/database'
import type { MenuItemView } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'
import { DIETARY_LABEL_KEYS, DietaryTags } from './dietary-tags'
import { FoodPlaceholder, dishSeed } from './food-placeholder'
import { SPICY_LABEL_KEYS, SpicyMeter } from './spicy-meter'

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface MenuItemCardProps {
  item: MenuItemView
  href: string
  locale: Locale
  currency: string
  decimals: number
  className?: string
}

export function MenuItemCard({
  item,
  href,
  locale,
  currency,
  decimals,
  className,
}: MenuItemCardProps): React.JSX.Element {
  const t = useT()
  const { dispatch } = useCart()
  const [added, setAdded] = useState(false)
  const name = pickText(item.name, locale)
  const description = item.description ? pickText(item.description, locale) : null
  const canQuickAdd = item.isAvailable && item.optionGroups.every((g) => !g.isRequired)

  const dietaryLabels = Object.fromEntries(
    item.dietaryTags.map((tag) => [tag, t(DIETARY_LABEL_KEYS[tag])]),
  ) as Record<DietaryTag, string>

  const handleQuickAdd = (): void => {
    dispatch({
      type: 'add',
      now: new Date().toISOString(),
      line: {
        menuItemId: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        unitPrice: item.price,
        options: [],
        quantity: 1,
        note: null,
        isAvailable: item.isAvailable,
        spicyLevel: item.spicyLevel,
      },
    })
    setAdded(true)
    toast.success(t('toasts.itemAdded', { item: name }), { duration: 2200 })
    window.setTimeout(() => setAdded(false), 1400)
  }

  return (
    <div className={cn('group relative flex items-stretch gap-3 rounded-card border border-border bg-elevated p-3', className)}>
      {/*
        The whole-row action. Positioned (z-10 by default stacking) so it sits
        ABOVE the static text content below for hit-testing, and BELOW the
        z-20 media well so the add button remains its own target (§8.12).
      */}
      <Link href={href} aria-label={name} className="absolute inset-0 z-10 rounded-card" />

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2 py-0.5">
        <div className="flex min-w-0 flex-col gap-1">
          {item.isPopular && (
            <span className="text-overline uppercase text-accent">{t('customer.menu.popularTitle')}</span>
          )}
          <h3 className="u-clamp-2 font-display text-title text-text">{name}</h3>
          {description !== null && description !== '' && (
            <p className="u-clamp-2 text-body-sm text-text-muted">{description}</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <SpicyMeter
            level={item.spicyLevel as 0 | 1 | 2 | 3}
            ariaLabel={t('a11y.spicyLevelLabel', { level: t(SPICY_LABEL_KEYS[item.spicyLevel as 0 | 1 | 2 | 3]) })}
          />
          <span className="inline-flex items-center gap-1 text-caption text-text-subtle">
            <Clock aria-hidden="true" focusable="false" strokeWidth={1.5} className="size-3.5" />
            {t('customer.menu.prepMinutes', { minutes: item.preparationTime })}
          </span>
          <DietaryTags tags={item.dietaryTags} labels={dietaryLabels} max={2} />
        </div>

        <PriceTag
          amount={item.price}
          compareAt={item.compareAtPrice ?? undefined}
          currency={currency}
          decimals={decimals}
          locale={locale}
        />
      </div>

      <div className="relative z-20 size-22 shrink-0 self-start">
        <div
          className={cn(
            'size-22 overflow-hidden rounded-media bg-surface-sunken',
            !item.isAvailable && 'opacity-55 grayscale-[0.6]',
          )}
        >
          {item.imageUrl ? (
            <Image src={item.imageUrl} alt={name} fill sizes="88px" className="object-cover" />
          ) : (
            <FoodPlaceholder seed={dishSeed(name, item.id)} monogram={name} ratio="1:1" />
          )}
        </div>

        {item.isAvailable ? (
          canQuickAdd ? (
            <IconButton
              type="button"
              variant="solid"
              size="md"
              label={added ? t('customer.menu.added') : t('customer.menu.addToCart')}
              onClick={handleQuickAdd}
              icon={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4.5" />}
              className="absolute -end-2 -bottom-2 shadow-float"
            />
          ) : (
            <Link
              href={href}
              aria-label={t('customer.menu.addToCart')}
              className="absolute -end-2 -bottom-2 inline-flex size-10 items-center justify-center rounded-control bg-accent-strong text-accent-contrast shadow-float transition-[filter] duration-(--duration-fast) hover:brightness-108"
            >
              <Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4.5" />
            </Link>
          )
        ) : (
          <StatusPill
            kind="availability"
            status="unavailable"
            size="sm"
            label={t('customer.menu.unavailable')}
            className="absolute -end-2 -bottom-2"
          />
        )}
      </div>
    </div>
  )
}
