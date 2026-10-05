import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('fills defaults around the one required setting', () => {
    const config = loadConfig({ DATABASE_URL: 'postgres://cell_app:x@localhost:5433/kshetra' });
    expect(config).toMatchObject({
      NODE_ENV: 'development',
      HOST: '127.0.0.1',
      PORT: 3000,
      DB_POOL_MAX: 10,
      LOG_LEVEL: 'info',
    });
  });

  it('reads numbers from environment strings', () => {
    const config = loadConfig({
      DATABASE_URL: 'postgres://a:b@localhost/k',
      PORT: '8080',
      DB_POOL_MAX: '25',
    });
    expect(config.PORT).toBe(8080);
    expect(config.DB_POOL_MAX).toBe(25);
  });

  it('names what is wrong instead of starting half-configured', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() =>
      loadConfig({ DATABASE_URL: 'postgres://a:b@localhost/k', PORT: 'eighty' }),
    ).toThrow(/PORT/);
  });
});
