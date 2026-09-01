'use client'

/**
 * src/components/kitchen/kitchen-ticket-card.tsx — the single most important
 * component on this surface (04-design-system.md §6.3).
 *
 * Read at two metres by someone holding a pan: huge type, high contrast,
 * colour carries status and lateness and NOTHING else carries it alone
 * (§8.10) — the `late` band is colour AND the `AlarmClock` glyph AND the
 * blinking edge bar AND the red timer, so any one of them removed the state
 * is still legible. No photography (§6.3): the image column is dead space on
 * a tablet a cook glances at from across the pass.
 *
 * Actions render from `nextStatuses(status, actor)` — never a hand-rolled
 * status → button map — so a button the database would reject is never
 * drawn. For a plain KITCHEN account that is exactly one forward button per
 * ticket; a MANAGER/RESTAURANT_OWNER working the board also gets the ability
 * to cancel, which is why the cancel affordance exists at all here.
 */

import { AlarmClock, Flame, MessageSquareText, Package } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LOCALE_FALLBACK_ORDER } from '@/lib/i18n/config'
import { useLocale, useT } from '@/lib/i18n/provider'
import type { StringPath } from '@/lib/i18n/types'
import { elapsedSeconds, latenessLevel, type LatenessLevel, type Timed } from '@/lib/orders/lateness'
import { nextStatuses, type ActorRole } from '@/lib/orders/state-machine'
import { cn } from '@/lib/utils/cn'
import type { OrderStatus } from '@/types/database'
import type { KitchenTicket } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'

import { ElapsedTimer } from './elapsed-timer'

/** Same fallback-chain convention every customer component uses for I18nText. */
function pickText(text: I18nText, locale: Locale): string {
  const own = text[locale]
  if (own) return own
  for (const fallback of LOCALE_FALLBACK_ORDER) {
    const value = text[fallback]
    if (value) return value
  }
  return ''
}

type Lane = 'new' | 'preparing' | 'ready'

function laneOf(status: OrderStatus): Lane {
  if (status === 'preparing') return 'preparing'
  if (status === 'ready') return 'ready'
  return 'new'
}

const LANE_EDGE: Record<Lane, string> = {
  new: 'bg-lane-new',
  preparing: 'bg-lane-preparing',
  ready: 'bg-lane-ready',
}

const ADVANCE_LABEL_KEY: Partial<Record<OrderStatus, StringPath>> = {
  confirmed: 'kitchen.accept',
  preparing: 'kitchen.startPreparing',
  ready: 'kitchen.markReady',
}

export interface KitchenTicketCardProps {
  ticket: KitchenTicket
  /** The signed-in staff member's role, exactly as the server derives it. */
  actor: ActorRole
  /** Shared 1 Hz clock from `<KdsBoard>` — never this card's own interval. */
  now: number
  lateThresholdMinutes: number
  /** True for 4 s after arrival — drives the pulse (04 §7.3). */
  isNew: boolean
  /** True while this ticket's status write is in flight. */
  pending: boolean
  onAdvance: (ticket: KitchenTicket, next: OrderStatus) => void
  onRequestCancel: (ticket: KitchenTicket) => void
}

