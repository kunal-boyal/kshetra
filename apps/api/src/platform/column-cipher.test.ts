import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import { ColumnCipher } from './column-cipher';

const KEY_A = Buffer.alloc(32, 7).toString('base64');
const KEY_B = Buffer.alloc(32, 8).toString('base64');

const cipher = (key?: string, previous?: string, env = 'test') =>
  new ColumnCipher({
    NODE_ENV: env,
    OTP_PEPPER: 'local-otp-pepper-change-me',
    ...(key ? { COLUMN_KEY: key } : {}),
    ...(previous ? { COLUMN_KEY_PREVIOUS: previous } : {}),
  } as Config);

describe('column cipher (spec 13.2)', () => {
  it('seals a value that opens only in its own column and row', () => {
    const one = cipher(KEY_A);
    const sealed = one.seal('JBSWY3DPEHPK3PXP', 'platform_users.totp_secret:a');
    expect(sealed).toMatch(/^v2:[0-9a-f]{8}:/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(one.open(sealed, 'platform_users.totp_secret:a')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => one.open(sealed, 'platform_users.totp_secret:b')).toThrow();
    // Another key can't open it, nor can a tampered value.
    expect(() => cipher(KEY_B).open(sealed, 'platform_users.totp_secret:a')).toThrow(
      /key this process doesn’t hold/,
    );
    const [version, id, iv, tag, body] = sealed.split(':');
    // Flip a bit of the first byte, so the body always changes.
    const bytes = Buffer.from(body!, 'base64url');
    bytes[0] = bytes[0]! ^ 0x01;
    const flipped = `${version}:${id}:${iv}:${tag}:${bytes.toString('base64url')}`;
    expect(() => one.open(flipped, 'platform_users.totp_secret:a')).toThrow();
    // A tag cut short is refused outright, never checked on fewer bytes.
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() =>
      one.open(`${version}:${id}:${iv}:${short}:${body}`, 'platform_users.totp_secret:a'),
    ).toThrow(/tag length/i);
  });

  it('opens what the previous key sealed while rotating, and reseals it under the new (D101)', () => {
    const old = cipher(KEY_A).seal('secret', 'x');
    const rotating = cipher(KEY_B, KEY_A);
    expect(rotating.open(old, 'x')).toBe('secret');
    expect(rotating.isCurrent(old)).toBe(false);
    const resealed = rotating.reseal(old, 'x');
    expect(rotating.isCurrent(resealed)).toBe(true);
    // Once the old key is gone, only the resealed value opens.
    expect(cipher(KEY_B).open(resealed, 'x')).toBe('secret');
    expect(() => cipher(KEY_B).open(old, 'x')).toThrow();
  });

  it('still opens values sealed before key IDs, under either key', () => {
    // A `v1` value as the cipher wrote it before decision D101.
    const v2 = cipher(KEY_A).seal('secret', 'x').split(':');
    const v1 = ['v1', v2[2], v2[3], v2[4]].join(':');
    expect(cipher(KEY_A).open(v1, 'x')).toBe('secret');
    expect(cipher(KEY_B, KEY_A).open(v1, 'x')).toBe('secret');
    expect(() => cipher(KEY_B).open(v1, 'x')).toThrow();
  });

  it('derives a stable key from the pepper locally, and holds none in production without one', () => {
    const sealed = cipher().seal('secret', 'x');
    expect(cipher().open(sealed, 'x')).toBe('secret');
    // A production process without the key starts, and refuses only when asked to seal.
    const keyless = cipher(undefined, undefined, 'production');
    expect(() => keyless.seal('secret', 'x')).toThrow(/holds no COLUMN_KEY/);
  });
});
