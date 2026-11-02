import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../src/db/schema/accounts';
import { items, priceListItems } from '../src/db/schema/catalogue';
import { erpConnections } from '../src/db/schema/erp';
import { accountReceipts } from '../src/db/schema/finance';
import { territories } from '../src/db/schema/territories';
import { ErpRuns } from '../src/modules/erp/erp-runs';
import { FAKE_SAP_COMPANY, FakeSapB1 } from '../src/modules/erp/fake-sap-b1';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { orderingTenant } from './erp-orders';
import { newAddress, newPhone, startApp, World } from './support';

/**
 * SAP Business One through its Service Layer (module M20, BR-60, decision D129): connecting with a
 * company, user and password checked by signing in, refusing addresses off HTTPS 443, reading
 * business partners, items and their prices, A/R invoices and incoming payments through the
 * import targets, then only what changed, a session that lapses mid-run, a user SAP no longer
 * accepts, the module off, and disconnecting. Tests run no workers, so they run each pull.
 */

let app: NestFastifyApplication;
let world: World;
let sap: FakeSapB1;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  sap = app.get(FakeSapB1);
});

afterAll(async () => {
  await world.end();
  await app.close();
});

const ENDPOINT = 'https://b1.sunrise.example';

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

async function connect(admin: string, patch: object = {}) {
  return call('POST', '/v1/erp-connections/sap-b1', admin, {
    endpoint: ENDPOINT,
    ...FAKE_SAP_COMPANY,
    ...patch,
  });
}

async function pull(tenantId: string, admin: string, connectionId: string) {
  const asked = await call('POST', `/v1/erp-connections/${connectionId}/runs`, admin);
  expect(asked.statusCode, asked.body).toBe(202);
  await app.get(ErpRuns).pull(tenantId, connectionId, asked.json().id);
  return latestRun(admin, connectionId);
}

async function latestRun(admin: string, connectionId: string) {
  return (await call('GET', `/v1/erp-connections/${connectionId}/runs`, admin)).json().items[0];
}

const logins = () => sap.requests.filter((request) => request.url.endsWith('/Login')).length;

describe('connecting SAP Business One (D129)', () => {
  it('refuses an address off HTTPS 443 and details SAP doesn’t accept, and keeps the password sealed', async () => {
    const org = await organisation('SAP Connecting');
    expect(
      (await connect(org.admin, { endpoint: 'http://b1.sunrise.example' })).json().error.details,
    ).toEqual([{ path: 'endpoint', issue: 'not_https' }]);
    expect(
      (await connect(org.admin, { endpoint: 'https://b1.sunrise.example:50000/b1s/v2' })).json()
        .error.details,
    ).toEqual([{ path: 'endpoint', issue: 'not_443' }]);
    const wrong = await connect(org.admin, { password: 'not-the-password' });
    expect(wrong.statusCode).toBe(502);
    expect(wrong.json().error.code).toBe('ERP_REFUSED');

    const made = await connect(org.admin, { endpoint: `${ENDPOINT}:443/b1s/v2/` });
    expect(made.statusCode, made.body).toBe(200);
    expect(made.json()).toMatchObject({
      provider: 'sap_b1',
      status: 'connected',
      endpoint: `${ENDPOINT}/b1s/v2`,
      companyDb: FAKE_SAP_COMPANY.companyDb,
      username: FAKE_SAP_COMPANY.username,
      organization: { id: FAKE_SAP_COMPANY.companyDb },
    });
    expect(made.body).not.toContain(FAKE_SAP_COMPANY.password);
    const [row] = await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        tx.select().from(erpConnections).where(eq(erpConnections.tenantId, org.tenantId)),
      );
    expect(row!.credentialsSealed).toMatch(/^v2:/);
    expect(row!.credentialsSealed).not.toContain(FAKE_SAP_COMPANY.password);

    const listed = (await call('GET', '/v1/erp-connections', org.admin)).json();
    expect(listed.providers.map((entry: { provider: string }) => entry.provider)).toEqual([
      'zoho_books',
      'sap_b1',
    ]);
  });
});

