/**
 * src/components/ui/empty-state.tsx — EmptyState.
 * Source: docs/architecture/04-design-system.md §6.1, §8.6, §8.15; brief §32.
 *
 * The shape is fixed and deliberately plain: one 28px outlined lucide glyph in a
 * 56px --surface-sunken square, a title, one line of muted copy at
 * max-w-(--measure-narrow), and at most one primary action. No illustration, no
 * 3D blob, no emoji, no oversized icon (§8.15).
 *
 * A Server Component. It renders a real <button> only when the caller passes an
 * `onClick` — which only a client parent can do — and a real <a> otherwise, so
 * there is never a <div onClick> here (§8.12).
 *
 * Alignment: left in admin, centred only when the state fills a whole viewport
 * (§8.6). The default is therefore 'start'; pass align="center" for a full-page
 * empty cart or an empty menu.
 */

import type { ElementType, ReactNode } from 'react';
import Link from 'next/link';

import { cn } from '@/lib/utils/cn';

export type EmptyStateSize = 'sm' | 'md';
export type EmptyStateAlign = 'start' | 'center';
/** 'p' by default: an empty state must not invent a heading level (§9.4). */
export type EmptyStateTitleElement = 'h2' | 'h3' | 'h4' | 'p';

export interface EmptyStateAction {
  /** Localised. */
  label: string;
  /** Client parents only. Takes precedence over `href`. */
  onClick?: () => void;
  href?: string;
}

export interface EmptyStateSecondaryAction {
  /** Localised. */
  label: string;
  href: string;
}

export interface EmptyStateProps {
  /**
   * A lucide element, already sized and stroked by the caller (§5) —
   * `<Inbox className="size-7" strokeWidth={1.75} />` for 'md', `size-5` for 'sm'.
   * Never an emoji and never larger than 28px (§8.5, §8.15).
   */
  icon?: ReactNode;
  /** Localised. */
  title: string;
  /** Localised. One line — if it needs two, the copy is wrong. */
  description?: string;
  action?: EmptyStateAction;
  secondaryAction?: EmptyStateSecondaryAction;
  /** 'sm' inside a Card, a Drawer or a DataTable cell; 'md' for a page (default). */
  size?: EmptyStateSize;
  /** default 'start' */
  align?: EmptyStateAlign;
  /** default 'p' — pass a heading only when this state replaces a real section heading. */
  titleAs?: EmptyStateTitleElement;
  /** Rendered under the actions: a hint, a link list, a Badge. */
  children?: ReactNode;
  className?: string;
}

/**
 * The action is styled here rather than through `buttonClasses()`, deliberately:
 * button.tsx is a 'use client' module, and every export of a client module — a
 * plain string helper included — becomes a client reference that a Server
 * Component cannot call. These classes are the same tokens Button's `primary`
 * and `link` variants use; if Button's variants change, change them here too.
 */
const ACTION_BASE =
  'inline-flex select-none items-center justify-center gap-2 rounded-control font-medium ' +
  'whitespace-nowrap min-h-(--tap-min) ' +
  'transition-[color,background-color,filter,transform] duration-(--duration-fast) ' +
  'ease-standard active:scale-98';

const ACTION_PRIMARY =
  'bg-accent-strong text-accent-contrast hover:brightness-108 active:brightness-95';

const ACTION_LINK =
  'text-accent underline underline-offset-4 decoration-accent-line hover:decoration-accent';

const ACTION_SIZE: Record<EmptyStateSize, string> = {
  sm: 'h-8 px-3 text-body-sm',
  md: 'h-10 px-4 text-body',
};

const ROOT_SIZE: Record<EmptyStateSize, string> = {
  sm: 'gap-3 py-6',
  md: 'gap-4 py-12',
};

/** 40 / 56 px. The caller sizes the glyph itself — 20px in 'sm', 28px in 'md' (§5, §8.15). */
const ICON_BOX_SIZE: Record<EmptyStateSize, string> = {
  sm: 'size-10',
  md: 'size-14',
};

const TITLE_SIZE: Record<EmptyStateSize, string> = {
  sm: 'text-body admin:text-admin-h3',
  md: 'text-title admin:text-admin-h2',
};

const DESCRIPTION_SIZE: Record<EmptyStateSize, string> = {
  sm: 'text-body-sm admin:text-admin-sm',
  md: 'text-body-sm admin:text-admin-body',
};

export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  size = 'md',
  align = 'start',
  titleAs = 'p',
  children,
  className,
}: EmptyStateProps): React.JSX.Element {
  const Title = titleAs as ElementType;
  const centred = align === 'center';

  return (
    <div
      className={cn(
        'flex w-full flex-col',
        ROOT_SIZE[size],
        centred ? 'items-center text-center' : 'items-start text-start',
        className,
      )}
    >
      {icon !== undefined && (
        <span
          aria-hidden="true"
          className={cn(
            'inline-grid shrink-0 place-items-center rounded-card bg-surface-sunken text-text-subtle',
            ICON_BOX_SIZE[size],
          )}
        >
          {icon}
        </span>
      )}

      <div className={cn('flex flex-col gap-1.5', centred && 'items-center')}>
        <Title className={cn('text-text font-medium text-balance', TITLE_SIZE[size])}>{title}</Title>
        {description !== undefined && (
          <p
            className={cn(
              'max-w-(--measure-narrow) text-text-muted text-pretty',
              DESCRIPTION_SIZE[size],
            )}
          >
            {description}
          </p>
        )}
      </div>

      {(action !== undefined || secondaryAction !== undefined) && (
        <div className={cn('flex flex-wrap items-center gap-2', centred && 'justify-center')}>
          {action !== undefined && <EmptyStateActionControl action={action} size={size} />}
          {secondaryAction !== undefined && (
            <Link
              href={secondaryAction.href}
              className={cn(ACTION_BASE, ACTION_SIZE[size], ACTION_LINK, 'px-0')}
            >
              {secondaryAction.label}
            </Link>
          )}
        </div>
      )}

      {children}
    </div>
  );
}

/**
 * One action, never two primaries. `onClick` wins over `href` so a caller that
 * supplies both gets the interactive path rather than a navigation it did not mean.
 */
function EmptyStateActionControl({
  action,
  size,
}: {
  action: EmptyStateAction;
  size: EmptyStateSize;
}): React.JSX.Element | null {
  const className = cn(ACTION_BASE, ACTION_SIZE[size], ACTION_PRIMARY);

  if (action.onClick !== undefined) {
    return (
      <button type="button" onClick={action.onClick} className={className}>
        {action.label}
      </button>
    );
  }

  if (action.href !== undefined) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }

  return null;
}
