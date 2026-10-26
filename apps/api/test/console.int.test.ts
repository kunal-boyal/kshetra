import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, type PlatformRoleKey } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { STAFF_LIMITS, StaffService } from '../src/modules/console/staff.service';
import { hashPassword } from '../src/platform/passwords';
import { RedisClient } from '../src/platform/redis';
import { totpAt, totpStep } from '../src/platform/totp';
import { newPhone, startApp, testConfig, World } from './support';

/**
 * The platform console's API (module M22, decision D88): vendor staff set up from an invitation,
 * sign in with email, password and an authenticator code, and create, suspend and reactivate
 * tenants. Staff and tenant tokens never cross.
 */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig());
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const PASSWORD = 'a long staff password';
const CONSOLE = { 'x-client': 'console' };

/** Each request from its own address, so the per-address sign-in limits stay out of the way. */
const anyAddress = () =>
  `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

function send(
  method: 'GET' | 'POST',
  url: string,
  options: { token?: string; body?: object; headers?: Record<string, string> } = {},
) {
  return app.inject({
    method,
    url,
    remoteAddress: anyAddress(),
    headers: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...options.headers,
    },
    ...(options.body ? { payload: options.body } : {}),
  });
}

/** The code an authenticator shows now. */
const code = (secret: string) => totpAt(secret, totpStep());

/** Clears an email's sign-in limit, so a test can go on trying after ten. */
const forgetEmailLimit = (email: string) =>
  app
    .get(RedisClient)
    .redis.del(
      `rl:${STAFF_LIMITS.signInsPerEmail.name}:${createHash('sha256').update(email.toLowerCase()).digest('hex').slice(0, 32)}`,
    );

/** Forgets the last code used, as the clock moving on would, so a test can sign in again. */
const forgetLastCode = (email: string) =>
  world.directory.client.query(
    'update directory.platform_users set totp_last_step = null where lower(email) = lower($1)',
    [email],
  );

/** A staff member invited, set up and signed in, with their secret for later codes. */
async function staffMember(role: PlatformRoleKey = 'platform_admin') {
  const email = `staff-${newId().slice(-8)}@vendor.example`;
  const { setupUrl } = await app
    .get(StaffService)
    .invite({ id: newId(), email, name: 'Meera Iyer', role }, null);
  const token = setupUrl.split('#')[1]!;
  const setUp = await send('POST', '/platform/v1/setup', { body: { token, password: PASSWORD } });
  expect(setUp.statusCode, setUp.body).toBe(200);
  const { secret } = setUp.json();
  const confirmed = await send('POST', '/platform/v1/setup/confirm', {
    body: { token, code: code(secret) },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  await forgetLastCode(email);
  const signedIn = await send('POST', '/platform/v1/session', {
    body: { email, password: PASSWORD, code: code(secret) },
  });
  expect(signedIn.statusCode, signedIn.body).toBe(200);
  return { email, secret, token: signedIn.json().accessToken as string, signedIn };
}

describe('vendor staff (decision D88)', () => {
  it('sets up from an invitation once, with a password and an authenticator', async () => {
    const email = `new-${newId().slice(-8)}@vendor.example`;
    const { staff, setupUrl } = await app
      .get(StaffService)
      .invite({ id: newId(), email, name: 'Ravi Shah', role: 'support' }, null);
    expect(staff).toMatchObject({ status: 'invited', permissions: ['platform.support.request'] });
    expect(setupUrl).toMatch(/^http:\/\/127\.0\.0\.1:5174\/setup#[\w-]{40,}$/);
    const token = setupUrl.split('#')[1]!;

    const short = await send('POST', '/platform/v1/setup', { body: { token, password: 'short' } });
    expect(short.json().error.code).toBe('VALIDATION');
    // Nor one known from a breach, nor one built on the person's or the product's name (D101).
    const breached = await send('POST', '/platform/v1/setup', {
      body: { token, password: 'password1234' },
    });
    expect(breached.json().error.details).toEqual([
      { path: 'password', issue: 'This password is known from a data breach; choose another' },
    ]);
    for (const password of ['ravi shah setting up', 'my own The Lamp password']) {
      const named = await send('POST', '/platform/v1/setup', { body: { token, password } });
      expect(named.json().error.details).toEqual([
        { path: 'password', issue: 'Leave out your name, your email and the product’s name' },
      ]);
    }
    const setUp = await send('POST', '/platform/v1/setup', { body: { token, password: PASSWORD } });
    const { secret, uri } = setUp.json();
    expect(uri).toContain(`secret=${secret}`);
    const wrong = await send('POST', '/platform/v1/setup/confirm', {
      body: { token, code: code(secret) === '000000' ? '111111' : '000000' },
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'code', issue: 'That code is not right; check the time on your phone' },
    ]);
    const confirmed = await send('POST', '/platform/v1/setup/confirm', {
      body: { token, code: code(secret) },
    });
    expect(confirmed.json()).toMatchObject({ email, status: 'active' });

    // The link is spent.
    const again = await send('POST', '/platform/v1/setup', { body: { token, password: PASSWORD } });
    expect(again.statusCode).toBe(401);
    // The seed is sealed in its column, never kept as it is.
    const { rows } = await world.directory.client.query(
      'select totp_secret, password_hash from directory.platform_users where email = $1',
      [email],
    );
    expect(rows[0].totp_secret).toMatch(/^v1:/);
    expect(rows[0].totp_secret).not.toContain(secret);
    expect(rows[0].password_hash).toMatch(/^scrypt\$/);
  });

  it('signs in with all three, refuses a used code, refreshes by cookie and signs out', async () => {
    const { email, secret, token, signedIn } = await staffMember();
    expect(signedIn.json().staff).toMatchObject({ email, role: 'platform_admin' });
    const cookie = signedIn.cookies.find((each) => each.name === 'thelamp_console')!;
    expect(cookie).toMatchObject({
      httpOnly: true,
      sameSite: 'Strict',
      path: '/',
    });
    expect((await send('GET', '/platform/v1/me', { token })).json()).toMatchObject({ email });

    // The code just used doesn't work twice, and a wrong part answers the same as any other.
    const replay = await send('POST', '/platform/v1/session', {
      body: { email, password: PASSWORD, code: code(secret) },
    });
    expect(replay.json().error.code).toBe('UNAUTHENTICATED');
    const badPassword = await send('POST', '/platform/v1/session', {
      body: { email, password: 'not the password', code: code(secret) },
    });
    const nobody = await send('POST', '/platform/v1/session', {
      body: { email: 'nobody@vendor.example', password: PASSWORD, code: code(secret) },
    });
    const withoutId = (reply: typeof badPassword) => ({
      ...reply.json().error,
      requestId: undefined,
    });
    expect(withoutId(badPassword)).toEqual(withoutId(nobody));

    // The cookie works only from the console, and once.
    const withoutHeader = await send('POST', '/platform/v1/session/refresh', {
      headers: { cookie: `thelamp_console=${cookie.value}` },
    });
    expect(withoutHeader.json().error.code).toBe('SESSION_REVOKED');
    const refreshed = await send('POST', '/platform/v1/session/refresh', {
      headers: { ...CONSOLE, cookie: `thelamp_console=${cookie.value}` },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const next = refreshed.cookies.find((each) => each.name === 'thelamp_console')!;
    expect(next.value).not.toBe(cookie.value);
    const reused = await send('POST', '/platform/v1/session/refresh', {
      headers: { ...CONSOLE, cookie: `thelamp_console=${cookie.value}` },
    });
    expect(reused.json().error.code).toBe('SESSION_REVOKED');
    // Reusing a spent cookie ended the family, the new one included.
    const after = await send('POST', '/platform/v1/session/refresh', {
      headers: { ...CONSOLE, cookie: `thelamp_console=${next.value}` },
    });
    expect(after.json().error.code).toBe('SESSION_REVOKED');
  });

  it('locks an account after ten wrong tries, answering as wrong details do (D101)', async () => {
    const { email, secret } = await staffMember();
    await forgetEmailLimit(email);
    for (let attempt = 0; attempt < 10; attempt++) {
      const reply = await send('POST', '/platform/v1/session', {
        body: { email, password: 'wrong password!', code: '123456' },
      });
      expect(reply.json().error.code).toBe('UNAUTHENTICATED');
    }
    const locked = await world.directory.client.query(
      'select locked_until from directory.platform_users where email = $1',
      [email],
    );
    expect(locked.rows[0].locked_until).not.toBeNull();

    // The right details answer as an unknown email does, so the lock says nothing.
    await forgetEmailLimit(email);
    await forgetLastCode(email);
    const right = await send('POST', '/platform/v1/session', {
      body: { email, password: PASSWORD, code: code(secret) },
    });
    const nobody = await send('POST', '/platform/v1/session', {
      body: { email: 'nobody@vendor.example', password: PASSWORD, code: code(secret) },
    });
    expect({ ...right.json().error, requestId: undefined }).toEqual({
      ...nobody.json().error,
      requestId: undefined,
    });
    // Once the lock ends, they sign in.
    await world.directory.client.query(
      `update directory.platform_users set locked_until = now() - interval '1 second' where email = $1`,
      [email],
    );
    const after = await send('POST', '/platform/v1/session', {
      body: { email, password: PASSWORD, code: code(secret) },
    });
    expect(after.statusCode, after.body).toBe(200);
  });

  it('remakes a password hash made at an older cost when its owner signs in (D101)', async () => {
    const { email, secret } = await staffMember();
    await world.directory.client.query(
      'update directory.platform_users set password_hash = $2 where email = $1',
      [email, await hashPassword(PASSWORD, { log2N: 15, r: 8, p: 1, keyLength: 32 })],
    );
    await forgetLastCode(email);
    const signedIn = await send('POST', '/platform/v1/session', {
      body: { email, password: PASSWORD, code: code(secret) },
    });
    expect(signedIn.statusCode, signedIn.body).toBe(200);
    const { rows } = await world.directory.client.query(
      'select password_hash from directory.platform_users where email = $1',
      [email],
    );
    expect(rows[0].password_hash).toMatch(/^scrypt\$15\$8\$3\$/);
  });

  it('changes a password with the current one and a fresh code, ending the sessions (D101)', async () => {
    const member = await staffMember();
    const change = (body: object) =>
      send('POST', '/platform/v1/me/password', { token: member.token, body });
    const NEW = 'a quiet orange tractor';
    await forgetLastCode(member.email);
    const wrong = await change({
      currentPassword: 'not the password',
      newPassword: NEW,
      code: code(member.secret),
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'currentPassword', issue: 'Check your current password and authenticator code' },
    ]);
    const breached = await change({
      currentPassword: PASSWORD,
      newPassword: 'correct horse battery staple',
      code: code(member.secret),
    });
    expect(breached.json().error.details).toEqual([
      { path: 'newPassword', issue: 'This password is known from a data breach; choose another' },
    ]);
    const named = await change({
      currentPassword: PASSWORD,
      newPassword: 'meera keeps the keys',
      code: code(member.secret),
    });
    expect(named.json().error.details).toEqual([
      { path: 'newPassword', issue: 'Leave out your name, your email and the product’s name' },
    ]);
    const same = await change({
      currentPassword: PASSWORD,
      newPassword: PASSWORD,
      code: code(member.secret),
    });
    expect(same.json().error.details).toEqual([
      { path: 'newPassword', issue: 'Choose a password other than your current one' },
    ]);

    const changed = await change({
      currentPassword: PASSWORD,
      newPassword: NEW,
      code: code(member.secret),
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.headers['cache-control']).toBe('no-store');
    expect(changed.cookies.find((each) => each.name === 'thelamp_console')).toBeDefined();
    // The old access token and session cookie are done; the new token works.
    expect((await send('GET', '/platform/v1/me', { token: member.token })).json().error.code).toBe(
      'SESSION_REVOKED',
    );
    const oldCookie = member.signedIn.cookies.find((each) => each.name === 'thelamp_console')!;
    const refreshed = await send('POST', '/platform/v1/session/refresh', {
      headers: { ...CONSOLE, cookie: `thelamp_console=${oldCookie.value}` },
    });
    expect(refreshed.json().error.code).toBe('SESSION_REVOKED');
    const token = changed.json().accessToken as string;
    expect((await send('GET', '/platform/v1/me', { token })).statusCode).toBe(200);

    // Only the new password signs in now.
    await forgetLastCode(member.email);
    const old = await send('POST', '/platform/v1/session', {
      body: { email: member.email, password: PASSWORD, code: code(member.secret) },
    });
    expect(old.json().error.code).toBe('UNAUTHENTICATED');
    const fresh = await send('POST', '/platform/v1/session', {
      body: { email: member.email, password: NEW, code: code(member.secret) },
    });
    expect(fresh.statusCode, fresh.body).toBe(200);
  });

  it('lets an admin reset someone’s sign-in with a new setup link, never their own (D101)', async () => {
    const admin = await staffMember();
    const other = await staffMember('support');
    const adminId = (await send('GET', '/platform/v1/me', { token: admin.token })).json().id;
    const otherId = (await send('GET', '/platform/v1/me', { token: other.token })).json().id;
    expect(
      (await send('POST', `/platform/v1/staff/${otherId}/reset`, { token: other.token }))
        .statusCode,
    ).toBe(403);
    const own = await send('POST', `/platform/v1/staff/${adminId}/reset`, { token: admin.token });
    expect(own.json().error.code).toBe('FORBIDDEN');

    const reset = await send('POST', `/platform/v1/staff/${otherId}/reset`, {
      token: admin.token,
    });
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.headers['cache-control']).toBe('no-store');
    expect(reset.json().staff).toMatchObject({ id: otherId, status: 'invited' });
    // Their session ended, and the old password and authenticator sign in no more.
    expect((await send('GET', '/platform/v1/me', { token: other.token })).json().error.code).toBe(
      'SESSION_REVOKED',
    );
    await forgetLastCode(other.email);
    const old = await send('POST', '/platform/v1/session', {
      body: { email: other.email, password: PASSWORD, code: code(other.secret) },
    });
    expect(old.json().error.code).toBe('UNAUTHENTICATED');

    // The new link sets both up again.
    const token = (reset.json().setupUrl as string).split('#')[1]!;
    const setUp = await send('POST', '/platform/v1/setup', {
      body: { token, password: 'another long passphrase' },
    });
    expect(setUp.statusCode, setUp.body).toBe(200);
    const confirmed = await send('POST', '/platform/v1/setup/confirm', {
      body: { token, code: code(setUp.json().secret) },
    });
    expect(confirmed.json()).toMatchObject({ id: otherId, status: 'active' });
  });

  it('lets platform admins invite and disable staff, whose sessions end at once', async () => {
    const admin = await staffMember();
    const support = await staffMember('support');
    // Support may look at tenants, not manage them or staff.
    expect((await send('GET', '/platform/v1/tenants', { token: support.token })).statusCode).toBe(
      200,
    );
    expect((await send('GET', '/platform/v1/staff', { token: support.token })).statusCode).toBe(
      403,
    );
    const invited = await send('POST', '/platform/v1/staff', {
      token: admin.token,
      body: {
        id: newId(),
        email: `fin-${newId().slice(-6)}@vendor.example`,
        name: 'Asha Rao',
        role: 'finance',
      },
    });
    expect(invited.statusCode, invited.body).toBe(201);
    expect(invited.json().setupUrl).toContain('/setup#');
    const list = (await send('GET', '/platform/v1/staff', { token: admin.token })).json().items;
    expect(list.map((each: { email: string }) => each.email)).toContain(support.email);

    const supportId = (await send('GET', '/platform/v1/me', { token: support.token })).json().id;
    const self = (await send('GET', '/platform/v1/me', { token: admin.token })).json().id;
    expect(
      (await send('POST', `/platform/v1/staff/${self}/disable`, { token: admin.token })).statusCode,
    ).toBe(403);
    const disabled = await send('POST', `/platform/v1/staff/${supportId}/disable`, {
      token: admin.token,
    });
    expect(disabled.json().status).toBe('disabled');
    expect(
      (await send('GET', '/platform/v1/tenants', { token: support.token })).json().error.code,
    ).toBe('SESSION_REVOKED');
  });

  it('never lets a tenant user’s token into the console, nor a staff token into a tenant', async () => {
    const { token } = await staffMember();
    const tenantId = await world.tenant('Crossing Co');
    const phone = newPhone();
    await world.user(tenantId, { phone, role: 'tenant_admin' });
    const tenantToken = (await world.signIn(phone)).accessToken;
    expect(
      (await send('GET', '/platform/v1/tenants', { token: tenantToken })).json().error.code,
    ).toBe('UNAUTHENTICATED');
    expect((await send('GET', '/v1/me', { token })).json().error.code).toBe('UNAUTHENTICATED');
  });
});

describe('tenants in the console (M22)', () => {
  it('creates a tenant once from a template, and suspends and reactivates it', async () => {
    const { token } = await staffMember();
    const templates = (await send('GET', '/platform/v1/templates', { token })).json().items;
    expect(templates.map((each: { key: string }) => each.key)).toEqual(
      expect.arrayContaining(['agri', 'generic']),
    );
    const cells = (await send('GET', '/platform/v1/cells', { token })).json().items;
    expect(cells).toContainEqual(expect.objectContaining({ name: 'local', kind: 'shared' }));
    // Every tenant so far lives in the local cell.
    const local = cells.find((cell: { name: string }) => cell.name === 'local');
    const counted = await world.directory.client.query(
      `select count(*)::int as n from directory.tenants t join directory.cells c on c.id = t.cell_id where c.name = 'local'`,
    );
    expect(local.tenants).toBe(counted.rows[0].n);

    const phone = newPhone();
    const slug = `console-${newId().slice(-8)}`;
    const body = {
      id: newId(),
      name: 'Console Agro',
      slug,
      template: 'agri',
      status: 'trial',
      trialDays: 14,
      admin: { name: 'Kiran Patil', phone },
    };
    const created = await send('POST', '/platform/v1/tenants', { token, body });
    expect(created.statusCode, created.body).toBe(201);
    expect(created.json()).toMatchObject({
      id: body.id,
      slug,
      status: 'trial',
      template: { key: 'agri' },
      cell: { name: 'local' },
      activeUsers: 1,
    });
    const trialDays = (Date.parse(created.json().trialEndsAt) - Date.now()) / 86_400_000;
    expect(Math.round(trialDays)).toBe(14);
    // The same create again answers with the same tenant; another under its ID is refused.
    expect((await send('POST', '/platform/v1/tenants', { token, body })).json().id).toBe(body.id);
    const clash = await send('POST', '/platform/v1/tenants', {
      token,
      body: { ...body, slug: `${slug}-x` },
    });
    expect(clash.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
    const found = (await send('GET', `/platform/v1/tenants?q=${slug}`, { token })).json();
    expect(found.items.map((each: { id: string }) => each.id)).toEqual([body.id]);

    // Its first admin signs in, and is shut out while it is suspended.
    const admin = (await world.signIn(phone)).accessToken;
    expect((await send('GET', '/v1/me', { token: admin })).statusCode).toBe(200);
    const suspended = await send('POST', `/platform/v1/tenants/${body.id}/suspend`, {
      token,
      body: { reason: 'Unpaid for two months' },
    });
    expect(suspended.json().status).toBe('suspended');
    expect((await send('GET', '/v1/me', { token: admin })).json().error.code).toBe(
      'TENANT_SUSPENDED',
    );
    const reactivated = await send('POST', `/platform/v1/tenants/${body.id}/reactivate`, { token });
    expect(reactivated.json().status).toBe('trial');
    expect((await send('GET', '/v1/me', { token: admin })).statusCode).toBe(200);
    const twice = await send('POST', `/platform/v1/tenants/${body.id}/reactivate`, { token });
    expect(twice.json().error.code).toBe('CONFLICT');

    // Each change is in the platform audit, with who made it.
    const { rows } = await world.directory.client.query(
      `select action, detail from directory.platform_audit where target_id = $1 order by at`,
      [body.id],
    );
    expect(rows.map((row: { action: string }) => row.action)).toEqual([
      'tenant.created',
      'tenant.suspended',
      'tenant.reactivated',
    ]);
    expect(rows[1].detail).toMatchObject({ reason: 'Unpaid for two months', after: 'suspended' });
  });

  it('keeps tenant management from staff without it', async () => {
    const support = await staffMember('support');
    const refused = await send('POST', '/platform/v1/tenants', {
      token: support.token,
      body: {
        id: newId(),
        name: 'Nope Co',
        slug: `nope-${newId().slice(-8)}`,
        template: 'generic',
        admin: { name: 'No One', phone: newPhone() },
      },
    });
    expect(refused.statusCode).toBe(403);
  });
});
