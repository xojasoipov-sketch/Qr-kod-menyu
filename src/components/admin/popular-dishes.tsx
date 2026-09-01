/**
 * src/components/admin/popular-dishes.tsx — brief §11's "most popular
 * dishes": the top five by units sold today, from
 * `DashboardStats.topItems`, which `dashboard-service.ts` builds by grouping
 * `order_items.name_snapshot` — so a dish renamed or removed at lunchtime
 * still reports under the name it was actually sold as.
 *
 * A ranked bar list, the same visual language as `<OrderStatusOverview>`:
 * one accent hue at varying weight (a sequential scale, never a rainbow),
 * bars scaled to the leading dish so the ranking reads at a glance.
 *
 * A Server Component.
 */

import { ChefHat } from 'lucide-react'

import { EmptyState } from '@/components/ui/empty-state'
import type { Translator } from '@/lib/i18n/format'
import { formatMoney } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/types'
import type { DashboardTopItem } from '@/types/domain'
import type { I18nText } from '@/types/i18n'

export interface PopularDishesProps {
  items: readonly DashboardTopItem[]
  currency: string
  currencyDecimals: number
  t: Translator
  locale: Locale
}

function pickText(text: I18nText, locale: Locale): string {
  return text[locale] ?? text.en ?? text.ru ?? text.uz ?? ''
}

const BAR_WEIGHT = ['bg-accent', 'bg-accent/85', 'bg-accent/70', 'bg-accent/55', 'bg-accent/40'] as const

export function PopularDishes({
  items,
  currency,
  currencyDecimals,
  t,
  locale,
}: PopularDishesProps): React.JSX.Element {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<ChefHat className="size-7" strokeWidth={1.75} />}
        title={t('admin.dashboard.noData.title')}
        description={t('admin.dashboard.noData.body')}
        size="sm"
      />
    )
  }

  const max = Math.max(...items.map((item) => item.quantitySold))

  return (
    <ol className="flex flex-col gap-3">
      {items.map((item, index) => {
        const width = max === 0 ? 0 : Math.round((item.quantitySold / max) * 100)
        return (
          <li key={item.menuItemId ?? `${index}-${pickText(item.name, locale)}`} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-admin-body text-text">
                <span className="me-2 text-admin-xs text-text-subtle u-tnum">{index + 1}</span>
                {pickText(item.name, locale)}
              </span>
              <span className="shrink-0 text-admin-sm u-tnum text-text-muted">
                {t.n('plurals.dishes', item.quantitySold)}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className="h-2 min-w-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                <span
                  className={`block h-full rounded-full ${BAR_WEIGHT[Math.min(index, BAR_WEIGHT.length - 1)]}`}
                  style={{ width: `${width}%` }}
                />
              </span>
              <span className="w-20 shrink-0 text-end text-admin-xs u-tnum text-text-subtle">
                {formatMoney(item.revenue, currency, currencyDecimals, locale)}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
