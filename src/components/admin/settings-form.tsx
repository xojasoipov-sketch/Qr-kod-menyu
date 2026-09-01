'use client'

/**
 * src/components/admin/settings-form.tsx — SettingsForm.
 *
 * The restaurant-level settings screen, owner only. `slug` is rendered
 * read-only — `settings-service.ts` never writes it (it appears on printed
 * material and shared links; changing it is a migration, not a settings
 * edit) — and is still submitted, because `settingsSchema` validates the
 * whole payload as one shape.
 */

import { useId, useState, useTransition } from 'react'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { ImageUploader } from '@/components/admin/image-uploader'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Tabs, type TabItem } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { Translator } from '@/lib/i18n/format'
import { LOCALES } from '@/types/i18n'
import type { I18nText, Locale } from '@/types/i18n'
import type { SettingsInput } from '@/lib/validation/tenancy'
import type { SettingsView } from '@/lib/services/settings-service'
import type { AppError } from '@/types/result'
import { updateSettingsAction } from '@/app/(admin)/admin/settings/actions'

function localizedErrorMessage(t: Translator, error: AppError): string {
  if (error.wire) return t(`errors.${error.wire}`)
  return t(`errors.app.${error.code}`)
}

const LOCALE_LABEL_KEY: Record<Locale, 'labels.locale.uz' | 'labels.locale.ru' | 'labels.locale.en'> = {
  uz: 'labels.locale.uz',
  ru: 'labels.locale.ru',
  en: 'labels.locale.en',
}

function fromView(settings: SettingsView): SettingsInput {
  return {
    name: settings.name,
    slug: settings.slug,
    logo_url: settings.logoUrl,
    cover_image_url: settings.coverImageUrl,
    phone: settings.phone,
    email: settings.email,
    welcome_message: settings.welcomeMessage,
    description: settings.description,
    default_locale: settings.defaultLocale,
    currency: settings.currency,
    currency_decimals: settings.currencyDecimals,
    service_fee_enabled: settings.serviceFeeEnabled,
    service_fee_bps: settings.serviceFeeBps,
    is_active: settings.isActive,
  }
}

type Tab = 'general' | 'branding' | 'ordering' | 'danger'

export interface SettingsFormProps {
  initial: SettingsView
}

