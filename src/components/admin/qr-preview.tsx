'use client'

/**
 * src/components/admin/qr-preview.tsx — QrPreview.
 *
 * The "View QR" dialog: fetches the table's live token and a rendered PNG
 * through `getTableQrAction` (`qrTargetUrl` / `qrPngDataUrl` from
 * `table-service.ts`) only when opened — the token is a bearer capability
 * and is never carried by the tables list itself.
 */

import { useEffect, useState } from 'react'
import { Copy } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'
import { QrDownloadButton } from '@/components/admin/qr-download-button'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'
import type { AppError } from '@/types/result'
import { getTableQrAction } from '@/app/(admin)/admin/tables/actions'

interface QrData {
  qrUrl: string
  pngDataUrl: string
}

export interface QrPreviewProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  tableNumber: string
}

export function QrPreview({ open, onOpenChange, tableId, tableNumber }: QrPreviewProps): React.JSX.Element {
  const t = useT()
  const [data, setData] = useState<QrData | null>(null)
  const [error, setError] = useState<AppError | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setData(null)
    setError(null)
    setLoading(true)

    let cancelled = false
    void (async () => {
      const result = await getTableQrAction({ id: tableId })
      if (cancelled) return
      if (!result.ok) {
        setError(result.error)
      } else {
        setData({ qrUrl: result.data.qrUrl, pngDataUrl: result.data.pngDataUrl })
      }
      setLoading(false)
    })()

    return () => {
      cancelled = true
    }
  }, [open, tableId])

  async function copyLink(): Promise<void> {
    if (!data) return
    try {
      await navigator.clipboard.writeText(data.qrUrl)
      toast.success(t('common.copied'))
    } catch {
      toast.error(t('toasts.actionFailed'))
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('admin.tables.qrTitle')}
      description={t('admin.tables.qrHint')}
      size="sm"
    >
      <div className="flex flex-col items-center gap-4">
        {loading && <LoadingState label={t('states.loading.tables')} variant="indeterminate" />}

        {error && (
          <ErrorState
            code={error.wire ?? 'unknown'}
            title={t('states.error.tables.title')}
            description={t('states.error.tables.body')}
          />
        )}

        {data && !loading && !error && (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL cannot go through next/image's loader. */}
            <img
              src={data.pngDataUrl}
              alt=""
              className="size-48 rounded-card border border-border bg-white p-2"
            />

            <p className="break-all text-center text-caption text-text-subtle">{data.qrUrl}</p>

            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                iconStart={<Copy aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
                onClick={() => {
                  void copyLink()
                }}
              >
                {t('admin.tables.copyUrl')}
              </Button>
              <QrDownloadButton tableId={tableId} tableNumber={tableNumber} />
            </div>
          </>
        )}
      </div>
    </Dialog>
  )
}
