import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newAddress, newPhone, staffToken, startApp, World } from './support';

/**
 * Announcements (module M22, decision D93): written in the console for every tenant or some, on
 * the web, the phone or both, for a window of time; each tenant reads only what shows for it now.
 */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function call(method: 'GET' | 'POST', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

async function admin(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, token: (await world.signIn(phone)).accessToken };
}

const hours = (count: number) => new Date(Date.now() + count * 3_600_000).toISOString();

const announcement = (overrides: object = {}) => ({
  id: newId(),
  title: { en: 'Planned maintenance', hi: 'तय रखरखाव' },
  body: {
    en: 'The portal is down from 11 pm to midnight.',
    hi: 'पोर्टल रात 11 बजे से 12 बजे तक बंद रहेगा।',
  },
  tone: 'warning',
  surfaces: ['web'],
  tenantIds: null,
  startsAt: hours(-1),
  endsAt: hours(24),
  ...overrides,
});

const shown = async (token: string, surface: 'web' | 'mobile') =>
  (
    (await call('GET', `/v1/announcements?surface=${surface}`, token)).json().items as {
      id: string;
    }[]
  ).map((item) => item.id);

describe('announcements (M22, D93)', () => {
  it('shows each tenant what is meant for it, where and while it is meant to', async () => {
    const a = await admin('Announced A');
    const b = await admin('Announced B');
    const staff = await staffToken(app, 'platform_admin');

    const everyone = announcement();
    const made = await call('POST', '/platform/v1/announcements', staff, everyone);
    expect(made.statusCode, made.body).toBe(201);
    expect(made.json()).toMatchObject({
      status: 'showing',
      tenants: null,
      createdBy: 'Staff platform_admin',
    });
    // The same ID again is the same announcement.
    expect((await call('POST', '/platform/v1/announcements', staff, everyone)).json().id).toBe(
      everyone.id,
    );

    const onlyA = announcement({
      surfaces: ['web', 'mobile'],
      tenantIds: [a.tenantId],
      tone: 'info',
    });
    const targeted = await call('POST', '/platform/v1/announcements', staff, onlyA);
    expect(targeted.json().tenants).toEqual([{ id: a.tenantId, name: 'Announced A' }]);
    const later = announcement({ startsAt: hours(2), endsAt: hours(5) });
    expect((await call('POST', '/platform/v1/announcements', staff, later)).json().status).toBe(
      'scheduled',
    );

    expect(await shown(a.token, 'web')).toEqual(expect.arrayContaining([everyone.id, onlyA.id]));
    expect(await shown(a.token, 'web')).not.toContain(later.id);
    expect(await shown(a.token, 'mobile')).toEqual([onlyA.id]);
    expect(await shown(b.token, 'web')).toContain(everyone.id);
    expect(await shown(b.token, 'web')).not.toContain(onlyA.id);

    const withdrawn = await call(
      'POST',
      `/platform/v1/announcements/${everyone.id}/withdraw`,
      staff,
    );
    expect(withdrawn.json().status).toBe('withdrawn');
    expect(await shown(b.token, 'web')).not.toContain(everyone.id);
  });

  it('checks the window and the tenants, and lets only those who manage tenants announce', async () => {
    const admin = await staffToken(app, 'platform_admin');
    const backwards = await call(
      'POST',
      '/platform/v1/announcements',
      admin,
      announcement({ startsAt: hours(5), endsAt: hours(2) }),
    );
    expect(backwards.json().error.details).toEqual([
      { path: 'endsAt', issue: 'End after it starts' },
    ]);
    const nowhere = await call(
      'POST',
      '/platform/v1/announcements',
      admin,
      announcement({ tenantIds: [newId()] }),
    );
    expect(nowhere.json().error.details).toEqual([
      { path: 'tenantIds.0', issue: 'There is no such tenant' },
    ]);

    const support = await staffToken(app, 'support');
    expect((await call('GET', '/platform/v1/announcements', support)).statusCode).toBe(200);
    expect(
      (await call('POST', '/platform/v1/announcements', support, announcement())).json().error.code,
    ).toBe('FORBIDDEN');
  });
});
