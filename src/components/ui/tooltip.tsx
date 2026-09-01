'use client'

/**
 * Tooltip — a hover/focus hint for a control whose label is already visible.
 *
 * 04-design-system.md has no entry for this component beyond its slot in the
 * file tree (05-app-structure.md), so the rules it does state govern here:
 * §9.3 (focus reaches it), §9.6 (motion is a preference), §8.5 (lucide, never
 * emoji) and §7.1 (opacity and transform only).
 *
 * It is a **hint, never the only source of a name**. An icon-only control gets
 * its name from `IconButton`'s required `label`; a tooltip may repeat or extend
 * that, never replace it. Touch pointers never open it — there is no hover on a
 * phone, and the customer surface has no tooltips at all.
 */

import {
  cloneElement,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils/cn'

export type TooltipSide = 'top' | 'bottom' | 'start' | 'end'

export interface TooltipProps {
  /** Localised, plain text. A tooltip is one short phrase, never markup. */
  content: string
  /** Exactly one focusable element — a `<button>` or an `<a>`. */
  children: ReactNode
  side?: TooltipSide
  /** ms before a hover opens it. Focus always opens immediately. Default 400. */
  delay?: number
  disabled?: boolean
  className?: string
}

const SIDE_POSITION: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
  bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
  start: 'end-full top-1/2 me-2 -translate-y-1/2',
  end: 'start-full top-1/2 ms-2 -translate-y-1/2',
}

const DEFAULT_DELAY_MS = 400

interface DescribableProps {
  'aria-describedby'?: string
}

export function Tooltip({
  content,
  children,
  side = 'top',
  delay = DEFAULT_DELAY_MS,
  disabled = false,
  className,
}: TooltipProps) {
  const [visible, setVisible] = useState(false)
  const timer = useRef<number | null>(null)
  const describedById = useId()

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  useEffect(() => clear, [clear])
  useEffect(() => {
    if (disabled) setVisible(false)
  }, [disabled])

  const open = useCallback(
    (immediate: boolean) => {
      if (disabled) return
      clear()
      if (immediate || delay <= 0) {
        setVisible(true)
        return
      }
      timer.current = window.setTimeout(() => setVisible(true), delay)
    },
    [clear, delay, disabled],
  )

  const close = useCallback(() => {
    clear()
    setVisible(false)
  }, [clear])

  const handlePointerEnter = useCallback(
    (event: ReactPointerEvent<HTMLSpanElement>) => {
      // No hover on a finger; a long-press tooltip is a trap, not a hint.
      if (event.pointerType === 'touch') return
      open(false)
    },
    [open],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLSpanElement>) => {
      if (event.key === 'Escape' && visible) {
        // Dismissible per WCAG 1.4.13, and it must not also close a parent overlay.
        event.stopPropagation()
        close()
      }
    },
    [close, visible],
  )

  /* `aria-describedby` has to land on the interactive child, not on the wrapper,
     so the description is announced with the control. The visual bubble is a
     separate, `aria-hidden` node: a `display: none` element contributes nothing
     to the accessible description, so the text lives in a permanently mounted
     `sr-only` span instead of appearing and disappearing with the bubble. */
  const trigger = isValidElement<DescribableProps>(children)
    ? cloneElement(children, { 'aria-describedby': describedById })
    : children

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={close}
      onFocusCapture={() => open(true)}
      onBlurCapture={close}
      onKeyDown={handleKeyDown}
    >
      {trigger}

      <span id={describedById} className="sr-only">
        {content}
      </span>

      {/* Mounted only while open. A tooltip has no exit tween to owe §7.1: the
          delay before it appears is the considered part, and a fading hint that
          lingers under the pointer is worse than one that simply goes. */}
      {visible ? (
        <span

          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute z-(--z-tooltip) w-max max-w-(--measure-narrow)',
            'rounded-control border border-border bg-elevated-2 px-2 py-1',
            'text-caption text-text shadow-float',
            SIDE_POSITION[side],
            className,
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  )
}
