'use client';

/**
 * src/components/ui/data-table.tsx — DataTable.
 * Source: docs/architecture/04-design-system.md §6.4, §8.12, §9.2, §9.5, T8.
 *
 * A real <table> with its roles left intact — not a div grid, not a data-grid
 * dependency. Everything a screen reader needs (row/column relationships, the
 * caption, aria-sort) is native; everything the eye needs is a token.
 *
 * The three states live INSIDE the table, which is the part that is usually got
 * wrong: `loading` draws skeleton rows between the real <thead> and the real
 * column widths, so nothing jumps a pixel when the data lands; `empty` and
 * `error` span all columns in one cell rather than replacing the table and
 * dropping its header (brief §32).
 *
 * Zebra striping is off. Row separation is one --border-subtle bottom rule,
 * which is quieter and survives a theme switch.
 */

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react';

import { useT } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils/cn';
import { ErrorState } from './error-state';
import { Skeleton } from './skeleton';

export type DataTableAlign = 'start' | 'end';
export type DataTableDensity = 'comfortable' | 'compact';
export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<Row> {
  id: string;
  /** Localised. */
  header: string;
  /** 'end' for numerics — it also applies .u-tnum, because every column of digits is tabular (T8). */
  align?: DataTableAlign;
  /** A CSS length or percentage for this column's <th>, e.g. '160px' or '20%'. */
  width?: string;
  sortable?: boolean;
  cell: (row: Row) => ReactNode;
  /** At most one column. Pins it to the inline-start edge while the table scrolls sideways. */
  sticky?: 'start';
  /** Progressive disclosure instead of a horizontal scrollbar: hidden below this breakpoint. */
  hideBelow?: 'md' | 'lg';
}

export interface DataTableProps<Row> {
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  sort?: DataTableSort;
  onSortChange?: (sort: DataTableSort) => void;
  /**
   * A convenience, never the only path: every row must ALSO contain a real link or
   * button in its first cell, because a clickable <tr> is not focusable (§8.12).
   */
  onRowClick?: (row: Row) => void;
  selectable?: boolean;
  selectedIds?: ReadonlySet<string>;
  onSelectionChange?: (ids: ReadonlySet<string>) => void;
  /** Localised names for the selection checkboxes — an unlabelled checkbox is unusable. */
  selectionLabels?: {
    selectAll: string;
    selectRow: (row: Row) => string;
  };
  loading?: boolean;
  /** default 8 */
  skeletonRows?: number;
  /** An <EmptyState>. Spans every column in one cell. */
  empty?: ReactNode;
  error?: { message: string; onRetry: () => void };
  /**
   * default true. A sticky header sticks to its SCROLL CONTAINER, so it only does
   * something when `maxHeight` makes this table that container. Without it the page
   * scrolls and the header scrolls with it.
   */
  stickyHeader?: boolean;
  /** Makes the table body its own scroll container. Required for a working sticky header. */
  maxHeight?: string;
  /** Row height 44 / 36 px. */
  density?: DataTableDensity;
  /**
   * REQUIRED, localised, .sr-only. A screen reader user landing on an unnamed table
   * has no idea what it lists.
   */
  caption: string;
  /**
   * Localised sentence for the sort live region — "Sorted by Price, descending".
   * Without it the region announces the column name alone and `aria-sort` on the
   * header carries the direction.
   */
  sortAnnouncement?: (column: DataTableColumn<Row>, direction: SortDirection) => string;
  className?: string;
}

const DENSITY_ROW: Record<DataTableDensity, string> = {
  comfortable: 'h-11',
  compact: 'h-9',
};

const DENSITY_CELL: Record<DataTableDensity, string> = {
  comfortable: 'px-3 py-2',
  compact: 'px-2.5 py-1.5',
};

const HIDE_BELOW: Record<'md' | 'lg', string> = {
  md: 'hidden md:table-cell',
  lg: 'hidden lg:table-cell',
};

