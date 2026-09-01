'use client'

/**
 * The customer's cart: a reducer plus localStorage persistence, keyed by QR token.
 *
 * Three properties this design is built around.
 *
 * 1. NOTHING HERE IS AUTHORITATIVE. Every price in the cart is a copy taken
 *    from the menu so the diner sees a total before committing. The order's
 *    real total is whatever `public_place_order` computes from `menu_items.price`
 *    inside its own transaction. A tampered cart therefore changes what the
 *    diner *sees*, never what they are *charged*.
 * 2. A CART BELONGS TO A TABLE. It is stored under the QR token, so scanning a
 *    different table opens a different cart rather than carrying the previous
 *    table's food to a new bill.
 * 3. THE IDEMPOTENCY KEY IS BORN WITH THE CART, not at submit time. That is what
 *    makes a double-tap or a retry on flaky venue wifi return the same order
 *    instead of creating a second one.
 */
import { priceCart, type FeeConfig } from '@/lib/orders/pricing'
import { multiplyMoney, sumMoney } from '@/lib/money'
import { newCartLineId, newClientRequestId } from '@/lib/utils/id'
import type { CartLine, CartLineOption, CartState } from '@/types/domain'
import type { Locale } from '@/types/i18n'

const STORAGE_PREFIX = 'qros:cart:'
const MAX_LINES = 60
const MAX_QUANTITY_PER_LINE = 99
const MAX_NOTE_LENGTH = 280

export function cartStorageKey(token: string): string {
  return `${STORAGE_PREFIX}${token}`
}

export interface CartContext {
  token: string
  restaurantSlug: string
  currency: string
  currencyDecimals: number
  serviceFeeEnabled: boolean
  serviceFeeBps: number
  locale: Locale
}

export function createEmptyCart(context: CartContext, now: string): CartState {
  return {
    token: context.token,
    restaurantSlug: context.restaurantSlug,
    currency: context.currency,
    currencyDecimals: context.currencyDecimals,
    serviceFeeEnabled: context.serviceFeeEnabled,
    serviceFeeBps: context.serviceFeeBps,
    lines: [],
    itemCount: 0,
    totals: { subtotal: 0, serviceFee: 0, discountTotal: 0, total: 0 },
    note: null,
    clientRequestId: newClientRequestId(),
    locale: context.locale,
    updatedAt: now,
  }
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export type CartAction =
  | { type: 'add'; line: Omit<CartLine, 'lineId' | 'optionsTotal' | 'lineTotal' | 'addedAt'>; now: string }
  | { type: 'setQuantity'; lineId: string; quantity: number; now: string }
  | { type: 'remove'; lineId: string; now: string }
  | { type: 'setLineNote'; lineId: string; note: string | null; now: string }
  | { type: 'setOrderNote'; note: string | null; now: string }
  | { type: 'clear'; context: CartContext; now: string }
  /** Re-applies fresh menu data after a reload so a stale price or a dish that
   *  sold out while the sheet was open cannot reach checkout unnoticed. */
  | {
      type: 'reconcile'
      now: string
      menu: ReadonlyMap<string, { unitPrice: number; isAvailable: boolean }>
    }

/* ------------------------------------------------------------------ */
/* Reducer — pure, so it can be unit-tested without a browser          */
/* ------------------------------------------------------------------ */

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'add': {
      const optionsTotal = sumOptionDeltas(action.line.options)
      const signature = lineSignature(action.line.menuItemId, action.line.options, action.line.note)

      // Adding the same dish with the same options and the same note bumps the
      // existing line. Anything else becomes its own line, because "no onion"
      // and "extra onion" are two different plates for the kitchen.
      const existing = state.lines.find(
        (l) => lineSignature(l.menuItemId, l.options, l.note) === signature,
      )

      let lines: CartLine[]
      if (existing) {
        const quantity = clampQuantity(existing.quantity + action.line.quantity)
        lines = state.lines.map((l) =>
          l.lineId === existing.lineId ? withTotals({ ...l, quantity }) : l,
        )
      } else {
        if (state.lines.length >= MAX_LINES) return state
        lines = [
          ...state.lines,
          withTotals({
            ...action.line,
            lineId: newCartLineId(),
            quantity: clampQuantity(action.line.quantity),
            optionsTotal,
            lineTotal: 0,
            addedAt: action.now,
          }),
        ]
      }
      return recompute(state, lines, action.now)
    }

    case 'setQuantity': {
      const quantity = clampQuantity(action.quantity)
      // Stepping to zero is how a diner removes a line; treating it as a
      // deletion is what they mean, and leaves no zero-quantity ghost row.
      const lines =
        quantity === 0
          ? state.lines.filter((l) => l.lineId !== action.lineId)
          : state.lines.map((l) =>
              l.lineId === action.lineId ? withTotals({ ...l, quantity }) : l,
            )
      return recompute(state, lines, action.now)
    }

    case 'remove':
      return recompute(
        state,
        state.lines.filter((l) => l.lineId !== action.lineId),
        action.now,
      )

    case 'setLineNote': {
      const note = normaliseNote(action.note)
      const lines = state.lines.map((l) => (l.lineId === action.lineId ? { ...l, note } : l))
      return recompute(state, lines, action.now)
    }

    case 'setOrderNote':
      return { ...state, note: normaliseNote(action.note), updatedAt: action.now }

    case 'clear':
      // A fresh clientRequestId: the next order is genuinely a new order, and
      // must not be deduplicated against the one just placed.
      return createEmptyCart(action.context, action.now)

    case 'reconcile': {
      const lines = state.lines.map((line) => {
        const fresh = action.menu.get(line.menuItemId)
        if (!fresh) return { ...line, isAvailable: false }
        return withTotals({ ...line, unitPrice: fresh.unitPrice, isAvailable: fresh.isAvailable })
      })
      return recompute(state, lines, action.now)
    }
  }
}

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

