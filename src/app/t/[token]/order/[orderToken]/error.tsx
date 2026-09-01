'use client'

/**
 * The tracking page's own recoverable-error boundary.
 *
 * Order tracking gets its own `error.tsx` rather than falling through to a
 * shared one because its failure means something specific to a diner mid-meal
 * ("we lost track of your order", not "something went wrong") — the copy a
 * guest needs here is different from the one on the menu (doc 05 §2.7).
 */

import { useEffect } from 'react'

import { ErrorState } from '@/components/ui/error-state'
import { useT } from '@/lib/i18n/provider'

export default function OrderTrackingError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  const t = useT()

  useEffect(() => {
    // The last place this stack exists on the client; otherwise it is only
    // half-visible in the server log.
    console.error('[qros] order tracking error', error)
  }, [error])

  return (
    <main className="flex min-h-dvh w-full items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-(--measure-prose) flex-col items-center gap-6">
        <ErrorState
          align="center"
          title={t('states.error.tracking.title')}
          description={t('states.error.tracking.body')}
          onRetry={reset}
          retryLabel={t('common.retry')}
          traceId={error.digest}
        />
      </div>
    </main>
  )
}
