/**
 * src/components/ui/spinner.tsx — Spinner.
 * Source: docs/architecture/04-design-system.md §5 (LoaderCircle is the fixed glyph
 * for "in flight"), §6.1 (IconButton's loading state), §9.5.
 *
 * A determinate wait is a <Skeleton>; a Spinner is for an action whose duration is
 * unknown. It inherits currentColor, so it takes the tone of whatever contains it
 * and never introduces a colour of its own.
 *
 * Give it a `label` when it is the only signal that something is happening — that
 * turns it into a role="status" live region. Inside a control that already sets
 * aria-busy (Button, IconButton), leave `label` off so the state is announced once.
 */

import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type SpinnerSize = 'sm' | 'md' | 'lg' | 'xl';

const SPINNER_SIZE: Record<SpinnerSize, string> = {
  sm: 'size-4',
  md: 'size-5',
  lg: 'size-6',
  xl: 'size-10', // KDS
};

/** §5 stroke weights: the KDS reads at two metres. */
const SPINNER_STROKE: Record<SpinnerSize, number> = { sm: 1.75, md: 1.75, lg: 2, xl: 2.25 };

export interface SpinnerProps {
  /** default 'md' */
  size?: SpinnerSize;
  /** Localised. When present the spinner becomes a polite live region. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 'md', label, className }: SpinnerProps): React.JSX.Element {
  const labelled = label !== undefined && label !== '';

  return (
    <span
      role={labelled ? 'status' : undefined}
      aria-hidden={labelled ? undefined : true}
      className={cn('inline-flex items-center gap-2 text-current', className)}
    >
      <LoaderCircle
        aria-hidden="true"
        focusable="false"
        strokeWidth={SPINNER_STROKE[size]}
        className={cn('u-icon-align animate-spin', SPINNER_SIZE[size])}
      />
      {labelled && <span className="sr-only">{label}</span>}
    </span>
  );
}
