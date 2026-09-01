/**
 * `/admin/settings` — how the restaurant works (brief; owner only).
 *
 * A Server Component: `requireCapability('admin')` gates the route (the
 * write itself is further restricted to `RESTAURANT_OWNER` by
 * `settings-service.ts`'s `assertCanWriteSettings`), then `getSettings`
 * seeds `<SettingsForm>`'s first paint.
 */
import { ErrorState } from '@/components/ui/error-state'
import { PageHeader } from '@/components/ui/page-header'
import { SettingsForm } from '@/components/admin/settings-form'
import { Badge } from '@/components/ui/badge'
import { requireCapability } from '@/lib/auth/guards'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'
import { getSettings } from '@/lib/services/settings-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage(): Promise<React.JSX.Element> {
  await requireCapability('admin')
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  const result = await getSettings()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('admin.settings.title')}
        description={t('admin.settings.subtitle')}
        meta={result.ok && result.data.isDemo ? <Badge tone="warning">{t('states.demo.badge')}</Badge> : undefined}
      />

      {result.ok ? (
        <SettingsForm initial={result.data} />
      ) : (
        <ErrorState
          code={result.error.wire ?? 'unknown'}
          title={t('states.error.settings.title')}
          description={t('states.error.settings.body')}
        />
      )}
    </div>
  )
}
