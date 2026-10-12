import { describe, expect, it } from 'vitest';
import { loadConfig } from '../config';
import { assertSeedable, SEED } from './seed';

const env = {
  DATABASE_URL: 'postgres://cell_app:x@localhost:5433/kshetra',
  DIRECTORY_DATABASE_URL: 'postgres://directory_app:x@127.0.0.1:5433/kshetra',
  REDIS_URL: 'redis://localhost:6380',
  OTP_PEPPER: 'a-local-pepper-of-16+',
  S3_BUCKET: 'kshetra-local',
};

describe('the seed', () => {
  it('runs against databases on this machine only', () => {
    expect(() => assertSeedable(loadConfig(env))).not.toThrow();
    expect(() =>
      assertSeedable(
        loadConfig({ ...env, DATABASE_URL: 'postgres://cell_app:x@db.example.com/kshetra' }),
      ),
    ).toThrow(/db\.example\.com/);
  });

  it('seeds two tenants on different templates, with one person in both', () => {
    expect(SEED.map((tenant) => tenant.template)).toEqual(['generic', 'agri']);
    const [sunrise, harit] = SEED;
    expect(harit!.people.map((person) => person.phone)).toContain(sunrise!.admin.phone);
  });
});