function withTotals(line: CartLine): CartLine {
  const optionsTotal = sumOptionDeltas(line.options)
  return {
    ...line,
    optionsTotal,
    lineTotal: multiplyMoney(line.unitPrice + optionsTotal, line.quantity),
  }
}

function sumOptionDeltas(options: readonly CartLineOption[]): number {
  return sumMoney(options.map((o) => multiplyMoney(o.priceDelta, o.quantity)))
}

function recompute(state: CartState, lines: CartLine[], now: string): CartState {
  const fee: FeeConfig = { enabled: state.serviceFeeEnabled, bps: state.serviceFeeBps }
  // Unavailable lines are kept visible — silently dropping a dish the diner
  // chose is worse than showing it struck through — but they must not be
  // priced into a total the diner will not be charged.
  const priceable = lines.filter((l) => l.isAvailable)
  return {
    ...state,
    lines,
    itemCount: lines.reduce((sum, l) => sum + l.quantity, 0),
    totals: priceCart(priceable, fee),
    updatedAt: now,
  }
}

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0
  return Math.max(0, Math.min(MAX_QUANTITY_PER_LINE, Math.floor(quantity)))
}

function normaliseNote(note: string | null): string | null {
  if (note === null) return null
  const trimmed = note.trim().slice(0, MAX_NOTE_LENGTH)
  return trimmed.length > 0 ? trimmed : null
}

/** Identity of a cart line for merge purposes: dish + chosen options + note. */
function lineSignature(
  menuItemId: string,
  options: readonly CartLineOption[],
  note: string | null,
): string {
  const opts = [...options]
    .map((o) => `${o.optionId}x${o.quantity}`)
    .sort()
    .join(',')
  return `${menuItemId}|${opts}|${note ?? ''}`
}

/** Blocks checkout while any chosen dish is unavailable. */
export function checkoutBlockers(state: CartState): readonly CartLine[] {
  return state.lines.filter((l) => !l.isAvailable)
}

export function isCheckoutable(state: CartState): boolean {
  return state.lines.length > 0 && checkoutBlockers(state).length === 0
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

/**
 * Reads the cart for this table.
 *
 * Returns null rather than throwing on anything unexpected — private browsing,
 * disabled site data, a half-written value, or a cart written by an older
 * version of the app. A diner meeting any of those gets an empty cart, which is
 * a recoverable inconvenience; an exception here would blank the menu page.
 */
export function loadCart(token: string, context: CartContext, now: string): CartState {
  if (typeof window === 'undefined') return createEmptyCart(context, now)

  try {
    const raw = window.localStorage.getItem(cartStorageKey(token))
    if (!raw) return createEmptyCart(context, now)

    const parsed: unknown = JSON.parse(raw)
    if (!isCartState(parsed) || parsed.token !== token) {
      return createEmptyCart(context, now)
    }

    // Adopt the server's current fee and currency configuration: the cart may
    // predate a settings change, and the preview should reflect today's rules.
    return recompute(
      {
        ...parsed,
        currency: context.currency,
        currencyDecimals: context.currencyDecimals,
        serviceFeeEnabled: context.serviceFeeEnabled,
        serviceFeeBps: context.serviceFeeBps,
        locale: context.locale,
      },
      parsed.lines,
      now,
    )
  } catch {
    return createEmptyCart(context, now)
  }
}

export function saveCart(state: CartState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(cartStorageKey(state.token), JSON.stringify(state))
  } catch {
    // Quota exceeded or storage blocked. The cart still works for this page
    // view; it just will not survive a reload. Failing the interaction here
    // would be a worse trade than losing persistence.
  }
}

export function clearStoredCart(token: string): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(cartStorageKey(token))
  } catch {
    // Nothing actionable: the in-memory cart has already been reset.
  }
}

function isCartState(value: unknown): value is CartState {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<CartState>
  return (
    typeof candidate.token === 'string' &&
    typeof candidate.clientRequestId === 'string' &&
    Array.isArray(candidate.lines) &&
    candidate.lines.every(isCartLine)
  )
}

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false
  const line = value as Partial<CartLine>
  return (
    typeof line.lineId === 'string' &&
    typeof line.menuItemId === 'string' &&
    typeof line.unitPrice === 'number' &&
    Number.isInteger(line.unitPrice) &&
    typeof line.quantity === 'number' &&
    Array.isArray(line.options)
  )
}
