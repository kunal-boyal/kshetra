import { z } from 'zod';
import { EmailAddress } from '../phone';
import { PLATFORM_PERMISSIONS, PLATFORM_ROLES } from '../access';
import { TENANT_STATUSES } from '../tenants';
import { Key } from './config';
import { PhoneInput } from './auth';
import { ProvisionTenantInput, TenantSlug } from './provisioning';

/**
 * The platform console's API (module M22, decision D88): vendor staff, their sign-in with a
 * password and a TOTP code, and the tenants they look after. It lives at `/platform/v1`.
 */

/** The client header a console request that relies on the session cookie carries. */
export const CONSOLE_CLIENT = 'console';

/** Twelve characters at least, and no more than a password manager would make. */
export const StaffPassword = z.string().min(12, 'Use at least 12 characters').max(200);

/** A six-digit code from an authenticator app (RFC 6238). */
export const TotpCode = z.string().regex(/^\d{6}$/, 'Enter the six digits from your app');

export const PlatformRole = z.enum(PLATFORM_ROLES);

export const StaffResult = z
  .object({
    id: z.uuid(),
    email: EmailAddress,
    name: z.string(),
    role: PlatformRole,
    /** Invited until the person sets a password and an authenticator; disabled for good. */
    status: z.enum(['invited', 'active', 'disabled']),
    permissions: z.array(z.enum(PLATFORM_PERMISSIONS)),
    lastSignInAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'Staff' });

/** `POST /platform/v1/setup`: the invitation's secret and the new password. */
export const StaffSetupBody = z.strictObject({
  token: z.string().min(20).max(200),
  password: StaffPassword,
});

/** The authenticator's secret, shown once, as text and as an `otpauth://` link for a QR code. */
export const StaffSetupResult = z.object({
  secret: z.string(),
  uri: z.string(),
});

/** `POST /platform/v1/setup/confirm`: a first code proves the authenticator works. */
export const StaffConfirmBody = z.strictObject({
  token: z.string().min(20).max(200),
  code: TotpCode,
});

export const StaffSignInBody = z.strictObject({
  email: EmailAddress,
  password: z.string().min(1).max(200),
  code: TotpCode,
});

/**
 * `POST /platform/v1/me/password`: a new password, given the current one and a fresh code
 * (decision D101). Every session ends; the one answering takes over.
 */
export const StaffPasswordBody = z.strictObject({
  currentPassword: z.string().min(1).max(200),
  newPassword: StaffPassword,
  code: TotpCode,
});

/** A console session: the access token lives in memory, the refresh token in a cookie. */
export const StaffSession = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  staff: StaffResult,
});

/** `POST /platform/v1/staff`: invites someone; the setup link is shown once. */
export const InviteStaffBody = z.strictObject({
  id: z.uuid(),
  email: EmailAddress,
  name: z.string().trim().min(2).max(100),
  role: PlatformRole,
});

export const InviteStaffResult = z.object({
  staff: StaffResult,
  /** Shown once: whoever opens it sets the password and the authenticator. */
  setupUrl: z.string(),
});

export const StaffListResult = z.object({ items: z.array(StaffResult) });

export const StaffIdParams = z.strictObject({ id: z.uuid() });

/** The claims of a console access token, for the vendor's own audience. */
export const StaffClaims = z.object({
  sub: z.uuid(),
  role: PlatformRole,
  rev: z.int().min(0),
  /** The console session, its refresh-token family (decision D101). */
  sid: z.uuid().optional(),
});

export type StaffClaims = z.infer<typeof StaffClaims>;

export const TenantStatus = z.enum(TENANT_STATUSES);

