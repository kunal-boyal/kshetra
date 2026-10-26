import { describe, expect, it } from 'vitest';
import { providerUsedMfa, sessionExpiresAt } from './sessions';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('session limits (decision D101)', () => {
  it('ends a web session after 12 hours unused, and 7 days at most', () => {
    const start = Date.UTC(2026, 9, 27, 9);
    expect(sessionExpiresAt('web', start, start)).toBe(start + 12 * HOUR);
    // Refreshed 13 hours before its seventh day ends: 12 more hours, not one past it.
    expect(sessionExpiresAt('web', start, start + 6 * DAY + 11 * HOUR)).toBe(
      start + 6 * DAY + 23 * HOUR,
    );
    expect(sessionExpiresAt('web', start, start + 6 * DAY + 13 * HOUR)).toBe(start + 7 * DAY);
  });

  it('brings SSO sessions back to the provider after 12 hours, however used', () => {
    const start = Date.UTC(2026, 9, 27, 9);
    expect(sessionExpiresAt('sso', start, start + 11 * HOUR)).toBe(start + 12 * HOUR);
  });

  it('keeps a phone 30 days unused and 90 at most', () => {
    const start = Date.UTC(2026, 9, 27, 9);
    expect(sessionExpiresAt('phone', start, start)).toBe(start + 30 * DAY);
    expect(sessionExpiresAt('phone', start, start + 80 * DAY)).toBe(start + 90 * DAY);
  });
});

describe('the identity provider’s second factor (decision D101)', () => {
  it('reads OIDC’s methods and context class', () => {
    expect(providerUsedMfa({ amr: ['pwd', 'mfa'] })).toBe(true);
    expect(providerUsedMfa({ amr: ['pwd', 'otp'] })).toBe(true);
    expect(providerUsedMfa({ amr: ['pwd'] })).toBe(false);
    expect(
      providerUsedMfa({ acr: 'http://schemas.openid.net/pape/policies/2007/06/multi-factor' }),
    ).toBe(true);
    expect(providerUsedMfa({})).toBe(false);
  });

  it('reads SAML’s authentication context', () => {
    expect(
      providerUsedMfa({
        authnContext: ['urn:oasis:names:tc:SAML:2.0:ac:classes:PasswordProtectedTransport'],
      }),
    ).toBe(false);
    expect(
      providerUsedMfa({ authnContext: ['http://schemas.microsoft.com/claims/multipleauthn'] }),
    ).toBe(true);
    expect(
      providerUsedMfa({ authnContext: ['urn:oasis:names:tc:SAML:2.0:ac:classes:TimeSyncToken'] }),
    ).toBe(true);
  });
});
