/**
 * src/components/kitchen/elapsed-timer.tsx — the mm:ss on every ticket.
 *
 * Deliberately dumb: it takes `ageSeconds` and `level` as props rather than
 * owning a clock or reading `Date.now()` itself. A lane of dozens of tickets
 * therefore shares the ONE 1 Hz tick `<KdsBoard>` owns instead of each ticket
 * running its own `setInterval` — 40 tickets each with their own timer is how
 * a KDS tablet dies (04-design-system.md §6.3).
 *
 * Colour carries lateness, but never alone (04 §8.10): the `late` band also
 * gets the `AlarmClock` glyph, and the card around this timer adds the
 * blinking edge bar and the LATE badge — any one of those removed, the state
 * is still legible.
 */

import { AlarmClock } from 'lucide-react'

import { formatElapsed, type LatenessLevel } from '@/lib/orders/lateness'
import { cn } from '@/lib/utils/cn'

export interface ElapsedTimerProps {
  /** Whole seconds since the order was placed. */
  ageSeconds: number
  level: LatenessLevel
  className?: string
}

const TONE: Record<LatenessLevel, string> = {
  on_time: 'text-text',
  due_soon: 'text-warning',
  late: 'text-danger',
}

export function ElapsedTimer({ ageSeconds, level, className }: ElapsedTimerProps): React.JSX.Element {
  return (
    <span className={cn('u-tnum inline-flex items-center gap-1.5 text-kds-md', TONE[level], className)}>
      {level === 'late' && (
        <AlarmClock
          aria-hidden="true"
          focusable="false"
          strokeWidth={2.25}
          className="u-icon-align size-6 shrink-0"
        />
      )}
      {formatElapsed(ageSeconds)}
    </span>
  )
}
