import { Inject, Injectable } from '@nestjs/common';
import { type Session, WEB_CLIENT, WEB_CLIENT_HEADER } from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from '../../config';
import { sessionCookie } from '../../platform/session-cookie';
import { CONFIG } from '../../platform/tokens';

/** Whether a request says it is the web portal's, which keeps its refresh token in a cookie. */
export function isWeb(request: FastifyRequest): boolean {
  return request.headers[WEB_CLIENT_HEADER] === WEB_CLIENT;
}

/**
 * The web's refresh token (spec 13.1): an httpOnly, SameSite=Strict cookie, `__Host-` in
 * production (`sessionCookie()`, decision D101), which the page never reads. Sign-in hands sessions over to it, by OTP or by single
 * sign-on (decision D91).
 */
@Injectable()
export class WebCookie {
  /** The cookie's name, from the product slug. */
  readonly name: string;
  private readonly attributes: ReturnType<typeof sessionCookie>['options'];

  constructor(@Inject(CONFIG) config: Config) {
    const cookie = sessionCookie(config, 'refresh');
    this.name = cookie.name;
    this.attributes = cookie.options;
  }

  read(request: FastifyRequest): string | undefined {
    return request.cookies[this.name];
  }

  /** The cookie's attributes, the same when it is set and when it is cleared. */
  options() {
    return this.attributes;
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
