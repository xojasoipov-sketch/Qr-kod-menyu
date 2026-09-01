/**
 * src/components/waiter/active-orders-panel.tsx — the "Active" column.
 * Source: docs/architecture/04-design-system.md §6.3 (KitchenTicketCard rules,
 * reused here at waiter scale — no photography, no serif, colour means
 * status); docs/architecture/05-app-structure.md §6.3 ("active orders").
 *
 * Read-only: an order being cooked has nothing for a waiter to tap. This
 * column exists so the floor can see what is coming without walking to the
 * pass — the action lives one column over, once the kitchen marks it ready.
 */
import { AlarmClock, MessageSquareText, Package, Utensils } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { StatusPill } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { useLocale, useT } from '@/lib/i18n/provider'
import { elapsedSeconds, formatElapsed, latenessLevel, type Timed } from '@/lib/orders/lateness'
import type { KitchenTicket } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'

function pickText(text: I18nText, locale: Locale): string {
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? '';
}

function timedOf(ticket: KitchenTicket): Timed {
  return {
    created_at: ticket.placedAt,
    confirmed_at: ticket.confirmedAt,
    preparation_minutes: ticket.estimatedPrepMinutes,
    status: ticket.status,
  };
}

export interface ActiveOrdersPanelProps {
  tickets: readonly KitchenTicket[];
  now: Date;
  lateThresholdMinutes: number;
}

export function ActiveOrdersPanel({
  tickets,
  now,
  lateThresholdMinutes,
}: ActiveOrdersPanelProps): React.JSX.Element {
  const t = useT();
  const locale = useLocale();

  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={<Utensils className="size-7" strokeWidth={2.25} />}
        title={t('waiter.emptyActive.title')}
        description={t('waiter.emptyActive.body')}
        size="md"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {tickets.map((ticket) => {
        const timed = timedOf(ticket);
        const level = latenessLevel(timed, lateThresholdMinutes, now);
        const elapsed = elapsedSeconds(timed, now);
        const late = level === 'late';

        return (
          <Card key={ticket.orderId} as="li" padding="md" tone={late ? 'danger' : 'default'} className="flex flex-col gap-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                {ticket.tableNumber !== null ? (
                  <span className="text-kds-xl font-bold text-text u-tnum">
                    {t('waiter.orderTable', { number: ticket.tableNumber })}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-kds-lg font-semibold text-text">
                    <Package aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-6" />
                    {t('kitchen.ticketTakeaway')}
                  </span>
                )}
              </div>
              <StatusPill kind="order" status={ticket.status} label={t(`status.order.${ticket.status}`)} size="md" />
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-kds-sm text-text-muted u-tnum">
              <span>{ticket.orderNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{t('kitchen.elapsed', { elapsed: formatElapsed(elapsed) })}</span>
              {late && (
                <span className="inline-flex items-center gap-1 text-danger">
                  <AlarmClock aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-4" />
                  {t('kitchen.lateBadge')}
                </span>
              )}
            </div>

            <ul className="flex flex-col gap-1">
              {ticket.lines.map((line) => (
                <li key={line.id} className="flex items-baseline gap-2 text-kds-sm text-text">
                  <span className="u-tnum font-semibold text-text-muted">{line.quantity}×</span>
                  <span className="min-w-0 truncate">{pickText(line.name, locale)}</span>
                </li>
              ))}
            </ul>

            {ticket.customerNote !== null && ticket.customerNote.length > 0 && (
              <p className="flex items-start gap-2 rounded-control border-s-2 border-warning bg-warning-soft px-3 py-2 text-kds-sm text-text">
                <MessageSquareText aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-5 shrink-0 text-warning" />
                <span>{ticket.customerNote}</span>
              </p>
            )}
          </Card>
        );
      })}
    </ul>
  );
}
