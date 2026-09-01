'use client'

/**
 * CALL WAITER — a bottom sheet over a grid of reasons.
 *
 * `public_call_waiter(token, reason)` takes no free-text note (only `reason`,
 * a closed enum), so this sheet does not offer one — a control that cannot
 * reach the server is worse than no control. The cooldown is enforced under a
 * row lock in the database; a refusal comes back typed as `RATE_LIMITED` with
 * `retryAfterSeconds`, which this sheet renders as a countdown on the send
 * button rather than leaving a dead control up.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { BellRing, Check, Droplets, HelpCircle, MessageCircleWarning, Receipt, Sparkles, Utensils } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ErrorState, type ErrorStateCode } from '@/components/ui/error-state'
import { Sheet } from '@/components/ui/sheet'
import { callWaiterAction } from '@/app/t/[token]/actions'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'
import type { AppError } from '@/lib/result'
import { WAITER_CALL_REASONS, type WaiterCallReason } from '@/types/database'

const REASON_ICON: Record<WaiterCallReason, LucideIcon> = {
  call_waiter: BellRing,
  request_bill: Receipt,
  request_water: Droplets,
  request_cutlery: Utensils,
  clean_table: Sparkles,
  complaint: MessageCircleWarning,
  other: HelpCircle,
}

function reasonLabelKey(value: WaiterCallReason): `labels.callReason.${WaiterCallReason}` {
  return `labels.callReason.${value}`
}

function toErrorStateCode(error: AppError): ErrorStateCode {
  if (error.wire) return error.wire
  return error.code === 'NETWORK' ? 'network' : 'unknown'
}

export interface WaiterCallSheetProps {
  token: string
  tableNumber: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function WaiterCallSheet({
  token,
  tableNumber,
  open,
  onOpenChange,
}: WaiterCallSheetProps): React.JSX.Element {
  const t = useT()
  const [reason, setReason] = useState<WaiterCallReason>('call_waiter')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<AppError | null>(null)
  const [sent, setSent] = useState(false)
  const [retrySeconds, setRetrySeconds] = useState<number | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Every open is a fresh decision, matching <ConfirmDialog>'s own convention.
  useEffect(() => {
    if (open) return
    setSent(false)
    setError(null)
    setReason('call_waiter')
    setPending(false)
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
    setRetrySeconds(null)
  }, [open])

  useEffect(
    () => () => {
      if (tickRef.current) clearInterval(tickRef.current)
    },
    [],
  )

  const startCountdown = useCallback((seconds: number) => {
    if (tickRef.current) clearInterval(tickRef.current)
    setRetrySeconds(seconds)
    tickRef.current = setInterval(() => {
      setRetrySeconds((current) => {
        if (current === null || current <= 1) {
          if (tickRef.current) clearInterval(tickRef.current)
          return null
        }
        return current - 1
      })
    }, 1000)
  }, [])

  const handleSend = useCallback(async () => {
    setPending(true)
    setError(null)
    const result = await callWaiterAction({ token, reason })
    setPending(false)

    if (result.ok) {
      setSent(true)
      return
    }

    setError(result.error)
    if (result.error.code === 'RATE_LIMITED' && result.error.retryAfterSeconds) {
      startCountdown(result.error.retryAfterSeconds)
    }
  }, [token, reason, startCountdown])

  const sendBlocked = pending || (retrySeconds !== null && retrySeconds > 0)

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('customer.waiterCall.sheetTitle')}
      description={t('customer.waiterCall.sheetBody', { number: tableNumber })}
      closeLabel={t('a11y.closeDialog')}
      footer={
        sent ? (
          <Button variant="secondary" size="lg" fullWidth onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        ) : (
          <Button
            variant="primary"
            size="lg"
            fullWidth
            loading={pending}
            loadingLabel={t('customer.waiterCall.sending')}
            disabled={sendBlocked}
            onClick={() => void handleSend()}
          >
            {retrySeconds !== null && retrySeconds > 0
              ? t('errors.QR011_WAITER_CALL_COOLDOWN', { seconds: retrySeconds })
              : t('customer.waiterCall.send')}
          </Button>
        )
      }
    >
      {sent ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <Check className="size-8 text-success" strokeWidth={1.75} aria-hidden="true" focusable="false" />
          <p className="font-medium text-body text-text">{t('customer.waiterCall.sentTitle')}</p>
          <p className="text-body-sm text-text-muted">{t('customer.waiterCall.sentBody')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="mb-2 font-medium text-body-sm text-text">{t('customer.waiterCall.reasonLabel')}</p>
            <div role="radiogroup" aria-label={t('customer.waiterCall.reasonLabel')} className="grid grid-cols-2 gap-2">
              {WAITER_CALL_REASONS.map((value) => {
                const Icon = REASON_ICON[value]
                const active = value === reason
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setReason(value)}
                    className={cn(
                      'flex min-h-(--tap-min) items-center gap-2 rounded-control border px-3 py-2 text-start text-body-sm transition-colors',
                      active
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-border text-text hover:border-border-strong',
                    )}
                  >
                    <Icon aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4 shrink-0" />
                    {t(reasonLabelKey(value))}
                  </button>
                )
              })}
            </div>
          </div>

          {error && (
            <ErrorState
              size="sm"
              live
              code={toErrorStateCode(error)}
              params={{ seconds: retrySeconds ?? error.retryAfterSeconds ?? 0 }}
            />
          )}
        </div>
      )}
    </Sheet>
  )
}
