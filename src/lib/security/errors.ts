// src/lib/security/errors.ts
import type { PostgrestError } from '@supabase/supabase-js';
import { appError } from '@/lib/result';
import type { AppError, AppErrorCode } from '@/types/result';

/** The doc-02 §10 catalogue, verbatim. */
export type QrErrorCode =
  | 'QR001_INVALID_QR_TOKEN'
  | 'QR002_TABLE_INACTIVE'
  | 'QR003_BRANCH_INACTIVE'
  | 'QR004_RESTAURANT_INACTIVE'
  | 'QR010_ORDER_RATE_LIMITED'
  | 'QR011_WAITER_CALL_COOLDOWN'
  | 'QR012_WAITER_CALL_ALREADY_OPEN'
  | 'QR013_DUPLICATE_ORDER'
  | 'QR020_ITEM_UNAVAILABLE'
  | 'QR022_INVALID_OPTION'
  | 'QR023_INVALID_PAYLOAD'
  | 'QR024_QUANTITY_OUT_OF_RANGE'
  | 'QR030_ORDER_NOT_FOUND'
  | 'QR030_NOT_FOUND'
  | 'QR032_ORDER_EXPIRED'
  | 'QR040_INVALID_STATUS_TRANSITION'
  | 'QR041_INVALID_CALL_TRANSITION'
  | 'QR042_CANCEL_REASON_REQUIRED'
  | 'QR043_ORDER_CLOSED'
  | 'QR050_FORBIDDEN'
  | 'QR051_LAST_OWNER'
  | 'QR052_FORBIDDEN_FIELD'
  | 'QR053_IMMUTABLE_COLUMN'
  | 'QR054_COLUMN_NOT_ALLOWED'
  | 'QR055_PRIVILEGE_ESCALATION'
  | 'QR056_SELF_MODIFICATION'
  | 'QR999_INTERNAL';

/**
 * Wire code -> app code. Exhaustive: adding a QrErrorCode without a row here fails to compile.
 *
 * Note the deliberate collapses:
 *  - QR002/QR003/QR004 all become TABLE_INACTIVE... except QR004, which becomes
 *    RESTAURANT_CLOSED, because the customer copy differs ("this table is out of service" vs
 *    "this restaurant is not accepting orders").
 *  - QR010/QR011 both become RATE_LIMITED; the UI reads retryAfterSeconds, not the code.
 *  - QR013 is NOT an error path in the UI: the caller navigates to the returned order. It maps to
 *    UNKNOWN only if it somehow escapes that handling.
 */
export const QR_TO_APP_ERROR: Readonly<Record<QrErrorCode, AppErrorCode>> = {
  QR001_INVALID_QR_TOKEN: 'INVALID_QR',
  QR002_TABLE_INACTIVE: 'TABLE_INACTIVE',
  QR003_BRANCH_INACTIVE: 'RESTAURANT_CLOSED',
  QR004_RESTAURANT_INACTIVE: 'RESTAURANT_CLOSED',
  QR010_ORDER_RATE_LIMITED: 'RATE_LIMITED',
  QR011_WAITER_CALL_COOLDOWN: 'RATE_LIMITED',
  QR012_WAITER_CALL_ALREADY_OPEN: 'RATE_LIMITED',
  QR013_DUPLICATE_ORDER: 'UNKNOWN',
  QR020_ITEM_UNAVAILABLE: 'ITEM_UNAVAILABLE',
  QR022_INVALID_OPTION: 'ITEM_UNAVAILABLE',
  QR023_INVALID_PAYLOAD: 'VALIDATION_FAILED',
  QR024_QUANTITY_OUT_OF_RANGE: 'VALIDATION_FAILED',
  QR030_ORDER_NOT_FOUND: 'NOT_FOUND',
  QR030_NOT_FOUND: 'NOT_FOUND',
  QR032_ORDER_EXPIRED: 'NOT_FOUND',
  QR040_INVALID_STATUS_TRANSITION: 'INVALID_TRANSITION',
  QR041_INVALID_CALL_TRANSITION: 'INVALID_TRANSITION',
  QR042_CANCEL_REASON_REQUIRED: 'VALIDATION_FAILED',
  QR043_ORDER_CLOSED: 'INVALID_TRANSITION',
  QR050_FORBIDDEN: 'FORBIDDEN',
  QR051_LAST_OWNER: 'FORBIDDEN',
  QR052_FORBIDDEN_FIELD: 'FORBIDDEN',
  QR053_IMMUTABLE_COLUMN: 'FORBIDDEN',
  QR054_COLUMN_NOT_ALLOWED: 'FORBIDDEN',
  QR055_PRIVILEGE_ESCALATION: 'FORBIDDEN',
  QR056_SELF_MODIFICATION: 'FORBIDDEN',
  QR999_INTERNAL: 'UNKNOWN',
};

