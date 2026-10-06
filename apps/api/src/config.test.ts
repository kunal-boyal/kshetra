import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const required = {
  DATABASE_URL: 'postgres://cell_app:x@localhost:5433/kshetra',
  DIRECTORY_DATABASE_URL: 'postgres://directory_app:x@localhost:5433/kshetra',
  REDIS_URL: 'redis://localhost:6380',
  OTP_PEPPER: 'a-local-pepper-of-16+',
};

describe('loadConfig', () => {
  it('fills defaults around the required settings', () => {
    expect(loadConfig(required)).toMatchObject({
      NODE_ENV: 'development',
      PRODUCT_SLUG: 'kshetra',
      HOST: '127.0.0.1',
      PORT: 3000,
      TRUST_PROXY: false,
      CELL_ID: 'local',
      DB_POOL_MAX: 10,
      LOG_LEVEL: 'info',
      OTP_PROVIDER: 'console',
    });
  });

  it('reads numbers and switches from environment strings', () => {
    const config = loadConfig({
      ...required,
      PORT: '8080',
      DB_POOL_MAX: '25',
      TRUST_PROXY: 'true',
    });
    expect(config.PORT).toBe(8080);
    expect(config.DB_POOL_MAX).toBe(25);
    expect(config.TRUST_PROXY).toBe(true);
  });

  it('reads an empty signing key as none, as .env.example leaves it', () => {
    expect(loadConfig({ ...required, JWT_SIGNING_KEY: '' }).JWT_SIGNING_KEY).toBeUndefined();
  });

  it('turns escaped newlines in the signing key back into a PEM', () => {
    const config = loadConfig({ ...required, JWT_SIGNING_KEY: 'line one\\nline two' });
    expect(config.JWT_SIGNING_KEY).toBe('line one\nline two');
  });

  it('names what is wrong instead of starting half-configured', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...required, PORT: 'eighty' })).toThrow(/PORT/);
    expect(() => loadConfig({ ...required, OTP_PEPPER: 'short' })).toThrow(/OTP_PEPPER/);
  });

  it('refuses development shortcuts in production', () => {
    const production = { ...required, NODE_ENV: 'production' };
    expect(() => loadConfig(production)).toThrow(/OTP_PROVIDER/);
    expect(() => loadConfig(production)).toThrow(/JWT_SIGNING_KEY/);
    expect(() => loadConfig(production)).toThrow(/OTP_PEPPER/);
  });

  it('keeps the memory code sender to tests', () => {
    expect(() => loadConfig({ ...required, OTP_PROVIDER: 'memory' })).toThrow(/tests only/);
    expect(loadConfig({ ...required, NODE_ENV: 'test', OTP_PROVIDER: 'memory' }).OTP_PROVIDER).toBe(
      'memory',
    );
  });
});
