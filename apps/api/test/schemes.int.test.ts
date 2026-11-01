import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Schemes and promotions on orders (BR-55, decision D127), in an agri tenant. */

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
const TODAY = () => todayIn('Asia/Kolkata');
const fix = () => ({
  location: { lat: 28.6315, lng: 77.2167 },
  accuracy: 12,
  mocked: false,
  capturedAt: new Date().toISOString(),
});

/** A head, an ASM, an SME holding a distributor, and three items: two in one category. */
async function agri(name: string) {
  const tenantId = await world.tenant(name, 'active', 'agri');
  const phones = { head: newPhone(), asm: newPhone(), sme: newPhone() };
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
  await world.user(tenantId, { phone: phones.sme, designation: 'sme', managerId: asm.id });
  const smeId = (await world.signIn(phones.sme, newDevice())).accessToken;
  const api = {
    head: as((await world.signIn(phones.head)).accessToken),
    asm: as((await world.signIn(phones.asm)).accessToken),
    sme: as(smeId),
  };
  const market = await world.territory(tenantId, `M-${newId().slice(-6)}`);
  const distributor = newId();
  const sme = (await api.sme.get('/v1/me')).json();
  const made = await api.head.post('/v1/accounts', {
    id: distributor,
    type: 'distributor',
    code: `D-${newId().slice(-6)}`,
    name: 'Kisan Traders',
    territoryId: market,
    slots: { asm: asm.id, sme: sme.userId },
  });
  expect(made.statusCode, made.body).toBe(201);
  const item = async (itemCode: string, categoryName: string | null) => {
    const id = newId();
    const saved = await api.head.put(`/v1/items/${id}`, {
      code: itemCode,
      name: `${itemCode} item`,
      productName: `${itemCode} product`,
      categoryName,
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
  const neem = await item('NEEM', 'Pesticides');
  const karanj = await item('KARANJ', 'Pesticides');
  const urea = await item('UREA', null);
  const category = (await api.head.get('/v1/catalogue'))
    .json()
    .items.find((entry: { id: string }) => entry.id === neem).category.id as string;
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
  const prices: Record<string, { price: string; discount: string }> = {
    [neem]: { price: '400.00', discount: '10' },
    [karanj]: { price: '50.00', discount: '0' },
    [urea]: { price: '90.23', discount: '0' },
  };
  const priced = await api.head.put(`/v1/price-lists/${list}/items`, {
    set: Object.entries(prices).map(([itemId, entry]) => ({ itemId, ...entry })),
    version,
  });
  expect(priced.statusCode, priced.body).toBe(200);
  const scheme = async (key: string, body: object) => {
    const saved = await api.head.put(`/v1/schemes/${newId()}`, {
      key,
      name: { en: key, hi: key },
      validFrom: '2026-01-01',
      ...body,
    });
    expect(saved.statusCode, saved.body).toBe(201);
    return saved.json();
  };
  /** A line in cases, as the phone would show it, with the scheme it applied. */
  const line = (itemId: string, cases: string, scheme: object | null = null) => ({
    itemId,
    unitKey: 'case',
    quantity: cases,
    quoted: { listId: list, ...prices[itemId]!, taxRate: '18', factor: '12', scheme },
  });
  const order = (lines: object[], free: object[] = []) => ({
    id: newId(),
    accountId: distributor,
    lines,
    free,
    fix: fix(),
    placedAt: new Date().toISOString(),
  });
  return { tenantId, api, distributor, neem, karanj, urea, category, market, scheme, line, order };
}

describe('schemes (D127)', () => {
  it('are kept by those who manage them, keep their key, and are checked', async () => {
    const t = await agri('Scheme Admin Agro');
    const added = await t.scheme('five_off', { kind: 'percentage', rule: { percent: '5' } });
    expect(added).toMatchObject({ key: 'five_off', version: 1, active: true, itemIds: [] });
    const changed = await t.api.head.put(`/v1/schemes/${added.id}`, {
      ...added,
      id: undefined,
      updatedAt: undefined,
      rule: { percent: '6' },
    });
    expect(changed.statusCode, changed.body).toBe(200);
    expect(changed.json()).toMatchObject({ version: 2, rule: { percent: '6' } });
    const rekeyed = await t.api.head.put(`/v1/schemes/${added.id}`, {
      key: 'other',
      name: added.name,
      kind: 'percentage',
      rule: { percent: '6' },
      validFrom: '2026-01-01',
      version: 2,
    });
    expect(rekeyed.json().error.details).toEqual([
      { path: 'key', issue: 'A scheme keeps its key' },
    ]);
    const wrong = await t.api.head.put(`/v1/schemes/${newId()}`, {
      key: 'broken',
      name: { en: 'Broken', hi: 'Broken' },
      kind: 'slabs',
      rule: { slabs: [] },
      itemIds: [newId()],
      territoryIds: [newId()],
      validFrom: '2026-02-01',
      validTo: '2026-01-01',
    });
    expect(wrong.json().error.details.map((detail: { path: string }) => detail.path)).toEqual([
      'rule.slabs',
      'validTo',
      'itemIds.0',
      'territoryIds.0',
    ]);
    expect((await t.api.head.get('/v1/schemes')).json().items).toHaveLength(1);
    // A field person doesn't manage schemes.
    expect(code(await t.api.sme.get('/v1/schemes'))).toBe('FORBIDDEN');
  });

  it('FX-55: applies the scheme best for the customer, and refuses one the phone showed otherwise', async () => {
    const t = await agri('Best Scheme Agro');
    await t.scheme('five_off', { kind: 'percentage', rule: { percent: '5' } });
    await t.scheme('twenty_a_pack', { kind: 'flat_per_unit', rule: { amount: '20' } });
    await t.scheme('ended', {
      kind: 'percentage',
      rule: { percent: '50' },
      validTo: '2026-01-31',
    });
    // 2 cases of neem: 24 packs at 360, 8,640.00; 20 a pack beats 5%.
    const wrong = await t.api.sme.post(
      '/v1/orders',
      t.order([t.line(t.neem, '2', { key: 'five_off', discount: '432.00' })]),
    );
    expect(code(wrong)).toBe('PRICE_CHANGED');
    expect(wrong.json().error.details).toEqual([
      { path: 'lines[0].scheme', issue: 'Now twenty_a_pack, 480.00 off' },
    ]);
    expect(code(await t.api.sme.post('/v1/orders', t.order([t.line(t.neem, '2')])))).toBe(
      'PRICE_CHANGED',
    );
    const placed = await t.api.sme.post(
      '/v1/orders',
      t.order([t.line(t.neem, '2', { key: 'twenty_a_pack', discount: '480.00' })]),
    );
    expect(placed.statusCode, placed.body).toBe(201);
    expect(placed.json()).toMatchObject({
      lines: [
        {
          taxable: '8160.00',
          tax: '1468.80',
          total: '9628.80',
          scheme: { key: 'twenty_a_pack', kind: 'flat_per_unit', discount: '480.00' },
          freeOfLineId: null,
        },
      ],
      totals: { taxable: '8160.00', tax: '1468.80', total: '9628.80' },
    });
  });

  it('FX-56: reaches a slab by every line of its category in the order', async () => {
    const t = await agri('Slab Agro');
    await t.scheme('volume', {
      kind: 'slabs',
      categoryIds: [t.category],
      rule: {
        slabs: [
          { from: '100', percent: '2' },
          { from: '250', percent: '4' },
          { from: '500', percent: '6' },
        ],
      },
    });
    // 156 packs of neem (56,160.00) and 120 of karanj (6,000.00): 276 reach 4%; urea is outside.
    const placed = await t.api.sme.post(
      '/v1/orders',
      t.order([
        t.line(t.neem, '13', { key: 'volume', discount: '2246.40' }),
        t.line(t.karanj, '10', { key: 'volume', discount: '240.00' }),
        t.line(t.urea, '1'),
      ]),
    );
    expect(placed.statusCode, placed.body).toBe(201);
    expect(
      placed
        .json()
        .lines.map(
          (entry: { scheme: { discount: string } | null }) => entry.scheme?.discount ?? null,
        ),
    ).toEqual(['2246.40', '240.00', null]);
  });

  it('FX-57: gives free goods as their own line, which follows its line’s decision', async () => {
    const t = await agri('Free Goods Agro');
    await t.scheme('ten_plus_one', {
      kind: 'free_goods',
      itemIds: [t.urea],
      rule: { buy: '10', get: '1' },
    });
    // 3 cases of urea are 36 packs: 3 free.
    const lines = [
      t.line(t.neem, '1'),
      t.line(t.urea, '3', { key: 'ten_plus_one', discount: '0.00' }),
    ];
    expect(code(await t.api.sme.post('/v1/orders', t.order(lines)))).toBe('PRICE_CHANGED');
    const body = t.order(lines, [{ itemId: t.urea, baseUnits: '3', ofItemId: t.urea }]);
    const placed = await t.api.sme.post('/v1/orders', body);
    expect(placed.statusCode, placed.body).toBe(201);
    const [neemLine, ureaLine, freeLine] = placed.json().lines;
    expect(freeLine).toMatchObject({
      position: 3,
      item: { id: t.urea },
      unitKey: 'pack',
      baseUnits: '3.000',
      price: '0.00',
      taxable: '0.00',
      total: '0.00',
      freeOfLineId: ureaLine.id,
      scheme: { key: 'ten_plus_one' },
    });

    // The ASM accepts; the head rejects the urea line, and its free goods go with it.
    const seen = (await t.api.asm.get(`/v1/orders/${body.id}`)).json();
    await t.api.asm.post(`/v1/orders/${body.id}/decision`, {
      decision: 'accept',
      version: seen.approval.version,
    });
    const atHead = (await t.api.head.get(`/v1/orders/${body.id}`)).json();
    const free = await t.api.head.post(`/v1/orders/${body.id}/line-decisions`, {
      lines: [
        { lineId: neemLine.id, decision: 'accepted' },
        { lineId: ureaLine.id, decision: 'accepted' },
        { lineId: freeLine.id, decision: 'accepted' },
      ],
      version: atHead.approval.version,
    });
    expect(free.json().error.details).toEqual([
      { path: 'lines[2].lineId', issue: 'This order has no such line' },
    ]);
    const decided = await t.api.head.post(`/v1/orders/${body.id}/line-decisions`, {
      lines: [
        { lineId: neemLine.id, decision: 'accepted' },
        { lineId: ureaLine.id, decision: 'rejected', reason: 'no_stock' },
      ],
      version: atHead.approval.version,
    });
    expect(decided.json()).toMatchObject({
      status: 'partially_accepted',
      lines: [
        { decision: 'accepted' },
        { decision: 'rejected' },
        { decision: 'rejected', decisionReason: 'no_stock' },
      ],
    });
  });

  it('FX-58: reaches only its account types and territories, and reports what it gave', async () => {
    const t = await agri('Scoped Agro');
    await t.scheme('retail_only', {
      kind: 'percentage',
      accountTypeKeys: ['retailer'],
      rule: { percent: '10' },
    });
    await t.scheme('this_market', {
      kind: 'percentage',
      territoryIds: [t.market],
      rule: { percent: '3' },
    });
    // The order desk and the phone read the schemes that may reach the account.
    const reaching = (await t.api.sme.get(`/v1/accounts/${t.distributor}/schemes`)).json();
    expect(reaching.account).toMatchObject({ type: 'distributor' });
    expect(reaching.account.territories[0]).toBe(t.market);
    expect(reaching.schemes.map((entry: { key: string }) => entry.key)).toEqual(['this_market']);
    const placed = await t.api.sme.post(
      '/v1/orders',
      t.order([t.line(t.urea, '2', { key: 'this_market', discount: '64.97' })]),
    );
    expect(placed.statusCode, placed.body).toBe(201);
    const summary = (
      await t.api.head.get(`/v1/reports/scheme_summary?period=${TODAY().slice(0, 7)}`)
    ).json();
    expect(summary.rows).toEqual([
      expect.objectContaining({
        scheme_key: 'this_market',
        orders: 1,
        lines: 1,
        discount: 64.97,
        free_units: 0,
      }),
    ]);
    const register = (
      await t.api.head.get(`/v1/reports/orders_register?period=${TODAY().slice(0, 7)}`)
    ).json();
    expect(register.rows[0]).toMatchObject({ scheme: 'this_market', scheme_discount: 64.97 });
  });

  it('go with the orders module', async () => {
    const t = await agri('Moduleless Agro');
    const off = await t.api.head.patch('/v1/settings', { modulesOff: ['orders'] });
    expect(off.statusCode, off.body).toBe(200);
    expect(code(await t.api.head.get('/v1/schemes'))).toBe('MODULE_DISABLED');
  });
});
