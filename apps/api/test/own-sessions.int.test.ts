import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaffService } from '../src/modules/console/staff.service';
import { MemoryOtpSender, OtpSender } from '../src/modules/directory/otp-sender';
import { totpAt } from '../src/platform/totp';
import {
  newAddress,
  newDevice,
  newPhone,
  settledStep,
  startApp,
  testConfig,
  World,
} from './support';

/**
 * Sessions a person can see and end (ASVS V7.4.1, V7.4.5, V7.2.4 and V7.5.2, decision D101):
 * where they are signed in, ending one or all the others, access tokens refused as soon as their
 * session ends, a new web sign-in ending the one its cookie replaces, and an admin signing
 * everyone else out.
 */

let app: NestFastifyApplication;
let world: World;
const WEB = {
  'x-client': 'web',
  'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/141.0 Safari/537.36',
};

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const sender = () => app.get(OtpSender) as MemoryOtpSender;
const cookieOf = (response: { cookies: { name: string; value: string }[] }) =>
  response.cookies.find((cookie) => cookie.name === 'thelamp_refresh')?.value;

/** Signs in on the web, carrying an earlier session's cookie if given. */
async function webSignIn(phone: string, cookie?: string) {
  const address = newAddress();
  await app.inject({
    method: 'POST',
    url: '/auth/v1/otp/request',
    payload: { phone },
    remoteAddress: address,
  });
  const verified = await app.inject({
    method: 'POST',
    url: '/auth/v1/otp/verify',
    headers: WEB,
    payload: { phone, code: sender().lastCode(phone) },
    remoteAddress: address,
    ...(cookie ? { cookies: { thelamp_refresh: cookie } } : {}),
  });
  expect(verified.statusCode, verified.body).toBe(200);
  return { token: verified.json().session.accessToken as string, cookie: cookieOf(verified)! };
}

const as = (token: string, method: 'GET' | 'POST', url: string, headers = {}) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, ...headers },
    remoteAddress: newAddress(),
  });

const refreshWeb = (cookie: string) =>
  app.inject({
    method: 'POST',
    url: '/auth/v1/token/refresh',
    headers: WEB,
    cookies: { thelamp_refresh: cookie },
  });

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const adminPhone = newPhone();
  const admin = await world.user(tenantId, {
    phone: adminPhone,
    designation: 'head',
    role: 'tenant_admin',
  });
  const managerPhone = newPhone();
  const manager = await world.user(tenantId, { phone: managerPhone });
  return { tenantId, admin, adminPhone, manager, managerPhone };
}

