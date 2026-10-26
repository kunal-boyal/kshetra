import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MemoryOtpSender } from '../src/modules/directory/otp-sender';
import { SigningKey } from '../src/modules/directory/signing-key';
import { newAddress, newPhone, startApp, testConfig, World } from './support';

let app: NestFastifyApplication;
let world: World;
let sender: MemoryOtpSender;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  sender = world.sender;
});

afterAll(async () => {
  await world.end();
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

/** A person with an active user in a new tenant for each name. */
async function member(...tenantNames: string[]) {
  const phone = newPhone();
  const tenantIds: string[] = [];
  for (const name of tenantNames) tenantIds.push(await world.tenant(name));
  return { phone, tenantIds, ...(await world.member(phone, tenantIds)) };
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
    await world.member(phone, [await world.tenant('Closed Co', 'suspended')]);
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
    expect(who.json()).toMatchObject({
      userId: person.userIds[0],
      tenantId: person.tenantIds[0],
      cell: 'local',
      designation: 'manager',
      role: 'manager',
      scope: 'team',
      deviceId: null,
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
    await world.directory.client.query(
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
    const outsider = await world.directory.tenant('Not Theirs');
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
    await world.directory.client.query(
      `update directory.memberships set status = 'inactive' where id = $1`,
      [deactivated.membershipIds[0]],
    );
    expect((await refresh(one.refreshToken)).json().error.code).toBe('SESSION_REVOKED');

    const revised = await member('Indus Inputs');
    const two = await signIn(revised.phone);
    await world.directory.client.query(
      `update directory.memberships set auth_revision = auth_revision + 1 where id = $1`,
      [revised.membershipIds[0]],
    );
    expect((await refresh(two.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
  });

  it('end when the refresh token expires', async () => {
    const person = await member('Jai Kisan');
    const session = await signIn(person.phone);
    await world.directory.client.query(
      `update directory.refresh_tokens set expires_at = now() - interval '1 second' where membership_id = $1`,
      [person.membershipIds[0]],
    );
    expect((await refresh(session.refreshToken)).json().error.code).toBe('SESSION_REVOKED');
  });
});

describe('cell routes', () => {
  it('need a valid access token for this cell', async () => {
    const keys = app.get(SigningKey);
    const person = await member('Lotus Agri');
    const claims = {
      userId: person.userIds[0]!,
      tenantId: person.tenantIds[0]!,
      cell: 'local',
      revision: 0,
    };

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
      { issuer: 'thelamp:directory', audience: 'thelamp:cell' },
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

describe('the web (spec 13.1)', () => {
  const web = { 'x-client': 'web' };
  const cookieOf = (response: { cookies: { name: string; value: string }[] }) =>
    response.cookies.find((cookie) => cookie.name === 'thelamp_refresh');

  it('keeps the refresh token in an httpOnly same-site cookie, never in a body', async () => {
    const person = await member('Lotus Web');
    await requestCode(person.phone);
    const verified = await app.inject({
      method: 'POST',
      url: '/auth/v1/otp/verify',
      headers: web,
      payload: { phone: person.phone, code: sender.lastCode(person.phone) },
      remoteAddress: newAddress(),
    });
    expect(verified.statusCode).toBe(200);
    expect(verified.json().session.refreshToken).toBeUndefined();
    const first = cookieOf(verified);
    // Path=/ for the `__Host-` prefix it takes in production (decision D101).
    expect(first).toMatchObject({ httpOnly: true, sameSite: 'Strict', path: '/' });

    // A reloaded page refreshes with the cookie, and learns its tenant again.
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/v1/token/refresh',
      headers: web,
      cookies: { thelamp_refresh: first!.value },
    });
    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json().tenant).toMatchObject({ id: person.tenantIds[0], name: 'Lotus Web' });
    expect(refreshed.json().session.refreshToken).toBeUndefined();
    const second = cookieOf(refreshed);
    expect(second!.value).not.toBe(first!.value);

    // Without the web header the cookie counts for nothing, so a forged request can't spend it.
    const forged = await app.inject({
      method: 'POST',
      url: '/auth/v1/token/refresh',
      cookies: { thelamp_refresh: second!.value },
    });
    expect(forged.statusCode).toBe(401);
    expect(forged.json().error.code).toBe('SESSION_REVOKED');

    const signedOut = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: web,
      cookies: { thelamp_refresh: second!.value },
    });
    expect(signedOut.statusCode).toBe(204);
    expect(cookieOf(signedOut)).toMatchObject({
      value: '',
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    });
    const after = await app.inject({
      method: 'POST',
      url: '/auth/v1/token/refresh',
      headers: web,
      cookies: { thelamp_refresh: second!.value },
    });
    expect(after.json().error.code).toBe('SESSION_REVOKED');
  });

  it('answers browsers from allowed origins only', async () => {
    const allowed = 'https://app.example.test';
    const corsApp = await startApp(testConfig({ CORS_ORIGINS: allowed }));
    try {
      const preflight = (origin: string) =>
        corsApp.inject({
          method: 'OPTIONS',
          url: '/auth/v1/token/refresh',
          headers: {
            origin,
            'access-control-request-method': 'POST',
            'access-control-request-headers': 'content-type,x-client',
          },
        });
      const ok = await preflight(allowed);
      expect(ok.headers['access-control-allow-origin']).toBe(allowed);
      expect(ok.headers['access-control-allow-credentials']).toBe('true');
      expect(String(ok.headers['access-control-allow-headers'])).toContain('x-client');
      const elsewhere = await preflight('https://elsewhere.example.test');
      expect(elsewhere.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await corsApp.close();
    }
  });
});

describe('app versions (M1, rule 8)', () => {
  it('turns away an app older than its platform minimum, before anything else', async () => {
    const gated = await startApp(testConfig({ MIN_APP_VERSION_ANDROID: '2.0.0' }));
    try {
      const ask = (headers: Record<string, string>) =>
        gated.inject({
          method: 'POST',
          url: '/auth/v1/otp/request',
          headers,
          payload: { phone: newPhone() },
          remoteAddress: newAddress(),
        });
      const old = await ask({ 'x-app-platform': 'android', 'x-app-version': '1.9.9' });
      expect(old.statusCode).toBe(426);
      expect(old.json().error.code).toBe('UPGRADE_REQUIRED');
      expect(
        (await ask({ 'x-app-platform': 'android', 'x-app-version': '2.0.0' })).statusCode,
      ).toBe(202);
      // iOS has no minimum here, and the web sends neither header.
      expect((await ask({ 'x-app-platform': 'ios', 'x-app-version': '1.0.0' })).statusCode).toBe(
        202,
      );
      expect((await ask({})).statusCode).toBe(202);

      // The version is checked before the access token, so the app shows its update screen.
      const signedIn = await gated.inject({
        method: 'GET',
        url: '/v1/me',
        headers: { 'x-app-platform': 'android', 'x-app-version': '1.0.0' },
      });
      expect(signedIn.json().error.code).toBe('UPGRADE_REQUIRED');
    } finally {
      await gated.close();
    }
  });
});
