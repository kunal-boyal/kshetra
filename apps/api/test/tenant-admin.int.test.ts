import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newPhone, startApp, testConfig, World } from './support';

/** Tenant administration (M2): settings, the organisation's name and logo, and modules. */

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

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

function as(token: string) {
  return (method: Method, url: string, payload?: object | Buffer, type?: string) =>
    app.inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'idempotency-key': newId(),
        ...(type ? { 'content-type': type } : {}),
      },
      ...(payload ? { payload } : {}),
    });
}

/** A tenant with its admin and a manager, both on the web. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), manager: newPhone() };
  const admin = await world.user(tenantId, {
    phone: phones.admin,
    designation: 'head',
    role: 'tenant_admin',
  });
  await world.user(tenantId, {
    phone: phones.manager,
    designation: 'manager',
    role: 'manager',
    managerId: admin.id,
  });
  return {
    tenantId,
    admin: as((await world.signIn(phones.admin)).accessToken),
    manager: as((await world.signIn(phones.manager)).accessToken),
  };
}

const png = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: '#5b2b82' } })
    .png()
    .toBuffer();

describe('settings (M2, spec 5.1)', () => {
  it('keeps legal details, and refuses a GSTIN or a brand colour that would not do', async () => {
    const t = await tenant('Settings Co');
    const saved = await t.admin('PATCH', '/v1/settings', {
      legalName: 'Settings Company Private Limited',
      address: '12 Janpath, New Delhi 110001',
      taxId: '07abcde1234f1z5',
      brandColour: '#0F6E6E',
    });
    expect(saved.json()).toMatchObject({
      legalName: 'Settings Company Private Limited',
      taxId: '07ABCDE1234F1Z5',
      brandColour: '#0f6e6e',
      modulesOff: [],
    });
    const refused = await t.admin('PATCH', '/v1/settings', {
      taxId: 'NOT-A-GSTIN',
      brandColour: '#9fd3ff',
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.details.map((detail: { path: string }) => detail.path)).toEqual(
      expect.arrayContaining(['taxId', 'brandColour']),
    );
    // The logo is set only through its own route.
    expect((await t.admin('PATCH', '/v1/settings', { logoMediaId: newId() })).statusCode).toBe(400);
    expect(
      (await t.manager('PATCH', '/v1/settings', { legalName: 'X Ltd' })).json().error.code,
    ).toBe('FORBIDDEN');
  });
});

describe('the organisation (M2)', () => {
  it('is renamed by those who manage settings, and read by everyone', async () => {
    const t = await tenant('Rename Co');
    expect((await t.manager('GET', '/v1/organisation')).json()).toEqual({
      name: 'Rename Co',
      logo: null,
    });
    const renamed = await t.admin('PATCH', '/v1/organisation', { name: '  Sunrise Rename Co ' });
    expect(renamed.json().name).toBe('Sunrise Rename Co');
    expect((await t.manager('GET', '/v1/organisation')).json().name).toBe('Sunrise Rename Co');
    expect(
      (await t.manager('PATCH', '/v1/organisation', { name: 'Mine now' })).json().error.code,
    ).toBe('FORBIDDEN');
  });

  it('takes a logo as an image, resized, and removes it', async () => {
    const t = await tenant('Logo Co');
    const set = await t.admin('PUT', '/v1/organisation/logo', await png(2000, 1000), 'image/png');
    expect(set.statusCode).toBe(200);
    expect(set.json().logo).toMatchObject({ url: expect.any(String) });
    const { logoMediaId } = (await t.admin('GET', '/v1/config')).json().settings;
    expect(logoMediaId).toEqual(expect.any(String));
    // Re-encoded within 512 pixels a side.
    const stored = await world.database.forTenant(t.tenantId, async (tx) => {
      const { MediaService } = await import('../src/modules/media/media.service');
      return app.get(MediaService).read(tx, t.tenantId, logoMediaId);
    });
    expect(await sharp(stored.bytes).metadata()).toMatchObject({ width: 512, height: 256 });

    const svg = await t.admin(
      'PUT',
      '/v1/organisation/logo',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
      'image/svg+xml',
    );
    expect(svg.statusCode).toBe(400);
    // Named a PNG, an SVG or a TIFF is still refused: the bytes decide (D101).
    for (const disguised of [
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"></svg>'),
      await sharp({ create: { width: 10, height: 10, channels: 3, background: '#000' } })
        .tiff()
        .toBuffer(),
    ]) {
      const refused = await t.admin('PUT', '/v1/organisation/logo', disguised, 'image/png');
      expect(refused.json().error.details).toEqual([
        { path: 'body', issue: 'This image could not be read' },
      ]);
    }
    expect(
      (
        await t.admin('PUT', '/v1/organisation/logo', Buffer.from('not an image'), 'image/png')
      ).json().error.code,
    ).toBe('VALIDATION');

    expect((await t.admin('DELETE', '/v1/organisation/logo')).json().logo).toBeNull();
  });
});

describe('modules (M2, spec 5.13)', () => {
  it('switched off, hide their permissions and close their routes', async () => {
    const t = await tenant('Module Co');
    const period = todayIn('Asia/Kolkata').slice(0, 7);
    expect(
      (await t.manager('GET', `/v1/reports/attendance_register?period=${period}`)).statusCode,
    ).toBe(200);
    expect((await t.admin('GET', '/v1/config')).json().access.permissions).toContain(
      'leave.request',
    );

    expect(
      (await t.admin('PATCH', '/v1/settings', { modulesOff: ['leave_attendance'] })).statusCode,
    ).toBe(200);
    expect(
      (await t.manager('GET', `/v1/reports/attendance_register?period=${period}`)).json().error
        .code,
    ).toBe('MODULE_DISABLED');
    expect(
      (
        await t.manager('POST', '/v1/exports', {
          id: newId(),
          report: 'attendance_register',
          filters: { period },
          format: 'csv',
        })
      ).json().error.code,
    ).toBe('MODULE_DISABLED');
    // Core's reports stay open.
    expect((await t.manager('GET', `/v1/reports/activity_log?period=${period}`)).statusCode).toBe(
      200,
    );
    const config = (await t.admin('GET', '/v1/config')).json();
    expect(config.settings.modulesOff).toEqual(['leave_attendance']);
    expect(config.access.permissions).not.toContain('leave.request');
    expect((await t.admin('PATCH', '/v1/settings', { modulesOff: ['core'] })).statusCode).toBe(400);
  });
});
