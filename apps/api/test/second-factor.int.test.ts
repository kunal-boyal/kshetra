import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, normalisePhone } from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tenants } from '../src/db/schema/directory';
import { StaffService } from '../src/modules/console/staff.service';
import { DirectoryDatabase } from '../src/modules/directory/directory.database';
import { digest } from '../src/modules/directory/secrets';
import { totpAt, totpStep } from '../src/platform/totp';
import { newDevice, newPhone, settledStep, startApp, testConfig, World } from './support';

/**
 * The second factor of web sign-in (spec M1, decision D91): anyone whose role can change access
 * sets up an authenticator at their first web sign-in and gives its code each time after; phones,
 * other roles and demo tenants sign straight in. Admins and vendor support reset it.
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

/** Marks a request as the web portal's, whose refresh token goes in a cookie. */
const WEB_HEADERS = { 'x-client': 'web' };

const address = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.9`;

function post(url: string, payload: object, headers: Record<string, string> = {}) {
  return app.inject({ method: 'POST', url, payload, remoteAddress: address(), headers });
}

function asUser(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: address(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

/** A tenant with an admin and a manager, each with their own number. */
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

/** A web sign-in up to the authenticator step. */
async function challenge(phone: string) {
  const response = await world.verify(phone);
  expect(response.json()).toMatchObject({ status: 'second_factor' });
  return response.json() as { ticket: string; enrolled: boolean; tenant: { name: string } };
}

describe('setting up and using an authenticator (D91)', () => {
  it('sets one up at the first web sign-in, with recovery codes, then asks for it each time', async () => {
    const o = await organisation('Careful Co');
    const first = await challenge(o.adminPhone);
    expect(first).toMatchObject({ enrolled: false, tenant: { name: 'Careful Co' } });
    const setUp = await post('/auth/v1/totp/setup', { ticket: first.ticket });
    expect(setUp.statusCode, setUp.body).toBe(200);
    const { secret, uri } = setUp.json();
    expect(uri).toMatch(/^otpauth:\/\/totp\//);
    // Masked: only the last five digits show, the rest as bullets.
    expect(decodeURIComponent(uri)).not.toContain(o.adminPhone.slice(-6));

    const wrong = await post('/auth/v1/totp/verify', { ticket: first.ticket, code: '000000' });
    expect(wrong.json().error.code).toBe('OTP_INVALID');
    // The step before now first, so this step's code is left for the next sign-in.
    const step = (await settledStep()) - 1;
    const done = await post(
      '/auth/v1/totp/verify',
      { ticket: first.ticket, code: totpAt(secret, step) },
      WEB_HEADERS,
    );
    expect(done.statusCode, done.body).toBe(200);
    expect(done.json()).toMatchObject({ status: 'signed_in', tenant: { name: 'Careful Co' } });
    const codes = done.json().recoveryCodes as string[];
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    // The web never sees its refresh token; it goes in the cookie.
    expect(done.json().session.refreshToken).toBeUndefined();
    expect(done.headers['set-cookie']).toBeDefined();
    // The ticket is spent.
    expect(
      (await post('/auth/v1/totp/verify', { ticket: first.ticket, code: '123456' })).json().error
        .code,
    ).toBe('OTP_EXPIRED');

    // Next time: no new secret, and no code twice.
    const second = await challenge(o.adminPhone);
    expect(second.enrolled).toBe(true);
    expect((await post('/auth/v1/totp/setup', { ticket: second.ticket })).json().error.code).toBe(
      'CONFLICT',
    );
    const again = await post('/auth/v1/totp/verify', {
      ticket: second.ticket,
      code: totpAt(secret, step),
    });
    expect(again.json().error.code).toBe('OTP_INVALID');
    const next = await post('/auth/v1/totp/verify', {
      ticket: second.ticket,
      code: totpAt(secret, step + 1),
    });
    expect(next.json()).toMatchObject({ status: 'signed_in' });
    expect(next.json().recoveryCodes).toBeUndefined();

    // A recovery code works once.
    const third = await challenge(o.adminPhone);
    const recovered = await post('/auth/v1/totp/verify', {
      ticket: third.ticket,
      recoveryCode: codes[0]!.toLowerCase(),
    });
    expect(recovered.json()).toMatchObject({ status: 'signed_in' });
    // Recovery codes are kept only as salted scrypt hashes, one fewer now.
    const { rows } = await world.directory.client.query(
      `select recovery_hashes from directory.totp_secrets
        where identity_id = (select id from directory.identities where phone_e164 = $1)`,
      [normalisePhone(o.adminPhone)],
    );
    expect(rows[0].recovery_hashes).toHaveLength(9);
    for (const hash of rows[0].recovery_hashes) expect(hash).toMatch(/^scrypt\$14\$8\$1\$/);
    const fourth = await challenge(o.adminPhone);
    const reused = await post('/auth/v1/totp/verify', {
      ticket: fourth.ticket,
      recoveryCode: codes[0],
    });
    expect(reused.json().error.code).toBe('OTP_INVALID');

    // A code handed out before decision D101, kept as a plain digest, still works once.
    await world.directory.client.query(
      `update directory.totp_secrets set recovery_hashes = array[$2]
        where identity_id = (select id from directory.identities where phone_e164 = $1)`,
      [normalisePhone(o.adminPhone), digest('ABCDE23456')],
    );
    const fifth = await challenge(o.adminPhone);
    const legacy = await post('/auth/v1/totp/verify', {
      ticket: fifth.ticket,
      recoveryCode: 'abcde-23456',
    });
    expect(legacy.json()).toMatchObject({ status: 'signed_in' });
  });

  it('ends a sign-in after five wrong codes', async () => {
    const o = await organisation('Guessing Co');
    const first = await challenge(o.adminPhone);
    await post('/auth/v1/totp/setup', { ticket: first.ticket });
    for (let attempt = 0; attempt < 5; attempt++) {
      const wrong = await post('/auth/v1/totp/verify', { ticket: first.ticket, code: '000000' });
      expect(wrong.json().error.code).toBe('OTP_INVALID');
    }
    const sixth = await post('/auth/v1/totp/verify', { ticket: first.ticket, code: '000000' });
    expect(sixth.json().error.code).toBe('OTP_EXPIRED');
    expect((await post('/auth/v1/totp/setup', { ticket: first.ticket })).json().error.code).toBe(
      'OTP_EXPIRED',
    );
  });

  it('leaves phones, other roles and demo tenants to sign straight in', async () => {
    const o = await organisation('Plain Co');
    const phone = await world.verify(o.adminPhone, newDevice());
    expect(phone.json().status).toBe('signed_in');
    expect((await world.verify(o.managerPhone)).json().status).toBe('signed_in');

    const demo = await organisation('Showcase Co');
    await app
      .get(DirectoryDatabase)
      .db.update(tenants)
      .set({ demo: true })
      .where(eq(tenants.id, demo.tenantId));
    expect((await world.verify(demo.adminPhone)).json().status).toBe('signed_in');
  });
});

describe('resetting an authenticator (D91)', () => {
  it('lets another admin reset it, ending the person’s sessions; nobody resets their own', async () => {
    const o = await organisation('Reset Co');
    const otherPhone = newPhone();
    const other = await world.user(o.tenantId, {
      phone: otherPhone,
      designation: 'head',
      role: 'tenant_admin',
    });
    const mine = await world.signIn(o.adminPhone);
    const theirs = await world.signIn(otherPhone);
    expect(
      (await asUser('GET', `/v1/users/${other.id}/second-factor`, mine.accessToken)).json(),
    ).toEqual({ required: true, enrolled: true });
    expect(
      (await asUser('GET', `/v1/users/${o.manager.id}/second-factor`, mine.accessToken)).json(),
    ).toEqual({ required: false, enrolled: false });

    // Resetting one needs a fresh code from one's own (D101).
    const unproved = await asUser(
      'POST',
      `/v1/users/${other.id}/second-factor/reset`,
      mine.accessToken,
    );
    expect(unproved.json().error.code).toBe('SECOND_FACTOR_REQUIRED');
    const stepped = await world.stepUp(o.adminPhone, mine.accessToken);
    const own = await asUser('POST', `/v1/users/${o.admin.id}/second-factor/reset`, stepped);
    expect(own.json().error.code).toBe('FORBIDDEN');
    const reset = await asUser('POST', `/v1/users/${other.id}/second-factor/reset`, stepped);
    expect(reset.statusCode, reset.body).toBe(204);
    expect((await asUser('GET', '/v1/me', theirs.accessToken)).json().error.code).toBe(
      'SESSION_REVOKED',
    );
    expect((await challenge(otherPhone)).enrolled).toBe(false);

    // A manager without user.manage can't see or reset it.
    const managing = await world.signIn(o.managerPhone);
    expect(
      (await asUser('GET', `/v1/users/${other.id}/second-factor`, managing.accessToken)).json()
        .error.code,
    ).toBe('FORBIDDEN');
  });

  it('lets vendor support reset it by the person’s number', async () => {
    const o = await organisation('Lone Admin Co');
    await world.signIn(o.adminPhone);
    const staff = await staffToken();
    const reset = await asUser(
      'POST',
      `/platform/v1/tenants/${o.tenantId}/second-factor-resets`,
      staff,
      { phone: o.adminPhone, reason: 'Lost their phone; called from the registered number' },
    );
    expect(reset.statusCode, reset.body).toBe(200);
    expect(reset.json()).toEqual({ removed: true });
    expect((await challenge(o.adminPhone)).enrolled).toBe(false);
    const nobody = await asUser(
      'POST',
      `/platform/v1/tenants/${o.tenantId}/second-factor-resets`,
      staff,
      { phone: newPhone(), reason: 'Checking' },
    );
    expect(nobody.json().error.details).toEqual([
      { path: 'phone', issue: 'Nobody in this tenant has this number' },
    ]);
  });
});

async function staffToken(): Promise<string> {
  const email = `support-${newId().slice(-8)}@vendor.example`;
  const { setupUrl } = await app
    .get(StaffService)
    .invite({ id: newId(), email, name: 'Support Person', role: 'support' }, null);
  const token = setupUrl.split('#')[1]!;
  const { secret } = (
    await post('/platform/v1/setup', { token, password: 'a long staff password' })
  ).json();
  await post('/platform/v1/setup/confirm', {
    token,
    code: totpAt(secret, (await settledStep()) - 1),
  });
  const signedIn = await post('/platform/v1/session', {
    email,
    password: 'a long staff password',
    code: totpAt(secret, totpStep()),
  });
  return signedIn.json().accessToken;
}

describe('an authenticator for anyone, and changing access only on the web (D101)', () => {
  it('lets anyone set one up from their account, which the web then asks for', async () => {
    const o = await organisation('Opt-in Co');
    const token = (await world.signIn(o.managerPhone)).accessToken;
    expect((await asUser('GET', '/auth/v1/authenticator', token)).json()).toEqual({
      enrolled: false,
      required: false,
    });
    const setUp = await asUser('POST', '/auth/v1/authenticator/setup', token);
    expect(setUp.statusCode, setUp.body).toBe(200);
    const { secret } = setUp.json();
    const wrong = await asUser('POST', '/auth/v1/authenticator/confirm', token, { code: '000000' });
    expect(wrong.json().error.code).toBe('OTP_INVALID');
    const confirmed = await asUser('POST', '/auth/v1/authenticator/confirm', token, {
      code: totpAt(secret, (await settledStep()) - 1),
    });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(confirmed.json().recoveryCodes).toHaveLength(10);

    // The web now asks for it; a phone still signs straight in.
    expect(await challenge(o.managerPhone)).toMatchObject({ enrolled: true });
    expect((await world.verify(o.managerPhone, newDevice())).json().status).toBe('signed_in');

    // Removed with a code from it, the web signs in by SMS code alone again.
    const removed = await asUser('POST', '/auth/v1/authenticator/remove', token, {
      code: totpAt(secret, totpStep()),
    });
    expect(removed.statusCode, removed.body).toBe(204);
    expect((await world.verify(o.managerPhone)).json().status).toBe('signed_in');

    // An admin's role needs one, so theirs stays.
    const admin = (await world.signIn(o.adminPhone)).accessToken;
    expect((await asUser('GET', '/auth/v1/authenticator', admin)).json()).toEqual({
      enrolled: true,
      required: true,
    });
    const kept = await asUser('POST', '/auth/v1/authenticator/remove', admin, { code: '123456' });
    expect(kept.json().error.code).toBe('CONFLICT');
  });

  it('gives a phone’s token none of the permissions that change access', async () => {
    const o = await organisation('Phone Admin Co');
    const phone = (await world.signIn(o.adminPhone, newDevice())).accessToken;
    const refused = await asUser('POST', '/v1/users', phone, {
      code: `P-${newId().slice(-6)}`,
      name: 'From a phone',
      phone: newPhone(),
      designation: 'manager',
    });
    expect(refused.json().error.code).toBe('FORBIDDEN');
    expect((await asUser('GET', '/auth/v1/authenticator', phone)).json().error.code).toBe(
      'FORBIDDEN',
    );
    // The same admin on the web, behind the authenticator, may.
    const web = (await world.signIn(o.adminPhone)).accessToken;
    const made = await asUser('POST', '/v1/users', web, {
      code: `W-${newId().slice(-6)}`,
      name: 'From the web',
      phone: newPhone(),
      designation: 'manager',
    });
    expect(made.statusCode, made.body).toBe(201);
  });
});
