import 'server-only';

/**
 * Server-side catalogue loading.
 *
 * `import 'server-only'` is the point of this file: the three catalogues are ~45 KB each
 * and only ONE of them may ever reach a browser. The root layout resolves the locale,
 * calls `getDictionary`, and hands the single chosen catalogue to `<LocaleProvider>`; the
 * client never imports this module, so the other two are never bundled.
 *
 * Loading is synchronous — the modules are already in the server bundle, so there is
 * nothing to await. Call sites written as `const d = await getDictionary(locale)` still
 * work, because awaiting a non-promise is a no-op.
 *
 * doc 07 §1.4, §1.5.
 */

import { DEFAULT_LOCALE, LOCALE_FALLBACK_ORDER, isLocale } from './config';
import { createTranslator, type Translator } from './format';
import { dictionary as en } from './dictionaries/en';
import { dictionary as ru } from './dictionaries/ru';
import { dictionary as uz } from './dictionaries/uz';
import type { Dictionary, Locale } from './types';

/**
 * `satisfies Dictionary` in each catalogue module already rejects a missing key and, via
 * excess-property checking on the exported object literal, an invented one. This second,
 * structural check closes the remaining hole: a catalogue that was annotated rather than
 * `satisfies`-checked would still be caught here, because any key absent from `Dictionary`
 * resolves to `never`.
 */
type Exact<T, Shape> = T extends string
  ? unknown
  : { [K in keyof T]: K extends keyof Shape ? Exact<T[K], Shape[K]> : never };

const _uzIsExact: Exact<typeof uz, Dictionary> = uz;
const _ruIsExact: Exact<typeof ru, Dictionary> = ru;

/** Every catalogue, keyed by locale. Total by construction — `Record`, not a lookup table. */
export const CATALOGUES: Readonly<Record<Locale, Dictionary>> = { uz, ru, en };

/**
 * The complete catalogue for one locale.
 *
 * The argument is widened to `string` on purpose: locales arrive from cookies and query
 * strings, and a caller that has not narrowed one should get the fallback chain rather
 * than a crash. The chain is: requested locale → `DEFAULT_LOCALE` → `LOCALE_FALLBACK_ORDER`
 * (uz, ru, en). The last step cannot fail, so this function always returns a catalogue.
 */
export function getDictionary(locale: Locale | (string & {})): Dictionary {
  if (isLocale(locale)) return CATALOGUES[locale];
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[i18n] unsupported locale "${locale}", falling back to "${DEFAULT_LOCALE}"`);
  }
  for (const candidate of [DEFAULT_LOCALE, ...LOCALE_FALLBACK_ORDER]) {
    const found = CATALOGUES[candidate];
    if (found) return found;
  }
  return en;
}

/** doc 03 and doc 05 call this name. Identical function, kept as the compatibility alias. */
export const getMessages = getDictionary;

/**
 * A translator for a server component, with the same `t(...)` / `t.n(...)` surface the
 * client gets from `useT()`. Built once per render, never per element.
 *
 *   const t = getServerTranslator(locale);
 *   <h1>{t('customer.menu.title')}</h1>
 */
export function getServerTranslator(locale: Locale): Translator {
  return createTranslator(locale, getDictionary(locale));
}
