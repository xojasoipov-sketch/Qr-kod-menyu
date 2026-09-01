/**
 * src/components/ui/skeleton.tsx — Skeleton.
 * Source: docs/architecture/04-design-system.md §6.1, §7.8, §8.11.
 *
 * --surface-sunken under a WARM --accent-soft tint that breathes — never the
 * grey-blue default. Always aria-hidden: the *container* owns the announcement
 * (aria-busy on the region plus a .sr-only "Loading menu…", §9.5). Never nest a
 * Skeleton inside a Skeleton, and never let one stand in for real data (§8.11).
 *
 * Reduced motion: the global block in globals.css stops the breath and the static
 * warm tint remains, so the placeholder still reads as "not real content" (§7.8).
 *
 * NOTE: the spec's --animate-shimmer sweep needs a background-size > 100%, which is
 * only expressible as `bg-[size:…]` — an arbitrary background value banned by C-6.
 * When globals.css gains a `.u-shimmer` utility, this component swaps one class.
 */

import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils/cn';

export type SkeletonVariant = 'text' | 'title' | 'block' | 'circle' | 'card' | 'input' | 'row';

const SKELETON_VARIANT: Record<SkeletonVariant, string> = {
  text: 'h-3.5 w-full rounded-xs',
  title: 'h-5 w-1/2 rounded-xs',
  block: 'h-24 w-full rounded-card',
  circle: 'size-10 rounded-full',
  card: 'h-40 w-full rounded-card',
  input: 'h-10 w-full rounded-control',
  row: 'h-11 w-full rounded-card',
};

export interface SkeletonProps {
  /** default 'text' */
  variant?: SkeletonVariant;
  /** 'text' only. The last line renders short, the way a paragraph ends. */
  lines?: number;
  width?: string | number;
  height?: string | number;
  className?: string;
}

const toLength = (value: string | number | undefined): string | undefined =>
  typeof value === 'number' ? `${value}px` : value;

function Bar({
  variant,
  className,
  style,
}: {
  variant: SkeletonVariant;
  className?: string;
  style?: CSSProperties;
}): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cn(
        'relative block overflow-hidden bg-surface-sunken',
        SKELETON_VARIANT[variant],
        className,
      )}
    >
      <span className="absolute inset-0 animate-pulse bg-accent-soft opacity-40" />
    </span>
  );
}

export function Skeleton({
  variant = 'text',
  lines = 1,
  width,
  height,
  className,
}: SkeletonProps): React.JSX.Element {
  // Only ever a dynamic caller-supplied measurement; every other value is a token.
  const style: CSSProperties | undefined =
    width === undefined && height === undefined
      ? undefined
      : { width: toLength(width), height: toLength(height) };

  if (variant === 'text' && lines > 1) {
    // The closing line is short, the way a paragraph ends — so it keeps any caller
    // height but never the caller width, which the w-3/5 class is there to set.
    const lastStyle: CSSProperties | undefined =
      height === undefined ? undefined : { height: toLength(height) };

    return (
      <span aria-hidden="true" className={cn('flex w-full flex-col gap-2', className)}>
        {Array.from({ length: lines }, (_unused, index) => {
          const isLast = index === lines - 1;
          return (
            <Bar
              key={index}
              variant="text"
              style={isLast ? lastStyle : style}
              className={isLast ? 'w-3/5' : undefined}
            />
          );
        })}
      </span>
    );
  }

  return <Bar variant={variant} className={className} style={style} />;
}
