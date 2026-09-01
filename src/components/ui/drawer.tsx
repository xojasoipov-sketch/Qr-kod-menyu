'use client'

/**
 * Drawer — edge panel for admin (order detail, item editor, filters).
 * 04-design-system.md §6.1.
 *
 * Below the `md` breakpoint it degrades to a `Sheet` internally, so no caller
 * ever has to branch on viewport. The swap is driven by `useSyncExternalStore`
 * over `matchMedia`, which gives a stable server snapshot and therefore no
 * hydration warning.
 */

import {
  useCallback,
  useEffect,
  useId,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils/cn'

import { OVERLAY_BACKDROP, OVERLAY_BASE, OverlayCloseButton, useModalOverlay } from './dialog'
import { Sheet } from './sheet'

const WIDE_QUERY = '(min-width: 768px)'

function subscribeToWide(onChange: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const list = window.matchMedia(WIDE_QUERY)
  list.addEventListener('change', onChange)
  return () => {
    list.removeEventListener('change', onChange)
  }
}

function isWideNow(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia(WIDE_QUERY).matches
}

/** Desktop is the server snapshot: Drawer is an admin component and admin is desktop. */
const WIDE_ON_SERVER = true

export function useIsWideViewport(): boolean {
  return useSyncExternalStore(subscribeToWide, isWideNow, () => WIDE_ON_SERVER)
}

/* ────────────────────────────────────────────────────────────────────────────
   Drawer
   ──────────────────────────────────────────────────────────────────────────── */

export type DrawerSide = 'left' | 'right'
export type DrawerWidth = 'sm' | 'md' | 'lg'

export interface DrawerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Logical: `left` resolves to the inline start edge, `right` to the inline end. */
  side?: DrawerSide
  /** Localised. Rendered as the heading and used as the accessible name. */
  title: string
  description?: string
  width?: DrawerWidth
  dismissible?: boolean
  footer?: ReactNode
  closeLabel?: string
  className?: string
  children: ReactNode
}

const DRAWER_WIDTH: Record<DrawerWidth, string> = {
  sm: 'w-[320px]',
  md: 'w-[420px]',
  lg: 'w-[560px]',
}

const DRAWER_EDGE: Record<DrawerSide, string> = {
  left: 'start-0 end-auto',
  right: 'end-0 start-auto',
}

/** Resting position before entrance and after exit. */
const DRAWER_OFFSCREEN: Record<DrawerSide, string> = {
  left: '-translate-x-full',
  right: 'translate-x-full',
}

export function Drawer(props: DrawerProps) {
  const isWide = useIsWideViewport()
  if (!isWide) {
    return (
      <Sheet
        open={props.open}
        onOpenChange={props.onOpenChange}
        title={props.title}
        description={props.description}
        size="tall"
        dismissible={props.dismissible ?? true}
        footer={props.footer}
        closeLabel={props.closeLabel}
        className={props.className}
      >
        {props.children}
      </Sheet>
    )
  }
  return <DrawerPanel {...props} />
}

function DrawerPanel({
  open,
  onOpenChange,
  side = 'right',
  title,
  description,
  width = 'md',
  dismissible = true,
  footer,
  closeLabel = 'Close this dialog',
  className,
  children,
}: DrawerProps) {
  const { overlayProps, requestClose } = useModalOverlay({
    open,
    onOpenChange,
    dismissible,
    exitDuration: '--duration-base',
  })

  const headingId = useId()
  const descriptionId = useId()

  /* There is no `drawer-in` keyframe in §7.6, so the entrance is a transition:
     the panel is mounted off-screen, then flipped on the next frame. Two rAFs so
     the first paint of the shown dialog has definitely happened. */
  const [entered, setEntered] = useState(false)
  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    let inner = 0
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setEntered(true))
    })
    return () => {
      cancelAnimationFrame(outer)
      cancelAnimationFrame(inner)
    }
  }, [open])

  const handleClose = useCallback(() => {
    requestClose()
  }, [requestClose])

  return (
    <dialog
      {...overlayProps}
      data-entered={entered ? '' : undefined}
      aria-labelledby={headingId}
      aria-describedby={description ? descriptionId : undefined}
      className={cn(
        OVERLAY_BASE,
        OVERLAY_BACKDROP,
        'backdrop:duration-(--duration-slow) backdrop:opacity-0 data-entered:backdrop:opacity-100',
        'fixed inset-y-0 my-0 h-full max-h-none max-w-full',
        'border-border bg-elevated shadow-float',
        side === 'right' ? 'border-s' : 'border-e',
        DRAWER_EDGE[side],
        DRAWER_WIDTH[width],
        'transition-transform duration-(--duration-slow) ease-(--ease-entrance)',
        DRAWER_OFFSCREEN[side],
        'data-entered:translate-x-0',
        'data-closing:duration-(--duration-base) data-closing:ease-(--ease-exit)',
        className,
      )}
    >
      <header className="flex shrink-0 items-start gap-3 border-b border-border px-5 py-4">
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
        {dismissible ? <OverlayCloseButton label={closeLabel} onClick={handleClose} /> : null}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">{children}</div>

      {footer ? (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-border px-5 py-4">
          {footer}
        </footer>
      ) : null}
    </dialog>
  )
}
