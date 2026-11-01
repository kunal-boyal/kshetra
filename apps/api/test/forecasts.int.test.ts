import { newId, shiftPeriod, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { orders } from '../src/db/schema/orders';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Product forecasts per account, kept as versions and locked as each month begins (BR-54, D126). */

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

const MONTH = () => todayIn('Asia/Kolkata').slice(0, 7);
const NEXT = () => shiftPeriod(MONTH(), 1);

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH';
function as(token: string) {
  const call = (method: Method, url: string, payload?: object) =>
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
    patch: (url: string, payload: object) => call('PATCH', url, payload),
  };
}

const code = (response: { json(): { error?: { code: string } } }) => response.json().error?.code;

/** An agri tenant: a head, an ASM, an SME holding a distributor, another SME, and priced items. */
async function agri(name: string) {
  const tenantId = await world.tenant(name, 'active', 'agri');
  const phones = { head: newPhone(), asm: newPhone(), sme: newPhone(), other: newPhone() };
  const head = await world.user(tenantId, {
    phone: phones.head,
    designation: 'business_head',
    role: 'tenant_admin',
  });
  const asm = await world.user(tenantId, {
    phone: phones.asm,
    designation: 'asm',
    role: 'manager',
    managerId: head.id,
  });
  const sme = await world.user(tenantId, {
    phone: phones.sme,
    designation: 'sme',
    managerId: asm.id,
  });
  await world.user(tenantId, { phone: phones.other, designation: 'sme', managerId: head.id });
  const api = {
    head: as((await world.signIn(phones.head)).accessToken),
    asm: as((await world.signIn(phones.asm)).accessToken),
    sme: as((await world.signIn(phones.sme, newDevice())).accessToken),
    other: as((await world.signIn(phones.other, newDevice())).accessToken),
  };
  const market = await world.territory(tenantId, `M-${newId().slice(-6)}`);
  const distributor = { id: newId(), code: `D-${newId().slice(-6)}` };
  const made = await api.head.post('/v1/accounts', {
    ...distributor,
    type: 'distributor',
    name: `Distributor ${newId().slice(-4)}`,
    territoryId: market,
    slots: { asm: asm.id, sme: sme.id },
  });
  expect(made.statusCode, made.body).toBe(201);
  const codes = new Map<string, string>();
  const item = async (prefix: string) => {
    const id = newId();
    const itemCode = `${prefix}${newId().slice(-4)}`;
    codes.set(id, itemCode);
    const saved = await api.head.put(`/v1/items/${id}`, {
      code: itemCode,
      name: `${prefix} item`,
      productName: `${prefix} product`,
      categoryName: null,
      packLabel: '500 ML',
      hsn: '3808',
      taxRate: '18',
      mrp: '450',
      baseUnit: 'pack',
      units: [{ key: 'case', factor: '12' }],
      measureType: 'L',
      measurePerBaseUnit: '0.5',
    });
    expect(saved.statusCode, saved.body).toBe(201);
    return id;
  };
  const neem = await item('NEEM');
  const urea = await item('UREA');
  const list = newId();
  expect(
    (
      await api.head.put(`/v1/price-lists/${list}`, {
        name: 'Standard',
        scope: 'default',
        validFrom: '2026-01-01',
      })
    ).statusCode,
  ).toBe(201);
  const { version } = (await api.head.get(`/v1/price-lists/${list}`)).json();
  const priced = await api.head.put(`/v1/price-lists/${list}/items`, {
    set: [
      { itemId: neem, price: '400', discount: '10' },
      { itemId: urea, price: '90.23' },
    ],
    version,
  });
  expect(priced.statusCode, priced.body).toBe(200);
  return { tenantId, head, asm, sme, api, distributor, neem, urea, list, codes };
}

type Agri = Awaited<ReturnType<typeof agri>>;

const path = (t: Agri, period: string) => `/v1/accounts/${t.distributor.id}/forecasts/${period}`;

