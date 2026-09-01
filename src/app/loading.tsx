'use client';

/**
 * src/app/loading.tsx — the application-wide route skeleton.
 * Source: 05-app-structure.md §2.0 rule 4; brief §32.
 *
 * WHY THIS ONE FILE IS A CLIENT COMPONENT. A `loading.tsx` is rendered as a
 * Suspense fallback, and a fallback may not itself suspend — so it cannot be an
 * async Server Component that awaits `cookies()` to learn the locale. Reading the
 * catalogue from context is synchronous and therefore safe, and `<LocaleProvider>`
 * sits above every route boundary in the root layout. Nothing here is stateful:
 * it is a client component for the timing, not for interactivity.
 *
 * This is the last-resort skeleton, for a segment that has not declared its own.
 * It deliberately mirrors the generic page rhythm — a heading block over a stack
 * of rows — rather than showing a spinner on an empty page.
 */

import { LoadingState } from '@/components/ui/loading-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useT } from '@/lib/i18n/provider';

export default function Loading(): React.JSX.Element {
  const t = useT();

  return (
    <div className="mx-auto flex w-full max-w-(--measure-prose) flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-3">
        <Skeleton variant="text" width="7rem" />
        <Skeleton variant="title" width="60%" />
      </div>
      <LoadingState
        label={t('states.loading.generic')}
        variant="skeleton"
        shape="rows"
        count={4}
      />
    </div>
  );
}
