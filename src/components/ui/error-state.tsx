'use client';

/**
 * src/components/ui/error-state.tsx — ErrorState.
 * Source: docs/architecture/04-design-system.md §6.1, §9.5; brief §32.
 *
 * Every failure a guest or an operator can see arrives here, so the copy is
 * NEVER invented at the call site: `code` resolves to a localised sentence
 * through the catalogue. The map below is `Record<ErrorStateCode, …>`, which the
 * compiler checks for exhaustiveness — a new QrErrorCode is a build failure, not
 * a blank screen (§6.1).
 *
 * Announcement: `role="alert"` ONLY when this is the answer to something the user
 * just did (`live`). A route-level error boundary renders a plain <div>, because
 * the page title has already announced the failure and shouting it twice is worse
 * than not shouting it at all (§9.5).
 *
 * Requires <LocaleProvider> (it reads the catalogue through useT()). `app/global-error.tsx`
 * renders above the provider and must not use this component.
 */

import { AlertTriangle, RefreshCw } from 'lucide-react';

import { useT } from '@/lib/i18n/provider';
import type { MessageParams, StringPath } from '@/lib/i18n/types';
import type { QrErrorCode } from '@/lib/security/errors';
import { cn } from '@/lib/utils/cn';
import { Button } from './button';

/** The wire codes, plus the two client-only conditions that never reach the database. */
export type ErrorStateCode = QrErrorCode | 'network' | 'unknown';

export type ErrorStateSize = 'sm' | 'md';
export type ErrorStateAlign = 'start' | 'center';

interface ErrorCopyKeys {
  title: StringPath;
  body: StringPath;
}

const TITLE_GENERIC: StringPath = 'errors.generic.title';
const TITLE_NOT_FOUND: StringPath = 'errors.generic.notFoundTitle';
const TITLE_FORBIDDEN: StringPath = 'errors.generic.forbiddenTitle';
const TITLE_SERVER: StringPath = 'errors.generic.serverTitle';
const TITLE_OFFLINE: StringPath = 'errors.generic.offlineTitle';

/**
 * code → localised title/body pair. The body is always the *specific* wire message
 * (a guest is told "this dish just ran out", not "something went wrong"); the title
 * groups the code into one of five families so the heading stays short and calm.
 *
 * Exhaustive by construction: adding a member to QrErrorCode without adding a row
 * here fails to compile.
 */
