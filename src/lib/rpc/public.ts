/**
 * The public capability API, from the TypeScript side.
 *
 * Every public read and write in the product goes through one of these six
 * functions. Each one does the same four things, in the same order, for the
 * same reason:
 *
 *   1. parse the INPUT   — so a malformed token never reaches the database
 *   2. call the RPC      — the anon role can do nothing else
 *   3. parse the OUTPUT  — so a changed payload fails loudly here
 *   4. return a Result   — so callers handle failure by type, not by try/catch
 *
 * Nothing in this module decides authorisation. The QR token is a bearer
 * capability and the database decides what it unlocks; this module's job is to
 * make the boundary narrow, typed, and impossible to bypass by accident.
 */
import type { z } from 'zod'

import { appError, err, ok, type Result } from '@/lib/result'
import { mapPgError } from '@/lib/security/errors'
import { createPublicClient } from '@/lib/supabase/public-client'
import {
  CallWaiterInputSchema,
  CancelOrderInputSchema,
  GetOrderInputSchema,
  PlaceOrderInputSchema,
  PublicMenuSchema,
  PublicOrderSchema,
  PublicTableContextSchema,
  WaiterCallResultSchema,
  type PublicMenu,
  type PublicOrder,
  type PublicTableContext,
  type WaiterCallResult,
} from '@/lib/rpc/schemas'

/** Validates a caller's arguments before anything leaves the process. */
function parseInput<S extends z.ZodType>(schema: S, value: unknown): Result<z.infer<S>> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return err(
      appError('VALIDATION_FAILED', 'Request rejected before it reached the database', {
        httpStatus: 422,
        details: { issues: parsed.error.issues },
      }),
    )
  }
  return ok(parsed.data)
}

/**
 * Validates a database payload.
 *
 * A mismatch here means the SQL and this contract have diverged — a deployment
 * problem, not a user problem — so it is reported as UNKNOWN rather than dressed
 * up as something the diner did wrong.
 */
function parseOutput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  fn: string,
): Result<z.infer<S>> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return err(
      appError('UNKNOWN', `${fn} returned a payload this build does not understand`, {
        httpStatus: 502,
        details: { issues: parsed.error.issues },
        retryable: false,
      }),
    )
  }
  return ok(parsed.data)
}

/* ------------------------------------------------------------------ */
/* 1. Resolve a table                                                  */
/* ------------------------------------------------------------------ */

/**
 * Turns `/t/<token>` into the branding and pricing context of one table.
 * Raises rather than returns for an unknown token, an inactive table, an
 * inactive branch or an inactive restaurant — each maps to a distinct code so
 * the page can say which of those it is.
 */
export async function resolveTable(token: string): Promise<Result<PublicTableContext>> {
  const input = parseInput(PublicTableContextSchema.shape.token, token)
  if (!input.ok) return input

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('public_resolve_table', { p_token: input.data })
  if (error) return err(mapPgError(error))

  return parseOutput(PublicTableContextSchema, data, 'public_resolve_table')
}

/* ------------------------------------------------------------------ */
/* 2. Fetch the menu                                                   */
/* ------------------------------------------------------------------ */

/**
 * The whole branch menu in one round trip, including unavailable dishes.
 * They arrive flagged rather than omitted so the UI can grey them out — a diner
 * discovering absence is a diner asking a waiter where the plov went.
 */
export async function getMenu(token: string): Promise<Result<PublicMenu>> {
  const input = parseInput(PublicMenuSchema.shape.token, token)
  if (!input.ok) return input

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('public_get_menu', { p_token: input.data })
  if (error) return err(mapPgError(error))

  return parseOutput(PublicMenuSchema, data, 'public_get_menu')
}

/* ------------------------------------------------------------------ */
/* 3. Place an order                                                   */
/* ------------------------------------------------------------------ */

export interface PlaceOrderArgs {
  token: string
  items: { menu_item_id: string; quantity: number; option_ids?: string[]; note?: string | null }[]
  note?: string | null
  /** Created with the cart, reused on every retry. This is the idempotency key. */
  client_request_id: string
}

/**
 * The security boundary of the product.
 *
 * The payload deliberately carries no prices — only dish ids, quantities,
 * chosen option ids and notes. Every amount on the resulting order is read from
 * `menu_items.price` inside the database transaction, under row locks, so a
 * concurrent "mark unavailable" cannot slip between the check and the write.
 * A tampered client can therefore change what it displays, never what it is
 * charged.
 */
export async function placeOrder(args: PlaceOrderArgs): Promise<Result<PublicOrder>> {
  const input = parseInput(PlaceOrderInputSchema, args)
  if (!input.ok) return input

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('public_place_order', {
    p_token: input.data.token,
    p_items: input.data.items,
    p_note: input.data.note,
    p_client_request_id: input.data.client_request_id,
  })
  if (error) return err(mapPgError(error))

  return parseOutput(PublicOrderSchema, data, 'public_place_order')
}

/* ------------------------------------------------------------------ */
/* 4. Read an order                                                    */
/* ------------------------------------------------------------------ */

/**
 * Requires BOTH capabilities: the table's QR token and the order's public code.
 * A tracking link forwarded to a group chat is therefore useless to anyone who
 * is not also holding that table's QR — the same trust boundary as sitting there.
 */
export async function getOrder(token: string, publicCode: string): Promise<Result<PublicOrder>> {
  const input = parseInput(GetOrderInputSchema, { token, public_code: publicCode })
  if (!input.ok) return input

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('public_get_order', {
    p_token: input.data.token,
    p_order_public_id: input.data.public_code,
  })
  if (error) return err(mapPgError(error))

  return parseOutput(PublicOrderSchema, data, 'public_get_order')
}

/* ------------------------------------------------------------------ */
/* 5. Cancel an order                                                  */
/* ------------------------------------------------------------------ */

/**
 * A guest withdrawing an order the kitchen has not accepted.
 *
 * The database refuses anything past `pending`, so the cancel affordance must
 * be rendered from the same rule (`canTransition(status, 'cancelled', 'CUSTOMER')`)
 * rather than shown optimistically and rejected — a button that fails is worse
 * than a button that is not there.
 */
export async function cancelOrder(
  token: string,
  publicCode: string,
  reason: string,
): Promise<Result<PublicOrder>> {
  const input = parseInput(CancelOrderInputSchema, { token, public_code: publicCode, reason })
  if (!input.ok) return input

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('public_cancel_order', {
    p_token: input.data.token,
    p_order_public_id: input.data.public_code,
    p_reason: input.data.reason,
  })
  if (error) return err(mapPgError(error))

  return parseOutput(PublicOrderSchema, data, 'public_cancel_order')
}

/* ------------------------------------------------------------------ */
/* 6. Call a waiter                                                    */
/* ------------------------------------------------------------------ */

/**
 * The cooldown is enforced in the database under `FOR UPDATE`, not by disabling
 * the button, so a refusal comes back as a typed RATE_LIMITED error carrying
 * the seconds remaining. The UI shows that countdown instead of a dead control.
 */
export async function callWaiter(
  token: string,
  reason: string,
): Promise<Result<WaiterCallResult>> {
  const input = parseInput(CallWaiterInputSchema, { token, reason })
  if (!input.ok) return input

  const supabase = createPublicClient()
  const { data, error } = await supabase.rpc('public_call_waiter', {
    p_token: input.data.token,
    p_reason: input.data.reason,
  })
  if (error) return err(mapPgError(error))

  return parseOutput(WaiterCallResultSchema, data, 'public_call_waiter')
}
