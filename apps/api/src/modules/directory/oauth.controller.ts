import { Body, Controller, Header, HttpCode, Ip, Post, Req, Res } from '@nestjs/common';
import {
  API_SCOPE_KEYS,
  API_TOKEN_SECONDS,
  AppError,
  isOpenTenant,
  OAuthTokenBody,
  OAuthTokenResult,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { cells, tenants } from '../../db/schema/directory';
import { Public } from '../../platform/auth';
import { ApiClientCredentials } from '../../platform/planes';
import { RateLimiter } from '../../platform/rate-limit';
import { Contract } from '../../platform/routes';
import { DirectoryDatabase } from './directory.database';
import { SigningKey } from './signing-key';

/** Tries at the token endpoint, per client and per address. */
const PER_CLIENT = { name: 'oauth-client', max: 30, windowSeconds: 60 };
const PER_ADDRESS = { name: 'oauth-address', max: 120, windowSeconds: 60 };

/** The credentials from HTTP Basic (RFC 6749, section 2.3.1), when the client sends them so. */
function basic(request: FastifyRequest): { id: string; secret: string } | null {
  const [scheme, encoded] = (request.headers.authorization ?? '').split(' ');
  if (scheme?.toLowerCase() !== 'basic' || !encoded) return null;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  return {
    id: decodeURIComponent(decoded.slice(0, colon)),
    secret: decodeURIComponent(decoded.slice(colon + 1)),
  };
}

/**
 * The OAuth 2.0 token endpoint for API clients (RFC 6749 section 4.4, module M20, decision D94):
 * a client's ID and secret, in the body or as HTTP Basic, buy an access token for its tenant's
 * cell, an hour long, holding its scopes or fewer. It answers errors in RFC 6749's own shape,
 * which integrators' libraries read, rather than the API's.
 */
@Public()
@Controller('auth/v1/oauth')
export class OAuthController {
  constructor(
    private readonly credentials: ApiClientCredentials,
    private readonly database: DirectoryDatabase,
    private readonly keys: SigningKey,
    private readonly limiter: RateLimiter,
  ) {}

  @Post('token')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @Contract({
    tag: 'Sign-in',
    summary: 'An access token for an API client (OAuth 2.0 client credentials)',
    body: OAuthTokenBody,
    response: OAuthTokenResult,
  })
  async token(
    @Body() body: unknown,
    @Ip() address: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const fail = (status: number, error: string, description: string) => {
      void reply.code(status);
      if (status === 401) void reply.header('WWW-Authenticate', 'Basic realm="api"');
      return { error, error_description: description };
    };
    const parsed = OAuthTokenBody.safeParse(body ?? {});
    if (!parsed.success) return fail(400, 'invalid_request', 'The request is not a token request.');
    const form = parsed.data;
    if (form.grant_type !== 'client_credentials') {
      return fail(400, 'unsupported_grant_type', 'Only client_credentials is supported.');
    }
    const given =
      basic(request) ??
      (form.client_id && form.client_secret
        ? { id: form.client_id, secret: form.client_secret }
        : null);
    if (!given) return fail(401, 'invalid_client', 'Send the client ID and secret.');
    try {
      await this.limiter.hit(PER_ADDRESS, address);
      await this.limiter.hit(PER_CLIENT, given.id);
    } catch (error) {
      if (error instanceof AppError && error.code === 'RATE_LIMITED') {
        void reply.header('Retry-After', String(60));
        return fail(429, 'slow_down', 'Too many token requests. Wait a minute.');
      }
      throw error;
    }

    const client = await this.credentials.check(given.id, given.secret);
    if (!client) return fail(401, 'invalid_client', 'The client ID or secret is not right.');
    const asked = form.scope?.split(' ').filter(Boolean);
    if (asked && asked.some((scope) => !(client.scopes as string[]).includes(scope))) {
      return fail(400, 'invalid_scope', `This client may ask for: ${client.scopes.join(' ')}.`);
    }
    const scopes = asked ?? client.scopes;
    const [tenant] = await this.database.db
      .select({ status: tenants.status, cell: cells.name })
      .from(tenants)
      .innerJoin(cells, eq(cells.id, tenants.cellId))
      .where(eq(tenants.id, client.tenantId));
    if (!tenant || !isOpenTenant(tenant.status)) {
      return fail(401, 'invalid_client', 'This organisation is not open.');
    }
    const access = await this.keys.sign({
      userId: client.apiClientId,
      tenantId: client.tenantId,
      cell: tenant.cell,
      revision: client.authRevision,
      scopes: scopes.filter((scope) => (API_SCOPE_KEYS as readonly string[]).includes(scope)),
      seconds: API_TOKEN_SECONDS,
    });
    return {
      access_token: access.token,
      token_type: 'Bearer' as const,
      expires_in: API_TOKEN_SECONDS,
      scope: scopes.join(' '),
    };
  }
}