export const ConsoleTenant = z
  .object({
    id: z.uuid(),
    slug: TenantSlug,
    name: z.string(),
    status: TenantStatus,
    cell: z.object({ name: z.string(), region: z.string(), kind: z.enum(['shared', 'dedicated']) }),
    template: z.object({ key: Key, version: z.int() }),
    /** Its plan (decision D89); none leaves every module open. */
    plan: z
      .object({ id: z.uuid(), key: Key, name: z.object({ en: z.string(), hi: z.string() }) })
      .nullable(),
    /** When the trial ends; null for a tenant that isn't on one. */
    trialEndsAt: z.iso.datetime().nullable(),
    demo: z.boolean(),
    /** People who may sign in now. */
    activeUsers: z.int().min(0),
    /**
     * Termination (decision D95): when it happened, when the data goes, and when it went; null
     * for a tenant that isn't terminated.
     */
    terminatedAt: z.iso.datetime().nullable(),
    deletesAt: z.iso.datetime().nullable(),
    deletedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'ConsoleTenant' });

export const ConsoleTenantQuery = z.strictObject({
  status: TenantStatus.optional(),
  /** A part of the name or slug. */
  q: z.string().trim().min(1).max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(200).optional(),
});

export const ConsoleTenantList = z.object({
  items: z.array(ConsoleTenant),
  nextCursor: z.string().nullable(),
});

export const TenantIdParams = z.strictObject({ id: z.uuid() });

/**
 * `POST /platform/v1/tenants`: a tenant from a template with its first admin. The console makes
 * its ID, so a create sent twice makes one tenant.
 */
export const CreateTenantBody = ProvisionTenantInput.extend({
  id: z.uuid(),
  /** Trial days, for a tenant that opens on trial. */
  trialDays: z.int().min(1).max(90).default(30),
  /** The plan it starts on (decision D89); none leaves every module open. */
  planId: z.uuid().nullable().default(null),
});

/** Suspending says why, for the tenant's record. */
export const SuspendTenantBody = z.strictObject({
  reason: z.string().trim().min(3).max(500),
});

/**
 * Terminating says why, and repeats the tenant's slug, as nothing else in the console is undone
 * by deleting everything 30 days later (decision D95).
 */
export const TerminateTenantBody = z.strictObject({
  reason: z.string().trim().min(3).max(500),
  confirmSlug: z.string().trim().min(1).max(60),
});

/** `POST /platform/v1/tenants/{id}/data-exports`: the export's own ID. */
export const ConsoleDataExportBody = z.strictObject({ id: z.uuid() });

export const TenantExportParams = z.strictObject({ id: z.uuid(), exportId: z.uuid() });

export const TemplateSummary = z.object({
  key: Key,
  version: z.int(),
  name: z.object({ en: z.string(), hi: z.string() }),
  description: z.object({ en: z.string(), hi: z.string() }),
});

export const TemplateListResult = z.object({ items: z.array(TemplateSummary) });

export const CellSummary = z.object({
  name: z.string(),
  region: z.string(),
  kind: z.enum(['shared', 'dedicated']),
  status: z.string(),
  capacityUsers: z.int(),
  tenants: z.int().min(0),
});

export const CellListResult = z.object({ items: z.array(CellSummary) });

export type StaffResult = z.infer<typeof StaffResult>;
export type StaffSession = z.infer<typeof StaffSession>;
export type ConsoleTenant = z.infer<typeof ConsoleTenant>;
export type CreateTenantBody = z.output<typeof CreateTenantBody>;
export type ConsoleTenantQuery = z.output<typeof ConsoleTenantQuery>;
export type InviteStaffBody = z.output<typeof InviteStaffBody>;
export type StaffPasswordBody = z.output<typeof StaffPasswordBody>;
export type TemplateSummary = z.infer<typeof TemplateSummary>;
export type CellSummary = z.infer<typeof CellSummary>;

/**
 * `POST /platform/v1/tenants/{id}/second-factor-resets`: vendor support removes the authenticator
 * of the tenant's member with this number, as when a lone admin has lost theirs (decision D91).
 */
export const SecondFactorResetBody = z.strictObject({
  phone: PhoneInput,
  reason: z.string().trim().min(3).max(500),
});
export const SecondFactorResetResult = z.object({
  /** Whether the person had an authenticator to remove; their sessions end either way. */
  removed: z.boolean(),
});
export type TerminateTenantBody = z.output<typeof TerminateTenantBody>;
