/**
 * src/components/waiter/table-grid.tsx — the floor at a glance.
 * Source: docs/architecture/04-design-system.md §8.10 ("colour is never the
 * only channel"); brief §10 ("Tablet-first, one-handed, used standing up").
 *
 * A compact status map of every active table in the branch, so a waiter can
 * see where to go next without opening any of the three columns. Each tile
 * carries an icon and a colour; a legend spells out what both mean in text
 * once, rather than repeating a word on every one of what can be forty tiles.
 * Priority when more than one applies: a table calling outranks a ready
 * order, which outranks one still cooking.
 */
import { BellRing, CookingPot, HandPlatter, type LucideIcon } from 'lucide-react'

import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'

export interface TableGridEntry {
  id: string;
  number: string;
  name: string | null;
}

export interface TableGridProps {
  tables: readonly TableGridEntry[];
  callingNumbers: ReadonlySet<string>;
  readyNumbers: ReadonlySet<string>;
  activeNumbers: ReadonlySet<string>;
}

type TileState = 'calling' | 'ready' | 'active' | 'clear';

function stateOf(
  number: string,
  calling: ReadonlySet<string>,
  ready: ReadonlySet<string>,
  active: ReadonlySet<string>,
): TileState {
  if (calling.has(number)) return 'calling';
  if (ready.has(number)) return 'ready';
  if (active.has(number)) return 'active';
  return 'clear';
}

const TILE_CLASS: Record<TileState, string> = {
  calling: 'border-danger-line bg-danger-soft text-danger animate-late-blink',
  ready: 'border-accent-line bg-accent-soft text-accent',
  active: 'border-info-line bg-info-soft text-info',
  clear: 'border-border bg-surface-sunken text-text-subtle',
};

const TILE_ICON: Record<TileState, LucideIcon | null> = {
  calling: BellRing,
  ready: HandPlatter,
  active: CookingPot,
  clear: null,
};

const TILE_ICON_COLOR: Record<TileState, string> = {
  calling: 'text-danger',
  ready: 'text-accent',
  active: 'text-info',
  clear: 'text-text-subtle',
};

export function TableGrid({
  tables,
  callingNumbers,
  readyNumbers,
  activeNumbers,
}: TableGridProps): React.JSX.Element {
  const t = useT();

  const legend: { state: Exclude<TileState, 'clear'>; label: string }[] = [
    { state: 'calling', label: t('waiter.tabCalls') },
    { state: 'ready', label: t('waiter.tabReady') },
    { state: 'active', label: t('waiter.tabActive') },
  ];

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {legend.map(({ state, label }) => {
          const Icon = TILE_ICON[state];
          return (
            <span key={state} className="inline-flex items-center gap-1.5 text-kds-sm text-text-muted">
              {Icon && (
                <Icon
                  aria-hidden="true"
                  focusable="false"
                  strokeWidth={2.25}
                  className={cn('u-icon-align size-4', TILE_ICON_COLOR[state])}
                />
              )}
              {label}
            </span>
          );
        })}
      </div>

      <ul className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
        {tables.map((table) => {
          const state = stateOf(table.number, callingNumbers, readyNumbers, activeNumbers);
          const Icon = TILE_ICON[state];
          const stateLabel =
            state === 'calling'
              ? t('waiter.tableCalling', { number: table.number })
              : state === 'clear'
                ? t('waiter.orderTable', { number: table.number })
                : `${t('waiter.orderTable', { number: table.number })} — ${state === 'ready' ? t('waiter.tabReady') : t('waiter.tabActive')}`;

          return (
            <li key={table.id}>
              <div
                role="img"
                aria-label={stateLabel}
                title={stateLabel}
                className={cn(
                  'flex flex-col items-center justify-center gap-1 rounded-control border px-2 py-2.5',
                  TILE_CLASS[state],
                )}
              >
                {Icon && <Icon aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-4" />}
                <span className="u-tnum text-kds-sm font-semibold">{table.number}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
