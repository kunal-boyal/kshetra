import { z } from 'zod';

/**
 * Sign-in at the directory (module M1, spec 11.2 `/auth/v1`), and the claims every cell reads from
 * an access token (spec 11.1). Apps and the API share these, so a field means the same on both
 * sides.
 */

const Phone = z.string().trim().min(6).max(32).meta({
  description: 'A mobile number. Without a country code it is read as Indian (+91).',
});
const Secret = z.string().min(20).max(256);

export const OtpRequestBody = z.strictObject({ phone: Phone });

/** The same answer whether or not the number is registered (M1, rule 2). */
export const OtpRequestResult = z.object({ expiresInSeconds: z.int() });

export const OtpVerifyBody = z.strictObject({
  phone: Phone,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

export const Session = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  refreshToken: z.string(),
  refreshTokenExpiresAt: z.iso.datetime(),
});

/** The tenant a session belongs to, and the cell the app talks to from now on (spec 9.3). */
export const TenantSummary = z.object({
  id: z.uuid(),
  name: z.string(),
  cellUrl: z.url(),
});

export const SignedIn = z.object({
  status: z.literal('signed_in'),
  tenant: TenantSummary,
  session: Session,
});

/** A number in several tenants: pick one with the ticket, without a second code (M1, rule 4). */
export const ChooseTenant = z.object({
  status: z.literal('choose_tenant'),
  ticket: z.string(),
  tenants: z.array(TenantSummary.pick({ id: true, name: true })),
});

export const OtpVerifyResult = z.discriminatedUnion('status', [SignedIn, ChooseTenant]);

export const SelectTenantBody = z.strictObject({ ticket: Secret, tenantId: z.uuid() });

export const RefreshBody = z.strictObject({ refreshToken: Secret });

export const RefreshResult = z.object({ session: Session });

export const SwitchTenantBody = z.strictObject({ refreshToken: Secret, tenantId: z.uuid() });

export const LogoutBody = RefreshBody;

/**
 * Access token claims (spec 11.1): the user, their tenant, the cell that serves it and their auth
 * revision (BR-39). `did`, the device, joins with device binding.
 */
export const AccessClaims = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  cell: z.string().min(1),
  rev: z.int().min(0),
  did: z.uuid().optional(),
});

/** `GET /v1/me`: who the token belongs to. The user's profile joins with the users table. */
export const MeResult = z.object({
  userId: z.uuid(),
  tenantId: z.uuid(),
  cell: z.string(),
});

export type OtpRequestResult = z.infer<typeof OtpRequestResult>;
export type Session = z.infer<typeof Session>;
export type TenantSummary = z.infer<typeof TenantSummary>;
export type SignedIn = z.infer<typeof SignedIn>;
export type ChooseTenant = z.infer<typeof ChooseTenant>;
export type OtpVerifyResult = z.infer<typeof OtpVerifyResult>;
export type RefreshResult = z.infer<typeof RefreshResult>;
export type AccessClaims = z.infer<typeof AccessClaims>;
export type MeResult = z.infer<typeof MeResult>;
