'use client'

/**
 * src/components/customer/category-rail.tsx — CategoryRail.
 * Source: docs/architecture/04-design-system.md §6.2, §7.7, §8.4.
 *
 * A horizontally scrolling, scroll-snapping rail that sticks under the header.
 * It is one of exactly two places `backdrop-filter` is permitted (§8.4), and it
 * carries the one gold hairline signature of the customer surface along its
 * bottom edge.
 *
 * `activeId` is entirely self-managed by an `IntersectionObserver` over the
 * category section headings already in the DOM (their `id` is the category
 * id) — the menu page never has to lift this state. Selecting a chip scrolls
 * the matching section into view and scrolls the chip itself into view, so the
 * active chip is never off-screen even mid-flick.
 */

import { useEffect, useRef, useState } from 'react'

import { prefersReducedMotion } from '@/components/ui/dialog'
import { useT } from '@/lib/i18n/provider'
import { cn } from '@/lib/utils/cn'

export interface CategoryRailItem {
  id: string
  label: string
  count: number
}

export interface CategoryRailProps {
  items: readonly CategoryRailItem[]
  className?: string
}

export function CategoryRail({ items, className }: CategoryRailProps): React.JSX.Element | null {
  const t = useT()
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null)
  const railRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (items.length === 0) return undefined

    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null)
    if (sections.length === 0) return undefined

    let debounce: ReturnType<typeof setTimeout> | null = null
    const observer = new IntersectionObserver(
      (entries) => {
        if (debounce) clearTimeout(debounce)
        debounce = setTimeout(() => {
          const visible = entries
            .filter((entry) => entry.isIntersecting)
            .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
          const top = visible[0]
          if (top) setActiveId(top.target.id)
        }, 120)
      },
      { rootMargin: '-30% 0px -55% 0px', threshold: [0, 1] },
    )
    for (const section of sections) observer.observe(section)
    return () => {
      if (debounce) clearTimeout(debounce)
      observer.disconnect()
    }
  }, [items])

  useEffect(() => {
    if (activeId === null) return
    railRef.current
      ?.querySelector<HTMLElement>(`[data-category-id="${activeId}"]`)
      ?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', inline: 'center', block: 'nearest' })
  }, [activeId])

  if (items.length === 0) return null

  const select = (id: string): void => {
    setActiveId(id)
    document.getElementById(id)?.scrollIntoView({
      block: 'start',
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    })
  }

  return (
    <div
      className={cn(
        'u-chrome-blur u-rule-gold sticky top-(--space-header-h) z-(--z-rail) w-full border-b',
        className,
      )}
    >
      <div
        ref={railRef}
        role="tablist"
        aria-label={t('customer.menu.categoriesTitle')}
        className="u-edge-fade flex gap-2 overflow-x-auto px-(--space-gutter-sm) py-2"
      >
        {items.map((item) => {
          const active = item.id === activeId
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-category-id={item.id}
              onClick={() => select(item.id)}
              className={cn(
                'inline-flex min-h-(--tap-min) shrink-0 items-center gap-1.5 rounded-full px-3.5 text-body-sm',
                'transition-colors duration-(--duration-fast) ease-standard',
                active
                  ? 'border border-accent-line bg-accent-soft text-accent'
                  : 'border border-transparent bg-surface-sunken text-text-muted',
              )}
            >
              <span>{item.label}</span>
              <span className="u-tnum text-caption text-text-subtle">{item.count}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
