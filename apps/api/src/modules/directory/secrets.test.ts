import { describe, expect, it } from 'vitest';
import { codeHmac, digest, newCode, newSecret, sameDigest } from './secrets';

describe('one-time codes', () => {
  it('are six digits, zero-padded', () => {
    for (let i = 0; i < 200; i += 1) expect(newCode()).toMatch(/^\d{6}$/);
  });

  it('are stored as an HMAC bound to the pepper and the challenge', () => {
    const one = codeHmac('pepper-one-sixteen', 'challenge-1', '123456');
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(one).not.toContain('123456');
    expect(codeHmac('pepper-one-sixteen', 'challenge-1', '123456')).toBe(one);
    expect(codeHmac('pepper-two-sixteen', 'challenge-1', '123456')).not.toBe(one);
    expect(codeHmac('pepper-one-sixteen', 'challenge-2', '123456')).not.toBe(one);
  });

  it('compare digests without short-circuiting on the first difference', () => {
    const a = codeHmac('pepper-one-sixteen', 'c', '111111');
    expect(sameDigest(a, a)).toBe(true);
    expect(sameDigest(a, codeHmac('pepper-one-sixteen', 'c', '111112'))).toBe(false);
    expect(sameDigest(a, 'abcd')).toBe(false);
    expect(sameDigest('', '')).toBe(false);
  });
});

describe('bearer secrets', () => {
  it('are long, random and stored only as a digest', () => {
    const secret = newSecret();
    expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newSecret()).not.toBe(secret);
    expect(digest(secret)).toMatch(/^[0-9a-f]{64}$/);
  });
});
