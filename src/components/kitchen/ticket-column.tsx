'use client'

/**
 * src/components/kitchen/ticket-column.tsx — one of the KDS's three lanes.
 *
 * A `<section aria-labelledby>` per brief §9 / 04-design-system.md §9.4 ("the
 * KDS lanes are three `<section aria-labelledby>` elements inside `<main>`").
 * The ticket list itself is a plain `<ul>`, never a live region (§9.5 hard
 * rule 1: a live list that reorders re-announces everything on every change —
 * the assertive announcement lives in `<NewOrderAlert>` instead). The count
 * in the header is `role="status"`, which screen readers coalesce on their
 * own rather than announcing every increment.
 */

import type { LucideIcon } from 'lucide-react'
import { CheckCheck, Clock, CookingPot } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { useT } from '@/lib/i18n/provider'
import type { StringPath } from '@/lib/i18n/types'
import type { ActorRole } from '@/lib/orders/state-machine'
import { cn } from '@/lib/utils/cn'
import type { OrderStatus } from '@/types/database'
import type { KitchenTicket } from '@/types/domain'

import { KitchenTicketCard } from './kitchen-ticket-card'

export type KdsLane = 'new' | 'preparing' | 'ready'

const LANE_TITLE_KEY: Record<KdsLane, StringPath> = {
  new: 'kitchen.columnNew',
  preparing: 'kitchen.columnPreparing',
  ready: 'kitchen.columnReady',
}

const LANE_EMPTY_KEY: Record<KdsLane, { title: StringPath; body: StringPath }> = {
  new: { title: 'kitchen.emptyNew.title', body: 'kitchen.emptyNew.body' },
  preparing: { title: 'kitchen.emptyPreparing.title', body: 'kitchen.emptyPreparing.body' },
  ready: { title: 'kitchen.emptyReady.title', body: 'kitchen.emptyReady.body' },
}

const LANE_ICON: Record<KdsLane, LucideIcon> = {
  new: Clock,
  preparing: CookingPot,
  ready: CheckCheck,
}

const LANE_EDGE: Record<KdsLane, string> = {
  new: 'border-t-lane-new',
  preparing: 'border-t-lane-preparing',
  ready: 'border-t-lane-ready',
}

export interface TicketColumnProps {
  lane: KdsLane
  tickets: readonly KitchenTicket[]
  actor: ActorRole
  now: number
  lateThresholdMinutes: number
  /** Ticket ids inside their 4 s arrival window (04 §7.3). */
  newIds: ReadonlySet<string>
  /** Ticket ids with a status write in flight. */
  pendingIds: ReadonlySet<string>
  onAdvance: (ticket: KitchenTicket, next: OrderStatus) => void
  onRequestCancel: (ticket: KitchenTicket) => void
}

export function TicketColumn({
  lane,
  tickets,
  actor,
  now,
  lateThresholdMinutes,
  newIds,
  pendingIds,
  onAdvance,
  onRequestCancel,
}: TicketColumnProps): React.JSX.Element {
  const t = useT()
  const Icon = LANE_ICON[lane]
  const headingId = `kds-lane-${lane}-heading`
  const empty = LANE_EMPTY_KEY[lane]

  return (
    <section aria-labelledby={headingId} className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
      <header
        className={cn(
          'flex items-center justify-between gap-2 border-t-4 bg-surface-sunken px-3 py-2.5',
          LANE_EDGE[lane],
        )}
      >
        <h2 id={headingId} className="text-kds-label text-text uppercase">
          {t(LANE_TITLE_KEY[lane])}
        </h2>
        <span role="status" className="u-tnum text-kds-md text-text-muted">
          {tickets.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {tickets.length === 0 ? (
          <EmptyState
            icon={<Icon aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-7" />}
            title={t(empty.title)}
            description={t(empty.body)}
            align="center"
            size="md"
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {tickets.map((ticket) => (
              <li key={ticket.orderId}>
                <KitchenTicketCard
                  ticket={ticket}
                  actor={actor}
                  now={now}
                  lateThresholdMinutes={lateThresholdMinutes}
                  isNew={newIds.has(ticket.orderId)}
                  pending={pendingIds.has(ticket.orderId)}
                  onAdvance={onAdvance}
                  onRequestCancel={onRequestCancel}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
