import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Secrets people type, kept only as scrypt hashes with a 16-byte salt, written as
 * `scrypt$<log2N>$<r>$<p>$<salt>$<key>` so the cost can rise without breaking old hashes.
 *
 * Staff passwords (spec M1, decisions D88 and D101) take N = 2^15, r = 8, p = 3: one of OWASP's
 * equivalent scrypt settings, chosen over N = 2^17 because it needs 32 MiB a hash rather than
 * 128, so sign-ins with unknown emails can't exhaust an API task's memory. A hash at an older
 * cost is replaced at the next sign-in (`needsRehash()`).
 */

export interface HashCost {
  log2N: number;
  r: number;
  p: number;
  keyLength: number;
}

export const PASSWORD_COST: HashCost = { log2N: 15, r: 8, p: 3, keyLength: 32 };

/**
 * Recovery codes carry 50 random bits, far beyond guessing offline at any scrypt cost, so they
 * take a lighter one: ten are hashed whenever an authenticator is set up.
 */
export const RECOVERY_CODE_COST: HashCost = { log2N: 14, r: 8, p: 1, keyLength: 32 };

function derive(password: string, salt: Buffer, cost: HashCost): Promise<Buffer> {
  const { log2N, r, p, keyLength } = cost;
  return new Promise((resolve, reject) =>
    scrypt(
      password.normalize('NFKC'),
      salt,
      keyLength,
      { N: 2 ** log2N, r, p, maxmem: 256 * 2 ** log2N * r },
      (error, key) => (error ? reject(error) : resolve(key)),
    ),
  );
}

function parse(stored: string): { cost: HashCost; salt: Buffer; key: Buffer } | null {
  const [scheme, log2N, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return null;
  const expected = Buffer.from(key, 'base64url');
  const cost = { log2N: Number(log2N), r: Number(r), p: Number(p), keyLength: expected.length };
  // A stored hash names its own cost; refuse one that would ask for more than the strongest.
  if (![cost.log2N, cost.r, cost.p].every(Number.isInteger) || cost.log2N > 17 || cost.p > 16) {
    return null;
  }
  return { cost, salt: Buffer.from(salt, 'base64url'), key: expected };
}

export async function hashPassword(
  password: string,
  cost: HashCost = PASSWORD_COST,
): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, cost);
  return [
    'scrypt',
    cost.log2N,
    cost.r,
    cost.p,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  const actual = await derive(password, parsed.salt, parsed.cost);
  return timingSafeEqual(actual, parsed.key);
}

/** Whether a hash was made at another cost than `cost`, so it should be made again. */
export function needsRehash(stored: string, cost: HashCost = PASSWORD_COST): boolean {
  const parsed = parse(stored);
  return (
    !parsed ||
    parsed.cost.log2N !== cost.log2N ||
    parsed.cost.r !== cost.r ||
    parsed.cost.p !== cost.p ||
    parsed.cost.keyLength !== cost.keyLength
  );
}

/**
 * A hash nobody's password matches, at the current cost, checked when an email is unknown, so a
 * wrong email takes as long as a wrong password.
 */
export const DECOY_HASH =
  'scrypt$15$8$3$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
