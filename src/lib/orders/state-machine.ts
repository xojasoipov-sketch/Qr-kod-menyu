// src/lib/orders/state-machine.ts
import type { AppRole, OrderStatus } from '@/types/database';
import { AppErrorException } from '@/lib/result';

/**
 * Everyone who can move an order. AppRole covers staff; CUSTOMER is the anonymous guest
 * (no auth.users row, actor_kind='customer'); SYSTEM is a trigger or cron job
 * (actor_kind='system').
 */
export type ActorRole = AppRole | 'CUSTOMER' | 'SYSTEM';

export const ACTOR_ROLES = [
  'SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN', 'CUSTOMER', 'SYSTEM',
] as const satisfies readonly ActorRole[];

/** Display order and stepper order. Cancelled is off-path. */
export const ORDER_FORWARD_PATH = [
  'pending', 'confirmed', 'preparing', 'ready', 'delivered', 'completed',
] as const satisfies readonly OrderStatus[];

export const TERMINAL_ORDER_STATUSES = ['completed', 'cancelled'] as const satisfies readonly OrderStatus[];

/**
 * STRUCTURAL ENVELOPE — mirrors public.is_valid_order_transition(from, to) exactly.
 * Which edges exist at all, independent of who is asking.
 */
export const ORDER_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending:   ['confirmed', 'cancelled'],
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready:     ['delivered', 'cancelled'],
  delivered: ['completed'],
  completed: [],
  cancelled: [],
} as const;

export type TransitionKey = `${OrderStatus}->${OrderStatus}`;

export function transitionKey(from: OrderStatus, to: OrderStatus): TransitionKey {
  return `${from}->${to}`;
}

/**
 * ACTOR MATRIX — mirrors public.order_transition_allowed(from, to, actor) after the §1.3
 * intersection, extended with CUSTOMER and SYSTEM (which the SQL function cannot type).
 * Every key of ORDER_TRANSITIONS appears here exactly once; the completeness test in
 * src/lib/orders/state-machine.test.ts asserts that.
 */
export const ORDER_TRANSITION_ACTORS: Readonly<Partial<Record<TransitionKey, readonly ActorRole[]>>> = {
  // --- forward path ------------------------------------------------------
  'pending->confirmed':   ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'KITCHEN', 'SYSTEM'],
  'confirmed->preparing': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN'],
  'preparing->ready':     ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'KITCHEN'],
  'ready->delivered':     ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  'delivered->completed': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'SYSTEM'],
  // --- cancellation ------------------------------------------------------
  'pending->cancelled':   ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER', 'CUSTOMER', 'SYSTEM'],
  'confirmed->cancelled': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER', 'WAITER'],
  'preparing->cancelled': ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
  'ready->cancelled':     ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'MANAGER'],
} as const;

/** completed and cancelled are absorbing. Nothing leaves them, for anyone. */
export function isTerminalStatus(status: OrderStatus): boolean {
  return status === 'completed' || status === 'cancelled';
}

/** Position on the forward path; -1 for cancelled. Drives the tracker stepper. */
export function statusIndex(status: OrderStatus): number {
  const index = (ORDER_FORWARD_PATH as readonly OrderStatus[]).indexOf(status);
  return index;
}

/** Structural check only — ignores the actor. Mirrors is_valid_order_transition. */
export function isValidTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === to) return false;
  return ORDER_TRANSITIONS[from].includes(to);
}

/** The roles permitted to traverse this edge; empty for a non-existent edge. */
export function actorsFor(from: OrderStatus, to: OrderStatus): readonly ActorRole[] {
  return ORDER_TRANSITION_ACTORS[transitionKey(from, to)] ?? [];
}

/** The full check: does this edge exist, and may this actor traverse it? */
export function canTransition(from: OrderStatus, to: OrderStatus, role: ActorRole): boolean {
  if (!isValidTransition(from, to)) return false;
  return actorsFor(from, to).includes(role);
}

/**
 * The statuses this actor may move the order to right now.
 * This is what renders the KDS and waiter action buttons — a button that would produce a
 * QR040 must never appear.
 */
export function nextStatuses(status: OrderStatus, role: ActorRole): readonly OrderStatus[] {
  return ORDER_TRANSITIONS[status].filter((to) => actorsFor(status, to).includes(role));
}

/** True when `to` is a cancellation and therefore requires a reason (ck_orders_cancelled_shape). */
export function requiresCancellationReason(to: OrderStatus): boolean {
  return to === 'cancelled';
}

/**
 * Throws AppErrorException with code INVALID_TRANSITION (or FORBIDDEN when the edge exists
 * but this actor may not use it) unless the transition is legal.
 * Services call this before every status write; src/lib/result.ts#toResult converts the throw
 * into Result<never>.
 */
export function assertTransition(
  from: OrderStatus,
  to: OrderStatus,
  role: ActorRole,
): void {
  if (!isValidTransition(from, to)) {
    throw new AppErrorException({
      code: 'INVALID_TRANSITION',
      wire: 'QR040_INVALID_STATUS_TRANSITION',
      httpStatus: 409,
      message: `Illegal order transition ${from} -> ${to}`,
      details: { from, to, actor: role },
      retryable: false,
    });
  }
  if (!actorsFor(from, to).includes(role)) {
    throw new AppErrorException({
      code: 'FORBIDDEN',
      wire: 'QR050_FORBIDDEN',
      httpStatus: 403,
      message: `${role} may not perform ${from} -> ${to}`,
      details: { from, to, actor: role, allowed: [...actorsFor(from, to)] },
      retryable: false,
    });
  }
}
