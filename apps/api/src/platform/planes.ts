import type {
  BillableSeats,
  DeviceInfo,
  ModuleKey,
  TenantStatus,
  UsageMetric,
} from '@thelamp/shared';

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
  /** The template the tenant started from, and its version (spec 5.14). */
  abstract template(tenantId: string): Promise<{ key: string; version: number } | undefined>;
}

/** What a tenant may use (module M23, decision D89): `modules` is null when no plan limits them. */
export interface Entitled {
  modules: readonly ModuleKey[] | null;
  limits: { users: number | null; storageGb: number | null };
  /** A dedicated install whose licence expired past its grace (BR-49): reads only. */
  readOnly?: boolean;
}

/**
 * The tenant's entitlements, from its plan in the directory. Cells close the modules outside them
 * and cap active people at the plan's limit.
 */
export abstract class Entitlements {
  abstract forTenant(tenantId: string): Promise<Entitled>;
}

/** Where a cell sends what it metered for a tenant's month; the directory adds what it knows. */
export abstract class UsageRecorder {
  abstract record(
    tenantId: string,
    period: string,
    metrics: Partial<Record<UsageMetric, string>>,
  ): Promise<void>;
}

/**
 * A tenant's billable seats for some days (BR-45), counted by its cell for the directory's
 * invoices (decision D90): prorated by day on monthly plans, whole on annual ones.
 */
export abstract class SeatCounts {
  abstract billable(
    tenantId: string,
    from: string,
    to: string,
    prorate: boolean,
    billedFrom?: string,
  ): Promise<BillableSeats>;
  /** People active now, as the plan's limit counts them. */
  abstract active(tenantId: string): Promise<number>;
}

/** Who at a tenant hears about billing besides its billing contact: its active admins with email. */
export abstract class TenantContacts {
  abstract admins(tenantId: string): Promise<{ name: string; email: string }[]>;
}
