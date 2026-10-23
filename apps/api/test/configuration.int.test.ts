import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantProvisioner } from '../src/modules/provisioning/provisioner';
import { newPhone, startApp, testConfig, World } from './support';

/** Configuration export and import (M2, decision D66). */

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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';

function as(token: string) {
  return (method: Method, url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
}

const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });
const text = (en: string) => ({ en, hi: en });

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

type Change = { section: string; key: string; change: string };
const changed = (plan: { changes: Change[] }) =>
  plan.changes.filter((entry) => entry.change !== 'same');

describe('configuration export (M2)', () => {
  it('gives the configuration as a template, which imports back unchanged', async () => {
    const t = await tenant('Round Trip Co');
    await t.admin('PATCH', '/v1/settings', {
      geofenceRadiusMeters: 450,
      brandColour: '#0f6e6e',
      legalName: 'Round Trip Pvt Ltd',
    });
    const exported = await t.admin('GET', '/v1/configuration/export');
    expect(exported.statusCode).toBe(200);
    const file = exported.json();
    expect(file).toMatchObject({
      key: 'generic',
      name: { en: 'Round Trip Co' },
      geographyLevels: [{ key: 'region' }, { key: 'area' }],
      settings: { geofenceRadiusMeters: 450 },
    });
    // Identity and secrets stay behind.
    expect(file.settings).not.toHaveProperty('brandColour');
    expect(file.settings).not.toHaveProperty('legalName');
    expect(file.workflows.fallbackRole).toBeDefined();

    const plan = (
      await t.admin('POST', '/v1/configuration/import/preview', { template: file })
    ).json();
    expect(plan.issues).toEqual([]);
    expect(changed(plan)).toEqual([]);
    expect((await t.manager('GET', '/v1/configuration/export')).json().error.code).toBe(
      'FORBIDDEN',
    );
  });
});

