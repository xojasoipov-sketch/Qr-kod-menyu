/**
 * src/app/(staff)/kitchen/loading.tsx — the KDS's Suspense fallback.
 *
 * A shaped placeholder rather than a blank tablet while `requireCapability`
 * and the first `listKitchenTickets` round trip are in flight.
 */
import { LoadingState } from '@/components/ui/loading-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'

export default async function KitchenLoading(): Promise<React.JSX.Element> {
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border bg-elevated px-4 py-3">
        <Skeleton variant="title" className="w-40" />
        <Skeleton variant="text" className="w-24" />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden p-(--space-kds-lane-gap)">
        <LoadingState label={t('states.loading.kitchen')} variant="skeleton" shape="grid" count={6} />
      </div>
    </div>
  )
}
