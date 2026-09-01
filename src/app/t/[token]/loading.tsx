/**
 * src/app/t/[token]/loading.tsx — the menu's Suspense fallback.
 * Source: docs/architecture/04-design-system.md §6.1 (`LoadingState`); brief §32.
 *
 * Automatically wraps `page.tsx` in a Suspense boundary (Next.js file
 * convention), so a diner never sees a blank screen while the menu round trip
 * is in flight — only a shaped placeholder that occupies the geometry the real
 * list will use, so nothing jumps when it lands.
 */
import { LoadingState } from '@/components/ui/loading-state'
import { Skeleton } from '@/components/ui/skeleton'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'

export default async function MenuLoading(): Promise<React.JSX.Element> {
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  return (
    <div className="flex flex-col gap-6 px-(--space-gutter-sm) pt-6">
      <div className="flex flex-col gap-2">
        <Skeleton variant="text" className="w-32" />
        <Skeleton variant="title" className="w-2/3" height={28} />
      </div>
      <LoadingState label={t('states.loading.menu')} variant="skeleton" shape="list" count={6} />
    </div>
  )
}
