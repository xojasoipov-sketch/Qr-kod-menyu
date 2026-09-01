'use client'

/**
 * src/components/admin/orders-table.tsx — brief §11's admin order list.
 *
 * Filters (status, business date, order-number search) live in the URL query
 * string, not component state: a Server Component page reads
 * `await searchParams` and re-runs `listOrders` itself, so a bookmarked or
 * shared filtered view reproduces exactly (`router.push` here never touches
 * component state directly). Realtime is the doc 06 §5 admin convention —
 * `postgres_changes` on `orders` through `subscribeToBranch` triggers a
 * DEBOUNCED `router.refresh()`, never a hand-rolled row patch, because this
 * table is a paginated, filtered, sorted VIEW of the branch's orders and only
 * the server knows which page a patched row belongs on.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Search } from 'lucide-react'

import { DataTable, type DataTableColumn } from '@/components/ui/data-table'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Select, type SelectOption } from '@/components/ui/select'
import { StatusPill } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { useLocale, useT } from '@/lib/i18n/provider'
import { formatDateTime, formatMoney } from '@/lib/i18n/format'
import { RESYNC_DEBOUNCE_MS } from '@/lib/realtime/channels'
import { isRealtimeAvailable } from '@/lib/realtime/manager'
import { subscribeToBranch } from '@/lib/realtime/subscribe'
import { ORDER_STATUSES, type OrderStatus } from '@/types/database'
import type { OrderView } from '@/types/domain'

export interface OrdersTableProps {
  orders: readonly OrderView[]
  total: number
  limit: number
  offset: number
  branchId: string
  currency: string
  currencyDecimals: number
  timezone: string
  statusFilter: OrderStatus | 'all'
  search: string
  businessDate: string
}

const POLL_INTERVAL_MS = 15_000

export function OrdersTable({
  orders,
  total,
  limit,
  offset,
  branchId,
  currency,
  currencyDecimals,
  timezone,
  statusFilter,
  search,
  businessDate,
}: OrdersTableProps): React.JSX.Element {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const [searchDraft, setSearchDraft] = useState(search)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setSearchDraft(search), [search])

  const pushQuery = useCallback(
    (patch: Record<string, string | null>) => {
      const next = new URLSearchParams(searchParams.toString())
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      // Any filter change starts back at page one.
      if (!('offset' in patch)) next.delete('offset')
      const queryString = next.toString()
      router.push(queryString.length > 0 ? `${pathname}?${queryString}` : pathname)
    },
    [pathname, router, searchParams],
  )

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    if (searchDraft === search) return
    searchTimer.current = setTimeout(() => pushQuery({ search: searchDraft }), 400)
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchDraft])

  // Realtime resync: STATE lane only, debounced, never a manual row patch.
  useEffect(() => {
    if (!isRealtimeAvailable()) {
      const id = setInterval(() => router.refresh(), POLL_INTERVAL_MS)
      return () => clearInterval(id)
    }

    let resyncTimer: ReturnType<typeof setTimeout> | null = null
    const scheduleResync = (): void => {
      if (resyncTimer) return
      resyncTimer = setTimeout(() => {
        resyncTimer = null
        router.refresh()
      }, RESYNC_DEBOUNCE_MS)
    }

    const handle = subscribeToBranch(branchId, {
      onLive: () => {},
      onDown: () => {},
      onProtocolMismatch: () => scheduleResync(),
      onPostgres: (event) => {
        if (event.table === 'orders') scheduleResync()
      },
      onBroadcast: () => {},
    })

    return () => {
      if (resyncTimer) clearTimeout(resyncTimer)
      handle.release()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId])

  const statusOptions: SelectOption<OrderStatus | 'all'>[] = useMemo(
    () => [
      { value: 'all', label: t('common.all') },
      ...ORDER_STATUSES.map((status) => ({ value: status, label: t(`status.order.${status}`) })),
    ],
    [t],
  )

  const columns: readonly DataTableColumn<OrderView>[] = useMemo(
    () => [
      {
        id: 'number',
        header: t('admin.orders.colNumber'),
        cell: (order) => (
          <Link
            href={`/admin/orders/${order.publicCode}`}
            className="font-medium text-accent underline-offset-4 hover:underline"
          >
            {order.orderNumber}
          </Link>
        ),
      },
      {
        id: 'table',
        header: t('admin.orders.colTable'),
        cell: (order) => order.tableNumber ?? '—',
      },
      {
        id: 'status',
        header: t('admin.orders.colStatus'),
        cell: (order) => (
          <StatusPill kind="order" status={order.status} label={t(`status.order.${order.status}`)} size="sm" />
        ),
      },
      {
        id: 'items',
        header: t('admin.orders.colItems'),
        align: 'end',
        cell: (order) => order.lines.reduce((sum, line) => sum + line.quantity, 0),
      },
      {
        id: 'total',
        header: t('admin.orders.colTotal'),
        align: 'end',
        cell: (order) => formatMoney(order.total, currency, currencyDecimals, locale),
      },
      {
        id: 'placed',
        header: t('admin.orders.colPlaced'),
        hideBelow: 'md',
        cell: (order) => formatDateTime(order.placedAt, locale, timezone),
      },
    ],
    [currency, currencyDecimals, locale, t, timezone],
  )

  const page = Math.floor(offset / limit) + 1
  const pageCount = Math.max(1, Math.ceil(total / limit))

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Input
          label={t('admin.orders.searchPlaceholder')}
          hideLabel
          size="sm"
          value={searchDraft}
          onChange={(event) => setSearchDraft(event.target.value)}
          iconStart={<Search className="size-4" strokeWidth={1.75} />}
          placeholder={t('admin.orders.searchPlaceholder')}
          wrapperClassName="w-full max-w-64"
        />
        <Select
          label={t('admin.orders.filterStatus')}
          hideLabel
          size="sm"
          options={statusOptions}
          value={statusFilter}
          onChange={(event) => pushQuery({ status: event.target.value === 'all' ? null : event.target.value })}
          wrapperClassName="w-40"
        />
        <Input
          label={t('admin.orders.filterDate')}
          hideLabel
          type="date"
          size="sm"
          value={businessDate}
          onChange={(event) => pushQuery({ date: event.target.value || null })}
          wrapperClassName="w-44"
        />
      </div>

      <DataTable
        caption={t('admin.orders.title')}
        columns={columns}
        rows={orders}
        getRowId={(order) => order.publicCode}
        empty={
          <EmptyState
            icon={<Search className="size-7" strokeWidth={1.75} />}
            title={t('admin.orders.empty.title')}
            description={t('admin.orders.empty.body')}
            size="sm"
          />
        }
      />

      {total > limit && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-admin-sm text-text-subtle">
            {t('a11y.currentPage')} {page} / {pageCount}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={offset === 0}
              onClick={() => pushQuery({ offset: String(Math.max(0, offset - limit)) })}
            >
              {t('common.previous')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={offset + limit >= total}
              onClick={() => pushQuery({ offset: String(offset + limit) })}
            >
              {t('common.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
