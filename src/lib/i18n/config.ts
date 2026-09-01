/**
 * Locale configuration — the constants every other i18n module reads.
 *
 * Deliberately free of Next.js, React and dictionary imports: middleware (edge),
 * server components, client components and tests all import this file.
 *
 * doc 07 §1.3, §1.7, §1.9.
 */

import type { Locale } from './types';

/** The supported UI languages, in the order the switcher renders them. */
export const LOCALES = ['uz', 'ru', 'en'] as const satisfies readonly Locale[];

/** The language a scan gets when nothing else says otherwise. */
export const DEFAULT_LOCALE: Locale = 'uz';

/**
 * Fallback order used when a catalogue or a database `i18n_text` lacks the active locale.
 * Uzbek first because that is the operating language of the restaurants this runs in.
 */
export const LOCALE_FALLBACK_ORDER = ['uz', 'ru', 'en'] as const satisfies readonly Locale[];

/**
 * Native language names — never translated. A Russian speaker looks for "Русский",
 * not for "Russian" rendered in Uzbek.
 */
export const LOCALE_NATIVE_NAMES: Readonly<Record<Locale, string>> = {
  uz: "O'zbekcha",
  ru: 'Русский',
  en: 'English',
};

/** Two-letter chips for the compact (customer header) switcher variant. */
export const LOCALE_SHORT_LABELS: Readonly<Record<Locale, string>> = {
  uz: 'UZ',
  ru: 'RU',
  en: 'EN',
};

/**
 * Text direction. All three locales are LTR; the map exists so that adding `ar` or `fa`
 * later is a data change rather than a hunt through JSX for hard-coded `dir="ltr"`.
 */
export const LOCALE_DIRECTION: Readonly<Record<Locale, 'ltr' | 'rtl'>> = {
  uz: 'ltr',
  ru: 'ltr',
  en: 'ltr',
};

/**
 * BCP-47 tags for every `Intl` constructor in the product. Never build a tag by hand:
 * `new Intl.NumberFormat('uz')` and `new Intl.NumberFormat('uz-UZ')` do not agree on
 * every ICU build.
 */
export const BCP47: Readonly<Record<Locale, string>> = {
  uz: 'uz-UZ',
  ru: 'ru-RU',
  en: 'en-US',
};

/** The locale cookie. Not HttpOnly: it carries no authority, only a language choice. */
export const LOCALE_COOKIE = 'qros_locale';

/** `?lang=ru` — honoured on the first request of a session, then promoted to the cookie. */
export const LOCALE_QUERY_PARAM = 'lang';

/** One year. A diner who chose Russian last month still gets Russian. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Narrowing guard for anything arriving from a cookie, a query string or a header. */
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** The BCP-47 tag for an `Intl` constructor. */
export function bcp47(locale: Locale): string {
  return BCP47[locale];
}

/** The `dir` attribute value for `<html>`. */
export function direction(locale: Locale): 'ltr' | 'rtl' {
  return LOCALE_DIRECTION[locale];
}

/** The name a language is called in its own language — for the switcher and for toasts. */
export function nativeName(locale: Locale): string {
  return LOCALE_NATIVE_NAMES[locale];
}
