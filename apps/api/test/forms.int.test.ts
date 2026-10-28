import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Forms (spec 5.6), the catalogue and the item import (spec 5.11, Appendix B.3, D38). */

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
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    payload?: object,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId(), ...headers },
      ...(payload ? { payload } : {}),
    });
  return {
    get: (url: string, headers?: Record<string, string>) => call('GET', url, undefined, headers),
    post: (url: string, payload?: object) => call('POST', url, payload),
    put: (url: string, payload: object) => call('PUT', url, payload),
    patch: (url: string, payload: object) => call('PATCH', url, payload),
    upload: (target: string, body: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/imports?target=${target}&fileName=items.csv`,
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}

/** An agri tenant with its admin, and a field user on a phone. */
async function agri(name: string) {
  const tenantId = await world.tenant(name, 'active', 'agri');
  const phones = { admin: newPhone(), sme: newPhone() };
  await world.user(tenantId, {
    phone: phones.admin,
    designation: 'business_head',
    role: 'tenant_admin',
  });
  await world.user(tenantId, { phone: phones.sme, designation: 'sme' });
  return {
    tenantId,
    admin: as((await world.signIn(phones.admin)).accessToken),
    sme: as((await world.signIn(phones.sme, newDevice())).accessToken),
  };
}

const text = (en: string) => ({ en, hi: en });
const noun = (one: string, other: string) => ({ en: { one, other }, hi: { one, other } });

function survey(fields: object[] = [{ key: 'notes', type: 'long_text', label: text('Notes') }]) {
  return {
    key: 'shop_survey',
    name: noun('Shop survey', 'Shop surveys'),
    icon: 'clipboard-list',
    fields,
  };
}

describe('forms (spec 5.6)', () => {
  it("provisions the template's forms, and gives phones the ones in use", async () => {
    const t = await agri('Forms Agro');
    const listed = (await t.admin.get('/v1/forms')).json().items as {
      key: string;
      version: number;
    }[];
    expect(listed.map((form) => form.key)).toEqual([
      'distributor_visit',
      'farmer_meeting',
      'farmer_visit',
      'new_distributor_appointment',
      'product_demo',
      'retailer_visit',
    ]);
    expect(listed.every((form) => form.version === 1)).toBe(true);
    const bundle = (await t.sme.get('/v1/config')).json();
    expect(bundle.forms.length).toBeGreaterThan(0);
    expect((await t.sme.get('/v1/forms')).json().error.code).toBe('FORBIDDEN');
  });

  it('adds a form, publishes versions that keep keys and field types, and switches it off', async () => {
    const t = await agri('Versions Agro');
    const created = await t.admin.post('/v1/forms', { definition: survey() });
    expect(created.statusCode).toBe(201);
    const form = created.json();
    expect(form).toMatchObject({ key: 'shop_survey', version: 1, active: true });
    expect((await t.admin.post('/v1/forms', { definition: survey() })).json().error.code).toBe(
      'CONFLICT',
    );
    const broken = await t.admin.post('/v1/forms', {
      definition: {
        ...survey([{ key: 'who', type: 'contact_picker', label: text('Who') }]),
        key: 'other',
      },
    });
    expect(broken.json().error.details).toEqual([
      {
        path: 'definition.fields[0]',
        issue: 'A contact picker needs the form to link to an account',
      },
    ]);

    const before = (await t.sme.get('/v1/config')).json();
    const rekeyed = await t.admin.post(`/v1/forms/${form.id}/versions`, {
      definition: { ...survey(), key: 'renamed' },
    });
    expect(rekeyed.json().error.details).toEqual([
      { path: 'definition.key', issue: 'A form keeps its key' },
    ]);
    const retyped = await t.admin.post(`/v1/forms/${form.id}/versions`, {
      definition: survey([{ key: 'notes', type: 'number', label: text('Notes') }]),
    });
    expect(retyped.json().error.details).toEqual([
      {
        path: 'definition.fields',
        issue: '`notes` was a long_text field, and a key keeps its type',
      },
    ]);
    const second = await t.admin.post(`/v1/forms/${form.id}/versions`, {
      definition: survey([
        { key: 'notes', type: 'long_text', label: text('Notes') },
        {
          key: 'gstin',
          type: 'short_text',
          label: text('GSTIN'),
          pattern: '[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]{3}',
        },
      ]),
    });
    expect(second.json()).toMatchObject({ version: 2 });
    const after = (await t.sme.get('/v1/config')).json();
    expect(after.version).toBeGreaterThan(before.version);
    expect(after.forms.find((entry: { key: string }) => entry.key === 'shop_survey')).toMatchObject(
      {
        version: 2,
      },
    );

    await t.admin.patch(`/v1/forms/${form.id}`, { active: false });
    const off = (await t.sme.get('/v1/config')).json();
    expect(off.forms.some((entry: { key: string }) => entry.key === 'shop_survey')).toBe(false);
    const listed = (await t.admin.get('/v1/forms')).json().items;
    expect(listed.find((entry: { key: string }) => entry.key === 'shop_survey')).toMatchObject({
      active: false,
      version: 2,
    });
  });
});

describe('the catalogue (spec 5.11)', () => {
  const HEADER = [
    'Item code',
    'Item name',
    'Product name',
    'Category',
    'Pack size',
    'Base unit',
    'Units per case',
    'Measure type',
    'Case size',
    'HSN code',
    'GST rate',
    'MRP per pack',
    'Formulation',
  ];
  const csv = (rows: string[][]) =>
    rows.map((row) => row.map((cell) => `"${cell}"`).join(',')).join('\n');

  async function importItems(t: Awaited<ReturnType<typeof agri>>, body: string) {
    const uploaded = await t.admin.upload('items', body);
    expect(uploaded.statusCode).toBe(201);
    const id = uploaded.json().id as string;
    const imports = app.get(ImportsService);
    await imports.read(t.tenantId, id);
    const read = (await t.admin.get(`/v1/imports/${id}`)).json();
    expect(
      (await t.admin.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping })).statusCode,
    ).toBe(200);
    await imports.check(t.tenantId, id);
    const checked = (await t.admin.get(`/v1/imports/${id}`)).json();
    if (checked.status !== 'ready') return checked;
    await t.admin.post(`/v1/imports/${id}/commit`);
    await imports.write(t.tenantId, id);
    return (await t.admin.get(`/v1/imports/${id}`)).json();
  }

  it('imports items by the template’s headers, with units, measures and tax as a fraction', async () => {
    const t = await agri('Catalogue Agro');
    const empty = await t.sme.get('/v1/catalogue');
    expect(empty.json()).toMatchObject({
      units: [
        expect.objectContaining({ key: 'pack', base: true }),
        expect.objectContaining({ key: 'case' }),
      ],
      items: [],
    });
    const etag = String(empty.headers.etag);
    expect((await t.sme.get('/v1/catalogue', { 'if-none-match': etag })).statusCode).toBe(304);

    const rows = [
      HEADER,
      [
        'NEEM-500',
        'Neem Shield 500 ML',
        'Neem Shield',
        'Bio pesticides',
        '500 ML',
        'Pack',
        '20',
        'L',
        '10',
        '3808',
        '0.18',
        '450',
        'EC',
      ],
      [
        'UREA-1',
        'Urea Plus 1 KG',
        'Urea Plus',
        'Fertilisers',
        '1 KG',
        'pack',
        '',
        '',
        '',
        '3102',
        '5',
        '',
        '',
      ],
    ];
    const done = await importItems(t, csv(rows));
    expect(done).toMatchObject({ status: 'committed', created: 2, updated: 0 });
    const catalogue = await t.sme.get('/v1/catalogue', { 'if-none-match': etag });
    expect(catalogue.statusCode).toBe(200);
    const neem = catalogue.json().items.find((item: { code: string }) => item.code === 'NEEM-500');
    expect(neem).toMatchObject({
      name: 'Neem Shield 500 ML',
      product: { name: 'Neem Shield' },
      category: { name: 'Bio pesticides' },
      baseUnit: 'pack',
      units: [
        { key: 'pack', factor: '1.000' },
        { key: 'case', factor: '20.000' },
      ],
      measureType: 'L',
      measurePerBaseUnit: '0.500000',
      taxRate: '18.0000',
      mrp: '450.00',
      custom: { formulation: 'EC' },
    });

    expect(await importItems(t, csv(rows))).toMatchObject({ created: 0, updated: 0 });
    rows[2]![1] = 'Urea Plus 1 KG bag';
    expect(await importItems(t, csv(rows))).toMatchObject({ created: 0, updated: 1 });
  });

  it("sends phones the catalogue through the sync, and follows a product's category", async () => {
    const t = await agri('Sync Agro');
    const pullItems = async (cursor?: string) =>
      (
        await t.sme.get(
          `/v1/sync/pull?entities=items${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
      ).json() as {
        entities: {
          items: { pass: string; rows: { code: string; category: { name: string } | null }[] };
        };
        cursor: string;
      };
    const first = await pullItems();
    expect(first.entities.items).toMatchObject({ pass: 'full', rows: [] });

    const rows = [
      HEADER,
      [
        'NEEM-500',
        'Neem Shield 500 ML',
        'Neem Shield',
        'Bio pesticides',
        '500 ML',
        'Pack',
        '20',
        'L',
        '10',
        '3808',
        '18',
        '450',
        '',
      ],
    ];
    await importItems(t, csv(rows));
    const second = await pullItems(first.cursor);
    expect(second.entities.items).toMatchObject({
      pass: 'changes',
      rows: [{ code: 'NEEM-500', category: { name: 'Bio pesticides' } }],
    });

    // Only the product's category changes: the item itself is the same, yet its copy follows.
    rows[1]![3] = 'Fertilisers';
    expect(await importItems(t, csv(rows))).toMatchObject({ created: 0, updated: 0 });
    const third = await pullItems(second.cursor);
    expect(third.entities.items.rows).toMatchObject([
      { code: 'NEEM-500', category: { name: 'Fertilisers' } },
    ]);

    const bundle = (await t.sme.get('/v1/config')).json();
    expect(bundle.catalogue).toMatchObject({
      units: [
        expect.objectContaining({ key: 'pack', base: true }),
        expect.objectContaining({ key: 'case' }),
      ],
      measureTypes: expect.arrayContaining(['kg', 'L']),
    });
  });

  it('refuses a pack label that disagrees with its measure (BR-16), writing nothing', async () => {
    const t = await agri('Measures Agro');
    const checked = await importItems(
      t,
      csv([
        HEADER,
        ['BAD-1', 'Odd Pack', 'Odd', '', '500 ML', 'Pack', '10', 'L', '4', '3808', '18', '', ''],
        ['BAD-2', 'No Unit', 'Odd', '', '', 'Bottle', '', '', '', '', '', '', ''],
      ]),
    );
    expect(checked.status).toBe('invalid');
    expect(checked.errors).toEqual(
      expect.arrayContaining([
        {
          row: 2,
          field: 'pack_label',
          issue: 'The pack label says 0.5 L a unit, but the measure is 0.4',
          value: '500 ML',
        },
        {
          row: 3,
          field: 'base_unit',
          issue: 'There is no unit called Bottle; use Pack or Case',
          value: 'Bottle',
        },
        { row: 3, field: 'tax_rate', issue: 'Fill in the tax rate', value: null },
      ]),
    );
    expect((await t.admin.get('/v1/catalogue')).json().items).toEqual([]);
  });
});
