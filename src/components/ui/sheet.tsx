'use client'

/**
 * Sheet — the customer app's primary overlay (04-design-system.md §6.1, §7.5).
 *
 * Native <dialog> + showModal() for the modal semantics (focus trap, focus
 * return, Escape, `inert`, top layer, `::backdrop`, page-scroll blocking), with
 * drag-to-dismiss layered on top using Pointer Events only.
 *
 * Deliberately absent: any `overflow: hidden` on <body>. The platform already
 * blocks scrolling behind a modal dialog, and forcing it on the body breaks iOS
 * Safari's URL-bar collapse and makes the sheet jump.
 */

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { cn } from '@/lib/utils/cn'

import { OVERLAY_BACKDROP, OVERLAY_BASE, useModalOverlay } from './dialog'

/* ────────────────────────────────────────────────────────────────────────────
   useDragDismiss (§7.5)
   ──────────────────────────────────────────────────────────────────────────── */

export interface UseDragDismissOptions {
  onDismiss: () => void
  enabled: boolean
  /** The <dialog> itself — the element the drag transform is written to. */
  targetRef: RefObject<HTMLElement | null>
  /** The scrolling body. Dragging is refused unless it is at `scrollTop === 0`. */
  scrollRef?: RefObject<HTMLElement | null>
  /** px past which release dismisses. Default 96. */
  threshold?: number
  /** px/ms past which release dismisses regardless of distance. Default 0.6. */
  velocity?: number
}

export interface UseDragDismissResult {
  /** Spread onto the grabber. */
  handleProps: {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => void
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => void
  }
  /** True if the pointer moved far enough that the gesture was a drag, not a tap. */
  didDragRef: RefObject<boolean>
  /** Writes `--drag-y: 0px` / `--drag-progress: 0`. Call when the sheet (re)opens. */
  reset: () => void
}

const TAP_SLOP_PX = 4

/**
 * `--drag-y` (px, drives the transform) and `--drag-progress` (unitless 0–1,
 * drives the backdrop) are written straight to the element's `style` attribute
 * and never round-trip through React state — a re-render per pointermove would
 * drop frames, and React would clobber the value it did not set.
 *
 * §7.5 specifies `--sheet-h` and a backdrop opacity of
 * `calc(1 - var(--drag-y) / var(--sheet-h))`. CSS `calc()` cannot divide a
 * length by a length, so the ratio is computed here and published as the
 * unitless `--drag-progress`. Same two custom properties, same CSP requirement
 * (§12 C-4) — only the second one's name and unit change.
 */
export function useDragDismiss(options: UseDragDismissOptions): UseDragDismissResult {
  const { onDismiss, enabled, targetRef, scrollRef, threshold = 96, velocity = 0.6 } = options

  const gesture = useRef<{ pointerId: number; startY: number; startTime: number } | null>(null)
  const didDragRef = useRef(false)

  const write = useCallback(
    (dragY: number) => {
      const el = targetRef.current
      if (!el) return
      const height = el.getBoundingClientRect().height || 1
      el.style.setProperty('--drag-y', `${dragY}px`)
      el.style.setProperty('--drag-progress', `${Math.min(1, Math.max(0, dragY / height))}`)
    },
    [targetRef],
  )

  const reset = useCallback(() => {
    const el = targetRef.current
    if (!el) return
    el.removeAttribute('data-dragging')
    el.style.setProperty('--drag-y', '0px')
    el.style.setProperty('--drag-progress', '0')
  }, [targetRef])

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return
      // A scrolled body means the finger is mid-scroll; never turn that into a
      // dismiss (§7.5).
      if ((scrollRef?.current?.scrollTop ?? 0) > 0) return

      const el = targetRef.current
      if (!el) return

      event.currentTarget.setPointerCapture(event.pointerId)
      gesture.current = { pointerId: event.pointerId, startY: event.clientY, startTime: event.timeStamp }
      didDragRef.current = false
      // Removing the transition is what makes the sheet track the finger exactly.
      el.setAttribute('data-dragging', '')
      write(0)
    },
    [enabled, scrollRef, targetRef, write],
  )

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const active = gesture.current
      if (!active || active.pointerId !== event.pointerId) return
      const dragY = Math.max(0, event.clientY - active.startY)
      if (dragY > TAP_SLOP_PX) didDragRef.current = true
      write(dragY)
    },
    [write],
  )

  const finish = useCallback(
    (event: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
      const active = gesture.current
      if (!active || active.pointerId !== event.pointerId) return
      gesture.current = null

      const el = targetRef.current
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      // Restore the transition *before* moving, so both outcomes animate.
      el?.removeAttribute('data-dragging')

      const dragY = Math.max(0, event.clientY - active.startY)
      const elapsed = Math.max(1, event.timeStamp - active.startTime)
      const dismiss = !cancelled && (dragY > threshold || dragY / elapsed > velocity)

      if (dismiss) {
        // Leave `--drag-y` where the finger left it; `data-closing:translate-y-full`
        // out-specifies it and carries the sheet the rest of the way down.
        onDismiss()
        return
      }
      write(0)
    },
    [onDismiss, targetRef, threshold, velocity, write],
  )

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => finish(event, false),
    [finish],
  )
  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => finish(event, true),
    [finish],
  )

  return {
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
    didDragRef,
    reset,
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Sheet
   ──────────────────────────────────────────────────────────────────────────── */

export type SheetSize = 'auto' | 'half' | 'tall' | 'full'

export interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Localised. Rendered as the heading and used as the accessible name. */
  title: string
  description?: string
  /** `auto` sizes to content; the rest commit to a height. */
  size?: SheetSize
  /** `false` blocks Escape, backdrop and drag. Supply your own cancel control. */
  dismissible?: boolean
  /** Sticky, above the safe-area inset. */
  footer?: ReactNode
  /** Localised label for the grabber, which doubles as the close control. */
  closeLabel?: string
  className?: string
  children: ReactNode
}

