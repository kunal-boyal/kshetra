import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Items edited in the portal, price lists and what an account pays (spec 5.11, D77). */

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
    upload: (body: string) =>
      app.inject({
        method: 'POST',
        url: '/v1/imports?target=items&fileName=items.csv',
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}

const TODAY = () => todayIn('Asia/Kolkata');

/** An agri tenant with its admin, a field user on a phone, and a market inside a zone. */
async function agri(name: string) {
  const tenantId = await world.tenant(name, 'active', 'agri');
  const phones = { admin: newPhone(), sme: newPhone() };
  await world.user(tenantId, {
    phone: phones.admin,
    designation: 'business_head',
    role: 'tenant_admin',
  });
  await world.user(tenantId, { phone: phones.sme, designation: 'sme' });
  const zone = await world.territory(tenantId, `Z-${newId().slice(-6)}`);
  const market = await world.territory(tenantId, `M-${newId().slice(-6)}`, zone);
  return {
    tenantId,
    zone,
    market,
    admin: as((await world.signIn(phones.admin)).accessToken),
    sme: as((await world.signIn(phones.sme, newDevice())).accessToken),
  };
}

type Tenant = Awaited<ReturnType<typeof agri>>;

const ITEM = {
  code: 'NEEM-500',
  name: 'Neem Shield 500 ML',
  productName: 'Neem Shield',
  categoryName: 'Bio pesticides',
  packLabel: '500 ML',
  hsn: '3808',
  taxRate: '18',
  mrp: '450',
  baseUnit: 'pack',
  units: [{ key: 'case', factor: '20' }],
  measureType: 'L',
  measurePerBaseUnit: '0.5',
  custom: {},
  active: true,
};

async function item(t: Tenant, overrides: Partial<typeof ITEM> = {}) {
  const id = newId();
  const made = await t.admin.put(`/v1/items/${id}`, { ...ITEM, ...overrides });
  expect(made.statusCode, made.body).toBe(201);
  return id;
}

async function priceList(t: Tenant, body: object) {
  const id = newId();
  const made = await t.admin.put(`/v1/price-lists/${id}`, {
    validFrom: '2026-01-01',
    ...body,
  });
  expect(made.statusCode, made.body).toBe(201);
  return id;
}

async function setPrices(t: Tenant, listId: string, set: object[], remove: string[] = []) {
  const { version } = (await t.admin.get(`/v1/price-lists/${listId}`)).json();
  const saved = await t.admin.put(`/v1/price-lists/${listId}/items`, { set, remove, version });
  expect(saved.statusCode, saved.body).toBe(200);
  return saved.json();
}

describe('items in the portal (spec 5.11)', () => {
  it('adds an item with its own ID, replaces it, and checks units, measure and code', async () => {
    const t = await agri('Items Agro');
    const id = newId();
    const added = await t.admin.put(`/v1/items/${id}`, ITEM);
    expect(added.statusCode).toBe(201);
    expect(added.json()).toMatchObject({
      id,
      code: 'NEEM-500',
      product: { name: 'Neem Shield' },
      category: { name: 'Bio pesticides' },
      units: [
        { key: 'pack', factor: '1.000' },
        { key: 'case', factor: '20.000' },
      ],
      measurePerBaseUnit: '0.500000',
      taxRate: '18.0000',
    });
    const replaced = await t.admin.put(`/v1/items/${id}`, { ...ITEM, name: 'Neem Shield 0.5 L' });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().name).toBe('Neem Shield 0.5 L');
    expect((await t.sme.get('/v1/catalogue')).json().items).toHaveLength(1);

    const wrong = await t.admin.put(`/v1/items/${newId()}`, {
      ...ITEM,
      code: 'neem-500',
      units: [{ key: 'crate', factor: '10' }],
      measurePerBaseUnit: '0.4',
    });
    expect(wrong.statusCode).toBe(400);
    expect(
      wrong
        .json()
        .error.details.map((detail: { path: string }) => detail.path)
        .sort(),
    ).toEqual(['code', 'packLabel', 'units.0.key']);
    const field = await t.sme.put(`/v1/items/${newId()}`, ITEM);
    expect(field.json().error.code).toBe('FORBIDDEN');
  });
});

