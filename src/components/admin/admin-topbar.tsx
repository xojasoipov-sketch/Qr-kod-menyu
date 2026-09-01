/**
 * src/components/admin/admin-topbar.tsx — the persistent strip above every
 * admin page: language, appearance, and the signed-in operator.
 *
 * A Server Component. Every interactive piece it renders is either a
 * self-contained client component (`LanguageSwitcher`, `ThemeToggle`) or a
 * plain `<form action={signOutAction}>` — a real POST that needs no client
 * JavaScript at all — so this file itself holds no state and needs none.
 */

import { LogOut } from 'lucide-react'

import { IconButton } from '@/components/ui/button'
import { LanguageSwitcher } from '@/components/ui/language-switcher'
import { ThemeToggle, type ThemeToggleLabels } from '@/components/ui/theme-toggle'
import { DemoDataNotice } from './demo-data-notice'

export interface AdminTopbarProps {
  user: { name: string; role: string }
  themeLabels: ThemeToggleLabels
  signOutLabel: string
  signOutAction: () => Promise<void>
  isDemo: boolean
  demoLabel: string
}

export function AdminTopbar({
  user,
  themeLabels,
  signOutLabel,
  signOutAction,
  isDemo,
  demoLabel,
}: AdminTopbarProps): React.JSX.Element {
  return (
    <header className="sticky top-0 z-(--z-sticky) flex h-(--space-admin-topbar-h) items-center justify-between gap-3 border-b border-border bg-surface px-4 ps-14 lg:ps-4">
      <div className="min-w-0">
        {isDemo && <DemoDataNotice isDemo label={demoLabel} variant="badge" />}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <LanguageSwitcher variant="menu" size="sm" />
        <ThemeToggle labels={themeLabels} variant="icon" size="sm" />

        <span className="mx-1 hidden h-6 w-px bg-border sm:block" aria-hidden="true" />

        <span className="hidden truncate text-admin-sm text-text-muted sm:inline" title={user.role}>
          {user.name}
        </span>

        <form action={signOutAction}>
          <IconButton
            icon={<LogOut className="size-4" strokeWidth={1.75} />}
            label={signOutLabel}
            type="submit"
            size="sm"
          />
        </form>
      </div>
    </header>
  )
}
