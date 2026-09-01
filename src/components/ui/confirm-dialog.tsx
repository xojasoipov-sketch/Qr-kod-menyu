'use client'

/**
 * ConfirmDialog — destructive-action gate (04-design-system.md §6.1).
 *
 * Built on `Dialog`, `size="sm"`, and non-dismissible when the tone is danger:
 * a destructive confirmation must be answered, not dismissed by a stray click on
 * the backdrop. Initial focus lands on **Cancel** (§9.3).
 */

import { TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'

import { cn } from '@/lib/utils/cn'

import { Button } from './button'
import { Dialog } from './dialog'
import { Input } from './input'

export type ConfirmTone = 'default' | 'danger'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Localised. */
  title: string
  /** Localised. */
  description: string
  /** Localised. */
  confirmLabel: string
  /** Localised. */
  cancelLabel: string
  tone?: ConfirmTone
  /**
   * When set, Confirm stays disabled until the user types this exact string.
   * Two flows only: rotating a table's `qr_token`, and deleting a menu category
   * that still has items.
   */
  requireTyped?: string
  /** Localised label for the `requireTyped` field. */
  requireTypedLabel?: string
  /** Localised fallback shown when `onConfirm` rejects without a message. */
  errorLabel?: string
  /** Localised, announced while the confirm action is in flight. */
  busyLabel?: string
  onConfirm: () => void | Promise<void>
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel,
  tone = 'default',
  requireTyped,
  requireTypedLabel = 'Type the value shown above to continue',
  errorLabel = 'That did not work. Please try again.',
  busyLabel = 'Working',
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  // Every open is a fresh decision.
  useEffect(() => {
    if (open) return
    setPending(false)
    setError(null)
    setTyped('')
  }, [open])

  const confirmBlocked = pending || (requireTyped !== undefined && typed !== requireTyped)

  const handleConfirm = useCallback(async () => {
    if (confirmBlocked) return
    setError(null)
    try {
      const result = onConfirm()
      if (result instanceof Promise) {
        setPending(true)
        await result
      }
      onOpenChange(false)
    } catch (cause) {
      // Stay open and explain, rather than closing over a failure.
      const message = cause instanceof Error && cause.message ? cause.message : errorLabel
      setError(message)
    } finally {
      setPending(false)
    }
  }, [confirmBlocked, errorLabel, onConfirm, onOpenChange])

  const handleCancel = useCallback(() => {
    if (pending) return
    onOpenChange(false)
  }, [onOpenChange, pending])

  const footer: ReactNode = (
    <>
      {/* §9.3 — initial focus lands on Cancel, never on the destructive action. */}
      <Button data-autofocus variant="secondary" onClick={handleCancel} disabled={pending}>
        {cancelLabel}
      </Button>
      <Button
        variant={tone === 'danger' ? 'danger' : 'primary'}
        onClick={() => {
          void handleConfirm()
        }}
        disabled={confirmBlocked}
        loading={pending}
        loadingLabel={busyLabel}
      >
        {confirmLabel}
      </Button>
    </>
  )

  const body: ReactNode =
    requireTyped === undefined && error === null ? null : (
      <>
        {requireTyped !== undefined ? (
          <Input
            label={requireTypedLabel}
            hint={requireTyped}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            disabled={pending}
          />
        ) : null}

        {/* §6.1 — a rejection is explained in place; the dialog does not close
            over a failure. Replace with <ErrorState size="sm"> when it exists. */}
        {error ? (
          <div
            role="alert"
            className={cn(
              'flex items-start gap-2 rounded-card border border-danger-line',
              'bg-danger-soft px-3 py-2 text-body-sm text-danger',
              requireTyped !== undefined && 'mt-4',
            )}
          >
            <TriangleAlert
              aria-hidden={true}
              focusable="false"
              strokeWidth={1.75}
              className="size-4 shrink-0 u-icon-align"
            />
            <span>{error}</span>
          </div>
        ) : null}
      </>
    )

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      size="sm"
      // A destructive choice is answered, not dismissed by a stray backdrop click.
      dismissible={tone !== 'danger' && !pending}
      footer={footer}
    >
      {body}
    </Dialog>
  )
}
