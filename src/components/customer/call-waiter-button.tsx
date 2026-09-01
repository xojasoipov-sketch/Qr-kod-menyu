'use client'

/**
 * src/components/customer/call-waiter-button.tsx — CallWaiterButton.
 * Source: docs/architecture/04-design-system.md §6.2; brief's waiter-call flow.
 *
 * The floating trigger, always reachable one-handed, positioned within a frame
 * matching the centred customer column (not the raw viewport edge, which would
 * strand it on a wide desktop window). It owns only the sheet's open state; the
 * reason grid, the cooldown countdown and the RPC call itself live in
 * `<WaiterCallSheet>` (`@/components/customer/waiter-call-sheet`), which this
 * table's route tree already ships for the order-tracking page's own call
 * affordance — reusing it here keeps the customer app with exactly one waiter
 * call experience instead of two independently built ones.
 */

import { useState } from 'react'
import { BellRing } from 'lucide-react'

import { IconButton } from '@/components/ui/button'
import { WaiterCallSheet } from '@/components/customer/waiter-call-sheet'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'

export interface CallWaiterButtonProps {
  token: string
  /** `tableContext.table.number` — interpolated into the sheet's body copy. */
  tableNumber: string
  className?: string
}

export function CallWaiterButton({ token, tableNumber, className }: CallWaiterButtonProps): React.JSX.Element {
  const t = useT()
  const [open, setOpen] = useState(false)

  return (
    <>
      {/*
        A fixed, full-width, non-interactive frame matching the centred customer
        column, so the button can anchor to its trailing edge rather than the
        raw viewport edge.
      */}
      <div
        className={cn(
          'pointer-events-none fixed inset-x-0 z-(--z-raised) mx-auto w-full max-w-(--container-customer)',
          'bottom-[calc(var(--space-cartbar-h)+env(safe-area-inset-bottom,0px)+1rem)]',
        )}
      >
        <IconButton
          type="button"
          variant="solid"
          size="lg"
          label={t('customer.waiterCall.cta')}
          icon={<BellRing aria-hidden="true" focusable="false" strokeWidth={1.5} className="size-5" />}
          onClick={() => setOpen(true)}
          className={cn('pointer-events-auto absolute end-4 shadow-float', className)}
        />
      </div>

      <WaiterCallSheet token={token} tableNumber={tableNumber} open={open} onOpenChange={setOpen} />
    </>
  )
}
