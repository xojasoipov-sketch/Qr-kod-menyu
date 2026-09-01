'use client'

/**
 * Dialog — centred modal, and the shared native-<dialog> engine every overlay in
 * this system is built on (04-design-system.md §6.1, §9.3).
 *
 * `useModalOverlay` is exported because Sheet, Drawer and ConfirmDialog need the
 * exact same open/close/Escape/backdrop/focus-return behaviour. Everything it
 * gives us comes from the platform: focus trapping, `inert` on the rest of the
 * page, top-layer promotion (so no z-index fight), `::backdrop`, and scroll
 * blocking. We never set `overflow: hidden` on <body> — that breaks iOS Safari's
 * URL-bar collapse and makes the sheet jump (§6.1 Sheet, States).
 */

import { X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'

import { cn } from '@/lib/utils/cn'

import { IconButton } from './button'

/* ────────────────────────────────────────────────────────────────────────────
   Shared helpers
   ──────────────────────────────────────────────────────────────────────────── */

/** A `style` object that may carry design-token custom properties (§12 C-4). */
export type StyleWithVars = CSSProperties & Record<`--${string}`, string | number>

/** The duration tokens an overlay is allowed to exit on. */
export type OverlayDurationToken =
  | '--duration-instant'
  | '--duration-fast'
  | '--duration-base'
  | '--duration-slow'

/** Reads the live preference. Not cached: a user can flip it mid-session. */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Resolves a duration token off the element's own computed style, so the exit
 * timer and the CSS transition can never drift apart (§8.13 — no hard-coded
 * durations in a component). Returns 0 under reduced motion, where the global
 * rule in globals.css has already collapsed every transition to 1 ms.
 */
function resolveDurationMs(el: Element, token: OverlayDurationToken): number {
  if (prefersReducedMotion()) return 0
  const raw = getComputedStyle(el).getPropertyValue(token).trim()
  if (raw.endsWith('ms')) return Number.parseFloat(raw) || 0
  if (raw.endsWith('s')) return (Number.parseFloat(raw) || 0) * 1000
  return 0
}

/* ────────────────────────────────────────────────────────────────────────────
   useModalOverlay — the engine
   ──────────────────────────────────────────────────────────────────────────── */

export interface UseModalOverlayOptions {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** `false` blocks Escape and backdrop dismissal. */
  dismissible: boolean
  /** How long the exit animation runs before `close()`. Default `--duration-fast`. */
  exitDuration?: OverlayDurationToken
}

export interface ModalOverlayProps {
  ref: RefObject<HTMLDialogElement | null>
  onPointerDown: (event: ReactPointerEvent<HTMLDialogElement>) => void
  onClick: (event: ReactMouseEvent<HTMLDialogElement>) => void
  'data-closing': '' | undefined
}

export interface ModalOverlay {
  dialogRef: RefObject<HTMLDialogElement | null>
  /** True while the exit animation is playing. Drives `data-closing`. */
  closing: boolean
  /** Ask the owner to close. Always routed through `onOpenChange`, never `close()`. */
  requestClose: () => void
  /** Spread onto the `<dialog>` element. */
  overlayProps: ModalOverlayProps
}

export function useModalOverlay(options: UseModalOverlayOptions): ModalOverlay {
  const { open, onOpenChange, dismissible, exitDuration = '--duration-fast' } = options

  const dialogRef = useRef<HTMLDialogElement | null>(null)
  const [closing, setClosing] = useState(false)

  const exitTimer = useRef<number | null>(null)
  // Read inside native event listeners that are registered once.
  const openRef = useRef(open)
  openRef.current = open
  const onOpenChangeRef = useRef(onOpenChange)
  onOpenChangeRef.current = onOpenChange
  const dismissibleRef = useRef(dismissible)
  dismissibleRef.current = dismissible

  const clearExitTimer = useCallback(() => {
    if (exitTimer.current !== null) {
      window.clearTimeout(exitTimer.current)
      exitTimer.current = null
    }
  }, [])

  const requestClose = useCallback(() => {
    onOpenChangeRef.current(false)
  }, [])

  /* Open and close. The element stays mounted; only `showModal()`/`close()` move. */
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    if (open) {
      clearExitTimer()
      setClosing(false)
      if (!el.open) {
        el.showModal()
        // §9.3 — initial focus is explicit. `[data-autofocus]` wins; otherwise the
        // platform focuses the first focusable descendant, which is what we want.
        const preferred = el.querySelector<HTMLElement>('[data-autofocus]')
        preferred?.focus({ preventScroll: true })
      }
      return
    }

    if (!el.open) return
    setClosing(true)
    const ms = resolveDurationMs(el, exitDuration)
    clearExitTimer()
    exitTimer.current = window.setTimeout(() => {
      exitTimer.current = null
      setClosing(false)
      const current = dialogRef.current
      if (current?.open) current.close()
    }, ms)
  }, [open, exitDuration, clearExitTimer])

  /* Unmount: never leave a timer or an open top-layer element behind. */
  useEffect(
    () => () => {
      clearExitTimer()
      const el = dialogRef.current
      if (el?.open) el.close()
    },
    [clearExitTimer],
  )

  /* Escape (`cancel`) and any close the platform performs on its own. */
  useEffect(() => {
    const el = dialogRef.current
    if (!el) return

    const handleCancel = (event: Event) => {
      // We own the exit animation, so the browser must not close synchronously.
      event.preventDefault()
      if (dismissibleRef.current) onOpenChangeRef.current(false)
    }
    const handleClose = () => {
      // Reached only if something closed the dialog behind our back.
      if (openRef.current) onOpenChangeRef.current(false)
    }

    el.addEventListener('cancel', handleCancel)
    el.addEventListener('close', handleClose)
    return () => {
      el.removeEventListener('cancel', handleCancel)
      el.removeEventListener('close', handleClose)
    }
  }, [])

  /* Backdrop dismissal. A click on `::backdrop` is dispatched to the <dialog>
     itself, so `target === currentTarget` identifies it exactly — provided the
     element carries no padding of its own, which is why every overlay below is
     `p-0`. The pointerdown guard stops a drag that *ends* on the backdrop from
     counting as a backdrop click. */
  const downOnBackdrop = useRef(false)

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDialogElement>) => {
    downOnBackdrop.current = event.target === event.currentTarget
  }, [])

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLDialogElement>) => {
      const onBackdrop = event.target === event.currentTarget && downOnBackdrop.current
      downOnBackdrop.current = false
      if (onBackdrop && dismissibleRef.current) onOpenChangeRef.current(false)
    },
    [],
  )

  return {
    dialogRef,
    closing,
    requestClose,
    overlayProps: {
      ref: dialogRef,
      onPointerDown,
      onClick,
      'data-closing': closing ? '' : undefined,
    },
  }
}

