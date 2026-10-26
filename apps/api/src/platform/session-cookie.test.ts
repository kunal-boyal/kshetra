import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import { sessionCookie } from './session-cookie';

const config = (NODE_ENV: Config['NODE_ENV']) => ({ NODE_ENV, PRODUCT_SLUG: 'the-lamp' }) as Config;

describe('session cookies (decision D101)', () => {
  it('are Secure and host-only by their name in production', () => {
    expect(sessionCookie(config('production'), 'refresh')).toEqual({
      name: '__Host-the_lamp_refresh',
      options: { httpOnly: true, sameSite: 'strict', secure: true, path: '/' },
    });
    expect(sessionCookie(config('production'), 'console').name).toBe('__Host-the_lamp_console');
  });

  it('keep a bare name locally, where there is no TLS for the prefix', () => {
    expect(sessionCookie(config('development'), 'refresh')).toEqual({
      name: 'the_lamp_refresh',
      options: { httpOnly: true, sameSite: 'strict', secure: false, path: '/' },
    });
  });
});
