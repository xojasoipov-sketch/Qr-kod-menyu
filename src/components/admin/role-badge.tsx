/**
 * src/components/admin/role-badge.tsx — RoleBadge.
 *
 * A staff role rendered as a Badge. Server-safe: it holds no state and takes
 * no handler, so it composes into any list — client or server. `label` is
 * required and localised by the caller (`t('labels.role.' + role)')`), the
 * same discipline `StatusPill` uses (04-design-system.md §6.1).
 */

import type { StaffRole } from '@/types/database'
import { Badge, type BadgeTone } from '@/components/ui/badge'

/** One tone per role, so the hierarchy reads at a glance in the staff table. */
const ROLE_TONE: Record<StaffRole, BadgeTone> = {
  RESTAURANT_OWNER: 'wine',
  MANAGER: 'accent',
  WAITER: 'info',
  KITCHEN: 'warning',
}

export interface RoleBadgeProps {
  role: StaffRole
  /** REQUIRED, localised — e.g. `t('labels.role.' + role)`. */
  label: string
  /** Platform admins hold no `staff.role` of their own; the caller decides the label. */
  isPlatformAdmin?: boolean
  className?: string
}

export function RoleBadge({
  role,
  label,
  isPlatformAdmin = false,
  className,
}: RoleBadgeProps): React.JSX.Element {
  return (
    <Badge tone={isPlatformAdmin ? 'danger' : ROLE_TONE[role]} variant="soft" className={className}>
      {label}
    </Badge>
  )
}
