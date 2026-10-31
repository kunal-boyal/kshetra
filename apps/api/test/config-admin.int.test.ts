import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricFactsDaily } from '../src/db/schema/metrics';
import { PerformanceUpkeep } from '../src/modules/performance/performance.upkeep';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Configuration screens (M2): account types, territory levels, metrics and the score. */

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

type Method = 'GET' | 'POST' | 'PUT';

function as(token: string) {
  return (method: Method, url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
}

const text = (en: string) => ({ en, hi: en });
const noun = (one: string, other: string) => ({
  en: { one, other },
  hi: { one, other },
});
const TODAY = () => todayIn('Asia/Kolkata');

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

const partner = (key = 'partner') => ({
  key,
  name: noun('Partner', 'Partners'),
  icon: 'handshake',
  code: { mode: 'auto', prefix: 'P' },
  location: { required: true, geofencePolicy: 'required', fieldUsersMayPropose: false },
  creation: 'admins',
  slots: [{ key: 'executive', name: text('Executive'), designations: ['executive'], priority: 1 }],
  fields: [{ key: 'gst_number', type: 'short_text', label: text('GST number') }],
});

describe('account types (M2, spec 5.5)', () => {
  it('are added by admins, checked like a template’s, and reach every app', async () => {
    const t = await tenant('Types Co');
    const id = newId();
    const made = await t.admin('POST', '/v1/account-types', { id, definition: partner() });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({ id, key: 'partner', version: 1 });
    // The same request again replays.
    expect(
      (await t.admin('POST', '/v1/account-types', { id, definition: partner() })).json().id,
    ).toBe(id);
    const keys = (await t.manager('GET', '/v1/account-types'))
      .json()
      .items.map((type: { key: string }) => type.key);
    expect(keys).toEqual(expect.arrayContaining(['customer', 'partner']));
    expect(
      (await t.manager('GET', '/v1/config'))
        .json()
        .accountTypes.map((type: { key: string }) => type.key),
    ).toContain('partner');

    const again = await t.admin('POST', '/v1/account-types', {
      id: newId(),
      definition: partner('customer'),
    });
    expect(again.json().error.details).toEqual([
      expect.objectContaining({ path: 'definition.key' }),
    ]);
    const unknown = await t.admin('POST', '/v1/account-types', {
      id: newId(),
      definition: {
        ...partner('agent'),
        slots: [{ key: 'owner', name: text('Owner'), designations: ['nobody'], priority: 1 }],
      },
    });
    expect(unknown.json().error.details.map((d: { path: string }) => d.path)).toEqual([
      expect.stringMatching(/^definition\.slots/),
    ]);
    expect(
      (
        await t.manager('POST', '/v1/account-types', { id: newId(), definition: partner('x') })
      ).json().error.code,
    ).toBe('FORBIDDEN');
  });
});

describe('territory levels (M2, spec 5.4)', () => {
  it('are renamed and added at the bottom, and keep their keys and places', async () => {
    const t = await tenant('Levels Co');
    const levels = [
      { key: 'region', name: noun('Zone', 'Zones') },
      { key: 'area', name: noun('Area', 'Areas') },
      { key: 'town', name: noun('Town', 'Towns') },
    ];
    const saved = await t.admin('PUT', '/v1/territories/levels', { levels });
    expect(saved.json().levels).toEqual([
      { level: 1, key: 'region', name: noun('Zone', 'Zones') },
      { level: 2, key: 'area', name: noun('Area', 'Areas') },
      { level: 3, key: 'town', name: noun('Town', 'Towns') },
    ]);
    const shorter = await t.admin('PUT', '/v1/territories/levels', { levels: levels.slice(0, 2) });
    expect(shorter.json().error.code).toBe('VALIDATION');
    const moved = await t.admin('PUT', '/v1/territories/levels', {
      levels: [levels[1], levels[0], levels[2]],
    });
    expect(moved.json().error.details.map((d: { path: string }) => d.path)).toEqual([
      'levels[0].key',
      'levels[1].key',
    ]);
  });
});

describe('metrics and the score (M2, spec 5.7, 5.8)', () => {
  it('are changed with their rules kept: key, unit, the score’s metrics, its period from one to come', async () => {
    const t = await tenant('Metrics Co');
    const { metrics, score } = (await t.admin('GET', '/v1/metric-definitions')).json();
    const visits = metrics.find(
      (entry: { definition: { key: string } }) => entry.definition.key === 'visits',
    );
    expect(visits).toMatchObject({ active: true, version: 1 });
    expect(score.metrics).toEqual(expect.arrayContaining([{ metric: 'visits', weight: 50 }]));

    const renamed = await t.admin('PUT', '/v1/metrics/visits', {
      definition: { ...visits.definition, name: noun('Call', 'Calls') },
      active: true,
      from: TODAY(),
    });
    expect(renamed.statusCode).toBe(200);
    expect(
      renamed
        .json()
        .metrics.find(
          (entry: { definition: { key: string } }) => entry.definition.key === 'visits',
        ),
    ).toMatchObject({ version: 2, definition: { name: noun('Call', 'Calls') } });

    const refused = await t.admin('PUT', '/v1/metrics/visits', {
      definition: { ...visits.definition, unit: 'quantity' },
      active: false,
      from: '2020-01-01',
    });
    expect(
      refused
        .json()
        .error.details.map((d: { path: string }) => d.path)
        .sort(),
    ).toEqual(['active', 'definition.unit', 'from']);
    expect(
      (
        await t.admin('PUT', '/v1/score', {
          definition: { ...score, periodType: 'quarter' },
        })
      ).json().error.details,
    ).toEqual([
      { path: 'definition.periodFrom', issue: 'Choose the first period the new kind counts from' },
    ]);
    const reweighted = await t.admin('PUT', '/v1/score', {
      definition: {
        ...score,
        metrics: [
          { metric: 'visits', weight: 70 },
          { metric: 'coverage', weight: 30 },
        ],
      },
    });
    expect(reweighted.json().score.metrics).toEqual([
      { metric: 'visits', weight: 70 },
      { metric: 'coverage', weight: 30 },
    ]);
    expect((await t.manager('GET', '/v1/metric-definitions')).json().error.code).toBe('FORBIDDEN');
  });

  it("adds a metric and works out people's facts for it from the start of the month", async () => {
    const t = await tenant('Facts Co');
    const phone = newPhone();
    const asha = await world.user(t.tenantId, { phone, designation: 'executive' });
    const field = as((await world.signIn(phone, newDevice())).accessToken);
    const here = { lat: 28.6315, lng: 77.2167 };
    const made = await t.admin('POST', '/v1/forms', {
      definition: {
        key: 'quick_note',
        name: noun('Quick note', 'Quick notes'),
        icon: 'clipboard-check',
        accountLink: { mode: 'none' },
        shift: 'required',
        review: 'manual',
        geofence: 'off',
        signature: 'none',
        photos: { min: 0, max: 1, source: 'camera' },
        fields: [{ key: 'note', type: 'short_text', label: text('Note') }],
      },
    });
    expect(made.statusCode).toBe(201);
    const start = Math.max(Date.now() - 3_600_000, Date.parse(`${TODAY()}T00:01:00+05:30`));
    expect(
      (
        await field('POST', '/v1/shifts', {
          id: newId(),
          startedAt: new Date(start).toISOString(),
          location: here,
          accuracy: 15,
          mocked: false,
          consentVersion: '2026-10',
        })
      ).statusCode,
    ).toBe(201);
    const note = await field('POST', '/v1/submissions', {
      id: newId(),
      form: { key: 'quick_note', version: 1 },
      capturedAt: new Date().toISOString(),
      fix: { location: here, accuracy: 15, mocked: false, capturedAt: new Date().toISOString() },
      values: { note: 'Called the shop' },
      photos: [],
    });
    expect(note.statusCode).toBe(201);

    const added = await t.admin('POST', '/v1/metrics', {
      definition: {
        key: 'notes',
        name: noun('Note', 'Notes'),
        unit: 'count',
        source: { type: 'submission_count', forms: ['quick_note'] },
      },
    });
    expect(added.statusCode).toBe(201);
    await app.get(PerformanceUpkeep).recomputeFrom(t.tenantId, `${TODAY().slice(0, 7)}-01`);
    const facts = await app.get(Database).forTenant(t.tenantId, (tx) =>
      tx
        .select({ value: metricFactsDaily.value, pending: metricFactsDaily.pending })
        .from(metricFactsDaily)
        .where(
          and(
            eq(metricFactsDaily.tenantId, t.tenantId),
            eq(metricFactsDaily.userId, asha.id),
            eq(metricFactsDaily.metricKey, 'notes'),
            eq(metricFactsDaily.date, TODAY()),
          ),
        ),
    );
    // Waiting for review: it counts as pending, apart from the approved value (BR-02).
    expect(facts).toEqual([{ value: '0.000', pending: '1.000' }]);
    expect(
      (
        await t.admin('POST', '/v1/metrics', {
          definition: {
            key: 'notes',
            name: noun('Note', 'Notes'),
            unit: 'count',
            source: { type: 'plan_compliance_percent' },
          },
        })
      ).json().error.details,
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: 'definition.key' })]));
  });

  it('works a calculated field out on the server, and sums it in a metric (decision D118)', async () => {
    const t = await tenant('Calculated Co');
    const phone = newPhone();
    const asha = await world.user(t.tenantId, { phone, designation: 'executive' });
    const field = as((await world.signIn(phone, newDevice())).accessToken);
    const here = { lat: 28.6315, lng: 77.2167 };
    const definition = (formula: string) => ({
      key: 'crop_report',
      name: noun('Crop report', 'Crop reports'),
      icon: 'leaf',
      accountLink: { mode: 'none' },
      shift: 'required',
      review: 'manual',
      geofence: 'off',
      signature: 'none',
      photos: { min: 0, max: 1, source: 'camera' },
      fields: [
        { key: 'acres', type: 'number', label: text('Acres'), decimals: 2, required: true },
        { key: 'rate', type: 'currency', label: text('Rate per acre'), required: true },
        { key: 'total', type: 'calculated', label: text('Total'), formula, result: 'currency' },
      ],
    });
    // A formula that reads a later field is refused where it is.
    const refused = await t.admin('POST', '/v1/forms', {
      definition: definition('acres * rate * later'),
    });
    expect(refused.json().error.details).toEqual([
      { path: 'definition.fields[2].formula', issue: 'There is no field `later`' },
    ]);
    const made = await t.admin('POST', '/v1/forms', { definition: definition('acres * rate') });
    expect(made.statusCode, made.body).toBe(201);
    const start = Math.max(Date.now() - 3_600_000, Date.parse(`${TODAY()}T00:01:00+05:30`));
    expect(
      (
        await field('POST', '/v1/shifts', {
          id: newId(),
          startedAt: new Date(start).toISOString(),
          location: here,
          accuracy: 15,
          mocked: false,
          consentVersion: '2026-10',
        })
      ).statusCode,
    ).toBe(201);
    // What the phone sends for the calculated field is not taken: the server works it out.
    const sent = await field('POST', '/v1/submissions', {
      id: newId(),
      form: { key: 'crop_report', version: 1 },
      capturedAt: new Date().toISOString(),
      fix: { location: here, accuracy: 15, mocked: false, capturedAt: new Date().toISOString() },
      values: { acres: 2.5, rate: '412.30', total: '1.00' },
      photos: [],
    });
    expect(sent.statusCode, sent.body).toBe(201);
    expect(sent.json().values).toEqual({ acres: 2.5, rate: '412.30', total: '1030.75' });

    const added = await t.admin('POST', '/v1/metrics', {
      definition: {
        key: 'crop_value',
        name: noun('Crop value', 'Crop values'),
        unit: 'currency',
        source: { type: 'submission_field_sum', forms: ['crop_report'], field: 'total' },
      },
    });
    expect(added.statusCode, added.body).toBe(201);
    await app.get(PerformanceUpkeep).recomputeFrom(t.tenantId, `${TODAY().slice(0, 7)}-01`);
    const facts = await app.get(Database).forTenant(t.tenantId, (tx) =>
      tx
        .select({ pending: metricFactsDaily.pending })
        .from(metricFactsDaily)
        .where(
          and(
            eq(metricFactsDaily.tenantId, t.tenantId),
            eq(metricFactsDaily.userId, asha.id),
            eq(metricFactsDaily.metricKey, 'crop_value'),
            eq(metricFactsDaily.date, TODAY()),
          ),
        ),
    );
    expect(facts).toEqual([{ pending: '1030.750' }]);
  });
});
