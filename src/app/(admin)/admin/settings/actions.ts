'use server'

/**
 * Server action for the restaurant settings screen (`/admin/settings`).
 *
 * Owner-only — `settings-service.ts`'s `assertCanWriteSettings` refuses
 * anyone else with a typed `FORBIDDEN`. Changing `currency` /
 * `currency_decimals` does not rewrite history: every order already froze
 * its own pair at placement, which is why the form states that above the
 * field rather than this action trying to explain it.
 */

import { revalidatePath } from 'next/cache'

import { err, appError, type Result } from '@/lib/result'
import { updateSettings } from '@/lib/services/settings-service'
import { settingsSchema } from '@/lib/validation/tenancy'

function validationFailure(source: string, issues: unknown): Result<never> {
  return err(
    appError('VALIDATION_FAILED', `${source} received a payload it does not understand`, {
      httpStatus: 422,
      details: { issues },
    }),
  )
}

export async function updateSettingsAction(input: unknown): Promise<Result<null>> {
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return validationFailure('updateSettingsAction', parsed.error.issues)

  const result = await updateSettings(parsed.data)
  if (result.ok) {
    revalidatePath('/admin/settings')
    revalidatePath('/admin', 'layout')
  }
  return result
}
