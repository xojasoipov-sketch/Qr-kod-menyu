'use client'

/**
 * src/components/admin/branch-list.tsx — BranchList.
 *
 * The `/admin/branches` table: create/edit through `<BranchForm>`, and the
 * two independent switches brief §17-25 distinguishes — `is_active` (the
 * branch exists at all) and `is_accepting_orders` (the "we are slammed"
 * pause, which still shows the menu and still lets a guest call a waiter).
 */

import { useState, useTransition } from 'react'
import { Building2, Plus } from 'lucide-react'

import { BranchForm } from '@/components/admin/branch-form'
import { Button } from '@/components/ui/button'
import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import type { BranchAdminView } from '@/lib/services/branch-service'
import type { AppError } from '@/types/result'
import {
  setBranchAcceptingOrdersAction,
  setBranchActiveAction,
} from '@/app/(admin)/admin/branches/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

export interface BranchListProps {
  initialBranches: readonly BranchAdminView[]
  restaurantServiceFeeBps: number
}

export function BranchList({
  initialBranches,
  restaurantServiceFeeBps,
}: BranchListProps): React.JSX.Element {
  const t = useT()
  const [branches, setBranches] = useState(initialBranches)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<BranchAdminView | null>(null)
  const [, startToggle] = useTransition()

  function setAccepting(branch: BranchAdminView, next: boolean): void {
    setBranches((current) =>
      current.map((entry) => (entry.id === branch.id ? { ...entry, isAcceptingOrders: next } : entry)),
    )
    startToggle(async () => {
      const result = await setBranchAcceptingOrdersAction({ id: branch.id, value: next })
      if (!result.ok) {
        toast.error(t('toasts.saveFailed'), { description: localizedErrorMessage(t, result.error) })
        setBranches((current) =>
          current.map((entry) => (entry.id === branch.id ? { ...entry, isAcceptingOrders: !next } : entry)),
        )
      }
    })
  }

  function setActive(branch: BranchAdminView, next: boolean): void {
    setBranches((current) =>
      current.map((entry) => (entry.id === branch.id ? { ...entry, isActive: next } : entry)),
    )
    startToggle(async () => {
      const result = await setBranchActiveAction({ id: branch.id, value: next })
      if (!result.ok) {
        toast.error(t('toasts.saveFailed'), { description: localizedErrorMessage(t, result.error) })
        setBranches((current) =>
          current.map((entry) => (entry.id === branch.id ? { ...entry, isActive: !next } : entry)),
        )
      }
    })
  }

  const columns: DataTableColumn<BranchAdminView>[] = [
    {
      id: 'name',
      header: t('admin.branches.fieldName'),
      cell: (row) => (
        <button
          type="button"
          onClick={() => setEditing(row)}
          className="font-medium text-text underline-offset-4 hover:underline"
        >
          {row.name}
        </button>
      ),
    },
    {
      id: 'code',
      header: t('admin.branches.fieldCode'),
      width: '90px',
      cell: (row) => <span className="u-tnum text-text-muted">{row.code}</span>,
    },
    {
      id: 'tables',
      header: t('nav.tables'),
      hideBelow: 'md',
      width: '120px',
      cell: (row) => <span>{t('admin.branches.tableCount', { count: row.tableCount })}</span>,
    },
    {
      id: 'accepting',
      header: t('admin.branches.acceptingOrders'),
      width: '150px',
      cell: (row) => (
        <div className="flex items-center gap-2">
          <Switch
            checked={row.isAcceptingOrders}
            onCheckedChange={(next) => setAccepting(row, next)}
            label={`${t('admin.branches.acceptingOrders')} — ${row.name}`}
            hideLabel
            size="sm"
          />
          <StatusPill
            kind="availability"
            status={row.isAcceptingOrders ? 'available' : 'unavailable'}
            label={row.isAcceptingOrders ? t('common.available') : t('common.unavailable')}
            size="sm"
          />
        </div>
      ),
    },
    {
      id: 'active',
      header: t('common.active'),
      width: '96px',
      cell: (row) => (
        <Switch
          checked={row.isActive}
          onCheckedChange={(next) => setActive(row, next)}
          label={`${t('common.active')} — ${row.name}`}
          hideLabel
          size="sm"
        />
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
          {t('admin.branches.newBranch')}
        </Button>
      </div>

      <DataTable
        caption={t('admin.branches.title')}
        columns={columns}
        rows={branches}
        getRowId={(row) => row.id}
        empty={
          <EmptyState
            icon={<Building2 aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-7" />}
            title={t('admin.branches.empty.title')}
            description={t('admin.branches.empty.body')}
            action={{ label: t('admin.branches.emptyCta'), onClick: () => setCreating(true) }}
          />
        }
      />

      <BranchForm
        open={creating}
        onOpenChange={setCreating}
        initial={null}
        restaurantServiceFeeBps={restaurantServiceFeeBps}
        onSaved={() => window.location.reload()}
      />

      <BranchForm
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null)
        }}
        initial={editing}
        restaurantServiceFeeBps={restaurantServiceFeeBps}
        onSaved={() => window.location.reload()}
      />
    </div>
  )
}
