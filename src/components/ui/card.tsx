/**
 * src/components/ui/card.tsx — Card.
 * Source: docs/architecture/04-design-system.md §6.1, §8.7, §8.12.
 *
 * One component with a `padding` prop — not a six-part Card/CardHeader/CardTitle
 * ceremony (§8.7). A Card is a container: its *contents* carry the loading, empty
 * and error states, and `interactive` styles the container only — the real action
 * is a <Link> or <button> the caller puts inside (§8.12).
 */

import type { ComponentPropsWithRef, ElementType, ReactNode, Ref } from 'react';
import { cn } from '@/lib/utils/cn';

export type CardElement = 'div' | 'article' | 'section' | 'li';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type CardTone = 'default' | 'accent' | 'danger';

const CARD_PADDING: Record<CardPadding, string> = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

/** A tone tints the border and adds a 2px rule on the inline-start edge (§9.4: logical, not left). */
const CARD_TONE: Record<CardTone, string> = {
  default: 'border-border',
  accent: 'border-accent-line border-s-2 border-s-accent',
  danger: 'border-danger-line border-s-2 border-s-danger',
};

export interface CardProps extends Omit<ComponentPropsWithRef<'div'>, 'ref'> {
  /** default 'div' */
  as?: CardElement;
  /** default 'md' — 0 / 12 / 16 / 24 px */
  padding?: CardPadding;
  /**
   * Hover/active affordance for a card whose whole area leads somewhere. It does
   * NOT make the card clickable: the caller still puts a real <a>/<button> inside.
   */
  interactive?: boolean;
  /** default 'default' */
  tone?: CardTone;
  children?: ReactNode;
  ref?: Ref<HTMLElement>;
}

export function Card({
  as = 'div',
  padding = 'md',
  interactive = false,
  tone = 'default',
  className,
  children,
  ...rest
}: CardProps): React.JSX.Element {
  const Component = as as ElementType;

  return (
    <Component
      className={cn(
        // shadow-card resolves to --shadow-sm on light and to the inset hairline on
        // dark; the component does not know which and must not add a second layer (§8.3).
        'border bg-elevated rounded-card shadow-card',
        CARD_PADDING[padding],
        CARD_TONE[tone],
        interactive &&
          'transition-[border-color,translate] duration-(--duration-fast) ease-standard ' +
            'hover:border-border-strong hover:-translate-y-px active:translate-y-0',
        className,
      )}
      {...rest}
    >
      {children}
    </Component>
  );
}
