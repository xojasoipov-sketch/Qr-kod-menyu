'use client'

/**
 * src/components/admin/qr-download-button.tsx — QrDownloadButton.
 *
 * A real, print-resolution PNG, fetched from the authenticated
 * `GET /api/qr/[tableId]` route (05-app-structure.md §5.3.6) — not the
 * preview's 512 px inline image. The route sets
 * `Content-Disposition: attachment` when `download=1`, so the browser's own
 * save dialog does the rest; this component's job is only to fetch the
 * bytes as a same-origin blob and click a throwaway link.
 */

import { useState } from 'react'
import { Download } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'

export interface QrDownloadButtonProps {
  tableId: string
  tableNumber: string
  /** default 2048 — print resolution. */
  size?: number
}

export function QrDownloadButton({
  tableId,
  tableNumber,
  size = 2048,
}: QrDownloadButtonProps): React.JSX.Element {
  const t = useT()
  const [downloading, setDownloading] = useState(false)

  async function handleDownload(): Promise<void> {
    setDownloading(true)
    try {
      const response = await fetch(`/api/qr/${tableId}?format=png&size=${size}&download=1`, {
        cache: 'no-store',
      })
      if (!response.ok) {
        toast.error(t('toasts.actionFailed'))
        return
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `table-${tableNumber}.png`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      toast.error(t('errors.app.NETWORK'))
    } finally {
      setDownloading(false)
    }
  }

  return (
    <Button
      variant="secondary"
      size="sm"
      loading={downloading}
      loadingLabel={t('common.download')}
      iconStart={<Download aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
      onClick={() => {
        void handleDownload()
      }}
    >
      {t('admin.tables.downloadPng')}
    </Button>
  )
}
