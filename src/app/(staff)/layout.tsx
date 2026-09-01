/**
 * src/app/(staff)/layout.tsx — the shared gate for every tablet-scoped staff
 * surface (05-app-structure.md §2.5).
 *
 * Deliberately almost nothing: a session check and a bare background. The
 * kitchen wants no chrome of its own here — no sidebar, no topbar, nothing
 * that competes with a ticket for a cook's attention — so `<KdsToolbar>`
 * (rendered by the kitchen route itself) is the only header this surface
 * gets. A future `/waiter` sub-route hangs off this same layout and gets the
 * identical minimal treatment.
 *
 * The capability check (`kitchen`, `waiter`, …) belongs to each sub-route,
 * not here — this layout only answers "is anybody signed in at all", exactly
 * as `requireStaffContext()` does.
 */
import { requireStaffContext } from '@/lib/auth/guards'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function StaffLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  await requireStaffContext()

  return <div className="min-h-dvh bg-surface text-text">{children}</div>
}
