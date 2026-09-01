/**
 * src/components/ui/price-tag.tsx — PriceTag.
 * Source: docs/architecture/04-design-system.md §6.1, C-7.
 *
 * C-7: money is rendered ONLY here, and this component formats nothing itself — it
 * delegates to formatMoney() in src/lib/money.ts, which divides by 10**decimals at
 * the formatting boundary and asserts the amount is a safe integer first. No other
 * file may call Intl.NumberFormat with a currency style.
 *
 * `currency` and `decimals` come from restaurants.currency / currency_decimals.
 * Never hard-code 'UZS'; never hard-code 0.
 *
 * A price has no states: it is either known, or this component is not rendered
 * (a loading price is a <Skeleton>, an unknown one is an em dash in the caller).
 */

import type { Money } from '@/lib/money';
import { formatMoney } from '@/lib/money';
import type { Locale } from '@/types/i18n';
import { cn } from '@/lib/utils/cn';

export type PriceTagSize = 'sm' | 'md' | 'lg' | 'xl';
export type PriceTagTone = 'default' | 'muted' | 'accent';

const PRICE_SIZE: Record<PriceTagSize, string> = {
  sm: 'text-body-sm',
  md: 'text-price',
  lg: 'text-price-lg',
  xl: 'text-kds-md', // KDS
};

/** The struck compare-at price renders one step down from the live one. */
const COMPARE_SIZE: Record<PriceTagSize, string> = {
  sm: 'text-caption',
  md: 'text-body-sm',
  lg: 'text-price',
  xl: 'text-price-lg',
};

const PRICE_TONE: Record<PriceTagTone, string> = {
  default: 'text-text',
  muted: 'text-text-muted',
  accent: 'text-accent',
};

/**
 * The screen-reader prefix in front of a struck price, per §6.1. It is three fixed
 * words rather than a dictionary lookup so that PriceTag stays a dependency-free
 * Server Component usable on all three surfaces; pass `compareAtLabel` to override
 * it from the catalogue.
 */
const COMPARE_AT_PREFIX: Record<Locale, string> = {
  uz: 'avvalgi narx',
  ru: 'было',
  en: 'was',
};

export interface PriceTagProps {
  /** Integer minor units. */
  amount: Money;
  /** ISO 4217, from restaurants.currency. */
  currency: string;
  /** restaurants.currency_decimals — 0 for UZS. */
  decimals: number;
  locale: Locale;
  /** default 'md' */
  size?: PriceTagSize;
  /** menu_items.compare_at_price — renders struck-through before the live price. */
  compareAt?: Money;
  /** default 'default' */
  tone?: PriceTagTone;
  /** Overrides the localised "was" prefix read out before a struck price. */
  compareAtLabel?: string;
  className?: string;
}

export function PriceTag({
  amount,
  currency,
  decimals,
  locale,
  size = 'md',
  compareAt,
  tone = 'default',
  compareAtLabel,
  className,
}: PriceTagProps): React.JSX.Element {
  const showCompareAt = compareAt !== undefined && compareAt > amount;

  return (
    <span
      className={cn(
        'u-tnum inline-flex items-baseline gap-1.5 whitespace-nowrap',
        PRICE_SIZE[size],
        PRICE_TONE[tone],
        className,
      )}
    >
      {showCompareAt && (
        <s className={cn('line-through text-text-subtle', COMPARE_SIZE[size])}>
          <span className="sr-only">{compareAtLabel ?? COMPARE_AT_PREFIX[locale]} </span>
          {formatMoney(compareAt, currency, decimals, locale)}
        </s>
      )}
      <span>{formatMoney(amount, currency, decimals, locale)}</span>
    </span>
  );
}
