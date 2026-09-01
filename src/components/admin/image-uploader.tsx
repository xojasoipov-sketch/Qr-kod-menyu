'use client'

/**
 * src/components/admin/image-uploader.tsx — ImageUploader.
 *
 * Talks to `POST /api/admin/media` / `DELETE /api/admin/media`
 * (05-app-structure.md §5.3.7) — a Route Handler, not a Server Action,
 * because `multipart/form-data` streaming is one of the four documented
 * reasons a mutation is allowed to be a route instead. The response is
 * `{ url, path, width, height, bytes }`; only `url` and `path` are kept,
 * because those are the two fields `menu_item.image_url` /
 * `menu_item.image_path` (and the category / restaurant equivalents) store.
 */

import { useId, useRef, useState } from 'react'
import { ImagePlus, X } from 'lucide-react'
import Image from 'next/image'

import { Button, IconButton } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { useT } from '@/lib/i18n/provider'

export type ImageUploadKind =
  | 'menu_item'
  | 'menu_category'
  | 'promotion'
  | 'restaurant_logo'
  | 'restaurant_cover'

export interface ImageUploaderValue {
  url: string | null
  path: string | null
}

export interface ImageUploaderProps {
  /** REQUIRED, localised. */
  label: string
  hint?: string
  kind: ImageUploadKind
  value: ImageUploaderValue
  onChange: (next: ImageUploaderValue) => void
  /** default 5 MB, mirrors the route's own cap — a smaller client-side check saves a round trip. */
  maxBytes?: number
}

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

export function ImageUploader({
  label,
  hint,
  kind,
  value,
  onChange,
  maxBytes = DEFAULT_MAX_BYTES,
}: ImageUploaderProps): React.JSX.Element {
  const t = useT()
  const fieldId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File): Promise<void> => {
    if (file.size > maxBytes) {
      setError(t('errors.validation.fileTooLarge', { max: `${Math.round(maxBytes / (1024 * 1024))} MB` }))
      return
    }
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(t('errors.validation.fileType', { types: 'JPEG, PNG, WebP' }))
      return
    }

    setError(null)
    setUploading(true)
    try {
      const body = new FormData()
      body.set('file', file)
      body.set('kind', kind)

      const response = await fetch('/api/admin/media', { method: 'POST', body })
      if (!response.ok) {
        setError(t('toasts.saveFailed'))
        return
      }

      const payload = (await response.json()) as { url: string; path: string }
      onChange({ url: payload.url, path: payload.path })
      toast.success(t('toasts.saved'))
    } catch {
      setError(t('errors.app.NETWORK'))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const handleRemove = async (): Promise<void> => {
    const previousPath = value.path
    onChange({ url: null, path: null })
    if (!previousPath) return

    try {
      await fetch('/api/admin/media', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: previousPath }),
      })
    } catch {
      // The reference is already cleared client-side; a failed cleanup of the
      // storage object is not something this form can retry meaningfully.
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-medium text-text-muted">{label}</span>

      <div className="flex items-center gap-3">
        <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-card border border-border bg-surface-sunken">
          {value.url ? (
            <Image src={value.url} alt="" width={80} height={80} className="size-full object-cover" unoptimized />
          ) : (
            <ImagePlus aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-6 text-text-subtle" />
          )}
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              id={fieldId}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
              }}
            />
            <Button
              variant="secondary"
              size="sm"
              loading={uploading}
              loadingLabel={t('common.saving')}
              onClick={() => inputRef.current?.click()}
            >
              {t('admin.menu.uploadImage')}
            </Button>
            {value.url && (
              <IconButton
                label={t('common.remove')}
                variant="ghost"
                size="sm"
                icon={<X aria-hidden="true" focusable="false" strokeWidth={1.75} className="size-4" />}
                onClick={() => {
                  void handleRemove()
                }}
              />
            )}
            {uploading && <Spinner size="sm" />}
          </div>
          {hint && !error && <p className="text-caption text-text-subtle">{hint}</p>}
          {error && (
            <p role="alert" className="text-caption text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