const ERROR_COPY: Readonly<Record<ErrorStateCode, ErrorCopyKeys>> = {
  QR001_INVALID_QR_TOKEN: { title: TITLE_GENERIC, body: 'errors.QR001_INVALID_QR_TOKEN' },
  QR002_TABLE_INACTIVE: { title: TITLE_GENERIC, body: 'errors.QR002_TABLE_INACTIVE' },
  QR003_BRANCH_INACTIVE: { title: TITLE_GENERIC, body: 'errors.QR003_BRANCH_INACTIVE' },
  QR004_RESTAURANT_INACTIVE: { title: TITLE_GENERIC, body: 'errors.QR004_RESTAURANT_INACTIVE' },
  QR010_ORDER_RATE_LIMITED: { title: TITLE_GENERIC, body: 'errors.QR010_ORDER_RATE_LIMITED' },
  QR011_WAITER_CALL_COOLDOWN: { title: TITLE_GENERIC, body: 'errors.QR011_WAITER_CALL_COOLDOWN' },
  QR012_WAITER_CALL_ALREADY_OPEN: {
    title: TITLE_GENERIC,
    body: 'errors.QR012_WAITER_CALL_ALREADY_OPEN',
  },
  QR013_DUPLICATE_ORDER: { title: TITLE_GENERIC, body: 'errors.QR013_DUPLICATE_ORDER' },
  QR020_ITEM_UNAVAILABLE: { title: TITLE_GENERIC, body: 'errors.QR020_ITEM_UNAVAILABLE' },
  QR022_INVALID_OPTION: { title: TITLE_GENERIC, body: 'errors.QR022_INVALID_OPTION' },
  QR023_INVALID_PAYLOAD: { title: TITLE_GENERIC, body: 'errors.QR023_INVALID_PAYLOAD' },
  QR024_QUANTITY_OUT_OF_RANGE: { title: TITLE_GENERIC, body: 'errors.QR024_QUANTITY_OUT_OF_RANGE' },
  QR030_ORDER_NOT_FOUND: { title: TITLE_NOT_FOUND, body: 'errors.QR030_ORDER_NOT_FOUND' },
  QR030_NOT_FOUND: { title: TITLE_NOT_FOUND, body: 'errors.QR030_NOT_FOUND' },
  QR032_ORDER_EXPIRED: { title: TITLE_NOT_FOUND, body: 'errors.QR032_ORDER_EXPIRED' },
  QR040_INVALID_STATUS_TRANSITION: {
    title: TITLE_GENERIC,
    body: 'errors.QR040_INVALID_STATUS_TRANSITION',
  },
  QR041_INVALID_CALL_TRANSITION: {
    title: TITLE_GENERIC,
    body: 'errors.QR041_INVALID_CALL_TRANSITION',
  },
  QR042_CANCEL_REASON_REQUIRED: {
    title: TITLE_GENERIC,
    body: 'errors.QR042_CANCEL_REASON_REQUIRED',
  },
  QR043_ORDER_CLOSED: { title: TITLE_GENERIC, body: 'errors.QR043_ORDER_CLOSED' },
  QR050_FORBIDDEN: { title: TITLE_FORBIDDEN, body: 'errors.QR050_FORBIDDEN' },
  QR051_LAST_OWNER: { title: TITLE_FORBIDDEN, body: 'errors.QR051_LAST_OWNER' },
  QR052_FORBIDDEN_FIELD: { title: TITLE_FORBIDDEN, body: 'errors.QR052_FORBIDDEN_FIELD' },
  QR053_IMMUTABLE_COLUMN: { title: TITLE_FORBIDDEN, body: 'errors.QR053_IMMUTABLE_COLUMN' },
  QR054_COLUMN_NOT_ALLOWED: { title: TITLE_FORBIDDEN, body: 'errors.QR054_COLUMN_NOT_ALLOWED' },
  QR055_PRIVILEGE_ESCALATION: { title: TITLE_FORBIDDEN, body: 'errors.QR055_PRIVILEGE_ESCALATION' },
  QR056_SELF_MODIFICATION: { title: TITLE_FORBIDDEN, body: 'errors.QR056_SELF_MODIFICATION' },
  QR999_INTERNAL: { title: TITLE_SERVER, body: 'errors.QR999_INTERNAL' },
  network: { title: TITLE_OFFLINE, body: 'errors.app.NETWORK' },
  unknown: { title: TITLE_GENERIC, body: 'errors.app.UNKNOWN' },
};

export interface ErrorStateProps {
  /** Resolves title and body from the catalogue. Overridden by `title` / `description`. */
  code?: ErrorStateCode;
  /** Localised. Overrides the code-derived title. */
  title?: string;
  /** Localised. Overrides the code-derived body. */
  description?: string;
  /** Placeholders for the code's message, e.g. `{ seconds: 20 }`, `{ item: 'Plov' }`. */
  params?: MessageParams;
  /** Present → a "Try again" Button is rendered. */
  onRetry?: () => void;
  /** Localised; defaults to `common.retry`. */
  retryLabel?: string;
  /** Customer surface: localised "Ask your waiter for help". */
  supportHint?: string;
  /**
   * The technical truth — a stack, a Postgres detail, a digest. Collapsed by
   * default, never shown to a guest unless they open it, never the primary copy.
   */
  detail?: string;
  /** Localised <summary> label for `detail`; defaults to `common.showMore`. */
  detailLabel?: string;
  /** Rendered as `errors.generic.traceLabel` so a guest can quote it to support. */
  traceId?: string;
  /** 'sm' inline inside a Card, a lane or a DataTable row; 'md' for a page (default). */
  size?: ErrorStateSize;
  /** default 'start'; 'center' only when the state fills the viewport (§8.6). */
  align?: ErrorStateAlign;
  /**
   * true → role="alert": this error is the answer to something the user just did.
   * false (default) → a plain container, for the first render of an error route (§9.5).
   */
  live?: boolean;
  className?: string;
}

