/**
 * Locale-aware formatting.
 *
 * Every function here is built on `Intl` and is pure: given the same arguments it returns
 * the same string on the server and in the browser, so a server-rendered price or
 * timestamp never changes during hydration. That is why
 *
 *   - no function reads the ambient time zone (dates take an explicit IANA zone; the
 *     server's own zone is UTC and a Tashkent diner must never see it),
 *   - no function reads `Date.now()` implicitly (relative time takes `now` as an argument),
 *   - formatter objects are cached by key, because constructing an `Intl.*` is the
 *     expensive part and a menu renders dozens of prices.
 *
 * It also owns message resolution — interpolation, `translate`, `translatePlural` and
 * the `Translator` object — because those are string rendering too, and because the server
 * loader and the client provider must share one implementation rather than two that drift.
 *
 * doc 07 §1.5, §5.2; doc 03 §5.2 (money).
 */

import { BCP47 } from './config';
import { selectPluralForm } from './plural';
import type {
  Dictionary,
  Locale,
  MessageParams,
  PluralForms,
  PluralPath,
  StringPath,
} from './types';

/* ------------------------------------------------------------------ */
/* Message interpolation                                               */
/* ------------------------------------------------------------------ */

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Replaces `{name}` with `params.name`. `{{` and `}}` are literal braces. An unknown
 * placeholder is left verbatim rather than blanked, so a screenshot shows what is missing.
 *
 * interpolate('Table {number}', { number: 12 }) === 'Table 12'
 */
