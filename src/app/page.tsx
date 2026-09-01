/**
 * src/app/page.tsx — the entry page (Server Component). Zero data fetching.
 * Source: brief §1–§3, §13–§14, §30 and the pinned visual reference;
 *         04-design-system.md §6.2, §8 (anti-slop), §9.4.
 *
 * WHAT THIS PAGE ARGUES. The product is not "a QR menu"; it is the URL contract
 * `/t/<secure random token>` and everything that hangs off it. So the page leads
 * with that contract as an object — a table tent card showing the actual demo
 * link, in mono — and then tells the only story that matters: what a diner sees
 * happen to their order, in the product's own words, and which door each member
 * of staff walks through.
 *
 * The anti-slop rules of §8 are load-bearing here, so, explicitly:
 *   §8.1 no gradient hero — the ground is flat `--surface`; the only ornament is
 *        two `--rule-gold` hairlines and the grain the customer surface already
 *        carries.
 *   §8.6 no centred stack — the masthead is left-aligned and asymmetric, with the
 *        tent card carried on the trailing edge.
 *   §8.8 no three-card feature row — the two lists on this page are lists,
 *        rendered as rows separated by hairlines.
 *   §8.11 no fake data — every string is a real catalogue string, the token is
 *        the real demo token, and the demo card says it is a demo.
 *   §8.16 no "powered by", no logos, no testimonials.
 *
 * `src/middleware.ts` serves `/` on the `customer` surface, so this page is
 * dark-committed and gold-forward without a single hard-coded colour.
 */

import Link from 'next/link';
import { ArrowRight, QrCode } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { LanguageSwitcher } from '@/components/ui/language-switcher';
import { Section } from '@/components/ui/section';
import { appUrl } from '@/lib/env';
import { formatNumber } from '@/lib/i18n/format';
import { getServerTranslator } from '@/lib/i18n/get-dictionary';
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale';

/**
 * The demo table's QR token (doc 05 §8.2). A literal rather than an import: the
 * demo module is another slice's file, and this page needs nothing from it but
 * the href. It satisfies `qrTokenSchema` (22–64 of `[A-Za-z0-9_-]`) and is the
 * shape brief §13 requires — `/t/K9f3PqA7xL`, never `/table/12`.
 */
const DEMO_TABLE_TOKEN = 'DEMOxK9f3PqA7xLmZ2vRt6';
const DEMO_TABLE_HREF = `/t/${DEMO_TABLE_TOKEN}`;

/*
 * Link classes, spelled out with the same tokens Button's `primary` and `link`
 * variants use. `buttonClasses()` cannot be called from here: button.tsx is a
 * `'use client'` module and every export of one becomes a client reference a
 * Server Component may not invoke. empty-state.tsx makes the same trade for the
 * same reason. If Button's variants change, change these too.
 */
const LINK_BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-control font-medium ' +
  'whitespace-nowrap min-h-(--tap-min) ' +
  'transition-[color,background-color,filter,text-decoration-color] ' +
  'duration-(--duration-fast) ease-standard';

const LINK_PRIMARY = `${LINK_BASE} bg-accent-strong px-6 text-body text-accent-contrast hover:brightness-108 active:brightness-95`;

const LINK_QUIET = `${LINK_BASE} text-body text-accent underline decoration-accent-line underline-offset-4 hover:decoration-accent`;

