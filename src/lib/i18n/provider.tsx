'use client';

/**
 * The client half of the i18n layer.
 *
 * The catalogue is chosen on the server and crosses the RSC boundary once per document as
 * a plain serialisable object (~45 KB, ~9 KB gzipped); client navigations reuse it and
 * nothing is ever fetched again.
 *
 * The cost of a translation at render time is deliberately near zero:
 *   - the whole context value, INCLUDING the translator, is built in one `useMemo` keyed
 *     on the locale and the catalogue, so `useT()` is a context read and nothing else —
 *     no per-component `useMemo`, no closure allocated per render;
 *   - the value's identity changes only when the language changes, so a consumer
 *     re-renders exactly when its strings actually differ;
 *   - switching language is a server action plus `revalidatePath`, so this provider is
 *     re-rendered with a new catalogue rather than swapping one on the client.
 *
 * doc 07 §1.8.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { BCP47, LOCALE_DIRECTION } from './config';
import { createTranslator, type Translator } from './format';
import type { Dictionary, Locale } from './types';

export interface LocaleContextValue {
  locale: Locale;
  /** The complete catalogue for `locale`. */
  dictionary: Dictionary;
  /** BCP-47 tag, for ad-hoc `Intl` construction in a leaf component. */
  tag: string;
  /** Text direction, mirroring `<html dir>`. */
  direction: 'ltr' | 'rtl';
  /** The translator. Stable for the lifetime of this locale. */
  t: Translator;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export interface LocaleProviderProps {
  locale: Locale;
  dictionary: Dictionary;
  children: ReactNode;
}

/**
 * Mounted once, in the root layout, above everything else.
 * There is no second provider anywhere — a nested one would give two subtrees different
 * languages, which is a bug, not a feature.
 */
export function LocaleProvider({ locale, dictionary, children }: LocaleProviderProps) {
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      dictionary,
      tag: BCP47[locale],
      direction: LOCALE_DIRECTION[locale],
      t: createTranslator(locale, dictionary),
    }),
    [locale, dictionary],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** The whole context. Prefer the narrow hooks below unless you genuinely need all of it. */
export function useLocaleContext(): LocaleContextValue {
  const context = useContext(LocaleContext);
  if (!context) {
    throw new Error('useLocaleContext must be used inside <LocaleProvider>');
  }
  return context;
}

/**
 * The translator.
 *
 *   const t = useT();
 *   t('customer.cart.title')                  // checked against the catalogue
 *   t('customer.cart.subtitle', { number: 4, restaurant: name })
 *   t.n('plurals.items', lines.length)        // plural paths only
 */
export function useT(): Translator {
  return useLocaleContext().t;
}

/** The active locale. A primitive, so it is safe in a dependency array. */
export function useLocale(): Locale {
  return useLocaleContext().locale;
}

/** The BCP-47 tag, for a component building its own `Intl` formatter. */
export function useLocaleTag(): string {
  return useLocaleContext().tag;
}

/**
 * The raw catalogue, for the rare component that needs a whole namespace at once
 * (a status legend, a dietary-tag list). Prefer `useT()` for individual strings.
 */
export function useDictionary(): Dictionary {
  return useLocaleContext().dictionary;
}