export function interpolate(template: string, params?: MessageParams): string {
  const substituted = params
    ? template.replace(PLACEHOLDER, (match, key: string) => {
        const value = params[key];
        if (value === undefined) {
          if (process.env.NODE_ENV !== 'production') {
            console.warn(`[i18n] missing param "${key}" for "${template}"`);
          }
          return match;
        }
        return String(value);
      })
    : template;
  return substituted.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

const numberCache = new Map<string, Intl.NumberFormat>();

function cachedNumber(
  locale: Locale,
  key: string,
  init: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const cacheKey = `${locale}|${key}`;
  const hit = numberCache.get(cacheKey);
  if (hit) return hit;
  const created = new Intl.NumberFormat(BCP47[locale], init);
  numberCache.set(cacheKey, created);
  return created;
}

export interface FormatNumberOptions {
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
}

/**
 * Plain number with locale grouping. The default is 0 fraction digits, because every
 * number this product shows a guest — counts, minutes, so'm — is a whole one.
 *
 * formatNumber(45000, 'uz') === '45 000'   (U+00A0 group separator)
 * formatNumber(45000, 'ru') === '45 000'
 * formatNumber(45000, 'en') === '45,000'
 * formatNumber(12.5, 'ru', { maximumFractionDigits: 1 }) === '12,5'
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: FormatNumberOptions,
): string {
  const min = options?.minimumFractionDigits ?? 0;
  const max = Math.max(options?.maximumFractionDigits ?? 0, min);
  return cachedNumber(locale, `n${min}-${max}`, {
    style: 'decimal',
    minimumFractionDigits: min,
    maximumFractionDigits: max,
    useGrouping: true,
  }).format(value);
}

/**
 * Basis points as a human percentage. bps is the only percentage representation in the
 * system (`service_fee_bps`, `discount_bps`), so this is the only converter.
 *
 * formatPercentFromBps(1000, 'en') === '10%'
 * formatPercentFromBps(1000, 'ru') === '10 %'
 * formatPercentFromBps(1250, 'ru') === '12,5 %'
 */
export function formatPercentFromBps(bps: number, locale: Locale): string {
  if (!Number.isInteger(bps)) throw new TypeError(`bps must be an integer, got ${bps}`);
  return cachedNumber(locale, 'pct', {
    style: 'percent',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/**
 * Compact form for dashboard tiles where the full number would wrap.
 * NEVER used for money — a revenue figure is always exact.
 *
 * formatCompactNumber(1200, 'en') === '1.2K'
 * formatCompactNumber(1200, 'ru') === '1,2 тыс.'
 */
export function formatCompactNumber(value: number, locale: Locale): string {
  try {
    return cachedNumber(locale, 'compact', {
      notation: 'compact',
      compactDisplay: 'short',
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return formatNumber(value, locale);
  }
}

const listCache = new Map<string, Intl.ListFormat>();

/**
 * "Osh, Somsa va Choy" / "Плов, самса и чай" / "Osh, somsa and tea".
 * `conjunction` adds the va/и/and; `unit` is comma-separated with none.
 */
export function formatList(
  items: readonly string[],
  locale: Locale,
  type: 'conjunction' | 'unit' = 'conjunction',
): string {
  const cacheKey = `${locale}|${type}`;
  let formatter = listCache.get(cacheKey);
  if (!formatter) {
    formatter = new Intl.ListFormat(BCP47[locale], { style: 'long', type });
    listCache.set(cacheKey, formatter);
  }
  return formatter.format(items);
}

/** Upload limits in the admin menu editor. Binary units, locale-formatted number. */
export function formatFileSize(bytes: number, locale: Locale): string {
  const units = ['B', 'KB', 'MB', 'GB'] as const;
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  return `${formatNumber(value, locale, { maximumFractionDigits: digits })} ${units[unit]}`;
}

/* ------------------------------------------------------------------ */
/* Money                                                               */
/* ------------------------------------------------------------------ */

/**
 * Currency labels per locale. `Intl`'s own currency style is NOT used: it renders
 * differently across ICU builds and browsers, and produces "UZS 45 000" where an Uzbek
 * diner expects "45 000 so'm". Grouping and the decimal mark still come from `Intl` —
 * those are stable and locale-correct — but the currency token is ours.
 */
const CURRENCY_LABELS: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  UZS: { uz: "so'm", ru: 'сўм', en: 'UZS' },
  USD: { uz: '$', ru: '$', en: '$' },
  EUR: { uz: '€', ru: '€', en: '€' },
  RUB: { uz: '₽', ru: '₽', en: '₽' },
};

/** Currencies whose symbol precedes the number — in English only. */
const PREFIX_IN_EN = new Set(['USD', 'EUR']);

/**
 * Minor-unit exponent per currency: UZS prices are whole so'm, USD/EUR/RUB have cents.
 * The tenant's own `restaurants.currency_decimals` wins when it is known; this map is
 * the answer for a caller that has a currency code and nothing else.
 */
export const CURRENCY_DECIMALS: Readonly<Record<string, number>> = {
  UZS: 0,
  USD: 2,
  EUR: 2,
  RUB: 2,
};

/** Decimals for a currency code, defaulting to the ISO-4217 norm of 2. */
export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * The single money renderer. `amount` is in MINOR units (doc 03 `Money`: BIGINT so'm /
 * cents, never a float), so 45000 UZS is `45000` and 12.50 USD is `1250`.
 *
 * formatMoney(45000, 'UZS', 0, 'uz') === "45 000 so'm"
 * formatMoney(45000, 'UZS', 0, 'ru') === '45 000 сўм'
 * formatMoney(45000, 'UZS', 0, 'en') === '45,000 UZS'
 * formatMoney(1250,  'USD', 2, 'en') === '$12.50'
 * formatMoney(1250,  'USD', 2, 'ru') === '12,50 $'
 *
 * The separator between amount and label is U+00A0: a price must never wrap in half.
 */
export function formatMoney(
  amount: number,
  currency: string,
  decimals: number,
  locale: Locale,
): string {
  if (!Number.isInteger(amount)) {
    throw new TypeError(`money amount must be an integer in minor units, got ${amount}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
    throw new TypeError(`decimals must be an integer 0..4, got ${decimals}`);
  }

  // Presentation only — this quotient is never fed back into arithmetic.
  const major = amount / 10 ** decimals;
  const digits = cachedNumber(locale, `money${decimals}`, {
    style: 'decimal',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  }).format(major);

  const code = currency.toUpperCase();
  const label = CURRENCY_LABELS[code]?.[locale] ?? code;
  return locale === 'en' && PREFIX_IN_EN.has(code)
    ? `${label}${digits}`
    : `${digits} ${label}`;
}

/** `formatMoney` for a caller that has no tenant `currency_decimals` to hand. */
export function formatMoneyAuto(amount: number, currency: string, locale: Locale): string {
  return formatMoney(amount, currency, currencyDecimals(currency), locale);
}

/* ------------------------------------------------------------------ */
/* Dates and times                                                     */
/* ------------------------------------------------------------------ */

/** Anything a timestamp arrives as: a `Date`, an ISO string from Postgres, or epoch ms. */
export type Instant = Date | string | number;

function toDate(value: Instant): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new TypeError(`invalid date: ${String(value)}`);
  return date;
}

const dateTimeCache = new Map<string, Intl.DateTimeFormat>();

function cachedDateTime(
  locale: Locale,
  timeZone: string,
  key: string,
  init: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const cacheKey = `${locale}|${timeZone}|${key}`;
  const hit = dateTimeCache.get(cacheKey);
  if (hit) return hit;
  const created = new Intl.DateTimeFormat(BCP47[locale], { ...init, timeZone });
  dateTimeCache.set(cacheKey, created);
  return created;
}

/**
 * '14:05' in all three locales — 12-hour time is forced off, Uzbekistan does not use AM/PM.
 * `timeZone` is an IANA zone (`branches.timezone`), never optional: the server runs in UTC.
 */
export function formatTime(at: Instant, locale: Locale, timeZone: string): string {
  return cachedDateTime(locale, timeZone, 'time', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(toDate(at));
}

/** '1-sentabr, 2026' / '1 сентября 2026 г.' / '1 September 2026' */
export function formatDate(at: Instant, locale: Locale, timeZone: string): string {
  return cachedDateTime(locale, timeZone, 'date', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(toDate(at));
}

/** Date and time in one string, for order headers and CSV exports. */
export function formatDateTime(at: Instant, locale: Locale, timeZone: string): string {
  return cachedDateTime(locale, timeZone, 'datetime', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(toDate(at));
}

const relativeCache = new Map<Locale, Intl.RelativeTimeFormat>();

/**
 * '3 daqiqa oldin' / '3 минуты назад' / '3 minutes ago'.
 *
 * This is the one place pluralisation is delegated to CLDR rather than to our own
 * catalogue, because the unit noun ("минуты" vs "минут") is CLDR data, not our copy.
 * `now` is an argument so a server render and its hydration agree; pass the request's
 * timestamp rather than letting each side call `Date.now()`.
 * Anything under 45 s is rendered by the caller as `common.justNow`.
 */
export function formatRelativeTime(
  at: Instant,
  locale: Locale,
  now: Instant = Date.now(),
): string {
  let formatter = relativeCache.get(locale);
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(BCP47[locale], { numeric: 'auto', style: 'long' });
    relativeCache.set(locale, formatter);
  }

  const deltaMs = toDate(at).getTime() - toDate(now).getTime();
  const absMs = Math.abs(deltaMs);

  const SECOND = 1000;
  const MINUTE = 60 * SECOND;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const MONTH = 30 * DAY;
  const YEAR = 365 * DAY;

  const [unit, divisor]: [Intl.RelativeTimeFormatUnit, number] =
    absMs < 45 * SECOND
      ? ['second', SECOND]
      : absMs < 45 * MINUTE
        ? ['minute', MINUTE]
        : absMs < 22 * HOUR
          ? ['hour', HOUR]
          : absMs < 26 * DAY
            ? ['day', DAY]
            : absMs < 11 * MONTH
              ? ['month', MONTH]
              : ['year', YEAR];

  return formatter.format(Math.round(deltaMs / divisor), unit);
}

export interface FormatDurationOptions {
  /** 'long' → "20 minutes"; 'short' → "20 min". Defaults to 'long'. */
  style?: 'long' | 'short';
}

/**
 * Prose duration from a whole number of minutes: '20 daqiqa' / '20 минут' / '20 minutes',
 * '1 soat 20 daqiqa' / '1 час 20 минут' / '1 hour 20 minutes'.
 *
 * Built on `Intl.NumberFormat`'s unit style rather than `Intl.DurationFormat`, which is
 * not in every runtime this ships to; feature-detecting it would make the server and the
 * client disagree, which is exactly what this module exists to prevent.
 */
export function formatDuration(
  minutes: number,
  locale: Locale,
  options?: FormatDurationOptions,
): string {
  const style = options?.style ?? 'long';
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;

  if (hours === 0) return formatUnit(rest, 'minute', locale, style);
  if (rest === 0) return formatUnit(hours, 'hour', locale, style);
  return `${formatUnit(hours, 'hour', locale, style)} ${formatUnit(rest, 'minute', locale, style)}`;
}

function formatUnit(
  value: number,
  unit: 'hour' | 'minute',
  locale: Locale,
  style: 'long' | 'short',
): string {
  try {
    return cachedNumber(locale, `u-${unit}-${style}`, {
      style: 'unit',
      unit,
      unitDisplay: style === 'long' ? 'long' : 'short',
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    // Partial ICU: better a bare number than a thrown render.
    return `${formatNumber(value, locale)} ${unit === 'hour' ? 'h' : 'min'}`;
  }
}

/* ------------------------------------------------------------------ */
/* Messages                                                            */
/* ------------------------------------------------------------------ */

function walk(dictionary: Dictionary, key: string): unknown {
  let node: unknown = dictionary;
  for (const segment of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[segment];
  }
  return node;
}

/**
 * Resolve one message.
 *
 * `key` is a checked dot-path, so the miss branch is unreachable from application code;
 * it exists for the dynamic keys the error layer produces (`errors.${wireCode}`). In
 * development a miss throws, because a missing string is a bug someone must fix. In
 * production it renders the key itself — debuggable in a screenshot, and never a blank
 * button on a diner's phone.
 */
export function translate(
  dictionary: Dictionary,
  key: StringPath | (string & {}),
  params?: MessageParams,
): string {
  const value = walk(dictionary, key);
  if (typeof value === 'string') return interpolate(value, params);
  if (process.env.NODE_ENV !== 'production') {
    throw new Error(`[i18n] missing or non-string message key: "${key}"`);
  }
  return key;
}

/**
 * Resolve a plural message. `count` is always exposed to the template as `{count}`,
 * pre-formatted with the locale's grouping (1 200 / 1 200 / 1,200), so a catalogue never
 * has to think about digit grouping.
 */
export function translatePlural(
  dictionary: Dictionary,
  key: PluralPath | (string & {}),
  count: number,
  locale: Locale,
  params?: MessageParams,
): string {
  const node = walk(dictionary, key) as PluralForms | undefined;
  if (!node || typeof node.other !== 'string') {
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`[i18n] missing or malformed plural key: "${key}"`);
    }
    return key;
  }
  return interpolate(selectPluralForm(node, locale, count), {
    count: formatNumber(count, locale),
    ...params,
  });
}

/**
 * The translation callable used by both sides of the boundary.
 *
 * `t('customer.cart.title')` is checked against the catalogue; `t.n('plurals.items', 3)`
 * takes the plural path only. Both live on one object so a component needs one binding.
 */
export interface Translator {
  /** t('customer.cart.placeOrder') · t('kitchen.placedAgo', { minutes: 4 }) */
  (key: StringPath, params?: MessageParams): string;
  /** t.n('plurals.items', 3) → "3 ta taom" / "3 блюда" / "3 items" */
  n: (key: PluralPath, count: number, params?: MessageParams) => string;
  /** The active locale, for the odd component that needs to branch on it. */
  locale: Locale;
  /** Its BCP-47 tag, for an ad-hoc `Intl` in a leaf component. */
  tag: string;
}

/**
 * Build a translator over one catalogue. Allocated once per locale change — in the
 * provider, and once per server render — never per component and never per render.
 */
export function createTranslator(locale: Locale, dictionary: Dictionary): Translator {
  const fn = ((key: StringPath, params?: MessageParams) =>
    translate(dictionary, key, params)) as Translator;
  fn.n = (key: PluralPath, count: number, params?: MessageParams) =>
    translatePlural(dictionary, key, count, locale, params);
  fn.locale = locale;
  fn.tag = BCP47[locale];
  return fn;
}
