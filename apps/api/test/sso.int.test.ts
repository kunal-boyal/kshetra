import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { OAuth2Server } from 'oauth2-mock-server';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignedXml } from 'xml-crypto';
import { DomainRecords, type MemoryDomainRecords } from '../src/platform/domain-records';
import { totpAt, totpStep } from '../src/platform/totp';
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
/**
 * The email the mock provider puts in its next ID token, the subject it gives (by default the
 * email, as a provider gives each person their own), and how it says the person signed in.
 */
let nextEmail = '';
let nextSubject: string | undefined;
let nextAmr: string[] | undefined;

beforeAll(async () => {
  app = await startApp(testConfig({ WEB_URL }));
  world = await World.create(app);
  provider = new OAuth2Server();
  await provider.issuer.keys.generate('RS256');
  await provider.start(0, '127.0.0.1');
  provider.service.on('beforeTokenSigning', (token) => {
    token.payload.email = nextEmail;
    token.payload.sub = nextSubject ?? nextEmail.toLowerCase();
    token.payload.email_verified = true;
    if (nextAmr) token.payload.amr = nextAmr;
    else delete token.payload.amr;
  });
});

afterAll(async () => {
  await provider.stop();
  await world.end();
  await app.close();
});

const address = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
const WEB = { 'x-client': 'web' };

function asUser(method: 'GET' | 'PUT' | 'POST', url: string, token: string, body?: object) {
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
  // Changing single sign-on needs a fresh authenticator code (decision D101).
  const admin = await world.stepUp(adminPhone, (await world.signIn(adminPhone)).accessToken);
  const personPhone = newPhone();
  const person = await world.user(tenantId, { phone: personPhone, email: `anita@${domain}` });
  return { tenantId, slug: `t-${tenantId}`, admin, adminPhone, person, personPhone };
}

/**
 * Saves a connection and proves its domains, publishing each TXT record where the test's DNS
 * reads it (decision D101); a refused save comes back as it was.
 */
async function connect(o: { admin: string }, body: object) {
  const saved = await asUser('PUT', '/v1/sso', o.admin, body);
  if (saved.statusCode !== 200) return saved;
  const records = app.get(DomainRecords) as MemoryDomainRecords;
  for (const check of saved.json().connection.domainChecks) {
    records.set(check.recordName, [check.recordValue]);
    const proved = await asUser('POST', '/v1/sso/domains/verify', o.admin, {
      domain: check.domain,
    });
    expect(proved.statusCode, proved.body).toBe(200);
  }
  return asUser('GET', '/v1/sso', o.admin);
}

const oidcSettings = () => ({
  protocol: 'oidc',
  issuer: provider.issuer.url!,
  clientId: 'the-lamp',
  clientSecret: 'a client secret from the provider',
});

/** The binder cookie a start set, as the browser sends it back (decision D101). */
function binderOf(reply: { headers: Record<string, unknown> }): string {
  const set = reply.headers['set-cookie'];
  const found = (Array.isArray(set) ? set : [set]).find((each) => String(each).includes('_sso='));
  return String(found).split(';')[0]!;
}

/** Follows an OIDC sign-in from our start, through the mock provider, back to our callback. */
async function oidcSignIn(slug: string, email: string, amr?: string[]) {
  const started = await app.inject({ method: 'GET', url: `/auth/v1/sso/${slug}/start` });
  const binder = binderOf(started);
  expect(started.statusCode, started.body).toBe(302);
  const authorise = String(started.headers.location);
  expect(authorise.startsWith(provider.issuer.url!)).toBe(true);
  expect(new URL(authorise).searchParams.get('code_challenge_method')).toBe('S256');
  nextEmail = email;
  nextAmr = amr;
  const back = await fetch(authorise, { redirect: 'manual' });
  const callback = new URL(back.headers.get('location')!);
  expect(callback.origin + callback.pathname).toBe(`${WEB_URL}/auth/v1/sso/${slug}/oidc/callback`);
  return {
    callbackPath: callback.pathname + callback.search,
    binder,
    reply: await app.inject({
      method: 'GET',
      url: callback.pathname + callback.search,
      headers: { cookie: binder },
      remoteAddress: address(),
    }),
  };
}

