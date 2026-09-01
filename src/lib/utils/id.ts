/**
 * Identifier helpers.
 *
 * `crypto.randomUUID` is available in every runtime this app targets (browser,
 * Node 20+, and the Edge runtime), so there is no dependency and no fallback
 * that would quietly produce weaker identifiers.
 */

/**
 * One id per cart, reused across every retry of that cart's checkout.
 *
 * This is what makes order placement idempotent: the database has a unique
 * index on `orders.client_request_id`, so a diner who taps PLACE ORDER twice,
 * or whose phone retries on a flaky connection, gets the same order back rather
 * than a duplicate. Generate it when the cart is created, NOT at submit time —
 * generating at submit is exactly the bug this prevents.
 */
export function newClientRequestId(): string {
  return crypto.randomUUID()
}

/**
 * Local identity for a cart line, so React can key it and the user can edit or
 * remove one of two lines holding the same dish with different options.
 * Never sent to the server, which identifies lines by position and content.
 */
export function newCartLineId(): string {
  return crypto.randomUUID()
}
