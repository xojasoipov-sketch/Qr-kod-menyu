'use client'

/**
 * src/components/kitchen/new-order-alert.tsx — the audible + visual cue for a
 * ticket that just landed (brief §9; 06-realtime.md §3.5).
 *
 * Owns:
 *   - one `aria-live="assertive"` region, mounted empty, that `<KdsBoard>`
 *     feeds a complete localised sentence through `notify()` — this is one of
 *     the four assertive regions the whole product uses (04 §9.5);
 *   - a lazily-constructed `AudioContext`, created only inside a real user
 *     gesture (every browser blocks it otherwise) and armed on the first
 *     `pointerdown`/`keydown` anywhere in the document, so a cook who taps
 *     any ticket has already unlocked sound without ever reading the bar;
 *   - a one-time "tap to enable sound" bar for the session where no gesture
 *     has landed yet by the time the first order arrives.
 *
 * Every failure here is silent (doc 06 §3.5): a blocked `AudioContext`, a
 * `resume()` rejection, a browser with no Web Audio at all just means the
 * chime does not happen. The visual card entrance and the lane's edge bar are
 * owned by `<KitchenTicketCard>` / `<KdsBoard>` and never depend on this
 * component, so a muted or still-locked session still sees every new ticket —
 * sound is never the only channel (04 §9.6).
 */

import { Volume2 } from 'lucide-react'
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react'

import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n/provider'

/** Chimes throttled to at most one per 800 ms (04 §7.3) — a burst is one ping. */
const CHIME_THROTTLE_MS = 800
const CHIME_FREQUENCY_HZ = 880
const CHIME_GAIN = 0.18
const CHIME_DURATION_S = 0.12

type AudioReadiness = 'locked' | 'unlocked' | 'unsupported'

/** Only old Safari needs the prefixed constructor; every other engine has the global. */
interface WebkitAudioWindow {
  webkitAudioContext?: typeof AudioContext
}

function resolveAudioContextCtor(): typeof AudioContext | undefined {
  if (typeof window === 'undefined') return undefined
  if (typeof AudioContext !== 'undefined') return AudioContext
  return (window as Window & WebkitAudioWindow).webkitAudioContext
}

export interface NewOrderAlertInput {
  orderNumber: string
  tableLabel: string | null
  itemCount: number
}

export interface NewOrderAlertHandle {
  /** Fires the assertive announcement and, if unlocked and not muted, the chime. */
  notify: (input: NewOrderAlertInput) => void
}

export interface NewOrderAlertProps {
  /** The KDS sound toggle in `<KdsToolbar>`. A muted chime still announces. */
  muted: boolean
  ref?: Ref<NewOrderAlertHandle>
}

export function NewOrderAlert({ muted, ref }: NewOrderAlertProps): React.JSX.Element {
  const t = useT()
  const [announcement, setAnnouncement] = useState('')
  const [readiness, setReadiness] = useState<AudioReadiness>(() =>
    resolveAudioContextCtor() ? 'locked' : 'unsupported',
  )

  const ctxRef = useRef<AudioContext | null>(null)
  const lastChimeAtRef = useRef(0)
  const mutedRef = useRef(muted)
  mutedRef.current = muted

  /** MUST be called synchronously inside (or very shortly after) a user gesture. */
  const unlock = useCallback(() => {
    const Ctor = resolveAudioContextCtor()
    if (!Ctor) {
      setReadiness('unsupported')
      return
    }
    let ctx = ctxRef.current
    if (!ctx) {
      try {
        ctx = new Ctor()
      } catch {
        setReadiness('unsupported')
        return
      }
      ctxRef.current = ctx
    }
    if (ctx.state === 'running') {
      setReadiness('unlocked')
      return
    }
    void ctx.resume().then(
      () => setReadiness(ctx.state === 'running' ? 'unlocked' : 'locked'),
      () => setReadiness('locked'),
    )
  }, [])

  // The 95% path: any tap or keypress anywhere on the KDS unlocks sound, and
  // the bar (rendered only while `locked`) disappears without being read.
  useEffect(() => {
    if (readiness !== 'locked') return
    const handler = (): void => unlock()
    document.addEventListener('pointerdown', handler, { capture: true, once: true })
    document.addEventListener('keydown', handler, { capture: true, once: true })
    return () => {
      document.removeEventListener('pointerdown', handler, { capture: true })
      document.removeEventListener('keydown', handler, { capture: true })
    }
  }, [readiness, unlock])

  // Chrome and iOS Safari suspend a context when the tab is hidden or the
  // device sleeps. Retried once, silently, without a fresh gesture — most
  // browsers allow that for a context already activated once.
  useEffect(() => {
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return
      const ctx = ctxRef.current
      if (!ctx || readiness !== 'unlocked' || ctx.state !== 'suspended') return
      void ctx.resume().then(
        () => setReadiness('unlocked'),
        () => setReadiness('locked'),
      )
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [readiness])

  const playChime = useCallback(() => {
    if (mutedRef.current) return
    const ctx = ctxRef.current
    if (!ctx || ctx.state !== 'running') return

    const nowMs = performance.now()
    if (nowMs - lastChimeAtRef.current < CHIME_THROTTLE_MS) return
    lastChimeAtRef.current = nowMs

    try {
      const oscillator = ctx.createOscillator()
      const gain = ctx.createGain()
      oscillator.frequency.value = CHIME_FREQUENCY_HZ
      gain.gain.value = CHIME_GAIN
      oscillator.connect(gain)
      gain.connect(ctx.destination)
      const start = ctx.currentTime
      oscillator.start(start)
      oscillator.stop(start + CHIME_DURATION_S)
    } catch {
      // A chime is a courtesy. It is never worth surfacing an error for.
    }
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      notify: ({ orderNumber, tableLabel, itemCount }) => {
        const sentence = t('toasts.newOrder', {
          number: orderNumber,
          table: tableLabel ?? t('kitchen.ticketTakeaway'),
        })
        setAnnouncement(`${sentence} · ${t.n('plurals.items', itemCount)}`)
        playChime()
      },
    }),
    [t, playChime],
  )

  return (
    <>
      {/* Mounted empty; content changes, never the element itself (04 §9.5 rule 2). */}
      <p aria-live="assertive" aria-atomic="true" className="sr-only">
        {announcement}
      </p>

      {readiness === 'locked' && !muted && (
        <div className="flex items-center justify-center bg-warning-soft px-4 py-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={unlock}
            iconStart={
              <Volume2 aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-4" />
            }
          >
            {t('kitchen.soundOn')}
          </Button>
        </div>
      )}
    </>
  )
}
