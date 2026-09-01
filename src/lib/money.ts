// src/lib/money.ts
import { BCP47, type Locale } from '@/types/i18n';

/**
 * An exact integer count of minor currency units.
 * UZS (currency_decimals = 0): 45000 === 45 000 so'm.
 * USD (currency_decimals = 2): 1250  === $12.50.
 * NEVER fractional. NEVER the product of a float expression.
 */
export type Money = number;

/** Beyond this, integer arithmetic in JS stops being exact. BIGINT in Postgres goes further. */
export const MONEY_MAX: Money = Number.MAX_SAFE_INTEGER;

/** Basis-point denominator: 10000 bps = 100.00%. Mirrors public.bps. */
export const BPS_DENOMINATOR = 10_000;

export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

/** Throws unless `value` is a safe, finite, non-negative integer. Use at every trust boundary. */
export function assertMoney(value: unknown, label = 'amount'): asserts value is Money {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new MoneyError(`${label} must be an integer count of minor units, got ${String(value)}`);
  }
  if (value < 0) {
    throw new MoneyError(`${label} must be >= 0, got ${value}`);
  }
  if (value > MONEY_MAX) {
    throw new MoneyError(`${label} exceeds MONEY_MAX (${MONEY_MAX})`);
  }
}

/** Non-throwing predicate, for zod refinements and defensive branches. */
export function isMoney(value: unknown): value is Money {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MONEY_MAX
  );
}

/**
 * Parse a human-entered major-unit amount into minor units, WITHOUT float arithmetic.
 * The string is split on the decimal separator and the fraction is padded/truncated by
 * string manipulation, so '45000.10' with decimals=2 yields exactly 4500010.
 *
 * Accepts: '45000', '45 000', '45,000.50', '45000,50', 45000, ' -12.5 '.
 * Rejects: anything with more than `decimals` significant fraction digits (a silent
 *          truncation of a price the operator typed is a data-loss bug, not a convenience).
 *
 * @param major   the amount in major units, as typed
 * @param decimals restaurants.currency_decimals (0 for UZS, 2 for USD)
 */
export function toMinor(major: string | number, decimals: number): Money {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
    throw new MoneyError(`decimals must be an integer 0..4, got ${decimals}`);
  }

  // Normalise: strip spaces and NBSP group separators, unify the decimal mark to '.'.
  let raw = String(major).trim().replace(/[\s\u00A0\u202F]/g, '');
  if (raw === '') throw new MoneyError('empty amount');

  let sign = 1;
  if (raw.startsWith('-')) { sign = -1; raw = raw.slice(1); }
  else if (raw.startsWith('+')) { raw = raw.slice(1); }

  // '45,000.50' -> '45000.50' ; '45000,50' -> '45000.50'
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    raw = lastComma > lastDot
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (lastComma !== -1) {
    raw = raw.replace(',', '.');
  }

  if (!/^\d*(\.\d*)?$/.test(raw) || raw === '.') {
    throw new MoneyError(`not a decimal amount: ${String(major)}`);
  }

  const dot = raw.indexOf('.');
  const wholePart = dot === -1 ? raw : raw.slice(0, dot);
  const fractionPart = dot === -1 ? '' : raw.slice(dot + 1);

  if (fractionPart.replace(/0+$/, '').length > decimals) {
    throw new MoneyError(
      `amount ${String(major)} has more precision than this currency allows (${decimals} decimals)`,
    );
  }

  const digits = (wholePart === '' ? '0' : wholePart) + fractionPart.padEnd(decimals, '0').slice(0, decimals);
  const minor = Number(digits);
  if (!Number.isSafeInteger(minor)) {
    throw new MoneyError(`amount ${String(major)} is out of safe integer range`);
  }
  return sign * minor;
}

/**
 * Render minor units as a plain major-unit STRING with exactly `decimals` fraction digits,
 * no grouping and no currency. String, not number, so the value cannot re-enter float space.
 * Used for form inputs, CSV export and test assertions. For UI, use formatMoney.
 *
 * fromMinor(4500010, 2) === '45000.10'
 * fromMinor(45000, 0)   === '45000'
 */
export function fromMinor(amount: Money, decimals: number): string {
  if (!Number.isInteger(amount)) throw new MoneyError(`amount must be an integer, got ${amount}`);
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 4) {
    throw new MoneyError(`decimals must be an integer 0..4, got ${decimals}`);
  }
  const sign = amount < 0 ? '-' : '';
  const digits = Math.abs(amount).toString();
  if (decimals === 0) return sign + digits;
  const padded = digits.padStart(decimals + 1, '0');
  return `${sign}${padded.slice(0, -decimals)}.${padded.slice(-decimals)}`;
}

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * Currency labels per locale. Intl's own currency formatting is NOT used because
 * `Intl.NumberFormat('uz-UZ', { style: 'currency', currency: 'UZS' })` renders differently
 * across Node ICU builds and across browsers, and produces 'UZS 45 000' where an Uzbek diner
 * expects "45 000 so'm". Grouping and the decimal mark still come from Intl — those ARE stable
 * and locale-correct — but the currency token is ours.
 */
