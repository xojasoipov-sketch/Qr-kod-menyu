'use client'

/**
 * src/components/customer/item-detail-sheet.tsx — ItemDetailSheet.
 * Source: docs/architecture/04-design-system.md §6.2; 05-app-structure.md §3.3.2.
 *
 * The product detail: image, ingredients, dietary/spice info, one
 * `OptionGroupPicker` per option group, a note field, a quantity stepper and
 * the sticky `AddToCartBar`. Rendered inside a `Sheet` that is always open on
 * this route — there is no intercepted `@modal` slot in this slice, so both a
 * tap from the menu and a hard refresh land here the same way, and dismissing
 * (Escape, backdrop, drag, or the close button) sends the diner back to the
 * menu with `router.push`.
 *
 * `isAvailable === false` renders everything read-only: the option pickers and
 * quantity stepper stay visible (so a diner can still see what the dish would
 * have been) but the add bar is disabled with the localised reason — the
 * client refusal is cosmetic, `public_place_order` would refuse it regardless
 * (brief, `public_place_order` §QR020).
 *
 * Option groups enforce `minSelect`/`maxSelect` here, client-side, purely as UX;
 * checkout re-validates every line server-side regardless (brief).
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'

import { Sheet } from '@/components/ui/sheet'
import { QuantityStepper } from '@/components/ui/quantity-stepper'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useCart } from '@/components/customer/cart-provider'
import { useT } from '@/lib/i18n/provider'
import { sumMoney, multiplyMoney } from '@/lib/money'
import type { DietaryTag } from '@/types/database'
import type { CartLineOption, MenuItemView, TableContext } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'
import { AddToCartBar } from './add-to-cart-bar'
import { DIETARY_LABEL_KEYS, DietaryTags } from './dietary-tags'
import { FoodPlaceholder, dishSeed } from './food-placeholder'
import { OptionGroupPicker } from './option-group-picker'
import { SPICY_LABEL_KEYS, SpicyMeter } from './spicy-meter'

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

const NOTE_MAX = 200

export interface ItemDetailSheetProps {
  context: TableContext
  item: MenuItemView
}

export function ItemDetailSheet({ context, item }: ItemDetailSheetProps): React.JSX.Element {
  const t = useT()
  const router = useRouter()
  const { dispatch } = useCart()
  const activeLocale: Locale = t.locale
  const currency = context.restaurant.currency
  const decimals = context.restaurant.currencyDecimals

  const [quantity, setQuantity] = useState(1)
  const [selections, setSelections] = useState<Readonly<Record<string, readonly CartLineOption[]>>>({})
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const name = pickText(item.name, activeLocale)
  const description = item.description ? pickText(item.description, activeLocale) : null
  const ingredients = item.ingredients ? pickText(item.ingredients, activeLocale) : null

  const dietaryLabels = Object.fromEntries(
    item.dietaryTags.map((tag) => [tag, t(DIETARY_LABEL_KEYS[tag])]),
  ) as Record<DietaryTag, string>

  const flatOptions = useMemo(
    () => Object.values(selections).flat(),
    [selections],
  )
  const optionsUnitTotal = sumMoney(flatOptions.map((o) => multiplyMoney(o.priceDelta, o.quantity)))
  const unitTotal = item.price + optionsUnitTotal

  const unmetGroup = item.optionGroups.find((group) => {
    if (!group.isRequired) return false
    const count = selections[group.groupKey]?.length ?? 0
    return count < group.minSelect
  })
  const invalid = unmetGroup !== undefined

  const close = (): void => {
    router.push(`/t/${context.token}`)
  }

  const handleAdd = (): void => {
    if (!item.isAvailable) return
    if (invalid) {
      setAttempted(true)
      return
    }
    setPending(true)
    dispatch({
      type: 'add',
      now: new Date().toISOString(),
      line: {
        menuItemId: item.id,
        name: item.name,
        imageUrl: item.imageUrl,
        unitPrice: item.price,
        options: flatOptions as CartLineOption[],
        quantity,
        note: note.trim().length > 0 ? note.trim() : null,
        isAvailable: item.isAvailable,
        spicyLevel: item.spicyLevel,
      },
    })
    toast.success(t('toasts.itemAdded', { item: name }))
    close()
  }

  return (
    <Sheet
      open
      onOpenChange={(next) => {
        if (!next) close()
      }}
      title={name}
      size="tall"
      closeLabel={t('customer.item.backToMenu')}
      footer={
        <ItemDetailFooter
          quantity={quantity}
          unitTotal={unitTotal}
          currency={currency}
          decimals={decimals}
          available={item.isAvailable}
          invalid={invalid && attempted}
          pending={pending}
          unavailableReason={!item.isAvailable ? t('customer.item.unavailableBody') : undefined}
          invalidReason={invalid && attempted ? t('customer.item.optionRequired') : undefined}
          onAdd={handleAdd}
        />
      }
    >
      <div className="flex flex-col gap-5">
        <div className="relative aspect-4/3 w-full overflow-hidden rounded-media bg-surface-sunken">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt={name}
              fill
              sizes="(min-width: 640px) 560px, 100vw"
              className="object-cover"
              priority
            />
          ) : (
            <FoodPlaceholder seed={dishSeed(name, item.id)} monogram={name} ratio="4:3" />
          )}
        </div>

        {!item.isAvailable && (
          <p className="rounded-control border border-warning-line bg-warning-soft px-3 py-2 text-body-sm text-warning">
            {t('customer.item.unavailableBody')}
          </p>
        )}

        {description !== null && description !== '' && (
          <p className="text-body text-text-muted text-pretty">{description}</p>
        )}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {item.spicyLevel > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-caption text-text-subtle">{t('customer.item.spicyTitle')}</span>
              <SpicyMeter
                level={item.spicyLevel as 0 | 1 | 2 | 3}
                size="md"
                showLabel
                label={t(SPICY_LABEL_KEYS[item.spicyLevel as 0 | 1 | 2 | 3])}
                ariaLabel={t('a11y.spicyLevelLabel', { level: t(SPICY_LABEL_KEYS[item.spicyLevel as 0 | 1 | 2 | 3]) })}
              />
            </div>
          )}
          <div className="flex flex-col gap-1">
            <span className="text-caption text-text-subtle">{t('customer.item.prepTitle')}</span>
            <span className="text-body-sm text-text">{t('customer.menu.prepMinutes', { minutes: item.preparationTime })}</span>
          </div>
          {item.calories !== null && (
            <div className="flex flex-col gap-1">
              <span className="text-caption text-text-subtle">{t('customer.item.caloriesTitle')}</span>
              <span className="text-body-sm text-text">{t('customer.item.caloriesValue', { calories: item.calories })}</span>
            </div>
          )}
        </div>

        {item.dietaryTags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-text-subtle">{t('customer.item.dietaryTitle')}</span>
            <DietaryTags tags={item.dietaryTags} labels={dietaryLabels} size="md" />
          </div>
        )}

        {ingredients !== null && ingredients !== '' && (
          <div className="flex flex-col gap-1">
            <h3 className="text-body font-medium text-text">{t('customer.item.ingredientsTitle')}</h3>
            <p className="text-body-sm text-text-muted text-pretty">{ingredients}</p>
          </div>
        )}

        {item.optionGroups.length > 0 && (
          <div className="flex flex-col gap-4">
            <h3 className="text-body font-medium text-text">{t('customer.item.optionsTitle')}</h3>
            {item.optionGroups.map((group) => (
              <OptionGroupPicker
                key={group.groupKey}
                group={group}
                selected={selections[group.groupKey] ?? []}
                onChange={(next) => setSelections((prev) => ({ ...prev, [group.groupKey]: next }))}
                currency={currency}
                decimals={decimals}
                error={
                  attempted && group.isRequired && (selections[group.groupKey]?.length ?? 0) < group.minSelect
                    ? t('customer.item.optionRequired')
                    : undefined
                }
              />
            ))}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <Textarea
            label={t('customer.item.noteTitle')}
            placeholder={t('customer.item.notePlaceholder')}
            hint={t('customer.item.noteHint')}
            maxLength={NOTE_MAX}
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <span className="text-body font-medium text-text">{t('customer.item.quantityTitle')}</span>
          <QuantityStepper
            value={quantity}
            onValueChange={setQuantity}
            min={1}
            max={99}
            disabled={!item.isAvailable}
            label={t('customer.item.quantityTitle')}
            decreaseLabel={t('a11y.decreaseQuantity')}
            increaseLabel={t('a11y.increaseQuantity')}
          />
        </div>
      </div>
    </Sheet>
  )
}

function ItemDetailFooter({
  quantity,
  unitTotal,
  currency,
  decimals,
  available,
  invalid,
  pending,
  unavailableReason,
  invalidReason,
  onAdd,
}: {
  quantity: number
  unitTotal: number
  currency: string
  decimals: number
  available: boolean
  invalid: boolean
  pending: boolean
  unavailableReason?: string
  invalidReason?: string
  onAdd: () => void
}): React.JSX.Element {
  return (
    <AddToCartBar
      mode="add"
      quantity={quantity}
      unitTotal={unitTotal}
      currency={currency}
      decimals={decimals}
      disabled={!available || invalid}
      disabledReason={unavailableReason ?? invalidReason}
      pending={pending}
      onAdd={onAdd}
    />
  )
}
