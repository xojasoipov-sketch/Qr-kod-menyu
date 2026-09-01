// src/types/result.ts
import type { QrErrorCode } from '@/lib/security/errors';

/** The 12 failures the product distinguishes. Brief §32 requires a screen for each. */
export type AppErrorCode =
  | 'TABLE_INACTIVE'
  | 'INVALID_QR'
  | 'RESTAURANT_CLOSED'
  | 'ITEM_UNAVAILABLE'
  | 'PRICE_MISMATCH'
  | 'INVALID_TRANSITION'
  | 'RATE_LIMITED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'NETWORK'
  | 'UNKNOWN';

export interface AppError {
  /** What the UI branches on. */
  code: AppErrorCode;
  /** The originating Postgres code, when there was one. For logs and support, never for UI text. */
  wire?: QrErrorCode;
  /** HTTP status a route handler should return. */
  httpStatus: number;
  /** Developer-facing English. NEVER rendered to a user. */
  message: string;
  /** Structured context: { field, menu_item_id, retry_after_seconds, from, to, actor, … }. */
  details?: Readonly<Record<string, unknown>>;
  /** True when repeating the same request may succeed (NETWORK, RATE_LIMITED after the wait). */
  retryable: boolean;
  /** Present on RATE_LIMITED; drives the countdown instead of an error toast. */
  retryAfterSeconds?: number;
  /** Correlation id echoed into the server log line. */
  traceId?: string;
}

export type Ok<T> = { ok: true; data: T };
export type Err = { ok: false; error: AppError };

/** The service-layer return type. Every service function returns this. Nothing throws past it. */
export type Result<T> = Ok<T> | Err;