const CURRENCY_LABELS: Readonly<Record<string, Readonly<Record<Locale, string>>>> = {
  UZS: { uz: "so'm", ru: 'сўм', en: 'UZS' },
  USD: { uz: '$', ru: '$', en: '$' },
  EUR: { uz: '€', ru: '€', en: '€' },
  RUB: { uz: '₽', ru: '₽', en: '₽' },
};

/** Currencies whose symbol precedes the number — in English only. */
const PREFIX_IN_EN = new Set(['USD', 'EUR']);

const formatterCache = new Map<string, Intl.NumberFormat>();

function numberFormatter(locale: Locale, decimals: number): Intl.NumberFormat {
  const key = `${locale}|${decimals}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(BCP47[locale], {
    style: 'decimal',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: true,
  });
  formatterCache.set(key, created);
  return created;
}

/**
 * The single money renderer for the whole product.
 *
 * @param amount   minor units
 * @param currency ISO-4217 from restaurants.currency / orders.currency
 * @param decimals restaurants.currency_decimals / orders.currency_decimals
 * @param locale   the UI locale
 *
 * formatMoney(45000,   'UZS', 0, 'uz') === "45 000 so'm"
 * formatMoney(45000,   'UZS', 0, 'ru') === '45 000 сўм'
 * formatMoney(45000,   'UZS', 0, 'en') === '45,000 UZS'
 * formatMoney(1250,    'USD', 2, 'en') === '$12.50'
 * formatMoney(1250,    'USD', 2, 'ru') === '12,50 $'
 * formatMoney(1250,    'USD', 2, 'uz') === '12,50 $'
 */
export function formatMoney(
  amount: Money,
  currency: string,
  decimals: number,
  locale: Locale,
): string {
  if (!Number.isInteger(amount)) throw new MoneyError(`amount must be an integer, got ${amount}`);
  const major = amount / 10 ** decimals; // presentation only; never fed back into arithmetic
  const digits = numberFormatter(locale, decimals).format(major);

  const code = currency.toUpperCase();
  const label = CURRENCY_LABELS[code]?.[locale] ?? code;
  const prefix = locale === 'en' && PREFIX_IN_EN.has(code);

  // U+00A0 NO-BREAK SPACE: the amount and its currency must never wrap apart.
  return prefix ? `${label}${digits}` : `${digits}\u00A0${label}`;
}

/* ------------------------------------------------------------------ */
/* Arithmetic                                                          */
/* ------------------------------------------------------------------ */

/** Exact integer sum. Throws before it can silently exceed MONEY_MAX. */
export function sumMoney(amounts: readonly Money[]): Money {
  let total = 0;
  for (const amount of amounts) {
    assertMoney(amount, 'summand');
    total += amount;
    if (total > MONEY_MAX) throw new MoneyError('sum exceeds MONEY_MAX');
  }
  return total;
}

/** Exact integer scaling by a whole quantity. `qty` must be a non-negative integer. */
export function multiplyMoney(amount: Money, qty: number): Money {
  assertMoney(amount, 'amount');
  if (!Number.isInteger(qty) || qty < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got ${qty}`);
  }
  const product = amount * qty;
  if (!Number.isSafeInteger(product) || product > MONEY_MAX) {
    throw new MoneyError('product exceeds MONEY_MAX');
  }
  return product;
}

/**
 * Apply a basis-point rate with half-up rounding, in integers only.
 *
 * This mirrors the Postgres expression in staff_void_order_item() and public_place_order()
 * BYTE FOR BYTE:  (v_sub * v_bps + 5000) / 10000  with SQL integer division.
 * Any divergence here would let the cart preview disagree with the receipt.
 *
 * applyBps(45000, 1000) === 4500      // 10.00%
 * applyBps(45005, 1000) === 4501      // 4500.5 rounds half-up to 4501
 */
export function applyBps(base: Money, bps: number): Money {
  assertMoney(base, 'base');
  if (!Number.isInteger(bps) || bps < 0 || bps > BPS_DENOMINATOR) {
    throw new MoneyError(`bps must be an integer 0..${BPS_DENOMINATOR}, got ${bps}`);
  }
  if (bps === 0) return 0;
  const scaled = base * bps;
  if (!Number.isSafeInteger(scaled)) throw new MoneyError('bps product exceeds safe integer range');
  return Math.floor((scaled + BPS_DENOMINATOR / 2) / BPS_DENOMINATOR);
}

/** Signed difference, for "you saved X" and admin deltas. May be negative; not a stored Money. */
export function subtractMoney(a: Money, b: Money): number {
  assertMoney(a, 'minuend');
  assertMoney(b, 'subtrahend');
  return a - b;
}
