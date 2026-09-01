'use client'

/**
 * src/components/admin/branch-switcher.tsx — which branch the admin UI reads.
 *
 * Writes `qros_branch` through `setActiveBranchAction` (a real cookie write on
 * the server, so it survives the next full navigation and every server
 * component reads the same value `getStaffContext()` does) and then
 * `router.refresh()` so this render picks it up immediately. `useTransition`
 * marks the request pending without blocking the select itself.
 *
 * Renders nothing when there is only one branch in scope — a switcher with one
 * option is not a control.
 */

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'

import { Select } from '@/components/ui/select'
import { setActiveBranchAction } from '@/app/(admin)/admin/actions'

export interface BranchSwitcherBranch {
  id: string
  name: string
}

export interface BranchSwitcherProps {
  branches: readonly BranchSwitcherBranch[]
  activeBranchId: string | null
  /** Localised, e.g. t('admin.dashboard.branchFilter'). */
  label: string
  className?: string
}

export function BranchSwitcher({
  branches,
  activeBranchId,
  label,
  className,
}: BranchSwitcherProps): React.JSX.Element | null {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  if (branches.length <= 1) return null

  const options = branches.map((branch) => ({ value: branch.id, label: branch.name }))
  const value = activeBranchId ?? branches[0]?.id ?? ''

  return (
    <Select
      label={label}
      hideLabel
      options={options}
      value={value}
      disabled={pending}
      size="sm"
      wrapperClassName={className}
      onChange={(event) => {
        const nextId = event.target.value
        startTransition(async () => {
          await setActiveBranchAction(nextId)
          router.refresh()
        })
      }}
    />
  )
}
