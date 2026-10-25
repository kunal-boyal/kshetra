import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAddress, newPhone, staffToken, startApp, World } from './support';

/**
 * API clients (module M20, decision D94): a tenant admin makes a client with scopes; its ID and
 * secret buy an hour's token at the OAuth 2.0 token endpoint; the token reaches what its scopes
 * stand for, and nothing that is a person's own; rotating or revoking ends it; each client stays
 * within its plan's requests a minute; and the API documents itself at /v1/docs.
 */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

/** Asks for a token as an integrator's library would, with a form body. */
function token(form: Record<string, string>, basic?: { id: string; secret: string }) {
  return app.inject({
    method: 'POST',
    url: '/auth/v1/oauth/token',
    remoteAddress: newAddress(),
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(basic
        ? {
            authorization: `Basic ${Buffer.from(`${basic.id}:${basic.secret}`).toString('base64')}`,
          }
        : {}),
    },
    payload: new URLSearchParams(form).toString(),
  });
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

async function makeClient(admin: string, scopes: string[]) {
  const made = await call('POST', '/v1/api-clients', admin, {
    id: newId(),
    name: 'ERP',
    scopes,
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json() as { client: { id: string; clientId: string }; clientSecret: string };
}

describe('API clients (M20, D94)', () => {
  it('buys a token with client credentials, reaching what its scopes stand for and no more', async () => {
    const org = await organisation('Integrated Org');
    const { client, clientSecret } = await makeClient(org.admin, ['people:read', 'orders:read']);
    expect(clientSecret.length).toBeGreaterThanOrEqual(40);
    const listed = (await call('GET', '/v1/api-clients', org.admin)).json().items;
    expect(listed).toEqual([expect.objectContaining({ id: client.id, status: 'active' })]);
    expect(JSON.stringify(listed)).not.toContain(clientSecret);

    // Wrong credentials, wrong grant and a scope beyond the client's, in RFC 6749's own words.
    const wrong = await token({
      grant_type: 'client_credentials',
      client_id: client.clientId,
      client_secret: 'not the secret',
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json()).toMatchObject({ error: 'invalid_client' });
    expect((await token({ grant_type: 'password' })).json()).toMatchObject({
      error: 'unsupported_grant_type',
    });
    const beyond = await token(
      { grant_type: 'client_credentials', scope: 'audit:read' },
      { id: client.clientId, secret: clientSecret },
    );
    expect(beyond.json()).toMatchObject({ error: 'invalid_scope' });

    const issued = await token({
      grant_type: 'client_credentials',
      client_id: client.clientId,
      client_secret: clientSecret,
    });
    expect(issued.statusCode, issued.body).toBe(200);
    expect(issued.headers['cache-control']).toBe('no-store');
    expect(issued.json()).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'people:read orders:read',
    });
    const bearer = issued.json().access_token as string;

    expect((await call('GET', '/v1/users', bearer)).statusCode).toBe(200);
    expect((await call('GET', '/v1/orders', bearer)).statusCode).toBe(200);
    // Reference reads open to every client.
    expect((await call('GET', '/v1/designations', bearer)).statusCode).toBe(200);
    // Nothing that is a person's own, nor what its scopes don't reach.
    // Reading orders reads the catalogue their lines name.
    expect((await call('GET', '/v1/catalogue', bearer)).statusCode).toBe(200);
    for (const url of ['/v1/me', '/v1/notifications', '/v1/approvals/inbox', '/v1/targets']) {
      expect((await call('GET', url, bearer)).json().error.code, url).toBe('FORBIDDEN');
    }
    expect((await call('GET', '/v1/api-clients', bearer)).json().error.code).toBe('FORBIDDEN');
    const write = await call('POST', '/v1/users', bearer, {
      name: 'Made by the ERP',
      designation: 'executive',
    });
    expect(write.json().error.code).toBe('FORBIDDEN');

    // A token narrowed to one scope holds only that one.
    const narrow = await token(
      { grant_type: 'client_credentials', scope: 'people:read' },
      { id: client.clientId, secret: clientSecret },
    );
    expect(narrow.json().scope).toBe('people:read');
    expect((await call('GET', '/v1/orders', narrow.json().access_token)).json().error.code).toBe(
      'FORBIDDEN',
    );
  });

  it('records what a client changes, and ends its tokens when rotated or revoked', async () => {
    const org = await organisation('Writing Org');
    const { client, clientSecret } = await makeClient(org.admin, ['people:write']);
    const credentials = { id: client.clientId, secret: clientSecret };
    const bearer = (await token({ grant_type: 'client_credentials' }, credentials)).json()
      .access_token as string;
    const made = await call('POST', '/v1/users', bearer, {
      code: `ERP-${newId().slice(-6)}`,
      name: 'From the ERP',
      phone: newPhone(),
      designation: 'executive',
    });
    expect(made.statusCode, made.body).toBe(201);
    // Never an admin: a role that can change access stays with people (D94).
    const admin = await call('POST', '/v1/users', bearer, {
      code: `ERP-${newId().slice(-6)}`,
      name: 'Would-be admin',
      phone: newPhone(),
      designation: 'head',
      role: 'tenant_admin',
    });
    expect(admin.json().error.code).toBe('FORBIDDEN');
    const audit = (await call('GET', '/v1/audit?action=user.created', org.admin)).json();
    expect(audit.items[0]).toMatchObject({ actor: { kind: 'api_client', id: client.id } });

    const rotated = await call('POST', `/v1/api-clients/${client.id}/rotate`, org.admin);
    expect(rotated.statusCode, rotated.body).toBe(200);
    expect((await call('GET', '/v1/users', bearer)).json().error.code).toBe('SESSION_REVOKED');
    expect((await token({ grant_type: 'client_credentials' }, credentials)).statusCode).toBe(401);
    const fresh = await token(
      { grant_type: 'client_credentials' },
      { id: client.clientId, secret: rotated.json().clientSecret },
    );
    expect(fresh.statusCode).toBe(200);

    const revoked = await call('POST', `/v1/api-clients/${client.id}/revoke`, org.admin);
    expect(revoked.json()).toMatchObject({ status: 'revoked' });
    expect((await call('GET', '/v1/users', fresh.json().access_token)).json().error.code).toBe(
      'SESSION_REVOKED',
    );
  });

  it('holds each client to its plan’s requests a minute', async () => {
    const org = await organisation('Busy Org');
    const staff = await staffToken(app, 'platform_admin');
    const limited = await call('PUT', `/platform/v1/tenants/${org.tenantId}/plan`, staff, {
      planId: null,
      limits: { apiPerMinute: 3 },
    });
    expect(limited.statusCode, limited.body).toBe(200);
    const { client, clientSecret } = await makeClient(org.admin, ['people:read']);
    const bearer = (
      await token(
        { grant_type: 'client_credentials' },
        { id: client.clientId, secret: clientSecret },
      )
    ).json().access_token as string;
    for (let i = 0; i < 3; i += 1)
      expect((await call('GET', '/v1/users', bearer)).statusCode).toBe(200);
    const over = await call('GET', '/v1/users', bearer);
    expect(over.statusCode).toBe(429);
    expect(over.json().error.code).toBe('RATE_LIMITED');
    expect(Number(over.headers['retry-after'])).toBeGreaterThan(0);
    // People at the tenant aren't held to a client's limit.
    expect((await call('GET', '/v1/users', org.admin)).statusCode).toBe(200);
  });

  it('documents itself: the OpenAPI document with client scopes, and the reference', async () => {
    const document = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(document.statusCode).toBe(200);
    const openapi = document.json();
    expect(openapi.components.securitySchemes.apiClient.flows.clientCredentials.tokenUrl).toBe(
      '/auth/v1/oauth/token',
    );
    expect(openapi.paths['/v1/users'].get.security).toContainEqual({
      apiClient: expect.arrayContaining(['people:read', 'people:write']),
    });
    // A person's own routes say nothing of clients.
    expect(openapi.paths['/v1/me'].get.security).toEqual([{ accessToken: [] }]);

    const page = await app.inject({ method: 'GET', url: '/v1/docs' });
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.body).toContain("url: '/v1/openapi.json'");
    const script = await app.inject({ method: 'GET', url: '/v1/docs/scalar.js' });
    expect(script.statusCode).toBe(200);
    expect(script.headers['content-type']).toContain('text/javascript');
    expect(script.body.length).toBeGreaterThan(100_000);
  });
});
