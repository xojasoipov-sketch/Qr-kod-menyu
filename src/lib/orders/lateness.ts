/**
 * How long an order has been waiting, and whether that is too long.
 *
 * Shared by the kitchen display (which flags a late ticket) and the admin
 * dashboard (which counts them), so both agree on what "late" means. Time is
 * always passed in rather than read from the clock inside these functions:
 * that keeps them pure, testable, and safe to call during a server render
 * without producing a hydration mismatch against the client's clock.
 */
import type { OrderStatus } from '@/types/database'

/** Lateness is measured from acceptance, not from placement. */
export interface Timed {
  readonly created_at: string
  readonly confirmed_at?: string | null
  readonly preparation_minutes?: number | null
  readonly status: OrderStatus
}

/** Statuses where the clock is still running. A served order is never late. */
const OPEN_STATUSES: ReadonlySet<OrderStatus> = new Set<OrderStatus>([
  'pending',
  'confirmed',
  'preparing',
  'ready',
])

export function isOpen(status: OrderStatus): boolean {
  return OPEN_STATUSES.has(status)
}

/** Whole seconds since the order was placed. Never negative, even if clocks disagree. */
export function elapsedSeconds(order: Timed, now: Date): number {
  const started = Date.parse(order.created_at)
  if (Number.isNaN(started)) return 0
  return Math.max(0, Math.floor((now.getTime() - started) / 1000))
}

/**
 * When this order is expected to be ready.
 *
 * The promise starts when the kitchen accepts the order, because time spent
 * waiting for acceptance is a front-of-house problem rather than a slow stove —
 * flagging it as a kitchen delay would train staff to ignore the flag. Falls
 * back to placement time while the order is still pending.
 */
export function dueAt(order: Timed, defaultPrepMinutes: number): Date {
  const anchor = order.confirmed_at ?? order.created_at
  const minutes = order.preparation_minutes ?? defaultPrepMinutes
  return new Date(Date.parse(anchor) + minutes * 60_000)
}

/**
 * True when an order that is still open has passed the branch's late threshold.
 * A closed order is never late — flagging history helps nobody and makes the
 * board noisy exactly when the kitchen is busiest.
 */
export function isLate(order: Timed, thresholdMinutes: number, now: Date): boolean {
  if (!isOpen(order.status)) return false
  return elapsedSeconds(order, now) > thresholdMinutes * 60
}

/**
 * How urgent a ticket looks. Three bands rather than a continuous scale,
 * because a cook glancing at the board from two metres away can distinguish
 * three states and cannot distinguish a gradient.
 */
export type LatenessLevel = 'on_time' | 'due_soon' | 'late'

export function latenessLevel(
  order: Timed,
  thresholdMinutes: number,
  now: Date,
): LatenessLevel {
  if (!isOpen(order.status)) return 'on_time'
  const elapsed = elapsedSeconds(order, now)
  const threshold = thresholdMinutes * 60
  if (elapsed > threshold) return 'late'
  if (elapsed > threshold * 0.75) return 'due_soon'
  return 'on_time'
}

/** "12:04" from a second count, for the elapsed-time counter on a ticket. */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(secs)}` : `${minutes}:${pad(secs)}`
}