/* ────────────────────────────────────────────────────────────────────────────
   Overlay chrome shared by Dialog, Sheet and Drawer
   ──────────────────────────────────────────────────────────────────────────── */

/**
 * The backdrop recipe. `::backdrop` inherits from its originating element in
 * current browsers, which is what lets Sheet express its opacity as a function
 * of the drag distance without a second write (§7.5).
 */
export const OVERLAY_BACKDROP =
  'backdrop:bg-scrim backdrop:transition-opacity backdrop:ease-(--ease-standard) data-closing:backdrop:opacity-0'

/** `hidden` + `open:flex` — author styles beat the UA `dialog:not([open])` rule. */
export const OVERLAY_BASE = 'hidden open:flex flex-col p-0 text-text'

export interface OverlayCloseButtonProps {
  /** Localised. Becomes both `aria-label` and `title`. */
  label: string
  onClick: () => void
  className?: string
}

/**
 * The one place the overlay close glyph is chosen. §5 fixes it to `X`;
 * `IconButton` supplies the required label and the 44 px hit area (§9.2).
 */
export function OverlayCloseButton({ label, onClick, className }: OverlayCloseButtonProps) {
  return (
    <IconButton
      label={label}
      onClick={onClick}
      variant="ghost"
      size="md"
      className={className}
      icon={<X aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-5" />}
    />
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Dialog
   ──────────────────────────────────────────────────────────────────────────── */

export type DialogSize = 'sm' | 'md' | 'lg'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Localised. Rendered as the heading and used as the accessible name. */
  title: string
  description?: string
  size?: DialogSize
  /** `false` blocks Escape and backdrop dismissal; supply your own cancel control. */
  dismissible?: boolean
  /** Sticky, below the scrolling body. */
  footer?: ReactNode
  /** Localised label for the close control. Defaults to the English `a11y.closeDialog`. */
  closeLabel?: string
  className?: string
  /** Optional: a confirm dialog with nothing but a title, a description and two
      buttons renders header + footer and no scrolling body at all. */
  children?: ReactNode
}

const DIALOG_SIZE: Record<DialogSize, string> = {
  sm: 'max-w-[380px]',
  md: 'max-w-[520px]',
  lg: 'max-w-[720px]',
}

/**
 * Admin and KDS only. The customer surface gets a `Sheet` (§12 C-13).
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  size = 'md',
  dismissible = true,
  footer,
  closeLabel = 'Close this dialog',
  className,
  children,
}: DialogProps) {
  const { overlayProps, requestClose } = useModalOverlay({
    open,
    onOpenChange,
    dismissible,
    exitDuration: '--duration-fast',
  })

  const headingId = useId()
  const descriptionId = useId()

  return (
    <dialog
      {...overlayProps}
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        OVERLAY_BASE,
        OVERLAY_BACKDROP,
        'backdrop:duration-(--duration-fast)',
        'fixed inset-0 m-auto h-fit max-h-[88svh] w-[calc(100%-2rem)]',
        'overflow-hidden rounded-(--radius-lg) border border-border bg-elevated shadow-float',
        'open:animate-(--animate-dialog-in)',
        'transition-opacity duration-(--duration-fast) ease-(--ease-exit) data-closing:opacity-0',
        DIALOG_SIZE[size],
        className,
      )}
    >
      <header className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-title text-text">
            {title}
          </h2>
          {description ? (
            <p id={descriptionId} className="mt-1 text-body-sm text-text-muted">
              {description}
            </p>
          ) : null}
        </div>
        {dismissible ? <OverlayCloseButton label={closeLabel} onClick={requestClose} /> : null}
      </header>

      {children != null ? (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>
      ) : null}

      {footer ? (
        <footer className="flex flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4">
          {footer}
        </footer>
      ) : null}
    </dialog>
  )
}
