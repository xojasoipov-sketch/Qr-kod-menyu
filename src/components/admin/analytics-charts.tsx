/**
 * src/components/admin/analytics-charts.tsx — brief §11 analytics, extended
 * over a date range (05-app-structure.md §10: "`/admin/analytics` renders
 * the same `DashboardStats` over a chosen date range").
 *
 * Two inline-SVG column charts — no charting dependency, per this slice's
 * assignment. Every value is a REAL `getDashboardStats` aggregate for a real
 * business date; there is no interpolation, no smoothing and no simulated
 * point. A day with zero orders draws a zero-height column, not a gap and
 * not an invented minimum.
 *
 * One hue, light business-date axis: a day-over-day series is a magnitude
 * measure of a single quantity, which the dataviz skill's colour formula
 * calls for a single sequential hue (`--color-accent`) rather than a
 * categorical palette — there is only one series here, so no legend box is
 * drawn (a single swatch would only restate the chart's own title).
 *
 * A Server Component: it takes already-aggregated primitives and formats
 * them with the caller's `t` / `locale`, so it needs no client hook.
 */

import { formatMoney, formatNumber, type Translator } from '@/lib/i18n/format'
import type { Locale } from '@/lib/i18n/types'
import type { Money } from '@/lib/money'

export interface AnalyticsSeriesPoint {
  /** 'YYYY-MM-DD', the branch's own business date. */
  date: string
  revenue: Money
  orderCount: number
}

export interface AnalyticsChartsProps {
  series: readonly AnalyticsSeriesPoint[]
  currency: string
  currencyDecimals: number
  locale: Locale
  t: Translator
}

const CHART_WIDTH = 640
const CHART_HEIGHT = 160
const BASELINE = CHART_HEIGHT - 20
const TOP_PAD = 12
const BAR_MAX_THICK = 24
const GAP = 4

function ColumnChart({
  points,
  values,
  valueLabel,
  formatValue,
  formatTick,
}: {
  points: readonly AnalyticsSeriesPoint[]
  values: readonly number[]
  valueLabel: string
  formatValue: (value: number) => string
  formatTick: (date: string) => string
}): React.JSX.Element {
  const max = Math.max(1, ...values)
  const plotHeight = BASELINE - TOP_PAD
  const count = Math.max(1, points.length)
  const slot = CHART_WIDTH / count
  const barWidth = Math.max(3, Math.min(BAR_MAX_THICK, slot - GAP))
  // Thin out x-axis labels so they never collide: at most ~7 shown.
  const labelStride = Math.max(1, Math.ceil(count / 7))

  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      role="img"
      aria-label={valueLabel}
      className="h-40 w-full text-text-subtle"
      preserveAspectRatio="none"
    >
      <line
        x1={0}
        y1={BASELINE}
        x2={CHART_WIDTH}
        y2={BASELINE}
        stroke="currentColor"
        strokeOpacity={0.35}
        strokeWidth={1}
      />
      {points.map((point, index) => {
        const value = values[index] ?? 0
        const height = max === 0 ? 0 : (value / max) * plotHeight
        const x = index * slot + (slot - barWidth) / 2
        const y = BASELINE - height
        return (
          <g key={point.date}>
            <rect
              x={x}
              y={height === 0 ? BASELINE - 1 : y}
              width={barWidth}
              height={height === 0 ? 1 : height}
              rx={4}
              className="fill-accent"
            >
              <title>{`${point.date}: ${formatValue(value)}`}</title>
            </rect>
            {index % labelStride === 0 && (
              <text
                x={x + barWidth / 2}
                y={CHART_HEIGHT - 4}
                textAnchor="middle"
                className="fill-text-subtle text-[9px]"
              >
                {formatTick(point.date)}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

/** 'YYYY-MM-DD' → 'MM-DD', locale-agnostic and always the right width. */
function shortTick(date: string): string {
  return date.slice(5)
}

export function AnalyticsCharts({
  series,
  currency,
  currencyDecimals,
  locale,
  t,
}: AnalyticsChartsProps): React.JSX.Element {
  const revenueValues = series.map((point) => point.revenue)
  const orderValues = series.map((point) => point.orderCount)

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h3 className="text-admin-h3 text-text">{t('admin.analytics.revenue')}</h3>
        <ColumnChart
          points={series}
          values={revenueValues}
          valueLabel={t('admin.analytics.revenue')}
          formatValue={(value) => formatMoney(value, currency, currencyDecimals, locale)}
          formatTick={shortTick}
        />
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="text-admin-h3 text-text">{t('admin.analytics.orders')}</h3>
        <ColumnChart
          points={series}
          values={orderValues}
          valueLabel={t('admin.analytics.orders')}
          formatValue={(value) => formatNumber(value, locale)}
          formatTick={shortTick}
        />
      </div>

      {/* The table view every chart in this system carries alongside it — the
          same numbers the bars encode, for a reader who wants them exactly. */}
      <div className="overflow-x-auto rounded-card border border-border">
        <table className="w-full border-collapse text-admin-sm">
          <caption className="sr-only">
            {t('admin.analytics.revenue')} · {t('admin.analytics.orders')}
          </caption>
          <thead>
            <tr className="border-b border-border text-start text-admin-xs uppercase text-text-subtle">
              <th scope="col" className="px-3 py-2 text-start">
                {t('common.date')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {t('admin.analytics.revenue')}
              </th>
              <th scope="col" className="px-3 py-2 text-end">
                {t('admin.analytics.orders')}
              </th>
            </tr>
          </thead>
          <tbody>
            {series.map((point) => (
              <tr key={point.date} className="border-b border-border-subtle last:border-b-0">
                <td className="px-3 py-1.5 text-text-muted">{point.date}</td>
                <td className="u-tnum px-3 py-1.5 text-end text-text">
                  {formatMoney(point.revenue, currency, currencyDecimals, locale)}
                </td>
                <td className="u-tnum px-3 py-1.5 text-end text-text">{formatNumber(point.orderCount, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
