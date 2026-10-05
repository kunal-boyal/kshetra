import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/** One-time codes (spec M1, rule 3): six digits, five minutes, five attempts. */
export const OTP = { digits: 6, ttlSeconds: 300, maxAttempts: 5 } as const;

/** A fresh six-digit code, from a cryptographic source. */
export function newCode(): string {
  return String(randomInt(0, 10 ** OTP.digits)).padStart(OTP.digits, '0');
}

/**
 * The only form a code is stored in: an HMAC keyed with the server's pepper and bound to its
 * challenge, so a database copy reveals no codes and one challenge's code fits no other.
 */
export function codeHmac(pepper: string, challengeId: string, code: string): string {
  return createHmac('sha256', pepper).update(`${challengeId}:${code}`).digest('hex');
}

/** Compares two hex digests in constant time. */
export function sameDigest(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/** An unguessable bearer secret: refresh tokens and tenant tickets. */
export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

/** How a bearer secret is stored and looked up. */
export function digest(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}
