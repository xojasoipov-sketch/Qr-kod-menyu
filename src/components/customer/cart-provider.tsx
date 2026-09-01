'use client'

/**
 * The cart's client context.
 *
 * Wraps `cartReducer` from `@/lib/cart/cart-store` (§ cart-store.ts) in a
 * hydration-safe shell:
 *
 *   1. FIRST PAINT AGREES. The initial `useState` is seeded with
 *      `createEmptyCart(context, HYDRATION_TIMESTAMP)` — the same call on the
 *      server and on the client's first render, so the cart badge, the cart
 *      page and the place-order button all render "empty" identically before
 *      hydration. `localStorage` is read only inside a `useEffect`, which never
 *      runs during SSR.
 *   2. PERSISTS ON CHANGE. Every accepted state is written back with
 *      `saveCart`, but only once hydrated — writing the throwaway SSR snapshot
 *      would stomp whatever a previous tab already saved for this token.
 *   3. RECONCILES ON LOAD. Once hydrated, the provider fetches the live menu
 *      (through the same demo/live switch every public read uses) and dispatches
 *      `{ type: 'reconcile' }` so a stale price or a dish that sold out while the
 *      diner was elsewhere cannot reach checkout unnoticed. `reconcile()` is also
 *      exposed on the context so a caller — `<PlaceOrderButton>` reacting to a
 *      late `ITEM_UNAVAILABLE` — can force it again after a failed submit.
 *
 * One `<CartProvider>` per QR token. It is safe to mount more than one instance
 * of this provider in the tree (e.g. once ambiently and once around a page that
 * wants to guarantee it has cart access) — every instance reads and writes the
 * same `localStorage` key, so they converge.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  cartReducer,
  checkoutBlockers,
  createEmptyCart,
  isCheckoutable as computeIsCheckoutable,
  loadCart,
  saveCart,
  type CartAction,
  type CartContext as CartStoreContext,
} from '@/lib/cart/cart-store'
import { isDemoMode } from '@/lib/env'
import { demoRepository } from '@/lib/demo/demo-mode'
import { getMenu } from '@/lib/rpc/public'
import type { PublicMenu } from '@/lib/rpc/schemas'
import type { CartLine, CartState } from '@/types/domain'

/** Deterministic seed for the pre-hydration snapshot. Never rendered as text. */
const HYDRATION_TIMESTAMP = '1970-01-01T00:00:00.000Z'

type ReconcileIndex = ReadonlyMap<string, { unitPrice: number; isAvailable: boolean }>

function indexMenu(menu: PublicMenu): ReconcileIndex {
  const index = new Map<string, { unitPrice: number; isAvailable: boolean }>()
  for (const category of menu.categories) {
    for (const item of category.items) {
      index.set(item.id, { unitPrice: item.price, isAvailable: item.is_available })
    }
  }
  return index
}

export interface CartProviderValue {
  state: CartState
  dispatch: (action: CartAction) => void
  /** False until `sessionStorage`/`localStorage` has been read on the client. */
  hydrated: boolean
  isCheckoutable: boolean
  /** Lines whose dish went unavailable since they were added. Kept visible, never priced. */
  blockedLines: readonly CartLine[]
  /** Re-fetches the live menu and reconciles the cart against it, on demand. */
  reconcile: () => Promise<void>
}

const CartStateContext = createContext<CartProviderValue | null>(null)

export interface CartProviderProps {
  context: CartStoreContext
  children: ReactNode
}

export function CartProvider({ context, children }: CartProviderProps): React.JSX.Element {
  const [state, setState] = useState<CartState>(() =>
    createEmptyCart(context, HYDRATION_TIMESTAMP),
  )
  const [hydrated, setHydrated] = useState(false)
  const contextRef = useRef(context)
  contextRef.current = context

  // Read storage once the client has mounted, keyed on the token: a different
  // table's QR code is a different cart, never a carried-over one.
  useEffect(() => {
    const now = new Date().toISOString()
    setState(loadCart(context.token, contextRef.current, now))
    setHydrated(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [context.token])

  useEffect(() => {
    if (!hydrated) return
    saveCart(state)
  }, [state, hydrated])

  const reconcile = useCallback(async (): Promise<void> => {
    const token = contextRef.current.token
    const result = isDemoMode() ? await demoRepository.getMenu(token) : await getMenu(token)
    if (!result.ok) return
    const index = indexMenu(result.data)
    setState((previous) => cartReducer(previous, { type: 'reconcile', now: new Date().toISOString(), menu: index }))
  }, [])

  // Fresh availability and prices as soon as there is something to reconcile.
  useEffect(() => {
    if (!hydrated) return
    void reconcile()
    // Intentionally only on the hydrate/token edge — reconcile() is also offered
    // imperatively for a caller that needs a fresher read (a failed checkout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, context.token])

  const dispatch = useCallback((action: CartAction) => {
    setState((previous) => cartReducer(previous, action))
  }, [])

  const value = useMemo<CartProviderValue>(() => {
    return {
      state,
      dispatch,
      hydrated,
      isCheckoutable: computeIsCheckoutable(state),
      blockedLines: checkoutBlockers(state),
      reconcile,
    }
  }, [state, dispatch, hydrated, reconcile])

  return <CartStateContext.Provider value={value}>{children}</CartStateContext.Provider>
}

export function useCart(): CartProviderValue {
  const value = useContext(CartStateContext)
  if (!value) {
    throw new Error('useCart must be used inside <CartProvider>')
  }
  return value
}
