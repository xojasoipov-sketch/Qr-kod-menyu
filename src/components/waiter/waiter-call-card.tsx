'use client'

/**
 * src/components/waiter/waiter-call-card.tsx — one table call.
 * Source: docs/architecture/04-design-system.md §6.1 (StatusPill, Card, §8.10),
 * §8.10 ("colour is never the only channel"); brief §10.
 *
 * A call is never colour-only: the tone, the `BellRing` icon inside
 * `StatusPill` and the localised reason word are always all three present.
 * `escalated` (an old, still-`pending` call) adds the same blinking edge the
 * KDS uses for a late ticket — the one looping animation this product allows,
 * reserved for exactly this kind of "a human must not miss this" moment.
 */
import { MessageSquareText } from 'lucide-react'

import { Badge, StatusPill } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { useT } from '@/lib/i18n/provider'
import { formatElapsed } from '@/lib/orders/lateness'
import { cn } from '@/lib/utils/cn'
import type { WaiterCallView } from '@/types/domain'

export type WaiterCallPendingAction = 'acknowledge' | 'resolve' | null

export interface WaiterCallCardProps {
  call: WaiterCallView
  /** Recomputed by the caller against a shared 1 Hz clock, not `call.ageSeconds`. */
  ageSeconds: number
  /** An old, still-open call — the visual escalation brief §10 asks for. */
  escalated: boolean
  /** Which of this call's two buttons is in flight, if either. */
  pendingAction: WaiterCallPendingAction
  onAcknowledge: (id: string) => void
  onResolve: (id: string) => void
}

export function WaiterCallCard({
  call,
  ageSeconds,
  escalated,
  pendingAction,
  onAcknowledge,
  onResolve,
}: WaiterCallCardProps): React.JSX.Element {
  const t = useT();

  const canAcknowledge = call.status === 'pending';
  const canResolve = call.status === 'pending' || call.status === 'acknowledged';

  return (
    <Card
      as="li"
      padding="md"
      tone={escalated ? 'danger' : 'default'}
      className={cn('flex flex-col gap-3', escalated && 'animate-late-blink')}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-kds-xl font-bold text-text u-tnum">
            {t('waiter.orderTable', { number: call.tableNumber })}
          </span>
          {call.tableName !== null && (
            <span className="truncate text-kds-sm text-text-muted">{call.tableName}</span>
          )}
        </div>
        <StatusPill kind="waiter_call" status={call.status} label={t(`status.call.${call.status}`)} size="lg" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="neutral" variant="outline" size="md">
          {t(`labels.callReason.${call.reason}`)}
        </Badge>
        <span className="text-kds-sm text-text-subtle u-tnum">
          {t('waiter.callAge', { age: formatElapsed(ageSeconds) })}
        </span>
      </div>

      {call.note !== null && call.note.length > 0 && (
        <p className="flex items-start gap-2 rounded-control border-s-2 border-warning bg-warning-soft px-3 py-2 text-kds-sm text-text">
          <MessageSquareText aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-5 shrink-0 text-warning" />
          <span>{call.note}</span>
        </p>
      )}

      {call.status === 'acknowledged' && call.acknowledgedByName !== null && (
        <p className="text-kds-sm text-text-muted">
          {t('waiter.acknowledged', { staff: call.acknowledgedByName })}
        </p>
      )}

      {(canAcknowledge || canResolve) && (
        <div className="flex flex-wrap gap-2">
          {canAcknowledge && (
            <Button
              variant="primary"
              size="xl"
              fullWidth
              loading={pendingAction === 'acknowledge'}
              disabled={pendingAction === 'resolve'}
              loadingLabel={t('waiter.acknowledging')}
              onClick={() => onAcknowledge(call.id)}
            >
              {t('waiter.acknowledge')}
            </Button>
          )}
          {canResolve && (
            <Button
              variant={canAcknowledge ? 'secondary' : 'primary'}
              size="xl"
              fullWidth={!canAcknowledge}
              loading={pendingAction === 'resolve'}
              disabled={pendingAction === 'acknowledge'}
              onClick={() => onResolve(call.id)}
            >
              {t('waiter.resolve')}
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
