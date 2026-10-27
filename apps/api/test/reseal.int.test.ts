import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StaffService } from '../src/modules/console/staff.service';
import { SecondFactorService } from '../src/modules/directory/second-factor.service';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { totpAt } from '../src/platform/totp';
import { newAddress, newPhone, settledStep, startApp, testConfig, World } from './support';

/**
 * Rotating the column key (decision D101): values sealed under the old key open while it is the
 * previous one, `pnpm reseal`'s work seals them again under the new, and after that the new key
 * alone opens everything.
 */

const OLD = Buffer.alloc(32, 21).toString('base64');
const NEW = Buffer.alloc(32, 22).toString('base64');
const idOf = (key: string) =>
  createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 8);

let before: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  before = await startApp(testConfig({ COLUMN_KEY: OLD }));
  world = await World.create(before);
});

afterAll(async () => {
  await world.end();
  await before.close();
});

describe('rotating the column key (D101)', () => {
  it('reseals every sealed column under the new key, which then opens them alone', async () => {
    // Under the old key: an admin's authenticator, a staff member's, and a webhook's secret.
    const tenantId = await world.tenant('Rotating Co');
    const adminPhone = newPhone();
    await world.user(tenantId, { phone: adminPhone, designation: 'head', role: 'tenant_admin' });
    const admin = (await world.signIn(adminPhone)).accessToken;
    const hook = await before.inject({
      method: 'POST',
      url: '/v1/webhooks',
      headers: { authorization: `Bearer ${admin}`, 'idempotency-key': newId() },
      payload: { id: newId(), url: 'https://hooks.example.com/rotating', events: ['user.created'] },
      remoteAddress: newAddress(),
    });
    expect(hook.statusCode, hook.body).toBe(201);
    const email = `rotate-${newId().slice(-8)}@vendor.example`;
    const staffId = newId();
    const { setupUrl } = await before
      .get(StaffService)
      .invite({ id: staffId, email, name: 'Lata Menon', role: 'support' }, null);
    const token = setupUrl.split('#')[1]!;
    const post = (app: NestFastifyApplication, url: string, payload: object) =>
      app.inject({ method: 'POST', url, payload, remoteAddress: newAddress() });
    const { secret } = (
      await post(before, '/platform/v1/setup', { token, password: 'a long vendor passphrase' })
    ).json();
    await post(before, '/platform/v1/setup/confirm', {
      token,
      code: totpAt(secret, (await settledStep()) - 1),
    });

    const sealed = async () =>
      (
        await world.directory.client.query<{ value: string }>(
          `select secret_sealed as value from directory.totp_secrets
            where identity_id = (select id from directory.identities where phone_e164 = $1)
           union all select totp_secret from directory.platform_users where email = $2`,
          [adminPhone, email],
        )
      ).rows.map((row) => row.value);
    expect((await sealed()).every((value) => value.startsWith(`v2:${idOf(OLD)}:`))).toBe(true);

    // Rotating: the new key seals, the old still opens, and resealing moves everything over.
    const rotating = await startApp(testConfig({ COLUMN_KEY: NEW, COLUMN_KEY_PREVIOUS: OLD }));
    try {
      // Only this test's own rows: the database is shared with tests sealing under other keys.
      const [{ id: identityId }] = (
        await world.directory.client.query<{ id: string }>(
          'select id from directory.identities where phone_e164 = $1',
          [adminPhone],
        )
      ).rows as [{ id: string }];
      expect(await rotating.get(SecondFactorService).resealSecrets([identityId])).toBe(1);
      expect(await rotating.get(StaffService).resealSecrets([staffId])).toBe(1);
      expect(await rotating.get(WebhooksService).resealSecrets(tenantId)).toBe(1);
      // Again, nothing is left to do.
      expect(await rotating.get(StaffService).resealSecrets([staffId])).toBe(0);
    } finally {
      await rotating.close();
    }
    expect((await sealed()).every((value) => value.startsWith(`v2:${idOf(NEW)}:`))).toBe(true);

    // With the old key gone, the staff member still signs in.
    const after = await startApp(testConfig({ COLUMN_KEY: NEW }));
    try {
      const signedIn = await post(after, '/platform/v1/session', {
        email,
        password: 'a long vendor passphrase',
        code: totpAt(secret, await settledStep()),
      });
      expect(signedIn.statusCode, signedIn.body).toBe(200);
    } finally {
      await after.close();
    }
  });
});
