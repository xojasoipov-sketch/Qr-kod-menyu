/**
 * src/app/(admin)/layout.tsx — the admin shell (brief §11; 05-app-structure.md
 * §2.6).
 *
 * `requireRole('RESTAURANT_OWNER', 'MANAGER')` gates the whole surface — a
 * platform admin satisfies it too (`hasRole` treats `isPlatformAdmin` as an
 * automatic pass), and anything else is redirected to its own landing surface
 * before this ever renders (WAITER → /waiter, KITCHEN → /kitchen). Nav order
 * is fixed by brief §11: Dashboard · Orders · Menu · Categories · Tables ·
 * Branches · Staff · Analytics · Settings — the sidebar is a single client
 * component (`<AdminSidebar>`) built by this slice; every page it links to is
 * a sibling slice's responsibility except Dashboard, Orders and Analytics.
 */
import {
  BarChart3,
  Building2,
  ClipboardList,
  LayoutDashboard,
  ShieldCheck,
  Settings as SettingsIcon,
  Tags,
  Table2,
  UtensilsCrossed,
  Users,
} from 'lucide-react'

import { AdminSidebar, type AdminSidebarNavItem } from '@/components/admin/admin-sidebar'
import { AdminTopbar } from '@/components/admin/admin-topbar'
import { requireRole } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'

import { signOutAction } from './admin/actions'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ICON_CLASS = 'size-full'

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}): Promise<React.JSX.Element> {
  const context = await requireRole('RESTAURANT_OWNER', 'MANAGER')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const items: AdminSidebarNavItem[] = [
    { id: 'dashboard', label: t('nav.dashboard'), href: '/admin', icon: <LayoutDashboard className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'orders', label: t('nav.orders'), href: '/admin/orders', icon: <ClipboardList className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'menu', label: t('nav.menuManagement'), href: '/admin/menu', icon: <UtensilsCrossed className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'categories', label: t('nav.categories'), href: '/admin/categories', icon: <Tags className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'tables', label: t('nav.tables'), href: '/admin/tables', icon: <Table2 className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'branches', label: t('nav.branches'), href: '/admin/branches', icon: <Building2 className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'staff', label: t('nav.staff'), href: '/admin/staff', icon: <Users className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'analytics', label: t('nav.analytics'), href: '/admin/analytics', icon: <BarChart3 className={ICON_CLASS} strokeWidth={1.75} /> },
    { id: 'settings', label: t('nav.settings'), href: '/admin/settings', icon: <SettingsIcon className={ICON_CLASS} strokeWidth={1.75} /> },
  ]

  const platformItem: AdminSidebarNavItem | undefined = context.isPlatformAdmin
    ? {
        id: 'platform',
        label: t('nav.platform'),
        href: '/admin/platform',
        icon: <ShieldCheck className={ICON_CLASS} strokeWidth={1.75} />,
      }
    : undefined

  return (
    <div className="flex min-h-dvh bg-surface text-text">
      <AdminSidebar
        items={items}
        platformItem={platformItem}
        restaurant={{ name: context.restaurant.name, logoUrl: context.restaurant.logoUrl }}
        branches={context.branches.map((branch) => ({ id: branch.id, name: branch.name }))}
        activeBranchId={context.activeBranchId}
        branchFilterLabel={t('admin.dashboard.branchFilter')}
        user={{ name: context.session.displayName, role: t(`labels.role.${context.role}`) }}
        navLabel={t('a11y.mainNavigation')}
        closeLabel={t('a11y.closeDialog')}
        openMenuLabel={t('nav.openMenu')}
        collapseLabel={t('a11y.collapse')}
        expandLabel={t('a11y.expand')}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AdminTopbar
          user={{ name: context.session.displayName, role: t(`labels.role.${context.role}`) }}
          themeLabels={{
            group: t('nav.settings'),
            light: t('common.active'),
            dark: t('common.inactive'),
            system: t('common.all'),
          }}
          signOutLabel={t('auth.signOut')}
          signOutAction={signOutAction}
          isDemo={context.restaurant.isDemo}
          demoLabel={t('states.demo.badge')}
        />

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
