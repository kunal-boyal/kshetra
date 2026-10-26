import { Injectable, Logger } from '@nestjs/common';
import type { ErrorCode } from '@thelamp/shared';
import type { FastifyRequest } from 'fastify';
import { currentRequest } from './request-context';

/**
 * Security events (ASVS V16.3, decision D101), one JSON line each in the `Security` context on
 * standard output. In AWS they reach CloudWatch through the container's log driver, where the
 * application can't change them, so they hold even if the database is reached.
 *
 * - `refused`: a security control refused a request; `code` says which.
 * - `signed_in`: a sign-in finished, with its `factors`.
 * - `sign_in_failed`: a sign-in step failed, naming whom it was for (masked) and why.
 * - `reauthentication_failed`: a signed-in person's password or code didn't check out.
 * - `session_reused`: a spent refresh token came back, and its whole family ended.
 * - `audit`: an audit entry committed, mirrored here without its values.
 */
export type SecurityEventKind =
  | 'refused'
  | 'signed_in'
  | 'sign_in_failed'
  | 'reauthentication_failed'
  | 'session_reused'
  | 'audit';

export interface SecurityEvent {
  event: SecurityEventKind;
  /** `directory` for the sign-in and console plane's own records; the cell's otherwise. */
  plane?: 'cell' | 'directory';
  tenantId?: string;
  /** Who acted: `user:<id>`, `api_client:<id>`, `support:<grant id>`, `staff:<id>` or `system`. */
  actor?: string;
  /** Whom a failed sign-in was for, masked: a phone's last digits, an email's first letter. */
  subject?: string;
  /** How someone signed in, or tried to: `sms_code`, `sso`, `password`, `support_grant`. */
  method?: string;
  factors?: string[];
  reason?: string;
  code?: ErrorCode;
  /** For `audit`: the action and its target as `<type>:<id>`. */
  action?: string;
  target?: string;
}

/** The error codes that mean a security control said no; each such refusal is logged. */
export const SECURITY_CODES: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  'UNAUTHENTICATED',
  'SESSION_REVOKED',
  'FORBIDDEN',
  'OUT_OF_SCOPE',
  'MODULE_DISABLED',
  'USE_MOBILE_APP',
  'IDEMPOTENCY_CONFLICT',
  'DEVICE_NOT_BOUND',
  'GPS_MOCKED',
  'TENANT_READ_ONLY',
  'TENANT_SUSPENDED',
  'RATE_LIMITED',
  'OTP_INVALID',
  'OTP_EXPIRED',
  'SECOND_FACTOR_REQUIRED',
  'SSO_REQUIRED',
  'SUPPORT_READ_ONLY',
]);

/** The tenant and caller of a request, as log lines name them. */
export function callerOf(request: FastifyRequest): { tenantId?: string; actor?: string } {
  const access = request.access;
  if (access) {
    const actor = access.apiClient
      ? `api_client:${access.apiClient.id}`
      : access.support
        ? `support:${access.support.grantId}`
        : `user:${access.userId}`;
    return { tenantId: access.tenantId, actor };
  }
  return request.staff ? { actor: `staff:${request.staff.staffId}` } : {};
}

@Injectable()
export class SecurityLog {
  private readonly logger = new Logger('Security');

  /** Writes one event, with the current request's ID, address, tenant and caller where known. */
  record(event: SecurityEvent): void {
    const request = currentRequest();
    this.logger.log({
      ...(request
        ? {
            requestId: String(request.id),
            ip: request.clientIp,
            path: `${request.method} ${request.routeOptions?.url ?? request.url.split('?')[0]}`,
            ...callerOf(request),
          }
        : {}),
      ...event,
    });
  }
}
