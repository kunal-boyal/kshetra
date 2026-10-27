/**
 * How long sign-in sessions last (spec M1, decision D101). Each refresh writes a new token whose
 * expiry is the sooner of the idle limit from now and the absolute limit from the sign-in, so a
 * session left unused ends at the first, and one in use at the second.
 */

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** A phone bound to its device, the web portal, or the web after the organisation's SSO. */
export type SessionKind = 'phone' | 'web' | 'sso';

export const SESSION_LIMITS: Record<SessionKind, { idleMs: number; absoluteMs: number }> = {
  // Field phones work offline for days and are bound to one device.
  phone: { idleMs: 30 * DAY, absoluteMs: 90 * DAY },
  web: { idleMs: 12 * HOUR, absoluteMs: 7 * DAY },
  // The identity provider decides who may still sign in, so its sessions come back to it daily.
  sso: { idleMs: 12 * HOUR, absoluteMs: 12 * HOUR },
};

/** When a session's next refresh token expires, in milliseconds since the epoch. */
export function sessionExpiresAt(kind: SessionKind, startedAt: number, now: number): number {
  const limits = SESSION_LIMITS[kind];
  return Math.min(now + limits.idleMs, startedAt + limits.absoluteMs);
}

/** OIDC `amr` values that name a second factor (RFC 8176). */
const MFA_METHODS = new Set([
  'mfa',
  'otp',
  'hwk',
  'swk',
  'sms',
  'sc',
  'fpt',
  'face',
  'iris',
  'pop',
]);

/** SAML AuthnContextClassRef values, and Entra's claim value, that say a second factor was used. */
const MFA_CONTEXT = /multi-?factor|multipleauthn|mobiletwofactor|timesynctoken|smartcard|mfa/i;

/**
 * Whether an identity provider says the person gave a second factor (decision D101): OIDC's
 * `amr` methods or an `acr` naming it, or SAML's authentication context. An answer that says
 * nothing of it is taken as password alone.
 */
export function providerUsedMfa(answer: {
  amr?: unknown;
  acr?: unknown;
  authnContext?: readonly string[] | undefined;
}): boolean {
  if (Array.isArray(answer.amr) && answer.amr.some((method) => MFA_METHODS.has(String(method)))) {
    return true;
  }
  if (typeof answer.acr === 'string' && MFA_CONTEXT.test(answer.acr)) return true;
  return (answer.authnContext ?? []).some((context) => MFA_CONTEXT.test(context));
}

/**
 * How long a fresh authenticator code lets someone change what decides who signs in as whom: a
 * person's phone or email, their authenticator, the organisation's single sign-on (decision D101).
 */
export const STEP_UP_SECONDS = 10 * 60;
