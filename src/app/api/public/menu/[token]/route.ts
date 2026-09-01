/**
 * src/app/api/public/menu/[token]/route.ts — JSON menu for client-side
 * search and refresh (the cart page's availability re-check, "order again"
 * from a finished tracker).
 *
 * Short-lived by design (`Cache-Control: private, no-store`): prices and
 * availability can change between a diner opening the app and refreshing it
 * a minute later, and a shared cache serving one table's menu response to a
 * different browser would be a far worse bug than the extra round trip this
 * avoids. `X-Robots-Tag: noindex` because a capability-scoped JSON payload is
 * not a page a search index should ever hold.
 *
 * All database access goes through @/lib/rpc/public.getMenu, which validates
 * the token again itself — the pre-check below exists only to reject an
 * obviously malformed token before it costs a rate-limit bucket or a round
 * trip, and to answer it with the same 404 an unknown-but-well-formed token
 * gets, so the response never tells a caller which kind of "no" it received.
 */
import type { AppError } from '@/lib/result'
import { getMenu } from '@/lib/rpc/public'
import { checkLimit } from '@/lib/security/rate-limit'
import { qrTokenSchema } from '@/lib/validation/common'

export const runtime = 'nodejs'

const NO_STORE_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex',
}

function errorResponse(error: AppError): Response {
  const headers: Record<string, string> = { ...NO_STORE_HEADERS }
  if (typeof error.retryAfterSeconds === 'number') {
    headers['Retry-After'] = String(error.retryAfterSeconds)
  }
  return Response.json(
    { error: { code: error.code, message: error.message, details: error.details } },
    { status: error.httpStatus, headers },
  )
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params

  if (!qrTokenSchema.safeParse(token).success) {
    return Response.json(
      { error: { code: 'NOT_FOUND', message: 'No such table.' } },
      { status: 404, headers: NO_STORE_HEADERS },
    )
  }

  // Bucketed by the token itself, not by IP — a whole restaurant shares one
  // IP behind NAT, but never shares a table's token (rate-limit.ts §clientIp).
  const limit = checkLimit('get_menu', token)
  if (!limit.allowed) {
    return Response.json(
      { error: { code: 'RATE_LIMITED', message: 'Too many menu requests.' } },
      {
        status: 429,
        headers: { ...NO_STORE_HEADERS, 'Retry-After': String(limit.retryAfterSeconds) },
      },
    )
  }

  const result = await getMenu(token)
  if (!result.ok) return errorResponse(result.error)

  return Response.json({ menu: result.data }, { status: 200, headers: NO_STORE_HEADERS })
}
