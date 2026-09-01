'use client';

/**
 * src/app/error.tsx — the application-wide recoverable error boundary.
 * Source: 05-app-structure.md §2.0 rule 5, §2.7; brief §32.
 *
 * This catches anything thrown below the root layout that no nearer `error.tsx`
 * claimed. The root layout — and therefore `<LocaleProvider>` — is still mounted,
 * which is what lets this file be localised at all. A crash *inside* the root
 * layout is only catchable by `global-error.tsx`, which is a different slice's
 * file and must hard-code its copy for exactly that reason.
 *
 * `error.message` is deliberately not rendered: in production Next replaces it
 * with a generic string and exposes only `digest`, and in development it can
 * carry a Postgres detail. The digest is shown instead, in small type, so a
 * report can be correlated with the server log line.
 */

import { useEffect } from 'react';
import { Home } from 'lucide-react';

import { ErrorState } from '@/components/ui/error-state';
import { useT } from '@/lib/i18n/provider';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  const t = useT();

  useEffect(() => {
    // The boundary is the last place this stack exists; without it the failure is
    // invisible on the client and only half-visible in the server log.
    console.error('[qros] unhandled route error', error);
  }, [error]);

  return (
    // Centring is legal here: §8.6 permits it for a state that fills the viewport.
    <main className="flex min-h-dvh w-full items-center justify-center px-6 py-16">
      <div className="flex w-full max-w-(--measure-prose) flex-col items-center gap-6">
        <ErrorState
          code="unknown"
          align="center"
          onRetry={reset}
          retryLabel={t('common.retry')}
          traceId={error.digest}
        />
        <a
          href="/"
          className="inline-flex min-h-(--tap-min) items-center gap-2 text-body-sm text-accent underline decoration-accent-line underline-offset-4 hover:decoration-accent"
        >
          <Home aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />
          {t('errors.generic.goHome')}
        </a>
      </div>
    </main>
  );
}
