/**
 * The i18n type layer.
 *
 * `Dictionary` is DERIVED from the English catalogue rather than hand-written, so the
 * catalogue and its type can never drift: adding a key to `dictionaries/en.ts` extends
 * `Dictionary`, which immediately makes `uz.ts` / `ru.ts` (declared with `satisfies
 * Dictionary`) fail `npm run typecheck` until the same key is translated. A key that
 * exists only in another locale is rejected by the same `satisfies`, because excess
 * property checking applies to the fresh object literal each catalogue module exports.
 *
 * doc 07 §1.2–§1.3.
 */

/** The three UI languages. Frozen — a fourth is a data change plus three catalogues. */
export type Locale = 'uz' | 'ru' | 'en';

/**
 * A plural message. All four CLDR categories are present in every locale, always —
 * a locale cannot silently miss a form, because the record is total.
 *
 * ru: `one` = n%10==1 && n%100!=11, `few` = n%10 in 2..4 && n%100 not in 12..14,
 * `many` = everything else. uz/en fill `few`/`many` with the `other` wording; the
 * Uzbek noun does not inflect after a numeral ("1 ta taom", "5 ta taom").
 */
export interface PluralForms {
  /** n = 1 */
  one: string;
  /** ru: n%10 in 2..4 and n%100 not in 12..14. uz/en: duplicate of `other`. */
  few: string;
  /** ru: everything else. uz/en: duplicate of `other`. */
  many: string;
  /** The catch-all. Uzbek uses this form for every n != 1. */
  other: string;
}

/** loading / empty / error shells share this pair. */
export interface StateCopy {
  title: string;
  body: string;
}

// `import type` pulls in only the name `dictionary`, purely for the `typeof`
// below — nothing runtime is bundled here, the same guarantee the old inline
// `import('./dictionaries/en')` type gave, in the form the lint config's
// consistent-type-imports rule wants at the top of the file.
import type { dictionary as englishDictionary } from './dictionaries/en';

/**
 * One locale's complete message catalogue — 884 leaf strings.
 *
 * Written as a `typeof` of the English module so there is exactly one place a
 * key is declared.
 */
export type Dictionary = typeof englishDictionary;

/** doc 03 / doc 05 call the catalogue `Messages`. Same thing. */
export type Messages = Dictionary;

/** Recursively readonly. Use for a catalogue that crosses a boundary and must not be mutated. */
export type DeepReadonly<T> = T extends string | number | boolean | null | undefined
  ? T
  : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/** The catalogue as an immutable value. */
export type ReadonlyDictionary = DeepReadonly<Dictionary>;

/**
 * Every legal dot-path into `Dictionary`.
 * 'customer.cart.placeOrder' ✓   'customer.cart.placeorder' ✗ (compile error)
 * A plural key resolves to its `PluralForms` node, e.g. 'plurals.items' — not to its leaves.
 */
export type DictionaryPath<T = Dictionary> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? K
      : `${K}.${DictionaryPath<T[K]>}`;
}[keyof T & string];

/** Paths whose value is a plain string — everything `t()` may return. */
export type StringPath<T = Dictionary> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends PluralForms
      ? never
      : `${K}.${StringPath<T[K]>}`;
}[keyof T & string];

/** Paths whose value is a `PluralForms` node — everything `t.n()` accepts. */
export type PluralPath = Extract<DictionaryPath, `plurals.${string}`>;

/** A dot-path whose value is a plain string. Assignable to `string`. */
export type MessageKey = StringPath;

/**
 * Values allowed in an interpolation. Objects and dates are rejected at the type level:
 * a date must be formatted with `formatDate` before it reaches a message.
 */
export type MessageParams = Readonly<Record<string, string | number>>;
