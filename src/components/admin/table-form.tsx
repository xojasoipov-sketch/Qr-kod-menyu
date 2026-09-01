'use client'

/**
 * src/components/admin/table-form.tsx — TableForm.
 *
 * Create or edit one table. `branch_id` is fixed to the branch the list is
 * already scoped to — never a field on this form — because a branch-scoped
 * session may only name its own branch (`table-service.ts`'s
 * `assertBranchScope`), and offering a picker that can fail server-side for
 * most roles is exactly the anti-pattern the assignment brief warns against.
 * `qr_token` never appears here: it is a column DEFAULT, minted by the
 * database, and rotated only through `rotateTableTokenAction`.
 */

import { useEffect, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { TableInput } from '@/lib/validation/tenancy'
import type { TableAdminView } from '@/lib/services/table-service'
import type { AppError } from '@/types/result'
import { createTableAction, updateTableAction } from '@/app/(admin)/admin/tables/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

function emptyForm(branchId: string, sortOrder: number): TableInput {
  return {
    branch_id: branchId,
    number: '',
    name: null,
    zone: null,
    seats: null,
    sort_order: sortOrder,
    is_active: true,
  }
}

function fromView(table: TableAdminView): TableInput {
  return {
    id: table.id,
    branch_id: table.branchId,
    number: table.number,
    name: table.name,
    zone: table.zone,
    seats: table.seats,
    sort_order: table.sortOrder,
    is_active: table.isActive,
  }
}

export interface TableFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: TableAdminView | null
  branchId: string
  nextSortOrder: number
  onSaved: () => void
}

export function TableForm({
  open,
  onOpenChange,
  initial,
  branchId,
  nextSortOrder,
  onSaved,
}: TableFormProps): React.JSX.Element {
  const t = useT()
  const [form, setForm] = useState<TableInput>(() =>
    initial ? fromView(initial) : emptyForm(branchId, nextSortOrder),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setForm(initial ? fromView(initial) : emptyForm(branchId, nextSortOrder))
    setError(null)
  }, [open, initial, branchId, nextSortOrder])

  function patch(next: Partial<TableInput>): void {
    setForm((current) => ({ ...current, ...next }))
  }

  function handleSubmit(): void {
    setError(null)
    startTransition(async () => {
      const result = form.id ? await updateTableAction(form) : await createTableAction(form)
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
      title={initial ? t('admin.tables.editTable') : t('admin.tables.newTable')}
      size="sm"
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
        <Input
          label={t('admin.tables.fieldNumber')}
          value={form.number}
          onChange={(event) => patch({ number: event.target.value })}
          announceError
        />
        <Input
          label={t('admin.tables.fieldName')}
          value={form.name ?? ''}
          onChange={(event) => patch({ name: event.target.value || null })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('admin.tables.fieldZone')}
            value={form.zone ?? ''}
            onChange={(event) => patch({ zone: event.target.value || null })}
          />
          <Input
            label={t('admin.tables.fieldSeats')}
            type="number"
            min={1}
            max={100}
            value={form.seats ?? ''}
            onChange={(event) =>
              patch({ seats: event.target.value === '' ? null : Number(event.target.value) })
            }
          />
        </div>
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
