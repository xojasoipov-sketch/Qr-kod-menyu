/**
 * src/components/customer/spicy-meter.tsx — SpicyMeter.
 * Source: docs/architecture/04-design-system.md §6.2, §8.5, §9.4.
 *
 * Three `Flame` glyphs — never a chilli emoji (§8.5). Level 0 renders nothing at
 * all: an empty meter on a plain salad is visual noise. A pure presentational
 * component (safe from a Server Component) — the caller resolves the localised
 * label and aria text through `useT()`/`getServerTranslator()` and passes them
 * down, so this file never needs its own i18n import.
 */

import { Flame } from 'lucide-react'

import type { StringPath } from '@/lib/i18n/types'
import { cn } from '@/lib/utils/cn'

export type SpicyMeterSize = 'sm' | 'md'

/** Typed dot-path per level, so a caller resolves the label with `t(SPICY_LABEL_KEYS[level])` — no dynamic template, no cast. */
export const SPICY_LABEL_KEYS: Readonly<Record<0 | 1 | 2 | 3, StringPath>> = {
  0: 'labels.spicy.0',
  1: 'labels.spicy.1',
  2: 'labels.spicy.2',
  3: 'labels.spicy.3',
}

const GLYPH_SIZE: Record<SpicyMeterSize, string> = {
  sm: 'size-3',
  md: 'size-4',
}

export interface SpicyMeterProps {
  /** menu_items.spicy_level, CHECK 0..3. */
  level: 0 | 1 | 2 | 3
  /** default 'sm' — 12px glyphs on a card, 16px on the product detail. */
  size?: SpicyMeterSize
  /** Localised word — "Mild" / "Spicy" / "Very spicy" — rendered when `showLabel`. */
  label?: string
  /** default false on cards, true on the product detail. */
  showLabel?: boolean
  /** Localised, e.g. t('a11y.spicyLevelLabel', { level: label }) — required so a screen reader hears a sentence, not three flame glyphs. */
  ariaLabel: string
  className?: string
}

export function SpicyMeter({
  level,
  size = 'sm',
  label,
  showLabel = false,
  ariaLabel,
  className,
}: SpicyMeterProps): React.JSX.Element | null {
  if (level === 0) return null

  return (
    <span role="img" aria-label={ariaLabel} className={cn('inline-flex items-center gap-1', className)}>
      <span className="inline-flex items-center gap-0.5">
        {[1, 2, 3].map((step) => (
          <Flame
            key={step}
            aria-hidden="true"
            focusable="false"
            strokeWidth={1.5}
            className={cn(
              GLYPH_SIZE[size],
              step <= level ? 'text-danger' : 'text-text-disabled opacity-35',
            )}
          />
        ))}
      </span>
      {showLabel && label !== undefined && (
        <span className="text-caption text-text-muted">{label}</span>
      )}
    </span>
  )
}
