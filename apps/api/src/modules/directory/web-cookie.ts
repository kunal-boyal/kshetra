import { Inject, Injectable } from '@nestjs/common';
import { type Session, WEB_CLIENT, WEB_CLIENT_HEADER } from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { CONFIG } from '../../platform/tokens';

export const COOKIE_PATH = '/auth/v1';

/** Whether a request says it is the web portal's, which keeps its refresh token in a cookie. */
export function isWeb(request: FastifyRequest): boolean {
  return request.headers[WEB_CLIENT_HEADER] === WEB_CLIENT;
}

/**
 * The web's refresh token (spec 13.1): an httpOnly, SameSite=Strict cookie scoped to the sign-in
 * routes, which the page never reads. Sign-in hands sessions over to it, by OTP or by single
 * sign-on (decision D91).
 */
@Injectable()
export class WebCookie {
  /** The cookie's name, from the product slug. */
  readonly name: string;

  constructor(@Inject(CONFIG) private readonly config: Config) {
    this.name = `${config.PRODUCT_SLUG.replace(/-/g, '_')}_refresh`;
  }

  read(request: FastifyRequest): string | undefined {
    return request.cookies[this.name];
  }

  /** The cookie's attributes, the same when it is set and when it is cleared. */
  options() {
    return {
      httpOnly: true,
      sameSite: 'strict' as const,
      secure: this.config.NODE_ENV === 'production',
      path: COOKIE_PATH,
    };
  }

  clear(reply: FastifyReply): void {
    void reply.clearCookie(this.name, this.options());
  }

  /**
   * Moves the refresh token out of the session into the cookie, for the web. A request that isn't
   * the web's keeps its session as it is, unless `web` says the caller is the web anyway, as a
   * browser coming back from an identity provider is.
   */
  handOver(request: FastifyRequest, reply: FastifyReply, session: Session, web = false): Session {
    if ((!web && !isWeb(request)) || !session.refreshToken) return session;
    void reply.setCookie(this.name, session.refreshToken, {
      ...this.options(),
      expires: new Date(session.refreshTokenExpiresAt),
    });
    return {
      tokenType: session.tokenType,
      accessToken: session.accessToken,
      accessTokenExpiresAt: session.accessTokenExpiresAt,
      refreshTokenExpiresAt: session.refreshTokenExpiresAt,
    };
  }
}
