'use client'

/**
 * Tabs — the full ARIA tabs pattern, by hand (04-design-system.md §6.1).
 *
 * Use `Tabs` when the choice swaps a *panel*. When it changes a *value*, use
 * `SegmentedControl` instead.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'

import { cn } from '@/lib/utils/cn'

import { Badge } from './badge'
import type { StyleWithVars } from './dialog'

export interface TabItem {
  id: string
  /** Localised. */
  label: string
  count?: number
  disabled?: boolean
}

export type TabsVariant = 'underline' | 'enclosed'
export type TabsSize = 'sm' | 'md' | 'lg'

export interface TabsProps {
  items: readonly TabItem[]
  value: string
  onValueChange: (id: string) => void
  variant?: TabsVariant
  size?: TabsSize
  /** Localised `aria-label` for the tablist. */
  label: string
  /**
   * Namespace for the generated `id`s. Supply it and each tab gains
   * `aria-controls={tabPanelId(idPrefix, item.id)}`; the caller must then render
   * panels with those ids. Omit it and `aria-controls` is left off rather than
   * pointing at an element that does not exist.
   */
  idPrefix?: string
  className?: string
}

export const tabTriggerId = (prefix: string, itemId: string): string => `${prefix}-tab-${itemId}`
export const tabPanelId = (prefix: string, itemId: string): string => `${prefix}-panel-${itemId}`

const SIZE_TRIGGER: Record<TabsSize, string> = {
  sm: 'h-9 px-3 text-body-sm',
  md: 'h-11 px-4 text-body',
  lg: 'h-14 px-5 text-body-lg',
}

const SIZE_TRACK: Record<TabsSize, string> = {
  sm: 'gap-1',
  md: 'gap-1',
  lg: 'gap-2',
}

interface Indicator {
  x: number
  w: number
  ready: boolean
}

const NO_INDICATOR: Indicator = { x: 0, w: 0, ready: false }

export function Tabs({
  items,
  value,
  onValueChange,
  variant = 'underline',
  size = 'md',
  label,
  idPrefix,
  className,
}: TabsProps) {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [indicator, setIndicator] = useState<Indicator>(NO_INDICATOR)

  const measure = useCallback(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector<HTMLElement>('[data-tab-active]')
    if (!active) {
      setIndicator(NO_INDICATOR)
      return
    }
    // offsetLeft is relative to the tablist (which is `relative`), so the
    // indicator scrolls with the tabs without a scroll listener.
    setIndicator({ x: active.offsetLeft, w: active.offsetWidth, ready: true })
  }, [])

  useLayoutEffect(() => {
    measure()
  }, [measure, value, items, variant, size])

  useEffect(() => {
    const list = listRef.current
    if (!list || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => measure())
    observer.observe(list)
    const active = list.querySelector<HTMLElement>('[data-tab-active]')
    if (active) observer.observe(active)
    return () => {
      observer.disconnect()
    }
  }, [measure, value, items])

  /* Keep the selected tab in view when the rail overflows. §7.8 — the smooth
     behaviour is a preference read, never a hard-coded 'smooth'. */
  useEffect(() => {
    const list = listRef.current
    const active = list?.querySelector<HTMLElement>('[data-tab-active]')
    if (!active) return
    const reduced =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    active.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', inline: 'nearest', block: 'nearest' })
  }, [value])

  const move = useCallback(
    (from: number, step: number) => {
      const total = items.length
      if (total === 0) return
      for (let hop = 1; hop <= total; hop += 1) {
        const index = (((from + step * hop) % total) + total) % total
        const candidate = items[index]
        if (candidate && !candidate.disabled) {
          onValueChange(candidate.id)
          listRef.current
            ?.querySelector<HTMLElement>(`[data-tab-index="${index}"]`)
            ?.focus({ preventScroll: true })
          return
        }
      }
    },
    [items, onValueChange],
  )

  const edge = useCallback(
    (direction: 'first' | 'last') => {
      const ordered = direction === 'first' ? items : [...items].reverse()
      const target = ordered.find((item) => !item.disabled)
      if (!target) return
      const index = items.indexOf(target)
      onValueChange(target.id)
      listRef.current
        ?.querySelector<HTMLElement>(`[data-tab-index="${index}"]`)
        ?.focus({ preventScroll: true })
    },
    [items, onValueChange],
  )

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
      switch (event.key) {
        case 'ArrowRight':
          event.preventDefault()
          move(index, 1)
          break
        case 'ArrowLeft':
          event.preventDefault()
          move(index, -1)
          break
        case 'Home':
          event.preventDefault()
          edge('first')
          break
        case 'End':
          event.preventDefault()
          edge('last')
          break
        default:
          break
      }
    },
    [edge, move],
  )

  const indicatorStyle: StyleWithVars = {
    '--tab-x': `${indicator.x}px`,
    '--tab-w': `${indicator.w}px`,
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        'relative flex snap-x snap-proximity items-center overflow-x-auto u-edge-fade',
        SIZE_TRACK[size],
        variant === 'underline' && 'border-b border-border',
        variant === 'enclosed' && 'rounded-control bg-surface-sunken p-1',
        className,
      )}
    >
      <span
        aria-hidden="true"
        style={indicatorStyle}
        className={cn(
          'pointer-events-none absolute w-(--tab-w) translate-x-(--tab-x)',
          'transition-[translate,width] duration-(--duration-base) ease-(--ease-standard)',
          indicator.ready ? 'opacity-100' : 'opacity-0',
          variant === 'underline' && 'bottom-0 h-0.5 bg-accent',
          variant === 'enclosed' && 'inset-y-1 rounded-control bg-elevated shadow-card',
        )}
      />

      {items.map((item, index) => {
        const selected = item.id === value
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            id={idPrefix ? tabTriggerId(idPrefix, item.id) : undefined}
            aria-selected={selected}
            aria-controls={idPrefix ? tabPanelId(idPrefix, item.id) : undefined}
            aria-disabled={item.disabled ? true : undefined}
            tabIndex={selected ? 0 : -1}
            data-tab-index={index}
            data-tab-active={selected ? '' : undefined}
            onClick={() => {
              if (item.disabled) return
              onValueChange(item.id)
            }}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'relative z-10 inline-flex shrink-0 snap-start items-center justify-center gap-2',
              'rounded-control whitespace-nowrap min-h-(--tap-min) admin:min-h-11',
              'transition-colors duration-(--duration-fast) ease-(--ease-standard)',
              SIZE_TRIGGER[size],
              selected ? 'text-text font-medium' : 'text-text-muted hover:text-text',
              item.disabled && 'pointer-events-none text-text-disabled',
            )}
          >
            {item.label}
            {typeof item.count === 'number' ? (
              <Badge tone="neutral" size="sm" className="u-tnum">
                {item.count}
              </Badge>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}