describe('own sessions (D101)', () => {
  it('lists where a person is signed in, and ends another session at once', async () => {
    const o = await organisation('Many Places Co');
    const phone = await world.signIn(o.managerPhone, newDevice());
    const web = await webSignIn(o.managerPhone);

    const listed = await as(web.token, 'GET', '/auth/v1/sessions');
    expect(listed.statusCode, listed.body).toBe(200);
    const items = listed.json().items as { id: string; kind: string; current: boolean }[];
    expect(items.map((item) => [item.kind, item.current]).sort()).toEqual([
      ['phone', false],
      ['web', true],
    ]);
    expect(items.find((item) => item.current)).toMatchObject({
      agent: WEB['user-agent'],
      ip: expect.any(String),
    });

    // Ending the phone's session refuses its access token now, not in 15 minutes.
    expect((await as(phone.accessToken, 'GET', '/v1/me')).statusCode).toBe(200);
    const phoneSession = items.find((item) => item.kind === 'phone')!;
    const ended = await as(web.token, 'POST', `/auth/v1/sessions/${phoneSession.id}/end`);
    expect(ended.statusCode, ended.body).toBe(204);
    expect((await as(phone.accessToken, 'GET', '/v1/me')).json().error.code).toBe(
      'SESSION_REVOKED',
    );
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/v1/token/refresh',
      payload: { refreshToken: phone.refreshToken },
    });
    expect(refreshed.json().error.code).toBe('SESSION_REVOKED');
    // Ended already, and nobody else's to end.
    expect(
      (await as(web.token, 'POST', `/auth/v1/sessions/${phoneSession.id}/end`)).json().error.code,
    ).toBe('NOT_FOUND');
    const stranger = await world.signIn(o.adminPhone);
    const current = items.find((item) => item.current)!;
    expect(
      (await as(stranger.accessToken, 'POST', `/auth/v1/sessions/${current.id}/end`)).json().error
        .code,
    ).toBe('NOT_FOUND');
  });

  it('ends every other session, and refuses a signed-out session’s access token', async () => {
    const o = await organisation('Everywhere Else Co');
    // Two sessions on the one phone bound to them.
    const device = newDevice();
    const first = await world.signIn(o.managerPhone, device);
    const second = await world.signIn(o.managerPhone, device);
    const web = await webSignIn(o.managerPhone);
    expect((await as(web.token, 'POST', '/auth/v1/sessions/end-others')).statusCode).toBe(204);
    for (const phone of [first, second]) {
      expect((await as(phone.accessToken, 'GET', '/v1/me')).json().error.code).toBe(
        'SESSION_REVOKED',
      );
    }
    expect((await as(web.token, 'GET', '/v1/me')).statusCode).toBe(200);
    expect((await as(web.token, 'GET', '/auth/v1/sessions')).json().items).toHaveLength(1);

    // Signing out refuses the access token at once too.
    const out = await app.inject({
      method: 'POST',
      url: '/auth/v1/logout',
      headers: WEB,
      cookies: { thelamp_refresh: web.cookie },
    });
    expect(out.statusCode).toBe(204);
    expect((await as(web.token, 'GET', '/v1/me')).json().error.code).toBe('SESSION_REVOKED');
  });

  it('ends the session whose cookie a new web sign-in replaces, but not on a refresh', async () => {
    const o = await organisation('Same Browser Co');
    const before = await webSignIn(o.managerPhone);
    // A refresh replaces the cookie within the same session, which goes on.
    const refreshed = await refreshWeb(before.cookie);
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const kept = cookieOf(refreshed)!;
    expect((await as(before.token, 'GET', '/v1/me')).statusCode).toBe(200);

    // A new sign-in in the same browser ends the session it replaces.
    const after = await webSignIn(o.managerPhone, kept);
    expect((await refreshWeb(kept)).json().error.code).toBe('SESSION_REVOKED');
    expect((await as(before.token, 'GET', '/v1/me')).json().error.code).toBe('SESSION_REVOKED');
    expect((await refreshWeb(after.cookie)).statusCode).toBe(200);
  });

  it('lets an admin sign everyone else out, and nobody whose scope is narrower', async () => {
    const o = await organisation('Everyone Out Co');
    const admin = await world.signIn(o.adminPhone);
    const manager = await world.signIn(o.managerPhone, newDevice());
    const refused = await as(manager.accessToken, 'POST', '/v1/users/sign-out-everyone', {
      'idempotency-key': newId(),
    });
    expect(refused.statusCode).toBe(403);

    const done = await as(admin.accessToken, 'POST', '/v1/users/sign-out-everyone', {
      'idempotency-key': newId(),
    });
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json().people).toBeGreaterThanOrEqual(1);
    expect((await as(manager.accessToken, 'GET', '/v1/me')).json().error.code).toBe(
      'SESSION_REVOKED',
    );
    expect((await as(admin.accessToken, 'GET', '/v1/me')).statusCode).toBe(200);
  });
});

describe('console sessions (D101)', () => {
  it('refuses a staff member’s access token as soon as they sign out', async () => {
    const email = `out-${newId().slice(-8)}@vendor.example`;
    const { setupUrl } = await app
      .get(StaffService)
      .invite({ id: newId(), email, name: 'Kavya Pillai', role: 'support' }, null);
    const token = setupUrl.split('#')[1]!;
    const post = (url: string, payload: object, cookie?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload,
        remoteAddress: newAddress(),
        headers: { 'x-client': 'console' },
        ...(cookie ? { cookies: { thelamp_console: cookie } } : {}),
      });
    const { secret } = (
      await post('/platform/v1/setup', { token, password: 'a long vendor passphrase' })
    ).json();
    await post('/platform/v1/setup/confirm', {
      token,
      code: totpAt(secret, (await settledStep()) - 1),
    });
    const signedIn = await post('/platform/v1/session', {
      email,
      password: 'a long vendor passphrase',
      code: totpAt(secret, await settledStep()),
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const access = signedIn.json().accessToken as string;
    const cookie = signedIn.cookies.find((each) => each.name === 'thelamp_console')!.value;
    expect((await as(access, 'GET', '/platform/v1/me')).statusCode).toBe(200);
    expect((await post('/platform/v1/session/logout', {}, cookie)).statusCode).toBe(204);
    expect((await as(access, 'GET', '/platform/v1/me')).json().error.code).toBe('SESSION_REVOKED');
  });
});
