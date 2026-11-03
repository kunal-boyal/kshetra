import type { FastifyReply, FastifyRequest } from 'fastify';
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

/**
 * Where the session cookies lived before decision D101 moved them to Path=/: under the bare name,
 * on the narrower path. A browser that kept one sends it first on that path, before the current
 * cookie of the same name, so it would stand in for the session and end it at every reload.
 */
export const LEGACY_SESSION_PATHS = {
  refresh: '/auth/v1',
  console: '/platform/v1/session',
} as const;

const legacyName = (config: Config, purpose: 'refresh' | 'console') =>
  `${config.PRODUCT_SLUG.replace(/-/g, '_')}_${purpose}`;

/** Every value a request's `Cookie` header carries under a name, in the order the browser sent them. */
export function cookieValues(header: string | undefined, name: string): string[] {
  const values: string[] = [];
  for (const pair of (header ?? '').split(';')) {
    const at = pair.indexOf('=');
    if (at < 0 || pair.slice(0, at).trim() !== name) continue;
    const raw = pair.slice(at + 1).trim();
    try {
      values.push(decodeURIComponent(raw));
    } catch {
      values.push(raw);
    }
  }
  return values;
}

/**
 * The session cookie a request carries, and whether it also carries a copy left on the legacy
 * path. Browsers send the cookie with the longer path first, so the current one is the last.
 */
export function readSessionCookie(
  request: FastifyRequest,
  config: Config,
  purpose: 'refresh' | 'console',
): { token: string | undefined; stale: boolean } {
  const header = request.headers.cookie;
  const name = sessionCookie(config, purpose).name;
  const legacy = legacyName(config, purpose);
  const values = cookieValues(header, name);
  const stale = legacy === name ? values.length > 1 : cookieValues(header, legacy).length > 0;
  return { token: values.at(-1), stale };
}

/** Expires a session cookie left on its legacy path, so the browser stops sending it. */
export function expireLegacySessionCookie(
  reply: FastifyReply,
  config: Config,
  purpose: 'refresh' | 'console',
): void {
  const { options } = sessionCookie(config, purpose);
  void reply.clearCookie(legacyName(config, purpose), {
    ...options,
    path: LEGACY_SESSION_PATHS[purpose],
  });
}

/**
 * The cookie that binds an SSO sign-in to the browser that started it (decision D101): a random
 * value whose digest the sign-in's state holds. SAML's answer arrives as a cross-site POST, which
 * only a SameSite=None cookie survives, so it is that, and Secure, wherever there is TLS.
 */
export function ssoBinderCookie(config: Config, seconds: number) {
  const secure = config.NODE_ENV === 'production';
  const name = `${config.PRODUCT_SLUG.replace(/-/g, '_')}_sso`;
  return {
    name: secure ? `__Host-${name}` : name,
    options: {
      httpOnly: true,
      sameSite: secure ? ('none' as const) : ('lax' as const),
      secure,
      path: '/',
      maxAge: seconds,
    },
  };
}
