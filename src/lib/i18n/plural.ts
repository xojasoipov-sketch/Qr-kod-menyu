/**
 * Pluralisation.
 *
 * Uzbek and Russian do not share a rule, and neither matches English. Getting this wrong
 * is the most visible localisation bug a menu can have — "5 блюда" is noticed instantly
 * by every Russian speaker — so the rule is both delegated to CLDR *and* written out.
 *
 * `Intl.PluralRules` is the primary implementation: it is CLDR data, it is identical on
 * the server and in the browser, and it costs nothing. It is not trusted blindly: a
 * small-ICU Node build resolves `uz` to the CLDR root locale, whose only category is
 * `other`, which would render "1 ta taomlar". Each locale's rules object is therefore
 * probed once against known-correct answers, and a runtime that fails the probe falls
 * back to the hand-written rule below. Both paths produce the same output on a correct
 * ICU build, so a page never changes wording between server render and hydration.
 *
 * doc 07 §1.6.
 */

import type { Locale, PluralForms } from './types';
import { BCP47 } from './config';

/**
 * The plural categories this product uses. Derived from `PluralForms`, so a catalogue
 * form and a rule result can never disagree about which categories exist.
 */
export type PluralCategory = keyof PluralForms;

/** All four, in CLDR order. Iterate this rather than writing the strings again. */
export const PLURAL_CATEGORIES = ['one', 'few', 'many', 'other'] as const satisfies
  readonly PluralCategory[];

function isPluralCategory(value: string): value is PluralCategory {
  return (PLURAL_CATEGORIES as readonly string[]).includes(value);
}

/**
 * The hand-written rules, used when the runtime's ICU data cannot be trusted.
 *
 * Fractions are not a case this product has: every count is a whole number of items,
 * minutes or orders, so `count` is truncated rather than routed to `other`.
 */
function ruleFor(locale: Locale, n: number): PluralCategory {
  switch (locale) {
    case 'ru': {
      const mod10 = n % 10;
      const mod100 = n % 100;
      if (mod10 === 1 && mod100 !== 11) return 'one';
      if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few';
      return 'many';
    }
    case 'uz':
    case 'en':
      return n === 1 ? 'one' : 'other';
  }
}

/**
 * Counts whose category is certain, per locale. If `Intl` disagrees with any of these,
 * its data for that locale is incomplete and we stop using it.
 */
const PROBES: Readonly<Record<Locale, ReadonlyArray<readonly [number, PluralCategory]>>> = {
  uz: [
    [1, 'one'],
    [0, 'other'],
    [5, 'other'],
  ],
  ru: [
    [1, 'one'],
    [2, 'few'],
    [5, 'many'],
    [11, 'many'],
    [21, 'one'],
  ],
  en: [
    [1, 'one'],
    [0, 'other'],
    [5, 'other'],
  ],
};

/** `null` means "this runtime's ICU data for that locale failed the probe". */
const rulesCache = new Map<Locale, Intl.PluralRules | null>();

function intlRulesFor(locale: Locale): Intl.PluralRules | null {
  const cached = rulesCache.get(locale);
  if (cached !== undefined) return cached;

  let rules: Intl.PluralRules | null = null;
  try {
    const candidate = new Intl.PluralRules(BCP47[locale], { type: 'cardinal' });
    const trustworthy = PROBES[locale].every(([n, expected]) => candidate.select(n) === expected);
    rules = trustworthy ? candidate : null;
  } catch {
    rules = null;
  }

  rulesCache.set(locale, rules);
  return rules;
}

/**
 * The plural category for `count` in `locale`.
 *
 * plural('ru', 1)  === 'one'   // 1 блюдо
 * plural('ru', 2)  === 'few'   // 2 блюда
 * plural('ru', 5)  === 'many'  // 5 блюд
 * plural('ru', 11) === 'many'  // 11 блюд
 * plural('ru', 21) === 'one'   // 21 блюдо
 * plural('uz', 5)  === 'other' // 5 ta taom — the noun does not inflect
 */
export function plural(locale: Locale, count: number): PluralCategory {
  const n = Math.abs(Math.trunc(count));
  const rules = intlRulesFor(locale);
  if (rules) {
    const category = rules.select(n);
    if (isPluralCategory(category)) return category;
  }
  return ruleFor(locale, n);
}

/**
 * Pick the right form out of a complete `PluralForms` record.
 *
 * The record is total, so there is no "missing form" branch to get wrong; `?? forms.other`
 * exists only for a catalogue that reached us as untyped JSON.
 */
export function selectPluralForm(
  forms: PluralForms,
  locale: Locale,
  count: number,
): string {
  return forms[plural(locale, count)] ?? forms.other;
}
