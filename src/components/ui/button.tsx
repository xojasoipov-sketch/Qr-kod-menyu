'use client';

/**
 * src/components/ui/button.tsx — Button + IconButton.
 * Source: docs/architecture/04-design-system.md §6.1.
 *
 * React 19 passes `ref` as an ordinary prop, so nothing here is wrapped in
 * forwardRef (§6.0). Variants are plain records keyed by their union, so a missing
 * variant is a compile error and every class string is greppable (§6.0, C-14).
 */

import type { ComponentPropsWithRef, ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

/* ------------------------------------------------------------------ */
/* Class records                                                       */
/* ------------------------------------------------------------------ */

/**
 * `min-h-(--tap-min)` is the floor, not the height: the same size="md" renders
 * 40px in admin and 48px on the customer surface without a surface variant (§6.1).
 * `active:scale-98` is the §6.1 press; the global reduced-motion block collapses
 * its transition to 1ms without removing the state itself (§7.8).
 */
const BUTTON_BASE =
  'relative inline-flex select-none items-center justify-center gap-2 rounded-control ' +
  'font-medium whitespace-nowrap min-h-(--tap-min) ' +
  'transition-[color,background-color,border-color,filter,transform] ' +
  'duration-(--duration-fast) ease-standard active:scale-98 ' +
  'disabled:cursor-not-allowed disabled:opacity-50 disabled:active:scale-100 ' +
  'aria-busy:cursor-progress';

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-accent-strong text-accent-contrast not-disabled:hover:brightness-108 active:brightness-95',
  secondary: 'bg-elevated text-text border border-border not-disabled:hover:border-border-strong',
  ghost: 'bg-transparent text-text-muted not-disabled:hover:bg-surface-sunken not-disabled:hover:text-text',
  danger: 'bg-danger text-danger-contrast not-disabled:hover:brightness-108 active:brightness-95',
  // A link keeps its size's height (and therefore its tap target) but drops the
  // horizontal padding so it aligns optically with the copy around it.
  link: 'bg-transparent px-0 text-accent underline underline-offset-4 decoration-accent-line not-disabled:hover:decoration-accent',
};

const BUTTON_SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-10 px-4 text-body',
  lg: 'h-12 px-5 text-body-lg',
  xl: 'h-16 px-7 text-kds-md', // KDS only
};

export interface ButtonClassOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/**
 * The class string a `<Button>` would render.
 *
 * Use it to style a link — `<Link className={buttonClasses({ variant: 'primary' })}>`.
 * A `<Button>` is NEVER wrapped around a `<Link>` and there is no `asChild` (§6.1).
 */
export function buttonClasses({
  variant = 'secondary',
  size = 'md',
  fullWidth = false,
  className,
}: ButtonClassOptions = {}): string {
  return cn(
    BUTTON_BASE,
    BUTTON_SIZE[size],
    BUTTON_VARIANT[variant],
    fullWidth && 'w-full',
    className,
  );
}

/* ------------------------------------------------------------------ */
/* Button                                                              */
/* ------------------------------------------------------------------ */

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** default 'secondary' */
  variant?: ButtonVariant;
  /** default 'md' */
  size?: ButtonSize;
  /** Replaces the label with a pulse, locks the width, and disables the button. */
  loading?: boolean;
  /** Localised; announced while `loading`. */
  loadingLabel?: string;
  iconStart?: ReactNode;
  iconEnd?: ReactNode;
  fullWidth?: boolean;
  children: ReactNode;
}

/** Icons are decorative by default: aria-hidden, optically aligned, never shrunk (§5). */
function ButtonIcon({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <span aria-hidden="true" className="u-icon-align inline-flex shrink-0">
      {children}
    </span>
  );
}

/**
 * The three-dot loading pulse of §6.1. The label stays in the DOM as `invisible`
 * rather than being replaced, which is what keeps the button's measured width —
 * no ref, no layout read, no reflow of the row it sits in.
 */
function ButtonDots(): React.JSX.Element {
  return (
    <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center">
      <span className="flex animate-pulse items-center gap-1">
        <span className="size-1.5 rounded-full bg-current" />
        <span className="size-1.5 rounded-full bg-current" />
        <span className="size-1.5 rounded-full bg-current" />
      </span>
    </span>
  );
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  loadingLabel,
  iconStart,
  iconEnd,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'invisible')}>
        {iconStart !== undefined && <ButtonIcon>{iconStart}</ButtonIcon>}
        {children}
        {iconEnd !== undefined && <ButtonIcon>{iconEnd}</ButtonIcon>}
      </span>
      {loading && <ButtonDots />}
      {loading && loadingLabel !== undefined && <span className="sr-only">{loadingLabel}</span>}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* IconButton                                                          */
/* ------------------------------------------------------------------ */

export type IconButtonVariant = 'ghost' | 'solid' | 'danger';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const ICON_BUTTON_VARIANT: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent text-text-muted not-disabled:hover:bg-surface-sunken not-disabled:hover:text-text',
  solid: 'bg-accent-strong text-accent-contrast not-disabled:hover:brightness-108 active:brightness-95',
  danger: 'bg-danger-soft text-danger not-disabled:hover:brightness-108 active:brightness-95',
};

/** 32 / 40 / 48 px visual box. The hit area is widened separately, below. */
const ICON_BUTTON_SIZE: Record<IconButtonSize, string> = {
  sm: 'size-8',
  md: 'size-10',
  lg: 'size-12',
};

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  /** A lucide element, already sized by the caller (§5). */
  icon: ReactNode;
  /** REQUIRED, localised. Becomes both `aria-label` and `title` (§9.4). */
  label: string;
  /** default 'ghost' */
  variant?: IconButtonVariant;
  /** default 'md' */
  size?: IconButtonSize;
  loading?: boolean;
}

export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  loading = false,
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 select-none items-center justify-center rounded-control',
        'min-h-(--tap-min) min-w-(--tap-min)',
        // The visual box may be 32px in admin; the hit area never is. A transparent
        // ::before lifts every icon button to at least 44 × 44 px (§9.2).
        'before:absolute before:top-1/2 before:left-1/2 before:size-full before:min-h-11 before:min-w-11',
        'before:-translate-x-1/2 before:-translate-y-1/2 before:content-[""]',
        'transition-[color,background-color,filter,transform] duration-(--duration-fast) ease-standard',
        'active:scale-98 disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100',
        ICON_BUTTON_SIZE[size],
        ICON_BUTTON_VARIANT[variant],
        className,
      )}
      {...rest}
    >
      <span aria-hidden="true" className="u-icon-align inline-flex">
        {loading ? <LoaderCircle className="size-5 animate-spin" strokeWidth={2} /> : icon}
      </span>
    </button>
  );
}
