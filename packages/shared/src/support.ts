import { TENANT_PERMISSIONS, type TenantPermission } from './access';

/**
 * Support access (module M22, decision D93): vendor staff enter a tenant only through a grant its
 * admin approved for a fixed time, or in an emergency one a second vendor admin approved. These
 * are the rules both planes and the apps share.
 */

export const SUPPORT_SCOPES = ['read', 'write'] as const;
export type SupportScope = (typeof SUPPORT_SCOPES)[number];

/** Hours an ordinary grant may last, and the default asked for (spec M22). */
export const SUPPORT_MAX_HOURS = 8;
export const SUPPORT_DEFAULT_HOURS = 4;
/** An emergency grant reads only, for at most two hours (Kunal, 2026-10-25). */
export const SUPPORT_EMERGENCY_MAX_HOURS = 2;
/** A request nobody decided lapses after a day. */
export const SUPPORT_REQUEST_HOURS = 24;

/** The role key a support session shows; no tenant's role may take it. */
export const SUPPORT_ROLE_KEY = 'vendor_support';

/** Permissions a support session never holds, whatever its grant: paying the vendor's bills. */
export const SUPPORT_WITHHELD = ['billing.manage'] as const satisfies readonly TenantPermission[];

/**
 * What a support session may do: every tenant permission but those withheld, across the whole
 * tenant. A read grant holds them too, so its staff can see every screen, settings included; the
 * guard refuses its writes instead (`SUPPORT_READ_ONLY`).
 */
export function supportPermissions(): TenantPermission[] {
  const withheld = new Set<TenantPermission>(SUPPORT_WITHHELD);
  return TENANT_PERMISSIONS.filter((permission) => !withheld.has(permission));
}

export const SUPPORT_STATUSES = [
  'requested',
  'active',
  'declined',
  'ended',
  'expired',
  'lapsed',
] as const;
export type SupportStatus = (typeof SUPPORT_STATUSES)[number];

/** The facts of a grant that decide where it stands. */
export interface SupportGrantFacts {
  createdAt: Date;
  startsAt: Date | null;
  endsAt: Date | null;
  declinedAt: Date | null;
  revokedAt: Date | null;
}

/**
 * Where a grant stands at a moment: waiting for a decision, lapsed undecided after a day,
 * declined, active from its start until its end, ended early, or expired at its end.
 */
export function supportStatus(grant: SupportGrantFacts, now: Date): SupportStatus {
  if (grant.declinedAt) return 'declined';
  if (!grant.startsAt || !grant.endsAt) {
    if (grant.revokedAt) return 'ended';
    const lapses = grant.createdAt.getTime() + SUPPORT_REQUEST_HOURS * 3_600_000;
    return now.getTime() >= lapses ? 'lapsed' : 'requested';
  }
  if (grant.revokedAt && grant.revokedAt < grant.endsAt) return 'ended';
  return now < grant.endsAt ? 'active' : 'expired';
}

/** What is wrong with a request for a grant, or null when it may be made. */
export function supportRequestIssue(request: {
  scope: SupportScope;
  hours: number;
  emergency: boolean;
}): { path: string; issue: string } | null {
  const most = request.emergency ? SUPPORT_EMERGENCY_MAX_HOURS : SUPPORT_MAX_HOURS;
  if (!Number.isInteger(request.hours) || request.hours < 1 || request.hours > most) {
    return { path: 'hours', issue: `Ask for 1 to ${most} hours` };
  }
  if (request.emergency && request.scope !== 'read') {
    return { path: 'scope', issue: 'Emergency access reads only' };
  }
  return null;
}

/**
 * What is wrong with an admin's approval, or null: they may narrow a write request to reading and
 * shorten it, never widen or lengthen it.
 */
export function supportApprovalIssue(
  asked: { scope: SupportScope; hours: number },
  given: { scope: SupportScope; hours: number },
): { path: string; issue: string } | null {
  if (asked.scope === 'read' && given.scope === 'write') {
    return { path: 'scope', issue: 'Support asked only to read' };
  }
  if (!Number.isInteger(given.hours) || given.hours < 1 || given.hours > asked.hours) {
    return { path: 'hours', issue: `Approve 1 to ${asked.hours} hours` };
  }
  return null;
}
