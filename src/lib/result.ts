// src/lib/result.ts
import type { AppError, AppErrorCode, Err, Ok, Result } from '@/types/result';

export type { AppError, AppErrorCode, Result } from '@/types/result';

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function err(error: AppError): Err {
  return { ok: false, error };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

export function isErr<T>(result: Result<T>): result is Err {
  return !result.ok;
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

export function mapResult<T, U>(result: Result<T>, fn: (value: T) => U): Result<U> {
  return result.ok ? ok(fn(result.data)) : result;
}

/** Default HTTP status per app code, used when a construction site does not specify one. */
const DEFAULT_STATUS: Readonly<Record<AppErrorCode, number>> = {
  TABLE_INACTIVE: 423,
  INVALID_QR: 404,
  RESTAURANT_CLOSED: 423,
  ITEM_UNAVAILABLE: 409,
  PRICE_MISMATCH: 409,
  INVALID_TRANSITION: 409,
  RATE_LIMITED: 429,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_FAILED: 422,
  NETWORK: 503,
  UNKNOWN: 500,
};

const RETRYABLE: ReadonlySet<AppErrorCode> = new Set<AppErrorCode>([
  'NETWORK', 'RATE_LIMITED', 'UNKNOWN',
]);

/** Build an AppError with sane defaults. Prefer this over an object literal. */
export function appError(
  code: AppErrorCode,
  message: string,
  extra: Partial<Omit<AppError, 'code' | 'message'>> = {},
): AppError {
  return {
    code,
    message,
    httpStatus: extra.httpStatus ?? DEFAULT_STATUS[code],
    retryable: extra.retryable ?? RETRYABLE.has(code),
    ...extra,
  };
}

/**
 * The only exception type this codebase throws deliberately. It exists so that deep helpers
 * (assertTransition, assertMoney callers) can refuse without threading Result through every frame.
 * Every service boundary catches it via toResult().
 */
export class AppErrorException extends Error {
  readonly error: AppError;

  constructor(error: AppError) {
    super(error.message);
    this.name = 'AppErrorException';
    this.error = error;
  }
}

/**
 * The service-layer edge. Runs `fn`, converts AppErrorException into Err, and converts anything
 * else into UNKNOWN without leaking its message to the client.
 */
export async function toResult<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return ok(await fn());
  } catch (thrown) {
    if (thrown instanceof AppErrorException) return err(thrown.error);
    if (thrown instanceof TypeError && /fetch|network/i.test(thrown.message)) {
      return err(appError('NETWORK', thrown.message));
    }
    return err(appError('UNKNOWN', thrown instanceof Error ? thrown.message : String(thrown)));
  }
}
