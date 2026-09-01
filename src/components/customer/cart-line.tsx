'use client'

/**
 * One row of the cart: image, name, chosen extras, note, quantity and price.
 *
 * Reads and writes through `useCart()` — it is only ever rendered inside a
 * `<CartProvider>` (mounted by `<CartSummary>`). An unavailable line (its dish
 * sold out since it was added) is kept in the list, dimmed and labelled, rather
 * than silently dropped: `cartReducer` already excludes it from the priced
 * total, so showing it is the only way the diner learns it will not be charged
 * for something they still see on screen.
 */

import Image from 'next/image'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { PriceTag } from '@/components/ui/price-tag'
import { QuantityStepper } from '@/components/ui/quantity-stepper'
import { useCart } from '@/components/customer/cart-provider'
import { LOCALE_FALLBACK_ORDER } from '@/lib/i18n/config'
import { useLocale, useT } from '@/lib/i18n/provider'
import { formatList } from '@/lib/i18n/format'
import { cn } from '@/lib/utils/cn'
import type { CartLine as CartLineModel } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'

function pickText(text: I18nText, locale: Locale): string {
  const own = text[locale]
  if (own) return own
  for (const fallback of LOCALE_FALLBACK_ORDER) {
    const value = text[fallback]
    if (value) return value
  }
  return ''
}

export interface CartLineRowProps {
  line: CartLineModel
}

export function CartLineRow({ line }: CartLineRowProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const { state, dispatch } = useCart()

  const name = pickText(line.name, locale)

  const extrasText = useMemo(() => {
    if (line.options.length === 0) return null
    const labels = line.options.map((option) => {
      const optionName = pickText(option.name, locale)
      return option.quantity > 1 ? `${optionName} ×${option.quantity}` : optionName
    })
    return formatList(labels, locale)
  }, [line.options, locale])

  return (
    <li
      className={cn(
        'flex gap-3 border-b border-border py-3 last:border-b-0',
        !line.isAvailable && 'opacity-60',
      )}
    >
      <div className="relative size-16 shrink-0 overflow-hidden rounded-control bg-surface-sunken">
        {line.imageUrl && (
          <Image src={line.imageUrl} alt={name} fill sizes="64px" className="object-cover" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate font-medium text-text text-body">{name}</p>
          <PriceTag
            amount={line.lineTotal}
            currency={state.currency}
            decimals={state.currencyDecimals}
            locale={locale}
            size="sm"
          />
        </div>

        {!line.isAvailable && (
          <Badge tone="danger" size="sm">
            {t('customer.menu.unavailable')}
          </Badge>
        )}

        {extrasText && (
          <p className="truncate text-caption text-text-muted">
            {t('customer.cart.lineExtras')}: {extrasText}
          </p>
        )}

        {line.note && (
          <p className="truncate text-caption text-text-subtle">
            {t('customer.cart.lineNote')}: {line.note}
          </p>
        )}

        <div className="mt-1 flex items-center justify-between gap-2">
          <QuantityStepper
            size="sm"
            value={line.quantity}
            min={1}
            max={99}
            removeAtMin
            label={`${t('common.quantity')} — ${name}`}
            decreaseLabel={t('a11y.decreaseQuantity')}
            increaseLabel={t('a11y.increaseQuantity')}
            removeLabel={t('a11y.removeNamedItem', { item: name })}
            onValueChange={(quantity) =>
              dispatch({ type: 'setQuantity', lineId: line.lineId, quantity, now: new Date().toISOString() })
            }
            onRemove={() => dispatch({ type: 'remove', lineId: line.lineId, now: new Date().toISOString() })}
          />
        </div>
      </div>
    </li>
  )
}
