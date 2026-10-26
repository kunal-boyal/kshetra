import { describe, expect, it } from 'vitest';
import {
  fromBase32,
  matchTotp,
  newTotpSecret,
  otpauthUri,
  toBase32,
  totpAt,
  totpStep,
} from './totp';

// RFC 6238, appendix B: SHA-1 with the ASCII secret "12345678901234567890" and 8 digits.
const RFC_SECRET = toBase32(Buffer.from('12345678901234567890'));
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('TOTP (RFC 6238)', () => {
  it.each(RFC_VECTORS)('gives the RFC’s code at %i seconds', (seconds, code) => {
    expect(totpAt(RFC_SECRET, totpStep(seconds * 1000), 8)).toBe(code);
  });

  it('round-trips base32 and makes 160-bit secrets', () => {
    expect(fromBase32(RFC_SECRET).toString()).toBe('12345678901234567890');
    expect(fromBase32(newTotpSecret())).toHaveLength(20);
  });

  it('takes the step now or the one before, never a later one or one already used', () => {
    const secret = newTotpSecret();
    const now = 1_800_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(secret, totpAt(secret, step), null, now)).toBe(step);
    expect(matchTotp(secret, totpAt(secret, step - 1), null, now)).toBe(step - 1);
    // A code from a later step is refused, so a code seen early can't be saved up (D101).
    expect(matchTotp(secret, totpAt(secret, step + 1), null, now)).toBeNull();
    expect(matchTotp(secret, totpAt(secret, step - 2), null, now)).toBeNull();
    // A code used once doesn't work again, nor does an earlier one.
    expect(matchTotp(secret, totpAt(secret, step), step, now)).toBeNull();
    expect(matchTotp(secret, totpAt(secret, step - 1), step, now)).toBeNull();
    expect(matchTotp(secret, '12345', null, now)).toBeNull();
  });

  it('writes the link authenticator apps read', () => {
    expect(otpauthUri('The Lamp', 'asha@example.com', 'ABC')).toBe(
      'otpauth://totp/The%20Lamp%3Aasha%40example.com?secret=ABC&issuer=The+Lamp&algorithm=SHA1&digits=6&period=30',
    );
  });
});
