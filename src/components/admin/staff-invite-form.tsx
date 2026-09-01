'use client'

/**
 * src/components/admin/staff-invite-form.tsx — StaffInviteForm.
 *
 * One dialog, two modes: `initial === null` invites a new member by email
 * (`inviteStaffAction` — GoTrue creates the login, the caller's own cookie
 * client creates the `staff` row, so `staff_insert_manager` and
 * `trg_staff_guard()` both apply); `initial` set edits an existing
 * membership's role, branch and employee code (`updateStaffAction`). The
 * role select never offers an option the database will refuse: a caller who
 * is not an owner simply does not see `RESTAURANT_OWNER` in the list
 * (mirrors `staff-service.ts`'s `assertNoEscalation`), and an owner can
 * never edit their own row here because the roster never renders a row for
 * `session.staffId` as editable in the first place — see `staff-list.tsx`.
 */

import { useEffect, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { StaffRole } from '@/types/database'
import { STAFF_ROLES } from '@/types/database'
import type { StaffInput } from '@/lib/validation/tenancy'
import type { StaffAdminView } from '@/lib/services/staff-service'
import type { AppError } from '@/types/result'
import { inviteStaffAction, updateStaffAction } from '@/app/(admin)/admin/staff/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

function emptyForm(defaultBranchId: string | null): StaffInput {
  return {
    profile_id: null,
    invite_email: '',
    role: 'WAITER',
    branch_id: defaultBranchId,
    display_name: null,
    employee_code: null,
    is_active: true,
  }
}

function fromView(staff: StaffAdminView): StaffInput {
  return {
    id: staff.id,
    profile_id: staff.profileId,
    invite_email: null,
    role: staff.role,
    branch_id: staff.branchId,
    display_name: staff.displayName,
    employee_code: staff.employeeCode,
    is_active: staff.isActive,
  }
}

export interface StaffInviteFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: StaffAdminView | null
  branches: readonly { id: string; name: string }[]
  /** Roles the caller may assign — an owner-only caller adds RESTAURANT_OWNER themselves. */
  assignableRoles: readonly StaffRole[]
  onSaved: () => void
}

export function StaffInviteForm({
  open,
  onOpenChange,
  initial,
  branches,
  assignableRoles,
  onSaved,
}: StaffInviteFormProps): React.JSX.Element {
  const t = useT()
  const [form, setForm] = useState<StaffInput>(() =>
    initial ? fromView(initial) : emptyForm(branches[0]?.id ?? null),
  )
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setForm(initial ? fromView(initial) : emptyForm(branches[0]?.id ?? null))
    setError(null)
  }, [open, initial, branches])

  function patch(next: Partial<StaffInput>): void {
    setForm((current) => ({ ...current, ...next }))
  }

  const roleOptions: SelectOption<StaffRole>[] = STAFF_ROLES.filter(
    (role) => assignableRoles.includes(role) || role === form.role,
  ).map((role) => ({ value: role, label: t(`labels.role.${role}`) }))

  const requiresBranch = form.role === 'WAITER' || form.role === 'KITCHEN'
  const branchOptions: SelectOption[] = [
    ...(requiresBranch ? [] : [{ value: '', label: t('admin.staff.allBranches') }]),
    ...branches.map((branch) => ({ value: branch.id, label: branch.name })),
  ]

  function handleSubmit(): void {
    setError(null)
    startTransition(async () => {
      const result = form.id ? await updateStaffAction(form) : await inviteStaffAction(form)
      if (!result.ok) {
        setError(localizedErrorMessage(t, result.error))
        return
      }
      toast.success(
        form.id ? t('toasts.saved') : t('admin.staff.inviteSent', { email: form.invite_email ?? '' }),
      )
      onSaved()
      onOpenChange(false)
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t('common.edit') : t('admin.staff.inviteTitle')}
      description={initial ? undefined : t('admin.staff.inviteBody')}
      size="sm"
      dismissible={!pending}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={handleSubmit} loading={pending} loadingLabel={t('common.saving')}>
            {initial ? t('common.save') : t('admin.staff.invite')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!initial && (
          <Input
            label={t('admin.staff.fieldEmail')}
            type="email"
            value={form.invite_email ?? ''}
            onChange={(event) => patch({ invite_email: event.target.value })}
            announceError
          />
        )}

        <Input
          label={t('admin.staff.fieldFullName')}
          value={form.display_name ?? ''}
          onChange={(event) => patch({ display_name: event.target.value || null })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Select
            label={t('admin.staff.fieldRole')}
            options={roleOptions}
            value={form.role}
            onChange={(event) => {
              const role = event.target.value as StaffRole
              patch({
                role,
                branch_id: role === 'RESTAURANT_OWNER' ? null : form.branch_id,
              })
            }}
          />
          <Select
            label={t('admin.staff.fieldBranch')}
            options={branchOptions}
            value={form.branch_id ?? ''}
            disabled={form.role === 'RESTAURANT_OWNER'}
            onChange={(event) => patch({ branch_id: event.target.value === '' ? null : event.target.value })}
          />
        </div>

        <Input
          label={t('admin.staff.fieldEmployeeCode')}
          value={form.employee_code ?? ''}
          onChange={(event) => patch({ employee_code: event.target.value || null })}
        />

        {initial && (
          <Switch
            checked={form.is_active}
            onCheckedChange={(checked) => patch({ is_active: checked })}
            label={t('common.active')}
          />
        )}

        {error && (
          <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
