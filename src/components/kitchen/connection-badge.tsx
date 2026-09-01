'use client'

/**
 * src/components/kitchen/connection-badge.tsx — the KDS's honesty indicator.
 *
 * Doc 06 §5.6 / §6.8: a real-time surface that silently falls back to polling
 * without saying so is lying to the person reading it. This renders one of
 * three states — never colour alone (04 §8.10): an icon, a localised word and
 * a tone all change together.
 *
 *   live         — the branch channel is joined; tickets move the instant the
 *                   database changes.
 *   connecting / — either the initial join hasn't completed yet or a live
 *   reconnecting   channel just dropped. Same copy (the catalogue carries one
 *                   string for both — `kitchen.connectionReconnecting`), a
 *                   spinner replaces the icon.
 *   polling      — realtime is unavailable or gave up; the board still
 *                   updates, just on a timer instead of instantly.
 */

import { Wifi, WifiOff } from 'lucide-react'

import { Badge, type BadgeTone } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'

/** The four states a staff realtime consumer can be in (doc 06 §2.6/§6.4). */
export type KdsConnectionState = 'connecting' | 'live' | 'reconnecting' | 'polling'

export interface ConnectionBadgeProps {
  state: KdsConnectionState
  className?: string
}

const TONE: Record<KdsConnectionState, BadgeTone> = {
  live: 'success',
  connecting: 'warning',
  reconnecting: 'warning',
  polling: 'danger',
}

export function ConnectionBadge({ state, className }: ConnectionBadgeProps): React.JSX.Element {
  const t = useT()

  const label =
    state === 'live'
      ? t('kitchen.connectionLive')
      : state === 'polling'
        ? t('kitchen.connectionOffline')
        : t('kitchen.connectionReconnecting')

  return (
    <Badge
      tone={TONE[state]}
      variant="outline"
      size="md"
      className={cn('gap-1.5 normal-case', className)}
    >
      {state === 'live' && (
        <Wifi aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-3.5" />
      )}
      {state === 'polling' && (
        <WifiOff aria-hidden="true" focusable="false" strokeWidth={2.25} className="u-icon-align size-3.5" />
      )}
      {(state === 'connecting' || state === 'reconnecting') && <Spinner size="sm" />}
      {label}
    </Badge>
  )
}
