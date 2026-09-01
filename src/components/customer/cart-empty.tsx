'use client'

/**
 * The empty cart. A real designed state, not a blank page (brief §32) — a link
 * back to the menu is the only thing worth offering here.
 */

import { ShoppingBag } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { useT } from '@/lib/i18n/provider'

export interface CartEmptyProps {
  menuHref: string
}

export function CartEmpty({ menuHref }: CartEmptyProps): React.JSX.Element {
  const t = useT()

  return (
    <EmptyState
      align="center"
      icon={<ShoppingBag className="size-7" strokeWidth={1.75} />}
      title={t('customer.cart.emptyTitle')}
      description={t('customer.cart.emptyBody')}
      action={{ label: t('customer.cart.emptyCta'), href: menuHref }}
    />
  )
}
