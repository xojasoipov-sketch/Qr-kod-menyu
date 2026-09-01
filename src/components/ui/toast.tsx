'use client'

/**
 * Toast — the store, the imperative API and `<Toaster />`
 * (04-design-system.md §6.1, §7.6, §9.5).
 *
 * No dependency: a module-level store read through `useSyncExternalStore`. The
 * store is pure data; the Toaster owns the timers, because pause-on-hover and
 * pause-on-focus are presentation concerns and a second Toaster must never
 * double-expire the same toast.
 *
 * Announcement (§9.5, hard rule 1): the visible stack is **not** a live region —
 * it reorders and removes, and a live list re-announces everything on every
 * change. Two `sr-only` paragraphs are mounted empty by the Toaster and receive
 * the toast's sentence instead, so nothing ever steals focus.
 */

import { Bell, CircleCheck, Info, TriangleAlert, X, XCircle, type LucideIcon } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'

import { cn } from '@/lib/utils/cn'

import { Button, IconButton } from './button'

/* ────────────────────────────────────────────────────────────────────────────
   Types
   ──────────────────────────────────────────────────────────────────────────── */

export type ToastTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export interface ToastAction {
  /** Localised. */
  label: string
  onClick: () => void
}

export interface ToastInput {
  tone?: ToastTone
  /** Localised. */
  title: string
  description?: string
  /** ms. `0` is sticky. Omitted resolves per surface (4000, or 6000 on the KDS). */
  duration?: number
  action?: ToastAction
  /** Supplying an existing id updates that toast in place and restarts its timer. */
  id?: string
}

export interface ToastRecord {
  id: string
  tone: ToastTone
  title: string
  description?: string
  duration?: number
  action?: ToastAction
  /** Bumped on every in-place update; restarts the timer. */
  revision: number
}

/* ────────────────────────────────────────────────────────────────────────────
   Store
   ──────────────────────────────────────────────────────────────────────────── */

/** §6.1 — max 3 visible; a 4th replaces the oldest. */
export const MAX_VISIBLE_TOASTS = 3

const EMPTY: readonly ToastRecord[] = Object.freeze([])

let records: readonly ToastRecord[] = EMPTY
let sequence = 0

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

const getSnapshot = (): readonly ToastRecord[] => records
const getServerSnapshot = (): readonly ToastRecord[] => EMPTY

function nextId(): string {
  sequence += 1
  return `toast-${sequence}`
}

function push(input: ToastInput): string {
  const id = input.id ?? nextId()
  const existing = records.find((record) => record.id === id)

  const next: ToastRecord = {
    id,
    tone: input.tone ?? 'neutral',
    title: input.title,
    description: input.description,
    duration: input.duration,
    action: input.action,
    revision: (existing?.revision ?? 0) + 1,
  }

  records = existing
    ? records.map((record) => (record.id === id ? next : record))
    : [...records, next].slice(-MAX_VISIBLE_TOASTS)

  emit()
  return id
}

export interface ToastFn {
  (input: ToastInput): string
  success(title: string, input?: Omit<ToastInput, 'title' | 'tone'>): string
  /** Maps to the `danger` tone — the ramp is named for the colour, not the event. */
  error(title: string, input?: Omit<ToastInput, 'title' | 'tone'>): string
  warning(title: string, input?: Omit<ToastInput, 'title' | 'tone'>): string
  info(title: string, input?: Omit<ToastInput, 'title' | 'tone'>): string
  neutral(title: string, input?: Omit<ToastInput, 'title' | 'tone'>): string
}

const withTone =
  (tone: ToastTone) =>
  (title: string, input: Omit<ToastInput, 'title' | 'tone'> = {}): string =>
    push({ ...input, title, tone })

export const toast: ToastFn = Object.assign((input: ToastInput) => push(input), {
  success: withTone('success'),
  error: withTone('danger'),
  warning: withTone('warning'),
  info: withTone('info'),
  neutral: withTone('neutral'),
})

