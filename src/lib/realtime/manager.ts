'use client'

/**
 * The per-tab Realtime channel registry.
 *
 * Why this file exists, precisely:
 *
 * React 19 StrictMode mounts a component, runs its effects, unmounts it and
 * mounts it again — in the same tick. A naive
 *
 *     useEffect(() => {
 *       const ch = supabase.channel(topic).subscribe()
 *       return () => { void supabase.removeChannel(ch) }
 *     }, [topic])
 *
 * therefore produces join -> leave -> join. `removeChannel()` is asynchronous,
 * so the second join is very often sent while the first leave is still in
 * flight; the server answers the second join for an already-joined topic with
 * an error and the panel sits on a dead channel. The symptom is the worst kind:
 * it works in production and shows CHANNEL_ERROR in development, which teaches
 * developers to ignore the one state this subsystem must never be ignored in.
 *
 * The fix is a reference-counted registry with DEFERRED teardown (doc 06 §6.2):
 * the last release schedules the leave TEARDOWN_GRACE_MS in the future, and the
 * StrictMode remount — which happens in the same tick — finds the entry still
 * present, cancels the timer and re-increments. One join, one channel, no error.
 *
 * Two further invariants live here and nowhere else:
 *
 *  - `build` runs ONCE per underlying channel, BEFORE `.subscribe()`. supabase-js
 *    only ships bindings registered before the join; an `.on()` added afterwards
 *    is silently never delivered. That is why the branch channel's binding set
 *    must be fixed and complete (doc 06 §1.3) and why a second acquire of a live
 *    topic reuses the channel instead of re-building it.
 *  - A rebuild of a topic that is being torn down AWAITS the leave. Two joins for
 *    one topic on one socket is exactly what the server rejects.
 *
 * The registry is module scoped, therefore per tab, and is only ever imported
 * from client modules.
 */

import type { RealtimeChannel } from '@supabase/supabase-js'

import { isDemoMode, isSupabaseConfigured } from '@/lib/env'
import type { RealtimeTopic } from '@/lib/realtime/channels'
import { createBrowserClient } from '@/lib/supabase/browser'

/** The four terminal answers `channel.subscribe()` can give. */
export type ChannelSubscribeStatus = 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED'

export type ChannelStatusListener = (status: ChannelSubscribeStatus, error?: Error) => void

/** Registers every `.on()` binding. Runs once per channel, before subscribe(). */
export type ChannelBuilder = (channel: RealtimeChannel) => void

/**
 * The window in which a StrictMode remount (or a fast route re-render) can
 * re-acquire a topic without the channel ever leaving. 300 ms is far longer than
 * a remount and far shorter than a human navigating back.
 */
export const TEARDOWN_GRACE_MS = 300

export interface ChannelHandle {
  readonly topic: RealtimeTopic
  /** The live channel, or null while a previous teardown is still draining. */
  getChannel(): RealtimeChannel | null
  /**
   * Drop the underlying channel and rebuild it, keeping every subscriber
   * attached. Used for the bfcache restore (doc 06 §5.1 F2) and for the
   * escalation path after repeated join failures.
   */
  rejoin(): void
  /** Idempotent. The last release schedules teardown, it does not perform it. */
  release(): void
}

interface Entry {
  readonly topic: RealtimeTopic
  readonly build: ChannelBuilder
  channel: RealtimeChannel | null
  refs: number
  listeners: Set<ChannelStatusListener>
  teardownTimer: ReturnType<typeof setTimeout> | null
  lastStatus: ChannelSubscribeStatus | null
  /** Bumped whenever the underlying channel is replaced; stale callbacks check it. */
  epoch: number
  disposed: boolean
}

const entries = new Map<string, Entry>()

/** Leaves in flight, keyed by topic. A rebuild of the same topic awaits its promise. */
const closing = new Map<string, Promise<void>>()

/**
 * Realtime is unavailable when there is no Supabase project (demo mode, or a
 * checkout with no env). Callers use this to choose the polling path instead of
 * subscribing to a channel that can never join — a visible degraded mode beats
 * an invisible dead one.
 */
export function isRealtimeAvailable(): boolean {
  return isSupabaseConfigured() && !isDemoMode()
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : 'Realtime channel failed')
}

/**
 * supabase-js reports the status as a string enum. Narrowing by value rather
 * than casting keeps an unknown future status from being silently treated as a
 * join.
 */
function toSubscribeStatus(value: string): ChannelSubscribeStatus | null {
  switch (value) {
    case 'SUBSCRIBED':
      return 'SUBSCRIBED'
    case 'CHANNEL_ERROR':
      return 'CHANNEL_ERROR'
    case 'TIMED_OUT':
      return 'TIMED_OUT'
    case 'CLOSED':
      return 'CLOSED'
    default:
      return null
  }
}

function emit(entry: Entry, status: ChannelSubscribeStatus, error?: Error): void {
  entry.lastStatus = status
  // Copy: a listener may release() itself from inside its own callback.
  for (const listener of Array.from(entry.listeners)) {
    try {
      listener(status, error)
    } catch {
      // A subscriber's own bookkeeping must never break the fan-out to its peers.
    }
  }
}

