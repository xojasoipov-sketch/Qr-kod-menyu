'use client'

/**
 * src/components/admin/menu-item-form.tsx — MenuItemForm.
 *
 * One dish, create or edit. Every field maps 1:1 to `MenuItemInput`
 * (`@/lib/validation/menu`) so the payload handed to the Server Action is
 * built directly from this component's state — no second shape in between.
 * Money fields round-trip through `fromMinor` / `toMinor`
 * (`@/lib/money`) so the field never touches a float; option groups are
 * delegated whole to `<OptionGroupEditor>`.
 */

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { OptionGroupEditor } from '@/components/admin/option-group-editor'
import { ImageUploader } from '@/components/admin/image-uploader'
import { Section } from '@/components/ui/section'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import { fromMinor, toMinor } from '@/lib/money'
import { DIETARY_TAGS } from '@/types/database'
import type { DietaryTag } from '@/types/database'
import { LOCALES } from '@/types/i18n'
import type { I18nText, Locale } from '@/types/i18n'
import type { MenuItemInput, MenuItemOptionInput } from '@/lib/validation/menu'
import type { MenuItemAdminView } from '@/lib/services/menu-service'
import type { AppError } from '@/types/result'
import {
  createMenuItemAction,
  updateMenuItemAction,
} from '@/app/(admin)/admin/menu/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

const LOCALE_LABEL_KEY: Record<Locale, 'labels.locale.uz' | 'labels.locale.ru' | 'labels.locale.en'> = {
  uz: 'labels.locale.uz',
  ru: 'labels.locale.ru',
  en: 'labels.locale.en',
}

function emptyI18nText(): I18nText {
  return {}
}

const SPICY_LEVEL_OPTIONS = [
  { value: '0', key: 'labels.spicy.0' },
  { value: '1', key: 'labels.spicy.1' },
  { value: '2', key: 'labels.spicy.2' },
  { value: '3', key: 'labels.spicy.3' },
] as const

function toFormState(item?: MenuItemAdminView | null, defaultCategoryId = ''): MenuItemInput {
  if (!item) {
    return {
      category_id: defaultCategoryId,
      branch_id: null,
      name: emptyI18nText(),
      description: null,
      ingredients: null,
      price: 0,
      compare_at_price: null,
      image_url: null,
      image_path: null,
      spicy_level: 0,
      preparation_time: 15,
      calories: null,
      dietary_tags: [],
      is_available: true,
      unavailable_until: null,
      available_from: null,
      available_until: null,
      is_featured: false,
      is_popular: false,
      sort_order: 0,
      options: [],
    }
  }

  return {
    id: item.item.id,
    category_id: item.item.categoryId,
    branch_id: item.branchId,
    name: item.item.name,
    description: item.item.description,
    ingredients: item.item.ingredients,
    price: item.item.price,
    compare_at_price: item.item.compareAtPrice,
    image_url: item.item.imageUrl,
    image_path: null,
    spicy_level: item.item.spicyLevel,
    preparation_time: item.item.preparationTime,
    calories: item.item.calories,
    dietary_tags: item.item.dietaryTags,
    is_available: item.item.isAvailable,
    unavailable_until: item.unavailableUntil,
    available_from: item.availableFrom,
    available_until: item.availableUntil,
    is_featured: item.item.isFeatured,
    is_popular: item.item.isPopular,
    sort_order: item.item.sortOrder,
    options: item.item.optionGroups.flatMap((group): MenuItemOptionInput[] =>
      group.options.map((option) => ({
        id: option.id,
        group_key: group.groupKey,
        group_label: group.groupLabel,
        selection_type: group.selectionType,
        group_min_select: group.minSelect,
        group_max_select: group.maxSelect,
        group_sort_order: group.sortOrder,
        name: option.name,
        price_delta: option.priceDelta,
        max_quantity: option.maxQuantity,
        is_default: option.isDefault,
        is_available: option.isAvailable,
        sort_order: option.sortOrder,
      })),
    ),
  }
}