export function dismissToast(id: string): void {
  const next = records.filter((record) => record.id !== id)
  if (next.length === records.length) return
  records = next
  emit()
}

export function dismissAllToasts(): void {
  if (records.length === 0) return
  records = EMPTY
  emit()
}

export function useToasts(): readonly ToastRecord[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}

/* ────────────────────────────────────────────────────────────────────────────
   Presentation
   ──────────────────────────────────────────────────────────────────────────── */

const TONE_ICON: Record<ToastTone, LucideIcon> = {
  neutral: Bell,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: XCircle,
  info: Info,
}

const TONE_ACCENT: Record<ToastTone, string> = {
  neutral: 'text-text-muted',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  info: 'text-info',
}

const TONE_EDGE: Record<ToastTone, string> = {
  neutral: 'border-border',
  success: 'border-success-line',
  warning: 'border-warning-line',
  danger: 'border-danger-line',
  info: 'border-info-line',
}

/** §9.5 — `assertive` is spent sparingly. Only these two tones get it. */
const ASSERTIVE_TONES: ReadonlySet<ToastTone> = new Set<ToastTone>(['warning', 'danger'])

const DEFAULT_DURATION_MS = 4000
const KDS_DURATION_MS = 6000
/** §6.1 — a toast carrying an action never auto-dismisses in under 6 s. */
const MIN_ACTION_DURATION_MS = 6000

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function readSurface(): string {
  if (typeof document === 'undefined') return 'admin'
  return document.documentElement.dataset['surface'] ?? 'admin'
}

function resolveDuration(record: ToastRecord, surface: string): number {
  const base = record.duration ?? (surface === 'kitchen' ? KDS_DURATION_MS : DEFAULT_DURATION_MS)
  if (base <= 0) return Number.POSITIVE_INFINITY
  return record.action ? Math.max(base, MIN_ACTION_DURATION_MS) : base
}

function sentenceFor(record: ToastRecord): string {
  return record.description ? `${record.title}. ${record.description}` : record.title
}

/* ────────────────────────────────────────────────────────────────────────────
   ToastItem
   ──────────────────────────────────────────────────────────────────────────── */

interface ToastItemProps {
  record: ToastRecord
  duration: number
  paused: boolean
  dismissLabel: string
}

function ToastItem({ record, duration, paused, dismissLabel }: ToastItemProps) {
  const Icon = TONE_ICON[record.tone]
  const [exiting, setExiting] = useState(false)
  const remaining = useRef(duration)
  const nodeRef = useRef<HTMLLIElement | null>(null)

  // An in-place update restarts the clock.
  useEffect(() => {
    remaining.current = duration
    setExiting(false)
  }, [duration, record.revision])

  // Auto-dismiss, paused on hover and on focus within (§6.1, States).
  useEffect(() => {
    if (exiting || paused || !Number.isFinite(remaining.current)) return
    const startedAt = Date.now()
    const timer = window.setTimeout(() => setExiting(true), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - startedAt))
    }
  }, [exiting, paused, record.revision])

  // Exit tween, then removal. Duration comes off the element so it can never
  // drift from the CSS.
  useEffect(() => {
    if (!exiting) return
    const node = nodeRef.current
    let ms = 0
    if (node && !prefersReducedMotion()) {
      const raw = getComputedStyle(node).getPropertyValue('--duration-fast').trim()
      ms = raw.endsWith('ms') ? Number.parseFloat(raw) || 0 : (Number.parseFloat(raw) || 0) * 1000
    }
    const timer = window.setTimeout(() => dismissToast(record.id), ms)
    return () => {
      window.clearTimeout(timer)
    }
  }, [exiting, record.id])

  return (
    <li
      ref={nodeRef}
      data-toast-tone={record.tone}
      className={cn(
        'pointer-events-auto w-full max-w-(--measure-narrow) kds:max-w-none kds:w-[34rem]',
        'flex items-start gap-3 rounded-card border bg-elevated p-3 shadow-float',
        'kds:gap-4 kds:p-5',
        TONE_EDGE[record.tone],
        'animate-(--animate-toast-in)',
        'transition duration-(--duration-fast) ease-(--ease-exit)',
        exiting && 'translate-y-2 opacity-0',
      )}
    >
      <Icon
        aria-hidden={true}
        focusable="false"
        strokeWidth={1.75}
        className={cn('size-5 shrink-0 u-icon-align kds:size-8', TONE_ACCENT[record.tone])}
      />

      <div className="min-w-0 flex-1">
        <p className="text-body text-text kds:text-kds-md">{record.title}</p>
        {record.description ? (
          <p className="mt-0.5 text-body-sm text-text-muted kds:text-kds-sm">{record.description}</p>
        ) : null}
        {record.action ? (
          <Button
            variant="link"
            size="sm"
            className="mt-2"
            onClick={() => {
              record.action?.onClick()
              setExiting(true)
            }}
          >
            {record.action.label}
          </Button>
        ) : null}
      </div>

      <IconButton
        label={dismissLabel}
        variant="ghost"
        size="sm"
        onClick={() => setExiting(true)}
        icon={<X aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
      />
    </li>
  )
}