const SHEET_SIZE: Record<SheetSize, string> = {
  auto: 'max-h-[88svh]',
  half: 'h-[50svh] max-h-[50svh]',
  tall: 'h-[88svh] max-h-[88svh]',
  full: 'h-[100svh] max-h-[100svh] rounded-t-none',
}

export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  size = 'auto',
  dismissible = true,
  footer,
  closeLabel = 'Close this dialog',
  className,
  children,
}: SheetProps) {
  const { dialogRef, overlayProps, requestClose } = useModalOverlay({
    open,
    onOpenChange,
    dismissible,
    // §7.5 — dismiss tween is 220 ms, which is exactly --duration-base.
    exitDuration: '--duration-base',
  })

  const bodyRef = useRef<HTMLDivElement | null>(null)
  const headingId = useId()
  const descriptionId = useId()

  const { handleProps, didDragRef, reset } = useDragDismiss({
    onDismiss: requestClose,
    enabled: dismissible,
    targetRef: dialogRef,
    scrollRef: bodyRef,
  })

  // Every open starts from a clean transform, whatever the last gesture left.
  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  const handleGrabberClick = useCallback(() => {
    // A drag already decided the outcome; a tap on the grabber closes.
    if (didDragRef.current) {
      didDragRef.current = false
      return
    }
    requestClose()
  }, [didDragRef, requestClose])

  const grabberPill = (
    <span aria-hidden="true" className="block h-1 w-9 rounded-full bg-border-strong" />
  )

  return (
    <dialog
      {...overlayProps}
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        OVERLAY_BASE,
        OVERLAY_BACKDROP,
        'backdrop:duration-(--duration-base)',
        // The backdrop dims in step with the drag. `::backdrop` inherits custom
        // properties from its originating element, so no second write is needed.
        'backdrop:opacity-[max(0.15,calc(1-var(--drag-progress,0)))]',
        'data-dragging:backdrop:transition-none',
        'fixed inset-x-0 bottom-0 top-auto mx-auto my-0 w-full max-w-(--container-customer)',
        'overflow-hidden rounded-t-(--radius-2xl) bg-elevated shadow-float',
        'open:animate-(--animate-sheet-in)',
        // Snap-back and dismiss. `transition-transform` in v4 covers `translate`.
        'translate-y-(--drag-y) transition-transform duration-(--duration-base) ease-(--ease-spring-soft)',
        'data-dragging:transition-none',
        'data-closing:translate-y-full data-closing:ease-(--ease-exit)',
        SHEET_SIZE[size],
        className,
      )}
    >
      {dismissible ? (
        <button
          type="button"
          {...handleProps}
          onClick={handleGrabberClick}
          aria-label={closeLabel}
          className={cn(
            'relative flex w-full shrink-0 touch-none cursor-grab items-center justify-center',
            'pt-2 pb-1 active:cursor-grabbing',
            // §9.2 — the pill is 4 px tall; the grab area is a full tap target.
            // It reaches down over the header, which is exactly where a thumb
            // starts a drag, and the header holds nothing clickable.
            "before:absolute before:inset-x-0 before:top-0 before:h-(--tap-min) before:content-['']",
          )}
        >
          {grabberPill}
        </button>
      ) : (
        <div className="flex w-full shrink-0 items-center justify-center pt-2 pb-1">{grabberPill}</div>
      )}

      <header
        className={cn(
          'shrink-0 border-b px-(--space-gutter-sm) pt-2 pb-3',
          // Gold on the customer surface, a plain rule everywhere else.
          'u-rule-gold',
        )}
      >
        <h2 id={headingId} className="font-display text-title text-text">
          {title}
        </h2>
        {description ? (
          <p id={descriptionId} className="mt-1 text-body-sm text-text-muted">
            {description}
          </p>
        ) : null}
      </header>

      <div
        ref={bodyRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-(--space-gutter-sm) py-4"
      >
        {children}
      </div>

      {footer ? (
        <footer
          className={cn(
            'shrink-0 border-t border-border bg-elevated px-(--space-gutter-sm) pt-3',
            'pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]',
          )}
        >
          {footer}
        </footer>
      ) : null}
    </dialog>
  )
}
