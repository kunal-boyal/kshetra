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
    ).rejects.toThrow(/runs against a database on this machine, or the host/);
  });

  it('runs against a remote database only when its host is named, and only that one', async () => {
    const urls = {
      admin: 'postgres://postgres:x@cell-1.example.com:5432/kshetra',
      migrator: 'postgres://migrator:x@cell-1.example.com:5432/kshetra',
      cellApp: 'postgres://cell_app:x@cell-1.example.com:5432/kshetra',
      directoryApp: 'postgres://directory_app:x@cell-2.example.com:5432/kshetra',
    };
    await expect(bootstrapDatabase(urls, 'cell-1.example.com')).rejects.toThrow(
      /not cell-2\.example\.com/,
    );
  });
});
