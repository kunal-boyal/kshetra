import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import { ColumnCipher } from './column-cipher';

const cipher = (key?: string) =>
  new ColumnCipher({
    OTP_PEPPER: 'local-otp-pepper-change-me',
    ...(key ? { COLUMN_KEY: key } : {}),
  } as Config);

describe('column cipher (spec 13.2)', () => {
  it('seals a value that opens only in its own column and row', () => {
    const one = cipher(Buffer.alloc(32, 7).toString('base64'));
    const sealed = one.seal('JBSWY3DPEHPK3PXP', 'platform_users.totp_secret:a');
    expect(sealed).toMatch(/^v1:/);
    expect(sealed).not.toContain('JBSWY3DPEHPK3PXP');
    expect(one.open(sealed, 'platform_users.totp_secret:a')).toBe('JBSWY3DPEHPK3PXP');
    expect(() => one.open(sealed, 'platform_users.totp_secret:b')).toThrow();
    // Another key can't open it, nor can a tampered value.
    expect(() =>
      cipher(Buffer.alloc(32, 8).toString('base64')).open(sealed, 'platform_users.totp_secret:a'),
    ).toThrow();
    const [version, iv, tag, body] = sealed.split(':');
    const flipped = `${version}:${iv}:${tag}:${body!.slice(0, -2)}AA`;
    expect(() => one.open(flipped, 'platform_users.totp_secret:a')).toThrow();
    // A tag cut short is refused outright, never checked on fewer bytes.
    const short = Buffer.from(tag!, 'base64url').subarray(0, 4).toString('base64url');
    expect(() =>
      one.open(`${version}:${iv}:${short}:${body}`, 'platform_users.totp_secret:a'),
    ).toThrow(/tag length/i);
  });

  it('derives a stable key from the pepper when none is set', () => {
    const sealed = cipher().seal('secret', 'x');
    expect(cipher().open(sealed, 'x')).toBe('secret');
  });
});