describe('configuration import (M2)', () => {
  it('copies one tenant’s changes to another: adds and updates, never removes', async () => {
    const source = await tenant('Staging Co');
    const target = await tenant('Production Co');
    await source.admin('PATCH', '/v1/settings', { gpsIntervalSeconds: 120 });
    await source.admin('PUT', '/v1/terminology', {
      'term.account': { en: { one: 'Client', other: 'Clients' }, hi: noun('Client', 'Clients').hi },
    });
    expect(
      (
        await source.admin('POST', '/v1/account-types', {
          id: newId(),
          definition: {
            key: 'partner',
            name: noun('Partner', 'Partners'),
            icon: 'handshake',
            code: { mode: 'manual' },
            location: { required: false, geofencePolicy: 'advisory', fieldUsersMayPropose: true },
            creation: 'admins',
            slots: [
              {
                key: 'executive',
                name: text('Executive'),
                designations: ['executive'],
                priority: 1,
              },
            ],
          },
        })
      ).statusCode,
    ).toBe(201);
    await source.admin('PUT', '/v1/territories/levels', {
      levels: [
        { key: 'region', name: noun('Zone', 'Zones') },
        { key: 'area', name: noun('Area', 'Areas') },
        { key: 'town', name: noun('Town', 'Towns') },
      ],
    });
    // The target has something of its own, which the import leaves alone.
    await target.admin('PATCH', '/v1/settings', { brandColour: '#0f6e6e' });
    const file = (await source.admin('GET', '/v1/configuration/export')).json();

    const plan = (
      await target.admin('POST', '/v1/configuration/import/preview', { template: file })
    ).json();
    expect(plan.issues).toEqual([]);
    expect(changed(plan)).toEqual(
      expect.arrayContaining([
        { section: 'settings', key: 'settings', change: 'update' },
        { section: 'terminology', key: 'terminology', change: 'update' },
        { section: 'accountTypes', key: 'partner', change: 'add' },
        { section: 'geographyLevels', key: 'region', change: 'update' },
        { section: 'geographyLevels', key: 'town', change: 'add' },
      ]),
    );
    // A preview changes nothing.
    expect((await target.admin('GET', '/v1/territories')).json().levels).toHaveLength(2);

    const imported = await target.admin('POST', '/v1/configuration/import', { template: file });
    expect(imported.statusCode).toBe(200);
    const after = (await target.admin('GET', '/v1/configuration/export')).json();
    expect(after.accountTypes.map((type: { key: string }) => type.key)).toEqual(
      expect.arrayContaining(['customer', 'partner']),
    );
    expect(after.geographyLevels.map((level: { key: string }) => level.key)).toEqual([
      'region',
      'area',
      'town',
    ]);
    expect(after.settings.gpsIntervalSeconds).toBe(120);
    expect(after.terminology['term.account'].en.one).toBe('Client');
    const config = (await target.admin('GET', '/v1/config')).json();
    expect(config.settings.brandColour).toBe('#0f6e6e');
    // Importing the same file again finds everything the same.
    const again = (
      await target.admin('POST', '/v1/configuration/import/preview', { template: file })
    ).json();
    expect(changed(again)).toEqual([]);
  });

  it('refuses a file that breaks a rule, at its path, and keeps nothing of it', async () => {
    const t = await tenant('Careful Co');
    const file = (await t.admin('GET', '/v1/configuration/export')).json();
    const visit = file.forms.findIndex((form: { key: string }) => form.key === 'customer_visit');
    const field = file.forms[visit].fields.findIndex(
      (entry: { type: string }) => entry.type === 'short_text' || entry.type === 'long_text',
    );
    expect(field).toBeGreaterThanOrEqual(0);
    const broken = structuredClone(file);
    const { key, label } = broken.forms[visit].fields[field];
    broken.forms[visit].fields[field] = { key, label, type: 'number' };
    broken.terminology = {
      ...broken.terminology,
      'term.account': { en: { one: 'Shop', other: 'Shops' }, hi: noun('Shop', 'Shops').hi },
    };

    const plan = (
      await t.admin('POST', '/v1/configuration/import/preview', { template: broken })
    ).json();
    expect(plan.issues).toEqual([
      {
        path: `forms[${visit}].fields`,
        issue: expect.stringContaining('a key keeps its type'),
      },
    ]);
    const refused = await t.admin('POST', '/v1/configuration/import', { template: broken });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.code).toBe('VALIDATION');
    // The term the file also changed was rolled back with the rest.
    expect((await t.admin('GET', '/v1/terminology')).json().overrides['term.account']).toBe(
      undefined,
    );

    // A file that isn't a sound template is refused before anything is tried.
    const metric = file.metrics.findIndex((entry: { key: string }) => entry.key === 'visits');
    const unsound = structuredClone(file);
    unsound.metrics[metric].unit = 'quantity';
    unsound.geographyLevels = [];
    const shapeless = (
      await t.admin('POST', '/v1/configuration/import/preview', { template: unsound })
    ).json();
    expect(shapeless).toEqual({
      changes: [],
      issues: expect.arrayContaining([expect.objectContaining({ path: 'geographyLevels' })]),
    });
    expect(
      (await t.manager('POST', '/v1/configuration/import/preview', { template: file })).json().error
        .code,
    ).toBe('FORBIDDEN');
  });

  it('starts a new tenant from an exported file', async () => {
    const source = await tenant('Template Source Co');
    await source.admin('PATCH', '/v1/settings', { maxShiftHours: 10 });
    const file = (await source.admin('GET', '/v1/configuration/export')).json();
    const phone = newPhone();
    const { tenantId } = await app.get(TenantProvisioner).provision(
      {
        name: 'From File Co',
        slug: `from-file-${newId().slice(-8)}`,
        template: file.key,
        status: 'active',
        admin: { code: 'ADMIN-1', name: 'Zoya Khan', phone },
      },
      file,
    );
    const admin = as((await world.signIn(phone)).accessToken);
    const copy = (await admin('GET', '/v1/configuration/export')).json();
    expect(copy.settings.maxShiftHours).toBe(10);
    expect(copy.workflows).toEqual(file.workflows);
    expect(tenantId).toBeDefined();
  });
});
