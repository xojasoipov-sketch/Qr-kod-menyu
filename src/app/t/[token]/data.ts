/**
 * src/app/t/[token]/data.ts — request-scoped, demo-aware reads for the /t/[token]
 * route tree. Not a route segment file (Next only treats page/layout/route.ts as
 * special), just a colocated helper shared by this tree's layout, page and item page.
 *
 * Wrapping in React's `cache()` is what makes calling `resolveTable`/`getMenu` from
 * both the layout AND a page cost exactly one round trip per request instead of
 * two — the same technique 05-app-structure.md §3.2 documents for `getTableContext`.
 * `@/lib/rpc/public` itself is not memoised (it is the anon RPC boundary, reused by
 * demo mode and by any caller that legitimately wants a fresh read), so the cache
 * has to live on this side.
 *
 * The demo/live switch happens ONCE, here — the one place this route tree decides
 * which repository answers a read — mirroring `src/lib/demo/demo-mode.ts`'s own
 * "one switch point, at the data layer" contract. Nothing downstream re-branches
 * on `isDemoMode()`.
 */
import { cache } from 'react'

import { demoRepository } from '@/lib/demo/demo-mode'
import { isDemoMode } from '@/lib/env'
import { getMenu, resolveTable } from '@/lib/rpc/public'
import type { PublicMenu, PublicTableContext } from '@/lib/rpc/schemas'
import type { Result } from '@/types/result'

export const getCachedTableContext = cache(
  (token: string): Promise<Result<PublicTableContext>> =>
    isDemoMode() ? demoRepository.resolveTable(token) : resolveTable(token),
)

export const getCachedMenu = cache(
  (token: string): Promise<Result<PublicMenu>> => (isDemoMode() ? demoRepository.getMenu(token) : getMenu(token)),
)