/* ────────────────────────────────────────────────────────────────────────────
   Toaster
   ──────────────────────────────────────────────────────────────────────────── */

export interface ToasterProps {
  /** Localised `aria-label` for the notifications region. */
  label?: string
  /** Localised `aria-label` for each toast's dismiss control. */
  dismissLabel?: string
  className?: string
}

/**
 * Mounted once per surface layout (§12 C-5). Placement follows the surface:
 * bottom-centre above the CartBar on customer, top-end on admin, top-centre on
 * the KDS.
 */
export function Toaster({
  label = 'Notifications',
  dismissLabel = 'Dismiss',
  className,
}: ToasterProps) {
  const toasts = useToasts()
  const [paused, setPaused] = useState(false)

  // Surface is stable for the life of the document but unknown during SSR.
  const [surface, setSurface] = useState('admin')
  useEffect(() => {
    setSurface(readSurface())
  }, [])

  const [politeMessage, setPoliteMessage] = useState('')
  const [assertiveMessage, setAssertiveMessage] = useState('')
  const announced = useRef(new Map<string, number>())

  useEffect(() => {
    const live = new Set(toasts.map((record) => record.id))
    for (const id of announced.current.keys()) {
      if (!live.has(id)) announced.current.delete(id)
    }
    for (const record of toasts) {
      if (announced.current.get(record.id) === record.revision) continue
      announced.current.set(record.id, record.revision)
      const sentence = sentenceFor(record)
      if (ASSERTIVE_TONES.has(record.tone)) setAssertiveMessage(sentence)
      else setPoliteMessage(sentence)
    }
  }, [toasts])

  const pause = useCallback(() => setPaused(true), [])
  const resume = useCallback(() => setPaused(false), [])

  return (
    <div role="region" aria-label={label}>
      {/* Mounted empty, before anything can change (§9.5, hard rule 2). */}
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {politeMessage}
      </p>
      <p className="sr-only" aria-live="assertive" aria-atomic="true" role="alert">
        {assertiveMessage}
      </p>

      <ol
        onPointerEnter={pause}
        onPointerLeave={resume}
        onFocusCapture={pause}
        onBlurCapture={resume}
        className={cn(
          'pointer-events-none fixed z-(--z-toast) flex flex-col-reverse items-end gap-2 p-4',
          // admin (and the no-surface default): top, inline end
          'top-0 end-0',
          // customer: bottom-centre, clear of the CartBar
          'customer:inset-x-0 customer:end-auto customer:top-auto customer:bottom-(--space-safe-bottom)',
          'customer:flex-col customer:items-center',
          // kitchen: top-centre
          'kds:inset-x-0 kds:end-auto kds:items-center',
          className,
        )}
      >
        {toasts.map((record) => (
          <ToastItem
            key={record.id}
            record={record}
            duration={resolveDuration(record, surface)}
            paused={paused}
            dismissLabel={dismissLabel}
          />
        ))}
      </ol>
    </div>
  )
}
