'use client'

/**
 * src/components/customer/option-group-picker.tsx — OptionGroupPicker.
 * Source: docs/architecture/04-design-system.md §6.2; brief's "option groups enforce
 * min/max selection client-side; checkout re-validates server-side regardless".
 *
 * One `MenuOptionGroupView`, rendered as a real radio group (`selectionType ===
 * 'single'`) or a set of real checkboxes (`'multiple'`), each backed by a native
 * `<input>` so keyboard and screen-reader behaviour comes from the platform
 * rather than being reimplemented. An option whose own `maxQuantity` is greater
 * than 1 grows a `QuantityStepper` once it is selected, so "extra cheese, up to
 * 3" is expressible without a second control language.
 *
 * This component only decides what CAN be tapped right now (§9.2 tap targets,
 * `maxSelect` disabling further picks); it never decides whether the group's
 * requirement is satisfied — the caller (`ItemDetailSheet`) owns that against
 * `minSelect`, because only it knows every group's state at once.
 */

import { useId } from 'react'

import { QuantityStepper } from '@/components/ui/quantity-stepper'
import { formatMoney } from '@/lib/money'
import { useLocale, useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { CartLineOption } from '@/types/domain'
import type { MenuOptionGroupView } from '@/types/domain'

function pickText(text: Record<string, string | undefined> | null | undefined, locale: string): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface OptionGroupPickerProps {
  group: MenuOptionGroupView
  selected: readonly CartLineOption[]
  onChange: (next: readonly CartLineOption[]) => void
  currency: string
  decimals: number
  /** Shown under the group heading once a selection was attempted and is short. */
  error?: string
  className?: string
}

export function OptionGroupPicker({
  group,
  selected,
  onChange,
  currency,
  decimals,
  error,
  className,
}: OptionGroupPickerProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const groupId = useId()

  const selectedCount = selected.length
  const atMax = group.maxSelect !== null && selectedCount >= group.maxSelect

  const toggleSingle = (optionId: string): void => {
    const option = group.options.find((o) => o.id === optionId)
    if (!option || !option.isAvailable) return
    const already = selected.some((s) => s.optionId === optionId)
    onChange(
      already
        ? []
        : [{ optionId, groupKey: group.groupKey, name: option.name, priceDelta: option.priceDelta, quantity: 1 }],
    )
  }

  const toggleMultiple = (optionId: string): void => {
    const option = group.options.find((o) => o.id === optionId)
    if (!option || !option.isAvailable) return
    const already = selected.some((s) => s.optionId === optionId)
    if (already) {
      onChange(selected.filter((s) => s.optionId !== optionId))
      return
    }
    if (atMax) return
    onChange([
      ...selected,
      { optionId, groupKey: group.groupKey, name: option.name, priceDelta: option.priceDelta, quantity: 1 },
    ])
  }

  const setOptionQuantity = (optionId: string, quantity: number): void => {
    const option = group.options.find((o) => o.id === optionId)
    if (!option) return
    if (quantity <= 0) {
      onChange(selected.filter((s) => s.optionId !== optionId))
      return
    }
    const already = selected.some((s) => s.optionId === optionId)
    onChange(
      already
        ? selected.map((s) => (s.optionId === optionId ? { ...s, quantity } : s))
        : [
            ...selected,
            { optionId, groupKey: group.groupKey, name: option.name, priceDelta: option.priceDelta, quantity },
          ],
    )
  }

  return (
    <fieldset className={cn('flex flex-col gap-2.5', className)}>
      <legend className="flex w-full flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-body font-medium text-text">{pickText(group.groupLabel, locale)}</span>
        <span className="text-caption text-text-subtle">
          {group.isRequired
            ? group.selectionType === 'single'
              ? t('customer.item.chooseOne')
              : t('customer.item.chooseAtLeast', { min: group.minSelect })
            : group.maxSelect !== null
              ? t('customer.item.chooseUpTo', { max: group.maxSelect })
              : ''}
        </span>
      </legend>

      <div className="flex flex-col gap-1.5">
        {group.options.map((option) => {
          const line = selected.find((s) => s.optionId === option.id);
          const isChecked = line !== undefined;
          const disabled = !option.isAvailable || (!isChecked && group.selectionType === 'multiple' && atMax);
          const inputName = `${groupId}-${group.groupKey}`;
          const inputType = group.selectionType === 'single' ? 'radio' : 'checkbox';
          const priceLabel =
            option.priceDelta > 0 ? `+${formatMoney(option.priceDelta, currency, decimals, locale)}` : null;

          return (
            <div
              key={option.id}
              className={cn(
                'flex items-center gap-3 rounded-control border border-border bg-surface-sunken px-3 py-2.5',
                disabled && 'opacity-50',
              )}
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                <input
                  type={inputType}
                  name={inputType === 'radio' ? inputName : undefined}
                  checked={isChecked}
                  disabled={disabled}
                  onChange={() =>
                    group.selectionType === 'single' ? toggleSingle(option.id) : toggleMultiple(option.id)
                  }
                  className="size-5 shrink-0 accent-(--color-accent-strong)"
                />
                <span className="min-w-0 flex-1 truncate text-body-sm text-text">
                  {pickText(option.name, locale)}
                  {!option.isAvailable && (
                    <span className="ms-1.5 text-caption text-text-subtle">
                      ({t('customer.item.optionUnavailable')})
                    </span>
                  )}
                </span>
                {priceLabel !== null && (
                  <span className="u-tnum shrink-0 text-caption text-text-muted">{priceLabel}</span>
                )}
              </label>

              {isChecked && option.maxQuantity > 1 && (
                <QuantityStepper
                  size="sm"
                  value={line.quantity}
                  min={1}
                  max={option.maxQuantity}
                  onValueChange={(n) => setOptionQuantity(option.id, n)}
                  label={pickText(option.name, locale)}
                  decreaseLabel={t('a11y.decreaseQuantity')}
                  increaseLabel={t('a11y.increaseQuantity')}
                />
              )}
            </div>
          );
        })}
      </div>

      {error !== undefined && <p className="text-caption text-danger">{error}</p>}
    </fieldset>
  )
}
