import { describe, expect, it } from 'vitest';
import {
  DECOY_HASH,
  hashPassword,
  needsRehash,
  RECOVERY_CODE_COST,
  verifyPassword,
} from './passwords';

// Each hash and check at the staff cost is real scrypt work, a fifth of a second here and several
// times that on a shared CI runner, so these tests get more than Vitest's 5 seconds.
describe('passwords', { timeout: 60_000 }, () => {
  it('keeps only a salted scrypt hash, and checks against it', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash).toMatch(/^scrypt\$15\$8\$3\$[\w-]{22}\$[\w-]{43}$/);
    expect(hash).not.toContain('correct');
    expect(await verifyPassword('correct horse battery', hash)).toBe(true);
    expect(await verifyPassword('correct horse batterY', hash)).toBe(false);
    expect(needsRehash(hash)).toBe(false);
  });

  it('still checks hashes made at an older cost, and says they should be made again', async () => {
    const old = await hashPassword('correct horse battery', {
      log2N: 15,
      r: 8,
      p: 1,
      keyLength: 32,
    });
    expect(old).toMatch(/^scrypt\$15\$8\$1\$/);
    expect(await verifyPassword('correct horse battery', old)).toBe(true);
    expect(needsRehash(old)).toBe(true);
  });

  it('hashes recovery codes at their own, lighter cost, with a new salt each time', async () => {
    const hash = await hashPassword('K7Q2MXW4PA', RECOVERY_CODE_COST);
    expect(hash).toMatch(/^scrypt\$14\$8\$1\$/);
    // The salt doesn't depend on the cost, so the lighter one shows it without another staff hash.
    expect(await hashPassword('K7Q2MXW4PA', RECOVERY_CODE_COST)).not.toBe(hash);
    expect(await verifyPassword('K7Q2MXW4PA', hash)).toBe(true);
    expect(needsRehash(hash, RECOVERY_CODE_COST)).toBe(false);
  });

  it('matches nothing with the decoy, and refuses what isn’t a hash or asks too much', async () => {
    expect(await verifyPassword('anything at all', DECOY_HASH)).toBe(false);
    expect(needsRehash(DECOY_HASH)).toBe(false);
    expect(await verifyPassword('anything at all', 'plain')).toBe(false);
    expect(await verifyPassword('x', 'scrypt$30$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA')).toBe(false);
  });
});