const ROOT_SIZE: Record<ErrorStateSize, string> = {
  sm: 'gap-2.5 p-3',
  md: 'gap-3 p-5',
};

const ICON_SIZE: Record<ErrorStateSize, string> = {
  sm: 'size-4',
  md: 'size-6',
};

const TITLE_SIZE: Record<ErrorStateSize, string> = {
  sm: 'text-body-sm admin:text-admin-h3',
  md: 'text-title admin:text-admin-h2',
};

const BODY_SIZE: Record<ErrorStateSize, string> = {
  sm: 'text-caption admin:text-admin-sm',
  md: 'text-body-sm admin:text-admin-body',
};

export function ErrorState({
  code,
  title,
  description,
  params,
  onRetry,
  retryLabel,
  supportHint,
  detail,
  detailLabel,
  traceId,
  size = 'md',
  align = 'start',
  live = false,
  className,
}: ErrorStateProps): React.JSX.Element {
  const t = useT();
  const copy = ERROR_COPY[code ?? 'unknown'];
  const resolvedTitle = title ?? t(copy.title);
  const resolvedDescription = description ?? t(copy.body, params);
  const centred = align === 'center';

  return (
    <div
      role={live ? 'alert' : undefined}
      className={cn(
        // One border, one tint, no shadow: an error is not an elevated object (§8.3).
        'flex w-full flex-col rounded-card border border-danger-line bg-danger-soft',
        ROOT_SIZE[size],
        centred ? 'items-center text-center' : 'items-start text-start',
        className,
      )}
    >
      <div className={cn('flex w-full gap-3', centred && 'flex-col items-center gap-2')}>
        <AlertTriangle
          aria-hidden="true"
          focusable="false"
          strokeWidth={1.75}
          className={cn('u-icon-align shrink-0 text-danger', ICON_SIZE[size])}
        />

        <div className={cn('flex min-w-0 flex-col gap-1', centred && 'items-center')}>
          <p className={cn('font-medium text-text text-balance', TITLE_SIZE[size])}>
            {resolvedTitle}
          </p>
          <p className={cn('max-w-(--measure-narrow) text-text-muted text-pretty', BODY_SIZE[size])}>
            {resolvedDescription}
          </p>
          {supportHint !== undefined && (
            <p className={cn('text-text-subtle', BODY_SIZE[size])}>{supportHint}</p>
          )}
        </div>
      </div>

      {(onRetry !== undefined || traceId !== undefined) && (
        <div
          className={cn(
            'flex w-full flex-wrap items-center gap-x-3 gap-y-2',
            centred ? 'justify-center' : 'justify-start',
          )}
        >
          {onRetry !== undefined && (
            <Button
              variant="secondary"
              size={size === 'sm' ? 'sm' : 'md'}
              onClick={onRetry}
              iconStart={<RefreshCw className="size-4" strokeWidth={1.75} />}
            >
              {retryLabel ?? t('common.retry')}
            </Button>
          )}
          {traceId !== undefined && (
            <span className="u-tnum font-mono text-admin-mono text-text-subtle">
              {t('errors.generic.traceLabel', { traceId })}
            </span>
          )}
        </div>
      )}

      {detail !== undefined && detail !== '' && (
        // <details> and not a useState toggle: it is keyboard-operable, findable by
        // in-page search when open, and it animates nothing (§7.8).
        <details className="w-full text-start">
          <summary
            className={cn(
              'inline-flex cursor-pointer list-none items-center rounded-control',
              'min-h-(--tap-min) admin:min-h-11 text-caption text-text-subtle',
              'transition-colors duration-(--duration-fast) ease-standard hover:text-text',
            )}
          >
            {detailLabel ?? t('common.showMore')}
          </summary>
          <pre
            className={cn(
              'mt-1 max-h-48 overflow-auto rounded-card bg-surface-sunken p-3',
              'font-mono text-admin-mono whitespace-pre-wrap text-text-muted',
            )}
          >
            {detail}
          </pre>
        </details>
      )}
    </div>
  );
}
