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
import { SsoDiscoverBody, SsoDiscoverResult } from '@thelamp/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Config } from '../../config';
import { Public } from '../../platform/auth';
import { Contract } from '../../platform/routes';
import { CONFIG } from '../../platform/tokens';
import { SsoRefused, SsoService } from './sso.service';
import { WebCookie } from './web-cookie';

const TenantSlugParams = z.strictObject({ tenant: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/) });

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
  async discover(@Body() body: unknown) {
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
  async start(@Param() params: unknown, @Res() reply: FastifyReply) {
    const { tenant } = TenantSlugParams.parse(params);
    try {
      return reply.redirect(await this.sso.start(tenant), 302);
    } catch (error) {
      return this.failed(reply, error);
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
      const signedIn = await this.sso.oidcCallback(tenant, url, address);
      this.cookie.handOver(request, reply, signedIn.session, true);
      return reply.redirect(`${this.config.WEB_URL}/`, 302);
    } catch (error) {
      return this.failed(reply, error);
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
      const form = (body ?? {}) as { SAMLResponse?: string; RelayState?: string };
      const signedIn = await this.sso.samlResponse(tenant, form, address);
      this.cookie.handOver(request, reply, signedIn.session, true);
      return reply.redirect(`${this.config.WEB_URL}/`, 302);
    } catch (error) {
      return this.failed(reply, error);
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

  /** Back to the sign-in page, saying why; anything unexpected says the provider refused. */
  private failed(reply: FastifyReply, error: unknown) {
    const failure = error instanceof SsoRefused ? error.failure : 'refused';
    return reply.redirect(`${this.config.WEB_URL}/sign-in?sso=${failure}`, 302);
  }
}
