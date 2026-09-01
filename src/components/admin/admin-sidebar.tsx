'use client'

/**
 * src/components/admin/admin-sidebar.tsx — the admin nav shell.
 * Source: docs/architecture/04-design-system.md §6.4 (Sidebar); brief §11.
 *
 * One client component owns every piece of sidebar interactivity: which nav
 * item is active (needs `usePathname`), the desktop collapse-to-icons toggle,
 * and the below-`lg` mobile drawer plus the hamburger that opens it. Keeping
 * all three in one file avoids threading open/collapsed state across a
 * server/client boundary that has nowhere else to live — `(admin)/layout.tsx`
 * is a Server Component and cannot hold `useState` itself.
 *
 * Nav order is fixed by brief §11: Dashboard · Orders · Menu · Categories ·
 * Tables · Branches · Staff · Analytics · Settings. `<BranchSwitcher>` renders
 * under the restaurant header when there is more than one branch in scope.
 */

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Menu, PanelLeftClose, PanelLeftOpen, Store } from 'lucide-react'

import { IconButton } from '@/components/ui/button'
import { Drawer } from '@/components/ui/drawer'
import { cn } from '@/lib/utils/cn'

import { BranchSwitcher } from './branch-switcher'

export interface AdminSidebarNavItem {
  id: string
  label: string
  href: string
  icon: ReactNode
  /** e.g. the pending-order count. > 99 renders "99+". */
  badge?: number
}

export interface AdminSidebarBranch {
  id: string
  name: string
}

export interface AdminSidebarProps {
  items: readonly AdminSidebarNavItem[]
  /** Rendered separately, below a hairline, once platform items exist. */
  platformItem?: AdminSidebarNavItem
  restaurant: { name: string; logoUrl: string | null }
  branches: readonly AdminSidebarBranch[]
  activeBranchId: string | null
  branchFilterLabel: string
  user: { name: string; role: string }
  navLabel: string
  closeLabel: string
  openMenuLabel: string
  collapseLabel: string
  expandLabel: string
}

function NavBadge({ value }: { value: number }): React.JSX.Element {
  return (
    <span className="ms-auto inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent-soft px-1.5 text-overline text-accent u-tnum">
      {value > 99 ? '99+' : value}
    </span>
  )
}

function isActiveHref(pathname: string, href: string): boolean {
  if (href === '/admin') return pathname === '/admin'
  return pathname === href || pathname.startsWith(`${href}/`)
}

function NavList({
  items,
  platformItem,
  pathname,
  collapsed,
  onNavigate,
}: {
  items: readonly AdminSidebarNavItem[]
  platformItem?: AdminSidebarNavItem
  pathname: string
  collapsed: boolean
  onNavigate?: () => void
}): React.JSX.Element {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
      {items.map((item) => {
        const active = isActiveHref(pathname, item.href)
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            title={collapsed ? item.label : undefined}
            onClick={onNavigate}
            className={cn(
              'group flex h-10 items-center gap-3 rounded-control px-2.5 text-admin-body transition-colors duration-(--duration-fast) ease-standard',
              collapsed && 'justify-center px-0',
              active
                ? 'border-s-2 border-accent bg-accent-soft text-text'
                : 'border-s-2 border-transparent text-text-muted hover:bg-surface-sunken hover:text-text',
            )}
          >
            <span aria-hidden="true" className="u-icon-align shrink-0 [&_svg]:size-4.5">
              {item.icon}
            </span>
            {!collapsed && <span className="truncate">{item.label}</span>}
            {!collapsed && item.badge !== undefined && item.badge > 0 && (
              <NavBadge value={item.badge} />
            )}
          </Link>
        )
      })}

      {platformItem && (
        <>
          <hr className="my-2 border-border" />
          <Link
            href={platformItem.href}
            aria-current={isActiveHref(pathname, platformItem.href) ? 'page' : undefined}
            title={collapsed ? platformItem.label : undefined}
            onClick={onNavigate}
            className={cn(
              'group flex h-10 items-center gap-3 rounded-control px-2.5 text-admin-body transition-colors duration-(--duration-fast) ease-standard',
              collapsed && 'justify-center px-0',
              isActiveHref(pathname, platformItem.href)
                ? 'border-s-2 border-accent bg-accent-soft text-text'
                : 'border-s-2 border-transparent text-text-muted hover:bg-surface-sunken hover:text-text',
            )}
          >
            <span aria-hidden="true" className="u-icon-align shrink-0 [&_svg]:size-4.5">
              {platformItem.icon}
            </span>
            {!collapsed && <span className="truncate">{platformItem.label}</span>}
          </Link>
        </>
      )}
    </nav>
  )
}

