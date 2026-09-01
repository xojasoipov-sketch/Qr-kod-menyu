'use client';

/**
 * src/components/ui/language-switcher.tsx — LanguageSwitcher.
 * Source: docs/architecture/04-design-system.md §6.5, §9.4; doc 07 §1.9.
 *
 * Labels are the ENDONYMS, always: O'zbekcha · Русский · English. Never UZ / RU /
 * EN alone — an abbreviation in a language you cannot read is not a way out — and
 * never a flag: flags denote countries, and Russian is not spoken only in Russia
 * (§6.5). Each option carries its own `lang`, so a screen reader switches voice
 * before it reads the name (§9.4).
 *
 * There is no locale URL prefix (frozen decision: QR links stay short), so this
 * NEVER rewrites the pathname. The default write is: set `qros_locale`, drop a
 * deep link's `?lang=` now that it has been persisted, and `router.refresh()` so
 * the server re-renders with the new catalogue. Pass `onChange` to take that over
 * — e.g. to call a `setLocale` server action instead.
 */

import { useCallback, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Languages } from 'lucide-react';

import {
  BCP47,
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_NATIVE_NAMES,
  LOCALE_QUERY_PARAM,
} from '@/lib/i18n/config';
import { useLocale, useT } from '@/lib/i18n/provider';
import type { Locale } from '@/lib/i18n/types';
import { cn } from '@/lib/utils/cn';

export type LanguageSwitcherVariant = 'segmented' | 'inline' | 'menu';
export type LanguageSwitcherSize = 'sm' | 'md';

export interface LanguageSwitcherProps {
  /** Defaults to the locale on the context, which is the one the server resolved. */
  current?: Locale;
  /** default 'segmented' on customer, 'menu' in admin — the caller picks. */
  variant?: LanguageSwitcherVariant;
  /** default 'md' */
  size?: LanguageSwitcherSize;
  /** Omitted → this component performs the default cookie write and refresh. */
  onChange?: (locale: Locale) => void;
  className?: string;
}

const OPTION_SIZE: Record<LanguageSwitcherSize, string> = {
  sm: 'h-8 px-2.5 text-caption',
  md: 'h-10 px-3 text-body-sm',
};

const SELECT_SIZE: Record<LanguageSwitcherSize, string> = {
  sm: 'h-8 ps-8 pe-7 text-caption',
  md: 'h-10 ps-9 pe-8 text-body-sm',
};

/**
 * Path=/ so it survives every route; SameSite=Lax so a scanned QR link carries it;
 * Secure whenever the page itself is (production is always https).
 */
function writeLocaleCookie(locale: Locale): void {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
}

export function LanguageSwitcher({
  current,
  variant = 'segmented',
  size = 'md',
  onChange,
  className,
}: LanguageSwitcherProps): React.JSX.Element {
  const t = useT();
  const contextLocale = useLocale();
  const router = useRouter();
  const groupId = useId();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [pendingLocale, setPendingLocale] = useState<Locale | null>(null);
  const [isPending, startTransition] = useTransition();

  const active = current ?? contextLocale;
  /** The 50% opacity of §6.5's pending state, cleared the moment the refresh settles. */
  const pending = isPending ? pendingLocale : null;
  const groupLabel = t('a11y.languageSwitcher');

  const select = useCallback(
    (locale: Locale) => {
      if (locale === active) return;
      setPendingLocale(locale);

      if (onChange !== undefined) {
        startTransition(() => {
          onChange(locale);
        });
        return;
      }

      writeLocaleCookie(locale);
      startTransition(() => {
        // The ?lang= override is a deep-link affordance only. It has just been
        // promoted to the cookie, so it is dropped rather than left to outrank it.
        const url = new URL(window.location.href);
        if (url.searchParams.has(LOCALE_QUERY_PARAM)) {
          url.searchParams.delete(LOCALE_QUERY_PARAM);
          router.replace(`${url.pathname}${url.search}${url.hash}`, { scroll: false });
        }
        router.refresh();
      });
    },
    [active, onChange, router],
  );

  /* ---------------------------------------------------------------- */
  /* menu — a styled native <select>. No popover to trap focus in.     */
  /* ---------------------------------------------------------------- */

  if (variant === 'menu') {
    return (
      <div className={cn('relative inline-flex items-center', className)}>
        <label htmlFor={groupId} className="sr-only">
          {groupLabel}
        </label>
        <Languages
          aria-hidden="true"
          focusable="false"
          strokeWidth={1.75}
          className={cn(
            'u-icon-align pointer-events-none absolute start-2.5 text-text-subtle',
            size === 'sm' ? 'size-3.5' : 'size-4',
          )}
        />
        <select
          id={groupId}
          value={active}
          disabled={pending !== null}
          onChange={(event) => select(event.target.value as Locale)}
          className={cn(
            'min-h-(--tap-min) admin:min-h-11 w-auto appearance-none rounded-control',
            'border border-border bg-surface-sunken text-text',
            'transition-[border-color,opacity] duration-(--duration-fast) ease-standard',
            'focus:border-accent disabled:cursor-progress',
            SELECT_SIZE[size],
            pending !== null && 'opacity-50',
          )}
        >
          {LOCALES.map((locale) => (
            <option key={locale} value={locale} lang={BCP47[locale]}>
              {LOCALE_NATIVE_NAMES[locale]}
            </option>
          ))}
        </select>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* segmented / inline — one radiogroup, two skins.                   */
  /* ---------------------------------------------------------------- */

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;

    event.preventDefault();
    const index = LOCALES.indexOf(active);
    const next = LOCALES[(index + step + LOCALES.length) % LOCALES.length];
    if (next === undefined) return;
    listRef.current?.querySelector<HTMLElement>(`[data-locale="${next}"]`)?.focus();
    select(next);
  };

  return (
    <div
      ref={listRef}
      role="radiogroup"
      aria-label={groupLabel}
      onKeyDown={handleKeyDown}
      className={cn(
        'inline-flex items-center',
        variant === 'segmented' ? 'gap-1 rounded-control bg-surface-sunken p-1' : 'gap-1',
        className,
      )}
    >
      {LOCALES.map((locale) => {
        const checked = locale === active;
        return (
          <button
            key={locale}
            type="button"
            role="radio"
            lang={BCP47[locale]}
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-locale={locale}
            onClick={() => select(locale)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center rounded-control whitespace-nowrap',
              'min-h-(--tap-min) admin:min-h-11',
              'transition-[color,background-color,opacity] duration-(--duration-fast) ease-standard',
              OPTION_SIZE[size],
              variant === 'segmented' && checked && 'bg-elevated text-text font-medium shadow-card',
              variant === 'segmented' && !checked && 'text-text-muted hover:text-text',
              variant === 'inline' && checked && 'text-text font-medium underline underline-offset-4 decoration-accent',
              variant === 'inline' && !checked && 'text-text-muted hover:text-text',
              pending === locale && 'opacity-50',
            )}
          >
            {LOCALE_NATIVE_NAMES[locale]}
          </button>
        );
      })}
    </div>
  );
}

/**
 * §11's manifest calls this file `common/locale-switcher.tsx` with the export
 * `LocaleSwitcher`. The component lives in `ui/` here; the alias exists so nobody
 * writes a second one against the manifest name.
 */
export { LanguageSwitcher as LocaleSwitcher };
