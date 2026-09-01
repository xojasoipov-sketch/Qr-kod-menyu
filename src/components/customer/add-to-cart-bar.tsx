'use client'

/**
 * src/components/customer/add-to-cart-bar.tsx — AddToCartBar.
 * Source: docs/architecture/04-design-system.md §6.2 (`CartBar`), §3.4, §7.2, §8.4.
 *
 * One sticky bottom bar, two roles:
 *
 *   mode="cart"  the persistent "View cart" affordance the table layout mounts
 *                once, above the whole browsing surface. Reads the cart through
 *                `useCart()` (`@/components/customer/cart-provider`) — the one
 *                cart context this table's whole subtree shares — so it stays
 *                in lockstep with every add/remove anywhere on the page without
 *                a manual re-read.
 *   mode="add"   the per-dish "Add to cart · price" call to action, rendered as
 *                `<ItemDetailSheet>`'s sticky footer. Purely presentational —
 *                the caller owns the dispatch.
 *
 * Hydration safety (§3.4): `mode="cart"` renders nothing until the provider
 * reports `hydrated`, and nothing while the cart is empty — UNMOUNTED, not
 * hidden, so it is never a focus trap. The server and the first client paint
 * therefore agree (no bar), and the bar slides in once storage has been read.
 */

import Link from 'next/link'
import { ShoppingBag } from 'lucide-react'

import { Button, buttonClasses } from '@/components/ui/button'
import { useCart } from '@/components/customer/cart-provider'
import { formatMoney } from '@/lib/money'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'

export type AddToCartBarProps =
  | {
      mode: 'cart'
      cartHref: string
    }
  | {
      mode: 'add'
      quantity: number
      unitTotal: number
      currency: string
      decimals: number
      disabled?: boolean
      disabledReason?: string
      pending?: boolean
      onAdd: () => void
    }

export function AddToCartBar(props: AddToCartBarProps): React.JSX.Element | null {
  if (props.mode === 'cart') {
    return <CartSummaryBar cartHref={props.cartHref} />
  }
  return <AddLineBar {...props} />
}

function AddLineBar({
  quantity,
  unitTotal,
  currency,
  decimals,
  disabled = false,
  disabledReason,
  pending = false,
  onAdd,
}: Extract<AddToCartBarProps, { mode: 'add' }>): React.JSX.Element {
  const t = useT()
  const total = formatMoney(unitTotal * quantity, currency, decimals, t.locale)

  return (
    <div className="flex flex-col gap-2">
      {disabled && disabledReason !== undefined && (
        <p className="text-caption text-warning">{disabledReason}</p>
      )}
      <Button
        type="button"
        variant="primary"
        size="lg"
        fullWidth
        disabled={disabled}
        loading={pending}
        loadingLabel={t('customer.cart.placing')}
        onClick={onAdd}
        iconStart={<ShoppingBag className="size-4" strokeWidth={1.5} />}
      >
        {t('customer.item.addToCartTotal', { total })}
      </Button>
    </div>
  )
}

function CartSummaryBar({ cartHref }: { cartHref: string }): React.JSX.Element | null {
  const t = useT()
  const { state, hydrated } = useCart()

  if (!hydrated || state.itemCount === 0) return null

  const total = formatMoney(state.totals.total, state.currency, state.currencyDecimals, state.locale)

  return (
    <div
      className={cn(
        'u-chrome-blur u-rule-gold fixed inset-x-0 bottom-0 z-(--z-cartbar) mx-auto flex w-full max-w-(--container-customer)',
        'shrink-0 items-center justify-between gap-3 border-t px-(--space-gutter-sm) h-(--space-cartbar-h)',
        'pb-[env(safe-area-inset-bottom,0px)]',
      )}
    >
      <span className="relative inline-flex shrink-0 items-center justify-center text-text">
        <ShoppingBag aria-hidden="true" focusable="false" strokeWidth={1.5} className="size-6" />
        <span className="u-tnum absolute -end-2 -top-2 inline-flex size-4.5 items-center justify-center rounded-full bg-accent-strong text-caption font-semibold text-accent-contrast">
          {state.itemCount}
        </span>
      </span>
      <Link href={cartHref} className={buttonClasses({ variant: 'primary', size: 'lg', className: 'flex-1' })}>
        {t('customer.menu.cartButton', { total })}
      </Link>
    </div>
  )
}
