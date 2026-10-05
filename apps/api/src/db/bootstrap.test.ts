import { describe, expect, it } from 'vitest';
import { bootstrapDatabase, isLocalDatabase } from './bootstrap';

describe('isLocalDatabase', () => {
  it('accepts only this machine', () => {
    expect(isLocalDatabase('postgres://a:b@localhost:5433/kshetra')).toBe(true);
    expect(isLocalDatabase('postgres://a:b@127.0.0.1:5433/kshetra')).toBe(true);
    expect(isLocalDatabase('postgres://a:b@[::1]:5433/kshetra')).toBe(true);
    expect(
      isLocalDatabase('postgres://a:b@cell-1.abc.ap-south-1.rds.amazonaws.com:5432/kshetra'),
    ).toBe(false);
  });
});

describe('bootstrapDatabase', () => {
  it('refuses a remote database before connecting to anything', async () => {
    const remote = 'postgres://migrator:x@db.example.com:5432/kshetra';
    await expect(
      bootstrapDatabase({
        admin: 'postgres://postgres:x@localhost:5433/kshetra',
        migrator: remote,
        cellApp: remote,
        directoryApp: remote,
      }),
    ).rejects.toThrow(/only runs against a database on this machine/);
  });
});
