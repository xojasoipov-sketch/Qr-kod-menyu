'use client'

/**
 * src/app/t/[token]/error.tsx — the route-level error boundary for the whole
 * `/t/[token]` tree.
 * Source: docs/architecture/05-app-structure.md §3.2; brief §32.
 *
 * Next.js error boundaries only ever hand the client a plain `Error` (message
 * + `digest`) — a thrown `AppErrorException`'s `.error: AppError` does not
 * survive the server/client boundary, so this can only ever render the
 * generic, retryable failure, never a specific `QrErrorCode` screen. Those
 * live in the layout, which has the typed `AppError` in hand before it ever
 * throws (see `TableFailureScreen` in `layout.tsx`).
 *
 * `reset()` re-renders the segment from scratch — the menu round trip runs
 * again — without a full page reload, so the diner keeps their cart and their
 * place on the page.
 */
import { useEffect } from 'react'

import { ErrorState } from '@/components/ui/error-state'

export default function TableError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}): React.JSX.Element {
  useEffect(() => {
    // Server-side console only in this build; nothing here reaches a diner.
    console.error('[t/[token]]', error)
  }, [error])

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-(--container-customer) flex-col items-center justify-center px-(--space-gutter-sm) py-12">
      <ErrorState code="unknown" align="center" size="md" onRetry={reset} traceId={error.digest} />
    </div>
  )
}