export function KitchenTicketCard({
  ticket,
  actor,
  now,
  lateThresholdMinutes,
  isNew,
  pending,
  onAdvance,
  onRequestCancel,
}: KitchenTicketCardProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()

  const timed: Timed = {
    created_at: ticket.placedAt,
    confirmed_at: ticket.confirmedAt,
    preparation_minutes: ticket.estimatedPrepMinutes,
    status: ticket.status,
  }
  const nowDate = new Date(now)
  const ageSeconds = elapsedSeconds(timed, nowDate)
  const level: LatenessLevel = latenessLevel(timed, lateThresholdMinutes, nowDate)

  const edgeToken = level === 'late' ? 'bg-lane-late' : LANE_EDGE[laneOf(ticket.status)]

  const nexts = nextStatuses(ticket.status, actor)
  const forward = nexts.find((status) => status !== 'cancelled') ?? null
  const canCancel = nexts.includes('cancelled')
  const advanceLabelKey = forward ? ADVANCE_LABEL_KEY[forward] : undefined

  return (
    <article
      aria-busy={pending || undefined}
      className={cn(
        'relative isolate flex flex-col gap-3 overflow-hidden rounded-card border bg-elevated p-4',
        level === 'late' ? 'border-danger-line' : 'border-border',
        isNew && 'animate-(--animate-pulse-ring)',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-0 start-0 w-1.5',
          edgeToken,
          level === 'late' ? 'animate-(--animate-late-blink)' : isNew && 'animate-pulse',
        )}
      />

      <header className="flex items-start justify-between gap-4 ps-2">
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-kds-label text-text-subtle uppercase">
            {t('kitchen.placedAgo', { minutes: Math.max(0, Math.floor(ageSeconds / 60)) })}
          </span>
          <span className="u-tnum text-kds-xl text-text">{ticket.orderNumber}</span>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1 text-end">
          <span className="text-kds-label text-text-subtle uppercase">
            {ticket.tableNumber
              ? t('kitchen.ticketTable', { number: ticket.tableNumber })
              : t('kitchen.ticketTakeaway')}
          </span>
          {ticket.tableNumber ? (
            <span className="u-tnum text-kds-hero text-text">{ticket.tableNumber}</span>
          ) : (
            <Package aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-10 text-text" />
          )}
        </div>
      </header>

      <div className="flex items-center justify-between gap-3 ps-2">
        <ElapsedTimer ageSeconds={ageSeconds} level={level} />
        {level === 'late' && (
          <Badge tone="danger" variant="solid" size="md" className="gap-1">
            <AlarmClock aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-3.5" />
            {t('kitchen.lateBadge')}
          </Badge>
        )}
      </div>

      <ul className="flex flex-col gap-3 ps-2">
        {ticket.lines.map((line) => (
          <li key={line.id} className="flex items-start gap-3">
            <span className="u-tnum flex size-11 shrink-0 items-center justify-center rounded-control bg-surface-sunken text-kds-md text-text">
              {line.quantity}×
            </span>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="flex flex-wrap items-center gap-2 text-kds-lg text-text">
                {pickText(line.name, locale)}
                {line.spicyLevel > 0 && (
                  <span className="inline-flex items-center gap-0.5 text-danger">
                    {Array.from({ length: Math.min(line.spicyLevel, 3) }, (_unused, index) => (
                      <Flame
                        key={index}
                        aria-hidden="true"
                        focusable="false"
                        strokeWidth={2.25}
                        className="size-4"
                      />
                    ))}
                  </span>
                )}
              </span>
              {line.options.length > 0 && (
                <span className="text-kds-sm text-text-muted">
                  {line.options.map((option) => pickText(option.name, locale)).join(', ')}
                </span>
              )}
              {line.note && (
                <span className="mt-1 flex items-start gap-1.5 rounded-control border-s-2 border-warning bg-warning-soft px-2 py-1 text-kds-sm text-warning">
                  <MessageSquareText
                    aria-hidden="true"
                    focusable="false"
                    strokeWidth={2.25}
                    className="u-icon-align size-4 shrink-0"
                  />
                  {line.note}
                </span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {ticket.customerNote && (
        <div className="ms-2 flex items-start gap-2 rounded-control border-s-2 border-warning bg-warning-soft px-3 py-2 text-kds-sm text-warning">
          <MessageSquareText
            aria-hidden="true"
            focusable="false"
            strokeWidth={2.25}
            className="u-icon-align size-5 shrink-0"
          />
          <div className="flex min-w-0 flex-col">
            <span className="text-kds-label uppercase">{t('kitchen.guestNote')}</span>
            <span>{ticket.customerNote}</span>
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-2 pt-1 ps-2">
        {forward && advanceLabelKey && (
          <Button
            variant="primary"
            size="xl"
            fullWidth
            loading={pending}
            loadingLabel={t('common.saving')}
            onClick={() => onAdvance(ticket, forward)}
          >
            {t(advanceLabelKey)}
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" size="md" disabled={pending} onClick={() => onRequestCancel(ticket)}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </article>
  )
}
