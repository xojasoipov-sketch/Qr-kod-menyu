import 'server-only'

/**
 * Tables and their QR capability tokens (brief §13, §14, §34.9, §34.10).
 *
 * Two rules shape this file:
 *
 * 1. **A token is never minted here.** `tables.qr_token` has a column DEFAULT of
 *    `generate_qr_token()` (144 bits from pgcrypto) and is frozen against every
 *    direct UPDATE by `trg_tables_guard`. Rotation goes through
 *    `admin_rotate_table_token()`, which is the one caller allowed to lift that
 *    guard, and which archives the retired value into `qr_token_history` so it
 *    can never be reissued or resolved again.
 *
 * 2. **A token is a bearer capability, so it is not list data.** `listTables`
 *    returns a boolean saying a token exists and the rotation count; the token
 *    itself is fetched only by `getTable` and only rendered by the QR endpoint,
 *    which is authenticated and `no-store`.
 */
import { appUrl } from '@/lib/env'
import { AppErrorException, appError, toResult, type Result } from '@/lib/result'
import { mapPgError } from '@/lib/security/errors'
import { createServerClient } from '@/lib/supabase/server'
import { getStaffSession } from '@/lib/services/session'
import type { RotateTableTokenInput, TableInput } from '@/lib/validation/tenancy'
import type { StaffRole, TableRow } from '@/types/database'
import type { StaffSession } from '@/types/domain'

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** What the tables admin list may see. Deliberately NOT the token. */
export interface TableAdminView {
  id: string
  branchId: string
  number: string
  name: string | null
  zone: string | null
  seats: number | null
  sortOrder: number
  isActive: boolean
  hasQrToken: boolean
  qrRotationCount: number
  qrTokenIssuedAt: string
  updatedAt: string
}

/** The single-table view, which does carry the token because the QR needs it. */
export interface TableDetailView extends TableAdminView {
  qrToken: string
  /** The absolute URL the QR encodes. */
  qrUrl: string
}

/* ------------------------------------------------------------------ */
/* Guards                                                              */
/* ------------------------------------------------------------------ */

const TABLE_MANAGER_ROLES: readonly StaffRole[] = ['RESTAURANT_OWNER', 'MANAGER']

async function requireSession(): Promise<StaffSession> {
  const session = await getStaffSession()
  if (!session) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'no staff session', { wire: 'QR050_FORBIDDEN' }),
    )
  }
  return session
}

function assertCanManageTables(session: StaffSession): void {
  if (session.isPlatformAdmin) return
  if (!TABLE_MANAGER_ROLES.includes(session.role)) {
    throw new AppErrorException(
      appError('FORBIDDEN', `${session.role} may not manage tables`, {
        wire: 'QR050_FORBIDDEN',
        details: { role: session.role },
      }),
    )
  }
}

function assertBranchScope(session: StaffSession, branchId: string): void {
  if (session.isPlatformAdmin) return
  if (session.branchId !== null && session.branchId !== branchId) {
    throw new AppErrorException(
      appError('FORBIDDEN', 'branch outside this session', {
        wire: 'QR050_FORBIDDEN',
        details: { branchId },
      }),
    )
  }
}

function notFound(): AppErrorException {
  return new AppErrorException(
    appError('NOT_FOUND', 'table not found', {
      wire: 'QR030_NOT_FOUND',
      details: { entity: 'table' },
    }),
  )
}

function toAdminView(row: TableRow): TableAdminView {
  return {
    id: row.id,
    branchId: row.branch_id,
    number: row.number,
    name: row.name,
    zone: row.zone,
    seats: row.seats,
    sortOrder: row.sort_order,
    isActive: row.is_active,
    hasQrToken: row.qr_token.length > 0,
    qrRotationCount: row.qr_rotation_count,
    qrTokenIssuedAt: row.qr_token_issued_at,
    updatedAt: row.updated_at,
  }
}

/** The URL a scanner lands on. Absolute, because a QR cannot carry a relative path. */
export function qrTargetUrl(qrToken: string): string {
  return `${appUrl()}/t/${qrToken}`
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

export async function listTables(branchId: string): Promise<Result<TableAdminView[]>> {
  return toResult(async () => {
    const session = await requireSession()
    assertBranchScope(session, branchId)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('tables')
      .select('*')
      .eq('branch_id', branchId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true })

    if (error) throw new AppErrorException(mapPgError(error))
    return (data ?? []).map(toAdminView)
  })
}

/**
 * One table, including its live token.
 *
 * There is no separate ownership check, and that is deliberate: the read runs
 * under RLS, so a table belonging to another tenant simply does not exist for
 * this caller. Invisibility IS the check — a second, hand-written comparison
 * would be one more thing to get wrong.
 */
