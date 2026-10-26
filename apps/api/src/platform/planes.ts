import type {
  ApiScopeKey,
  BillableSeats,
  CellFiguresShape,
  DataExportResult,
  DeviceInfo,
  ModuleKey,
  SupportScopeKey,
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
  /** A web sign-in whose role can change access: an authenticator code first (decision D91). */
  secondFactor?: boolean;
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
/** Where a tenant stands: its status, the cell it lives on, and whether it is being moved. */
export interface TenantStanding {
  status: TenantStatus;
  cell: string;
  /** Being moved to another cell (decision D95): it reads, and writes wait. */
  moving: boolean;
  /** The cell it is being moved to, while it is. */
  movingTo: string | null;
}

/** A cell as the directory lists it (spec 9.3). */
export interface CellEntry {
  name: string;
  region: string;
  apiBaseUrl: string;
  capacityUsers: number;
}

export abstract class TenantDirectory {
  abstract status(tenantId: string): Promise<TenantStatus | undefined>;
  abstract standing(tenantId: string): Promise<TenantStanding | undefined>;
  abstract bySlug(
    slug: string,
  ): Promise<{ id: string; status: TenantStatus; demo: boolean } | undefined>;
  /** Registers a cell, or keeps the entry it already has. Returns its ID. */
  abstract ensureCell(cell: CellEntry): Promise<string>;
  /**
   * Moving a tenant between cells (decision D95): marks it as moving to `toCell`, which freezes its
   * writes; then either moves its entry there once the new cell holds it, or calls the move off.
   */
  abstract startMove(tenantId: string, toCell: string): Promise<void>;
  abstract finishMove(tenantId: string): Promise<void>;
  abstract cancelMove(tenantId: string): Promise<void>;
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
  /** `apiPerMinute`: requests a minute each API client may make; null keeps the default. */
  limits: { users: number | null; storageGb: number | null; apiPerMinute: number | null };
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

/**
 * People's authenticators (decision D91), kept by the directory: which of a tenant's people have
 * one set up, and removing one, which ends that person's sessions everywhere.
 */
export abstract class SecondFactors {
  abstract enrolled(tenantId: string, userIds: readonly string[]): Promise<Set<string>>;
  abstract reset(tenantId: string, userId: string): Promise<boolean>;
}

/**
 * People's work emails, which the cell keeps, for single sign-on (decision D91): the active
 * person in a tenant with an email, and a person's email.
 */
export abstract class PeopleEmails {
  abstract find(tenantId: string, email: string): Promise<string | null>;
  abstract emailOf(tenantId: string, userId: string): Promise<string | null>;
}

/** An approved support grant that is open now (module M22, decision D93). */
export interface OpenSupportGrant {
  id: string;
  tenantId: string;
  staffId: string;
  staffName: string;
  /** The staff member's auth revision; a change to their access ends the session. */
  staffRevision: number;
  write: boolean;
  endsAt: Date;
}

/**
 * Vendor support's grants, kept by the directory: the cell asks on every request of a support
 * session whether its grant is still open.
 */
export abstract class SupportGrants {
  abstract open(grantId: string): Promise<OpenSupportGrant | null>;
}

/** A change to a support grant made on the vendor's side, for the tenant to see (decision D93). */
export interface SupportChange {
  action: 'support.requested' | 'support.approved' | 'support.ended';
  grantId: string;
  /** The staff member who made the change. */
  byStaffId: string;
  /** The staff member the grant is for. */
  staffName: string;
  reason: string;
  scope: SupportScopeKey;
  hours: number;
  emergency: boolean;
  endsAt: Date | null;
}

/**
 * Where the directory tells a tenant's cell of what vendor staff did with a grant: an entry in the
 * tenant's audit log, and its admins hear of a request or an emergency entry.
 */
export abstract class SupportNotices {
  abstract record(tenantId: string, change: SupportChange): Promise<void>;
}

/** A person's name, which the cell keeps, for records the directory writes about them. */
export abstract class PeopleNames {
  abstract nameOf(tenantId: string, userId: string): Promise<string | null>;
}

/** Where a cell reports its health each minute (decision D93); the directory keeps it. */
export abstract class CellHealthRecorder {
  abstract record(cellName: string, at: Date, figures: CellFiguresShape): Promise<void>;
}

/** An API client whose credentials checked out, for its token (decision D94). */
export interface ApiClientCheck {
  tenantId: string;
  apiClientId: string;
  scopes: ApiScopeKey[];
  authRevision: number;
}

/**
 * The cell's API clients, as the directory's token endpoint asks of them: whether a client ID
 * and secret belong to an active client, and what it may do.
 */
export abstract class ApiClientCredentials {
  abstract check(clientId: string, clientSecret: string): Promise<ApiClientCheck | null>;
}

/** Vendor staff, as the cell records what they do for a tenant from the console. */
export interface StaffActor {
  staffId: string;
  name: string;
}

/**
 * A tenant's data exports and its erasure, which the console reaches on the tenant's cell (module
 * M21, decision D95): the final export of a terminated tenant, a day's link to it to send the
 * customer, and, 30 days on, every row and file the tenant held there.
 */
export abstract class TenantArchives {
  abstract request(tenantId: string, id: string, by: StaffActor): Promise<DataExportResult>;
  abstract list(tenantId: string): Promise<DataExportResult[]>;
  /** One export, with a day's link while it is kept; reading the link is audited. */
  abstract read(tenantId: string, id: string, by: StaffActor): Promise<DataExportResult>;
  abstract erase(tenantId: string): Promise<{ rows: number; files: number }>;
}
