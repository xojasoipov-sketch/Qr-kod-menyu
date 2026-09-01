/**
 * src/components/waiter/table-calls-panel.tsx — the "Table calls" column.
 * Source: docs/architecture/05-app-structure.md §6.4 (WaiterBoard); brief §10.
 *
 * A pure presentational child of `<WaiterBoard>` ('use client'): everything it
 * needs — the recomputed age, which call is escalated, which tap is in
 * flight — is handed down as props. `<WaiterBoard>` owns the shared 1 Hz
 * clock and the realtime state; this file only renders it.
 */
import { BellOff } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import { byUrgency } from '@/lib/mappers/waiter-mapper'
import { useT } from '@/lib/i18n/provider'
import type { WaiterCallView } from '@/types/domain'

import { WaiterCallCard, type WaiterCallPendingAction } from './waiter-call-card'

/** Threshold past which an unacknowledged call gets the blinking treatment. */
export const CALL_ESCALATE_AFTER_SECONDS = 90;

export interface TableCallsPanelProps {
  calls: readonly WaiterCallView[];
  now: Date;
  /** Which action, if any, is in flight for a given call id. */
  pendingActions: ReadonlyMap<string, WaiterCallPendingAction>;
  onAcknowledge: (id: string) => void;
  onResolve: (id: string) => void;
}

function ageOf(call: WaiterCallView, now: Date): number {
  const started = Date.parse(call.createdAt);
  if (Number.isNaN(started)) return call.ageSeconds;
  return Math.max(0, Math.floor((now.getTime() - started) / 1000));
}

export function TableCallsPanel({
  calls,
  now,
  pendingActions,
  onAcknowledge,
  onResolve,
}: TableCallsPanelProps): React.JSX.Element {
  const t = useT();

  if (calls.length === 0) {
    return (
      <EmptyState
        icon={<BellOff className="size-7" strokeWidth={2.25} />}
        title={t('waiter.emptyCalls.title')}
        description={t('waiter.emptyCalls.body')}
        size="md"
      />
    );
  }

  const withAge = calls.map((call) => ({ call, ageSeconds: ageOf(call, now) }));
  const sorted = [...withAge].sort((a, b) => byUrgency(a.call, b.call) || b.ageSeconds - a.ageSeconds);

  return (
    <ul className="flex flex-col gap-3">
      {sorted.map(({ call, ageSeconds }) => (
        <WaiterCallCard
          key={call.id}
          call={call}
          ageSeconds={ageSeconds}
          escalated={call.status === 'pending' && ageSeconds >= CALL_ESCALATE_AFTER_SECONDS}
          pendingAction={pendingActions.get(call.id) ?? null}
          onAcknowledge={onAcknowledge}
          onResolve={onResolve}
        />
      ))}
    </ul>
  );
}
