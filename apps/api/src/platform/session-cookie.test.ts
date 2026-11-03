import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import type { FastifyRequest } from 'fastify';
import { cookieValues, readSessionCookie, sessionCookie } from './session-cookie';

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

  it('read every copy of a name in the order sent, decoded', () => {
    expect(
      cookieValues('a=1; the_lamp_refresh=old; b=2; the_lamp_refresh=n%2Bw', 'the_lamp_refresh'),
    ).toEqual(['old', 'n+w']);
    expect(cookieValues(undefined, 'the_lamp_refresh')).toEqual([]);
  });

  it('pass over a copy left on the legacy path, which browsers send first', () => {
    const request = (cookie?: string) => ({ headers: { cookie } }) as unknown as FastifyRequest;
    const local = config('development');
    expect(readSessionCookie(request('the_lamp_refresh=new'), local, 'refresh')).toEqual({
      token: 'new',
      stale: false,
    });
    expect(
      readSessionCookie(request('the_lamp_refresh=old; the_lamp_refresh=new'), local, 'refresh'),
    ).toEqual({ token: 'new', stale: true });
    // In production the current cookie has its own name, so any bare copy is the old one.
    expect(
      readSessionCookie(
        request('the_lamp_console=old; __Host-the_lamp_console=new'),
        config('production'),
        'console',
      ),
    ).toEqual({ token: 'new', stale: true });
    expect(readSessionCookie(request(), local, 'refresh')).toEqual({
      token: undefined,
      stale: false,
    });
  });
});
