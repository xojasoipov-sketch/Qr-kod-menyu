'use client';

/**
 * src/components/ui/switch.tsx — Switch.
 * Source: docs/architecture/04-design-system.md §6.1.
 *
 * <button role="switch" aria-checked>, never a checkbox: the ARIA switch role is
 * what makes a screen reader say "on/off" rather than "checked".
 *
 * The track carries `success` when on. That is the one place a status colour is
 * correct on a control — this is the availability toggle, and on/off IS a status —
 * and it is paired with the thumb's position, so colour is never the only channel
 * (§8.10). The off track is --text-subtle rather than --border-strong so the
 * control's boundary clears 3:1 against the page in both themes (§9.1).
 */

import { useId } from 'react';
import { cn } from '@/lib/utils/cn';

export type SwitchSize = 'sm' | 'md';

/** 36×20 / 44×24 px. */
const TRACK_SIZE: Record<SwitchSize, string> = {
  sm: 'h-5 w-9',
  md: 'h-6 w-11',
};

const THUMB_SIZE: Record<SwitchSize, string> = {
  sm: 'size-4',
  md: 'size-5',
};

/** Travel = track width − 2× the 2px inset − thumb. */
const THUMB_TRAVEL: Record<SwitchSize, string> = {
  sm: 'translate-x-4 rtl:-translate-x-4',
  md: 'translate-x-5 rtl:-translate-x-5',
};

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** REQUIRED, localised. It is the control's accessible name even when hidden. */
  label: string;
  hideLabel?: boolean;
  description?: string;
  /** default 'md' */
  size?: SwitchSize;
  disabled?: boolean;
  /** An optimistic write is in flight: the thumb holds the new position, dimmed and ringed. */
  pending?: boolean;
  className?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  label,
  hideLabel = false,
  description,
  size = 'md',
  disabled = false,
  pending = false,
  className,
}: SwitchProps): React.JSX.Element {
  const descriptionId = useId();

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-busy={pending || undefined}
      aria-describedby={description !== undefined ? descriptionId : undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'inline-flex min-h-(--tap-min) items-center gap-3 rounded-control text-start',
        'disabled:cursor-not-allowed disabled:opacity-45',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex shrink-0 items-center rounded-full p-0.5',
          'transition-[background-color] duration-(--duration-fast) ease-standard',
          TRACK_SIZE[size],
          checked ? 'bg-success' : 'bg-text-subtle',
        )}
      >
        <span
          className={cn(
            'inline-block rounded-full bg-text-inverse',
            'transition-transform duration-(--duration-fast) ease-standard',
            THUMB_SIZE[size],
            checked && THUMB_TRAVEL[size],
            pending && 'opacity-60 ring-2 ring-accent-ring',
          )}
        />
      </span>

      <span className="flex min-w-0 flex-col gap-0.5">
        <span className={cn('text-body-sm font-medium text-text', hideLabel && 'sr-only')}>
          {label}
        </span>
        {description !== undefined && (
          <span id={descriptionId} className="text-caption text-text-subtle">
            {description}
          </span>
        )}
      </span>
    </button>
  );
}