describe('reading SAP Business One (BR-60)', () => {
  it('reads customers, items and prices, invoices and payments, then only what changed', async () => {
    const org = await organisation('SAP Reading');
    const north = `N${newId().slice(-5).toUpperCase()}`;
    const south = `S${newId().slice(-5).toUpperCase()}`;
    await world.territory(org.tenantId, north);
    await world.territory(org.tenantId, south);
    const wholesale = newId();
    for (const [id, name, scope, targets] of [
      [newId(), 'Standard', 'default', []],
      [wholesale, 'Wholesale', 'account_type', ['customer']],
    ] as const) {
      const made = await call('PUT', `/v1/price-lists/${id}`, org.admin, {
        name,
        scope,
        targets,
        validFrom: '2026-01-01',
      });
      expect(made.statusCode, made.body).toBe(201);
    }
    const connection = (await connect(org.admin)).json();
    const saved = await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      accountType: 'customer',
      territoryField: 'U_Territory',
      defaultTerritory: south,
      priceBooks: [{ pricebookId: '2', priceList: wholesale }],
      taxRateField: 'U_GST',
      defaultTaxRate: '18',
      invoiceDays: 365,
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const tag = newId().slice(-6).toUpperCase();
    const day = new Date().toISOString().slice(0, 10);
    const old = '2026-09-01';
    sap.partners = [
      {
        CardCode: `C1-${tag}`,
        CardName: 'Shree Ganesh Agencies',
        CardType: 'cCustomer',
        Frozen: 'tNO',
        U_Territory: north,
        UpdateDate: old,
        BPAddresses: [{ AddressType: 'bo_BillTo', Street: '12 Market Road', City: 'Nashik' }],
      },
      { CardCode: `C2-${tag}`, CardName: 'Meena Stores', CardType: 'cCustomer', UpdateDate: old },
      { CardCode: `V1-${tag}`, CardName: 'A Supplier', CardType: 'cSupplier', UpdateDate: old },
    ];
    sap.itemGroups = [{ Number: 101, GroupName: 'Tea' }];
    sap.items = [
      {
        ItemCode: `TEA-${tag}`,
        ItemName: 'Tea 250 g',
        ItemsGroupCode: 101,
        SalesUnit: 'Piece',
        U_GST: '5',
        UpdateDate: old,
        ItemPrices: [
          { PriceList: 1, Price: 120 },
          { PriceList: 2, Price: 99 },
        ],
      },
      {
        ItemCode: `SOAP-${tag}`,
        ItemName: 'Soap',
        SalesUnit: 'Piece',
        UpdateDate: old,
        ItemPrices: [],
      },
    ];
    sap.invoices = [
      {
        DocEntry: 812,
        DocNum: 10041,
        CardCode: `C1-${tag}`,
        DocDate: day,
        DocDueDate: day,
        DocTotal: 23600,
        Cancelled: 'tNO',
        UpdateDate: old,
      },
      {
        DocEntry: 813,
        DocNum: 10042,
        CardCode: `X-${tag}`,
        DocDate: day,
        DocTotal: 500,
        UpdateDate: old,
      },
    ];
    sap.payments = [
      {
        DocEntry: 77,
        DocNum: 501,
        CardCode: `C1-${tag}`,
        DocDate: day,
        TransferSum: 10000,
        PaymentInvoices: [{ DocEntry: 812, InvoiceType: 'it_Invoice' }],
        UpdateDate: old,
      },
    ];
    sap.pageSize = 1;

    const first = await pull(org.tenantId, org.admin, connection.id);
    expect(first).toMatchObject({
      status: 'partial',
      stoppedBy: null,
      counts: {
        account: { read: 2, created: 2, skipped: 0 },
        item: { read: 2, created: 2, skipped: 0 },
        price: { read: 1, skipped: 0 },
        invoice: { read: 2, created: 1, skipped: 1 },
        receipt: { read: 1, created: 1, skipped: 0 },
      },
    });
    expect(first.problems).toEqual([
      expect.objectContaining({ entity: 'invoice', issue: 'unknown_customer' }),
    ]);
    const read = <T>(work: Parameters<Database['forTenant']>[1]) =>
      app.get(Database).forTenant(org.tenantId, work) as Promise<T>;
    expect(
      await read<{ code: string; territory: string }[]>((tx) =>
        tx
          .select({ code: accounts.code, territory: territories.code })
          .from(accounts)
          .innerJoin(
            territories,
            and(
              eq(territories.tenantId, accounts.tenantId),
              eq(territories.id, accounts.territoryId),
            ),
          )
          .where(eq(accounts.tenantId, org.tenantId)),
      ),
    ).toEqual(
      expect.arrayContaining([
        { code: `C1-${tag}`, territory: north },
        { code: `C2-${tag}`, territory: south },
      ]),
    );
    expect(
      await read<{ code: string; price: string }[]>((tx) =>
        tx
          .select({ code: items.code, price: priceListItems.price })
          .from(priceListItems)
          .innerJoin(
            items,
            and(eq(items.tenantId, priceListItems.tenantId), eq(items.id, priceListItems.itemId)),
          )
          .where(
            and(
              eq(priceListItems.tenantId, org.tenantId),
              eq(priceListItems.priceListId, wholesale),
            ),
          ),
      ),
    ).toEqual([{ code: `TEA-${tag}`, price: '99.00' }]);
    const [receipt] = await read<{ against: string[] | null; amount: string }[]>((tx) =>
      tx
        .select({ against: accountReceipts.against, amount: accountReceipts.amount })
        .from(accountReceipts)
        .where(eq(accountReceipts.tenantId, org.tenantId)),
    );
    expect(receipt).toEqual({ against: [String(sap.invoices[0]!.DocNum)], amount: '10000.00' });

    // The hourly read asks only for what changed since, and nothing has.
    const before = sap.apiCalls().length;
    await app.get(ErpRuns).pull(org.tenantId, null, null);
    const quiet = await latestRun(org.admin, connection.id);
    const asked = sap.apiCalls().slice(before);
    expect(
      asked.some((request) =>
        new URL(request.url).searchParams.get('$filter')?.includes(`UpdateDate ge '`),
      ),
    ).toBe(true);
    expect(quiet.counts.account).toMatchObject({ read: 0 });

    // SAP changes one customer today: only it comes in.
    sap.partners[1] = { ...sap.partners[1]!, CardName: 'Meena General Stores', UpdateDate: day };
    await app.get(ErpRuns).pull(org.tenantId, null, null);
    expect((await latestRun(org.admin, connection.id)).counts.account).toMatchObject({
      read: 1,
      updated: 1,
    });
    sap.pageSize = 100;
  });

  it('signs in again when the session lapses mid-run, and asks to connect again when SAP refuses the user', async () => {
    const org = await organisation('SAP Sessions');
    await world.territory(org.tenantId, 'EAST');
    const connection = (await connect(org.admin)).json();
    await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      accountType: 'customer',
      defaultTerritory: 'EAST',
      read: { customers: true, items: false, invoices: false, payments: false },
    });
    const tag = newId().slice(-6).toUpperCase();
    sap.partners = [{ CardCode: `E1-${tag}`, CardName: 'East Stores', CardType: 'cCustomer' }];

    const signedIn = logins();
    sap.failNext('/BusinessPartners', 401, 'GET');
    const lapsed = await pull(org.tenantId, org.admin, connection.id);
    expect(lapsed).toMatchObject({ status: 'ok', counts: { account: { created: 1 } } });
    expect(logins() - signedIn).toBe(2);

    sap.failNext('/Login', 401, 'POST');
    const refused = await pull(org.tenantId, org.admin, connection.id);
    expect(refused).toMatchObject({ status: 'failed', stoppedBy: 'reconnect' });
    const listed = (await call('GET', '/v1/erp-connections', org.admin)).json();
    expect(listed.providers[1].connection.status).toBe('needs_reconnect');
    const inbox = (await call('GET', '/v1/notifications', org.admin)).json();
    expect(inbox.items.some((item: { event: string }) => item.event === 'erp.reconnect')).toBe(
      true,
    );

    // The details sent again connect it once more, keeping the mappings.
    const again = await connect(org.admin);
    expect(again.json()).toMatchObject({
      id: connection.id,
      status: 'connected',
      settings: { accountType: 'customer', defaultTerritory: 'EAST' },
    });
  });

  it('does nothing while the integrations module is off, and disconnecting forgets the password', async () => {
    const org = await organisation('SAP Module');
    const connection = (await connect(org.admin)).json();
    await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, org.tenantId, SYSTEM_ACTOR, { modulesOff: ['integrations'] }),
      );
    expect((await connect(org.admin)).statusCode).toBe(403);
    const calls = sap.requests.length;
    await app.get(ErpRuns).pull(org.tenantId, null, null);
    expect(sap.requests).toHaveLength(calls);
    await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, org.tenantId, SYSTEM_ACTOR, { modulesOff: [] }),
      );
    const off = await call('POST', `/v1/erp-connections/${connection.id}/disconnect`, org.admin);
    expect(off.json().status).toBe('disconnected');
    const [row] = await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        tx.select().from(erpConnections).where(eq(erpConnections.tenantId, org.tenantId)),
      );
    expect(row!.credentialsSealed).toBeNull();
  });
});

