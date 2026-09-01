'use client';

/**
 * src/components/ui/textarea.tsx — Textarea.
 * Source: docs/architecture/04-design-system.md §6.1, §8.9.
 *
 * Input's prop shape plus `rows`, a `maxLength` counter and `autoGrow`. This one is
 * a Client Component (the inventory does not mark it [C], but a live counter and a
 * height that follows the content are state — there is no server-only way to have
 * either). Everything else matches Input: fixed structure, useId, no decorative
 * chrome, `loading` unsupported.
 *
 * The counter turns warning at 90% and danger at 100%, and only becomes a live
 * region past 90% — announcing every keystroke is worse than silence (§6.1).
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type TextareaSize = 'sm' | 'md' | 'lg';

const TEXTAREA_SIZE: Record<TextareaSize, string> = {
  sm: 'px-2.5 py-1.5 text-body-sm',
  md: 'px-3 py-2 text-body',
  lg: 'px-3.5 py-2.5 text-body-lg',
};

const TEXTAREA_BASE =
  'w-full min-w-0 rounded-control border border-border bg-surface-sunken ' +
  'text-text transition-[border-color] duration-(--duration-fast) ease-standard ' +
  'focus:border-accent ' +
  'disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-disabled ' +
  'read-only:border-border-subtle';

/** Past this share of maxLength the counter changes tone and starts announcing. */
const COUNTER_WARN_RATIO = 0.9;

export interface TextareaProps extends Omit<ComponentPropsWithRef<'textarea'>, 'size'> {
  /** REQUIRED, localised. Rendered visibly unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  iconStart?: ReactNode;
  /** default 'md' */
  size?: TextareaSize;
  /** default 3 */
  rows?: number;
  /** When set, a live "142 / 300" counter renders bottom-end. */
  maxLength?: number;
  /** Defaults to true on the customer surface, false elsewhere (resolved after mount). */
  autoGrow?: boolean;
  announceError?: boolean;
  /** Merged onto the outer wrapper; `className` goes on the <textarea> itself. */
  wrapperClassName?: string;
}

function lengthOf(value: ComponentPropsWithRef<'textarea'>['value']): number | undefined {
  if (value === undefined || value === null) return undefined;
  return Array.isArray(value) ? value.join('').length : String(value).length;
}

export function Textarea({
  label,
  hideLabel = false,
  hint,
  error,
  iconStart,
  size = 'md',
  rows = 3,
  maxLength,
  autoGrow,
  announceError = false,
  wrapperClassName,
  className,
  id,
  disabled,
  ref,
  value,
  defaultValue,
  onChange,
  ...rest
}: TextareaProps): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const counterId = `${fieldId}-counter`;
  const invalid = error !== undefined && error !== '';

  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const [uncontrolledLength, setUncontrolledLength] = useState<number>(
    () => lengthOf(defaultValue) ?? 0,
  );
  const [autoGrowResolved, setAutoGrowResolved] = useState<boolean>(autoGrow ?? false);

  const attachRef = useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node;
      if (typeof ref === 'function') ref(node);
      else if (ref !== null && ref !== undefined) ref.current = node;
    },
    [ref],
  );

  // The surface is only knowable in the DOM (it is written to <html data-surface>
  // by the root layout, C-1), so an explicit prop wins and the default resolves
  // after mount — never during render, which would desync hydration.
  useEffect(() => {
    if (autoGrow !== undefined) {
      setAutoGrowResolved(autoGrow);
      return;
    }
    setAutoGrowResolved(document.documentElement.getAttribute('data-surface') === 'customer');
  }, [autoGrow]);

  const grow = useCallback(() => {
    const node = innerRef.current;
    if (node === null || !autoGrowResolved) return;
    // The only inline styles in this component, and both are genuinely dynamic.
    node.style.height = 'auto';
    node.style.height = `${node.scrollHeight}px`;
  }, [autoGrowResolved]);

  useEffect(grow, [grow, value, uncontrolledLength]);

  const controlledLength = lengthOf(value);
  const count = controlledLength ?? uncontrolledLength;
  const ratio = maxLength !== undefined && maxLength > 0 ? count / maxLength : 0;
  const nearLimit = ratio >= COUNTER_WARN_RATIO;

  const describedBy =
    [
      hint !== undefined && !invalid ? hintId : null,
      invalid ? errorId : null,
      maxLength !== undefined ? counterId : null,
    ]
      .filter((entry): entry is string => entry !== null)
      .join(' ') || undefined;

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

      <div className="relative flex">
        {iconStart !== undefined && (
          <span
            aria-hidden="true"
            className="u-icon-align pointer-events-none absolute start-3 top-2.5 inline-flex text-text-subtle"
          >
            {iconStart}
          </span>
        )}

        <textarea
          id={fieldId}
          ref={attachRef}
          rows={rows}
          maxLength={maxLength}
          disabled={disabled}
          value={value}
          defaultValue={defaultValue}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            setUncontrolledLength(event.target.value.length);
            onChange?.(event);
          }}
          className={cn(
            TEXTAREA_BASE,
            TEXTAREA_SIZE[size],
            autoGrowResolved && 'resize-none overflow-hidden',
            iconStart !== undefined && 'ps-9',
            invalid && 'border-danger focus:border-danger',
            className,
          )}
          {...rest}
        />
      </div>

      <div className="flex items-start gap-3">
        <div className="min-w-0 grow">
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

        {maxLength !== undefined && (
          <p
            id={counterId}
            aria-live={nearLimit ? 'polite' : 'off'}
            className={cn(
              'u-tnum shrink-0 text-caption',
              ratio >= 1 ? 'text-danger' : nearLimit ? 'text-warning' : 'text-text-subtle',
            )}
          >
            {count} / {maxLength}
          </p>
        )}
      </div>
    </div>
  );
}