function SidebarHeader({
  restaurant,
  collapsed,
}: {
  restaurant: { name: string; logoUrl: string | null }
  collapsed: boolean
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-2.5 px-3 py-4', collapsed && 'justify-center px-0')}>
      {restaurant.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- admin chrome only; not the customer image pipeline.
        <img
          src={restaurant.logoUrl}
          alt=""
          className="size-9 shrink-0 rounded-card object-cover"
        />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-card bg-surface-sunken text-text-subtle"
        >
          <Store className="size-4.5" strokeWidth={1.75} />
        </span>
      )}
      {!collapsed && (
        <span className="min-w-0 truncate font-display text-admin-h2 text-text">
          {restaurant.name}
        </span>
      )}
    </div>
  )
}

function SidebarFooter({
  user,
  collapsed,
}: {
  user: { name: string; role: string }
  collapsed: boolean
}): React.JSX.Element {
  return (
    <div className={cn('flex items-center gap-2.5 border-t border-border px-3 py-3', collapsed && 'justify-center px-0')}>
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent-soft text-admin-sm font-medium text-accent"
      >
        {user.name.trim().charAt(0).toUpperCase() || '?'}
      </span>
      {!collapsed && (
        <span className="min-w-0">
          <span className="block truncate text-admin-sm font-medium text-text">{user.name}</span>
          <span className="block truncate text-admin-xs text-text-subtle">{user.role}</span>
        </span>
      )}
    </div>
  )
}

export function AdminSidebar({
  items,
  platformItem,
  restaurant,
  branches,
  activeBranchId,
  branchFilterLabel,
  user,
  navLabel,
  closeLabel,
  openMenuLabel,
  collapseLabel,
  expandLabel,
}: AdminSidebarProps): React.JSX.Element {
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <>
      {/* Mobile trigger. Fixed so it shares the topbar's row without depending
          on cross-component state — the topbar is a Server Component and
          cannot host this button's open flag itself. */}
      <div className="fixed start-2 top-2 z-(--z-sticky) lg:hidden">
        <IconButton
          icon={<Menu className="size-5" strokeWidth={1.75} />}
          label={openMenuLabel}
          variant="solid"
          size="md"
          onClick={() => setMobileOpen(true)}
          className="shadow-float"
        />
      </div>

      <Drawer
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        side="left"
        title={restaurant.name}
        closeLabel={closeLabel}
        width="sm"
      >
        <div className="flex h-full flex-col">
          {branches.length > 1 && (
            <div className="px-2 pb-2">
              <BranchSwitcher
                branches={branches}
                activeBranchId={activeBranchId}
                label={branchFilterLabel}
              />
            </div>
          )}
          <NavList
            items={items}
            platformItem={platformItem}
            pathname={pathname}
            collapsed={false}
            onNavigate={() => setMobileOpen(false)}
          />
          <SidebarFooter user={user} collapsed={false} />
        </div>
      </Drawer>

      <aside
        aria-label={navLabel}
        className={cn(
          'fixed inset-y-0 start-0 z-(--z-raised) hidden flex-col border-e border-border bg-surface-sunken transition-[width] duration-(--duration-base) ease-standard lg:flex',
          collapsed ? 'w-(--space-admin-sidebar-w-collapsed)' : 'w-(--space-admin-sidebar-w)',
        )}
      >
        <SidebarHeader restaurant={restaurant} collapsed={collapsed} />

        {branches.length > 1 && !collapsed && (
          <div className="px-2 pb-2">
            <BranchSwitcher
              branches={branches}
              activeBranchId={activeBranchId}
              label={branchFilterLabel}
            />
          </div>
        )}

        <NavList items={items} platformItem={platformItem} pathname={pathname} collapsed={collapsed} />

        <div className={cn('flex justify-end px-2 py-1', collapsed && 'justify-center')}>
          <IconButton
            icon={
              collapsed ? (
                <PanelLeftOpen className="size-4" strokeWidth={1.75} />
              ) : (
                <PanelLeftClose className="size-4" strokeWidth={1.75} />
              )
            }
            label={collapsed ? expandLabel : collapseLabel}
            size="sm"
            onClick={() => setCollapsed((prev) => !prev)}
          />
        </div>

        <SidebarFooter user={user} collapsed={collapsed} />
      </aside>

      {/* Reserves the sidebar's own width in the document flow. */}
      <div
        aria-hidden="true"
        className={cn(
          'hidden shrink-0 transition-[width] duration-(--duration-base) ease-standard lg:block',
          collapsed ? 'w-(--space-admin-sidebar-w-collapsed)' : 'w-(--space-admin-sidebar-w)',
        )}
      />
    </>
  )
}
