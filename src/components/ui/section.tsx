/**
 * src/components/ui/section.tsx — Section.
 * Source: docs/architecture/04-design-system.md §4.3 (T1/T2/T3/T9), §6.0, §9.4.
 *
 * A titled region of a page: heading, optional one-line description, an actions
 * slot, and the content. It exists so that "a heading with some stuff under it"
 * is written once, with the right heading level, the right type ramp per surface,
 * and no decorative chrome.
 *
 * Type: the heading is Playfair on the CUSTOMER surface only (T1 — serif for
 * names and customer section headings) and Inter everywhere else (T6 forbids it
 * in the kitchen, T7 allows it in admin only for the sidebar wordmark).
 *
 * Nesting: pass `level` so headings never skip a level (§9.4). The component does
 * not guess — an <h2> under an <h1> is the caller's knowledge, not this file's.
 *
 * A Server Component.
 */

import type { ElementType, ReactNode } from 'react';

import { cn } from '@/lib/utils/cn';

export type SectionLevel = 2 | 3 | 4;
export type SectionSpacing = 'sm' | 'md' | 'lg';

const HEADING_TAG: Record<SectionLevel, ElementType> = { 2: 'h2', 3: 'h3', 4: 'h4' };

/** Gap between the header block and the content. */
const SPACING: Record<SectionSpacing, string> = {
  sm: 'gap-2',
  md: 'gap-3',
  lg: 'gap-5',
};

const HEADING_SIZE: Record<SectionLevel, string> = {
  2: 'text-title customer:font-display admin:text-admin-h2 kds:text-kds-label kds:uppercase',
  3: 'text-body-lg customer:font-display admin:text-admin-h3 kds:text-kds-label kds:uppercase',
  4: 'text-body font-medium admin:text-admin-h3',
};

export interface SectionProps {
  /** Localised. Omit for an unlabelled grouping — then no heading is rendered. */
  title?: string;
  /** Localised, one line. Sits under the heading at --measure-prose. */
  description?: string;
  /** An eyebrow above the heading. Uppercase is only legal at --text-overline (T9). */
  overline?: string;
  /** Buttons or a link, at the inline-end of the heading row. */
  actions?: ReactNode;
  /** A Badge, a count, a StatusPill — beside the heading. */
  meta?: ReactNode;
  /** default 2. Set it so the document outline stays contiguous (§9.4). */
  level?: SectionLevel;
  /** default 'md' */
  spacing?: SectionSpacing;
  /** A hairline above the section. Use sparingly: rules are the loudest quiet thing. */
  divider?: boolean;
  /**
   * When set, the <section> is named by its heading (`aria-labelledby`), which is
   * what makes it a real landmark. Without an id it is a plain grouping element.
   */
  id?: string;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function Section({
  title,
  description,
  overline,
  actions,
  meta,
  level = 2,
  spacing = 'md',
  divider = false,
  id,
  children,
  className,
  contentClassName,
}: SectionProps): React.JSX.Element {
  const Heading = HEADING_TAG[level];
  const headingId = id !== undefined && title !== undefined ? `${id}-title` : undefined;
  const hasHeader =
    title !== undefined || description !== undefined || overline !== undefined || actions !== undefined;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'flex w-full flex-col',
        SPACING[spacing],
        divider && 'border-t border-border-subtle pt-5',
        className,
      )}
    >
      {hasHeader && (
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
            {overline !== undefined && (
              <span className="text-overline uppercase text-text-subtle">{overline}</span>
            )}
            {title !== undefined && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                <Heading id={headingId} className={cn('text-text', HEADING_SIZE[level])}>
                  {title}
                </Heading>
                {meta}
              </div>
            )}
            {description !== undefined && (
              <p className="max-w-(--measure-prose) text-body-sm admin:text-admin-sm text-text-muted text-pretty">
                {description}
              </p>
            )}
          </div>

          {actions !== undefined && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
          )}
        </div>
      )}

      <div className={cn('min-w-0', contentClassName)}>{children}</div>
    </section>
  );
}
