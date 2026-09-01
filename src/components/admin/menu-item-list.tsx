'use client'

/**
 * src/components/admin/menu-item-list.tsx — MenuItemList.
 *
 * The `/admin/menu` table: search, category and availability filters run
 * client-side over the already-fetched branch list (menu-service's own
 * comment notes admin-list cardinality is tens to low hundreds of dishes, so
 * a second round trip per keystroke would be pointless). Each row links to
 * the edit page, toggles availability in place, and can be soft-deleted with
 * a confirm.
 */

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Plus, Search, Trash2, UtensilsCrossed } from 'lucide-react'

import { AvailabilityToggle } from '@/components/admin/availability-toggle'
import { Button, IconButton } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { PriceTag } from '@/components/ui/price-tag'
import { Select, type SelectOption } from '@/components/ui/select'
import { StatusPill } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { MenuItemAdminView } from '@/lib/services/menu-service'
import type { AppError } from '@/types/result'
import type { I18nText, Locale } from '@/types/i18n'
import { deleteMenuItemAction } from '@/app/(admin)/admin/menu/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

function pickText(text: I18nText | null | undefined, locale: Locale): string {
  if (!text) return ''
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface MenuItemListProps {
  items: readonly MenuItemAdminView[]
  categories: readonly { id: string; name: I18nText }[]
  locale: Locale
  currency: string
  currencyDecimals: number
  newHref: string
  editHref: (itemId: string) => string
}

type AvailabilityFilter = 'all' | 'available' | 'unavailable'

export function MenuItemList({
  items,
  categories,
  locale,
  currency,
  currencyDecimals,
  newHref,
  editHref,
}: MenuItemListProps): React.JSX.Element {
  const t = useT()
  const [rows, setRows] = useState(items)
  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState<string>('')
  const [availability, setAvailability] = useState<AvailabilityFilter>('all')
  const [pendingDelete, setPendingDelete] = useState<MenuItemAdminView | null>(null)

  const categoryOptions: SelectOption[] = useMemo(
    () => [
      { value: '', label: t('common.all') },
      ...categories.map((category) => ({ value: category.id, label: pickText(category.name, locale) })),
    ],
    [categories, locale, t],
  )

  const availabilityOptions: SelectOption<AvailabilityFilter>[] = [
    { value: 'all', label: t('common.all') },
    { value: 'available', label: t('common.available') },
    { value: 'unavailable', label: t('common.unavailable') },
  ]

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return rows.filter((row) => {
      if (categoryId !== '' && row.item.categoryId !== categoryId) return false
      if (availability === 'available' && !row.item.isAvailable) return false
      if (availability === 'unavailable' && row.item.isAvailable) return false
      if (needle === '') return true
      const haystack = [pickText(row.item.name, locale), pickText(row.categoryName, locale)]
        .join(' ')
        .toLowerCase()
      return haystack.includes(needle)
    })
  }, [rows, search, categoryId, availability, locale])

  const handleDelete = async (): Promise<void> => {
    if (!pendingDelete) return
    const target = pendingDelete
    const result = await deleteMenuItemAction({ id: target.item.id })
    if (!result.ok) throw new Error(localizedErrorMessage(t, result.error))
    setRows((current) => current.filter((row) => row.item.id !== target.item.id))
    toast.success(t('toasts.deleted'))
  }

  const columns: DataTableColumn<MenuItemAdminView>[] = [
    {
      id: 'name',
      header: t('common.name'),
      cell: (row) => (
        <Link
          href={editHref(row.item.id)}
          className="font-medium text-text underline-offset-4 hover:underline"
        >
          {pickText(row.item.name, locale)}
        </Link>
      ),
    },
    {
      id: 'category',
      header: t('common.category'),
      hideBelow: 'md',
      cell: (row) => (
        <span className="text-text-muted">{pickText(row.categoryName, locale)}</span>
      ),
    },
    {
      id: 'price',
      header: t('common.price'),
      align: 'end',
      width: '120px',
      cell: (row) => (
        <PriceTag
          amount={row.item.price}
          currency={currency}
          decimals={currencyDecimals}
          locale={locale}
          size="sm"
        />
      ),
    },
    {
      id: 'availability',
      header: t('admin.menu.availability'),
      width: '160px',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <AvailabilityToggle
            menuItemId={row.item.id}
            isAvailable={row.item.isAvailable}
            itemName={pickText(row.item.name, locale)}
            onChanged={(next) =>
              setRows((current) =>
                current.map((entry) =>
                  entry.item.id === row.item.id
                    ? { ...entry, item: { ...entry.item, isAvailable: next } }
                    : entry,
                ),
              )
            }
          />
          <StatusPill
            kind="availability"
            status={row.item.isAvailable ? 'available' : 'unavailable'}
            label={row.item.isAvailable ? t('common.available') : t('common.unavailable')}
            size="sm"
          />
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      width: '96px',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton
            label={t('common.delete')}
            variant="danger"
            size="sm"
            icon={<Trash2 aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
            onClick={() => setPendingDelete(row)}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('common.search')}
          hideLabel
          placeholder={t('common.search')}
          iconStart={<Search aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          wrapperClassName="max-w-xs"
        />
        <Select
          label={t('admin.menu.filterCategory')}
          hideLabel
          options={categoryOptions}
          value={categoryId}
          onChange={(event) => setCategoryId(event.target.value)}
          wrapperClassName="max-w-48"
        />
        <Select
          label={t('admin.menu.filterAvailability')}
          hideLabel
          options={availabilityOptions}
          value={availability}
          onChange={(event) => setAvailability(event.target.value as AvailabilityFilter)}
          wrapperClassName="max-w-40"
        />
        <Link href={newHref} className="ms-auto">
          <Button
            variant="primary"
            iconStart={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
          >
            {t('admin.menu.newItem')}
          </Button>
        </Link>
      </div>

      <DataTable
        caption={t('admin.menu.title')}
        columns={columns}
        rows={filtered}
        getRowId={(row) => row.item.id}
        empty={
          <EmptyState
            icon={<UtensilsCrossed aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
            title={t('admin.menu.empty.title')}
            description={t('admin.menu.empty.body')}
            action={{ label: t('admin.menu.emptyCta'), href: newHref }}
          />
        }
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('admin.menu.deleteConfirmTitle', {
          item: pendingDelete ? pickText(pendingDelete.item.name, locale) : '',
        })}
        description={t('admin.menu.deleteConfirmBody')}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busyLabel={t('common.deleting')}
        onConfirm={handleDelete}
      />
    </div>
  )
}
