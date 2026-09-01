/**
 * src/app/api/health/route.ts — liveness probe for uptime monitors and
 * deploy smoke tests.
 *
 * Never cached (`Cache-Control: no-store`): a monitor polling a stale 200
 * served from an edge cache is worse than no monitor at all — the whole
 * point is that every request hits this process, now.
 *
 * In demo mode there is no database to reach, so the reachability check is
 * skipped rather than faked: `isDemoMode()` decides that up front, never a
 * network call that might coincidentally succeed against nothing. The probe
 * itself never touches Postgres or the service-role key — it is a 2s-bounded
 * fetch of Supabase Auth's own health endpoint, which is enough to tell a
 * monitor the backend is reachable without this route needing any
 * credentials at all.
 */
import { isDemoMode, publicEnv } from '@/lib/env'

export const runtime = 'nodejs'

type CheckState = 'ok' | 'unreachable' | 'skipped'

const startedAt = Date.now()

async function probeSupabase(): Promise<CheckState> {
  const supabaseUrl = publicEnv.NEXT_PUBLIC_SUPABASE_URL
  // Guarded defensively: isDemoMode() being false already guarantees this is
  // set (env.ts refuses a half-configured deployment at startup), but a probe
  // must never throw regardless of how it got here.
  if (!supabaseUrl) return 'unreachable'

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/health`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2000),
    })
    return response.ok ? 'ok' : 'unreachable'
  } catch {
    return 'unreachable'
  }
}

export async function GET(): Promise<Response> {
  const demo = isDemoMode()
  const database: CheckState = demo ? 'skipped' : await probeSupabase()
  const status = database === 'unreachable' ? 'degraded' : 'ok'

  const body = {
    status,
    mode: demo ? 'demo' : 'live',
    checks: { database },
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    checkedAt: new Date().toISOString(),
  }

  return Response.json(body, {
    status: status === 'degraded' ? 503 : 200,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  })
}
