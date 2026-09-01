/**
 * src/app/(auth)/layout.tsx — the signed-out shell (Server Component).
 * Source: 05-app-structure.md §2.4.
 *
 * A centred card on the dark editorial ground. There is no navigation, because a
 * signed-out visitor has nowhere to go: the wordmark is a link home, the language
 * switcher is the only control, and that is the whole chrome.
 *
 * Its one piece of logic is the mirror of the middleware gate: a signed-in staff
 * member must not sit on /login. Middleware cannot do this correctly — it reads a
 * JWT, not the `staff` table, so it cannot tell a KITCHEN member from an owner —
 * so the redirect is made here, one database read later, where the role is known.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { landingPathFor } from '@/lib/auth/guards';
import { getStaffContext } from '@/lib/auth/session';
import { getServerTranslator } from '@/lib/i18n/get-dictionary';
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const context = await getStaffContext();
  if (context !== null) redirect(landingPathFor(context));

  const locale = await resolveRequestLocale();
  const t = getServerTranslator(locale);

  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#auth-main"
        className="sr-only z-(--z-skip-link) focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded-control focus:bg-elevated focus:px-4 focus:py-2 focus:text-body-sm focus:text-text"
      >
        {t('a11y.skipToContent')}
      </a>

      <header className="flex items-center justify-between gap-4 px-(--space-gutter-sm) py-5">
        <Link
          href="/"
          className="font-display text-display-sm text-text transition-colors duration-(--duration-fast) hover:text-accent"
        >
          {t('common.appName')}
        </Link>
        <LanguageSwitcher variant="menu" size="sm" />
      </header>

      {/* Centring is legal here: §8.6 permits it for a full-viewport card. */}
      <main
        id="auth-main"
        className="flex flex-1 items-center justify-center px-(--space-gutter-sm) py-10"
      >
        <div className="w-full max-w-(--measure-narrow)">{children}</div>
      </main>

      <footer className="px-(--space-gutter-sm) py-6">
        <p className="text-caption text-text-subtle">{t('common.tagline')}</p>
      </footer>
    </div>
  );
}
