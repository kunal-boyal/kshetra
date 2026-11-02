import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StockService } from '../src/modules/stock/stock.service';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { orderingTenant } from './erp-orders';
import { newAddress, startApp, World } from './support';

/**
 * Distributors' stock (module M24, BR-62, decision D130): the module off, then on; fulfilment of
 * a primary order moving stock into the distributor once, however often it is recorded; entries
 * by hand, a count that adjusts at once and is flagged past the tolerance, and loads by the bulk
 * API once by reference; then the books keeping stock, where a level loaded replaces the
 * account's and nothing else moves it; and the reports. Then a secondary order through the
 * distributor: flagged on its lines where the distributor was short when it was placed, never
 * refused, selling out of the distributor once fulfilled, and the stock phones keep.
 */

let app: NestFastifyApplication;
let world: World;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

async function settings(tenantId: string, patch: object) {
  await app
    .get(Database)
    .forTenant(tenantId, (tx) =>
      app.get(TenantConfigService).updateSettings(tx, tenantId, SYSTEM_ACTOR, patch),
    );
}

describe('distributors’ stock (BR-62, D130)', () => {
  it('stays closed until switched on, then fulfilment, entries, counts and loads move it', async () => {
    const t = await orderingTenant(app, world, 'Stock Agro');
    const stockOf = async () =>
      (await call('GET', `/v1/accounts/${t.distributor}/stock`, t.admin)).json();
    const onHand = async (itemCode: string) =>
      (await stockOf()).items.find(
        (item: { item: { code: string } }) => item.item.code === itemCode,
      )?.onHand ?? null;

    const closed = await call('GET', `/v1/accounts/${t.distributor}/stock`, t.admin);
    expect(closed.statusCode).toBe(403);
    expect(closed.json().error.code).toBe('MODULE_DISABLED');

    await settings(t.tenantId, { modulesOn: ['inventory'] });
    // Signing in again gives the admin the module's permissions.
    expect(await stockOf()).toMatchObject({ accountId: t.distributor, source: 'kept', items: [] });

    // A primary order to the distributor: 2 cases of neem, 24 packs, fulfilled in two goes.
    const order = await t.order({ NEEM: '2' }, ['NEEM']);
    const seen = (await call('GET', `/v1/orders/${order.id}`, t.admin)).json();
    const line = seen.lines[0];
    const half = await call('POST', `/v1/orders/${order.id}/fulfilment`, t.admin, {
      action: 'fulfil',
      lines: [{ lineId: line.id, fulfilledUnits: '12' }],
      version: seen.version,
    });
    expect(half.statusCode, half.body).toBe(200);
    await expect.poll(() => onHand('NEEM')).toBe('12');
    const full = await call('POST', `/v1/orders/${order.id}/fulfilment`, t.admin, {
      action: 'fulfil',
      lines: [{ lineId: line.id, fulfilledUnits: '24' }],
      version: half.json().version,
    });
    expect(full.statusCode, full.body).toBe(200);
    await expect.poll(() => onHand('NEEM')).toBe('24');
    // The event delivered again, as the relay may, moves nothing more.
    const replayed = await app
      .get(Database)
      .forTenant(t.tenantId, (tx) => app.get(StockService).fromOrder(tx, t.tenantId, order.id));
    expect(replayed).toBe(0);
    const moves = (
      await call('GET', `/v1/accounts/${t.distributor}/stock/movements`, t.admin)
    ).json();
    expect(
      moves.items.map((move: { kind: string; units: string }) => [move.kind, move.units]),
    ).toEqual([
      ['received', '12'],
      ['received', '12'],
    ]);
    expect(moves.items[0].source).toEqual({ type: 'order', id: order.id });

    // Goods out by hand, once by the entry's ID.
    const entry = {
      id: newId(),
      accountId: t.distributor,
      kind: 'sold',
      lines: [{ itemId: t.itemIds.NEEM, quantity: '5' }],
      note: 'Counter sale',
    };
    const sold = await call('POST', '/v1/stock/movements', t.admin, entry);
    expect(sold.statusCode, sold.body).toBe(201);
    expect(sold.json().movements[0]).toMatchObject({ kind: 'sold', units: '-5' });
    await call('POST', '/v1/stock/movements', t.admin, entry);
    expect(await onHand('NEEM')).toBe('19');
    const negative = await call('POST', '/v1/stock/movements', t.admin, {
      ...entry,
      id: newId(),
      lines: [{ itemId: t.itemIds.NEEM, quantity: '-5' }],
    });
    expect(negative.statusCode).toBe(400);

    // A count of 18 against 19 expected is 5.3% off, past 5%: flagged, and set at once.
    const counted = await call('POST', '/v1/stock/counts', t.admin, {
      id: newId(),
      accountId: t.distributor,
      lines: [
        { itemId: t.itemIds.NEEM, counted: '18' },
        { itemId: t.itemIds.UREA, counted: '0' },
      ],
    });
    expect(counted.statusCode, counted.body).toBe(201);
    expect(counted.json()).toMatchObject({
      flagged: true,
      lines: [
        {
          item: { code: 'NEEM' },
          expected: '19',
          counted: '18',
          difference: '-1',
          flags: ['beyond_tolerance'],
        },
        { item: { code: 'UREA' }, expected: '0', counted: '0', difference: '0', flags: [] },
      ],
    });
    expect(await onHand('NEEM')).toBe('18');
    const counts = (
      await call('GET', `/v1/accounts/${t.distributor}/stock/counts`, t.admin)
    ).json();
    expect(counts.items).toHaveLength(1);

    // A distributor's own system sends goods in by the bulk API, once by reference.
    const rows = [
      {
        account_code: t.distributorCode,
        item_code: 'UREA',
        kind: 'received',
        quantity: '10',
        reference: 'GRN-2041',
      },
    ];
    for (let time = 0; time < 2; time += 1) {
      const loaded = await call('POST', '/v1/bulk/stock-movements', t.admin, { rows });
      expect(loaded.statusCode, loaded.body).toBe(200);
    }
    expect(await onHand('UREA')).toBe('10');

    // The report holds what the account holds.
    const period = new Date().toISOString().slice(0, 7);
    const report = await call('GET', `/v1/reports/stock_on_hand?period=${period}`, t.admin);
    expect(report.statusCode, report.body).toBe(200);
    expect(report.json().rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ item_code: 'NEEM', on_hand: 18 }),
        expect.objectContaining({ item_code: 'UREA', on_hand: 10 }),
      ]),
    );
    const ledger = await call('GET', `/v1/reports/stock_ledger?period=${period}`, t.admin);
    expect(ledger.json().rows.map((row: { kind: string }) => row.kind)).toEqual([
      'Received',
      'Received',
      'Sold',
      'Count',
      'Received',
    ]);
  });

  it('takes levels from the books, where nothing else moves stock', async () => {
    const t = await orderingTenant(app, world, 'Stock Books Agro');
    await settings(t.tenantId, { modulesOn: ['inventory'], stockSource: 'books' });
    const loaded = await call('POST', '/v1/bulk/stock-levels', t.admin, {
      rows: [
        { account_code: t.distributorCode, item_code: 'NEEM', on_hand: '120' },
        { account_code: t.distributorCode, item_code: 'UREA', on_hand: '-2' },
      ],
    });
    expect(loaded.statusCode, loaded.body).toBe(200);
    const stock = (await call('GET', `/v1/accounts/${t.distributor}/stock`, t.admin)).json();
    expect(stock.source).toBe('books');
    expect(
      stock.items.map((item: { item: { code: string }; onHand: string; value: string | null }) => [
        item.item.code,
        item.onHand,
        item.value,
      ]),
    ).toEqual([
      // 120 packs at 360 a pack; a negative level is shown, and valued at nothing.
      ['NEEM', '120', '43200.00'],
      ['UREA', '-2', null],
    ]);
    const entry = await call('POST', '/v1/stock/movements', t.admin, {
      id: newId(),
      accountId: t.distributor,
      kind: 'received',
      lines: [{ itemId: t.itemIds.NEEM, quantity: '5' }],
    });
    expect(entry.statusCode).toBe(409);
    const movements = await call('POST', '/v1/bulk/stock-movements', t.admin, {
      rows: [
        {
          account_code: t.distributorCode,
          item_code: 'NEEM',
          kind: 'received',
          quantity: '1',
          reference: 'GRN-1',
        },
      ],
    });
    expect(movements.statusCode).toBe(400);

    // Fulfilment moves nothing while the books keep stock.
    const order = await t.order({ NEEM: '1' }, ['NEEM']);
    const seen = (await call('GET', `/v1/orders/${order.id}`, t.admin)).json();
    await call('POST', `/v1/orders/${order.id}/fulfilment`, t.admin, {
      action: 'fulfil',
      lines: [{ lineId: seen.lines[0].id, fulfilledUnits: '12' }],
      version: seen.version,
    });
    const after = (await call('GET', `/v1/accounts/${t.distributor}/stock`, t.admin)).json();
    expect(after.items[0].onHand).toBe('120');
  });
  it('flags a secondary order the supplier is short for, sells out of it, and syncs to phones', async () => {
    const t = await orderingTenant(app, world, 'Stock Retail Agro');
    await settings(t.tenantId, { modulesOn: ['inventory'] });
    // While the app keeps stock, a loaded level is the opening: 30 packs of neem, no urea.
    const opened = await call('POST', '/v1/bulk/stock-levels', t.admin, {
      rows: [{ account_code: t.distributorCode, item_code: 'NEEM', on_hand: '30' }],
    });
    expect(opened.statusCode, opened.body).toBe(200);

    // 3 cases of neem (36 packs) and a case of urea (12) asks 6 and 12 more than it holds.
    const retailer = await t.retailer();
    const order = await t.order({ NEEM: '3', UREA: '1' }, ['NEEM', 'UREA'], retailer);
    const seen = (await call('GET', `/v1/orders/${order.id}`, t.admin)).json();
    const short = Object.fromEntries(
      seen.lines.map((line: { item: { code: string }; shortUnits: string | null }) => [
        line.item.code,
        line.shortUnits,
      ]),
    );
    expect(short).toEqual({ NEEM: '6', UREA: '12' });

    // Fulfilled, the retailer's order sells out of the distributor, below zero if need be.
    const fulfilled = await call('POST', `/v1/orders/${order.id}/fulfilment`, t.admin, {
      action: 'fulfil',
      lines: seen.lines.map((line: { id: string; baseUnits: string }) => ({
        lineId: line.id,
        fulfilledUnits: line.baseUnits,
      })),
      version: seen.version,
    });
    expect(fulfilled.statusCode, fulfilled.body).toBe(200);
    const onHand = async () =>
      Object.fromEntries(
        (await call('GET', `/v1/accounts/${t.distributor}/stock`, t.admin))
          .json()
          .items.map((item: { item: { code: string }; onHand: string }) => [
            item.item.code,
            item.onHand,
          ]),
      );
    await expect.poll(onHand).toEqual({ NEEM: '-6', UREA: '-12' });

    // The SME's phone keeps the distributor's stock, one row an account; the retailer holds none.
    const pulled = await call('GET', '/v1/sync/pull?entities=stock', t.sme);
    expect(pulled.statusCode, pulled.body).toBe(200);
    const rows = pulled.json().entities.stock.rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].accountId).toBe(t.distributor);
    expect(
      Object.fromEntries(
        rows[0].items.map((item: { itemId: string; onHand: string }) => [item.itemId, item.onHand]),
      ),
    ).toEqual({ [t.itemIds.NEEM!]: '-6', [t.itemIds.UREA!]: '-12' });

    // Switched off, the entity sends nothing and its scope tells phones to drop their copies.
    await settings(t.tenantId, { modulesOff: ['inventory'] });
    const off = (await call('GET', '/v1/sync/pull?entities=stock', t.sme)).json();
    expect(off.entities.stock.rows).toEqual([]);
  });
});
