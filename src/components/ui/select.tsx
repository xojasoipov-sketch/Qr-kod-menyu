/**
 * src/components/ui/select.tsx — Select.
 * Source: docs/architecture/04-design-system.md §6.1.
 *
 * A styled NATIVE <select>, not a custom listbox: on a phone the native wheel is
 * faster and more accessible than anything we would build, it is keyboard- and
 * screen-reader-correct for free, and it costs zero JS. The only styling is
 * appearance-none plus a ChevronDown in the padding box; `color-scheme` (§3.3)
 * makes the native popup render dark on dark.
 *
 * A searchable combobox is a different component (admin/ItemCombobox), explicitly
 * NOT a variant of this one.
 *
 * A Server Component — it renders no handler of its own and useId() is available
 * in the react-server build. A caller that needs onChange passes one and becomes
 * the client boundary itself.
 */

import type { ComponentPropsWithRef } from 'react';
import { useId } from 'react';
import { ChevronDown, CircleAlert } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type SelectSize = 'sm' | 'md' | 'lg';

export interface SelectOption<T extends string = string> {
  value: T;
  /** Already localised by the caller (C-11). */
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string>
  extends Omit<ComponentPropsWithRef<'select'>, 'size' | 'children'> {
  /** REQUIRED, localised. Rendered visibly unless `hideLabel`. */
  label: string;
  hideLabel?: boolean;
  options: readonly SelectOption<T>[];
  /** Rendered as a disabled, value-less first option. */
  placeholder?: string;
  hint?: string;
  error?: string;
  /** default 'md' */
  size?: SelectSize;
  announceError?: boolean;
  /** Merged onto the outer wrapper; `className` goes on the <select> itself. */
  wrapperClassName?: string;
}

const SELECT_SIZE: Record<SelectSize, string> = {
  sm: 'h-8 ps-2.5 pe-8 text-body-sm',
  md: 'h-10 ps-3 pe-9 text-body',
  lg: 'h-12 ps-3.5 pe-10 text-body-lg',
};

const SELECT_BASE =
  'w-full min-w-0 min-h-(--tap-min) appearance-none rounded-control border border-border ' +
  'bg-surface-sunken text-text transition-[border-color] duration-(--duration-fast) ease-standard ' +
  'focus:border-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-disabled';

export function Select<T extends string = string>({
  label,
  hideLabel = false,
  options,
  placeholder,
  hint,
  error,
  size = 'md',
  announceError = false,
  wrapperClassName,
  className,
  id,
  disabled,
  defaultValue,
  value,
  ...rest
}: SelectProps<T>): React.JSX.Element {
  const generatedId = useId();
  const fieldId = id ?? generatedId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const invalid = error !== undefined && error !== '';
  // An uncontrolled select with a placeholder must start on it, or the browser
  // silently selects the first real option and the field lies about being empty.
  const resolvedDefault =
    value === undefined && defaultValue === undefined && placeholder !== undefined
      ? ''
      : defaultValue;

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
        <select
          id={fieldId}
          disabled={disabled}
          value={value}
          defaultValue={resolvedDefault}
          aria-invalid={invalid || undefined}
          aria-describedby={
            [hint !== undefined && !invalid ? hintId : null, invalid ? errorId : null]
              .filter((entry): entry is string => entry !== null)
              .join(' ') || undefined
          }
          className={cn(
            SELECT_BASE,
            SELECT_SIZE[size],
            invalid && 'border-danger focus:border-danger',
            className,
          )}
          {...rest}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>

        <ChevronDown
          aria-hidden="true"
          focusable="false"
          strokeWidth={1.75}
          className="u-icon-align pointer-events-none absolute end-3 size-4 text-text-subtle"
        />
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
