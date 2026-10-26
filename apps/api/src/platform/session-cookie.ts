import type { Config } from '../config';

/**
 * A browser's session cookie (spec 13.1, decision D101): the refresh token of the web portal or
 * the console, httpOnly and SameSite=Strict, which the page never reads. Wherever the API runs as
 * production it is Secure and named with the `__Host-` prefix, so it is sent only over TLS to this
 * host and no sibling subdomain can set or overwrite it; the prefix asks for Path=/. Locally, over
 * plain HTTP, the prefix can't hold, so the name is bare.
 */
export function sessionCookie(config: Config, purpose: 'refresh' | 'console') {
  const secure = config.NODE_ENV === 'production';
  const name = `${config.PRODUCT_SLUG.replace(/-/g, '_')}_${purpose}`;
  return {
    name: secure ? `__Host-${name}` : name,
    options: { httpOnly: true, sameSite: 'strict' as const, secure, path: '/' },
  };
}
