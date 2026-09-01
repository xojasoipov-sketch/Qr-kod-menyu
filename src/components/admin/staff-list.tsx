'use client'

/**
 * src/components/admin/staff-list.tsx — StaffList.
 *
 * The `/admin/staff` roster. The signed-in caller's own row never gets an
 * edit or deactivate control — `staff-service.ts`'s `assertNotSelf` refuses
 * both server-side (`QR056`), and offering a button that always fails is
 * exactly what the assignment brief warns against.
 */

import { useState } from 'react'
import { Pencil, UserPlus, Users } from 'lucide-react'

import { Button, IconButton } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { RoleBadge } from '@/components/admin/role-badge'
import { StaffInviteForm } from '@/components/admin/staff-invite-form'
import { StatusPill } from '@/components/ui/badge'
import { toast } from '@/components/ui/toast'
import { formatDate } from '@/lib/i18n/format'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { StaffRole } from '@/types/database'
import type { Locale } from '@/types/i18n'
import type { StaffAdminView } from '@/lib/services/staff-service'
import type { AppError } from '@/types/result'
import { deactivateStaffAction } from '@/app/(admin)/admin/staff/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

export interface StaffListProps {
  initialStaff: readonly StaffAdminView[]
  branches: readonly { id: string; name: string }[]
  assignableRoles: readonly StaffRole[]
  currentStaffId: string
  locale: Locale
  timezone: string
}

export function StaffList({
  initialStaff,
  branches,
  assignableRoles,
  currentStaffId,
  locale,
  timezone,
}: StaffListProps): React.JSX.Element {
  const t = useT()
  const [staff, setStaff] = useState(initialStaff)
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<StaffAdminView | null>(null)
  const [deactivating, setDeactivating] = useState<StaffAdminView | null>(null)

  async function handleDeactivate(): Promise<void> {
    if (!deactivating) return
    const target = deactivating
    const result = await deactivateStaffAction({ id: target.id })
    if (!result.ok) throw new Error(localizedErrorMessage(t, result.error))
    setStaff((current) =>
      current.map((entry) => (entry.id === target.id ? { ...entry, isActive: false } : entry)),
    )
    toast.success(t('toasts.saved'))
  }

  const branchName = (branchId: string | null): string =>
    branchId === null
      ? t('admin.staff.allBranches')
      : (branches.find((branch) => branch.id === branchId)?.name ?? '')

  const columns: DataTableColumn<StaffAdminView>[] = [
    {
      id: 'name',
      header: t('common.name'),
      cell: (row) => (
        <div className="flex flex-col">
          <span className="font-medium text-text">{row.displayName}</span>
          {row.email && <span className="text-caption text-text-subtle">{row.email}</span>}
        </div>
      ),
    },
    {
      id: 'role',
      header: t('admin.staff.fieldRole'),
      cell: (row) => (
        <RoleBadge role={row.role} isPlatformAdmin={row.isPlatformAdmin} label={t(`labels.role.${row.role}`)} />
      ),
    },
    {
      id: 'branch',
      header: t('admin.staff.fieldBranch'),
      hideBelow: 'md',
      cell: (row) => <span className="text-text-muted">{branchName(row.branchId)}</span>,
    },
    {
      id: 'status',
      header: t('common.status'),
      width: '120px',
      cell: (row) =>
        row.isActive ? (
          row.joinedAt ? (
            <span className="text-caption text-text-subtle">
              {t('admin.staff.joinedAt', { date: formatDate(row.joinedAt, locale, timezone) })}
            </span>
          ) : (
            <StatusPill kind="availability" status="unavailable" label={t('admin.staff.pendingInvite')} size="sm" />
          )
        ) : (
          <StatusPill kind="availability" status="unavailable" label={t('common.inactive')} size="sm" />
        ),
    },
    {
      id: 'actions',
      header: t('common.actions'),
      align: 'end',
      width: '96px',
      cell: (row) =>
        row.id === currentStaffId ? null : (
          <div className="flex items-center justify-end gap-1">
            <IconButton
              label={t('common.edit')}
              variant="ghost"
              size="sm"
              onClick={() => setEditing(row)}
              icon={<Pencil aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
            />
            {row.isActive && (
              <Button variant="ghost" size="sm" onClick={() => setDeactivating(row)}>
                {t('admin.staff.deactivate')}
              </Button>
            )}
          </div>
        ),
    },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button
          variant="primary"
          onClick={() => setInviting(true)}
          iconStart={<UserPlus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
        >
          {t('admin.staff.invite')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.staff.title')}
        columns={columns}
        rows={staff}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={<Users aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
            title={t('admin.staff.empty.title')}
            description={t('admin.staff.empty.body')}
            action={{ label: t('admin.staff.emptyCta'), onClick: () => setInviting(true) }}
          />
        }
      />

      <StaffInviteForm
        open={inviting}
        onOpenChange={setInviting}
        initial={null}
        branches={branches}
        assignableRoles={assignableRoles}
        onSaved={() => window.location.reload()}
      />

      <StaffInviteForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        initial={editing}
        branches={branches}
        assignableRoles={assignableRoles}
        onSaved={() => window.location.reload()}
      />

      <ConfirmDialog
        open={deactivating !== null}
        onOpenChange={(open) => {
          if (!open) setDeactivating(null)
        }}
        title={t('admin.staff.deactivateConfirmTitle', { name: deactivating?.displayName ?? '' })}
        description={t('admin.staff.deactivateConfirmBody')}
        confirmLabel={t('admin.staff.deactivate')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        busyLabel={t('common.saving')}
        onConfirm={handleDeactivate}
      />
    </div>
  )
}