function I18nTextField({
  label,
  value,
  onChange,
  multiline,
  required,
}: {
  label: string
  value: I18nText
  onChange: (next: I18nText) => void
  multiline?: boolean
  required?: boolean
}): React.JSX.Element {
  const t = useT()

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {LOCALES.map((locale) => {
        const fieldLabel = `${label} · ${t(LOCALE_LABEL_KEY[locale])}${required && locale === LOCALES[0] ? ` (${t('common.required')})` : ''}`
        return multiline ? (
          <Textarea
            key={locale}
            label={fieldLabel}
            value={value[locale] ?? ''}
            onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
            rows={3}
          />
        ) : (
          <Input
            key={locale}
            label={fieldLabel}
            value={value[locale] ?? ''}
            onChange={(event) => onChange({ ...value, [locale]: event.target.value })}
          />
        )
      })}
    </div>
  )
}

export interface MenuItemFormProps {
  initial: MenuItemAdminView | null
  categories: readonly { id: string; name: I18nText }[]
  branches: readonly { id: string; name: string }[]
  currency: string
  currencyDecimals: number
  locale: Locale
  listHref: string
}

export function MenuItemForm({
  initial,
  categories,
  branches,
  currency,
  currencyDecimals,
  locale,
  listHref,
}: MenuItemFormProps): React.JSX.Element {
  const t = useT()
  const router = useRouter()
  const [form, setForm] = useState<MenuItemInput>(() => toFormState(initial, categories[0]?.id ?? ''))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const categoryOptions: SelectOption[] = categories.map((category) => ({
    value: category.id,
    label: category.name[locale] ?? category.name.en ?? Object.values(category.name)[0] ?? category.id,
  }))

  const branchOptions: SelectOption[] = [
    { value: '', label: t('admin.categories.allBranches') },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ]

  const dietaryOptions: DietaryTag[] = [...DIETARY_TAGS]

  function patch(next: Partial<MenuItemInput>): void {
    setForm((current) => ({ ...current, ...next }))
  }

  function toggleDietary(tag: DietaryTag): void {
    setForm((current) => ({
      ...current,
      dietary_tags: current.dietary_tags.includes(tag)
        ? current.dietary_tags.filter((entry) => entry !== tag)
        : [...current.dietary_tags, tag],
    }))
  }

  function handleSubmit(): void {
    setError(null)
    startTransition(async () => {
      const result = form.id
        ? await updateMenuItemAction(form)
        : await createMenuItemAction(form)

      if (!result.ok) {
        setError(localizedErrorMessage(t, result.error))
        toast.error(t('toasts.saveFailed'))
        return
      }

      toast.success(t('toasts.saved'))
      router.push(listHref)
      router.refresh()
    })
  }

  return (
    <form
      className="flex flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault()
        handleSubmit()
      }}
    >
      <Section title={t('common.name')} spacing="sm">
        <I18nTextField label={t('admin.menu.fieldName')} value={form.name} onChange={(name) => patch({ name })} required />
      </Section>

      <Section title={t('admin.menu.fieldDescription')} spacing="sm">
        <I18nTextField
          label={t('admin.menu.fieldDescription')}
          value={form.description ?? {}}
          onChange={(description) => patch({ description })}
          multiline
        />
      </Section>

      <Section title={t('admin.menu.fieldIngredients')} spacing="sm">
        <I18nTextField
          label={t('admin.menu.fieldIngredients')}
          value={form.ingredients ?? {}}
          onChange={(ingredients) => patch({ ingredients })}
          multiline
        />
      </Section>

      <Section spacing="sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            label={t('admin.menu.fieldCategory')}
            options={categoryOptions}
            value={form.category_id}
            onChange={(event) => patch({ category_id: event.target.value })}
          />
          <Select
            label={t('admin.categories.fieldBranch')}
            options={branchOptions}
            value={form.branch_id ?? ''}
            onChange={(event) => patch({ branch_id: event.target.value === '' ? null : event.target.value })}
          />
          <Input
            label={`${t('admin.menu.fieldPrice')} (${currency})`}
            type="number"
            min={0}
            step={currencyDecimals > 0 ? 1 / 10 ** currencyDecimals : 1}
            value={fromMinor(form.price, currencyDecimals)}
            onChange={(event) => {
              try {
                patch({ price: Math.max(0, toMinor(event.target.value || '0', currencyDecimals)) })
              } catch {
                // an in-progress keystroke — ignored until it parses.
              }
            }}
          />
          <Input
            label={`${t('admin.menu.fieldCompareAtPrice')} (${currency})`}
            type="number"
            min={0}
            step={currencyDecimals > 0 ? 1 / 10 ** currencyDecimals : 1}
            value={form.compare_at_price === null ? '' : fromMinor(form.compare_at_price, currencyDecimals)}
            onChange={(event) => {
              if (event.target.value === '') {
                patch({ compare_at_price: null })
                return
              }
              try {
                patch({ compare_at_price: Math.max(0, toMinor(event.target.value, currencyDecimals)) })
              } catch {
                // ignored until it parses
              }
            }}
          />
        </div>
      </Section>

      <Section spacing="sm">
        <ImageUploader
          label={t('admin.menu.fieldImage')}
          hint={t('admin.menu.uploadHint')}
          kind="menu_item"
          value={{ url: form.image_url, path: form.image_path }}
          onChange={(next) => patch({ image_url: next.url, image_path: next.path })}
        />
      </Section>

      <Section spacing="sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            label={t('admin.menu.fieldPrepTime')}
            type="number"
            min={1}
            max={240}
            value={form.preparation_time}
            onChange={(event) => patch({ preparation_time: Number(event.target.value) || 1 })}
          />
          <Select
            label={t('admin.menu.fieldSpicy')}
            options={SPICY_LEVEL_OPTIONS.map((option) => ({ value: option.value, label: t(option.key) }))}
            value={String(form.spicy_level)}
            onChange={(event) => patch({ spicy_level: Number(event.target.value) })}
          />
          <Input
            label={t('admin.menu.fieldCalories')}
            type="number"
            min={0}
            value={form.calories ?? ''}
            onChange={(event) =>
              patch({ calories: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        </div>
      </Section>

      <Section title={t('admin.menu.fieldDietary')} spacing="sm">
        <div className="flex flex-wrap gap-2">
          {dietaryOptions.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => toggleDietary(tag)}
              aria-pressed={form.dietary_tags.includes(tag)}
              className={`min-h-9 rounded-control border px-3 text-body-sm transition-colors duration-(--duration-fast) ease-standard ${
                form.dietary_tags.includes(tag)
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-surface text-text-muted hover:text-text'
              }`}
            >
              {t(`labels.dietary.${tag}`)}
            </button>
          ))}
        </div>
      </Section>

      <Section spacing="sm">
        <div className="flex flex-wrap gap-6">
          <Switch
            checked={form.is_available}
            onCheckedChange={(checked) =>
              patch({ is_available: checked, unavailable_until: checked ? null : form.unavailable_until })
            }
            label={t('admin.menu.availability')}
          />
          {!form.is_available && (
            <Input
              label={t('admin.menu.unavailableUntilLabel')}
              type="datetime-local"
              value={form.unavailable_until?.slice(0, 16) ?? ''}
              onChange={(event) =>
                patch({
                  unavailable_until: event.target.value === '' ? null : new Date(event.target.value).toISOString(),
                })
              }
            />
          )}
          <Switch
            checked={form.is_featured}
            onCheckedChange={(checked) => patch({ is_featured: checked })}
            label={t('admin.menu.fieldFeatured')}
          />
          <Switch
            checked={form.is_popular}
            onCheckedChange={(checked) => patch({ is_popular: checked })}
            label={t('admin.menu.fieldPopular')}
          />
        </div>
      </Section>

      <Section title={t('admin.menu.optionsTitle')} spacing="sm">
        <OptionGroupEditor
          value={form.options}
          onChange={(options) => patch({ options })}
          currency={currency}
          currencyDecimals={currencyDecimals}
          locale={locale}
        />
      </Section>

      {error && (
        <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="submit" variant="primary" loading={pending} loadingLabel={t('common.saving')}>
          {t('common.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.push(listHref)} disabled={pending}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  )
}
