import 'server-only'

/**
 * Restaurant-level settings: identity, branding, locale, currency and the
 * service fee. Owner only (`can_manage_settings` in doc 02 §4.5).
 *
 * The one thing worth stating out loud: changing `currency` or
 * `currency_decimals` does NOT rewrite history. Every order froze its own pair
 * at placement (`orders.currency`, `orders.currency_decimals`), so a receipt
 * from before the change still renders in the currency the guest actually paid
 * — which is the only correct behaviour, and also the reason the settings form
 * says so above the field.
 */
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { mapPgError } from '@/lib/security/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/services/session'
import type { SettingsInput } from '@/lib/validation/tenancy'
import type { RestaurantRow } from '@/types/database'
import type { StaffSession } from '@/types/domain'
import type { I18nText, Locale } from '@/types/i18n'

export interface SettingsView {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  coverImageUrl: string | null
  phone: string | null
  email: string | null
  welcomeMessage: I18nText | null
  description: I18nText | null
  defaultLocale: Locale
  currency: string
  currencyDecimals: number
  serviceFeeEnabled: boolean
  serviceFeeBps: number
  isActive: boolean
  isDemo: boolean
  updatedAt: string
}

async function requireSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (!session) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return session
}

/** Reading settings is a manager's business; writing them is the owner's. */
function assertCanWriteSettings(session: StaffSession): void {
  if (session.isPlatformAdmin || session.role === 'RESTAURANT_OWNER') return
  throw new AppErrorException(
    appError('FORBIDDEN', `${session.role} may not change restaurant settings`, {
      wire: 'QR050_FORBIDDEN',
      details: { role: session.role },
    }),
  )
}

function toSettingsView(row: RestaurantRow): SettingsView {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    logoUrl: row.logo_url,
    coverImageUrl: row.cover_image_url,
    phone: row.phone,
    email: row.email,
    welcomeMessage: row.welcome_message,
    description: row.description,
    defaultLocale: row.default_locale,
    currency: row.currency,
    currencyDecimals: row.currency_decimals,
    serviceFeeEnabled: row.service_fee_enabled,
    serviceFeeBps: row.service_fee_bps,
    isActive: row.is_active,
    isDemo: row.is_demo,
    updatedAt: row.updated_at,
  }
}

export async function getSettings(): Promise<Result<SettingsView>> {
  return toResult(async () => {
    const session = await requireSession()

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('restaurants')
      .select('*')
      .eq('id', session.restaurantId)
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) {
      throw new AppErrorException(
        appError('NOT_FOUND', 'restaurant not found', {
          wire: 'QR030_NOT_FOUND',
          details: { entity: 'restaurant' },
        }),
      )
    }

    return toSettingsView(data)
  })
}

/**
 * `slug` is deliberately absent from the update.
 *
 * `RestaurantUpdate` freezes it, and for a good reason: the slug appears in
 * printed material and in links people have already shared. Changing it is a
 * migration, not a settings edit, and it needs a redirect story this form does
 * not have.
 */
export async function updateSettings(input: SettingsInput): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanWriteSettings(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('restaurants')
      .update({
        name: input.name,
        logo_url: input.logo_url,
        cover_image_url: input.cover_image_url,
        phone: input.phone,
        email: input.email,
        welcome_message: input.welcome_message,
        description: input.description,
        default_locale: input.default_locale,
        currency: input.currency,
        currency_decimals: input.currency_decimals,
        service_fee_enabled: input.service_fee_enabled,
        service_fee_bps: input.service_fee_bps,
        is_active: input.is_active,
      })
      .eq('id', session.restaurantId)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) {
      throw new AppErrorException(
        appError('NOT_FOUND', 'restaurant not found', {
          wire: 'QR030_NOT_FOUND',
          details: { entity: 'restaurant' },
        }),
      )
    }

    return null
  })
}
