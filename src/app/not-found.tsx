/**
 * src/app/not-found.tsx — the application-wide 404 (Server Component).
 * Source: 05-app-structure.md §2.7; brief §32.
 *
 * No retry affordance: retrying a URL that does not exist cannot help. The one
 * useful action is a way back, so that is the only action offered.
 */

import { Compass } from 'lucide-react';

import { EmptyState } from '@/components/ui/empty-state';
import { getServerTranslator } from '@/lib/i18n/get-dictionary';
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale';

export default async function NotFound(): Promise<React.JSX.Element> {
  const locale = await resolveRequestLocale();
  const t = getServerTranslator(locale);

  return (
    // Full-viewport state — one of the two cases §8.6 allows to be centred.
    <main className="flex min-h-dvh w-full items-center justify-center px-6 py-16">
      <EmptyState
        icon={<Compass className="size-7" strokeWidth={1.5} />}
        title={t('states.notFound.title')}
        description={t('states.notFound.body')}
        align="center"
        titleAs="h2"
        action={{ label: t('errors.generic.goHome'), href: '/' }}
        secondaryAction={{ label: t('auth.signInTitle'), href: '/login' }}
      />
    </main>
  );
}
