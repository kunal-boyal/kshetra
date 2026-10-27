import { z } from 'zod';
import { APP_PLATFORMS } from '../app-version';

/**
 * Sign-in at the directory (module M1, spec 11.2 `/auth/v1`), and the claims every cell reads from
 * an access token (spec 11.1). Apps and the API share these, so a field means the same on both
 * sides.
 */

export const PhoneInput = z.string().trim().min(6).max(32).meta({
  description: 'A mobile number. Without a country code it is read as Indian (+91).',
});
const Secret = z.string().min(20).max(256);

export const OtpRequestBody = z.strictObject({ phone: PhoneInput });

/** The same answer whether or not the number is registered (M1, rule 2). */
export const OtpRequestResult = z.object({ expiresInSeconds: z.int() });

/**
 * The phone the mobile app runs on. The app makes `key` once, keeps it in its secure store and
 * sends it with every sign-in, so the tenant can bind the user to this phone (M1, rule 5). The web
 * sends no device, and its sessions are never bound.
 */
export const DeviceInfo = z.strictObject({
  key: z
    .string()
    .regex(/^[A-Za-z0-9_-]{32,128}$/, 'Use 32 to 128 random base64url characters')
    .meta({ description: 'A random secret the app makes once and keeps in its secure store' }),
  platform: z.enum(APP_PLATFORMS),
  model: z.string().trim().max(100).optional(),
  osVersion: z.string().trim().max(40).optional(),
  appVersion: z.string().trim().max(40).optional(),
});

export const OtpVerifyBody = z.strictObject({
  phone: PhoneInput,
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
  device: DeviceInfo.optional(),
});

/**
 * The web sends this header with every request to the directory. Its refresh token then travels
 * only in an httpOnly, same-site cookie (spec 13.1), and a request that relies on that cookie must
 * carry the header, which a page on another site can't add without the API's CORS consent.
 */
export const WEB_CLIENT_HEADER = 'x-client';
export const WEB_CLIENT = 'web';

/** `GET /auth/v1/jwks`: the public keys cells check access tokens with (spec 9.3). */
export const JwksResult = z.object({
  keys: z.array(
    z.looseObject({
      kty: z.string(),
      kid: z.string(),
      alg: z.string().optional(),
      use: z.string().optional(),
    }),
  ),
});