export function SettingsForm({ initial }: SettingsFormProps): React.JSX.Element {
  const t = useT()
  const tabIdBase = useId()
  const [form, setForm] = useState<SettingsInput>(() => fromView(initial))
  const [tab, setTab] = useState<Tab>('general')
  const [error, setError] = useState<string | null>(null)
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false)
  const [pending, startTransition] = useTransition()

  function patch(next: Partial<SettingsInput>): void {
    setForm((current) => ({ ...current, ...next }))
  }

  function save(next: SettingsInput): void {
    setError(null)
    startTransition(async () => {
      const result = await updateSettingsAction(next)
      if (!result.ok) {
        setError(localizedErrorMessage(t, result.error))
        toast.error(t('toasts.saveFailed'))
        return
      }
      setForm(next)
      toast.success(t('toasts.saved'))
    })
  }

  async function handleDeactivate(): Promise<void> {
    const next: SettingsInput = { ...form, is_active: false }
    const result = await updateSettingsAction(next)
    if (!result.ok) throw new Error(localizedErrorMessage(t, result.error))
    setForm(next)
    toast.success(t('toasts.saved'))
  }

  const tabs: TabItem[] = [
    { id: 'general', label: t('admin.settings.tabGeneral') },
    { id: 'branding', label: t('admin.settings.tabBranding') },
    { id: 'ordering', label: t('admin.settings.tabOrdering') },
    { id: 'danger', label: t('admin.settings.tabDanger') },
  ]

  const localeOptions: SelectOption<Locale>[] = LOCALES.map((locale) => ({
    value: locale,
    label: t(LOCALE_LABEL_KEY[locale]),
  }))

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault()
        save(form)
      }}
    >
      <Tabs
        items={tabs}
        value={tab}
        onValueChange={(id) => setTab(id as Tab)}
        label={t('admin.settings.title')}
        idPrefix={tabIdBase}
      />

      {tab === 'general' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('admin.settings.restaurantName')}
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
            <Input label={t('admin.settings.slug')} value={form.slug} readOnly hint={t('admin.settings.slugHint')} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('common.phone')}
              value={form.phone ?? ''}
              onChange={(event) => patch({ phone: event.target.value || null })}
            />
            <Input
              label={t('common.email')}
              type="email"
              value={form.email ?? ''}
              onChange={(event) => patch({ email: event.target.value || null })}
            />
          </div>
          <Select
            label={t('admin.settings.defaultLocale')}
            options={localeOptions}
            value={form.default_locale}
            onChange={(event) => patch({ default_locale: event.target.value as Locale })}
            hint={t('admin.settings.defaultLocaleHint')}
          />

          <div className="grid gap-3 sm:grid-cols-3">
            {LOCALES.map((locale) => (
              <Input
                key={locale}
                label={`${t('admin.settings.welcomeMessage')} · ${t(LOCALE_LABEL_KEY[locale])}`}
                value={form.welcome_message?.[locale] ?? ''}
                onChange={(event) =>
                  patch({
                    welcome_message: { ...(form.welcome_message ?? {}), [locale]: event.target.value } as I18nText,
                  })
                }
              />
            ))}
          </div>
          <p className="-mt-2 text-caption text-text-subtle">{t('admin.settings.welcomeMessageHint')}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            {LOCALES.map((locale) => (
              <Textarea
                key={locale}
                label={`${t('admin.settings.description')} · ${t(LOCALE_LABEL_KEY[locale])}`}
                value={form.description?.[locale] ?? ''}
                onChange={(event) =>
                  patch({ description: { ...(form.description ?? {}), [locale]: event.target.value } as I18nText })
                }
                rows={3}
              />
            ))}
          </div>
        </div>
      )}

      {tab === 'branding' && (
        <div className="flex flex-col gap-6">
          <ImageUploader
            label={t('admin.settings.logo')}
            kind="restaurant_logo"
            value={{ url: form.logo_url, path: null }}
            onChange={(next) => patch({ logo_url: next.url })}
          />
          <ImageUploader
            label={t('admin.settings.coverImage')}
            kind="restaurant_cover"
            value={{ url: form.cover_image_url, path: null }}
            onChange={(next) => patch({ cover_image_url: next.url })}
          />
        </div>
      )}

      {tab === 'ordering' && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label={t('admin.settings.currency')}
              value={form.currency}
              onChange={(event) => patch({ currency: event.target.value.toUpperCase() })}
              hint={t('admin.settings.currencyHint')}
            />
            <Input
              label={t('admin.settings.currencyDecimals')}
              type="number"
              min={0}
              max={4}
              value={form.currency_decimals}
              onChange={(event) => patch({ currency_decimals: Number(event.target.value) || 0 })}
            />
          </div>

          <Switch
            checked={form.service_fee_enabled}
            onCheckedChange={(checked) => patch({ service_fee_enabled: checked })}
            label={t('admin.settings.serviceFeeEnabled')}
          />

          {form.service_fee_enabled && (
            <Input
              label={t('admin.settings.serviceFeeRate')}
              type="number"
              min={0}
              max={100}
              step={0.01}
              value={(form.service_fee_bps / 100).toFixed(2)}
              onChange={(event) =>
                patch({ service_fee_bps: Math.round(Math.max(0, Number(event.target.value) || 0) * 100) })
              }
              suffix="%"
              hint={t('admin.settings.serviceFeeHint')}
            />
          )}
        </div>
      )}

      {tab === 'danger' && (
        <div className="flex flex-col gap-3 rounded-card border border-danger-line bg-danger-soft p-4">
          <p className="font-medium text-danger">{t('admin.settings.dangerTitle')}</p>
          <p className="text-body-sm text-text-muted">{t('admin.settings.deactivateConfirmBody')}</p>
          <Button
            type="button"
            variant="danger"
            className="self-start"
            disabled={!form.is_active}
            onClick={() => setConfirmingDeactivate(true)}
          >
            {t('admin.settings.deactivateRestaurant')}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-card border border-danger-line bg-danger-soft px-3 py-2 text-body-sm text-danger">
          {error}
        </p>
      )}

      {tab !== 'danger' && (
        <div className="flex items-center gap-3 border-t border-border pt-4">
          <Button type="submit" variant="primary" loading={pending} loadingLabel={t('common.saving')}>
            {t('common.save')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDeactivate}
        onOpenChange={setConfirmingDeactivate}
        title={t('admin.settings.deactivateConfirmTitle', { restaurant: form.name })}
        description={t('admin.settings.deactivateConfirmBody')}
        confirmLabel={t('admin.settings.deactivateRestaurant')}
        cancelLabel={t('common.cancel')}
        tone="danger"
        requireTyped={form.name}
        busyLabel={t('common.saving')}
        onConfirm={handleDeactivate}
      />
    </form>
  )
}
