'use client'

/**
 * src/app/(staff)/kitchen/error.tsx — the KDS's route-level error boundary.
 *
 * A plain container, not `role="alert"`: this is the first render of a
 * failed route, not the answer to something the cook just did — the page
 * itself is already the announcement (04 §9.5). `reset()` re-renders the
 * segment, which re-runs `requireCapability` and `listKitchenTickets`
 * without a full reload, so a transient failure recovers in place.
 */
import { useEffect } from 'react'

import { ErrorState } from '@/components/ui/error-state'
import { useT } from '@/lib/i18n/provider'

export default function KitchenError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  const t = useT()

  useEffect(() => {
    // Server-side console only; nothing here reaches the tablet beyond the copy below.
    console.error('[kitchen]', error)
  }, [error])

  return (
    <div className="flex h-dvh items-center justify-center bg-surface p-6">
      <ErrorState
        title={t('states.error.kitchen.title')}
        description={t('states.error.kitchen.body')}
        align="center"
        size="md"
        onRetry={reset}
        traceId={error.digest}
      />
    </div>
  )
}