/** An order of `cases` cases of an item, placed by the SME and accepted, as its chain would. */
async function accepted(t: Agri, itemId: string, cases: string) {
  const id = newId();
  const placed = await t.api.sme.post('/v1/orders', {
    id,
    accountId: t.distributor.id,
    lines: [
      {
        itemId,
        unitKey: 'case',
        quantity: cases,
        quoted: {
          listId: t.list,
          price: itemId === t.neem ? '400.00' : '90.23',
          discount: itemId === t.neem ? '10' : '0',
          taxRate: '18',
          factor: '12',
        },
      },
    ],
    fix: {
      location: { lat: 28.6315, lng: 77.2167 },
      accuracy: 12,
      mocked: false,
      capturedAt: new Date().toISOString(),
    },
    placedAt: new Date().toISOString(),
  });
  expect(placed.statusCode, placed.body).toBe(201);
  await app.get(Database).forTenant(t.tenantId, (tx) =>
    tx
      .update(orders)
      .set({ status: 'accepted' })
      .where(and(eq(orders.tenantId, t.tenantId), eq(orders.id, id))),
  );
}

describe('forecasts by account and item (D126)', () => {
  it('keeps every save as a version over the last, 0 taking an item out', async () => {
    const t = await agri('Forecast Agro');
    const first = await t.api.sme.put(path(t, NEXT()), {
      id: newId(),
      lines: [
        { itemId: t.neem, quantity: '120' },
        { itemId: t.urea, quantity: '40.5' },
      ],
    });
    expect(first.statusCode, first.body).toBe(200);
    const [month] = first.json().months;
    expect(month).toMatchObject({ period: NEXT(), open: true });
    expect(month.lines.map((line: { quantity: string }) => line.quantity).sort()).toEqual([
      '120',
      '40.5',
    ]);
    // A second save, as from a phone offline: urea goes, neem changes, nothing else is lost.
    const second = await t.api.sme.put(path(t, NEXT()), {
      id: newId(),
      lines: [
        { itemId: t.urea, quantity: '0' },
        { itemId: t.neem, quantity: '150' },
      ],
    });
    const after = second.json().months[0];
    expect(after.lines).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ id: t.neem }), quantity: '150' }),
    ]);
    expect(after.versions.map((entry: { version: number }) => entry.version)).toEqual([2, 1]);
    expect(after.versions[0]).toMatchObject({ recordedBy: { id: t.sme.id }, afterLock: false });
    // The manager reads the window; the same save sent twice is applied once.
    const read = await t.api.asm.get(
      `/v1/accounts/${t.distributor.id}/forecasts?from=${NEXT()}&to=${shiftPeriod(NEXT(), 2)}`,
    );
    expect(read.json().months.map((entry: { period: string }) => entry.period)).toEqual([
      NEXT(),
      shiftPeriod(NEXT(), 1),
      shiftPeriod(NEXT(), 2),
    ]);
    const sent = { id: newId(), lines: [{ itemId: t.urea, quantity: '10' }] };
    expect((await t.api.sme.put(path(t, NEXT()), sent)).json().months[0].versions).toHaveLength(3);
    expect((await t.api.sme.put(path(t, NEXT()), sent)).json().months[0].versions).toHaveLength(3);
  });

  it('locks a month on its 1st: a manager may change it with a reason, nobody past it', async () => {
    const t = await agri('Locked Agro');
    const lines = [{ itemId: t.neem, quantity: '10' }];
    // The field person can't change this month any more.
    expect(code(await t.api.sme.put(path(t, MONTH()), { id: newId(), lines }))).toBe(
      'PERIOD_CLOSED',
    );
    // The manager can, but must say why.
    const unexplained = await t.api.asm.put(path(t, MONTH()), { id: newId(), lines });
    expect(unexplained.statusCode).toBe(400);
    expect(unexplained.json().error.details).toEqual([expect.objectContaining({ path: 'reason' })]);
    const changed = await t.api.asm.put(path(t, MONTH()), {
      id: newId(),
      lines,
      reason: 'Rains came early',
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json().months[0]).toMatchObject({ open: false });
    expect(changed.json().months[0].versions[0]).toMatchObject({
      afterLock: true,
      reason: 'Rains came early',
      recordedBy: { id: t.asm.id },
    });
    // Last month is past even for the manager, and the window ends three months on.
    expect(
      code(
        await t.api.asm.put(path(t, shiftPeriod(MONTH(), -1)), {
          id: newId(),
          lines,
          reason: 'Late',
        }),
      ),
    ).toBe('PERIOD_CLOSED');
    const beyond = await t.api.sme.put(path(t, shiftPeriod(MONTH(), 4)), { id: newId(), lines });
    expect(beyond.statusCode).toBe(400);
    // Someone who doesn't see the account can't forecast it.
    expect(code(await t.api.other.put(path(t, NEXT()), { id: newId(), lines }))).toBe(
      'OUT_OF_SCOPE',
    );
  });

  it('loads forecasts in bulk, for the account’s field person, open months only', async () => {
    const t = await agri('Bulk Forecast Agro');
    const row = (month: string, quantity: string) => ({
      account_code: t.distributor.code,
      month,
      item_code: t.codes.get(t.neem),
      quantity,
    });
    const refused = await t.api.head.post('/v1/bulk/forecasts', { rows: [row(MONTH(), '5')] });
    expect(refused.statusCode).toBe(400);
    const bulk = await t.api.head.post('/v1/bulk/forecasts', {
      rows: [row(NEXT(), '25'), row(shiftPeriod(NEXT(), 1), '30')],
    });
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect(bulk.json()).toEqual({ created: 2, updated: 0 });
    const read = (
      await t.api.asm.get(
        `/v1/accounts/${t.distributor.id}/forecasts?from=${NEXT()}&to=${shiftPeriod(NEXT(), 1)}`,
      )
    ).json();
    expect(read.months[0].versions[0]).toMatchObject({ version: 1, recordedBy: { id: t.sme.id } });
    expect(read.months[1].lines).toEqual([expect.objectContaining({ quantity: '30' })]);
  });

  it('reports the gap and accuracy against orders, and against the account plan', async () => {
    const t = await agri('Accuracy Agro');
    // This month's forecast, changed after the lock: neem 2 cases (24 packs), urea 10 packs.
    const saved = await t.api.asm.put(path(t, MONTH()), {
      id: newId(),
      lines: [
        { itemId: t.neem, quantity: '24' },
        { itemId: t.urea, quantity: '10' },
      ],
      reason: 'Set late',
    });
    expect(saved.statusCode, saved.body).toBe(200);
    // Neem came in at 3 cases (36 packs); urea was never ordered.
    await accepted(t, t.neem, '3');
    const report = (await t.api.asm.get(`/v1/reports/forecast_accuracy?period=${MONTH()}`)).json();
    expect(report.columns.map((column: { key: string }) => column.key)).toContain('ordered');
    // Accuracy is 1 − (12 + 10) ÷ 34, about 35.29%, on every row of the account.
    expect(report.rows).toEqual([
      expect.objectContaining({
        account_code: t.distributor.code,
        item_code: t.codes.get(t.neem),
        forecast: 24,
        ordered: 36,
        gap: 12,
        gap_share: 50,
        accuracy: 35.29,
      }),
      expect.objectContaining({ item_code: t.codes.get(t.urea), forecast: 10, ordered: 0 }),
    ]);
    // A manager of another team sees none of it.
    const phone = newPhone();
    await world.user(t.tenantId, {
      phone,
      designation: 'asm',
      role: 'manager',
      managerId: t.head.id,
    });
    const elsewhere = as((await world.signIn(phone)).accessToken);
    const theirs = await elsewhere.get(`/v1/reports/forecast_accuracy?period=${MONTH()}`);
    expect(theirs.statusCode, theirs.body).toBe(200);
    expect(theirs.json().rows).toEqual([]);

    // Named against a money metric, the forecast's value sits beside the account plan.
    expect(
      (await t.api.head.patch('/v1/settings', { forecastPlanMetric: 'order_value' })).statusCode,
    ).toBe(200);
    expect(
      (
        await t.api.asm.put('/v1/account-plans', {
          accountId: t.distributor.id,
          period: MONTH(),
          values: { order_value: '12000' },
        })
      ).statusCode,
    ).toBe(200);
    const valued = (await t.api.asm.get(`/v1/reports/forecast_accuracy?period=${MONTH()}`)).json();
    // 24 packs of neem at 360 and 10 of urea at 90.23.
    expect(valued.rows[0]).toMatchObject({ forecast_value: 9542.3, plan_value: 12000 });

    // With the orders module off, the actuals are what sold through, and the column goes.
    expect((await t.api.head.patch('/v1/settings', { modulesOff: ['orders'] })).statusCode).toBe(
      200,
    );
    const unordered = (
      await t.api.asm.get(`/v1/reports/forecast_accuracy?period=${MONTH()}`)
    ).json();
    expect(unordered.columns.map((column: { key: string }) => column.key)).not.toContain('ordered');
    expect(unordered.rows[0]).toMatchObject({ forecast: 24, sold: null, gap: -24, accuracy: 0 });
  });
});
