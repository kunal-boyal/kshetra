/**
 * Every error code the API returns, with its HTTP status (spec 11.4). Clients map each code to a
 * translated message and a next step (spec 8.4), so codes are stable: add new ones, never rename.
 * INTERNAL is the one code the spec's table leaves implicit: an unexpected server failure.
 */
export const ERROR_HTTP_STATUS = {
  VALIDATION: 400,
  UNAUTHENTICATED: 401,
  TOKEN_EXPIRED: 401,
  SESSION_REVOKED: 401,
  FORBIDDEN: 403,
  OUT_OF_SCOPE: 403,
  MODULE_DISABLED: 403,
  USE_MOBILE_APP: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  DEVICE_NOT_BOUND: 409,
  ALREADY_PUNCHED_IN: 409,
  NOT_ON_SHIFT: 409,
  OUTSIDE_SHIFT: 409,
  SHIFT_EXPIRED: 409,
  GPS_MOCKED: 400,
  GPS_STALE: 400,
  GPS_INACCURATE: 400,
  OUTSIDE_GEOFENCE: 409,
  SYNC_WINDOW: 400,
  PHOTO_REQUIRED: 400,
  MEDIA_NOT_READY: 409,
  PRICE_CHANGED: 409,
  TARGET_LOCKED: 409,
  NOT_CURRENT_APPROVER: 409,
  QUOTA_EXCEEDED: 409,
  IMPORT_ERRORS: 400,
  SEAT_LIMIT: 402,
  TENANT_READ_ONLY: 423,
  TENANT_SUSPENDED: 423,
  RATE_LIMITED: 429,
  SYNC_RESET: 410,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  UPGRADE_REQUIRED: 426,
  INTERNAL: 500,
} as const satisfies Record<string, number>;

export type ErrorCode = keyof typeof ERROR_HTTP_STATUS;

/** One problem with one input field, for example `{ path: 'items[0].price', issue: 'Too small' }`. */
export interface ErrorDetail {
  path: string;
  issue: string;
}

/** The body of every error response (spec 11.1). */
export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    details?: ErrorDetail[];
    requestId: string;
  };
}

/** An error the API turns into an error response with its code's HTTP status. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly details: ErrorDetail[] | undefined;
  /** For `RATE_LIMITED`: how long to wait, sent as the `Retry-After` header (spec 11.4). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    code: ErrorCode,
    message: string,
    details?: ErrorDetail[],
    options: { retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = options.retryAfterSeconds;
  }

  get status(): number {
    return ERROR_HTTP_STATUS[this.code];
  }
}

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_HTTP_STATUS, value);
}

/** `['items', 0, 'price']` → `items[0].price`, the path format of spec 11.1. */
export function formatPath(path: readonly PropertyKey[]): string {
  return path.reduce<string>((out, part) => {
    if (typeof part === 'number') return `${out}[${part}]`;
    return out === '' ? String(part) : `${out}.${String(part)}`;
  }, '');
}

/** One problem with one input, at a path such as `['items', 0, 'price']`. */
export function issueAt(path: readonly PropertyKey[], issue: string): ErrorDetail {
  return { path: formatPath(path), issue };
}
