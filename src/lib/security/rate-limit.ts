/**
 * An in-process request shedder.
 *
 * THIS IS NOT A SECURITY CONTROL. Say it plainly, because treating it as one is
 * the mistake it invites: the counters live in one server process's memory, so
 * they reset on deploy, do not exist on a cold start, and are not shared across
 * instances. An attacker with a botnet routes around it trivially.
 *
 * The real limits are in the database, inside the SECURITY DEFINER functions
 * that take `FOR UPDATE` on the table row before writing — those are atomic,
 * shared, and cannot be evaded by opening a second connection. What this module
 * buys is cheapness: it turns an obvious flood into a rejected request that
 * never opens a database connection, which keeps the pool available for the
 * diners who are behaving normally.
 */

export type LimitKind = 'place_order' | 'call_waiter' | 'resolve_table' | 'get_menu'

interface Bucket {
  count: number
  resetAt: number
}

interface Policy {
  readonly limit: number
  readonly windowMs: number
}

/**
 * Deliberately looser than the database cooldowns. This layer is only meant to
 * shed obvious floods; anything close to the real limit is left to the database
 * so that a legitimate diner never sees a rejection this layer invented.
 */
const POLICIES: Readonly<Record<LimitKind, Policy>> = {
  place_order: { limit: 10, windowMs: 60_000 },
  call_waiter: { limit: 10, windowMs: 60_000 },
  resolve_table: { limit: 120, windowMs: 60_000 },
  get_menu: { limit: 240, windowMs: 60_000 },
}

const buckets = new Map<string, Bucket>();

/** Keeps the map from growing without bound on a long-lived server process. */
const MAX_TRACKED_KEYS = 10_000

export interface LimitResult {
  readonly allowed: boolean
  readonly remaining: number
  readonly retryAfterSeconds: number
}

/**
 * Records a hit and reports whether it should proceed.
 * `key` should be the most specific stable identifier available — a QR token
 * for public traffic, never a raw IP alone, since a whole restaurant shares one.
 */
export function checkLimit(kind: LimitKind, key: string, now = Date.now()): LimitResult {
  const policy = POLICIES[kind]
  const bucketKey = `${kind}:${key}`
  const existing = buckets.get(bucketKey)

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_TRACKED_KEYS) evictExpired(now)
    buckets.set(bucketKey, { count: 1, resetAt: now + policy.windowMs })
    return { allowed: true, remaining: policy.limit - 1, retryAfterSeconds: 0 }
  }

  existing.count += 1
  if (existing.count > policy.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    }
  }

  return {
    allowed: true,
    remaining: policy.limit - existing.count,
    retryAfterSeconds: 0,
  }
}

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key)
  }
  // Still full of live buckets: this is a flood wider than the map. Drop
  // everything rather than grow without bound; the database limits still hold.
  if (buckets.size >= MAX_TRACKED_KEYS) buckets.clear()
}

/**
 * The client address, as far as it can be trusted.
 *
 * `x-forwarded-for` is client-controlled unless a proxy you control rewrites
 * it, so this is only ever used for coarse bucketing and diagnostics — never
 * for authorisation, and never as the sole rate-limit key.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Test seam. Never call from application code. */
export function __resetLimits(): void {
  buckets.clear()
}