export function DataTable<Row>({
  columns,
  rows,
  getRowId,
  sort,
  onSortChange,
  onRowClick,
  selectable = false,
  selectedIds,
  onSelectionChange,
  selectionLabels,
  loading = false,
  skeletonRows = 8,
  empty,
  error,
  stickyHeader = true,
  maxHeight,
  density = 'comfortable',
  caption,
  sortAnnouncement,
  className,
}: DataTableProps<Row>): React.JSX.Element {
  const t = useT();
  const headerCheckboxId = useId();
  const headerCheckboxRef = useRef<HTMLInputElement | null>(null);
  const [announcement, setAnnouncement] = useState('');

  const selected = selectedIds ?? EMPTY_SELECTION;
  const totalColumns = columns.length + (selectable ? 1 : 0);
  const allIds = rows.map(getRowId);
  const selectedCount = allIds.filter((id) => selected.has(id)).length;
  const allSelected = allIds.length > 0 && selectedCount === allIds.length;
  const someSelected = selectedCount > 0 && !allSelected;

  // `indeterminate` is a DOM property, not an attribute — there is no other way.
  useEffect(() => {
    const node = headerCheckboxRef.current;
    if (node) node.indeterminate = someSelected;
  }, [someSelected]);

  const handleSort = useCallback(
    (column: DataTableColumn<Row>) => {
      if (onSortChange === undefined) return;
      const direction: SortDirection =
        sort?.columnId === column.id && sort.direction === 'asc' ? 'desc' : 'asc';
      onSortChange({ columnId: column.id, direction });
      setAnnouncement(
        sortAnnouncement !== undefined ? sortAnnouncement(column, direction) : column.header,
      );
    },
    [onSortChange, sort, sortAnnouncement],
  );

  const toggleAll = useCallback(() => {
    if (onSelectionChange === undefined) return;
    onSelectionChange(allSelected ? new Set<string>() : new Set(allIds));
  }, [allIds, allSelected, onSelectionChange]);

  const toggleRow = useCallback(
    (id: string) => {
      if (onSelectionChange === undefined) return;
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onSelectionChange(next);
    },
    [onSelectionChange, selected],
  );

  const showEmpty = !loading && error === undefined && rows.length === 0;

  return (
    <div className={cn('w-full', className)}>
      {/* Mounted empty and always present, so a sort never creates its own live
          region at announcement time (§9.5 rule 2). */}
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>

      <div
        aria-busy={loading || undefined}
        style={maxHeight === undefined ? undefined : { maxHeight }}
        className={cn(
          'relative w-full overflow-x-auto rounded-card border border-border bg-surface',
          maxHeight !== undefined && 'overflow-y-auto',
        )}
      >
        <table className="w-full border-collapse text-admin-body">
          <caption className="sr-only">{caption}</caption>

          <thead>
            <tr className={cn(DENSITY_ROW[density])}>
              {selectable && (
                <th
                  scope="col"
                  className={cn(
                    'w-11 border-b border-border bg-surface text-start',
                    DENSITY_CELL[density],
                    stickyHeader && 'sticky top-0 z-(--z-raised)',
                  )}
                >
                  <label
                    htmlFor={headerCheckboxId}
                    className="flex min-h-11 min-w-11 items-center justify-center"
                  >
                    <input
                      id={headerCheckboxId}
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="size-4 rounded-xs accent-accent-strong"
                    />
                    <span className="sr-only">{selectionLabels?.selectAll ?? caption}</span>
                  </label>
                </th>
              )}

              {columns.map((column) => {
                const activeSort = sort !== undefined && sort.columnId === column.id ? sort : undefined;
                const active = activeSort !== undefined;
                const ariaSort =
                  activeSort === undefined
                    ? undefined
                    : activeSort.direction === 'asc'
                      ? 'ascending'
                      : 'descending';

                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={ariaSort}
                    style={column.width === undefined ? undefined : { width: column.width }}
                    className={cn(
                      'border-b border-border bg-surface text-admin-xs uppercase text-text-subtle',
                      DENSITY_CELL[density],
                      column.align === 'end' ? 'text-end' : 'text-start',
                      column.hideBelow !== undefined && HIDE_BELOW[column.hideBelow],
                      stickyHeader && 'sticky top-0 z-(--z-raised)',
                      // The corner cell outranks both edges it belongs to.
                      column.sticky === 'start' && 'sticky start-0 z-(--z-sticky)',
                    )}
                  >
                    {column.sortable === true && onSortChange !== undefined ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column)}
                        className={cn(
                          'inline-flex min-h-11 items-center gap-1 rounded-control',
                          'uppercase transition-colors duration-(--duration-fast) ease-standard',
                          active ? 'text-text' : 'hover:text-text',
                          column.align === 'end' && 'flex-row-reverse',
                        )}
                      >
                        {column.header}
                        <SortGlyph active={active} direction={activeSort?.direction} />
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {error !== undefined && (
              <tr>
                <td colSpan={totalColumns} className="p-3">
                  <ErrorState
                    size="sm"
                    description={error.message}
                    onRetry={error.onRetry}
                    live
                  />
                </td>
              </tr>
            )}

            {error === undefined &&
              loading &&
              Array.from({ length: Math.max(1, skeletonRows) }, (_unused, index) => (
                <tr key={`skeleton-${index}`} className={cn(DENSITY_ROW[density])} aria-hidden="true">
                  {selectable && (
                    <td className={cn('border-b border-border-subtle', DENSITY_CELL[density])}>
                      <Skeleton variant="text" className="size-4" />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        'border-b border-border-subtle',
                        DENSITY_CELL[density],
                        column.hideBelow !== undefined && HIDE_BELOW[column.hideBelow],
                      )}
                    >
                      <Skeleton
                        variant="text"
                        className={column.align === 'end' ? 'ms-auto w-12' : 'w-2/3'}
                      />
                    </td>
                  ))}
                </tr>
              ))}

            {showEmpty && (
              <tr>
                <td colSpan={totalColumns} className="px-3 py-6">
                  {empty}
                </td>
              </tr>
            )}

            {error === undefined &&
              !loading &&
              rows.map((row) => {
                const id = getRowId(row);
                const isSelected = selected.has(id);

                return (
                  <tr
                    key={id}
                    data-selected={isSelected ? '' : undefined}
                    onClick={onRowClick === undefined ? undefined : () => onRowClick(row)}
                    className={cn(
                      DENSITY_ROW[density],
                      'transition-colors duration-(--duration-fast) ease-standard',
                      'hover:bg-surface-sunken',
                      isSelected && 'bg-accent-soft',
                      onRowClick !== undefined && 'cursor-pointer',
                    )}
                  >
                    {selectable && (
                      <td
                        className={cn('border-b border-border-subtle', DENSITY_CELL[density])}
                        onClick={(event) => event.stopPropagation()}
                      >
                        <label className="flex min-h-11 min-w-11 items-center justify-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleRow(id)}
                            className="size-4 rounded-xs accent-accent-strong"
                          />
                          <span className="sr-only">
                            {selectionLabels?.selectRow(row) ?? id}
                          </span>
                        </label>
                      </td>
                    )}

                    {columns.map((column) => (
                      <td
                        key={column.id}
                        className={cn(
                          'border-b border-border-subtle text-text',
                          DENSITY_CELL[density],
                          column.align === 'end' ? 'u-tnum text-end' : 'text-start',
                          column.hideBelow !== undefined && HIDE_BELOW[column.hideBelow],
                          column.sticky === 'start' && 'sticky start-0 bg-surface',
                        )}
                      >
                        {column.cell(row)}
                      </td>
                    ))}
                  </tr>
                );
              })}
          </tbody>
        </table>

        {/* An indeterminate wait still needs a name; the skeleton rows above are
            aria-hidden, so this is what a screen reader hears. */}
        {loading && <span className="sr-only">{t('states.loading.generic')}</span>}
      </div>
    </div>
  );
}

const EMPTY_SELECTION: ReadonlySet<string> = new Set<string>();

function SortGlyph({
  active,
  direction,
}: {
  active: boolean;
  direction?: SortDirection;
}): React.JSX.Element {
  const className = 'u-icon-align size-3.5';
  if (!active) {
    return (
      <ChevronsUpDown
        aria-hidden="true"
        focusable="false"
        strokeWidth={1.75}
        className={cn(className, 'text-text-disabled')}
      />
    );
  }
  return direction === 'asc' ? (
    <ChevronUp aria-hidden="true" focusable="false" strokeWidth={1.75} className={className} />
  ) : (
    <ChevronDown aria-hidden="true" focusable="false" strokeWidth={1.75} className={className} />
  );
}