export default async function LandingPage(): Promise<React.JSX.Element> {
  const locale = await resolveRequestLocale();
  const t = getServerTranslator(locale);

  /** The host, without a scheme — the tent card shows a printable link, not a URL bar. */
  const origin = appUrl().replace(/^https?:\/\//, '');

  /**
   * The order lifecycle, in the two voices the product actually uses: the staff
   * word for the status and the sentence the diner is shown. Both come straight
   * from the catalogue, so this section cannot drift from the running system.
   */
  const lifecycle = [
    { key: 'pending', label: t('status.order.pending'), copy: t('status.orderCustomer.pending') },
    {
      key: 'confirmed',
      label: t('status.order.confirmed'),
      copy: t('status.orderCustomer.confirmed'),
    },
    {
      key: 'preparing',
      label: t('status.order.preparing'),
      copy: t('status.orderCustomer.preparing'),
    },
    { key: 'ready', label: t('status.order.ready'), copy: t('status.orderCustomer.ready') },
    {
      key: 'delivered',
      label: t('status.order.delivered'),
      copy: t('status.orderCustomer.delivered'),
    },
  ] as const;

  /** The three surfaces behind the staff door, with what each one is for. */
  const staffSurfaces = [
    { key: 'kitchen', name: t('nav.kitchen'), line: t('kitchen.subtitle') },
    { key: 'waiter', name: t('nav.waiter'), line: t('waiter.subtitle') },
    { key: 'admin', name: t('nav.admin'), line: t('admin.dashboard.subtitle') },
  ] as const;

  return (
    <div className="u-grain flex min-h-dvh flex-col">
      <a
        href="#main-content"
        className="sr-only z-(--z-skip-link) focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:rounded-control focus:bg-elevated focus:px-4 focus:py-2 focus:text-body-sm focus:text-text"
      >
        {t('a11y.skipToContent')}
      </a>

      <header className="u-rule-gold border-b">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-(--space-gutter-sm) py-5 md:px-(--space-gutter-md)">
          <span className="font-display text-display-sm text-text">{t('common.appName')}</span>
          <div className="flex items-center gap-4">
            <LanguageSwitcher variant="menu" size="sm" />
            <Link href="/login" className={LINK_QUIET}>
              {t('auth.signInTitle')}
            </Link>
          </div>
        </div>
      </header>

      <main id="main-content" className="flex-1">
        {/* ── MASTHEAD ─────────────────────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-6xl px-(--space-gutter-sm) pt-(--space-section-md) pb-(--space-section-md) md:px-(--space-gutter-md) lg:pt-(--space-section-lg)">
          <div className="flex flex-col gap-10 lg:grid lg:grid-cols-5 lg:items-end lg:gap-16">
            <div className="flex min-w-0 flex-col items-start gap-6 lg:col-span-3">
              <p className="text-overline uppercase text-accent">{t('common.tagline')}</p>

              <h1 className="font-display text-display-lg text-balance text-text sm:text-display-xl">
                {t('common.appName')}
              </h1>

              <p className="max-w-(--measure-narrow) text-body-lg text-pretty text-text-muted">
                {t('customer.welcome.intro')}
              </p>

              <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                <Link href={DEMO_TABLE_HREF} className={LINK_PRIMARY}>
                  {t('customer.welcome.viewMenu')}
                  <ArrowRight
                    aria-hidden="true"
                    focusable="false"
                    strokeWidth={1.75}
                    className="u-icon-align size-4"
                  />
                </Link>
                <Link href="/login" className={LINK_QUIET}>
                  {t('auth.signInTitle')}
                </Link>
              </div>
            </div>

            {/* The table tent: the product's actual contract, as an object. */}
            <Card padding="lg" tone="accent" className="flex flex-col gap-4 lg:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-2 text-overline uppercase text-text-subtle">
                  <QrCode
                    aria-hidden="true"
                    focusable="false"
                    strokeWidth={1.75}
                    className="u-icon-align size-4"
                  />
                  {t('customer.welcome.eyebrow')}
                </span>
                <Badge tone="warning" variant="outline">
                  {t('states.demo.badge')}
                </Badge>
              </div>

              <p className="font-mono text-admin-mono break-all text-text">
                <span className="text-text-subtle">{`${origin}/t/`}</span>
                {DEMO_TABLE_TOKEN}
              </p>

              <hr className="u-rule-gold border-t" />

              <p className="text-body-sm text-pretty text-text-muted">{t('states.demo.body')}</p>

              <Link href={DEMO_TABLE_HREF} className={`${LINK_QUIET} self-start`}>
                {t('customer.welcome.viewMenu')}
              </Link>
            </Card>
          </div>
        </div>

        {/* ── THE ORDER, END TO END ────────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-6xl px-(--space-gutter-sm) pb-(--space-section-md) md:px-(--space-gutter-md)">
          <Section
            id="lifecycle"
            overline={t('nav.tracking')}
            title={t('customer.tracking.timelineTitle')}
            description={t('customer.checkout.successBody')}
            level={2}
            spacing="md"
            divider
          >
            <ol className="flex flex-col">
              {lifecycle.map((step, index) => (
                <li
                  key={step.key}
                  className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-border-subtle py-5"
                >
                  <span
                    aria-hidden="true"
                    className="u-tnum w-8 shrink-0 font-display text-display-sm text-accent"
                  >
                    {formatNumber(index + 1, locale)}
                  </span>
                  <span className="font-display text-title text-text">{step.label}</span>
                  <p className="w-full text-body-sm text-pretty text-text-muted sm:w-auto sm:flex-1 sm:text-end">
                    {step.copy}
                  </p>
                </li>
              ))}
            </ol>
          </Section>
        </div>

        {/* ── THE STAFF DOOR ───────────────────────────────────────────────── */}
        <div className="mx-auto w-full max-w-6xl px-(--space-gutter-sm) pb-(--space-section-lg) md:px-(--space-gutter-md)">
          <Section
            id="staff"
            overline={t('nav.staff')}
            title={t('auth.signInTitle')}
            description={t('auth.signInSubtitle')}
            level={2}
            spacing="md"
            divider
            actions={
              <Link href="/login" className={LINK_PRIMARY}>
                {t('auth.signIn')}
              </Link>
            }
          >
            <ul className="flex flex-col">
              {staffSurfaces.map((surface) => (
                <li key={surface.key} className="border-t border-border-subtle">
                  <Link
                    href="/login"
                    className="group flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-5 transition-colors duration-(--duration-fast) ease-standard"
                  >
                    <span className="font-display text-title text-text group-hover:text-accent">
                      {surface.name}
                    </span>
                    <span className="text-body-sm text-text-muted">{surface.line}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-4 px-(--space-gutter-sm) py-8 md:px-(--space-gutter-md)">
          <span className="font-display text-body text-text-subtle">{t('common.appName')}</span>
          <div className="flex items-center gap-4">
            <Link href={DEMO_TABLE_HREF} className={LINK_QUIET}>
              {t('nav.menu')}
            </Link>
            <Link href="/login" className={LINK_QUIET}>
              {t('auth.signInTitle')}
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
