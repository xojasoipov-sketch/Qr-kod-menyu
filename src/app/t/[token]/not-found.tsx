/**
 * src/app/t/[token]/not-found.tsx — shared 404 for the whole `/t/[token]` tree.
 * Source: docs/architecture/05-app-structure.md §3.2, §3.3.2; brief §32.
 *
 * Reached two ways, both of which end here because neither carries enough
 * context for a more specific screen: a QR token that fails
 * `qrTokenSchema` before any database round trip (the layout calls `notFound()`
 * directly rather than the database), and a dish id that parses but does not
 * exist in the menu (`item/[itemId]/page.tsx`). The copy therefore stays
 * general — "this does not exist" — while still pointing a diner at the one
 * thing that reliably works: the code printed on their table.
 */
import Link from 'next/link'
import { QrCode } from 'lucide-react'

import { buttonClasses } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { getServerTranslator } from '@/lib/i18n/get-dictionary'
import { resolveRequestLocale } from '@/lib/i18n/resolve-locale'

export default async function TableNotFound(): Promise<React.JSX.Element> {
  const locale = await resolveRequestLocale()
  const t = getServerTranslator(locale)

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-(--container-customer) flex-col items-center justify-center px-(--space-gutter-sm) py-12">
      <EmptyState
        align="center"
        icon={<QrCode className="size-7" strokeWidth={1.75} />}
        title={t('errors.generic.notFoundTitle')}
        description={t('customer.welcome.scanAgain')}
      >
        <Link href="/" className={buttonClasses({ variant: 'secondary', size: 'md' })}>
          {t('errors.generic.goHome')}
        </Link>
      </EmptyState>
    </div>
  )
}
