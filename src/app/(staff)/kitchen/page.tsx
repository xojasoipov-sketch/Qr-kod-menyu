/**
 * `/kitchen` — the kitchen display system (brief §9; 05-app-structure.md
 * §2.5.1).
 *
 * A Server Component: `requireCapability('kitchen')` gates the whole route
 * (KITCHEN, MANAGER, RESTAURANT_OWNER and platform admins — anything else is
 * redirected to its own landing surface before this ever runs), then
 * `listKitchenTickets` seeds the board's first paint so a cook never sees a
 * blank screen while `<KdsBoard>`'s socket is still joining. Everything live
 * from here on is that component's job.
 */
import { Store } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { KdsBoard } from '@/components/kitchen/kds-board'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import type { ActorRole } from '@/lib/orders/state-machine'
import { AppErrorException } from '@/lib/result'
import { listKitchenTickets } from '@/lib/services/order-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function KitchenPage(): Promise<React.JSX.Element> {
  const context = await requireCapability('kitchen')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const branchId = context.activeBranchId
  const branch = branchId ? (context.branches.find((candidate) => candidate.id === branchId) ?? null) : null

  // A KITCHEN row is always branch-pinned (`ck_staff_role_scope`); this is
  // realistically only reachable for a MANAGER/RESTAURANT_OWNER with no
  // branch in scope at all — 05 §2.5.2 renders the same shape for /waiter.
  if (!branchId || !branch) {
    return (
      <div className="flex h-dvh items-center justify-center bg-surface p-6">
        <EmptyState
          icon={<Store aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-7" />}
          title={t('waiter.noBranch.title')}
          description={t('waiter.noBranch.body')}
          align="center"
        />
      </div>
    )
  }

  const result = await listKitchenTickets(branchId)
  if (!result.ok) {
    // Caught by this route's error.tsx boundary.
    throw new AppErrorException(result.error)
  }

  const actor: ActorRole = context.isPlatformAdmin ? 'SUPER_ADMIN' : context.role

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <a
        href="#kds-main"
        className="sr-only focus:not-sr-only focus:absolute focus:z-(--z-skip-link) focus:m-2 focus:rounded-control focus:bg-elevated focus:px-4 focus:py-2 focus:text-body-sm focus:text-text"
      >
        {t('a11y.skipToContent')}
      </a>

      <KdsBoard
        initialTickets={result.data}
        branchId={branchId}
        branchName={branch.name}
        timeZone={branch.timezone}
        lateThresholdMinutes={branch.lateOrderThresholdMinutes}
        actor={actor}
      />
    </div>
  )
}
