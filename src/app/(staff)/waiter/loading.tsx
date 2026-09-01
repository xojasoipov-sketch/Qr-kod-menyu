/**
 * src/app/(staff)/waiter/loading.tsx — the waiter console's Suspense fallback.
 * Source: docs/architecture/04-design-system.md §6.1 (`LoadingState`); brief §32.
 */
import { LoadingState } from '@/components/ui/loading-state'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'

export default async function WaiterLoading(): Promise<React.JSX.Element> {
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <LoadingState label={t('states.loading.waiter')} variant="skeleton" shape="panel" count={1} />
      <div className="grid gap-4 lg:grid-cols-3">
        <LoadingState label={t('states.loading.waiter')} variant="skeleton" shape="rows" count={3} />
        <LoadingState label={t('states.loading.waiter')} variant="skeleton" shape="rows" count={2} />
        <LoadingState label={t('states.loading.waiter')} variant="skeleton" shape="rows" count={2} />
      </div>
    </div>
  )
}
