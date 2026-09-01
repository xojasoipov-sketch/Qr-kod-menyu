'use client'

/**
 * src/components/admin/category-form.tsx — CategoryForm.
 *
 * Create or edit one `menu_categories` row, inside a `<Dialog>`. Mirrors
 * `menu-item-form.tsx`'s shape: local state IS the `CategoryInput` payload,
 * so submitting is a direct call to the matching Server Action.
 */

import { useEffect, useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { ImageUploader } from '@/components/admin/image-uploader'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import { LOCALES } from '@/types/i18n'
import type { I18nText, Locale } from '@/types/i18n'
import type { CategoryInput } from '@/lib/validation/menu'
import type { CategoryAdminView } from '@/lib/services/menu-service'
import type { AppError } from '@/types/result'
import {
  createCategoryAction,
  updateCategoryAction,
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

function emptyForm(sortOrder: number): CategoryInput {
  return {
    branch_id: null,
    name: {},
    description: null,
    image_url: null,
    image_path: null,
    icon: null,
    sort_order: sortOrder,
    is_active: true,
  }
}

function fromView(category: CategoryAdminView): CategoryInput {
  return {
    id: category.view.id,
    branch_id: category.branchId,
    name: category.view.name,
    description: category.view.description,
    image_url: category.view.imageUrl,
    image_path: null,
    icon: category.view.icon,
    sort_order: category.view.sortOrder,
    is_active: category.isActive,
  }
}

export interface CategoryFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: CategoryAdminView | null
  branches: readonly { id: string; name: string }[]
  nextSortOrder: number
  onSaved: () => void
}

export function CategoryForm({
  open,
  onOpenChange,
  initial,
  branches,
  nextSortOrder,
  onSaved,
}: CategoryFormProps): React.JSX.Element {
  const t = useT()
  const fieldId = useId()
  const [form, setForm] = useState<CategoryInput>(() =>
    initial ? fromView(initial) : emptyForm(nextSortOrder),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setForm(initial ? fromView(initial) : emptyForm(nextSortOrder))
    setError(null)
  }, [open, initial, nextSortOrder])

  function patch(next: Partial<CategoryInput>): void {
    setForm((current) => ({ ...current, ...next }))
  }

  const branchOptions: SelectOption[] = [
    { value: '', label: t('admin.categories.allBranches') },
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ]

  function handleSubmit(): void {
    setError(null)
    startTransition(async () => {
      const result = form.id ? await updateCategoryAction(form) : await createCategoryAction(form)
      if (!result.ok) {
        setError(localizedErrorMessage(t, result.error))
        return
      }
      toast.success(t('toasts.saved'))
      onSaved()
      onOpenChange(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t('admin.categories.editCategory') : t('admin.categories.newCategory')}
      size="md"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={pending} loadingLabel={t('common.saving')}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {LOCALES.map((locale) => (
            <Input
              key={locale}
              label={`${t('admin.categories.fieldName')} · ${t(LOCALE_LABEL_KEY[locale])}`}
              value={form.name[locale] ?? ''}
              onChange={(event) => patch({ name: { ...form.name, [locale]: event.target.value } as I18nText })}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          {LOCALES.map((locale) => (
            <Textarea
              key={locale}
              label={`${t('admin.categories.fieldDescription')} · ${t(LOCALE_LABEL_KEY[locale])}`}
              value={form.description?.[locale] ?? ''}
              onChange={(event) =>
                patch({ description: { ...(form.description ?? {}), [locale]: event.target.value } as I18nText })
              }
              rows={2}
            />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            id={fieldId}
            label={t('admin.categories.fieldIcon')}
            value={form.icon ?? ''}
            onChange={(event) => patch({ icon: event.target.value.trim().toLowerCase() || null })}
          />
          <Select
            label={t('admin.categories.fieldBranch')}
            options={branchOptions}
            value={form.branch_id ?? ''}
            onChange={(event) => patch({ branch_id: event.target.value === '' ? null : event.target.value })}
          />
        </div>

        <ImageUploader
          label={t('common.image')}
          kind="menu_category"
          value={{ url: form.image_url, path: form.image_path }}
          onChange={(next) => patch({ image_url: next.url, image_path: next.path })}
        />

        <Switch
          checked={form.is_active}
          onCheckedChange={(checked) => patch({ is_active: checked })}
          label={t('common.active')}
        />

        {error && (
          <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
