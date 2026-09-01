'use client'

/**
 * src/components/admin/option-group-editor.tsx — OptionGroupEditor.
 *
 * `menu_item_options` is a FLAT table: the group (key, label, selection type,
 * min/max, sort order) is a discriminator repeated on every member row
 * (menu-mapper.ts). This editor keeps that same flat array as the single
 * source of truth — `value` / `onChange` mirror exactly what
 * `MenuItemInput.options` sends to the server — and only *groups* it for
 * rendering; editing a group-level field patches every option that shares
 * its `group_key` in one pass.
 */

import { useMemo } from 'react'
import { GripVertical, Plus, Trash2 } from 'lucide-react'

import { Button, IconButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { useT } from '@/lib/i18n/provider'
import { fromMinor, toMinor } from '@/lib/money'
import { LOCALES } from '@/types/i18n'
import type { I18nText, Locale } from '@/types/i18n'
import { OPTION_SELECTION_TYPES } from '@/types/database'
import type { MenuItemOptionInput } from '@/lib/validation/menu'

const LOCALE_LABEL_KEY: Record<Locale, 'labels.locale.uz' | 'labels.locale.ru' | 'labels.locale.en'> = {
  uz: 'labels.locale.uz',
  ru: 'labels.locale.ru',
  en: 'labels.locale.en',
}

function newKey(existing: ReadonlySet<string>): string {
  let index = existing.size + 1
  let key = `group_${index}`
  while (existing.has(key)) {
    index += 1
    key = `group_${index}`
  }
  return key
}

function emptyOption(groupKey: string, sortOrder: number): MenuItemOptionInput {
  return {
    group_key: groupKey,
    group_label: {},
    selection_type: 'multiple',
    group_min_select: 0,
    group_max_select: null,
    group_sort_order: sortOrder,
    name: {},
    price_delta: 0,
    max_quantity: 1,
    is_default: false,
    is_available: true,
    sort_order: 0,
  }
}

interface GroupBucket {
  key: string
  label: I18nText
  selectionType: MenuItemOptionInput['selection_type']
  minSelect: number
  maxSelect: number | null
  sortOrder: number
  options: { option: MenuItemOptionInput; index: number }[]
}

export interface OptionGroupEditorProps {
  value: readonly MenuItemOptionInput[]
  onChange: (next: MenuItemOptionInput[]) => void
  currency: string
  currencyDecimals: number
  locale: Locale
}

export function OptionGroupEditor({
  value,
  onChange,
  currency,
  currencyDecimals,
  locale,
}: OptionGroupEditorProps): React.JSX.Element {
  const t = useT()

  const groups = useMemo<GroupBucket[]>(() => {
    const buckets = new Map<string, GroupBucket>()
    value.forEach((option, index) => {
      let bucket = buckets.get(option.group_key)
      if (!bucket) {
        bucket = {
          key: option.group_key,
          label: option.group_label,
          selectionType: option.selection_type,
          minSelect: option.group_min_select,
          maxSelect: option.group_max_select,
          sortOrder: option.group_sort_order,
          options: [],
        }
        buckets.set(option.group_key, bucket)
      }
      bucket.options.push({ option, index })
    })
    return [...buckets.values()].sort((a, b) => a.sortOrder - b.sortOrder)
  }, [value])

  const groupKeys = useMemo(() => new Set(groups.map((g) => g.key)), [groups])

  function patchGroup(groupKey: string, patch: Partial<MenuItemOptionInput>): void {
    onChange(value.map((option) => (option.group_key === groupKey ? { ...option, ...patch } : option)))
  }

  function removeGroup(groupKey: string): void {
    onChange(value.filter((option) => option.group_key !== groupKey))
  }

  function addGroup(): void {
    const key = newKey(groupKeys)
    const sortOrder = groups.length
    onChange([...value, emptyOption(key, sortOrder)])
  }

  function addOption(bucket: GroupBucket): void {
    const next: MenuItemOptionInput = {
      ...emptyOption(bucket.key, bucket.sortOrder),
      group_label: bucket.label,
      selection_type: bucket.selectionType,
      group_min_select: bucket.minSelect,
      group_max_select: bucket.maxSelect,
      sort_order: bucket.options.length,
    }
    onChange([...value, next])
  }

  function removeOption(index: number): void {
    onChange(value.filter((_option, i) => i !== index))
  }

  function patchOption(index: number, patch: Partial<MenuItemOptionInput>): void {
    onChange(value.map((option, i) => (i === index ? { ...option, ...patch } : option)))
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-body-sm text-text-muted">{t('admin.menu.optionsHint')}</p>

      {groups.length === 0 && (
        <EmptyState size="sm" title={t('admin.menu.optionsTitle')} description={t('admin.menu.optionsHint')} />
      )}

      {groups.map((bucket) => (
        <OptionGroupCard
          key={bucket.key}
          bucket={bucket}
          locale={locale}
          currency={currency}
          currencyDecimals={currencyDecimals}
          onPatchGroup={(patch) => patchGroup(bucket.key, patch)}
          onRemove={() => removeGroup(bucket.key)}
          onAddOption={() => addOption(bucket)}
          onRemoveOption={removeOption}
          onPatchOption={patchOption}
        />
      ))}

      <Button
        variant="secondary"
        onClick={addGroup}
        iconStart={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
      >
        {t('admin.menu.addOptionGroup')}
      </Button>
    </div>
  )
}

function OptionGroupCard({
  bucket,
  locale,
  currency,
  currencyDecimals,
  onPatchGroup,
  onRemove,
  onAddOption,
  onRemoveOption,
  onPatchOption,
}: {
  bucket: GroupBucket
  locale: Locale
  currency: string
  currencyDecimals: number
  onPatchGroup: (patch: Partial<MenuItemOptionInput>) => void
  onRemove: () => void
  onAddOption: () => void
  onRemoveOption: (index: number) => void
  onPatchOption: (index: number, patch: Partial<MenuItemOptionInput>) => void
}): React.JSX.Element {
  const t = useT()

  const selectionOptions: SelectOption[] = OPTION_SELECTION_TYPES.map((value) => ({
    value,
    label: t(`labels.selectionType.${value}`),
  }))

  return (
    <Card padding="md" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-wrap gap-3">
          <Select
            label={t('admin.menu.groupSelection')}
            options={selectionOptions}
            value={bucket.selectionType}
            onChange={(event) =>
              onPatchGroup({
                selection_type: event.target.value as MenuItemOptionInput['selection_type'],
                ...(event.target.value === 'single' ? { group_max_select: 1 } : {}),
              })
            }
            wrapperClassName="max-w-40"
          />
          <Input
            label={t('admin.menu.groupMin')}
            type="number"
            min={0}
            max={20}
            value={bucket.minSelect}
            onChange={(event) => onPatchGroup({ group_min_select: Number(event.target.value) || 0 })}
            wrapperClassName="max-w-28"
          />
          <Input
            label={t('admin.menu.groupMax')}
            type="number"
            min={1}
            max={20}
            value={bucket.maxSelect ?? ''}
            disabled={bucket.selectionType === 'single'}
            onChange={(event) =>
              onPatchGroup({
                group_max_select: event.target.value === '' ? null : Number(event.target.value),
              })
            }
            wrapperClassName="max-w-28"
          />
        </div>
        <IconButton
          label={t('common.remove')}
          variant="danger"
          size="sm"
          icon={<Trash2 aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
          onClick={onRemove}
        />
      </div>

      <GroupLabelFields label={bucket.label} onChange={(next) => onPatchGroup({ group_label: next })} />

      <div className="flex flex-col gap-3 border-t border-border-subtle pt-3">
        {bucket.options.map(({ option, index }) => (
          <OptionRow
            key={index}
            option={option}
            locale={locale}
            currency={currency}
            currencyDecimals={currencyDecimals}
            onChange={(patch) => onPatchOption(index, patch)}
            onRemove={() => onRemoveOption(index)}
          />
        ))}

        <Button
          variant="ghost"
          size="sm"
          onClick={onAddOption}
          iconStart={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
          className="self-start"
        >
          {t('admin.menu.addOption')}
        </Button>
      </div>
    </Card>
  )
}

function GroupLabelFields({
  label,
  onChange,
}: {
  label: I18nText
  onChange: (next: I18nText) => void
}): React.JSX.Element {
  const t = useT()
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {LOCALES.map((locale) => (
        <Input
          key={locale}
          label={`${t('admin.menu.groupLabel')} · ${t(LOCALE_LABEL_KEY[locale])}`}
          value={label[locale] ?? ''}
          onChange={(event) => onChange({ ...label, [locale]: event.target.value })}
        />
      ))}
    </div>
  )
}

function OptionRow({
  option,
  locale,
  currency,
  currencyDecimals,
  onChange,
  onRemove,
}: {
  option: MenuItemOptionInput
  locale: Locale
  currency: string
  currencyDecimals: number
  onChange: (patch: Partial<MenuItemOptionInput>) => void
  onRemove: () => void
}): React.JSX.Element {
  const t = useT()

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-control bg-surface-sunken p-3">
      <span aria-hidden="true" className="mb-2 self-center text-text-disabled">
        <GripVertical className="size-4" strokeWidth={1.75} />
      </span>

      {LOCALES.map((optionLocale) => (
        <Input
          key={optionLocale}
          label={`${t('admin.menu.optionName')} · ${t(LOCALE_LABEL_KEY[optionLocale])}`}
          value={option.name[optionLocale] ?? ''}
          onChange={(event) => onChange({ name: { ...option.name, [optionLocale]: event.target.value } })}
          hideLabel={optionLocale !== locale}
          wrapperClassName="min-w-32 flex-1"
        />
      ))}

      <Input
        label={t('admin.menu.optionPriceDelta')}
        type="number"
        step={currencyDecimals > 0 ? 1 / 10 ** currencyDecimals : 1}
        value={fromMinor(option.price_delta, currencyDecimals)}
        onChange={(event) => {
          try {
            onChange({ price_delta: Math.max(0, toMinor(event.target.value || '0', currencyDecimals)) })
          } catch {
            // an in-progress keystroke ('', '-') is not yet a valid amount — ignored until it is.
          }
        }}
        suffix={currency}
        wrapperClassName="max-w-32"
      />

      <Switch
        checked={option.is_default}
        onCheckedChange={(checked) => onChange({ is_default: checked })}
        label={t('admin.menu.optionDefault')}
        size="sm"
      />

      <Switch
        checked={option.is_available}
        onCheckedChange={(checked) => onChange({ is_available: checked })}
        label={t('common.available')}
        size="sm"
      />

      <IconButton
        label={t('common.remove')}
        variant="danger"
        size="sm"
        icon={<Trash2 aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
        onClick={onRemove}
      />
    </div>
  )
}
