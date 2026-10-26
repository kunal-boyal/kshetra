import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ClientIp } from '../../platform/client-address';
import { ssoBinderCookie } from '../../platform/session-cookie';
import {
  type SecondFactor,
  type SignedIn,
  SsoDiscoverBody,
  SsoDiscoverResult,
} from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config';
import { Public } from '../../platform/auth';
import { type RateLimit, RateLimiter } from '../../platform/rate-limit';
import { Contract } from '../../platform/routes';
import { SecurityLog } from '../../platform/security-log';
import { CONFIG } from '../../platform/tokens';
import { SSO_STATE_SECONDS, SsoRefused, SsoService } from './sso.service';
import { WebCookie } from './web-cookie';

/** Each address's SSO lookups and starts (ASVS V2.4.1, decision D101). */
export const SSO_LIMITS = {
  discoveriesPerAddress: { name: 'sso-discover-ip', max: 60, windowSeconds: 600 },
  startsPerAddress: { name: 'sso-start-ip', max: 30, windowSeconds: 600 },
} as const satisfies Record<string, RateLimit>;

const TenantSlugParams = z.strictObject({ tenant: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/) });

/** What a SAML identity provider posts back: the response, and the state we sent as RelayState. */
const SamlAcsBody = z.object({
  SAMLResponse: z.string().max(200_000).optional(),
  RelayState: z.string().max(200).optional(),
});

/**
 * Signing in with an organisation's own identity provider (spec 11.2, M1, decision D91). These
 * are browser navigations: they answer with redirects, to the provider and back into the portal,
 * which then restores its session from the cookie as after any sign-in. A sign-in that fails
 * comes back to the sign-in page with the reason in its `sso` parameter.
 */
@Public()
@Controller('auth/v1/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly cookie: WebCookie,
    private readonly security: SecurityLog,
    private readonly limiter: RateLimiter,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  @Post('discover')
  @HttpCode(200)
  @Contract({
    tag: 'Sign-in',
    summary: 'Whether a work email signs in with its organisation’s SSO',
    body: SsoDiscoverBody,
    response: SsoDiscoverResult,
  })
  async discover(@Body() body: unknown, @ClientIp() ip: string) {
    await this.limiter.hit(SSO_LIMITS.discoveriesPerAddress, ip);
    return { url: await this.sso.discover(SsoDiscoverBody.parse(body).email) };
  }

  @Get(':tenant/start')
  @HttpCode(302)
  @Contract({
    tag: 'Sign-in',
    summary: 'Start signing in with the organisation’s identity provider',
    params: TenantSlugParams,
    redirect: 'to the identity provider',
  })
  @Header('Cache-Control', 'no-store')
  async start(@Param() params: unknown, @ClientIp() ip: string, @Res() reply: FastifyReply) {
    const { tenant } = TenantSlugParams.parse(params);
    // Each start may reach out to the provider for its configuration (decision D101).
    await this.limiter.hit(SSO_LIMITS.startsPerAddress, ip);
    try {
      const { url, binder } = await this.sso.start(tenant);
      const cookie = ssoBinderCookie(this.config, SSO_STATE_SECONDS);
      void reply.setCookie(cookie.name, binder, cookie.options);
      return reply.redirect(url, 302);
    } catch (error) {
      return this.failed(reply, error, tenant);
    }
  }

  @Get(':tenant/oidc/callback')
  @HttpCode(302)
  @Contract({
    tag: 'Sign-in',
    summary: 'Come back from an OIDC identity provider, signed in',
    params: TenantSlugParams,
    redirect: 'into the portal',
  })
  @Header('Cache-Control', 'no-store')
  async oidcCallback(
    @Param() params: unknown,
    @ClientIp() address: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenant } = TenantSlugParams.parse(params);
    try {
      const query = request.url.includes('?') ? request.url.slice(request.url.indexOf('?')) : '';
      const url = new URL(`${this.sso.urls(tenant).redirectUri}${query}`);
      const outcome = await this.sso.oidcCallback(
        tenant,
        url,
        this.binder(request, reply),
        address,
      );
      return this.into(request, reply, outcome);
    } catch (error) {
      return this.failed(reply, error, tenant);
    }
  }

  @Post(':tenant/saml/acs')
  @HttpCode(302)
  @Contract({
    tag: 'Sign-in',
    summary: 'Come back from a SAML identity provider, signed in',
    params: TenantSlugParams,
    redirect: 'into the portal',
  })
  @Header('Cache-Control', 'no-store')
  async samlResponse(
    @Param() params: unknown,
    @Body() body: unknown,
    @ClientIp() address: string,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const { tenant } = TenantSlugParams.parse(params);
    try {
      const form = SamlAcsBody.parse(body ?? {});
      const outcome = await this.sso.samlResponse(
        tenant,
        form,
        this.binder(request, reply),
        address,
      );
      return this.into(request, reply, outcome);
    } catch (error) {
      return this.failed(reply, error, tenant);
    }
  }

  @Get(':tenant/saml/metadata')
  @Contract({
    tag: 'Sign-in',
    summary: 'The SAML service provider metadata, for the identity provider',
    params: TenantSlugParams,
    file: 'application/samlmetadata+xml',
  })
  async metadata(@Param() params: unknown, @Res({ passthrough: true }) reply: FastifyReply) {
    const xml = await this.sso.metadata(TenantSlugParams.parse(params).tenant);
    void reply.header('content-type', 'application/samlmetadata+xml; charset=utf-8');
    return xml;
  }

  /** The binder the starting browser kept, spent: the cookie goes either way. */
  private binder(request: FastifyRequest, reply: FastifyReply): string | undefined {
    const cookie = ssoBinderCookie(this.config, 0);
    void reply.clearCookie(cookie.name, { path: '/', secure: cookie.options.secure });
    return request.cookies[cookie.name];
  }

  /**
   * Into the portal with the session, or, where the provider asked for no second factor and the
   * person needs one, to the sign-in page's authenticator step (decision D101). The ticket goes
   * in the fragment, which no server or Referer ever sees.
   */
  private into(request: FastifyRequest, reply: FastifyReply, outcome: SignedIn | SecondFactor) {
    if (outcome.status === 'second_factor') {
      const fragment = new URLSearchParams({
        ticket: outcome.ticket,
        enrolled: outcome.enrolled ? '1' : '0',
        tenant: outcome.tenant.name,
      });
      return reply.redirect(`${this.config.WEB_URL}/sign-in?sso=second_factor#${fragment}`, 302);
    }
    this.cookie.handOver(request, reply, outcome.session, true);
    return reply.redirect(`${this.config.WEB_URL}/`, 302);
  }

  /** Back to the sign-in page, saying why; anything unexpected says the provider refused. */
  private failed(reply: FastifyReply, error: unknown, slug: string) {
    const failure = error instanceof SsoRefused ? error.failure : 'refused';
    this.security.record({
      event: 'sign_in_failed',
      plane: 'directory',
      method: 'sso',
      subject: `tenant:${slug}`,
      reason: failure,
    });
    return reply.redirect(`${this.config.WEB_URL}/sign-in?sso=${failure}`, 302);
  }
}
