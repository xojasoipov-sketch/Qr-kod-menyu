/**
 * src/components/ui/page-header.tsx — PageHeader.
 * Source: docs/architecture/04-design-system.md §6.4, §9.4, T7.
 *
 * The single horizontal rule above the content on an admin page — that restraint
 * is what keeps the surface calm, so this component draws it and nothing else
 * does. `title` becomes the page's one <h1> (§9.4), set in Inter 600 at
 * --text-admin-display: the serif appears exactly once per admin session and it
 * is the sidebar wordmark, not this (T7).
 *
 * A Server Component. `actions` and `tabs` are slots — whatever the caller puts
 * in them brings its own interactivity.
 */

import type { ReactNode } from 'react';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils/cn';

export interface Breadcrumb {
  /** Localised. */
  label: string;
  /** Omitted on the last crumb, which is the current page. */
  href?: string;
}

export interface PageHeaderProps {
  /** Localised. Becomes the <h1>; there is exactly one per page (§9.4). */
  title: string;
  /** Localised. One or two lines at most, held to --measure-prose. */
  description?: string;
  breadcrumbs?: readonly Breadcrumb[];
  /**
   * Localised `aria-label` for the breadcrumb <nav>. Supply it whenever
   * `breadcrumbs` is set — an unnamed navigation landmark is a landmark a screen
   * reader user cannot tell apart from the sidebar.
   */
  breadcrumbsLabel?: string;
  /** Buttons. Rendered at the inline-end of the title row. */
  actions?: ReactNode;
  /** A <Tabs>. Rendered flush with the bottom rule so its underline sits on it. */
  tabs?: ReactNode;
  /** A StatusPill, a timestamp, a Badge — beside the title, not under it. */
  meta?: ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  description,
  breadcrumbs,
  breadcrumbsLabel,
  actions,
  tabs,
  meta,
  className,
}: PageHeaderProps): React.JSX.Element {
  const hasBreadcrumbs = breadcrumbs !== undefined && breadcrumbs.length > 0;

  return (
    <header className={cn('flex flex-col gap-4 border-b border-border pb-4', className)}>
      {hasBreadcrumbs && (
        <nav aria-label={breadcrumbsLabel}>
          <ol className="flex flex-wrap items-center gap-1 text-admin-sm text-text-muted">
            {breadcrumbs.map((crumb, index) => {
              const isLast = index === breadcrumbs.length - 1;
              return (
                <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
                  {index > 0 && (
                    <ChevronRight
                      aria-hidden="true"
                      focusable="false"
                      strokeWidth={1.75}
                      className="u-icon-align size-3.5 text-text-subtle"
                    />
                  )}
                  {crumb.href !== undefined && !isLast ? (
                    <Link
                      href={crumb.href}
                      className={cn(
                        'rounded-control transition-colors duration-(--duration-fast)',
                        'ease-standard hover:text-text',
                      )}
                    >
                      {crumb.label}
                    </Link>
                  ) : (
                    <span aria-current={isLast ? 'page' : undefined} className="text-text">
                      {crumb.label}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <h1 className="text-admin-display text-text text-balance">{title}</h1>
            {meta}
          </div>
          {description !== undefined && (
            <p className="max-w-(--measure-prose) text-admin-body text-text-muted text-pretty">
              {description}
            </p>
          )}
        </div>

        {actions !== undefined && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        )}
      </div>

      {/* Pulled down over the container's own padding so the tab underline and the
          header rule are the same line, not two lines 16px apart. */}
      {tabs !== undefined && <div className="-mb-4">{tabs}</div>}
    </header>
  );
}
