import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { SYSTEM } from '../src/modules/iam/actor';
import { UsersService } from '../src/modules/iam/users.service';
import { newAddress, newPhone, startApp, testConfig, World } from './support';

/** Fixed sign-in codes for demo tenants (decision D70). */

const urls = inject('databaseUrls');
const demoPhone = newPhone();
const DEMO_CODE = '482913';
let app: NestFastifyApplication;
let world: World;
/** The demo number's user in its demo tenant, made by the first test. */
let demoUser: { tenantId: string; userId: string };

beforeAll(async () => {
  app = await startApp(testConfig({ DEMO_CODES: JSON.stringify({ [demoPhone]: DEMO_CODE }) }));
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const post = (url: string, payload: object) =>
  app.inject({ method: 'POST', url, payload, remoteAddress: newAddress() });
const requestCode = (phone: string) => post('/auth/v1/otp/request', { phone });
const verifyCode = (phone: string, code: string) => post('/auth/v1/otp/verify', { phone, code });

/** A tenant marked for demos, as `pnpm provision --demo` makes one. */
async function demoTenant(name: string) {
  const tenantId = await world.tenant(name);
  const admin = new pg.Client({ connectionString: urls.admin });
  await admin.connect();
  try {
    await admin.query('update directory.tenants set demo = true where id = $1', [tenantId]);
  } finally {
    await admin.end();
  }
  return tenantId;
}

describe('demo sign-in (decision D70)', () => {
  it('lets a demo number into a demo tenant with its fixed code, and sends nothing', async () => {
    const tenantId = await demoTenant('Demo Seeds');
    const { userIds } = await world.member(demoPhone, [tenantId]);
    demoUser = { tenantId, userId: userIds[0]! };
    expect((await requestCode(demoPhone)).statusCode).toBe(202);
    expect(world.sender.lastCode(demoPhone)).toBeUndefined();
    expect((await verifyCode(demoPhone, '000000')).json().error.code).toBe('OTP_INVALID');
    const signedIn = await verifyCode(demoPhone, DEMO_CODE);
    expect(signedIn.json()).toMatchObject({ status: 'signed_in', tenant: { id: tenantId } });
  });

  it('sends a real code to anyone else in a demo tenant', async () => {
    const tenantId = await demoTenant('Demo Traders');
    const phone = newPhone();
    await world.member(phone, [tenantId]);
    await requestCode(phone);
    const code = world.sender.lastCode(phone)!;
    expect(code).toMatch(/^\d{6}$/);
    expect((await verifyCode(phone, code)).json().status).toBe('signed_in');
  });

  it('stops the fixed code once the number belongs to a real tenant instead (D103)', async () => {
    const { tenantId, userId } = demoUser;
    // One organisation a person: the number leaves the demo before a real tenant may have it.
    await world.database.forTenant(tenantId, (tx) =>
      app.get(UsersService).update(tx, tenantId, SYSTEM, userId, { status: 'inactive' }),
    );
    const real = await world.tenant('Real Agro');
    await world.member(demoPhone, [real]);
    await requestCode(demoPhone);
    const sent = world.sender.lastCode(demoPhone);
    expect(sent).toMatch(/^\d{6}$/);
    expect((await verifyCode(demoPhone, DEMO_CODE)).json().error.code).toBe('OTP_INVALID');
    expect((await verifyCode(demoPhone, sent!)).statusCode).toBe(200);
  });
});
