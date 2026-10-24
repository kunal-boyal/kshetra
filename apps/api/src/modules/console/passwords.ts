import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

/**
 * Vendor staff passwords (spec M1, decision D88), kept only as scrypt hashes: N = 2^15, r = 8,
 * p = 1, a 16-byte salt and a 32-byte key, written as `scrypt$15$8$1$<salt>$<key>` so the cost
 * can rise later without breaking old hashes.
 */

const COST = { log2N: 15, r: 8, p: 1, keyLength: 32 };

function derive(
  password: string,
  salt: Buffer,
  log2N: number,
  r: number,
  p: number,
  keyLength: number,
): Promise<Buffer> {
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

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { log2N, r, p, keyLength } = COST;
  const key = await derive(password, salt, log2N, r, p, keyLength);
  return ['scrypt', log2N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, log2N, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64url');
  const actual = await derive(
    password,
    Buffer.from(salt, 'base64url'),
    Number(log2N),
    Number(r),
    Number(p),
    expected.length,
  );
  return timingSafeEqual(actual, expected);
}

/**
 * A hash nobody's password matches, checked when an email is unknown, so a wrong email takes as
 * long as a wrong password.
 */
export const DECOY_HASH =
  'scrypt$15$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
