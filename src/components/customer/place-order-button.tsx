'use client'

/**
 * The one button that turns a cart into an order.
 *
 * Non-negotiable rules this file exists to keep (see the assignment brief):
 *   - the client never sends a price — only dish ids, option ids, quantities
 *     and notes cross to `placeOrderAction`;
 *   - a blocked checkout NAMES which dish is unavailable, both pre-emptively
 *     (from the cart's own reconciled `blockedLines`) and reactively (a race
 *     that slips past reconciliation comes back as `ITEM_UNAVAILABLE` with the
 *     offending `menu_item_id`, resolved back to the dish's own name);
 *   - a `RATE_LIMITED` response shows the seconds remaining and disables the
 *     button for exactly that long, rather than leaving a dead control up;
 *   - a retry reuses `state.clientRequestId` — it is generated once per cart in
 *     `createEmptyCart` and never regenerated here, which is what makes a
 *     double-tap or a flaky-network retry return the same order instead of a
 *     second one.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import { Button } from '@/components/ui/button'
import { ErrorState, type ErrorStateCode } from '@/components/ui/error-state'
import { toast } from '@/components/ui/toast'
import { useCart } from '@/components/customer/cart-provider'
import type { CartContext } from '@/lib/cart/cart-store'
import { placeOrderAction } from '@/app/t/[token]/actions'
import { formatList } from '@/lib/i18n/format'
import { LOCALE_FALLBACK_ORDER } from '@/lib/i18n/config'
import { useLocale, useT } from '@/lib/i18n/provider'
import type { AppError } from '@/lib/result'
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

function toErrorStateCode(error: AppError): ErrorStateCode {
  if (error.wire) return error.wire
  return error.code === 'NETWORK' ? 'network' : 'unknown'
}

export interface PlaceOrderButtonProps {
  token: string
}

export function PlaceOrderButton({ token }: PlaceOrderButtonProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const { state, dispatch, isCheckoutable, blockedLines, reconcile } = useCart()

  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [retrySeconds, setRetrySeconds] = useState<number | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current)
    },
    [],
  )

  const startCountdown = useCallback((seconds: number) => {
    if (tickRef.current) clearInterval(tickRef.current)
    setRetrySeconds(seconds)
    tickRef.current = setInterval(() => {
      setRetrySeconds((current) => {
        if (current === null || current <= 1) {
          if (tickRef.current) clearInterval(tickRef.current)
          return null
        }
        return current - 1
      })
    }, 1000)
  }, [])

  const handlePlaceOrder = useCallback(async () => {
    if (pending || !isCheckoutable) return
    setPending(true)
    setError(null)

    const result = await placeOrderAction({
      token,
      items: state.lines.map((line) => ({
        menu_item_id: line.menuItemId,
        quantity: line.quantity,
        option_ids: line.options.map((option) => option.optionId),
        note: line.note,
      })),
      note: state.note,
      client_request_id: state.clientRequestId,
    })

    setPending(false)

    if (result.ok) {
      toast.success(t('customer.checkout.successTitle'), {
        description: t('toasts.orderPlaced', { number: result.data.order_number }),
      })

      // A fresh clientRequestId for whatever the diner orders next — it must
      // never be deduplicated against the order that was just placed.
      const context: CartContext = {
        token: state.token,
        restaurantSlug: state.restaurantSlug,
        currency: state.currency,
        currencyDecimals: state.currencyDecimals,
        serviceFeeEnabled: state.serviceFeeEnabled,
        serviceFeeBps: state.serviceFeeBps,
        locale: state.locale,
      }
      dispatch({ type: 'clear', context, now: new Date().toISOString() })

      router.push(`/t/${token}/order/${result.data.public_code}`)
      return
    }

    setError(result.error)

    if (result.error.code === 'RATE_LIMITED' && result.error.retryAfterSeconds) {
      startCountdown(result.error.retryAfterSeconds)
    }

    // A dish sold out between our own reconciliation and the server's own,
    // authoritative check. Refresh the cart so the line shows the same thing
    // the error just said.
    if (result.error.code === 'ITEM_UNAVAILABLE') {
      void reconcile()
    }
  }, [pending, isCheckoutable, token, state, dispatch, reconcile, router, startCountdown, t])

  const blockedNames = blockedLines.map((line) => pickText(line.name, locale))

  const errorItemName = (() => {
    if (!error || error.code !== 'ITEM_UNAVAILABLE') return undefined
    const menuItemId = error.details?.menu_item_id
    if (typeof menuItemId !== 'string') return undefined
    const line = state.lines.find((candidate) => candidate.menuItemId === menuItemId)
    return line ? pickText(line.name, locale) : undefined
  })()

  const disabled = pending || !isCheckoutable || (retrySeconds !== null && retrySeconds > 0)

  return (
    <div className="flex flex-col gap-3">
      {blockedNames.length > 0 && (
        <ErrorState
          size="sm"
          title={t('customer.cart.itemsRemovedTitle')}
          description={formatList(blockedNames, locale)}
        />
      )}

      {error && (
        <ErrorState
          size="sm"
          live
          code={toErrorStateCode(error)}
          params={{
            seconds: retrySeconds ?? error.retryAfterSeconds ?? 0,
            item: errorItemName ?? '',
          }}
        />
      )}

      <Button
        variant="primary"
        size="lg"
        fullWidth
        loading={pending}
        loadingLabel={t('customer.cart.placing')}
        disabled={disabled}
        onClick={() => void handlePlaceOrder()}
      >
        {retrySeconds !== null && retrySeconds > 0
          ? t('errors.app.RATE_LIMITED', { seconds: retrySeconds })
          : t('customer.cart.placeOrder')}
      </Button>
    </div>
  )
}