describe('orders out to SAP Business One (BR-60)', () => {
  it('sends accepted lines once by NumAtCard, even when SAP’s answer is lost, and holds what SAP lacks', async () => {
    const t = await orderingTenant(app, world, 'SAP Orders Agro');
    const connection = (await connect(t.admin)).json();
    const saved = await call('PUT', `/v1/erp-connections/${connection.id}/settings`, t.admin, {
      accountType: 'distributor',
      defaultTerritory: t.marketCode,
      defaultTaxRate: '18',
      pushOrders: true,
      read: { customers: true, items: true, invoices: false, payments: false },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    sap.partners = [
      { CardCode: t.distributorCode, CardName: 'Kisan Traders', CardType: 'cCustomer' },
    ];
    sap.itemGroups = [];
    // KARANJ isn't in SAP.
    sap.items = ['NEEM', 'UREA'].map((code) => ({
      ItemCode: code,
      ItemName: `${code} item`,
      SalesUnit: 'pack',
      ItemPrices: [],
    }));
    sap.orders = [];

    // 2 cases of neem at 360 a pack: 24 packs; urea rejected.
    const partly = await t.order({ NEEM: '2', UREA: '1' }, ['NEEM']);
    const karanj = await t.order({ KARANJ: '1' }, ['KARANJ']);
    await app.get(ErpRuns).pull(t.tenantId, connection.id, null);

    sap.failNext('/Orders', 0, 'POST');
    await app.get(ErpRuns).push(t.tenantId, connection.id);
    expect(await latestRun(t.admin, connection.id)).toMatchObject({
      kind: 'push',
      status: 'failed',
      stoppedBy: 'error',
    });
    expect(sap.orders).toHaveLength(1);

    await app.get(ErpRuns).push(t.tenantId, connection.id);
    const pushed = await latestRun(t.admin, connection.id);
    expect(pushed).toMatchObject({
      kind: 'push',
      status: 'partial',
      counts: { order: { read: 2, unchanged: 1, skipped: 1 } },
    });
    expect(pushed.problems).toEqual([
      expect.objectContaining({
        externalId: karanj.id,
        issue: 'not_in_books',
        detail: 'item:KARANJ',
      }),
    ]);
    expect(sap.orders).toEqual([
      expect.objectContaining({
        CardCode: t.distributorCode,
        NumAtCard: String(partly.number),
        DocumentLines: [{ ItemCode: 'NEEM', Quantity: 24, UnitPrice: 360 }],
      }),
    ]);
    await app.get(ErpRuns).push(t.tenantId, connection.id);
    expect(sap.orders).toHaveLength(1);
  });
});