describe('price lists (spec 5.11, BR-10)', () => {
  it('keeps prices on a list at its version, and pages them by item code', async () => {
    const t = await agri('Lists Agro');
    const neem = await item(t);
    const urea = await item(t, {
      code: 'UREA-1',
      name: 'Urea Plus 1 KG',
      productName: 'Urea Plus',
      packLabel: '1 KG',
      measureType: 'kg',
      measurePerBaseUnit: '1',
    });
    const listId = await priceList(t, { name: 'Standard', scope: 'default' });
    const list = await setPrices(t, listId, [
      { itemId: neem, price: '400', discount: '10' },
      { itemId: urea, price: '99.99', discount: '12.5' },
    ]);
    expect(list).toMatchObject({ version: 2, itemCount: 2 });

    const first = (await t.admin.get(`/v1/price-lists/${listId}/items?limit=1`)).json();
    expect(first.items).toEqual([
      {
        item: expect.objectContaining({ code: 'NEEM-500', baseUnit: 'pack' }),
        price: '400.00',
        discount: '10.0000',
        rate: '360.00',
      },
    ]);
    const second = (
      await t.admin.get(`/v1/price-lists/${listId}/items?limit=1&cursor=${first.nextCursor}`)
    ).json();
    expect(second).toMatchObject({ items: [{ rate: '87.49' }], nextCursor: null });

    const stale = await t.admin.put(`/v1/price-lists/${listId}/items`, {
      set: [{ itemId: neem, price: '410' }],
      version: 1,
    });
    expect(stale.json().error.code).toBe('CONFLICT');
    expect(await setPrices(t, listId, [], [urea])).toMatchObject({ version: 3, itemCount: 1 });

    const twin = await t.admin.put(`/v1/price-lists/${newId()}`, {
      name: 'standard',
      scope: 'default',
      validFrom: '2026-01-01',
    });
    expect(twin.json().error).toMatchObject({ code: 'CONFLICT', details: [{ path: 'name' }] });
    const unknown = await t.admin.put(`/v1/price-lists/${newId()}`, {
      name: 'Dealers',
      scope: 'account_type',
      targets: ['dealer'],
      validFrom: '2026-01-01',
    });
    expect(unknown.json().error.details).toEqual([
      { path: 'targets.0', issue: 'There is no account type with this key' },
    ]);
    expect((await t.sme.get('/v1/price-lists')).json().error.code).toBe('FORBIDDEN');
  });

  it("prices an account from its own list, its territory's, its type's, then the default", async () => {
    const t = await agri('Pricing Agro');
    const [a, b, c, d] = await Promise.all(
      ['A', 'B', 'C', 'D'].map((code) =>
        item(t, {
          code: `ITEM-${code}`,
          packLabel: null,
          measureType: null,
          measurePerBaseUnit: null,
        } as never),
      ),
    );
    const accountId = newId();
    const made = await t.admin.post('/v1/accounts', {
      id: accountId,
      type: 'retailer',
      code: `R-${newId().slice(-6)}`,
      name: 'Sharma Agro Kendra',
      territoryId: t.market,
      slots: {},
    });
    expect(made.statusCode, made.body).toBe(201);

    const standard = await priceList(t, { name: 'Standard', scope: 'default' });
    const retail = await priceList(t, {
      name: 'Retail',
      scope: 'account_type',
      targets: ['retailer'],
    });
    const zone = await priceList(t, { name: 'Zone', scope: 'territory', targets: [t.zone] });
    const own = await priceList(t, { name: 'Sharma', scope: 'account', targets: [accountId] });
    const later = await priceList(t, {
      name: 'Next year',
      scope: 'account',
      targets: [accountId],
      validFrom: '2099-01-01',
    });
    await setPrices(t, standard, [
      { itemId: a!, price: '100' },
      { itemId: b!, price: '100' },
      { itemId: c!, price: '100' },
      { itemId: d!, price: '100' },
    ]);
    await setPrices(t, retail, [
      { itemId: b!, price: '90' },
      { itemId: c!, price: '90' },
    ]);
    await setPrices(t, zone, [{ itemId: c!, price: '80', discount: '5' }]);
    await setPrices(t, own, [{ itemId: d!, price: '70' }]);
    await setPrices(t, later, [{ itemId: a!, price: '1' }]);

    const prices = await t.sme.get(`/v1/accounts/${accountId}/prices`);
    // The field user doesn't look after this account.
    expect(prices.json().error.code).toBe('OUT_OF_SCOPE');
    const read = (await t.admin.get(`/v1/accounts/${accountId}/prices`)).json();
    expect(read.date).toBe(TODAY());
    expect(read.lists.map((list: { name: string }) => list.name)).toEqual([
      'Sharma',
      'Zone',
      'Retail',
      'Standard',
    ]);
    const by = new Map(
      read.items.map((entry: { itemId: string }) => [entry.itemId, entry] as const),
    );
    expect(by.get(a!)).toMatchObject({ listId: standard, rate: '100.00' });
    expect(by.get(b!)).toMatchObject({ listId: retail, rate: '90.00' });
    expect(by.get(c!)).toMatchObject({ listId: zone, discount: '5.0000', rate: '76.00' });
    expect(by.get(d!)).toMatchObject({ listId: own, rate: '70.00' });

    const future = (await t.admin.get(`/v1/accounts/${accountId}/prices?date=2099-06-01`)).json();
    expect(future.items.find((entry: { itemId: string }) => entry.itemId === a)).toMatchObject({
      listId: later,
      rate: '1.00',
    });
  });

  it('imports prices with items, checking expected prices within 0.02 (BR-17)', async () => {
    const t = await agri('Import Prices Agro');
    const standard = await priceList(t, { name: 'Standard', scope: 'default' });
    await priceList(t, { name: 'Dealer', scope: 'account_type', targets: ['distributor'] });
    const header = [
      'Item code',
      'Item name',
      'Product name',
      'Pack size',
      'Base unit',
      'GST rate',
      'DBP per SKU',
      'Product discount',
      'Credit price per SKU pre GST',
      'Final price',
      'Price list',
    ];
    const csv = (rows: string[][]) =>
      [header, ...rows].map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');
    const run = async (rows: string[][]) => {
      const uploaded = await t.admin.upload(csv(rows));
      expect(uploaded.statusCode).toBe(201);
      const id = uploaded.json().id as string;
      const imports = app.get(ImportsService);
      await imports.read(t.tenantId, id);
      const read = (await t.admin.get(`/v1/imports/${id}`)).json();
      await t.admin.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping });
      await imports.check(t.tenantId, id);
      const checked = (await t.admin.get(`/v1/imports/${id}`)).json();
      if (checked.status !== 'ready') return checked;
      await t.admin.post(`/v1/imports/${id}/commit`);
      await imports.write(t.tenantId, id);
      return (await t.admin.get(`/v1/imports/${id}`)).json();
    };

    const refused = await run([
      ['NEEM-500', 'Neem 500 ML', 'Neem', '500 ML', 'pack', '0.18', '400', '0.1', '360.05', '', ''],
      ['UREA-1', 'Urea 1 KG', 'Urea', '1 KG', 'pack', '5', '', '5', '', '', ''],
      ['ZINC-1', 'Zinc 1 KG', 'Zinc', '1 KG', 'pack', '5', '50', '', '', '', 'Wholesale'],
    ]);
    expect(refused.status).toBe('invalid');
    expect(
      refused.errors.map((problem: { row: number; field: string }) => [problem.row, problem.field]),
    ).toEqual([
      [2, 'expected_net_price'],
      [3, 'price'],
      [4, 'price_list'],
    ]);

    const done = await run([
      [
        'NEEM-500',
        'Neem 500 ML',
        'Neem',
        '500 ML',
        'pack',
        '0.18',
        '400',
        '0.1',
        '360',
        '424.80',
        '',
      ],
      ['ZINC-1', 'Zinc 1 KG', 'Zinc', '1 KG', 'pack', '5', '50', '', '', '', 'dealer'],
    ]);
    expect(done).toMatchObject({ status: 'committed', created: 2 });
    const entries = (await t.admin.get(`/v1/price-lists/${standard}/items`)).json().items;
    expect(entries).toEqual([
      expect.objectContaining({
        item: expect.objectContaining({ code: 'NEEM-500' }),
        price: '400.00',
        discount: '10.0000',
        rate: '360.00',
      }),
    ]);
    const lists = (await t.admin.get('/v1/price-lists')).json().items;
    expect(
      lists.map((list: { name: string; itemCount: number }) => [list.name, list.itemCount]),
    ).toEqual([
      ['Standard', 1],
      ['Dealer', 1],
    ]);
  });
});
