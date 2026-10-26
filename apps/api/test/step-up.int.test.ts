import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAddress, newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Step-up (ASVS V7.5.1, decision D101): changing what decides who signs in as whom (a person's
 * phone or email, their authenticator, single sign-on) needs a fresh authenticator code from the
 * last ten minutes, which the session keeps across its refreshes.
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

const as = (token: string, method: 'GET' | 'POST' | 'PATCH', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    remoteAddress: newAddress(),
    ...(payload ? { payload } : {}),
  });

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const adminPhone = newPhone();
  await world.user(tenantId, { phone: adminPhone, designation: 'head', role: 'tenant_admin' });
  const managerPhone = newPhone();
  const manager = await world.user(tenantId, { phone: managerPhone });
  return { tenantId, adminPhone, manager, managerPhone };
}

describe('step-up (D101)', () => {
  it('asks for a fresh code before a phone or email changes, not before a name does', async () => {
    const o = await organisation('Careful Changes Co');
    const signedIn = await world.signIn(o.adminPhone);
    const url = `/v1/users/${o.manager.id}`;

    const renamed = await as(signedIn.accessToken, 'PATCH', url, { name: 'Ravi Kumar' });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const refused = await as(signedIn.accessToken, 'PATCH', url, { phone: newPhone() });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toMatchObject({
      code: 'SECOND_FACTOR_REQUIRED',
      details: [{ path: 'stepUp', issue: 'Give a fresh authenticator code' }],
    });
    // Sending the same phone back changes nothing, so needs nothing.
    const same = await as(signedIn.accessToken, 'PATCH', url, { phone: o.managerPhone });
    expect(same.statusCode, same.body).toBe(200);

    const wrong = await as(signedIn.accessToken, 'POST', '/auth/v1/authenticator/step-up', {
      code: '000000',
    });
    expect(wrong.json().error.code).toBe('OTP_INVALID');
    const stepped = await world.stepUp(o.adminPhone, signedIn.accessToken);
    const changed = await as(stepped, 'PATCH', url, { email: 'ravi@careful.example' });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().email).toBe('ravi@careful.example');
    // Resetting someone's authenticator needs it too, and the fresh token has it.
    const reset = await as(
      signedIn.accessToken,
      'POST',
      `/v1/users/${o.manager.id}/second-factor/reset`,
    );
    expect(reset.json().error.code).toBe('SECOND_FACTOR_REQUIRED');
    expect(
      (await as(stepped, 'POST', `/v1/users/${o.manager.id}/second-factor/reset`)).statusCode,
    ).toBe(204);
  });

  it('keeps the step-up across a refresh of the same session', async () => {
    const o = await organisation('Refreshed Co');
    const signedIn = await world.signIn(o.adminPhone);
    await world.stepUp(o.adminPhone, signedIn.accessToken);
    const refreshed = await app.inject({
      method: 'POST',
      url: '/auth/v1/token/refresh',
      payload: { refreshToken: signedIn.refreshToken },
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const token = refreshed.json().session.accessToken as string;
    const changed = await as(token, 'PATCH', `/v1/users/${o.manager.id}`, { phone: newPhone() });
    expect(changed.statusCode, changed.body).toBe(200);
  });

  it('isn’t open to phones, which hold no such permissions anyway', async () => {
    const o = await organisation('Phone Co');
    const phone = await world.signIn(o.managerPhone, newDevice());
    const tried = await as(phone.accessToken, 'POST', '/auth/v1/authenticator/step-up', {
      code: '123456',
    });
    expect(tried.json().error.code).toBe('FORBIDDEN');
  });
});
