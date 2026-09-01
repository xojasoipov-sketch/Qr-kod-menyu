'use client'

/**
 * The tracking page's skeleton. A `loading.tsx` is a Suspense fallback and may
 * not itself suspend, so — like the root `loading.tsx` — this is a client
 * component for the timing only: it reads the catalogue from context
 * (`<LocaleProvider>` sits above every route boundary) rather than awaiting
 * anything.
 */

import { LoadingState } from '@/components/ui/loading-state'
import { Skeleton } from '@/components/ui/skeleton'
import { useT } from '@/lib/i18n/provider'

export default function OrderLoading(): React.JSX.Element {
  const t = useT()

  return (
    <div className="mx-auto flex w-full max-w-(--measure-prose) flex-col gap-6 px-4 pt-6 pb-32">
      <Skeleton variant="title" width="50%" />
      <LoadingState label={t('states.loading.tracking')} variant="skeleton" shape="panel" count={1} />
      <LoadingState label={t('states.loading.order')} variant="skeleton" shape="list" count={3} />
    </div>
  )
}
