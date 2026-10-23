import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * Orders (M10, BR-13 to BR-15, BR-19, decision D78) in an agri tenant, whose order chain asks the
 * account's ASM, then the business head, who decides line by line.
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

const HERE = { lat: 28.6315, lng: 77.2167 };
const fix = () => ({
  location: HERE,
  accuracy: 12,
  mocked: false,
  capturedAt: new Date().toISOString(),
});

/**
 * A head (who decides by line), an ASM, a field user on a phone, a distributor the ASM and field
 * user look after, a retailer the distributor supplies, and two items on a default price list.
 */
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
  const account = async (type: string, slots: object, parentId: string | null = null) => {
    const id = newId();
    const made = await api.head.post('/v1/accounts', {
      id,
      type,
      code: `${type.slice(0, 1).toUpperCase()}-${newId().slice(-6)}`,
      name: `${type} ${newId().slice(-4)}`,
      territoryId: market,
      ...(parentId ? { parentId } : {}),
      slots,
    });
    expect(made.statusCode, made.body).toBe(201);
    return id;
  };
  const distributor = await account('distributor', { asm: asm.id, sme: sme.id });
  const retailer = await account('retailer', { sme: sme.id }, distributor);
  const item = async (code: string, extra: object = {}) => {
    const id = newId();
    const made = await api.head.put(`/v1/items/${id}`, {
      code,
      name: `${code} item`,
      productName: `${code} product`,
      categoryName: null,
      packLabel: '500 ML',
      hsn: '3808',
      taxRate: '18',
      mrp: '450',
      baseUnit: 'pack',
      units: [{ key: 'case', factor: '12' }],
      measureType: 'L',
      measurePerBaseUnit: '0.5',
      ...extra,
    });
    expect(made.statusCode, made.body).toBe(201);
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
  const price = async (set: object[]) => {
    const { version } = (await api.head.get(`/v1/price-lists/${list}`)).json();
    const saved = await api.head.put(`/v1/price-lists/${list}/items`, { set, version });
    expect(saved.statusCode, saved.body).toBe(200);
  };
  await price([
    { itemId: neem, price: '400', discount: '10' },
    { itemId: urea, price: '90.23' },
  ]);
  /** A line as the phone shows it: what the list said when it was added. */
  const line = (itemId: string, quantity: string, quoted: object = {}) => ({
    itemId,
    unitKey: 'case',
    quantity,
    quoted: {
      listId: list,
      price: itemId === neem ? '400.00' : '90.23',
      discount: itemId === neem ? '10' : '0',
      taxRate: '18',
      factor: '12',
      ...quoted,
    },
  });
  const order = (accountId: string, lines: object[], extra: object = {}) => ({
    id: newId(),
    accountId,
    lines,
    fix: fix(),
    placedAt: new Date().toISOString(),
    ...extra,
  });
  return {
    tenantId,
    head,
    asm,
    sme,
    api,
    distributor,
    retailer,
    neem,
    urea,
    list,
    price,
    line,
    order,
  };
}

