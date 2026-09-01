/**
 * src/app/t/[token]/layout.tsx — resolves the table once, renders the customer shell.
 * Source: docs/architecture/05-app-structure.md §3.2; 04-design-system.md §6.2, §8.6.
 *
 * The one place `resolveTable()` (via the demo-aware `getCachedTableContext`,
 * §../data.ts) is called for the whole request. Four distinct failure screens —
 * QR001 invalid token, QR002 table inactive, QR003 branch inactive, QR004
 * restaurant inactive — are rendered right here, each with its own icon and its
 * own localised body copy (`ErrorState` keys every `QrErrorCode` individually),
 * so a diner who scanned a dead QR code sees a different sentence than one
 * whose table was switched off for cleaning.
 *
 * A malformed token (fails `qrTokenSchema` before any database round trip) is a
 * routing failure, not a table failure, and goes to `not-found.tsx` instead.
 */
import type { Metadata } from 'next'
import { Ban, Clock, QrCode, Store } from 'lucide-react'
import { notFound } from 'next/navigation'

import { ErrorState, type ErrorStateCode } from '@/components/ui/error-state'
import { DEMO_NOTICE } from '@/lib/demo/demo-mode'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { toTableContext } from '@/lib/mappers/menu-mapper'
import type { QrErrorCode } from '@/lib/security/errors'
import { qrTokenSchema } from '@/lib/validation/common'
import type { AppError } from '@/types/result'
import { AddToCartBar } from '@/components/customer/add-to-cart-bar'
import { CallWaiterButton } from '@/components/customer/call-waiter-button'
import { CartProvider } from '@/components/customer/cart-provider'
import { MenuHeader } from '@/components/customer/menu-header'
import { getCachedTableContext } from './data'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'default-no-store'

interface TokenParams {
  token: string
}

export async function generateMetadata({
  params,
}: {
  params: Promise<TokenParams>
}): Promise<Metadata> {
  const { token } = await params
  const parsed = qrTokenSchema.safeParse(token)
  if (!parsed.success) return { title: 'Menu', robots: { index: false, follow: false } }

  const result = await getCachedTableContext(parsed.data)
  return {
    title: result.ok ? result.data.restaurant.name : 'Menu',
    robots: { index: false, follow: false },
    other: { referrer: 'no-referrer' },
  }
}

const FAILURE_ICON: Partial<Record<QrErrorCode, typeof QrCode>> = {
  QR001_INVALID_QR_TOKEN: QrCode,
  QR002_TABLE_INACTIVE: Ban,
  QR003_BRANCH_INACTIVE: Store,
  QR004_RESTAURANT_INACTIVE: Clock,
}

function failureCode(error: AppError): ErrorStateCode {
  if (error.wire !== undefined) return error.wire
  return error.code === 'NETWORK' ? 'network' : 'unknown'
}

function TableFailureScreen({ error }: { error: AppError }): React.JSX.Element {
  const code = failureCode(error)
  const Icon = error.wire !== undefined ? FAILURE_ICON[error.wire] : undefined

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-(--container-customer) flex-col items-center justify-center gap-6 px-(--space-gutter-sm) py-12">
      {Icon !== undefined && (
        <span className="inline-grid size-14 shrink-0 place-items-center rounded-card bg-surface-sunken text-text-subtle">
          <Icon aria-hidden="true" focusable="false" strokeWidth={1.5} className="size-7" />
        </span>
      )}
      <ErrorState code={code} align="center" size="md" />
    </div>
  )
}

export default async function TableLayout({
  params,
  children,
}: {
  params: Promise<TokenParams>
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const { token } = await params
  const parsed = qrTokenSchema.safeParse(token)
  if (!parsed.success) notFound()

  const [result, locale] = await Promise.all([
    getCachedTableContext(parsed.data),
    resolveRequestLocale(),
  ])

  if (!result.ok) {
    return <TableFailureScreen error={result.error} />
  }

  const context = toTableContext(result.data)
  const t = getServerTranslator(locale)

  const cartContext = {
    token: context.token,
    restaurantSlug: context.restaurant.slug,
    currency: context.restaurant.currency,
    currencyDecimals: context.restaurant.currencyDecimals,
    serviceFeeEnabled: context.branch.serviceFeeEnabled,
    serviceFeeBps: context.branch.serviceFeeBps,
    locale,
  }

  return (
    <CartProvider context={cartContext}>
      <div className="mx-auto flex min-h-dvh w-full max-w-(--container-customer) flex-col">
        <a
          href="#menu-main"
          className="sr-only z-(--z-skip-link) focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded-control focus:bg-elevated focus:px-4 focus:py-2 focus:text-body-sm focus:text-text"
        >
          {t('a11y.skipToContent')}
        </a>

        <MenuHeader
          restaurantName={context.restaurant.name}
          restaurantSlug={context.restaurant.slug}
          tableLabel={t('customer.welcome.tableLabel', { number: context.table.number })}
          logoUrl={context.restaurant.logoUrl}
          isDemo={DEMO_NOTICE}
          demoLabel={t('states.demo.badge')}
        />

        <main id="menu-main" className="customer-scroll flex-1">
          {children}
        </main>

        <AddToCartBar mode="cart" cartHref={`/t/${context.token}/cart`} />

        <CallWaiterButton token={context.token} tableNumber={context.table.number} />
      </div>
    </CartProvider>
  )
}
