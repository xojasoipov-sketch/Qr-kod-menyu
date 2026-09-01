'use client'

/**
 * src/components/customer/menu-search.tsx — MenuSearch.
 * Source: docs/architecture/04-design-system.md §6.2; 05-app-structure.md §3.1, §3.3.1.
 *
 * Search-as-you-type over a compact index the server already built (id, name,
 * category, availability, price) — typing must never round-trip to the network
 * (05 §3.1). The full category browsing UI is passed as `children`, already
 * server-rendered; this component only decides which of the two to show, by
 * toggling `hidden` rather than unmounting, so the server-rendered menu stays
 * in the DOM and nothing needs a second render pass to reappear when the query
 * is cleared.
 */

import { useMemo, useState, type ReactNode } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { Search, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { PriceTag } from '@/components/ui/price-tag'
import { StatusPill } from '@/components/ui/badge'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { I18nText, Locale } from '@/types/i18n'
import type { Money } from '@/lib/money'
import { FoodPlaceholder, dishSeed } from './food-placeholder'

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface MenuSearchIndexItem {
  id: string
  name: I18nText
  isAvailable: boolean
  price: Money
  imageUrl: string | null
}

export interface MenuSearchProps {
  index: readonly MenuSearchIndexItem[]
  hrefFor: (itemId: string) => string
  locale: Locale
  currency: string
  decimals: number
  children: ReactNode
  className?: string
}

export function MenuSearch({
  index,
  hrefFor,
  locale,
  currency,
  decimals,
  children,
  className,
}: MenuSearchProps): React.JSX.Element {
  const t = useT()
  const [query, setQuery] = useState('')
  const trimmed = query.trim().toLocaleLowerCase(locale)
  const searching = trimmed.length > 0

  const results = useMemo(() => {
    if (!searching) return []
    return index.filter((item) => pickText(item.name, locale).toLocaleLowerCase(locale).includes(trimmed))
  }, [index, locale, searching, trimmed])

  return (
    <div className={className}>
      <div className="px-(--space-gutter-sm)">
        <Input
          label={t('customer.menu.searchLabel')}
          hideLabel
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('customer.menu.searchPlaceholder')}
          iconStart={<Search aria-hidden="true" focusable="false" strokeWidth={1.5} className="size-4" />}
          suffix={
            searching ? (
              <button
                type="button"
                aria-label={t('customer.menu.clearSearch')}
                onClick={() => setQuery('')}
                className="pointer-events-auto inline-flex size-8 items-center justify-center rounded-control text-text-subtle transition-colors duration-(--duration-fast) hover:text-text"
              >
                <X aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />
              </button>
            ) : undefined
          }
        />
      </div>

      <div hidden={!searching} className="flex flex-col gap-2 px-(--space-gutter-sm) pt-3">
        <p className="text-caption text-text-subtle">{t('customer.menu.resultsFor', { query })}</p>
        {results.length === 0 ? (
          <div className="flex flex-col gap-1 py-6 text-start">
            <p className="text-body text-text">{t('customer.menu.noResultsTitle', { query })}</p>
            <p className="text-body-sm text-text-muted">{t('customer.menu.noResultsBody')}</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {results.map((item) => {
              const name = pickText(item.name, locale);
              return (
                <li key={item.id}>
                  <Link
                    href={hrefFor(item.id)}
                    className="flex items-center gap-3 rounded-card border border-border bg-elevated p-2.5"
                  >
                    <span className="relative size-12 shrink-0 overflow-hidden rounded-media bg-surface-sunken">
                      {item.imageUrl ? (
                        <Image src={item.imageUrl} alt={name} fill sizes="48px" className="object-cover" />
                      ) : (
                        <FoodPlaceholder seed={dishSeed(name, item.id)} monogram={name} ratio="1:1" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-body-sm text-text">{name}</span>
                    {item.isAvailable ? (
                      <PriceTag amount={item.price} currency={currency} decimals={decimals} locale={locale} size="sm" />
                    ) : (
                      <StatusPill kind="availability" status="unavailable" size="sm" label={t('customer.menu.unavailable')} />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div hidden={searching} className={cn('flex flex-col')}>
        {children}
      </div>
    </div>
  )
}
