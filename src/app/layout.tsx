/**
 * src/app/layout.tsx — the single root layout (Server Component).
 * Source: 05-app-structure.md §2.1; 04-design-system.md §0 amendments 1–3, §3.5, §3.6.
 *
 * Responsibility: the document shell, the three font families, the surface and
 * theme attributes, the resolved locale, and the two global providers. Nothing
 * else. It has no data dependency on Supabase and no knowledge of any tenant.
 *
 * Only the root layout may render `<html>`, so it is the only place `data-surface`
 * and `data-theme` can be set — which is why `src/middleware.ts` derives the
 * surface from the pathname and passes it here as `x-qros-surface` (contract C-1).
 * A page that reaches this layout with no header renders `admin`, which is the
 * documented fallback.
 *
 * Reading `cookies()`/`headers()` here opts the whole application into dynamic
 * rendering. That is deliberate and argued in §2.1: the locale lives in a cookie
 * by frozen decision, so `<html lang>` cannot be known at build time for any page,
 * and every surface that matters is per-request anyway. Consequently
 * `cacheComponents` stays off and no segment uses `'use cache'`.
 */

import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';

import { Toaster } from '@/components/ui/toast';
import { publicEnv } from '@/lib/env';
import { fontVariables } from '@/lib/fonts';
import { bcp47, direction } from '@/lib/i18n/config';
import { getDictionary, getServerTranslator } from '@/lib/i18n/get-dictionary';
import { LocaleProvider } from '@/lib/i18n/provider';
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale';

import './globals.css';

export const runtime = 'nodejs';

type Surface = 'customer' | 'kitchen' | 'admin';

const SURFACES: readonly Surface[] = ['customer', 'kitchen', 'admin'];

async function resolveSurface(): Promise<Surface> {
  const headerList = await headers();
  const value = headerList.get('x-qros-surface');
  return SURFACES.find((surface) => surface === value) ?? 'admin';
}

/**
 * The pre-paint theme script (04 §3.5).
 *
 * Synchronous and inline, as the first thing in `<head>`, because a deferred
 * script paints light first and then corrects itself — the flash this exists to
 * prevent. It resolves the OS preference to a *concrete* `data-theme`, which is
 * what lets globals.css declare the dark palette exactly once instead of
 * duplicating it inside a `prefers-color-scheme` media query.
 *
 * Per surface (04 §3.6):
 *   customer — nothing is written; the surface is dark-committed and reaches the
 *              dark mapping through `data-surface` alone.
 *   kitchen  — device-scoped `qros:kds:theme`, dark unless the glare hatch is on.
 *   admin    — the `qros:theme` preference, `system` resolved against the OS.
 *
 * Storage can throw outright (Safari private mode); a theme is never worth a
 * crash, so the catch paints light and moves on. The two storage keys are
 * literals on purpose: `THEME_STORAGE_KEY` lives in a `'use client'` module and
 * every export of one becomes a client reference a Server Component cannot read.
 * They must stay identical to the ones in `@/components/ui/theme-toggle`.
 */
const THEME_BOOTSTRAP = `(function(){try{
var e=document.documentElement,s=e.getAttribute('data-surface');
if(s==='customer')return;
if(s==='kitchen'){e.setAttribute('data-theme',localStorage.getItem('qros:kds:theme')==='light'?'light':'dark');return;}
var p=localStorage.getItem('qros:theme')||'system';
var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme:dark)').matches);
e.setAttribute('data-theme',d?'dark':'light');
}catch(x){document.documentElement.setAttribute('data-theme','light');}})()`;

export async function generateMetadata(): Promise<Metadata> {
  const locale = await resolveRequestLocale();
  const t = getServerTranslator(locale);
  const name = t('common.appName');

  return {
    metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
    title: { default: name, template: `%s · ${name}` },
    description: t('customer.welcome.intro'),
    applicationName: name,
    // A capability token in a URL must never be turned into a phone number or a
    // map link by a mobile browser's autolinker.
    formatDetection: { telephone: false, email: false, address: false },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const surface = await resolveSurface();

  /*
   * `theme-color` is the one place a colour literal is unavoidable: it paints the
   * browser chrome before any stylesheet is parsed, so it cannot read a token.
   * The values are the exact sRGB of --color-ink-950 / --color-ink-975 /
   * --color-ink-50 from globals.css §2.1 (04 §3.6).
   */
  const themeColor =
    surface === 'customer'
      ? [{ color: '#0e0b09' }]
      : surface === 'kitchen'
        ? [
            { media: '(prefers-color-scheme: light)', color: '#f7f5f3' },
            { media: '(prefers-color-scheme: dark)', color: '#080605' },
          ]
        : [
            { media: '(prefers-color-scheme: light)', color: '#f7f5f3' },
            { media: '(prefers-color-scheme: dark)', color: '#0e0b09' },
          ];

  return {
    width: 'device-width',
    initialScale: 1,
    // The customer app is used one-handed on a notched phone; the CartBar sits in
    // the safe area and needs the full viewport to do it.
    viewportFit: 'cover',
    themeColor,
  };
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.JSX.Element> {
  const [locale, surface] = await Promise.all([resolveRequestLocale(), resolveSurface()]);
  const dictionary = getDictionary(locale);
  const t = getServerTranslator(locale);

  return (
    <html
      lang={bcp47(locale)}
      dir={direction(locale)}
      data-surface={surface}
      className={fontVariables}
      // The bootstrap script writes data-theme before React hydrates, so the
      // server markup and the client tree legitimately differ on <html>.
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body className="min-h-dvh bg-surface text-text antialiased">
        <LocaleProvider locale={locale} dictionary={dictionary}>
          {children}
          {/*
            Mounted ONCE, here, for the whole application (04 §12 C-5). A surface
            layout must NOT mount a second <Toaster>: the store is module-global,
            so two mounted regions render every toast twice and announce it twice.
            The component reads `data-surface` itself to choose its placement.
          */}
          <Toaster dismissLabel={t('common.close')} />
        </LocaleProvider>
      </body>
    </html>
  );
}
