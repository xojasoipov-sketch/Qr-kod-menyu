/**
 * src/components/waiter/ready-orders-panel.tsx — the "Ready to serve" column.
 * Source: docs/architecture/04-design-system.md §6.3 (KitchenTicketCard rules
 * at waiter scale; §6.1 `Button size="xl"` — 64px, per `--tap-min` on this
 * surface); docs/architecture/05-app-structure.md §5.2.5 (`markDeliveredAction`,
 * `ready → delivered`).
 *
 * The one action this console exists for: a plate is on the pass, and one tap
 * sends it out the door. `onServe` is `ready -> delivered`, via
 * `advanceOrderAction`; the current order id is the only thing this panel
 * ever hands back up.
 */
import { HandPlatter, Package } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useLocale, useT } from '@/lib/i18n/provider'
import { formatElapsed } from '@/lib/orders/lateness'
import type { KitchenTicket } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'

function pickText(text: I18nText, locale: Locale): string {
  return text[locale] ?? text.en ?? Object.values(text).find((v): v is string => Boolean(v)) ?? '';
}

/** Seconds since the kitchen marked this ready — what a waiter actually needs to know here. */
function waitingSeconds(ticket: KitchenTicket, now: Date): number {
  const anchor = ticket.readyAt ?? ticket.placedAt;
  const started = Date.parse(anchor);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

export interface ReadyOrdersPanelProps {
  tickets: readonly KitchenTicket[];
  now: Date;
  pendingIds: ReadonlySet<string>;
  onServe: (orderId: string) => void;
}

export function ReadyOrdersPanel({
  tickets,
  now,
  pendingIds,
  onServe,
}: ReadyOrdersPanelProps): React.JSX.Element {
  const t = useT();
  const locale = useLocale();

  if (tickets.length === 0) {
    return (
      <EmptyState
        icon={<HandPlatter className="size-7" strokeWidth={2.25} />}
        title={t('waiter.emptyReady.title')}
        description={t('waiter.emptyReady.body')}
        size="md"
      />
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {tickets.map((ticket) => (
        <Card key={ticket.orderId} as="li" padding="md" tone="accent" className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            {ticket.tableNumber !== null ? (
              <span className="text-kds-hero font-bold text-text u-tnum">{ticket.tableNumber}</span>
            ) : (
              <span className="inline-flex items-center gap-2 text-kds-lg font-semibold text-text">
                <Package aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-7" />
                {t('kitchen.ticketTakeaway')}
              </span>
            )}
            <span className="text-kds-sm text-text-muted u-tnum">{ticket.orderNumber}</span>
          </div>

          <ul className="flex flex-col gap-1">
            {ticket.lines.map((line) => (
              <li key={line.id} className="flex items-baseline gap-2 text-kds-sm text-text">
                <span className="u-tnum font-semibold text-text-muted">{line.quantity}×</span>
                <span className="min-w-0 truncate">{pickText(line.name, locale)}</span>
              </li>
            ))}
          </ul>

          <p className="text-kds-sm text-text-subtle u-tnum">
            {t('kitchen.elapsed', { elapsed: formatElapsed(waitingSeconds(ticket, now)) })}
          </p>

          <Button
            variant="primary"
            size="xl"
            fullWidth
            loading={pendingIds.has(ticket.orderId)}
            loadingLabel={t('waiter.serve')}
            onClick={() => onServe(ticket.orderId)}
          >
            {t('waiter.serve')}
          </Button>
        </Card>
      ))}
    </ul>
  );
}
