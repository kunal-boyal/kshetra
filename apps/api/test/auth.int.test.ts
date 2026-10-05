import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@kshetra/shared';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MemoryOtpSender, OtpSender } from '../src/modules/directory/otp-sender';
import { SigningKey } from '../src/modules/directory/signing-key';
import { DirectoryFixtures, newAddress, newPhone, startApp } from './support';

let app: NestFastifyApplication;
let fixtures: DirectoryFixtures;
let sender: MemoryOtpSender;

beforeAll(async () => {
  app = await startApp();
  fixtures = await DirectoryFixtures.connect();
  sender = app.get(OtpSender) as MemoryOtpSender;
});

afterAll(async () => {
  await fixtures.end();
  await app.close();
});

const post = (url: string, payload: object, remoteAddress = newAddress()) =>
  app.inject({ method: 'POST', url, payload, remoteAddress });
const requestCode = (phone: string, address?: string) =>
  post('/auth/v1/otp/request', { phone }, address);
const verifyCode = (phone: string, code: string, address?: string) =>
  post('/auth/v1/otp/verify', { phone, code }, address);
const refresh = (refreshToken: string) => post('/auth/v1/token/refresh', { refreshToken });
const me = (accessToken: string) =>
  app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${accessToken}` } });

/** A person with an active membership in a new tenant for each name. */
async function member(...tenantNames: string[]) {
  const phone = newPhone();
  const tenantIds: string[] = [];
  for (const name of tenantNames) tenantIds.push(await fixtures.tenant(name));
  return { phone, tenantIds, ...(await fixtures.member(phone, tenantIds)) };
}

/** Signs a one-tenant member in and returns the session. */
async function signIn(phone: string) {
  await requestCode(phone);
  const response = await verifyCode(phone, sender.lastCode(phone)!);
  expect(response.json().status).toBe('signed_in');
  return response.json().session as { accessToken: string; refreshToken: string };
}

const wrong = (code: string) => String((Number(code) + 1) % 1_000_000).padStart(6, '0');

describe('requesting a code', () => {
  it('answers a registered and an unknown number the same way, and texts only the registered one', async () => {
    const known = await member('Annapurna Agro');
    const unknown = newPhone();
    const a = await requestCode(known.phone);
    const b = await requestCode(unknown);
    expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
    expect(a.json()).toEqual({ expiresInSeconds: 300 });
    expect(b.json()).toEqual(a.json());
    expect(sender.lastCode(known.phone)).toMatch(/^\d{6}$/);
    expect(sender.lastCode(unknown)).toBeUndefined();
  });

  it('sends nothing for a tenant that is suspended', async () => {
    const phone = newPhone();
    await fixtures.member(phone, [await fixtures.tenant('Closed Co', 'suspended')]);
    expect((await requestCode(phone)).statusCode).toBe(202);
    expect(sender.lastCode(phone)).toBeUndefined();
  });

  it('limits requests per number and per address (M1, rule 3)', async () => {
    const phone = newPhone();
    for (let i = 0; i < 3; i += 1) expect((await requestCode(phone)).statusCode).toBe(202);
    const limited = await requestCode(phone);
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    const wait = Number(limited.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600);

    const address = newAddress();
    for (let i = 0; i < 20; i += 1) {
      expect((await requestCode(newPhone(), address)).statusCode).toBe(202);
    }
    expect((await requestCode(newPhone(), address)).statusCode).toBe(429);
  });

  it('asks for a valid number instead of guessing', async () => {
    const response = await requestCode('1234567');
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'VALIDATION',
      details: [{ path: 'phone', issue: 'Not a valid mobile number' }],
    });
  });
});

describe('verifying a code', () => {
  it('signs in, and the access token opens the cell', async () => {
    const person = await member('Bharat Seeds');
    await requestCode(person.phone);
    // The app may send the number as typed: without +91 and with spaces.
    const typed = `${person.phone.slice(3, 8)} ${person.phone.slice(8)}`;
    const response = await verifyCode(typed, sender.lastCode(person.phone)!);
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = response.json();
    expect(body).toMatchObject({
      status: 'signed_in',
      tenant: { id: person.tenantIds[0], name: 'Bharat Seeds', cellUrl: 'https://cell.local.test' },
      session: { tokenType: 'Bearer' },
    });

    const who = await me(body.session.accessToken);
    expect(who.statusCode).toBe(200);
    expect(who.json()).toEqual({
      userId: person.userIds[0],
      tenantId: person.tenantIds[0],
      cell: 'local',
    });
  });

  it('refuses wrong codes, then expires the code after five attempts', async () => {
    const person = await member('Chandra Krishi');
    await requestCode(person.phone);
    const code = sender.lastCode(person.phone)!;
    for (let i = 0; i < 4; i += 1) {
      const response = await verifyCode(person.phone, wrong(code));
      expect(response.statusCode).toBe(400);
      expect(response.json().error.code).toBe('OTP_INVALID');
    }
    expect((await verifyCode(person.phone, wrong(code))).json().error.code).toBe('OTP_EXPIRED');
    expect((await verifyCode(person.phone, code)).json().error.code).toBe('OTP_EXPIRED');
  });

  it('expires a code after five minutes', async () => {
    const person = await member('Dhara Inputs');
    await requestCode(person.phone);
    await fixtures.client.query(
      `update directory.otp_challenges set expires_at = now() - interval '1 second' where identity_key = $1`,
      [person.phone],
    );
    const response = await verifyCode(person.phone, sender.lastCode(person.phone)!);
    expect(response.json().error.code).toBe('OTP_EXPIRED');
  });

  it('answers an unknown number exactly as it answers a wrong code', async () => {
    const unknown = newPhone();
    expect((await verifyCode(unknown, '123456')).json().error.code).toBe('OTP_EXPIRED');
    await requestCode(unknown);
    for (let i = 0; i < 4; i += 1) {
      expect((await verifyCode(unknown, '123456')).json().error.code).toBe('OTP_INVALID');
    }
    expect((await verifyCode(unknown, '123456')).json().error.code).toBe('OTP_EXPIRED');
  });

  it('works once: a used code cannot sign in again', async () => {
    const person = await member('Ekta Agri');
    await requestCode(person.phone);
    const code = sender.lastCode(person.phone)!;
    expect((await verifyCode(person.phone, code)).statusCode).toBe(200);
    expect((await verifyCode(person.phone, code)).json().error.code).toBe('OTP_EXPIRED');
  });

  it('limits verifications per address', async () => {
    const address = newAddress();
    for (let i = 0; i < 30; i += 1) {
      expect((await verifyCode(newPhone(), '123456', address)).statusCode).not.toBe(429);
    }
    expect((await verifyCode(newPhone(), '123456', address)).statusCode).toBe(429);
  });

  it('checks the shape of the code', async () => {
    const response = await verifyCode(newPhone(), '12ab');
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details).toEqual([
      { path: 'code', issue: 'Enter the 6-digit code' },
    ]);
  });
});

describe('people in several tenants', () => {
  it('choose a tenant after one code, then switch without a second (M1, rule 4)', async () => {
    const person = await member('Zeta Traders', 'Alpha Inputs');
    const [zetaId, alphaId] = person.tenantIds;
    await requestCode(person.phone);
    const verified = (await verifyCode(person.phone, sender.lastCode(person.phone)!)).json();
    expect(verified.status).toBe('choose_tenant');
    expect(verified.tenants).toEqual([
      { id: alphaId, name: 'Alpha Inputs' },
      { id: zetaId, name: 'Zeta Traders' },
    ]);

    const chosen = await post('/auth/v1/select-tenant', {
      ticket: verified.ticket,
      tenantId: zetaId,
    });
    expect(chosen.json()).toMatchObject({ status: 'signed_in', tenant: { id: zetaId } });
    const again = await post('/auth/v1/select-tenant', {
      ticket: verified.ticket,
      tenantId: alphaId,
    });
    expect(again.json().error.code).toBe('OTP_EXPIRED');

    const zetaSession = chosen.json().session;
    const outsider = await fixtures.tenant('Not Theirs');
    const refused = await post('/auth/v1/switch-tenant', {
      refreshToken: zetaSession.refreshToken,
      tenantId: outsider,
    });
    expect(refused.statusCode).toBe(403);

    const switched = await post('/auth/v1/switch-tenant', {
      refreshToken: zetaSession.refreshToken,
      tenantId: alphaId,
    });
    expect(switched.json()).toMatchObject({ status: 'signed_in', tenant: { id: alphaId } });
    expect((await me(switched.json().session.accessToken)).json().tenantId).toBe(alphaId);
    // The tenant left behind is signed out.
    expect((await refresh(zetaSession.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('sessions', () => {
  it('rotate refresh tokens, and a spent one coming back ends the whole family', async () => {
    const person = await member('Falcon Agro');
    const first = await signIn(person.phone);
    const rotated = await refresh(first.refreshToken);
    expect(rotated.statusCode).toBe(200);
    const second = rotated.json().session;
    expect(second.refreshToken).not.toBe(first.refreshToken);
    expect((await me(second.accessToken)).statusCode).toBe(200);

    expect((await refresh(first.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
    expect((await refresh(second.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
  });

  it('end on sign-out', async () => {
    const person = await member('Gagan Krishi');
    const session = await signIn(person.phone);
    expect((await post('/auth/v1/logout', { refreshToken: session.refreshToken })).statusCode).toBe(
      204,
    );
    expect((await refresh(session.refreshToken)).statusCode).toBe(401);
    expect((await post('/auth/v1/logout', { refreshToken: 'x'.repeat(43) })).statusCode).toBe(204);
  });

  it('end when the membership is deactivated or its auth revision moves (BR-39)', async () => {
    const deactivated = await member('Hari Seeds');
    const one = await signIn(deactivated.phone);
    await fixtures.client.query(
      `update directory.memberships set status = 'inactive' where id = $1`,
      [deactivated.membershipIds[0]],
    );
    expect((await refresh(one.refreshToken)).json().error.code).toBe('SESSION_REVOKED');

    const revised = await member('Indus Inputs');
    const two = await signIn(revised.phone);
    await fixtures.client.query(
      `update directory.memberships set auth_revision = auth_revision + 1 where id = $1`,
      [revised.membershipIds[0]],
    );
    expect((await refresh(two.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
  });

  it('end when the refresh token expires', async () => {
    const person = await member('Jai Kisan');
    const session = await signIn(person.phone);
    await fixtures.client.query(
      `update directory.refresh_tokens set expires_at = now() - interval '1 second' where membership_id = $1`,
      [person.membershipIds[0]],
    );
    expect((await refresh(session.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('cell routes', () => {
  it('need a valid access token for this cell', async () => {
    const keys = app.get(SigningKey);
    const claims = { userId: newId(), tenantId: newId(), cell: 'local', revision: 0 };

    expect((await app.inject({ method: 'GET', url: '/v1/me' })).json().error.code).toBe(
      'UNAUTHENTICATED',
    );
    const basic = await app.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: 'Basic abc' },
    });
    expect(basic.json().error.code).toBe('UNAUTHENTICATED');

    const old = await keys.sign(claims, new Date(Date.now() - 20 * 60_000));
    const expired = await me(old.token);
    expect(expired.statusCode).toBe(401);
    expect(expired.json().error.code).toBe('TOKEN_EXPIRED');

    const elsewhere = await keys.sign({ ...claims, cell: 'another-cell' });
    expect((await me(elsewhere.token)).json().error.code).toBe('UNAUTHENTICATED');

    expect((await me((await keys.sign(claims)).token)).statusCode).toBe(200);
  });

  it('are verifiable with the published JWKS, which holds no private key', async () => {
    const jwks = (await app.inject({ method: 'GET', url: '/auth/v1/jwks' })).json();
    expect(jwks.keys).toHaveLength(1);
    expect(jwks.keys[0]).not.toHaveProperty('d');

    const person = await member('Kaveri Agro');
    const session = await signIn(person.phone);
    const { payload, protectedHeader } = await jwtVerify(
      session.accessToken,
      createLocalJWKSet(jwks),
      { issuer: 'kshetra:directory', audience: 'kshetra:cell' },
    );
    expect(protectedHeader).toMatchObject({ alg: 'ES256', kid: jwks.keys[0].kid });
    expect(payload).toMatchObject({
      sub: person.userIds[0],
      tid: person.tenantIds[0],
      cell: 'local',
      rev: 0,
    });
  });
});
