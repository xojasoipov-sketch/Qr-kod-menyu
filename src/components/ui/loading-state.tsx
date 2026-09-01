/**
 * src/components/ui/loading-state.tsx — LoadingState.
 * Source: docs/architecture/04-design-system.md §6.1 (Skeleton), §7.8, §9.5; brief §32.
 *
 * Two ways to say "not yet", and the choice is not cosmetic:
 *
 *   variant="skeleton"       we know the SHAPE of what is coming, so we draw it.
 *                            The placeholder occupies the real geometry, which is
 *                            the whole point: nothing moves when the data lands.
 *   variant="indeterminate"  we do not know the shape or the duration — a mutation
 *                            in flight, a signed URL being minted. A Spinner plus
 *                            the localised sentence, inside a reserved box.
 *
 * The region owns the announcement — `role="status"`, `aria-busy`, one .sr-only
 * sentence (§9.5). The Skeletons inside are `aria-hidden` and never nested.
 *
 * A Server Component: it holds no state and takes no handler.
 */

import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils/cn';
import { Skeleton } from './skeleton';
import { Spinner } from './spinner';

export type LoadingStateVariant = 'skeleton' | 'indeterminate';

/**
 * The shapes worth having. Each mirrors a real layout in the product, so the
 * placeholder and the content have the same measurements.
 */
export type LoadingStateShape =
  | 'text' // a paragraph
  | 'list' // media + two lines, repeated — menu list, orders list
  | 'grid' // cards in a responsive grid — menu admin, tables
  | 'rows' // flat rows inside a Card or a lane
  | 'stats' // a row of StatCard tiles
  | 'panel'; // one card: title, three lines

export type LoadingStateSize = 'sm' | 'md';

export interface LoadingStateProps {
  /**
   * REQUIRED, localised — `t('states.loading.menu')`. It is the announcement, so
   * "Loading…" is the weakest thing you can pass; say what is loading.
   */
  label: string;
  /** default 'skeleton' */
  variant?: LoadingStateVariant;
  /** skeleton only. default 'list' */
  shape?: LoadingStateShape;
  /** How many repeats the shape draws. Defaults per shape. */
  count?: number;
  /** indeterminate only: show `label` beside the spinner as well as to a screen reader. */
  showLabel?: boolean;
  /**
   * Reserves the height the real content will occupy. Pass it whenever the loader
   * is shorter than what replaces it — that is the whole no-layout-shift contract,
   * and the component cannot guess it.
   */
  minHeight?: string | number;
  /** default 'md' */
  size?: LoadingStateSize;
  className?: string;
}

const DEFAULT_COUNT: Record<LoadingStateShape, number> = {
  text: 3,
  list: 5,
  grid: 6,
  rows: 6,
  stats: 4,
  panel: 1,
};

const toLength = (value: string | number | undefined): string | undefined =>
  typeof value === 'number' ? `${value}px` : value;

const range = (count: number): readonly number[] =>
  Array.from({ length: Math.max(1, count) }, (_unused, index) => index);

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

function ListShape({ count, size }: { count: number; size: LoadingStateSize }): React.JSX.Element {
  return (
    <div className={cn('flex flex-col', size === 'sm' ? 'gap-3' : 'gap-4')}>
      {range(count).map((index) => (
        <div key={index} className="flex items-center gap-3">
          <Skeleton variant="block" className="size-16 shrink-0 rounded-media" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton variant="title" />
            <Skeleton variant="text" className="w-4/5" />
          </div>
          <Skeleton variant="text" className="w-14 shrink-0" />
        </div>
      ))}
    </div>
  );
}

function GridShape({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {range(count).map((index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton variant="card" />
          <Skeleton variant="title" />
          <Skeleton variant="text" className="w-2/3" />
        </div>
      ))}
    </div>
  );
}

function RowsShape({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {range(count).map((index) => (
        <Skeleton key={index} variant="row" />
      ))}
    </div>
  );
}

function StatsShape({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {range(count).map((index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-card border border-border bg-elevated p-4"
        >
          <Skeleton variant="text" className="w-24" />
          <Skeleton variant="title" className="w-32" />
          <Skeleton variant="text" className="w-20" />
        </div>
      ))}
    </div>
  );
}

function PanelShape({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-4">
      {range(count).map((index) => (
        <div
          key={index}
          className="flex flex-col gap-3 rounded-card border border-border bg-elevated p-4"
        >
          <Skeleton variant="title" />
          <Skeleton variant="text" lines={3} />
        </div>
      ))}
    </div>
  );
}

function TextShape({ count }: { count: number }): React.JSX.Element {
  return <Skeleton variant="text" lines={Math.max(1, count)} />;
}

/* ------------------------------------------------------------------ */
/* LoadingState                                                        */
/* ------------------------------------------------------------------ */

export function LoadingState({
  label,
  variant = 'skeleton',
  shape = 'list',
  count,
  showLabel = true,
  minHeight,
  size = 'md',
  className,
}: LoadingStateProps): React.JSX.Element {
  const repeats = count ?? DEFAULT_COUNT[shape];
  // The only dynamic measurement here; every other value is a token (C-4).
  const style: CSSProperties | undefined =
    minHeight === undefined ? undefined : { minHeight: toLength(minHeight) };

  return (
    <div
      role="status"
      aria-busy="true"
      style={style}
      className={cn(
        'w-full',
        variant === 'indeterminate' && 'flex flex-col items-center justify-center gap-3 py-10',
        className,
      )}
    >
      <span className="sr-only">{label}</span>

      {variant === 'indeterminate' ? (
        <>
          <Spinner size={size === 'sm' ? 'md' : 'lg'} className="text-text-subtle" />
          {showLabel && (
            <p
              aria-hidden="true"
              className="text-body-sm admin:text-admin-sm text-text-subtle text-center"
            >
              {label}
            </p>
          )}
        </>
      ) : (
        <LoadingShape shape={shape} count={repeats} size={size} />
      )}
    </div>
  );
}

function LoadingShape({
  shape,
  count,
  size,
}: {
  shape: LoadingStateShape;
  count: number;
  size: LoadingStateSize;
}): React.JSX.Element {
  switch (shape) {
    case 'text':
      return <TextShape count={count} />;
    case 'list':
      return <ListShape count={count} size={size} />;
    case 'grid':
      return <GridShape count={count} />;
    case 'rows':
      return <RowsShape count={count} />;
    case 'stats':
      return <StatsShape count={count} />;
    case 'panel':
      return <PanelShape count={count} />;
  }
}