/** The session a reply's refresh cookie holds, as the portal restores it. */
async function restore(cookie: string | string[] | undefined) {
  const all = Array.isArray(cookie) ? cookie : [cookie];
  const header = all.find((each) => String(each).includes('_refresh='))!.split(';')[0]!;
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
    const saved = await connect(o, {
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

    const { reply, callbackPath, binder } = await oidcSignIn(o.slug, 'Anita@Careful.example');
    expect(reply.statusCode).toBe(302);
    expect(reply.headers.location).toBe(`${WEB_URL}/`);
    const token = await restore(reply.headers['set-cookie']);
    const me = await asUser('GET', '/v1/me', token);
    expect(me.json()).toMatchObject({ userId: o.person.id, deviceId: null });

    // The same answer twice is refused: its state is spent.
    const replay = await app.inject({
      method: 'GET',
      url: callbackPath,
      headers: { cookie: binder },
    });
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
    await connect(o, {
      settings: oidcSettings(),
      domains: ['kept.example'],
      enabled: true,
      enforced: false,
    });
    const withoutSecret: Partial<ReturnType<typeof oidcSettings>> = oidcSettings();
    delete withoutSecret.clientSecret;
    const changed = await connect(o, {
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
    const clash = await connect(other, {
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
    await connect(o, {
      settings: oidcSettings(),
      domains: ['required.example'],
      enabled: false,
      enforced: false,
    });
    expect((await discover('anita@required.example')).json()).toEqual({ url: null });
    await connect(o, {
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

describe('SSO and the second factor (D101)', () => {
  it('asks an admin for our authenticator unless the provider says it asked for one', async () => {
    const o = await organisation('mfa.example');
    const bossPhone = newPhone();
    const boss = await world.user(o.tenantId, {
      phone: bossPhone,
      designation: 'head',
      role: 'tenant_admin',
      email: 'boss@mfa.example',
    });
    await connect(o, {
      settings: oidcSettings(),
      domains: ['mfa.example'],
      enabled: true,
      enforced: false,
    });

    // A password alone at the provider: our authenticator next, on a ticket in the fragment.
    const plain = await oidcSignIn(o.slug, 'boss@mfa.example', ['pwd']);
    const location = new URL(String(plain.reply.headers.location));
    expect(location.origin + location.pathname + location.search).toBe(
      `${WEB_URL}/sign-in?sso=second_factor`,
    );
    const fragment = new URLSearchParams(location.hash.slice(1));
    expect(fragment.get('enrolled')).toBe('0');
    const ticket = fragment.get('ticket')!;
    const setUp = await app.inject({
      method: 'POST',
      url: '/auth/v1/totp/setup',
      payload: { ticket },
      remoteAddress: address(),
    });
    const { secret } = setUp.json();
    const verified = await app.inject({
      method: 'POST',
      url: '/auth/v1/totp/verify',
      headers: WEB,
      payload: { ticket, code: totpAt(secret, totpStep()) },
      remoteAddress: address(),
    });
    expect(verified.statusCode, verified.body).toBe(200);
    // An SSO session comes back to the provider after 12 hours, however used.
    const hours =
      (Date.parse(verified.json().session.refreshTokenExpiresAt) - Date.now()) / 3_600_000;
    expect(hours).toBeCloseTo(12, 0);
    const token = await restore(verified.headers['set-cookie']);
    expect((await asUser('GET', '/v1/me', token)).json().userId).toBe(boss.id);

    // The provider's own second factor is enough.
    const strong = await oidcSignIn(o.slug, 'boss@mfa.example', ['pwd', 'mfa']);
    expect(strong.reply.headers.location).toBe(`${WEB_URL}/`);
  });

  it('counts an answer only in the browser that started the sign-in', async () => {
    const o = await organisation('binder.example');
    await connect(o, {
      settings: oidcSettings(),
      domains: ['binder.example'],
      enabled: true,
      enforced: false,
    });
    const started = await app.inject({ method: 'GET', url: `/auth/v1/sso/${o.slug}/start` });
    nextEmail = 'anita@binder.example';
    nextAmr = undefined;
    const back = await fetch(String(started.headers.location), { redirect: 'manual' });
    const callback = new URL(back.headers.get('location')!);
    // Sent to a victim's browser, which has no binder: refused, so nobody is signed into it.
    const elsewhere = await app.inject({
      method: 'GET',
      url: callback.pathname + callback.search,
      remoteAddress: address(),
    });
    expect(elsewhere.headers.location).toBe(`${WEB_URL}/sign-in?sso=expired`);
  });
});

describe('proving domains and binding people (D101)', () => {
  it('signs nobody in at a domain not yet proved, and gives a proved one to one organisation', async () => {
    const o = await organisation('unproved.example');
    const body = {
      settings: oidcSettings(),
      domains: ['unproved.example'],
      enabled: true,
      enforced: false,
    };
    const saved = await asUser('PUT', '/v1/sso', o.admin, body);
    expect(saved.statusCode, saved.body).toBe(200);
    const [check] = saved.json().connection.domainChecks;
    expect(check).toMatchObject({
      domain: 'unproved.example',
      verified: false,
      recordName: '_thelamp-sso.unproved.example',
      recordValue: expect.stringMatching(/^thelamp-sso=[0-9a-f]{32}$/),
    });
    const discover = () =>
      app.inject({
        method: 'POST',
        url: '/auth/v1/sso/discover',
        payload: { email: 'anita@unproved.example' },
        remoteAddress: address(),
      });
    expect((await discover()).json().url).toBeNull();
    expect((await oidcSignIn(o.slug, 'anita@unproved.example')).reply.headers.location).toBe(
      `${WEB_URL}/sign-in?sso=domain`,
    );

    // Another organisation may claim it too while nobody has proved it…
    const squatter = await organisation('squatter.example');
    const claimed = await asUser('PUT', '/v1/sso', squatter.admin, body);
    expect(claimed.statusCode, claimed.body).toBe(200);
    // …but a record without the token proves nothing.
    const records = app.get(DomainRecords) as MemoryDomainRecords;
    records.set(check.recordName, ['thelamp-sso=not-the-token']);
    const wrong = await asUser('POST', '/v1/sso/domains/verify', o.admin, {
      domain: 'unproved.example',
    });
    expect(wrong.json().error.details).toEqual([
      {
        path: 'domain',
        issue: 'No TXT record with the token was found at _thelamp-sso.unproved.example yet',
      },
    ]);
    records.set(check.recordName, [check.recordValue]);
    const proved = await asUser('POST', '/v1/sso/domains/verify', o.admin, {
      domain: 'unproved.example',
    });
    expect(proved.json().connection.domainChecks[0]).toMatchObject({ verified: true });
    expect((await discover()).json().url).toBe(`/auth/v1/sso/${o.slug}/start`);
    expect((await oidcSignIn(o.slug, 'anita@unproved.example')).reply.headers.location).toBe(
      `${WEB_URL}/`,
    );
    // Once proved, it is the owner's alone.
    const theirs = squatter.admin;
    const again = await asUser('PUT', '/v1/sso', theirs, body);
    expect(again.json().error.details).toEqual([
      { path: 'domains', issue: 'Another organisation signs in unproved.example already' },
    ]);
  });

  it('binds a person to the provider’s subject, so an email moved there moves nobody', async () => {
    const o = await organisation('bound.example');
    await connect(o, {
      settings: oidcSettings(),
      domains: ['bound.example'],
      enabled: true,
      enforced: false,
    });
    const bob = await world.user(o.tenantId, { phone: newPhone(), email: 'bob@bound.example' });
    nextSubject = 'idp-subject-anita';
    const first = await oidcSignIn(o.slug, 'anita@bound.example');
    expect(first.reply.headers.location).toBe(`${WEB_URL}/`);
    // The provider now says Anita's subject has Bob's email: it is still Anita.
    const moved = await oidcSignIn(o.slug, 'bob@bound.example');
    const token = await restore(moved.reply.headers['set-cookie']);
    expect((await asUser('GET', '/v1/me', token)).json().userId).toBe(o.person.id);
    // And another subject claiming Anita's email doesn't become her.
    nextSubject = 'idp-subject-impostor';
    expect((await oidcSignIn(o.slug, 'anita@bound.example')).reply.headers.location).toBe(
      `${WEB_URL}/sign-in?sso=no_person`,
    );
    // Bob, with a subject of his own, signs in as himself.
    nextSubject = 'idp-subject-bob';
    const bobs = await oidcSignIn(o.slug, 'bob@bound.example');
    const bobToken = await restore(bobs.reply.headers['set-cookie']);
    expect((await asUser('GET', '/v1/me', bobToken)).json().userId).toBe(bob.id);
    nextSubject = undefined;
  });
});

describe('a SAML connection (D91)', () => {
  it('signs in with a signed assertion, and refuses one that is not', async () => {
    const o = await organisation('saml.example');
    const { key, cert } = idpKeys();
    const saved = await connect(o, {
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

    // A start: the RelayState, the browser's binder, and the ID of the request it sent.
    const start = async () => {
      const started = await app.inject({ method: 'GET', url: `/auth/v1/sso/${o.slug}/start` });
      const location = new URL(String(started.headers.location));
      expect(location.origin + location.pathname).toBe('https://idp.example/sso');
      const request = inflateRawSync(
        Buffer.from(location.searchParams.get('SAMLRequest')!, 'base64'),
      ).toString('utf8');
      return {
        relay: location.searchParams.get('RelayState')!,
        binder: binderOf(started),
        requestId: /ID="([^"]+)"/.exec(request)![1]!,
      };
    };
    const post = (begun: { relay: string; binder: string }, xml: string) =>
      app.inject({
        method: 'POST',
        url: `/auth/v1/sso/${o.slug}/saml/acs`,
        headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: begun.binder },
        payload: new URLSearchParams({
          SAMLResponse: Buffer.from(xml).toString('base64'),
          RelayState: begun.relay,
        }).toString(),
        remoteAddress: address(),
      });
    const answer = (begun: { requestId: string }, email = 'anita@saml.example') =>
      sign(response({ acsUrl, entityId, email, inResponseTo: begun.requestId }), key, cert);

    const first = await start();
    const signed = answer(first);
    const ok = await post(first, signed);
    expect(ok.headers.location).toBe(`${WEB_URL}/`);
    const token = await restore(ok.headers['set-cookie']);
    expect((await asUser('GET', '/v1/me', token)).json().userId).toBe(o.person.id);

    // Saving again without the certificate keeps it, and signing in still works.
    const resaved = await connect(o, {
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
    const again = await start();
    expect((await post(again, answer(again))).headers.location).toBe(`${WEB_URL}/`);
    // A first connection needs one.
    const fresh = await organisation('fresh-saml.example');
    const missing = await connect(fresh, {
      settings: { protocol: 'saml', entryPoint: 'https://idp.example/sso', idpIssuer: 'x' },
      domains: ['fresh-saml.example'],
      enabled: true,
      enforced: false,
    });
    expect(missing.json().error.details).toEqual([
      { path: 'settings.idpCertificate', issue: 'Paste the identity provider’s certificate' },
    ]);

    // An assertion changed after signing is refused.
    const third = await start();
    const forged = answer(third).replace('anita@saml.example', 'admin@saml.example');
    expect((await post(third, forged)).headers.location).toBe(`${WEB_URL}/sign-in?sso=refused`);
    // So is one signed by another key.
    const stranger = idpKeys();
    const fourth = await start();
    const foreign = sign(
      response({ acsUrl, entityId, email: 'anita@saml.example', inResponseTo: fourth.requestId }),
      stranger.key,
      stranger.cert,
    );
    expect((await post(fourth, foreign)).headers.location).toBe(`${WEB_URL}/sign-in?sso=refused`);

    // A response captured on its way can't be used again, even with a fresh start: it answers
    // a request already answered (decision D101).
    const fifth = await start();
    expect((await post(fifth, signed)).headers.location).toBe(`${WEB_URL}/sign-in?sso=refused`);
    // Nor in a browser that didn't start the sign-in.
    const sixth = await start();
    expect(
      (await post({ relay: sixth.relay, binder: 'thelamp_sso=forged' }, answer(sixth))).headers
        .location,
    ).toBe(`${WEB_URL}/sign-in?sso=expired`);
    // Nor signed with SHA-1.
    const seventh = await start();
    expect(
      (
        await post(
          seventh,
          sign(
            response({
              acsUrl,
              entityId,
              email: 'anita@saml.example',
              inResponseTo: seventh.requestId,
            }),
            key,
            cert,
            'sha1',
          ),
        )
      ).headers.location,
    ).toBe(`${WEB_URL}/sign-in?sso=refused`);
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

function response(input: {
  acsUrl: string;
  entityId: string;
  email: string;
  inResponseTo: string;
}): string {
  const now = new Date();
  const at = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();
  return `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="_r${newId().replaceAll('-', '')}" Version="2.0" IssueInstant="${at(0)}" Destination="${input.acsUrl}" InResponseTo="${input.inResponseTo}"><saml:Issuer>https://idp.example/</saml:Issuer><samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status><saml:Assertion ID="_a${newId().replaceAll('-', '')}" Version="2.0" IssueInstant="${at(0)}"><saml:Issuer>https://idp.example/</saml:Issuer><saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${input.email}</saml:NameID><saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${at(5)}" Recipient="${input.acsUrl}" InResponseTo="${input.inResponseTo}"/></saml:SubjectConfirmation></saml:Subject><saml:Conditions NotBefore="${at(-1)}" NotOnOrAfter="${at(5)}"><saml:AudienceRestriction><saml:Audience>${input.entityId}</saml:Audience></saml:AudienceRestriction></saml:Conditions><saml:AuthnStatement AuthnInstant="${at(0)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement></saml:Assertion></samlp:Response>`;
}

/** Signs the assertion inside a response, as an identity provider does. */
function sign(xml: string, key: string, cert: string, hash: 'sha256' | 'sha1' = 'sha256'): string {
  const signature = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm:
      hash === 'sha1'
        ? 'http://www.w3.org/2000/09/xmldsig#rsa-sha1'
        : 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
    canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
  });
  signature.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    transforms: [
      'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
      'http://www.w3.org/2001/10/xml-exc-c14n#',
    ],
    digestAlgorithm:
      hash === 'sha1'
        ? 'http://www.w3.org/2000/09/xmldsig#sha1'
        : 'http://www.w3.org/2001/04/xmlenc#sha256',
  });
  signature.computeSignature(xml, {
    location: {
      reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']",
      action: 'after',
    },
  });
  return signature.getSignedXml();
}
