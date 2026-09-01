/**
 * src/components/customer/dietary-tags.tsx — DietaryTags.
 * Source: docs/architecture/04-design-system.md §6.2.
 *
 * The ten-member enum splits into two rhetorical classes that must render
 * differently because they mean opposite things: CLAIMS (a reason to order —
 * success/outline) and WARNINGS (a reason not to — warning/soft, with an
 * AlertCircle glyph). Warnings always sort first and are never hidden by `max`
 * — an allergen must not be one tap away; only claims may be swallowed into the
 * overflow chip.
 *
 * A pure presentational component — the caller resolves each tag's localised
 * label through `useT()`/`getServerTranslator()` and passes the map down, so
 * this file stays safe inside a Server Component too.
 */

import { AlertCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { StringPath } from '@/lib/i18n/types'
import { cn } from '@/lib/utils/cn'
import type { DietaryTag } from '@/types/database'

/** Typed dot-path per tag, so a caller builds the `labels` prop with `t(DIETARY_LABEL_KEYS[tag])` — no dynamic template, no cast. */
export const DIETARY_LABEL_KEYS: Readonly<Record<DietaryTag, StringPath>> = {
  vegetarian: 'labels.dietary.vegetarian',
  vegan: 'labels.dietary.vegan',
  halal: 'labels.dietary.halal',
  gluten_free: 'labels.dietary.gluten_free',
  lactose_free: 'labels.dietary.lactose_free',
  nut_free: 'labels.dietary.nut_free',
  contains_nuts: 'labels.dietary.contains_nuts',
  contains_seafood: 'labels.dietary.contains_seafood',
  contains_pork: 'labels.dietary.contains_pork',
  contains_alcohol: 'labels.dietary.contains_alcohol',
}

const WARNING_TAGS: ReadonlySet<DietaryTag> = new Set<DietaryTag>([
  'contains_nuts',
  'contains_seafood',
  'contains_pork',
  'contains_alcohol',
])

export type DietaryTagsSize = 'sm' | 'md'

export interface DietaryTagsProps {
  tags: readonly DietaryTag[]
  /** Every tag's localised label, e.g. built from `t('labels.dietary.' + tag)`. */
  labels: Readonly<Record<DietaryTag, string>>
  /** default 3 on cards; omit (undefined) on the product detail for the full list. */
  max?: number
  /** default 'sm' */
  size?: DietaryTagsSize
  className?: string
}

export function DietaryTags({
  tags,
  labels,
  max,
  size = 'sm',
  className,
}: DietaryTagsProps): React.JSX.Element | null {
  if (tags.length === 0) return null

  const warnings = tags.filter((tag) => WARNING_TAGS.has(tag));
  const claims = tags.filter((tag) => !WARNING_TAGS.has(tag));

  const claimBudget = max === undefined ? claims.length : Math.max(0, max - warnings.length);
  const visibleClaims = claims.slice(0, claimBudget);
  const hiddenClaims = claims.slice(claimBudget);
  const badgeSize = size === 'md' ? 'md' : 'sm';

  return (
    <span className={cn('inline-flex flex-wrap items-center gap-1', className)}>
      {warnings.map((tag) => (
        <Badge key={tag} tone="warning" variant="soft" size={badgeSize}>
          <AlertCircle aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-3 shrink-0" />
          {labels[tag]}
        </Badge>
      ))}
      {visibleClaims.map((tag) => (
        <Badge key={tag} tone="success" variant="outline" size={badgeSize}>
          {labels[tag]}
        </Badge>
      ))}
      {hiddenClaims.length > 0 && (
        <span title={hiddenClaims.map((tag) => labels[tag]).join(', ')}>
          <Badge tone="neutral" variant="soft" size={badgeSize}>
            +{hiddenClaims.length}
          </Badge>
        </span>
      )}
    </span>
  )
}
