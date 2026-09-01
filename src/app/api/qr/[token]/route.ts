/**
 * src/app/api/qr/[token]/route.ts — the QR code image for one table.
 *
 * A GET here renders the exact bytes a diner's phone camera has to resolve
 * from across a table, in bad restaurant lighting, at whatever size a printer
 * or table-tent maker chose. That drives every default: error correction
 * level `H` (recovers ~30% of the symbol — insurance against smudges, folds,
 * laminate glare and a thumb half-covering the corner) and a four-module
 * quiet zone, the ISO/IEC 18004 "safe" minimum a scanner needs around the
 * symbol — a tighter margin is a documented way to make a phone camera give
 * up right where a table-tent's beveled edge crops the image.
 *
 * The route takes the QR TOKEN itself as the path segment, not a table id.
 * The caller must already hold the capability the token represents — it is
 * printed on the physical table, or already known to whatever admin screen
 * is requesting the image — so rendering it again as pixels discloses
 * nothing a camera pointed at the printed code could not already read.
 * Nothing here touches the database: only the token's SHAPE is checked
 * (`qrTokenSchema`), so a malformed value never reaches the `qrcode`
 * encoder. Whether a well-formed token still resolves to a live table is
 * decided only by @/lib/rpc/public.resolveTable, when someone actually
 * visits `/t/<token>`.
 */
import type { NextRequest } from 'next/server'
import QRCode from 'qrcode'

import { appUrl } from '@/lib/env'
import { qrTokenSchema } from '@/lib/validation/common'

export const runtime = 'nodejs'

const DEFAULT_SIZE = 640
const MIN_SIZE = 128
const MAX_SIZE = 2048

/** Modules of white border around the symbol — ISO/IEC 18004's recommended minimum. */
const QUIET_ZONE_MODULES = 4

type QrFormat = 'png' | 'svg'

function parseFormat(raw: string | null): QrFormat | null {
  if (raw === null || raw === 'png') return 'png'
  if (raw === 'svg') return 'svg'
  return null
}

function parseSize(raw: string | null): number | null {
  if (raw === null) return DEFAULT_SIZE
  const parsed = Number(raw)
  if (!Number.isInteger(parsed)) return null
  if (parsed < MIN_SIZE || parsed > MAX_SIZE) return null
  return parsed
}

function badRequest(message: string): Response {
  return Response.json(
    { error: { code: 'VALIDATION_FAILED', message } },
    { status: 400, headers: { 'Cache-Control': 'no-store' } },
  )
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  const tokenCheck = qrTokenSchema.safeParse(token)
  if (!tokenCheck.success) return badRequest('Malformed QR token.')

  const format = parseFormat(request.nextUrl.searchParams.get('format'))
  if (format === null) return badRequest("format must be 'png' or 'svg'.")

  const size = parseSize(request.nextUrl.searchParams.get('size'))
  if (size === null) {
    return badRequest(`size must be an integer between ${MIN_SIZE} and ${MAX_SIZE}.`)
  }

  const target = `${appUrl()}/t/${tokenCheck.data}`

  // Immutable per token: this response is a pure function of
  // (token, format, size), and rotating a table's token mints a brand-new
  // path here rather than changing what this one returns — so a shared cache
  // can hold it forever without ever serving a capability past its rotation.
  const headers = new Headers({
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    // A crawler has no business indexing a printable capability image either.
    'X-Robots-Tag': 'noindex, nofollow',
  })

  if (format === 'svg') {
    const svg = await QRCode.toString(target, {
      type: 'svg',
      errorCorrectionLevel: 'H',
      margin: QUIET_ZONE_MODULES,
      width: size,
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
    headers.set('Content-Type', 'image/svg+xml')
    return new Response(svg, { status: 200, headers })
  }

  const png = await QRCode.toBuffer(target, {
    type: 'png',
    errorCorrectionLevel: 'H',
    margin: QUIET_ZONE_MODULES,
    width: size,
    color: { dark: '#000000ff', light: '#ffffffff' },
  })
  headers.set('Content-Type', 'image/png')
  return new Response(new Uint8Array(png), { status: 200, headers })
}
