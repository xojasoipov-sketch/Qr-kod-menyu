'use client'

/**
 * src/components/admin/branch-form.tsx — BranchForm.
 *
 * Create or edit one branch: identity, the operational knobs the KDS and
 * the anti-spam limiter read (`waiter_call_cooldown_seconds`,
 * `order_min_interval_seconds`, `default_prep_minutes`,
 * `late_order_threshold_minutes`), and the service-fee override.
 *
 * `opening_hours` is intentionally not exposed here — the per-weekday
 * editor needs day-name copy the catalogue does not carry yet (see
 * `missing_i18n_keys`) — so a new branch defaults to `{}` ("always open"),
 * which `branchSchema` already treats as the default.
 */

import { useEffect, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { BranchInput } from '@/lib/validation/tenancy'
import type { BranchAdminView } from '@/lib/services/branch-service'
import type { AppError } from '@/types/result'
import type { Json } from '@/types/database'
import { createBranchAction, updateBranchAction } from '@/app/(admin)/admin/branches/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const

/**
 * `branches.opening_hours` reaches this form as `Json` (the row's raw
 * column type); this form does not edit it (see the file header), so it
 * only needs to be carried through unchanged — never wiped to "always
 * open" on an edit it did not ask for. A structurally invalid value (this
 * form is not the only writer of the column) falls back to `{}` rather
 * than crashing the dialog.
 */
function asOpeningHours(value: Json): BranchInput['opening_hours'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}

  const result: Record<string, [string, string][]> = {}
  for (const day of WEEKDAYS) {
    const ranges = value[day]
    if (!Array.isArray(ranges)) continue

    const parsed: [string, string][] = []
    for (const range of ranges) {
      if (
        Array.isArray(range) &&
        range.length === 2 &&
        typeof range[0] === 'string' &&
        typeof range[1] === 'string'
      ) {
        parsed.push([range[0], range[1]])
      }
    }
    result[day] = parsed
  }
  return result
}

function emptyForm(): BranchInput {
  return {
    name: '',
    code: '',
    address: null,
    phone: null,
    timezone: 'Asia/Tashkent',
    latitude: null,
    longitude: null,
    service_fee_bps: null,
    opening_hours: {},
    waiter_call_cooldown_seconds: 90,
    waiter_call_expiry_minutes: 30,
    order_min_interval_seconds: 20,
    default_prep_minutes: 15,
    late_order_threshold_minutes: 25,
    is_active: true,
    is_accepting_orders: true,
  }
}

function fromView(branch: BranchAdminView): BranchInput {
  return {
    id: branch.id,
    name: branch.name,
    code: branch.code,
    address: branch.address,
    phone: branch.phone,
    timezone: branch.timezone,
    latitude: branch.latitude,
    longitude: branch.longitude,
    service_fee_bps: branch.serviceFeeBps,
    opening_hours: asOpeningHours(branch.openingHours),
    waiter_call_cooldown_seconds: branch.waiterCallCooldownSeconds,
    waiter_call_expiry_minutes: branch.waiterCallExpiryMinutes,
    order_min_interval_seconds: branch.orderMinIntervalSeconds,
    default_prep_minutes: branch.defaultPrepMinutes,
    late_order_threshold_minutes: branch.lateOrderThresholdMinutes,
    is_active: branch.isActive,
    is_accepting_orders: branch.isAcceptingOrders,
  }
}

export interface BranchFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initial: BranchAdminView | null
  restaurantServiceFeeBps: number
  onSaved: () => void
}

export function BranchForm({
  open,
  onOpenChange,
  initial,
  restaurantServiceFeeBps,
  onSaved,
}: BranchFormProps): React.JSX.Element {
  const t = useT()
  const [form, setForm] = useState<BranchInput>(() => (initial ? fromView(initial) : emptyForm()))
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    setForm(initial ? fromView(initial) : emptyForm())
    setError(null)
  }, [open, initial])

  function patch(next: Partial<BranchInput>): void {
    setForm((current) => ({ ...current, ...next }))
  }

  function handleSubmit(): void {
    setError(null)
    startTransition(async () => {
      const result = form.id ? await updateBranchAction(form) : await createBranchAction(form)
      if (!result.ok) {
        setError(localizedErrorMessage(t, result.error))
        return
      }
      toast.success(t('toasts.saved'))
      onSaved()
      onOpenChange(false)
    })
  }

  const feeInherit = form.service_fee_bps === null

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={initial ? t('admin.branches.editBranch') : t('admin.branches.newBranch')}
      size="lg"
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('admin.branches.fieldName')}
            value={form.name}
            onChange={(event) => patch({ name: event.target.value })}
          />
          <Input
            label={t('admin.branches.fieldCode')}
            value={form.code}
            onChange={(event) => patch({ code: event.target.value.toUpperCase() })}
            hint={t('admin.branches.fieldCodeHint')}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('admin.branches.fieldAddress')}
            value={form.address ?? ''}
            onChange={(event) => patch({ address: event.target.value || null })}
          />
          <Input
            label={t('common.phone')}
            value={form.phone ?? ''}
            onChange={(event) => patch({ phone: event.target.value || null })}
          />
        </div>

        <Input
          label={t('admin.branches.fieldTimezone')}
          value={form.timezone}
          onChange={(event) => patch({ timezone: event.target.value })}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <Switch
            checked={feeInherit}
            onCheckedChange={(checked) => patch({ service_fee_bps: checked ? null : restaurantServiceFeeBps })}
            label={t('admin.branches.fieldServiceFeeInherit')}
          />
          <Input
            label={t('admin.branches.fieldServiceFee')}
            type="number"
            min={0}
            max={100}
            step={0.01}
            disabled={feeInherit}
            value={feeInherit ? '' : ((form.service_fee_bps ?? 0) / 100).toFixed(2)}
            onChange={(event) =>
              patch({ service_fee_bps: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })
            }
            suffix="%"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label={t('admin.branches.fieldWaiterCooldown')}
            type="number"
            min={0}
            max={3600}
            value={form.waiter_call_cooldown_seconds}
            onChange={(event) => patch({ waiter_call_cooldown_seconds: Number(event.target.value) || 0 })}
          />
          <Input
            label={t('admin.branches.fieldOrderInterval')}
            type="number"
            min={0}
            max={3600}
            value={form.order_min_interval_seconds}
            onChange={(event) => patch({ order_min_interval_seconds: Number(event.target.value) || 0 })}
          />
          <Input
            label={t('admin.branches.fieldPrepDefault')}
            type="number"
            min={1}
            max={240}
            value={form.default_prep_minutes}
            onChange={(event) => patch({ default_prep_minutes: Number(event.target.value) || 1 })}
          />
          <Input
            label={t('admin.branches.fieldLateThreshold')}
            type="number"
            min={1}
            max={480}
            value={form.late_order_threshold_minutes}
            onChange={(event) => patch({ late_order_threshold_minutes: Number(event.target.value) || 1 })}
          />
        </div>

        <div className="flex flex-wrap gap-6">
          <Switch
            checked={form.is_active}
            onCheckedChange={(checked) => patch({ is_active: checked })}
            label={t('common.active')}
          />
          <Switch
            checked={form.is_accepting_orders}
            onCheckedChange={(checked) => patch({ is_accepting_orders: checked })}
            label={t('admin.branches.acceptingOrders')}
          />
        </div>

        {error && (
          <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-body-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  )
}
