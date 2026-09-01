/**
 * Locale resolution.
 *
 * Precedence, once:
 *   ?lang=  →  cookie  →  Accept-Language  →  NEXT_PUBLIC_DEFAULT_LOCALE  →  DEFAULT_LOCALE
 *
 * `?lang=` outranks the cookie so a printed poster or a shared link carrying `?lang=ru`
 * wins on the first scan even for a returning diner. Middleware then promotes that choice
 * into the cookie, so the second page load is already cookie-driven and the parameter can
 * be dropped without anything changing.
 *
 * The pure functions here take plain values, so middleware (edge), route handlers, tests
 * and server components all use the same rule. `next/headers` is imported dynamically
 * inside the one async function that needs it, which keeps this module importable from
 * middleware and from the edge runtime, where a top-level `next/headers` import is not
 * allowed.
 *
 * doc 07 §1.7.
 */

import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_QUERY_PARAM,
  isLocale,
} from './config';
import type { Locale } from './types';

/** What a Next page hands over as `searchParams`, or a plain `URLSearchParams`. */
export type SearchParamsInput =
  | URLSearchParams
  | Readonly<Record<string, string | string[] | undefined>>
  | null
  | undefined;

/**
 * Parse an `Accept-Language` header and return the first supported locale.
 *
 * Handles quality values and region subtags: 'ru-RU,ru;q=0.9,en;q=0.8' → 'ru'.
 * Uzbek phones commonly send 'uz-Latn-UZ' or 'uz-Cyrl-UZ'; both map to 'uz', because the
 * UI has one Uzbek and it is Latin. A Cyrillic-Uzbek reader who dislikes that switches
 * once, and the cookie remembers.
 */
export function parseAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;

  const ranked = header
    .split(',')
    .map((part) => {
      const [tagRaw, ...params] = part.trim().split(';');
      const qParam = params.find((p) => p.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: (tagRaw ?? '').trim().toLowerCase(), q: Number.isFinite(q) ? q : 0 };
    })
    .filter((entry) => entry.tag.length > 0 && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const primary = tag.split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return null;
}

/** Read `?lang=` out of whichever shape of search parameters the caller has. */
export function readLangParam(source: SearchParamsInput): string | null {
  if (!source) return null;
  if (source instanceof URLSearchParams) return source.get(LOCALE_QUERY_PARAM);
  const raw = source[LOCALE_QUERY_PARAM];
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw ?? null;
}

export interface ResolveLocaleInput {
  /** Value of the `qros_locale` cookie, if any. */
  cookie?: string | null;
  /** Value of `?lang=`, if any. Middleware has usually already promoted it to the cookie. */
  searchParam?: string | null;
  /** Raw `Accept-Language` header. */
  acceptLanguage?: string | null;
}

/**
 * The rule itself, over plain values. Never throws, always returns a supported locale.
 * Use this from middleware, where `next/headers` is unavailable and the request is at hand.
 */
export function resolveLocaleFrom(input: ResolveLocaleInput): Locale {
  if (isLocale(input.searchParam)) return input.searchParam;
  if (isLocale(input.cookie)) return input.cookie;

  const fromHeader = parseAcceptLanguage(input.acceptLanguage);
  if (fromHeader) return fromHeader;

  const fromEnv = process.env.NEXT_PUBLIC_DEFAULT_LOCALE;
  if (isLocale(fromEnv)) return fromEnv;

  return DEFAULT_LOCALE;
}

/**
 * The locale for the current request, for the root layout and any other server component.
 *
 * Next 16's dynamic APIs are asynchronous — `cookies()` and `headers()` both return
 * promises — so both are awaited, in parallel. Reading them opts the caller into dynamic
 * rendering, which the root layout already is.
 *
 *   const locale = await resolveRequestLocale();                    // layout
 *   const locale = await resolveRequestLocale({ searchParams });    // page with ?lang=
 */
export async function resolveRequestLocale(options?: {
  /** A page's `searchParams`, awaited or not — Next 16 hands it over as a promise. */
  searchParams?: SearchParamsInput | Promise<SearchParamsInput>;
}): Promise<Locale> {
  const { cookies, headers } = await import('next/headers');
  const [cookieStore, headerList, searchParams] = await Promise.all([
    cookies(),
    headers(),
    options?.searchParams ?? null,
  ]);

  return resolveLocaleFrom({
    searchParam: readLangParam(searchParams),
    cookie: cookieStore.get(LOCALE_COOKIE)?.value ?? null,
    acceptLanguage: headerList.get('accept-language'),
  });
}

export interface LocaleCookieOptions {
  path: string;
  maxAge: number;
  sameSite: 'lax';
  secure: boolean;
  httpOnly: false;
}

/** The cookie attributes, in one place, used by middleware and by the locale action. */
export function localeCookieOptions(): LocaleCookieOptions {
  return {
    path: '/',
    maxAge: LOCALE_COOKIE_MAX_AGE,
    sameSite: 'lax',
    // Not HttpOnly: the switcher reads it for its initial state, and it carries no
    // authority — the worst a tampered value can do is render the wrong language.
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
  };
}

/**
 * Write the choice. `store` is the awaited `cookies()` object in a server action, or the
 * `cookies` of a `NextResponse` in middleware — both expose this `set` signature.
 */
export function setLocaleCookie(
  store: { set: (name: string, value: string, options: LocaleCookieOptions) => void },
  locale: Locale,
): void {
  store.set(LOCALE_COOKIE, locale, localeCookieOptions());
}