const HTTP_BY_WIRE: Readonly<Partial<Record<QrErrorCode, number>>> = {
  QR002_TABLE_INACTIVE: 423,
  QR003_BRANCH_INACTIVE: 423,
  QR004_RESTAURANT_INACTIVE: 423,
  QR032_ORDER_EXPIRED: 410,
};

function isQrErrorCode(value: string): value is QrErrorCode {
  return Object.hasOwn(QR_TO_APP_ERROR, value);
}

/**
 * Convert a PostgrestError into an AppError.
 * Doc 02 §10: our errors carry hint === 'RESTAURANT_QR_OS', message === the machine code, and
 * detail === a JSON object. Anything else is an unexpected database failure and becomes UNKNOWN
 * with its text kept server-side only.
 */
export function mapPgError(e: PostgrestError): AppError {
  if (e.hint !== 'RESTAURANT_QR_OS' || !isQrErrorCode(e.message)) {
    return appError('UNKNOWN', `unmapped postgres error: ${e.code} ${e.message}`, {
      wire: 'QR999_INTERNAL',
    });
  }

  const wire = e.message;
  const code = QR_TO_APP_ERROR[wire];

  let details: Record<string, unknown> | undefined;
  try {
    details = e.details ? (JSON.parse(e.details) as Record<string, unknown>) : undefined;
  } catch {
    details = undefined;
  }

  const retryAfter = typeof details?.retry_after_seconds === 'number'
    ? details.retry_after_seconds
    : undefined;

  return appError(code, wire, {
    wire,
    httpStatus: HTTP_BY_WIRE[wire],
    details,
    retryAfterSeconds: retryAfter,
    retryable: code === 'RATE_LIMITED' || code === 'NETWORK',
  });
}

/**
 * The i18n key for the user-visible message.
 * Prefers the specific wire message (so a guest is told "this dish just ran out" rather than the
 * generic "something is unavailable"), and falls back to the app-code message, which is
 * guaranteed to exist in all three message files.
 */
export function messageKeyFor(error: AppError): string {
  return error.wire ? `errors.${error.wire}` : `errors.app.${error.code}`;
}

/** Every app code's fallback key. The i18n completeness test asserts all 12 exist in uz/ru/en. */
export const APP_ERROR_MESSAGE_KEYS: Readonly<Record<AppErrorCode, string>> = {
  TABLE_INACTIVE: 'errors.app.TABLE_INACTIVE',
  INVALID_QR: 'errors.app.INVALID_QR',
  RESTAURANT_CLOSED: 'errors.app.RESTAURANT_CLOSED',
  ITEM_UNAVAILABLE: 'errors.app.ITEM_UNAVAILABLE',
  PRICE_MISMATCH: 'errors.app.PRICE_MISMATCH',
  INVALID_TRANSITION: 'errors.app.INVALID_TRANSITION',
  RATE_LIMITED: 'errors.app.RATE_LIMITED',
  FORBIDDEN: 'errors.app.FORBIDDEN',
  NOT_FOUND: 'errors.app.NOT_FOUND',
  VALIDATION_FAILED: 'errors.app.VALIDATION_FAILED',
  NETWORK: 'errors.app.NETWORK',
  UNKNOWN: 'errors.app.UNKNOWN',
};
