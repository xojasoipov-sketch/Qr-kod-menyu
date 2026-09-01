/**
 * src/components/ui/stat-card.tsx — StatCard.
 * Source: docs/architecture/04-design-system.md §6.4, §8.8, §8.11, T8; brief §11.
 *
 * The dashboard tile, and the product's answer to the generic three-card feature
 * row: an explicitly numeric object — big tabular figure, small uppercase label,
 * a real delta — never a circled icon over three words of filler (§8.8).
 *
 * Two rules this component enforces rather than trusts:
 *
 *  1. NO FAKE DATA (§8.11, brief §11). `value` is `string | null`: null renders an
 *     em dash, because "no orders yet" and "zero revenue" are different facts, and
 *     `loading` renders a Skeleton — never a placeholder number.
 *  2. NO UNLABELLED DEMO NUMBERS. `isDemo` and `demoLabel` are a union: you cannot
 *     turn the demo affordance on without supplying the localised word for it, and
 *     any dashboard reading a `restaurants.is_demo` tenant must turn it on.
 *
 * `value` arrives ALREADY formatted (Price/formatMoney for money) — this component
 * never formats a number and never guesses a currency.
 *
 * A Server Component.
 */

import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';

import { cn } from '@/lib/utils/cn';
import { Badge } from './badge';
import { Card } from './card';
import { Skeleton } from './skeleton';

export type StatCardTone = 'default' | 'accent';

/**
 * Direction is the movement (which arrow); tone is the judgement (which colour).
 * They are separate because a rising cancellation rate moves up and is bad — the
 * caller knows that, this component cannot, and it never assumes up means good.
 * Omitting `tone` renders the delta in muted text rather than inventing a verdict.
 */
export type StatCardDeltaTone = 'positive' | 'negative' | 'neutral';

export interface StatCardDelta {
  /** The magnitude. 0 renders without an arrow, in the neutral tone. */
  value: number;
  direction: 'up' | 'down';
  /** Localised, already formatted — `t('admin.dashboard.vsYesterday', { value: '+12%' })`. */
  label: string;
  /** default 'neutral' */
  tone?: StatCardDeltaTone;
}

interface StatCardBaseProps {
  /** Localised. Rendered above the value in --text-admin-xs uppercase. */
  label: string;
  /**
   * Already formatted by the caller. `null` means "we have no number", which is
   * rendered as an em dash — never as 0 (§8.11).
   */
  value: string | null;
  /** A lucide element, already sized (14/16/20px in admin, §5). Decorative. */
  icon?: ReactNode;
  delta?: StatCardDelta;
  /** default 'default' */
  tone?: StatCardTone;
  /** ≤ 24 points. A bare 1px path: no fill, no dots, no axes, no gradient (§6.4). */
  sparkline?: readonly number[];
  loading?: boolean;
  /** A link or a menu, rendered under the figure. */
  footer?: ReactNode;
  className?: string;
}

/** `isDemo` cannot be set without the localised badge word — that is the point. */
type StatCardDemoProps =
  | { isDemo?: false | undefined; demoLabel?: never }
  | { isDemo: true; demoLabel: string };

export type StatCardProps = StatCardBaseProps & StatCardDemoProps;

const DELTA_TONE: Record<StatCardDeltaTone, string> = {
  positive: 'text-success',
  negative: 'text-danger',
  neutral: 'text-text-muted',
};

export function StatCard(props: StatCardProps): React.JSX.Element {
  const {
    label,
    value,
    icon,
    delta,
    tone = 'default',
    sparkline,
    loading = false,
    footer,
    className,
    isDemo = false,
    demoLabel,
  } = props;

  const hasValue = value !== null && value !== '';

  return (
    <Card tone={tone === 'accent' ? 'accent' : 'default'} padding="md" className={cn('flex flex-col gap-3', className)}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-admin-xs uppercase text-text-subtle">{label}</span>
        <div className="flex shrink-0 items-center gap-2">
          {isDemo && demoLabel !== undefined && (
            <Badge tone="warning" variant="soft">
              {demoLabel}
            </Badge>
          )}
          {icon !== undefined && (
            <span aria-hidden="true" className="u-icon-align text-text-subtle">
              {icon}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-end justify-between gap-4">
        {loading ? (
          <Skeleton variant="title" className="h-7 w-28" />
        ) : (
          <p
            className={cn(
              'u-tnum text-admin-metric',
              hasValue ? 'text-text' : 'text-text-subtle',
            )}
          >
            {hasValue ? value : '—'}
          </p>
        )}

        {sparkline !== undefined && sparkline.length > 1 && !loading && (
          <Sparkline points={sparkline} />
        )}
      </div>

      {loading ? (
        <Skeleton variant="text" className="w-24" />
      ) : (
        delta !== undefined && <Delta delta={delta} />
      )}

      {footer}
    </Card>
  );
}

function Delta({ delta }: { delta: StatCardDelta }): React.JSX.Element {
  const flat = delta.value === 0;
  const tone: StatCardDeltaTone = flat ? 'neutral' : (delta.tone ?? 'neutral');
  const Arrow = delta.direction === 'up' ? ArrowUp : ArrowDown;

  return (
    <p className={cn('inline-flex items-center gap-1 text-admin-sm', DELTA_TONE[tone])}>
      {!flat && (
        <Arrow
          aria-hidden="true"
          focusable="false"
          strokeWidth={1.75}
          className="u-icon-align size-3.5"
        />
      )}
      <span className="u-tnum">{delta.label}</span>
    </p>
  );
}

/**
 * 24 points at most, drawn into a 100×28 viewBox and stretched to the slot.
 * `vector-effect: non-scaling-stroke` keeps the line 1px however far it stretches,
 * which is the only reason a stretched viewBox is acceptable here.
 * aria-hidden: the figure beside it already carries the fact (§9.4).
 */
function Sparkline({ points }: { points: readonly number[] }): React.JSX.Element | null {
  const path = sparklinePath(points);
  if (path === null) return null;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 100 28"
      preserveAspectRatio="none"
      className="h-7 w-20 shrink-0 text-accent"
    >
      <path
        d={path}
        fill="none"
        stroke="currentColor"
        strokeWidth={1}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const SPARKLINE_MAX_POINTS = 24;

/** Null when there is nothing meaningful to draw. A flat series draws a flat line. */
function sparklinePath(input: readonly number[]): string | null {
  const points = input.slice(-SPARKLINE_MAX_POINTS).filter((n) => Number.isFinite(n));
  if (points.length < 2) return null;

  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    if (point < min) min = point;
    if (point > max) max = point;
  }
  const span = max - min;
  const step = 100 / (points.length - 1);

  return points
    .map((point, index) => {
      const x = index * step;
      // 1px inset top and bottom so the stroke is never clipped by the viewBox.
      const y = span === 0 ? 14 : 27 - ((point - min) / span) * 26;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}
