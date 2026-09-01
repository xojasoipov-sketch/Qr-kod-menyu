'use client'

/**
 * src/components/admin/availability-toggle.tsx — AvailabilityToggle.
 *
 * The one-tap AVAILABLE / UNAVAILABLE switch brief §12 requires, wired
 * straight to `setItemAvailabilityAction`. Optimistic: the thumb moves
 * immediately, `pending` rings it while the write is in flight, and a
 * rejection snaps it back and explains why (04-design-system.md §6.1, States).
 */

import { useState, useTransition } from 'react'

import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { AppError } from '@/types/result'
import { setItemAvailabilityAction } from '@/app/(admin)/admin/menu/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

export interface AvailabilityToggleProps {
  menuItemId: string
  isAvailable: boolean
  /** Plain text, used only to build the accessible name — never rendered visibly. */
  itemName: string
  onChanged?: (isAvailable: boolean) => void
}

export function AvailabilityToggle({
  menuItemId,
  isAvailable,
  itemName,
  onChanged,
}: AvailabilityToggleProps): React.JSX.Element {
  const t = useT()
  const [checked, setChecked] = useState(isAvailable)
  const [pending, startTransition] = useTransition()

  const handleChange = (next: boolean): void => {
    setChecked(next)
    startTransition(async () => {
      const result = await setItemAvailabilityAction({
        menu_item_id: menuItemId,
        is_available: next,
        unavailable_until: null,
      })

      if (!result.ok) {
        setChecked(!next)
        toast.error(t('toasts.actionFailed'), { description: localizedErrorMessage(t, result.error) })
        return
      }

      onChanged?.(next)
      toast.success(next ? t('admin.menu.markAvailable') : t('admin.menu.markUnavailable'))
    })
  }

  return (
    <Switch
      checked={checked}
      onCheckedChange={handleChange}
      label={`${t('admin.menu.availability')} — ${itemName}`}
      hideLabel
      size="sm"
      pending={pending}
    />
  )
}
