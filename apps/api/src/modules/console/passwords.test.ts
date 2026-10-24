import { describe, expect, it } from 'vitest';
import { DECOY_HASH, hashPassword, verifyPassword } from './passwords';

describe('staff passwords', () => {
  it('keeps only a salted scrypt hash, and checks against it', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$15\$8\$1\$[\w-]{22}\$[\w-]{43}$/);
    expect(hash).not.toContain('correct');
    expect(await hashPassword('correct horse battery')).not.toBe(hash);
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
  });

  it('matches nothing with the decoy, and refuses what isn’t a hash', async () => {
    expect(await verifyPassword('anything at all', DECOY_HASH)).toBe(false);
    expect(await verifyPassword('anything at all', 'plain')).toBe(false);
  });
});
