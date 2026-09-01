/**
 * src/components/admin/demo-data-notice.tsx — the one place a demo tenant's
 * numbers say so.
 *
 * Brief §11: "no fake analytics — real data only; demo data clearly
 * separated." `DashboardStats.isDemo` (and `StaffContext.restaurant.isDemo`,
 * the same flag) is true whenever the queried scope is a `restaurants.is_demo`
 * tenant, live database or not — this component does not decide that, it only
 * renders what the caller already decided, in the two shapes the admin surface
 * needs: a small inline pill beside a heading, or a full explanatory banner
 * above a page of numbers a reader might otherwise mistake for real.
 *
 * A Server Component; every label arrives already localised, the same
 * convention `StatCard` and `StatusPill` use.
 */

import { Beaker } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils/cn'

export type DemoDataNoticeVariant = 'badge' | 'banner'

export interface DemoDataNoticeProps {
  isDemo: boolean
  /** Localised, e.g. t('states.demo.badge'). */
  label: string
  /** Localised, e.g. t('states.demo.body'). Banner variant only. */
  description?: string
  /** default 'badge' */
  variant?: DemoDataNoticeVariant
  className?: string
}

export function DemoDataNotice({
  isDemo,
  label,
  description,
  variant = 'badge',
  className,
}: DemoDataNoticeProps): React.JSX.Element | null {
  if (!isDemo) return null

  if (variant === 'badge') {
    return (
      <Badge tone="warning" variant="soft" className={className}>
        {label}
      </Badge>
    )
  }

  return (
    <Card tone="accent" padding="md" className={cn('flex items-start gap-3', className)}>
      <span aria-hidden="true" className="u-icon-align mt-0.5 shrink-0 text-accent">
        <Beaker className="size-5" strokeWidth={1.75} />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-admin-sm font-medium text-text">{label}</span>
        {description !== undefined && (
          <p className="text-admin-body text-text-muted">{description}</p>
        )}
      </div>
    </Card>
  )
}
