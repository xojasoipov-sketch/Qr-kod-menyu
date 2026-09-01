'use client'

/**
 * src/app/(staff)/waiter/error.tsx — the waiter console's route-level error
 * boundary.
 * Source: docs/architecture/05-app-structure.md §3.2/§899; brief §32.
 *
 * Next only ever hands a client error boundary a plain `Error` (message +
 * `digest`) — a thrown `AppErrorException`'s typed `.error: AppError` does not
 * survive the server/client boundary, so this can only ever render the
 * generic, retryable failure. `reset()` re-renders the segment from scratch —
 * the three list fetches run again — without a full reload, so an in-progress
 * acknowledge/resolve/advance the operator just tapped is not lost to a hard
 * refresh.
 */
import { useEffect } from 'react'

import { ErrorState } from '@/components/ui/error-state'

export default function WaiterError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  useEffect(() => {
    console.error('[waiter]', error)
  }, [error])

  return (
    <div className="flex min-h-[60dvh] w-full items-center justify-center p-6">
      <ErrorState code="unknown" align="center" size="md" onRetry={reset} traceId={error.digest} />
    </div>
  )
}
