'use client';

/**
 * src/components/ui/quantity-stepper.tsx — QuantityStepper.
 * Source: docs/architecture/04-design-system.md §6.1, §9.2, §9.5.
 *
 * The customer's primary touch control. Both buttons are real IconButtons, so each
 * carries a localised label and a hit area of at least --tap-min (48px on the
 * customer surface, 64px in a kitchen). The value sits in a polite atomic live
 * region so a screen reader hears "3" — not "plus button" — after every press.
 *
 * The track is one of the four elements allowed --radius-full (§8.2).
 *
 * NOTE on motion: §6.1 asks for a digit that ROLLS (out −8px / in +8px, 140ms).
 * That needs a keyframe, and globals.css is not this slice's file, so the value
 * uses the registered --animate-badge-bump until a `quantity-roll` keyframe lands.
 * Reduced motion collapses either to a single frame (§7.8).
 */

import { useCallback, useEffect, useRef } from 'react';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { IconButton, type IconButtonSize } from './button';

export type QuantityStepperSize = 'sm' | 'md' | 'lg';

/** Long-press: first repeat after this, then one every REPEAT_INTERVAL_MS. */
const REPEAT_DELAY_MS = 350;
const REPEAT_INTERVAL_MS = 90;

const BUTTON_SIZE: Record<QuantityStepperSize, IconButtonSize> = {
  sm: 'sm',
  md: 'md',
  lg: 'lg',
};

const ICON_SIZE: Record<QuantityStepperSize, string> = {
  sm: 'size-3.5',
  md: 'size-4',
  lg: 'size-5',
};

const VALUE_SIZE: Record<QuantityStepperSize, string> = {
  sm: 'min-w-6 text-body-sm',
  md: 'min-w-7 text-body',
  lg: 'min-w-8 text-price',
};

export interface QuantityStepperProps {
  value: number;
  onValueChange: (n: number) => void;
  /** default 1 */
  min?: number;
  /** default 99 — order_items.quantity allows 999, but 100 plov is a typo, not an order. */
  max?: number;
  /** default 'md' — 32 / 40 / 48 px buttons */
  size?: QuantityStepperSize;
  disabled?: boolean;
  /** An optimistic write is in flight: the value holds, the buttons go inert. */
  pending?: boolean;
  /** At `min`, turn the − button into a danger-toned Trash2. */
  removeAtMin?: boolean;
  /** REQUIRED, localised: "Quantity of Plov" — the group's accessible name. */
  label: string;
  /** REQUIRED, localised — e.g. t('a11y.decreaseQuantity'). */
  decreaseLabel: string;
  /** REQUIRED, localised — e.g. t('a11y.increaseQuantity'). */
  increaseLabel: string;
  /** Localised — e.g. t('a11y.removeNamedItem', { item }). Used when `removeAtMin` bites. */
  removeLabel?: string;
  /** Localised. Explains the cap in the + button's title once `max` is reached. */
  maxHint?: string;
  /** Called instead of onValueChange(min − 1) when `removeAtMin` bites. */
  onRemove?: () => void;
  className?: string;
}

export function QuantityStepper({
  value,
  onValueChange,
  min = 1,
  max = 99,
  size = 'md',
  disabled = false,
  pending = false,
  removeAtMin = false,
  label,
  decreaseLabel,
  increaseLabel,
  removeLabel,
  maxHint,
  onRemove,
  className,
}: QuantityStepperProps): React.JSX.Element {
  const inert = disabled || pending;
  const removeBites = removeAtMin && value <= min;
  const canDecrease = !inert && (value > min || removeBites);
  const canIncrease = !inert && value < max;

  // Every repeat tick reads the latest props rather than the closure it was
  // scheduled in, so holding − through a re-render still stops at `min`.
  const latest = useRef({ value, min, max, onValueChange });
  useEffect(() => {
    latest.current = { value, min, max, onValueChange };
  });

  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const pointerDriven = useRef(false);

  const stopRepeat = useCallback(() => {
    if (delayTimer.current !== null) {
      clearTimeout(delayTimer.current);
      delayTimer.current = null;
    }
    if (repeatTimer.current !== null) {
      clearInterval(repeatTimer.current);
      repeatTimer.current = null;
    }
  }, []);

  useEffect(() => stopRepeat, [stopRepeat]);

  const step = useCallback((delta: number) => {
    const current = latest.current;
    const next = Math.min(current.max, Math.max(current.min, current.value + delta));
    if (next !== current.value) current.onValueChange(next);
    return next !== current.value;
  }, []);

  const decrease = useCallback(() => {
    if (removeBites) {
      if (onRemove !== undefined) onRemove();
      else onValueChange(latest.current.min - 1);
      return;
    }
    step(-1);
  }, [removeBites, onRemove, onValueChange, step]);

  const startRepeat = useCallback(
    (delta: number) => {
      stopRepeat();
      delayTimer.current = setTimeout(() => {
        repeatTimer.current = setInterval(() => {
          if (!step(delta)) stopRepeat();
        }, REPEAT_INTERVAL_MS);
      }, REPEAT_DELAY_MS);
    },
    [step, stopRepeat],
  );

  /**
   * Pointer presses act on pointerdown so a long press can repeat; keyboard
   * activation arrives as a click with no preceding pointerdown, and is handled
   * there. The flag keeps a mouse press from counting twice.
   */
  const pressHandlers = (delta: number, act: () => void, enabled: boolean) => ({
    onPointerDown: () => {
      if (!enabled) return;
      pointerDriven.current = true;
      act();
      // Removing a line must never repeat.
      if (delta !== 0) startRepeat(delta);
    },
    onPointerUp: stopRepeat,
    onPointerLeave: stopRepeat,
    onPointerCancel: stopRepeat,
    onBlur: stopRepeat,
    onClick: () => {
      if (pointerDriven.current) {
        pointerDriven.current = false;
        return;
      }
      if (enabled) act();
    },
  });

  return (
    <div
      role="group"
      aria-label={label}
      aria-busy={pending || undefined}
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-border bg-surface-sunken p-1',
        pending && 'pointer-events-none opacity-60',
        className,
      )}
    >
      <IconButton
        size={BUTTON_SIZE[size]}
        variant={removeBites ? 'danger' : 'ghost'}
        label={removeBites ? (removeLabel ?? decreaseLabel) : decreaseLabel}
        disabled={!canDecrease}
        className="rounded-full"
        icon={
          removeBites ? (
            <Trash2 aria-hidden="true" focusable="false" strokeWidth={1.75} className={ICON_SIZE[size]} />
          ) : (
            <Minus aria-hidden="true" focusable="false" strokeWidth={1.75} className={ICON_SIZE[size]} />
          )
        }
        {...pressHandlers(removeBites ? 0 : -1, decrease, canDecrease)}
      />

      <span aria-live="polite" aria-atomic="true" className={cn('u-tnum text-center text-text', VALUE_SIZE[size])}>
        <span key={value} className="inline-block animate-badge-bump">
          {value}
        </span>
      </span>

      <IconButton
        size={BUTTON_SIZE[size]}
        variant="ghost"
        label={increaseLabel}
        disabled={!canIncrease}
        className="rounded-full"
        icon={<Plus aria-hidden="true" focusable="false" strokeWidth={1.75} className={ICON_SIZE[size]} />}
        {...(value >= max && maxHint !== undefined ? { title: maxHint } : {})}
        {...pressHandlers(1, () => void step(1), canIncrease)}
      />
    </div>
  );
}