export const Session = z.object({
  tokenType: z.literal('Bearer'),
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
  /** Absent for the web, whose refresh token is in a cookie the page can't read. */
  refreshToken: z.string().optional(),
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

/**
 * A web sign-in by someone who can change access: an authenticator code comes next, on the
 * ticket, and only then the session (spec M1, decision D91). Someone without one sets it up first.
 */
export const SecondFactor = z.object({
  status: z.literal('second_factor'),
  ticket: z.string(),
  enrolled: z.boolean(),
  tenant: TenantSummary.pick({ id: true, name: true }),
});

/** A number belongs to one organisation (decision D103), so a code signs straight in to it. */
export const OtpVerifyResult = z.discriminatedUnion('status', [SignedIn, SecondFactor]);

/** `POST /auth/v1/totp/setup`: a new authenticator secret for someone without one. */
export const TotpSetupBody = z.strictObject({ ticket: Secret });
export const TotpSetupResult = z.object({
  /** Base32, for typing into an authenticator by hand. */
  secret: z.string(),
  /** The `otpauth://` link a QR code carries. */
  uri: z.string(),
});

/** One of the ten single-use recovery codes, such as `K7Q2M-XW4PA`. */
export const RECOVERY_CODE = /^[A-Z2-7]{5}-?[A-Z2-7]{5}$/;

/** `POST /auth/v1/totp/verify`: the code from the authenticator, or a recovery code. */
export const TotpVerifyBody = z
  .strictObject({
    ticket: Secret,
    code: z
      .string()
      .regex(/^\d{6}$/, 'Enter the 6-digit code')
      .optional(),
    recoveryCode: z
      .string()
      .trim()
      .toUpperCase()
      .regex(RECOVERY_CODE, 'Enter a recovery code such as K7Q2M-XW4PA')
      .optional(),
  })
  .refine((body) => (body.code === undefined) !== (body.recoveryCode === undefined), {
    message: 'Enter the code from your authenticator, or a recovery code',
    path: ['code'],
  });

/** Signed in; recovery codes come once, when the authenticator is first set up. */
export const TotpVerifyResult = SignedIn.extend({
  recoveryCodes: z.array(z.string()).optional(),
});

/**
 * `GET /auth/v1/authenticator`: whether the person signed in has an authenticator, and whether
 * their role needs one (decisions D91 and D101). Anyone may set one up; it is then always asked
 * for on the web.
 */
export const AuthenticatorStatus = z.object({ enrolled: z.boolean(), required: z.boolean() });

/** A code from the authenticator, to confirm a new one or to remove it. */
export const AuthenticatorCodeBody = z.strictObject({
  code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});

/** A new authenticator confirmed: its recovery codes, shown once. */
export const AuthenticatorConfirmResult = z.object({ recoveryCodes: z.array(z.string()) });

/** The app sends its refresh token; the web leaves it out and relies on its cookie. */
export const RefreshBody = z.strictObject({ refreshToken: Secret.optional() });

/** A new pair of tokens, and the tenant they belong to, so a reloaded web page knows its cell. */
export const RefreshResult = z.object({ session: Session, tenant: TenantSummary });

export const LogoutBody = RefreshBody;

/**
 * Access token claims (spec 11.1): the user, their tenant, the cell that serves it, their auth
 * revision (BR-39) and, for the mobile app, the device the session is bound to.
 */
export const AccessClaims = z.object({
  sub: z.uuid(),
  tid: z.uuid(),
  cell: z.string().min(1),
  rev: z.int().min(0),
  did: z.uuid().optional(),
  /** The support grant a vendor staff member entered under (decision D93); `sub` is then theirs. */
  sg: z.uuid().optional(),
  /** An API client's scopes (spec 11.1, decision D94); `sub` is then the client's ID. */
  scp: z.array(z.string()).optional(),
  /** The session, its refresh-token family; a session ended early refuses its tokens (D101). */
  sid: z.uuid().optional(),
  /** When the session last gave a fresh authenticator code (step-up, D101), in epoch seconds. */
  sua: z.int().optional(),
});

/** One place someone is signed in (ASVS V7.5.2, decision D101): a refresh-token family. */
export const OwnSession = z
  .object({
    id: z.uuid(),
    kind: z.enum(['web', 'phone', 'sso']),
    /** The browser or app as it named itself, cut short; `describeAgent()` reads it. */
    agent: z.string().nullable(),
    ip: z.string().nullable(),
    startedAt: z.iso.datetime(),
    /** When it last refreshed: in use within the last 15 minutes, or idle since. */
    lastUsedAt: z.iso.datetime(),
    /** The session asking. */
    current: z.boolean(),
  })
  .meta({ id: 'OwnSession' });

export const OwnSessionsResult = z.object({ items: z.array(OwnSession) });

export const SessionIdParams = z.strictObject({ id: z.uuid() });

/**
 * `POST /auth/v1/authenticator/step-up`: a fresh access token for the session, carrying when it
 * gave the code (decision D101).
 */
export const StepUpResult = z.object({
  accessToken: z.string(),
  accessTokenExpiresAt: z.iso.datetime(),
});

export type OwnSession = z.infer<typeof OwnSession>;
export type DeviceInfo = z.infer<typeof DeviceInfo>;
export type OtpRequestResult = z.infer<typeof OtpRequestResult>;
export type Session = z.infer<typeof Session>;
export type TenantSummary = z.infer<typeof TenantSummary>;
export type SignedIn = z.infer<typeof SignedIn>;
export type OtpVerifyResult = z.infer<typeof OtpVerifyResult>;
export type SecondFactor = z.infer<typeof SecondFactor>;
export type TotpVerifyResult = z.infer<typeof TotpVerifyResult>;
export type TotpSetupResult = z.infer<typeof TotpSetupResult>;
export type AuthenticatorStatus = z.infer<typeof AuthenticatorStatus>;
export type AuthenticatorConfirmResult = z.infer<typeof AuthenticatorConfirmResult>;
export type RefreshResult = z.infer<typeof RefreshResult>;
export type AccessClaims = z.infer<typeof AccessClaims>;
