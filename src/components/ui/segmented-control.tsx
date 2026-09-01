'use client'

/**
 * SegmentedControl — a radio group that looks like a switch
 * (04-design-system.md §6.1).
 *
 * `role="radiogroup"` with `role="radio"` children, deliberately **not** tabs:
 * use `Tabs` when the choice swaps a panel, this when it changes a value
 * (dine-in / takeaway, KDS density, an admin date range).
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils/cn'

import type { StyleWithVars } from './dialog'

export interface SegmentedOption<T extends string> {
  value: T
  /** Localised. */
  label: string
  /** A lucide element, already sized. Decorative — the label carries the meaning. */
  icon?: ReactNode
  disabled?: boolean
}

export type SegmentedControlSize = 'sm' | 'md'

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentedOption<T>[]
  value: T
  onValueChange: (value: T) => void
  /** Localised `aria-label` for the group. */
  label: string
  size?: SegmentedControlSize
  fullWidth?: boolean
  className?: string
}

const SIZE_OPTION: Record<SegmentedControlSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-body-sm',
  md: 'h-10 gap-2 px-4 text-body',
}

interface Thumb {
  x: number
  w: number
  ready: boolean
}

const NO_THUMB: Thumb = { x: 0, w: 0, ready: false }

export function SegmentedControl<T extends string>({
  options,
  value,
  onValueChange,
  label,
  size = 'md',
  fullWidth = false,
  className,
}: SegmentedControlProps<T>) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const [thumb, setThumb] = useState<Thumb>(NO_THUMB)

  const measure = useCallback(() => {
    const track = trackRef.current
    if (!track) return
    const active = track.querySelector<HTMLElement>('[data-segment-active]')
    if (!active) {
      setThumb(NO_THUMB)
      return
    }
    setThumb({ x: active.offsetLeft, w: active.offsetWidth, ready: true })
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, value, options, size, fullWidth])

  useEffect(() => {
    const track = trackRef.current
    if (!track || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(track)
    return () => {
      observer.disconnect()
    }
  }, [measure])

  const selectAt = useCallback(
    (from: number, step: number) => {
      const total = options.length
      if (total === 0) return
      for (let hop = 1; hop <= total; hop += 1) {
        const index = (((from + step * hop) % total) + total) % total
        const candidate = options[index]
        if (candidate && !candidate.disabled) {
          onValueChange(candidate.value)
          trackRef.current
            ?.querySelector<HTMLElement>(`[data-segment-index="${index}"]`)
            ?.focus({ preventScroll: true })
          return
        }
      }
    },
    [onValueChange, options],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (event.key) {
        // A radio group answers both axes; the visual axis is horizontal.
        case 'ArrowRight':
        case 'ArrowDown':
          event.preventDefault()
          selectAt(index, 1)
          break
        case 'ArrowLeft':
        case 'ArrowUp':
          event.preventDefault()
          selectAt(index, -1)
          break
        case 'Home':
          event.preventDefault()
          selectAt(-1, 1)
          break
        case 'End':
          event.preventDefault()
          selectAt(0, -1)
          break
        default:
          break
      }
    },
    [selectAt],
  )

  const thumbStyle: StyleWithVars = {
    '--segment-x': `${thumb.x}px`,
    '--segment-w': `${thumb.w}px`,
  }

  return (
    <div
      ref={trackRef}
      role="radiogroup"
      aria-label={label}
      className={cn(
        'relative inline-flex items-center rounded-control bg-surface-sunken p-1',
        fullWidth && 'flex w-full',
        className,
      )}
    >
      <span
        aria-hidden="true"
        style={thumbStyle}
        className={cn(
          'pointer-events-none absolute inset-y-1 w-(--segment-w) translate-x-(--segment-x)',
          'rounded-control bg-elevated shadow-card',
          'transition-[translate,width] duration-(--duration-fast) ease-(--ease-standard)',
          thumb.ready ? 'opacity-100' : 'opacity-0',
        )}
      />

      {options.map((option, index) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={option.disabled ? true : undefined}
            tabIndex={checked ? 0 : -1}
            data-segment-index={index}
            data-segment-active={checked ? '' : undefined}
            onClick={() => {
              if (option.disabled) return
              onValueChange(option.value)
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'relative z-10 inline-flex shrink-0 items-center justify-center rounded-control',
              'whitespace-nowrap min-h-(--tap-min) admin:min-h-11',
              'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              SIZE_OPTION[size],
              fullWidth && 'flex-1 shrink',
              checked ? 'text-text font-medium' : 'text-text-muted hover:text-text',
              option.disabled && 'pointer-events-none text-text-disabled',
            )}
          >
            {option.icon ? (
              <span aria-hidden="true" className="u-icon-align">
                {option.icon}
              </span>
            ) : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
