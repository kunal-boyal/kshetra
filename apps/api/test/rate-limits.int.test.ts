import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SSO_LIMITS } from '../src/modules/directory/sso.controller';
import { newAddress, newPhone, startApp, testConfig, World } from './support';

/**
 * Limits on requests beyond sign-in (ASVS V2.4.1, decision D101): a minute's requests for each
 * signed-in person, whatever their plan, and each address's SSO lookups. Here a person may make
 * five requests a minute.
 */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp(testConfig({ USER_REQUESTS_PER_MINUTE: '5' }));
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

describe('request limits (D101)', () => {
  it('holds each signed-in person to their own requests a minute', async () => {
    const tenantId = await world.tenant('Busy Co');
    const [first, second] = [newPhone(), newPhone()];
    await world.user(tenantId, { phone: first });
    await world.user(tenantId, { phone: second });
    const me = async (phone: string) => {
      const { accessToken } = await world.signIn(phone);
      return () =>
        app.inject({
          method: 'GET',
          url: '/v1/me',
          headers: { authorization: `Bearer ${accessToken}` },
          remoteAddress: newAddress(),
        });
    };
    const asFirst = await me(first);
    for (let i = 0; i < 5; i += 1) expect((await asFirst()).statusCode).toBe(200);
    const limited = await asFirst();
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeLessThanOrEqual(60);
    // Someone else in the same tenant is untouched.
    expect((await (await me(second))()).statusCode).toBe(200);
  });

  it('limits SSO lookups from one address', async () => {
    const address = newAddress();
    const discover = () =>
      app.inject({
        method: 'POST',
        url: '/auth/v1/sso/discover',
        payload: { email: 'someone@nowhere.example' },
        remoteAddress: address,
      });
    for (let i = 0; i < SSO_LIMITS.discoveriesPerAddress.max; i += 1) {
      expect((await discover()).statusCode).toBe(200);
    }
    expect((await discover()).json().error.code).toBe('RATE_LIMITED');
  });
});
