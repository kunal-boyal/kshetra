import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { accountTypes } from '../src/db/schema/accounts';
import { sellThroughLines, sellThroughStatements } from '../src/db/schema/sell-through';
import { Database } from '../src/platform/database';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Sell-through by item, the agri template's liquidation (BR-53, decision D124). */

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

const ZONE = 'Asia/Kolkata';
const MONTH = () => todayIn(ZONE).slice(0, 7);
const shift = (period: string, months: number) => {
  const [year, month] = period.split('-').map(Number) as [number, number];
  const index = year * 12 + month - 1 + months;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}`;
};

type Method = 'GET' | 'POST' | 'PUT';
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
  };
}

/** An agri tenant: a head, an ASM, an SME holding a distributor, a farmer, and priced items. */
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
  // Farmers start switched off in the template; this tenant uses them.
  await app.get(Database).forTenant(tenantId, (tx) =>
    tx
      .update(accountTypes)
      .set({ active: true })
      .where(and(eq(accountTypes.tenantId, tenantId), eq(accountTypes.key, 'farmer'))),
  );
  const market = await world.territory(tenantId, `M-${newId().slice(-6)}`);
  const account = async (type: string, slots: object) => {
    const id = newId();
    const code = `${type.slice(0, 1).toUpperCase()}-${newId().slice(-6)}`;
    const made = await api.head.post('/v1/accounts', {
      id,
      type,
      code,
      name: `${type} ${newId().slice(-4)}`,
      territoryId: market,
      slots,
    });
    expect(made.statusCode, made.body).toBe(201);
    return { id, code };
  };
  const distributor = await account('distributor', { asm: asm.id, sme: sme.id });
  const farmer = await account('farmer', { sme: sme.id });
  const codes = new Map<string, string>();
  const item = async (code: string) => {
    const id = newId();
    codes.set(id, code);
    const made = await api.head.put(`/v1/items/${id}`, {
      code,
      name: `${code} item`,
      productName: `${code} product`,
      categoryName: null,
      packLabel: '500 ML',
      hsn: '3101',
      taxRate: '5',
      mrp: '450',
      baseUnit: 'pack',
      units: [{ key: 'case', factor: '12' }],
      measureType: 'L',
      measurePerBaseUnit: '0.5',
    });
    expect(made.statusCode, made.body).toBe(201);
    return id;
  };
  const neem = await item(`NEEM${newId().slice(-4)}`);
  const urea = await item(`UREA${newId().slice(-4)}`);
  const mop = await item(`MOP${newId().slice(-4)}`);
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
  return { tenantId, head, asm, sme, api, distributor, farmer, neem, urea, mop, codes };
}

type Agri = Awaited<ReturnType<typeof agri>>;

/** Last month's statement, as the database would hold it, for carrying forward. */
async function lastMonth(t: Agri, itemId: string, closing: string) {
  await app.get(Database).forTenant(t.tenantId, async (tx) => {
    const id = newId();
    await tx.insert(sellThroughStatements).values({
      id,
      tenantId: t.tenantId,
      accountId: t.distributor.id,
      period: shift(MONTH(), -1),
      version: 1,
      recordedBy: t.sme.id,
      creditedOn: `${shift(MONTH(), -1)}-28`,
    });
    await tx.insert(sellThroughLines).values({
      tenantId: t.tenantId,
      statementId: id,
      itemId,
      opening: '0',
      received: closing,
      returned: '0',
      closing,
      sold: '0',
    });
  });
}

const path = (t: Agri, period = MONTH()) =>
  `/v1/accounts/${t.distributor.id}/sell-through/${period}`;

describe('sell-through by item (D124)', () => {
  it('records a month carried forward, values it, and counts it as liquidation', async () => {
    const t = await agri('Liquid Agro');
    await lastMonth(t, t.neem, '40');
    const first = await t.api.sme.put(path(t), {
      id: newId(),
      lines: [
        { itemId: t.neem, received: '100', returned: '5', closing: '60' },
        { itemId: t.urea, received: '10', closing: '2' },
      ],
    });
    expect(first.statusCode, first.body).toBe(200);
    const statement = first.json().statement;
    expect(statement).toMatchObject({ version: 1, value: '27721.84', flags: [] });
    const neem = statement.lines.find((line: { item: { id: string } }) => line.item.id === t.neem);
    expect(neem).toMatchObject({
      opening: '40',
      carried: '40',
      sold: '75',
      unitPrice: '360.00',
      value: '27000.00',
    });
    // A second save changes urea alone; neem's line stays as it was.
    const second = await t.api.sme.put(path(t), {
      id: newId(),
      lines: [{ itemId: t.urea, received: '10', closing: '1' }],
    });
    expect(second.json().statement).toMatchObject({ version: 2, value: '27812.07' });
    expect(second.json().versions.map((entry: { version: number }) => entry.version)).toEqual([
      2, 1,
    ]);
    // The earlier version can still be read.
    const earlier = await t.api.asm.get(`${path(t)}/versions/1`);
    expect(earlier.json().statement).toMatchObject({ version: 1, value: '27721.84' });
    // The agri template's liquidation metric sums the latest version, for the SME.
    const month = (await t.api.sme.get(`/v1/performance?period=${MONTH()}`)).json();
    expect(month.figures.liquidation.actual).toBe('27812.07');
    // The manager reads it too, and the report has a row an item.
    const report = (await t.api.asm.get(`/v1/reports/sell_through?period=${MONTH()}`)).json();
    expect(report.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ account_code: t.distributor.code, sold: 75, value: 27000 }),
        expect.objectContaining({ account_code: t.distributor.code, sold: 9, value: 812.07 }),
      ]),
    );
  });

  it('flags what doesn’t add up and items without a price, never refusing them', async () => {
    const t = await agri('Flagged Agro');
    await lastMonth(t, t.neem, '40');
    const saved = await t.api.sme.put(path(t), {
      id: newId(),
      lines: [
        { itemId: t.neem, opening: '45', received: '0', closing: '10' },
        { itemId: t.mop, received: '0', closing: '4' },
      ],
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const lines = saved.json().statement.lines as { item: { id: string }; flags: string[] }[];
    expect(lines.find((line) => line.item.id === t.neem)!.flags).toEqual(['opening_changed']);
    expect(lines.find((line) => line.item.id === t.mop)).toMatchObject({
      sold: '-4',
      value: null,
      flags: ['negative_sold', 'no_price'],
    });
  });

  it('refuses a closed month, an account of another kind, and one out of reach', async () => {
    const t = await agri('Closed Agro');
    const lines = [{ itemId: t.urea, received: '1', closing: '0' }];
    const closed = await t.api.sme.put(path(t, shift(MONTH(), -2)), { id: newId(), lines });
    expect(closed.json().error.code).toBe('PERIOD_CLOSED');
    const ahead = await t.api.sme.put(path(t, shift(MONTH(), 1)), { id: newId(), lines });
    expect(ahead.json().error.code).toBe('PERIOD_CLOSED');
    const farmer = await t.api.sme.put(`/v1/accounts/${t.farmer.id}/sell-through/${MONTH()}`, {
      id: newId(),
      lines,
    });
    expect(farmer.statusCode).toBe(400);
    const other = await t.api.other.put(path(t), { id: newId(), lines });
    expect(other.json().error.code).toBe('OUT_OF_SCOPE');
    const sent = { id: newId(), lines };
    // The same save sent twice is applied once.
    expect((await t.api.sme.put(path(t), sent)).json().statement.version).toBe(1);
    expect((await t.api.sme.put(path(t), sent)).json().statement.version).toBe(1);
  });

  it('loads statements in bulk, a version per account’s month, counted for its SME', async () => {
    const t = await agri('Bulk Agro');
    const bulk = await t.api.head.post('/v1/bulk/sell-through', {
      rows: [
        {
          account_code: t.distributor.code,
          month: MONTH(),
          item_code: t.codes.get(t.neem),
          opening: '20',
          received: '30',
          closing: '5',
        },
      ],
    });
    expect(bulk.statusCode, bulk.body).toBe(200);
    expect(bulk.json()).toEqual({ created: 1, updated: 0 });
    const read = (
      await t.api.asm.get(`/v1/accounts/${t.distributor.id}/sell-through?period=${MONTH()}`)
    ).json();
    expect(read.statement).toMatchObject({ version: 1, recordedBy: { id: t.sme.id } });
    expect(read.statement.lines).toEqual([expect.objectContaining({ sold: '45' })]);
  });
});
