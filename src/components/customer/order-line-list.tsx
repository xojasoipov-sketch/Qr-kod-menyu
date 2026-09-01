'use client'

/**
 * The receipt: what was ordered, and what it actually costs.
 *
 * Renders `OrderView.lines` — snapshot data written at the moment the order
 * was placed (`name_snapshot`, `price_snapshot`, …) — so a menu rename or a
 * repricing after the fact never changes what this page shows (brief §25). The
 * totals block below it is the AUTHORITATIVE number: unlike the cart's advisory
 * preview, this is what `public_place_order` actually computed and, later,
 * what the guest is actually charged.
 */

import { Card } from '@/components/ui/card'
import { PriceTag } from '@/components/ui/price-tag'
import { LOCALE_FALLBACK_ORDER } from '@/lib/i18n/config'
import { useLocale, useT } from '@/lib/i18n/provider'
import { formatList } from '@/lib/i18n/format'
import type { OrderView } from '@/types/domain'
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

export interface OrderLineListProps {
  order: OrderView
}

export function OrderLineList({ order }: OrderLineListProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()

  const showServiceFee = order.serviceFee > 0
  const showDiscount = order.discountTotal > 0

  return (
    <div className="flex flex-col gap-4">
      <Card padding="sm" as="section">
        <h2 className="px-1 pb-2 pt-1 font-medium text-body text-text">
          {t('customer.tracking.itemsTitle')}
        </h2>
        <ul className="flex flex-col">
          {order.lines.map((line) => {
            const extras =
              line.options.length > 0
                ? formatList(
                    line.options.map((option) =>
                      option.quantity > 1
                        ? `${pickText(option.name, locale)} ×${option.quantity}`
                        : pickText(option.name, locale),
                    ),
                    locale,
                  )
                : null

            return (
              <li key={line.id} className="flex gap-3 border-b border-border py-3 last:border-b-0">
                <span className="u-tnum shrink-0 text-body-sm text-text-muted">{line.quantity}×</span>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <p className="truncate font-medium text-body text-text">{pickText(line.name, locale)}</p>
                  {extras && (
                    <p className="truncate text-caption text-text-muted">
                      {t('customer.cart.lineExtras')}: {extras}
                    </p>
                  )}
                  {line.note && (
                    <p className="truncate text-caption text-text-subtle">
                      {t('customer.cart.lineNote')}: {line.note}
                    </p>
                  )}
                </div>
                <PriceTag
                  amount={line.lineTotal}
                  currency={order.currency}
                  decimals={order.currencyDecimals}
                  locale={locale}
                  size="sm"
                />
              </li>
            )
          })}
        </ul>
      </Card>

      <Card padding="md" as="section" className="flex flex-col gap-2">
        <h2 className="pb-1 font-medium text-body text-text">{t('customer.tracking.totalsTitle')}</h2>

        <div className="flex items-center justify-between text-body-sm text-text-muted">
          <span>{t('customer.cart.subtotal')}</span>
          <PriceTag
            amount={order.subtotal}
            currency={order.currency}
            decimals={order.currencyDecimals}
            locale={locale}
            size="sm"
            tone="muted"
          />
        </div>

        {showDiscount && (
          <div className="flex items-center justify-between text-body-sm text-text-muted">
            <span>{t('customer.cart.discount')}</span>
            <PriceTag
              amount={order.discountTotal}
              currency={order.currency}
              decimals={order.currencyDecimals}
              locale={locale}
              size="sm"
              tone="muted"
            />
          </div>
        )}

        {showServiceFee && (
          <div className="flex items-center justify-between text-body-sm text-text-muted">
            <span>{t('customer.cart.serviceFee')}</span>
            <PriceTag
              amount={order.serviceFee}
              currency={order.currency}
              decimals={order.currencyDecimals}
              locale={locale}
              size="sm"
              tone="muted"
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 text-body-lg font-medium text-text">
          <span>{t('customer.cart.total')}</span>
          <PriceTag
            amount={order.total}
            currency={order.currency}
            decimals={order.currencyDecimals}
            locale={locale}
            size="lg"
          />
        </div>
      </Card>
    </div>
  )
}
