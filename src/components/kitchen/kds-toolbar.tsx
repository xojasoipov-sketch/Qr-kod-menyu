'use client'

/**
 * src/components/kitchen/kds-toolbar.tsx — the KDS header (05-app-structure.md
 * §2.5.1: "branch name, live clock, connection badge, late count").
 *
 * Everything here is a device-scoped convenience, not shared product state:
 * the sound mute, the fullscreen request and the wake lock all live only in
 * this tab and reset on reload, which is exactly right for a kitchen tablet
 * that stays plugged in and mounted to a wall.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlarmClock, Eye, EyeOff, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { IconButton } from '@/components/ui/button'
import { formatTime } from '@/lib/i18n/format'
import { useLocale, useT } from '@/lib/i18n/provider'

import { ConnectionBadge, type KdsConnectionState } from './connection-badge'

export interface KdsToolbarProps {
  branchName: string
  timeZone: string
  /** `Date.now()` from `<KdsBoard>`'s shared 1 Hz tick. */
  now: number
  connection: KdsConnectionState
  lateCount: number
  muted: boolean
  onToggleMuted: () => void
}

export function KdsToolbar({
  branchName,
  timeZone,
  now,
  connection,
  lateCount,
  muted,
  onToggleMuted,
}: KdsToolbarProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()

  const [fullscreen, setFullscreen] = useState(false)
  const [awake, setAwake] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  useEffect(() => {
    const onChange = (): void => setFullscreen(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => {})
    } else {
      void document.documentElement.requestFullscreen().catch(() => {})
    }
  }, [])

  const releaseWakeLock = useCallback(() => {
    const sentinel = wakeLockRef.current
    wakeLockRef.current = null
    if (sentinel) void sentinel.release().catch(() => {})
  }, [])

  const requestWakeLock = useCallback(async () => {
    if (!('wakeLock' in navigator)) return
    try {
      const sentinel = await navigator.wakeLock.request('screen')
      wakeLockRef.current = sentinel
      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) wakeLockRef.current = null
      })
    } catch {
      // Best effort (04 §2.5.1) — a KDS with no wake-lock support still works.
    }
  }, [])

  const toggleAwake = useCallback(() => {
    setAwake((prev) => {
      const next = !prev
      if (next) void requestWakeLock()
      else releaseWakeLock()
      return next
    })
  }, [requestWakeLock, releaseWakeLock])

  // Re-acquire on return to foreground: the sentinel is released whenever the
  // document is hidden (05 §6.4's use-wake-lock behaviour, folded in here).
  useEffect(() => {
    if (!awake) return
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) void requestWakeLock()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [awake, requestWakeLock])

  useEffect(() => releaseWakeLock, [releaseWakeLock])

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-elevated px-4 py-3">
      <div className="flex min-w-0 items-baseline gap-3">
        <span className="truncate text-kds-lg text-text">{branchName}</span>
        <span className="u-tnum text-kds-sm text-text-muted">{formatTime(now, locale, timeZone)}</span>
      </div>

      <div className="flex items-center gap-2">
        {lateCount > 0 && (
          <Badge tone="danger" variant="solid" size="md" className="gap-1">
            <AlarmClock aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-3.5" />
            {lateCount}
          </Badge>
        )}

        <ConnectionBadge state={connection} />

        <IconButton
          icon={
            muted ? (
              <VolumeX aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-5" />
            ) : (
              <Volume2 aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-5" />
            )
          }
          label={muted ? t('kitchen.soundOff') : t('kitchen.soundOn')}
          variant={muted ? 'solid' : 'ghost'}
          onClick={onToggleMuted}
        />

        <IconButton
          icon={
            awake ? (
              <Eye aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-5" />
            ) : (
              <EyeOff aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-5" />
            )
          }
          label={awake ? t('kitchen.keepAwakeOn') : t('kitchen.keepAwakeOff')}
          variant={awake ? 'solid' : 'ghost'}
          onClick={toggleAwake}
        />

        <IconButton
          icon={
            fullscreen ? (
              <Minimize2 aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-5" />
            ) : (
              <Maximize2 aria-hidden="true" focusable="false" strokeWidth={2.25} className="size-5" />
            )
          }
          label={fullscreen ? t('kitchen.exitFullscreen') : t('kitchen.fullscreen')}
          variant="ghost"
          onClick={toggleFullscreen}
        />
      </div>
    </header>
  )
}
