'use client'

/**
 * src/components/admin/category-reorder.tsx — CategoryReorder.
 *
 * The `/admin/categories` list: activate/deactivate in place, edit or delete
 * through `<CategoryForm>` / a confirm, and reorder with the two arrow
 * buttons — keyboard- and screen-reader-operable in a way a pointer-only
 * drag handle is not, which is why they are the primary affordance and not
 * a progressive-enhancement afterthought.
 */

import { useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, FolderTree, Pencil, Plus, Trash2 } from 'lucide-react'

import { CategoryForm } from '@/components/admin/category-form'
import { Button, IconButton } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { CategoryAdminView } from '@/lib/services/menu-service'
import type { AppError } from '@/types/result'
import type { I18nText, Locale } from '@/types/i18n'
import {
  deleteCategoryAction,
  reorderCategoriesAction,
  setCategoryActiveAction,
} from '@/app/(admin)/admin/menu/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

function pickText(text: I18nText, locale: Locale): string {
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? ''
}

export interface CategoryReorderProps {
  initialCategories: readonly CategoryAdminView[]
  branches: readonly { id: string; name: string }[]
  locale: Locale
}

export function CategoryReorder({
  initialCategories,
  branches,
  locale,
}: CategoryReorderProps): React.JSX.Element {
  const t = useT()
  const [categories, setCategories] = useState(
    [...initialCategories].sort((a, b) => a.view.sortOrder - b.view.sortOrder),
  )
  const [editing, setEditing] = useState<CategoryAdminView | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<CategoryAdminView | null>(null)
  const [, startReorder] = useTransition()

  function swap(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= categories.length) return

    const next = [...categories]
    const a = next[index]
    const b = next[target]
    if (!a || !b) return
    next[index] = b
    next[target] = a
    setCategories(next)

    startReorder(async () => {
      const result = await reorderCategoriesAction({
        entity: 'menu_category',
        items: next.map((category, sortOrder) => ({ id: category.view.id, sort_order: sortOrder })),
      })
      if (!result.ok) {
        toast.error(t('toasts.saveFailed'), { description: localizedErrorMessage(t, result.error) })
        setCategories(categories)
      }
    })
  }

  function handleToggleActive(category: CategoryAdminView, next: boolean): void {
    setCategories((current) =>
      current.map((entry) => (entry.view.id === category.view.id ? { ...entry, isActive: next } : entry)),
    )
    startReorder(async () => {
      const result = await setCategoryActiveAction({ id: category.view.id, is_active: next })
      if (!result.ok) {
        toast.error(t('toasts.saveFailed'), { description: localizedErrorMessage(t, result.error) })
        setCategories((current) =>
          current.map((entry) =>
            entry.view.id === category.view.id ? { ...entry, isActive: !next } : entry,
          ),
        )
      }
    })
  }

  async function handleDelete(): Promise<void> {
    if (!pendingDelete) return
    const target = pendingDelete
    const result = await deleteCategoryAction({ id: target.view.id })
    if (!result.ok) throw new Error(localizedErrorMessage(t, result.error))
    setCategories((current) => current.filter((entry) => entry.view.id !== target.view.id))
    toast.success(t('toasts.deleted'))
  }

  const branchName = (branchId: string | null): string =>
    branchId === null
      ? t('admin.categories.allBranches')
      : (branches.find((branch) => branch.id === branchId)?.name ?? '')

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          iconStart={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
        >
          {t('admin.categories.newCategory')}
        </Button>
      </div>

      {categories.length === 0 ? (
        <EmptyState
          icon={<FolderTree aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
          title={t('admin.categories.empty.title')}
          description={t('admin.categories.empty.body')}
          action={{ label: t('admin.categories.emptyCta'), onClick: () => setCreating(true) }}
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {categories.map((category, index) => (
            <li key={category.view.id}>
              <Card padding="sm" className="flex flex-wrap items-center gap-3">
                <div className="flex flex-col">
                  <IconButton
                    label={t('common.previous')}
                    variant="ghost"
                    size="sm"
                    disabled={index === 0}
                    onClick={() => swap(index, -1)}
                    icon={<ArrowUp aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
                  />
                  <IconButton
                    label={t('common.next')}
                    variant="ghost"
                    size="sm"
                    disabled={index === categories.length - 1}
                    onClick={() => swap(index, 1)}
                    icon={<ArrowDown aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
                  />
                </div>

                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="font-medium text-text">{pickText(category.view.name, locale)}</span>
                  <span className="text-caption text-text-subtle">
                    {t('admin.categories.itemsInCategory', { count: category.view.itemCount })} ·{' '}
                    {branchName(category.branchId)}
                  </span>
                </div>

                <Switch
                  checked={category.isActive}
                  onCheckedChange={(next) => handleToggleActive(category, next)}
                  label={t('common.active')}
                  hideLabel
                  size="sm"
                />

                <IconButton
                  label={t('common.edit')}
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing(category)}
                  icon={<Pencil aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
                />
                <IconButton
                  label={t('common.delete')}
                  variant="danger"
                  size="sm"
                  onClick={() => setPendingDelete(category)}
                  icon={<Trash2 aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
                />
              </Card>
            </li>
          ))}
        </ul>
      )}

      <CategoryForm
        open={creating}
        onOpenChange={setCreating}
        initial={null}
        branches={branches}
        nextSortOrder={categories.length}
        onSaved={() => window.location.reload()}
      />

      <CategoryForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        initial={editing}
        branches={branches}
        nextSortOrder={categories.length}
        onSaved={() => window.location.reload()}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDelete(null)
        }}
        title={t('admin.categories.deleteConfirmTitle', {
          category: pendingDelete ? pickText(pendingDelete.view.name, locale) : '',
        })}
        description={
          pendingDelete && pendingDelete.view.itemCount > 0
            ? t('admin.categories.deleteBlockedBody', { count: pendingDelete.view.itemCount })
            : t('admin.categories.deleteConfirmBody')
        }
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busyLabel={t('common.deleting')}
        onConfirm={handleDelete}
      />
    </div>
  )
}