async function leaveChannel(channel: RealtimeChannel): Promise<void> {
  try {
    await channel.unsubscribe()
  } catch {
    // The socket may already be gone; the removal below is what matters.
  }
  try {
    await createBrowserClient().removeChannel(channel)
  } catch {
    // Same: never let a teardown failure escape into a render.
  }
}

function beginLeave(topic: string, channel: RealtimeChannel | null): void {
  if (!channel) return
  const promise = leaveChannel(channel)
  closing.set(topic, promise)
  void promise.then(() => {
    if (closing.get(topic) === promise) closing.delete(topic)
  })
}

async function openChannel(entry: Entry): Promise<void> {
  // A rebuild must not race the leave of the previous channel for this topic.
  const pending = closing.get(entry.topic)
  if (pending) await pending

  if (entry.disposed || entries.get(entry.topic) !== entry) return

  const epoch = entry.epoch

  let channel: RealtimeChannel
  try {
    const supabase = createBrowserClient()
    channel = supabase.channel(entry.topic, {
      config: { private: true, broadcast: { self: false, ack: false } },
    })
    entry.build(channel)
  } catch (error) {
    // Missing env, an invalid topic, a throwing binding: all reported as a
    // channel error so the consumer shows a degraded badge and starts polling.
    emit(entry, 'CHANNEL_ERROR', toError(error))
    return
  }

  entry.channel = channel

  channel.subscribe((rawStatus, error) => {
    if (entry.disposed || entry.epoch !== epoch) return
    const status = toSubscribeStatus(String(rawStatus))
    if (!status) return
    emit(entry, status, error)
  })
}

function disposeEntry(entry: Entry): void {
  if (entry.disposed) return
  entry.disposed = true
  if (entry.teardownTimer) {
    clearTimeout(entry.teardownTimer)
    entry.teardownTimer = null
  }
  if (entries.get(entry.topic) === entry) entries.delete(entry.topic)
  const channel = entry.channel
  entry.channel = null
  entry.listeners.clear()
  beginLeave(entry.topic, channel)
}

function scheduleTeardown(entry: Entry): void {
  if (entry.teardownTimer || entry.disposed) return
  entry.teardownTimer = setTimeout(() => {
    entry.teardownTimer = null
    // A remount inside the grace window re-incremented the count: keep the channel.
    if (entry.refs > 0) return
    disposeEntry(entry)
  }, TEARDOWN_GRACE_MS)
}

function rejoinEntry(entry: Entry): void {
  if (entry.disposed) return
  entry.epoch += 1
  const channel = entry.channel
  entry.channel = null
  beginLeave(entry.topic, channel)
  emit(entry, 'CLOSED')
  void openChannel(entry)
}

/**
 * Acquire (or join) the channel for `topic`.
 *
 * `build` runs once per underlying channel, before `subscribe()`, and registers
 * every binding. A second acquire for a live topic increments the reference
 * count and reuses the channel — `build` is NOT re-run, which is why a topic's
 * binding set must be fixed and complete.
 *
 * `onStatus` receives every join/leave transition for the topic, including the
 * current one on a late acquire, so several hooks on one branch channel all see
 * the same connection state from a single subscribe.
 */
export function acquireChannel(
  topic: RealtimeTopic,
  build: ChannelBuilder,
  onStatus: ChannelStatusListener,
): ChannelHandle {
  const existing = entries.get(topic)

  if (existing && !existing.disposed) {
    if (existing.teardownTimer) {
      clearTimeout(existing.teardownTimer)
      existing.teardownTimer = null
    }
    existing.refs += 1
    existing.listeners.add(onStatus)
    const last = existing.lastStatus
    if (last) {
      // Asynchronously: a listener that setStates must not do so during the
      // caller's render pass.
      queueMicrotask(() => {
        if (existing.listeners.has(onStatus)) onStatus(last)
      })
    }
    return makeHandle(existing, onStatus)
  }

  const entry: Entry = {
    topic,
    build,
    channel: null,
    refs: 1,
    listeners: new Set([onStatus]),
    teardownTimer: null,
    lastStatus: null,
    epoch: 0,
    disposed: false,
  }
  entries.set(topic, entry)
  void openChannel(entry)
  return makeHandle(entry, onStatus)
}

function makeHandle(entry: Entry, listener: ChannelStatusListener): ChannelHandle {
  let released = false
  return {
    topic: entry.topic,
    getChannel: () => entry.channel,
    rejoin: () => {
      if (!released) rejoinEntry(entry)
    },
    release: () => {
      if (released) return
      released = true
      entry.listeners.delete(listener)
      entry.refs -= 1
      if (entry.refs <= 0) scheduleTeardown(entry)
    },
  }
}

/** How many subscribers hold `topic` right now. Test and diagnostic use only. */
export function __channelRefCount(topic: RealtimeTopic): number {
  return entries.get(topic)?.refs ?? 0
}

/** Test-only. Drains every entry and awaits the leaves. */
export async function __resetRealtimeManager(): Promise<void> {
  for (const entry of Array.from(entries.values())) {
    entry.refs = 0
    disposeEntry(entry)
  }
  entries.clear()
  await Promise.all(Array.from(closing.values()))
  closing.clear()
}
