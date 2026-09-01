'use client'

/**
 * src/components/admin/table-list.tsx — TableList.
 *
 * The `/admin/tables` screen: create, edit, take out of service / put back
 * (brief's "disable"), preview the QR (`<QrPreview>`) and regenerate its
 * token (`rotateTableTokenAction`) — the one destructive-feeling action that
 * gets a typed confirmation, because the printed code on the table stops
 * working the instant it succeeds. Taking a table out of service is
 * confirmed too (guests scanning it see a notice instead of the menu);
 * putting it back is immediate.
 */

import { useState, useTransition } from 'react'
import { Plus, QrCode, RotateCw, Table as TableIcon } from 'lucide-react'

import { Button, IconButton } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { QrPreview } from '@/components/admin/qr-preview'
import { StatusPill } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { TableForm } from '@/components/admin/table-form'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { TableAdminView } from '@/lib/services/table-service'
import type { AppError } from '@/types/result'
import { rotateTableTokenAction, setTableActiveAction } from '@/app/(admin)/admin/tables/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

export interface TableListProps {
  initialTables: readonly TableAdminView[]
  branchId: string
}

export function TableList({ initialTables, branchId }: TableListProps): React.JSX.Element {
  const t = useT()
  const [tables, setTables] = useState([...initialTables].sort((a, b) => a.sortOrder - b.sortOrder))
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<TableAdminView | null>(null)
  const [previewing, setPreviewing] = useState<TableAdminView | null>(null)
  const [rotating, setRotating] = useState<TableAdminView | null>(null)
  const [deactivating, setDeactivating] = useState<TableAdminView | null>(null)
  const [, startToggle] = useTransition()

  function replace(table: TableAdminView): void {
    setTables((current) => current.map((entry) => (entry.id === table.id ? table : entry)))
  }

  function setActive(table: TableAdminView, next: boolean): void {
    setTables((current) =>
      current.map((entry) => (entry.id === table.id ? { ...entry, isActive: next } : entry)),
    )
    startToggle(async () => {
      const result = await setTableActiveAction({ id: table.id, is_active: next })
      if (!result.ok) {
        toast.error(t('toasts.saveFailed'), { description: localizedErrorMessage(t, result.error) })
        setTables((current) =>
          current.map((entry) => (entry.id === table.id ? { ...entry, isActive: !next } : entry)),
        )
      }
    })
  }

  function handleToggleActive(table: TableAdminView, next: boolean): void {
    if (!next) {
      setDeactivating(table)
      return
    }
    setActive(table, true)
  }

  async function handleConfirmDeactivate(): Promise<void> {
    if (!deactivating) return
    setActive(deactivating, false)
  }

  async function handleRotate(): Promise<void> {
    if (!rotating) return
    const target = rotating
    const result = await rotateTableTokenAction({ table_id: target.id, reason: null })
    if (!result.ok) throw new Error(localizedErrorMessage(t, result.error))
    replace({ ...target, qrRotationCount: result.data.rotationCount })
    toast.success(t('toasts.qrRotated', { number: target.number }))
  }

  const columns: DataTableColumn<TableAdminView>[] = [
    {
      id: 'number',
      header: t('admin.tables.fieldNumber'),
      cell: (row) => (
        <button
          type="button"
          onClick={() => setEditing(row)}
          className="font-medium text-text underline-offset-4 hover:underline"
        >
          {row.name ? `${row.number} · ${row.name}` : row.number}
        </button>
      ),
    },
    {
      id: 'zone',
      header: t('admin.tables.fieldZone'),
      hideBelow: 'md',
      cell: (row) => <span className="text-text-muted">{row.zone ?? t('common.notSet')}</span>,
    },
    {
      id: 'seats',
      header: t('admin.tables.fieldSeats'),
      align: 'end',
      width: '90px',
      hideBelow: 'md',
      cell: (row) => <span>{row.seats ?? '—'}</span>,
    },
    {
      id: 'active',
      header: t('common.active'),
      width: '96px',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.isActive}
            onCheckedChange={(next) => handleToggleActive(row, next)}
            label={`${t('common.active')} — ${row.number}`}
            hideLabel
            size="sm"
          />
          <StatusPill
            kind="availability"
            status={row.isActive ? 'available' : 'unavailable'}
            label={row.isActive ? t('common.active') : t('common.inactive')}
            size="sm"
          />
        </div>
      ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      width: '120px',
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <IconButton
            label={t('admin.tables.viewQr')}
            variant="ghost"
            size="sm"
            onClick={() => setPreviewing(row)}
            icon={<QrCode aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
          />
          <IconButton
            label={t('admin.tables.rotateToken')}
            variant="ghost"
            size="sm"
            onClick={() => setRotating(row)}
            icon={<RotateCw aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
          />
        </div>
      ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => setCreating(true)}
          iconStart={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
        >
          {t('admin.tables.newTable')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.tables.title')}
        columns={columns}
        rows={tables}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={<TableIcon aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
            title={t('admin.tables.empty.title')}
            description={t('admin.tables.empty.body')}
            action={{ label: t('admin.tables.emptyCta'), onClick: () => setCreating(true) }}
          />
        }
      />

      <TableForm
        open={creating}
        onOpenChange={setCreating}
        initial={null}
        branchId={branchId}
        nextSortOrder={tables.length}
        onSaved={() => window.location.reload()}
      />

      <TableForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        initial={editing}
        branchId={branchId}
        nextSortOrder={tables.length}
        onSaved={() => window.location.reload()}
      />

      {previewing && (
        <QrPreview
          open={previewing !== null}
          onOpenChange={(open) => {
            if (!open) setPreviewing(null)
          }}
          tableId={previewing.id}
          tableNumber={previewing.number}
        />
      )}

      <ConfirmDialog
        open={rotating !== null}
        onOpenChange={(open) => {
          if (!open) setRotating(null)
        }}
        title={t('admin.tables.rotateConfirmTitle', { number: rotating?.number ?? '' })}
        description={t('admin.tables.rotateConfirmBody')}
        confirmLabel={t('admin.tables.rotateToken')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busyLabel={t('common.saving')}
        onConfirm={handleRotate}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null)
        }}
        title={t('admin.tables.deactivateConfirmTitle', { number: deactivating?.number ?? '' })}
        description={t('admin.tables.deactivateConfirmBody')}
        confirmLabel={t('admin.tables.deactivate')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busyLabel={t('common.saving')}
        onConfirm={handleConfirmDeactivate}
      />
    </div>
  )
}
