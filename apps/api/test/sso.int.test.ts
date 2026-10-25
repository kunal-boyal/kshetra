import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { OAuth2Server } from 'oauth2-mock-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Single sign-on for web users (spec M1, D5, decision D91): a tenant's connection to its own
 * identity provider, through OIDC against a mock provider and SAML with signed assertions; the
 * person matched by email, never created; and SSO required for web users of its domains.
 */

const WEB_URL = 'http://127.0.0.1:5173';
let app: NestFastifyApplication;
let world: World;
let provider: OAuth2Server;
/** The email the mock provider puts in its next ID token. */
let nextEmail = '';

beforeAll(async () => {
  app = await startApp(testConfig({ WEB_URL }));
  world = await World.create(app);
  provider = new OAuth2Server();
  await provider.issuer.keys.generate('RS256');
  await provider.start(0, '127.0.0.1');
  provider.service.on('beforeTokenSigning', (token) => {
    token.payload.email = nextEmail;
    token.payload.email_verified = true;
  });
});

afterAll(async () => {
  await provider.stop();
  await world.end();
  await app.close();
});

const address = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
const WEB = { 'x-client': 'web' };

function asUser(method: 'GET' | 'PUT', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

/** A tenant with an admin, and a person with a work email in its domain. */
async function organisation(domain: string) {
  const tenantId = await world.tenant(`Org ${domain}`);
  const adminPhone = newPhone();
  await world.user(tenantId, { phone: adminPhone, designation: 'head', role: 'tenant_admin' });
  const admin = (await world.signIn(adminPhone)).accessToken;
  const personPhone = newPhone();
  const person = await world.user(tenantId, { phone: personPhone, email: `anita@${domain}` });
  return { tenantId, slug: `t-${tenantId}`, admin, adminPhone, person, personPhone };
}

const oidcSettings = () => ({
  protocol: 'oidc',
  issuer: provider.issuer.url!,
  clientId: 'the-lamp',
  clientSecret: 'a client secret from the provider',
});

/** Follows an OIDC sign-in from our start, through the mock provider, back to our callback. */
async function oidcSignIn(slug: string, email: string) {
  const started = await app.inject({ method: 'GET', url: `/auth/v1/sso/${slug}/start` });
  expect(started.statusCode, started.body).toBe(302);
  const authorise = String(started.headers.location);
  expect(authorise.startsWith(provider.issuer.url!)).toBe(true);
  expect(new URL(authorise).searchParams.get('code_challenge_method')).toBe('S256');
  nextEmail = email;
  const back = await fetch(authorise, { redirect: 'manual' });
  const callback = new URL(back.headers.get('location')!);
  expect(callback.origin + callback.pathname).toBe(`${WEB_URL}/auth/v1/sso/${slug}/oidc/callback`);
  return {
    callbackPath: callback.pathname + callback.search,
    reply: await app.inject({
      method: 'GET',
      url: callback.pathname + callback.search,
      remoteAddress: address(),
    }),
  };
}

/** The session a reply's refresh cookie holds, as the portal restores it. */
async function restore(cookie: string | string[] | undefined) {
  const header = (Array.isArray(cookie) ? cookie[0] : cookie)!.split(';')[0]!;
  const refreshed = await app.inject({
    method: 'POST',
    url: '/auth/v1/token/refresh',
    headers: { ...WEB, cookie: header },
    payload: {},
  });
  expect(refreshed.statusCode, refreshed.body).toBe(200);
  return refreshed.json().session.accessToken as string;
}

describe('an OIDC connection (D91)', () => {
  it('signs in the person with the provider’s email, and nobody else', async () => {
    const o = await organisation('careful.example');
    const saved = await asUser('PUT', '/v1/sso', o.admin, {
      settings: oidcSettings(),
      domains: ['careful.example'],
      enabled: true,
      enforced: false,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().connection).toMatchObject({
      protocol: 'oidc',
      clientId: 'the-lamp',
      hasClientSecret: true,
      domains: ['careful.example'],
    });
    expect(saved.body).not.toContain('a client secret from the provider');
    expect(saved.json().provider.redirectUri).toBe(
      `${WEB_URL}/auth/v1/sso/${o.slug}/oidc/callback`,
    );

    const { reply, callbackPath } = await oidcSignIn(o.slug, 'Anita@Careful.example');
    expect(reply.statusCode).toBe(302);
    expect(reply.headers.location).toBe(`${WEB_URL}/`);
    const token = await restore(reply.headers['set-cookie']);
    const me = await asUser('GET', '/v1/me', token);
    expect(me.json()).toMatchObject({ userId: o.person.id, deviceId: null });

    // The same answer twice is refused: its state is spent.
    const replay = await app.inject({ method: 'GET', url: callbackPath });
    expect(replay.headers.location).toBe(`${WEB_URL}/sign-in?sso=expired`);
    // Someone the tenant doesn't have, or from another domain, isn't let in or created.
    expect((await oidcSignIn(o.slug, 'nobody@careful.example')).reply.headers.location).toBe(
      `${WEB_URL}/sign-in?sso=no_person`,
    );
    expect((await oidcSignIn(o.slug, 'anita@elsewhere.example')).reply.headers.location).toBe(
      `${WEB_URL}/sign-in?sso=domain`,
    );
  });

  it('keeps the secret when settings change without it, and gives each domain one organisation', async () => {
    const o = await organisation('kept.example');
    await asUser('PUT', '/v1/sso', o.admin, {
      settings: oidcSettings(),
      domains: ['kept.example'],
      enabled: true,
      enforced: false,
    });
    const withoutSecret: Partial<ReturnType<typeof oidcSettings>> = oidcSettings();
    delete withoutSecret.clientSecret;
    const changed = await asUser('PUT', '/v1/sso', o.admin, {
      settings: withoutSecret,
      domains: ['kept.example', 'also-kept.example'],
      enabled: true,
      enforced: false,
    });
    expect(changed.json().connection).toMatchObject({ hasClientSecret: true });
    expect((await oidcSignIn(o.slug, 'anita@kept.example')).reply.headers.location).toBe(
      `${WEB_URL}/`,
    );

    const other = await organisation('another.example');
    const clash = await asUser('PUT', '/v1/sso', other.admin, {
      settings: oidcSettings(),
      domains: ['kept.example'],
      enabled: true,
      enforced: false,
    });
    expect(clash.json().error.details).toEqual([
      { path: 'domains', issue: 'Another organisation signs in kept.example already' },
    ]);
  });

  it('finds the connection from a work email, and refuses web OTP once it is required', async () => {
    const o = await organisation('required.example');
    const discover = (email: string) =>
      app.inject({ method: 'POST', url: '/auth/v1/sso/discover', payload: { email } });
    await asUser('PUT', '/v1/sso', o.admin, {
      settings: oidcSettings(),
      domains: ['required.example'],
      enabled: false,
      enforced: false,
    });
    expect((await discover('anita@required.example')).json()).toEqual({ url: null });
    await asUser('PUT', '/v1/sso', o.admin, {
      settings: oidcSettings(),
      domains: ['required.example'],
      enabled: true,
      enforced: true,
    });
    expect((await discover('Anita@Required.example')).json()).toEqual({
      url: `/auth/v1/sso/${o.slug}/start`,
    });
    expect((await discover('anita@nowhere.example')).json()).toEqual({ url: null });

    // On the web, people in the domain must use SSO; on a phone, OTP carries on.
    const web = await world.verify(o.personPhone);
    expect(web.json().error.code).toBe('SSO_REQUIRED');
    expect((await world.verify(o.personPhone, newDevice())).json().status).toBe('signed_in');
    // The admin, without an email in the domain, still signs in with OTP and the authenticator.
    expect((await world.verify(o.adminPhone)).json().status).toBe('second_factor');
  });
});

describe('a SAML connection (D91)', () => {
  it('signs in with a signed assertion, and refuses one that is not', async () => {
    const o = await organisation('saml.example');
    const { key, cert } = idpKeys();
    const saved = await asUser('PUT', '/v1/sso', o.admin, {
      settings: {
        protocol: 'saml',
        entryPoint: 'https://idp.example/sso',
        idpIssuer: 'https://idp.example/',
        idpCertificate: cert,
      },
      domains: ['saml.example'],
      enabled: true,
      enforced: false,
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const { acsUrl, entityId } = saved.json().provider;
    const metadata = await app.inject({
      method: 'GET',
      url: `/auth/v1/sso/${o.slug}/saml/metadata`,
    });
    expect(metadata.body).toContain(entityId);

    const start = async () => {
      const started = await app.inject({ method: 'GET', url: `/auth/v1/sso/${o.slug}/start` });
      const location = new URL(String(started.headers.location));
      expect(location.origin + location.pathname).toBe('https://idp.example/sso');
      return location.searchParams.get('RelayState')!;
    };
    const post = (relay: string, xml: string) =>
      app.inject({
        method: 'POST',
        url: `/auth/v1/sso/${o.slug}/saml/acs`,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        payload: new URLSearchParams({
          SAMLResponse: Buffer.from(xml).toString('base64'),
          RelayState: relay,
        }).toString(),
        remoteAddress: address(),
      });

    const signed = sign(response({ acsUrl, entityId, email: 'anita@saml.example' }), key, cert);
    const ok = await post(await start(), signed);
    expect(ok.headers.location).toBe(`${WEB_URL}/`);
    const token = await restore(ok.headers['set-cookie']);
    expect((await asUser('GET', '/v1/me', token)).json().userId).toBe(o.person.id);

    // Saving again without the certificate keeps it, and signing in still works.
    const resaved = await asUser('PUT', '/v1/sso', o.admin, {
      settings: {
        protocol: 'saml',
        entryPoint: 'https://idp.example/sso',
        idpIssuer: 'https://idp.example/',
      },
      domains: ['saml.example'],
      enabled: true,
      enforced: false,
    });
    expect(resaved.json().connection).toMatchObject({ hasIdpCertificate: true });
    expect(
      (
        await post(
          await start(),
          sign(response({ acsUrl, entityId, email: 'anita@saml.example' }), key, cert),
        )
      ).headers.location,
    ).toBe(`${WEB_URL}/`);
    // A first connection needs one.
    const fresh = await organisation('fresh-saml.example');
    const missing = await asUser('PUT', '/v1/sso', fresh.admin, {
      settings: { protocol: 'saml', entryPoint: 'https://idp.example/sso', idpIssuer: 'x' },
      domains: ['fresh-saml.example'],
      enabled: true,
      enforced: false,
    });
    expect(missing.json().error.details).toEqual([
      { path: 'settings.idpCertificate', issue: 'Paste the identity provider’s certificate' },
    ]);

    // An assertion changed after signing is refused.
    const forged = signed.replace('anita@saml.example', 'admin@saml.example');
    expect((await post(await start(), forged)).headers.location).toBe(
      `${WEB_URL}/sign-in?sso=refused`,
    );
    // So is one signed by another key.
    const stranger = idpKeys();
    const foreign = sign(
      response({ acsUrl, entityId, email: 'anita@saml.example' }),
      stranger.key,
      stranger.cert,
    );
    expect((await post(await start(), foreign)).headers.location).toBe(
      `${WEB_URL}/sign-in?sso=refused`,
    );
  });
});

/** A key and self-signed certificate for a test identity provider, made with openssl. */
function idpKeys(): { key: string; cert: string } {
  const folder = mkdtempSync(join(tmpdir(), 'idp-'));
  execFileSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-nodes',
      '-keyout',
      join(folder, 'key.pem'),
      '-out',
      join(folder, 'cert.pem'),
      '-days',
      '2',
      '-subj',
      '/CN=idp.example',
    ],
    { stdio: 'ignore' },
  );
  return {
    key: readFileSync(join(folder, 'key.pem'), 'utf8'),
    cert: readFileSync(join(folder, 'cert.pem'), 'utf8'),
  };
}

function response(input: { acsUrl: string; entityId: string; email: string }): string {
  const now = new Date();
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${newId().replaceAll('-', '')}" Version="2.0" IssueInstant="${at(0)}" Destination="${input.acsUrl}"><saml:Issuer>https://idp.example/</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_a${newId().replaceAll('-', '')}" Version="2.0" IssueInstant="${at(0)}"><saml:Issuer>https://idp.example/</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${input.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${at(5)}" Recipient="${input.acsUrl}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${at(-1)}" NotOnOrAfter="${at(5)}"><saml:AudienceRestriction><saml:Audience>${input.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${at(0)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
}

/** Signs the assertion inside a response, as an identity provider does. */
function sign(xml: string, key: string, cert: string): string {
  const signature = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  signature.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  signature.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  return signature.getSignedXml();
}
