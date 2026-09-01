/**
 * src/components/ui/input.tsx — Input.
 * Source: docs/architecture/04-design-system.md §6.1, §8.9.
 *
 * A flat well: --surface-sunken, a 1px --border, and a label that never moves.
 * No floating label, no gradient focus glow, no inner bevel, no icon-in-a-circle
 * prefix (§8.9). The structure is fixed — <label for> → <input aria-describedby
 * aria-invalid> → hint/error <p id> — and the id comes from useId(), never from a
 * counter or Math.random(), both of which break hydration.
 *
 * A Server Component: useId() is available in the react-server build, and this
 * component holds no state. `loading` is deliberately unsupported — a loading
 * input is a <Skeleton variant="input">.
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useId } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type InputSize = 'sm' | 'md' | 'lg';

const FIELD_SIZE: Record<InputSize, string> = {
  sm: 'h-8 px-2.5 text-body-sm',
  md: 'h-10 px-3 text-body',
  lg: 'h-12 px-3.5 text-body-lg',
};

const FIELD_ICON_PAD: Record<InputSize, string> = {
  sm: 'ps-8',
  md: 'ps-9',
  lg: 'ps-10',
};

const FIELD_SUFFIX_PAD: Record<InputSize, string> = {
  sm: 'pe-12',
  md: 'pe-14',
  lg: 'pe-16',
};

const FIELD_BASE =
  'w-full min-w-0 min-h-(--tap-min) rounded-control border border-border bg-surface-sunken ' +
  'text-text transition-[border-color] duration-(--duration-fast) ease-standard ' +
  'focus:border-accent ' +
  'disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-disabled ' +
  'read-only:border-border-subtle';

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  /** REQUIRED, localised. Rendered visibly unless `hideLabel`. */
  label: string;
  /** Moves the label into .sr-only; it stays associated with the field. */
  hideLabel?: boolean;
  hint?: string;
  /** Presence switches the field to its error state. */
  error?: string;
  iconStart?: ReactNode;
  /** e.g. the currency code beside a price field. */
  suffix?: ReactNode;
  /** default 'md' */
  size?: InputSize;
  /**
   * Give the error message role="alert" — only for an error that appears after a
   * submit. An error announced on every keystroke is worse than silence (§6.1).
   */
  announceError?: boolean;
  /** Merged onto the field's outer wrapper; `className` goes on the <input> itself. */
  wrapperClassName?: string;
}

export function Input({
  label,
  hideLabel = false,
  hint,
  error,
  iconStart,
  suffix,
  size = 'md',
  announceError = false,
  wrapperClassName,
  className,
  id,
  disabled,
  ...rest
}: InputProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const invalid = error !== undefined && error !== '';

  return (
    <div className={cn('flex w-full flex-col gap-1.5', wrapperClassName)}>
      <label
        htmlFor={fieldId}
        className={cn(
          'text-caption font-medium text-text-muted',
          hideLabel && 'sr-only',
          disabled === true && 'text-text-disabled',
        )}
      >
        {label}
      </label>

      <div className="relative flex items-center">
        {iconStart !== undefined && (
          <span
            aria-hidden="true"
            className="u-icon-align pointer-events-none absolute start-3 inline-flex text-text-subtle"
          >
            {iconStart}
          </span>
        )}

        <input
          id={fieldId}
          disabled={disabled}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [hint !== undefined && !invalid ? hintId : null, invalid ? errorId : null]
              .filter((value): value is string => value !== null)
              .join(' ') || undefined
          }
          className={cn(
            FIELD_BASE,
            FIELD_SIZE[size],
            iconStart !== undefined && FIELD_ICON_PAD[size],
            suffix !== undefined && FIELD_SUFFIX_PAD[size],
            invalid && 'border-danger focus:border-danger',
            className,
          )}
          {...rest}
        />

        {suffix !== undefined && (
          <span className="u-tnum pointer-events-none absolute end-3 text-body-sm text-text-subtle">
            {suffix}
          </span>
        )}
      </div>

      {hint !== undefined && !invalid && (
        <p id={hintId} className="text-caption text-text-subtle">
          {hint}
        </p>
      )}

      {invalid && (
        <p
          id={errorId}
          role={announceError ? 'alert' : undefined}
          className="flex items-start gap-1.5 text-caption text-danger"
        >
          <CircleAlert
            aria-hidden="true"
            focusable="false"
            strokeWidth={1.75}
            className="u-icon-align mt-px size-3.5"
          />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
