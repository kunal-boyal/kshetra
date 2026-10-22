import type { DeviceInfo, TenantStatus } from '@kshetra/shared';

/**
 * The seams between the directory plane and a cell (spec 9.3). In phases 0 to 2 both run in one
 * process and these are plain calls; when the directory becomes its own service they become calls
 * between services, and only the providers change.
 */

export interface AdmissionRequest {
  tenantId: string;
  userId: string;
  /** The phone signing in. The web sends none. */
  device?: DeviceInfo;
  /** The address the sign-in came from, for the audit log. */
  ip?: string;
}

export interface Admission {
  /** The device the session is bound to; none for the web. */
  deviceId?: string;
}

/**
 * What the directory asks the tenant's cell when someone signs in: is the user active, may they
 * use this surface, and is this phone the one they are bound to (M1, rules 5 and 9)?
 */
export abstract class CellAdmission {
  abstract admit(request: AdmissionRequest): Promise<Admission>;
}

/** A user's sign-in facts. The cell owns them; the directory keeps a copy to sign people in with. */
export interface MemberState {
  tenantId: string;
  userId: string;
  /** E.164, or null for a user who never signs in (D11). */
  phone: string | null;
  active: boolean;
  authRevision: number;
}

/** What a cell tells the directory whenever a user's sign-in facts change. */
export abstract class MembershipSync {
  abstract sync(member: MemberState): Promise<void>;
}

/** The tenant's status as the directory records it. Cells check it on every request (M1, rule 7). */
export abstract class TenantDirectory {
  abstract status(tenantId: string): Promise<TenantStatus | undefined>;
  /** The open tenants on a cell, for work the cell schedules for each of them (spec 12.3). */
  abstract openTenants(cellName: string): Promise<string[]>;
  /** The tenant's display name, as sign-in shows it. */
  abstract displayName(tenantId: string): Promise<string | undefined>;
  /** Renames the tenant (M2); people see it at their next sign-in or token refresh. */
  abstract rename(tenantId: string, name: string): Promise<void>;
}