describe('orders (M10)', () => {
  it('FX-07, FX-08: prices on the server, keeps each line as it was, and splits GST', async () => {
    const t = await agri('Order Agro');
    const body = t.order(t.distributor, [t.line(t.neem, '2'), t.line(t.urea, '3')], {
      note: 'Deliver before the rains',
    });
    const placed = await t.api.sme.post('/v1/orders', body);
    expect(placed.statusCode, placed.body).toBe(201);
    const order = placed.json();
    expect(order).toMatchObject({
      status: 'submitted',
      supplier: { kind: 'company', account: null },
      note: 'Deliver before the rains',
      lines: [
        {
          position: 1,
          item: { code: 'NEEM', packLabel: '500 ML', hsn: '3808', mrp: '450.00', baseUnit: 'pack' },
          quantity: '2.000',
          baseUnits: '24.000',
          measureType: 'L',
          measure: '12.000',
          rate: '360.00',
          taxable: '8640.00',
          tax: '1555.20',
          total: '10195.20',
          decision: 'pending',
        },
        { position: 2, rate: '90.23', taxable: '3248.28', tax: '584.69', total: '3832.97' },
      ],
      totals: {
        taxable: '11888.28',
        tax: '2139.89',
        total: '14028.17',
        cgst: '1069.95',
        sgst: '1069.94',
      },
      measures: { L: '30.000' },
      approval: { requestType: 'order', status: 'pending', page: `/orders/${body.id}` },
    });

    // BR-15: a later price or name change leaves the order as it was.
    await t.price([{ itemId: t.neem, price: '500' }]);
    const again = (await t.api.sme.get(`/v1/orders/${body.id}`)).json();
    expect(again.lines[0]).toMatchObject({ price: '400.00', rate: '360.00' });

    // Reusing the ID with the same content returns the order; with other content, a conflict.
    const replay = await t.api.sme.post('/v1/orders', body);
    expect(replay.statusCode).toBe(201);
    expect(replay.json().id).toBe(body.id);
    const changed = await t.api.sme.post('/v1/orders', { ...body, note: 'Other' });
    expect(changed.json().error.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('FX-13: refuses an order whose quoted prices changed, naming each line', async () => {
    const t = await agri('Price Change Agro');
    await t.price([{ itemId: t.neem, price: '400', discount: '12' }]);
    const refused = await t.api.sme.post(
      '/v1/orders',
      t.order(t.distributor, [t.line(t.neem, '1'), t.line(t.urea, '1', { factor: '10' })]),
    );
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toMatchObject({
      code: 'PRICE_CHANGED',
      details: [
        { path: 'lines[0].discount', issue: 'Now 12.0000' },
        { path: 'lines[1].factor', issue: 'Now 12.000' },
      ],
    });
    const twice = await t.api.sme.post(
      '/v1/orders',
      t.order(t.distributor, [t.line(t.urea, '1'), t.line(t.urea, '2')]),
    );
    expect(twice.json().error.details).toEqual([
      { path: 'lines', issue: 'Each item appears on one line; add to its quantity instead' },
    ]);
    const nowhere = await t.api.sme.post(
      '/v1/orders',
      t.order(t.distributor, [t.line(t.urea, '1')], { fix: null }),
    );
    expect(nowhere.json().error.details).toEqual([
      { path: 'fix', issue: 'Wait for a location fix' },
    ]);
  });

  it('goes through the chain: the ASM accepts, the head decides by line, then fulfilment', async () => {
    const t = await agri('Chain Agro');
    const body = t.order(t.distributor, [t.line(t.neem, '2'), t.line(t.urea, '1')]);
    await t.api.sme.post('/v1/orders', body);
    const seen = (await t.api.asm.get(`/v1/orders/${body.id}`)).json();
    expect(seen.can).toEqual({ decide: true, decideLines: false, fulfil: false });

    // The inbox can't decide an order; its own page does.
    const generic = await t.api.asm.post(`/v1/approvals/${seen.approval.id}/decision`, {
      decision: 'approve',
      version: seen.approval.version,
    });
    expect(generic.json().error.code).toBe('FORBIDDEN');
    const accepted = await t.api.asm.post(`/v1/orders/${body.id}/decision`, {
      decision: 'accept',
      version: seen.approval.version,
    });
    expect(accepted.statusCode, accepted.body).toBe(200);
    expect(accepted.json()).toMatchObject({ status: 'submitted', can: { decide: false } });

    const atHead = (await t.api.head.get(`/v1/orders/${body.id}`)).json();
    expect(atHead.can).toMatchObject({ decide: true, decideLines: true });
    const [neemLine, ureaLine] = atHead.lines;
    const bare = await t.api.head.post(`/v1/orders/${body.id}/line-decisions`, {
      lines: [
        { lineId: neemLine.id, decision: 'accepted' },
        { lineId: ureaLine.id, decision: 'rejected' },
      ],
      version: atHead.approval.version,
    });
    expect(bare.json().error.details).toEqual([
      { path: 'lines[1].reason', issue: 'Choose why it is rejected' },
    ]);
    const decided = await t.api.head.post(`/v1/orders/${body.id}/line-decisions`, {
      lines: [
        { lineId: neemLine.id, decision: 'accepted' },
        { lineId: ureaLine.id, decision: 'rejected', reason: 'no_stock' },
      ],
      version: atHead.approval.version,
    });
    // FX-14
    expect(decided.json()).toMatchObject({
      status: 'partially_accepted',
      lines: [{ decision: 'accepted' }, { decision: 'rejected', decisionReason: 'no_stock' }],
      can: { fulfil: true },
    });

    const version = decided.json().version;
    const half = await t.api.head.post(`/v1/orders/${body.id}/fulfilment`, {
      action: 'fulfil',
      lines: [{ lineId: neemLine.id, fulfilledUnits: '12' }],
      version,
    });
    expect(half.json()).toMatchObject({ status: 'partially_fulfilled' });
    const stale = await t.api.head.post(`/v1/orders/${body.id}/fulfilment`, {
      action: 'fulfil',
      lines: [{ lineId: neemLine.id, fulfilledUnits: '24' }],
      version,
    });
    expect(stale.json().error.code).toBe('CONFLICT');
    const rest = await t.api.head.post(`/v1/orders/${body.id}/fulfilment`, {
      action: 'fulfil',
      lines: [{ lineId: neemLine.id, fulfilledUnits: '24' }],
      version: half.json().version,
    });
    expect(rest.json()).toMatchObject({
      status: 'fulfilled',
      lines: [{ fulfilledUnits: '24.000' }, { fulfilledUnits: null }],
    });
  });

  it('rejects a whole order only with a configured reason', async () => {
    const t = await agri('Reject Agro');
    const body = t.order(t.distributor, [t.line(t.urea, '1')]);
    await t.api.sme.post('/v1/orders', body);
    const { approval } = (await t.api.asm.get(`/v1/orders/${body.id}`)).json();
    const bare = await t.api.asm.post(`/v1/orders/${body.id}/decision`, {
      decision: 'reject',
      version: approval.version,
    });
    expect(bare.json().error.details).toEqual([
      { path: 'reason', issue: 'Choose why it is rejected' },
    ]);
    const rejected = await t.api.asm.post(`/v1/orders/${body.id}/decision`, {
      decision: 'reject',
      reason: 'overdue',
      note: 'Clear last month first',
      version: approval.version,
    });
    expect(rejected.json()).toMatchObject({
      status: 'rejected',
      rejectionReason: 'overdue',
      approval: { status: 'rejected', steps: [{ note: 'Overdue: Clear last month first' }, {}] },
    });
  });

  it("shows a retailer's order to its supplier's people, and each person only what they may see", async () => {
    const t = await agri('Secondary Agro');
    const body = t.order(t.retailer, [t.line(t.urea, '1')]);
    const placed = (await t.api.sme.post('/v1/orders', body)).json();
    expect(placed.supplier.kind).toBe('account');
    expect(placed.supplier.account.id).toBe(t.distributor);
    // The retailer has no ASM, so the head decides first, by line.
    expect(placed.approval.steps[0]).toMatchObject({
      status: 'skipped',
      skipReason: 'no_approver',
    });

    // The ASM sees it through the distributor that supplies it.
    expect((await t.api.asm.get(`/v1/orders/${body.id}`)).statusCode).toBe(200);
    const listed = (await t.api.asm.get('/v1/orders')).json();
    expect(listed.items.map((entry: { id: string }) => entry.id)).toEqual([body.id]);
    expect(listed.items[0]).toMatchObject({ lineCount: 1, total: '1277.66', status: 'submitted' });
    // Another field user doesn't.
    expect((await t.api.other.get(`/v1/orders/${body.id}`)).json().error.code).toBe('OUT_OF_SCOPE');
    expect((await t.api.other.get('/v1/orders')).json().items).toEqual([]);
  });

  it('sends phones the orders their person placed, and where each stands', async () => {
    const t = await agri('Sync Orders Agro');
    const body = t.order(t.distributor, [t.line(t.urea, '1')]);
    await t.api.sme.post('/v1/orders', body);
    type Pull = {
      entities: {
        orders: { pass: string; rows: { id: string; status: string; lineCount: number }[] };
      };
      cursor: string;
    };
    const pull = async (api: typeof t.api.sme, cursor?: string) =>
      (
        await api.get(
          `/v1/sync/pull?entities=orders${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
      ).json() as Pull;
    const first = await pull(t.api.sme);
    expect(first.entities.orders.rows).toEqual([
      expect.objectContaining({ id: body.id, status: 'submitted', lineCount: 1, total: '1277.66' }),
    ]);
    // Someone else's phone keeps none of them.
    expect((await pull(t.api.other)).entities.orders.rows).toEqual([]);

    const { approval } = (await t.api.asm.get(`/v1/orders/${body.id}`)).json();
    await t.api.asm.post(`/v1/orders/${body.id}/decision`, {
      decision: 'reject',
      reason: 'no_stock',
      version: approval.version,
    });
    const second = await pull(t.api.sme, first.cursor);
    expect(second.entities.orders).toMatchObject({
      pass: 'changes',
      rows: [{ id: body.id, status: 'rejected' }],
    });
  });

  it("counts an order in its placer's month: waiting apart, then the lines that stand", async () => {
    const t = await agri('Metric Orders Agro');
    const month = new Date().toISOString().slice(0, 7);
    const figures = async () =>
      (await t.api.sme.get(`/v1/performance?period=${month}`)).json().figures;
    const body = t.order(t.distributor, [t.line(t.neem, '2'), t.line(t.urea, '3')]);
    await t.api.sme.post('/v1/orders', body);
    // Submitted: shown apart until accepted (BR-02).
    expect((await figures()).order_value).toMatchObject({ actual: '0', pending: '11888.28' });

    const seen = (await t.api.asm.get(`/v1/orders/${body.id}`)).json();
    await t.api.asm.post(`/v1/orders/${body.id}/decision`, {
      decision: 'accept',
      version: seen.approval.version,
    });
    const atHead = (await t.api.head.get(`/v1/orders/${body.id}`)).json();
    await t.api.head.post(`/v1/orders/${body.id}/line-decisions`, {
      lines: [
        { lineId: atHead.lines[0].id, decision: 'accepted' },
        { lineId: atHead.lines[1].id, decision: 'rejected', reason: 'no_stock' },
      ],
      version: atHead.approval.version,
    });
    // FX-14: only the accepted line counts.
    expect((await figures()).order_value).toMatchObject({ actual: '8640', pending: '0' });
  });
});
