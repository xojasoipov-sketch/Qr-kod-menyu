/**
 * `/t/[token]/cart` — review and place.
 *
 * A Server Component: it resolves the table once (through the same demo/live
 * switch every public read uses), so the header and the `<CartProvider>` seed
 * are correct on the very first response. Everything interactive below that —
 * the line list, the totals, placing the order — lives in `<CartSummary>`.
 *
 * `force-dynamic` + `nodejs`: this route depends on a capability token and on
 * live availability; nothing here may be statically cached (doc 05 §2.0).
 */
import { notFound } from 'next/navigation'

import { CartProvider } from '@/components/customer/cart-provider'
import { CartSummary } from '@/components/customer/cart-summary'
import { ErrorState } from '@/components/ui/error-state'
import { demoRepository } from '@/lib/demo/demo-mode'
import { isDemoMode } from '@/lib/env'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { AppErrorException } from '@/lib/result'
import { resolveTable } from '@/lib/rpc/public'
import { qrTokenSchema } from '@/lib/validation/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'default-no-store'

interface CartPageProps {
  params: Promise<{ token: string }>
}

export default async function CartPage({ params }: CartPageProps): Promise<React.JSX.Element> {
  const { token } = await params
  const parsedToken = qrTokenSchema.safeParse(token)
  if (!parsedToken.success) notFound()

  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const result = isDemoMode()
    ? await demoRepository.resolveTable(parsedToken.data)
    : await resolveTable(parsedToken.data)

  if (!result.ok) {
    if (result.error.code === 'INVALID_QR') notFound()

    // A table or a restaurant that is legitimately closed is a designed state,
    // not a thrown error — the diner did nothing wrong and there is nothing to
    // retry (brief §32).
    if (result.error.code === 'TABLE_INACTIVE' || result.error.code === 'RESTAURANT_CLOSED') {
      return (
        <main className="mx-auto flex min-h-dvh w-full max-w-(--measure-prose) items-center justify-center px-6 py-16">
          <ErrorState code={result.error.wire ?? 'unknown'} align="center" />
        </main>
      )
    }

    // NETWORK / UNKNOWN: genuinely unexpected. The nearest error boundary in the
    // tree renders the retry affordance.
    throw new AppErrorException(result.error)
  }

  const context = result.data

  return (
    <CartProvider
      context={{
        token: context.token,
        restaurantSlug: context.restaurant.slug,
        currency: context.restaurant.currency,
        currencyDecimals: context.restaurant.currency_decimals,
        serviceFeeEnabled: context.branch.service_fee_enabled,
        serviceFeeBps: context.branch.service_fee_bps,
        locale,
      }}
    >
      <main className="mx-auto flex w-full max-w-(--measure-prose) flex-col gap-4 px-4 pt-6 pb-32">
        <header className="flex flex-col gap-1">
          <h1 className="font-display text-title text-text">{t('customer.cart.title')}</h1>
          <p className="text-body-sm text-text-muted">
            {t('customer.cart.subtitle', {
              number: context.table.number ?? '—',
              restaurant: context.restaurant.name,
            })}
          </p>
        </header>

        <CartSummary token={parsedToken.data} menuHref={`/t/${parsedToken.data}`} />
      </main>
    </CartProvider>
  )
}
