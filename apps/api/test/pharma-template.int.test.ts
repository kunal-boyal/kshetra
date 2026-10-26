import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, todayIn } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * The pharma template (spec A.3, decision D97) on a tenant: a doctor call needs the products
 * detailed and a signature once samples are given, and the month's metrics count calls, coverage
 * by class, call frequency against each class's norm and samples distributed.
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

const MINUTE = 60_000;
const HERE = { lat: 19.9975, lng: 73.7898 };
const MONTH = todayIn('Asia/Kolkata').slice(0, 7);

function as(token: string) {
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string) => call('GET', url),
    post: (url: string, payload?: object) => call('POST', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
  };
}

const fix = (at: number) => ({
  location: HERE,
  accuracy: 12,
  mocked: false,
  capturedAt: new Date(at).toISOString(),
});

describe('the pharma template (spec A.3, decision D97)', () => {
  it('signs for samples, and measures coverage and call frequency by class', async () => {
    const tenantId = await world.tenant('Sanjeevani Pharma', 'active', 'pharma');
    const phones = { admin: newPhone(), abm: newPhone(), mr: newPhone() };
    const admin = await world.user(tenantId, {
      phone: phones.admin,
      designation: 'business_head',
      role: 'tenant_admin',
    });
    const abm = await world.user(tenantId, {
      phone: phones.abm,
      designation: 'abm',
      role: 'manager',
      managerId: admin.id,
    });
    const mr = await world.user(tenantId, {
      phone: phones.mr,
      designation: 'mr',
      role: 'field_user',
      managerId: abm.id,
    });
    const api = {
      admin: as((await world.signIn(phones.admin)).accessToken),
      abm: as((await world.signIn(phones.abm)).accessToken),
      mr: as((await world.signIn(phones.mr, newDevice())).accessToken),
    };

    const item = newId();
    const made = await api.admin.put(`/v1/items/${item}`, {
      code: 'CFX-200',
      name: 'Cefoxa 200 10 tablets',
      productName: 'Cefoxa 200',
      categoryName: null,
      hsn: '3004',
      taxRate: '12',
      mrp: '118',
      packLabel: '10 tablets',
      baseUnit: 'strip',
      units: [],
      measureType: null,
      measurePerBaseUnit: null,
    });
    expect(made.statusCode, made.body).toBe(201);
    const territoryId = await world.territory(tenantId, `P-${newId().slice(-6)}`);
    const doctor = async (name: string, kind: string) => {
      const id = newId();
      const reply = await api.admin.post('/v1/accounts', {
        id,
        type: 'doctor',
        name,
        territoryId,
        location: HERE,
        slots: { mr: mr.id, abm: abm.id },
        custom: { class: kind, speciality: 'cardiology' },
      });
      expect(reply.statusCode, reply.body).toBe(201);
      expect(reply.json().segments).toEqual([`class_${kind}`]);
      return id;
    };
    const classA = await doctor('Dr. Meena Kulkarni', 'a');
    const classC = await doctor('Dr. Sunil Aher', 'c');

    const opened = await api.mr.post('/v1/shifts', {
      id: newId(),
      startedAt: new Date(Date.now() - 3 * 60 * MINUTE).toISOString(),
      location: HERE,
      accuracy: 12,
      mocked: false,
      consentVersion: '2026-10',
    });
    expect(opened.statusCode, opened.body).toBe(201);

    /** A call on a doctor, from check-in to check-out, `minutesAgo` before now. */
    let calls = 0;
    const call = async (accountId: string, minutesAgo: number, values: object, extra = {}) => {
      const start = Date.now() - minutesAgo * MINUTE;
      const visitId = newId();
      const checkedIn = await api.mr.post('/v1/visits', {
        id: visitId,
        accountId,
        checkedInAt: new Date(start).toISOString(),
        fix: fix(start),
      });
      expect(checkedIn.statusCode, checkedIn.body).toBe(201);
      const sent = await api.mr.post('/v1/submissions', {
        id: newId(),
        form: { key: 'doctor_call', version: 1 },
        visitId,
        capturedAt: new Date(start + 5 * MINUTE).toISOString(),
        fix: fix(start + 5 * MINUTE),
        values,
        photos: [],
        ...extra,
      });
      await api.mr.post(`/v1/visits/${visitId}/check-out`, {
        checkedOutAt: new Date(start + 10 * MINUTE).toISOString(),
        fix: fix(start + 10 * MINUTE),
      });
      if (sent.statusCode === 201) calls += 1;
      return sent;
    };

    // The products detailed are needed; samples given need the doctor's signature.
    const detailed = { products_detailed: [{ itemId: item }] };
    expect((await call(classA, 150, {})).json().error.details).toEqual([
      { path: 'values.products_detailed', issue: 'Fill this in' },
    ]);
    const sampled = { ...detailed, samples: [{ itemId: item, quantity: 3 }] };
    expect((await call(classA, 135, sampled)).json().error.details).toEqual([
      { path: 'signature', issue: 'Ask for a signature' },
    ]);
    const signature = { width: 300, height: 120, strokes: ['M10 60 C80 10 120 90 200 50'] };
    const first = await call(classA, 120, sampled, { signature });
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json().values.products_detailed).toEqual([{ itemId: item, quantity: 1 }]);
    // A second call on the class A doctor the same day, and one on the class C doctor.
    const second = await call(classA, 100, detailed);
    expect(second.statusCode, second.body).toBe(201);
    const third = await call(
      classC,
      80,
      {
        ...detailed,
        samples: [{ itemId: item, quantity: 2 }],
      },
      { signature },
    );
    expect(third.statusCode, third.body).toBe(201);
    expect(calls).toBe(3);

    const queue = (await api.abm.get('/v1/reviews/queue?status=pending')).json();
    for (const entry of queue.items) {
      const reviewed = await api.abm.post(`/v1/submissions/${entry.id}/review`, {
        decision: 'approved',
      });
      expect(reviewed.statusCode, reviewed.body).toBe(200);
    }

    const mine = (await api.mr.get(`/v1/performance?period=${MONTH}`)).json();
    expect(mine.figures).toMatchObject({
      doctor_calls: { actual: '3' },
      doctors_covered: { actual: '2' },
      doctor_coverage: { actual: '100' },
      coverage_class_a: { actual: '100' },
      // Nobody holds a class B doctor, so there is nothing to cover.
      coverage_class_b: { actual: null },
      coverage_class_c: { actual: '100' },
      // Class C's one call a month is met; class A's four aren't, two calls on one day being one.
      call_frequency: { actual: '50' },
      samples_distributed: { actual: '5' },
    });
    const team = (await api.abm.get(`/v1/performance/team?period=${MONTH}`)).json();
    expect(team.totals).toMatchObject({ call_frequency: { actual: '50' } });
  });
});
