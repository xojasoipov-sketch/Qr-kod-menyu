'use client'

/**
 * The body of `/t/[token]/cart` — review and place.
 *
 * The single client orchestrator for the route: while the cart is not yet
 * hydrated it renders a skeleton that occupies the same shape as the loaded
 * view (so nothing shifts), then renders either `<CartEmpty>` or the line
 * list, the advisory totals, the order note and `<PlaceOrderButton>`. Totals
 * here are explicitly labelled as an estimate — the number that is actually
 * charged is whatever `public_place_order` computes server-side and is shown
 * on the order tracking page, never this one.
 */

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'

import { Card } from '@/components/ui/card'
import { LoadingState } from '@/components/ui/loading-state'
import { PriceTag } from '@/components/ui/price-tag'
import { Section } from '@/components/ui/section'
import { Textarea } from '@/components/ui/textarea'
import { CartEmpty } from '@/components/customer/cart-empty'
import { CartLineRow } from '@/components/customer/cart-line'
import { PlaceOrderButton } from '@/components/customer/place-order-button'
import { useCart } from '@/components/customer/cart-provider'
import { formatNumber } from '@/lib/i18n/format'
import { useLocale, useT } from '@/lib/i18n/provider'

export interface CartSummaryProps {
  token: string
  menuHref: string
}

export function CartSummary({ token, menuHref }: CartSummaryProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const { state, dispatch, hydrated } = useCart()

  if (!hydrated) {
    return (
      <div className="flex flex-col gap-6">
        <LoadingState label={t('states.loading.cart')} variant="skeleton" shape="list" count={3} />
      </div>
    )
  }

  if (state.lines.length === 0) {
    return <CartEmpty menuHref={menuHref} />
  }

  const showServiceFee = state.serviceFeeEnabled && state.totals.serviceFee > 0
  const showDiscount = state.totals.discountTotal > 0

  return (
    <div className="flex flex-col gap-6 pb-6">
      <Link
        href={menuHref}
        className="inline-flex items-center gap-1.5 self-start text-body-sm text-text-muted hover:text-text"
      >
        <ArrowLeft aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />
        {t('customer.cart.addMore')}
      </Link>

      <Card padding="sm" as="section">
        <ul className="flex flex-col">
          {state.lines.map((line) => (
            <CartLineRow key={line.lineId} line={line} />
          ))}
        </ul>
      </Card>

      <Section title={t('common.notes')} level={3} spacing="sm">
        <Textarea
          label={t('customer.cart.orderNote')}
          placeholder={t('customer.cart.orderNotePlaceholder')}
          rows={2}
          maxLength={280}
          value={state.note ?? ''}
          onChange={(event) =>
            dispatch({ type: 'setOrderNote', note: event.target.value, now: new Date().toISOString() })
          }
        />
      </Section>

      <Card padding="md" as="section" className="flex flex-col gap-2">
        <div className="flex items-center justify-between text-body-sm text-text-muted">
          <span>{t('customer.cart.subtotal')}</span>
          <PriceTag
            amount={state.totals.subtotal}
            currency={state.currency}
            decimals={state.currencyDecimals}
            locale={locale}
            size="sm"
            tone="muted"
          />
        </div>

        {showDiscount && (
          <div className="flex items-center justify-between text-body-sm text-text-muted">
            <span>{t('customer.cart.discount')}</span>
            <PriceTag
              amount={state.totals.discountTotal}
              currency={state.currency}
              decimals={state.currencyDecimals}
              locale={locale}
              size="sm"
              tone="muted"
            />
          </div>
        )}

        {showServiceFee && (
          <div className="flex items-center justify-between text-body-sm text-text-muted">
            <span>
              {t('customer.cart.serviceFee')}
              <span className="block text-caption text-text-subtle">
                {t('customer.cart.serviceFeeHint', {
                  percent: formatNumber(state.serviceFeeBps / 100, locale, { maximumFractionDigits: 2 }),
                })}
              </span>
            </span>
            <PriceTag
              amount={state.totals.serviceFee}
              currency={state.currency}
              decimals={state.currencyDecimals}
              locale={locale}
              size="sm"
              tone="muted"
            />
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border pt-2 text-body-lg font-medium text-text">
          <span>{t('customer.cart.total')}</span>
          <PriceTag
            amount={state.totals.total}
            currency={state.currency}
            decimals={state.currencyDecimals}
            locale={locale}
            size="lg"
          />
        </div>
      </Card>

      <PlaceOrderButton token={token} />
    </div>
  )
}