export async function getTable(id: string): Promise<Result<TableDetailView>> {
  return toResult(async () => {
    await requireSession()

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('tables')
      .select('*')
      .eq('id', id)
      .is('deleted_at', null)
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()

    return { ...toAdminView(data), qrToken: data.qr_token, qrUrl: qrTargetUrl(data.qr_token) }
  })
}

/**
 * A PNG data URL of the table's QR, for the admin preview and the print sheet.
 *
 * Black on white at error-correction level M: a warm-tinted, low-contrast QR is
 * a scanning defect dressed as a brand asset, and a diner holding a phone over
 * a table in candlelight has no patience for it.
 */
export async function qrPngDataUrl(
  qrToken: string,
  options: { size?: number; margin?: number } = {},
): Promise<Result<string>> {
  return toResult(async () => {
    await requireSession()

    const { toDataURL } = await import('qrcode')
    return toDataURL(qrTargetUrl(qrToken), {
      type: 'image/png',
      errorCorrectionLevel: 'M',
      width: Math.min(Math.max(options.size ?? 1024, 256), 2048),
      margin: Math.min(Math.max(options.margin ?? 2, 0), 8),
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
  })
}

/* ------------------------------------------------------------------ */
/* Writes                                                              */
/* ------------------------------------------------------------------ */

export async function createTable(
  input: TableInput,
): Promise<Result<{ id: string; qrToken: string }>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageTables(session)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    // qr_token is omitted on purpose: the column DEFAULT mints it. A token this
    // process chose would be a token this process could predict.
    const { data, error } = await supabase
      .from('tables')
      .insert({
        restaurant_id: session.restaurantId,
        branch_id: input.branch_id,
        number: input.number,
        name: input.name,
        zone: input.zone,
        seats: input.seats,
        sort_order: input.sort_order,
        is_active: input.is_active,
      })
      .select('id, qr_token')
      .single()

    if (error) throw new AppErrorException(mapPgError(error))
    return { id: data.id, qrToken: data.qr_token }
  })
}

export async function updateTable(
  input: TableInput & { id: string },
): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageTables(session)
    assertBranchScope(session, input.branch_id)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('tables')
      .update({
        number: input.number,
        name: input.name,
        zone: input.zone,
        seats: input.seats,
        sort_order: input.sort_order,
        is_active: input.is_active,
      })
      .eq('id', input.id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()
    return null
  })
}

/**
 * Take a table out of service. The QR keeps resolving, and
 * `public_resolve_table` answers QR002 — which is why brief §32's "table
 * inactive" screen exists rather than a dead link.
 */
export async function deactivateTable(id: string): Promise<Result<null>> {
  return setTableActive(id, false)
}

export async function setTableActive(id: string, isActive: boolean): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageTables(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('tables')
      .update({ is_active: isActive })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()
    return null
  })
}

/** Soft delete, so `qr_token_history` and any order that references the table survive. */
export async function deleteTable(id: string): Promise<Result<null>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageTables(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase
      .from('tables')
      .update({ deleted_at: new Date().toISOString(), is_active: false })
      .eq('id', id)
      .select('id')
      .maybeSingle()

    if (error) throw new AppErrorException(mapPgError(error))
    if (!data) throw notFound()
    return null
  })
}

interface RotateTokenResult {
  qrToken: string
  qrUrl: string
  rotationCount: number
  issuedAt: string
}

/**
 * Reprint the QR (brief §34.10).
 *
 * The whole operation lives in `admin_rotate_table_token`: it takes the row
 * `FOR UPDATE` (two managers tapping "regenerate" at once would otherwise both
 * try to archive the same retired token), authorises against
 * `can_manage_tables(branch)`, mints from `generate_qr_token(18)`, and audits
 * the change. This function's only job is to call it and read the result.
 */
export async function rotateToken(
  input: RotateTableTokenInput,
): Promise<Result<RotateTokenResult>> {
  return toResult(async () => {
    const session = await requireSession()
    assertCanManageTables(session)

    const supabase = await createServerClient()
    const { data, error } = await supabase.rpc('admin_rotate_table_token', {
      p_table_id: input.table_id,
    })

    if (error) throw new AppErrorException(mapPgError(error))

    const payload = data as { token?: unknown; rotation_count?: unknown; issued_at?: unknown } | null
    const token = typeof payload?.token === 'string' ? payload.token : null
    const rotationCount =
      typeof payload?.rotation_count === 'number' ? payload.rotation_count : 0
    const issuedAt =
      typeof payload?.issued_at === 'string' ? payload.issued_at : new Date().toISOString()

    if (!token) {
      throw new AppErrorException(
        appError('UNKNOWN', 'admin_rotate_table_token returned no token', {
          httpStatus: 502,
          retryable: false,
        }),
      )
    }

    return { qrToken: token, qrUrl: qrTargetUrl(token), rotationCount, issuedAt }
  })
}
