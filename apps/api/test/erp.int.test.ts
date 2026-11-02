import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../src/db/schema/accounts';
import { items, priceListItems } from '../src/db/schema/catalogue';
import { erpConnections, erpLinks } from '../src/db/schema/erp';
import { accountInvoices, accountReceipts } from '../src/db/schema/finance';
import { territories } from '../src/db/schema/territories';
import { ErpRuns } from '../src/modules/erp/erp-runs';
import { FakeZohoBooks } from '../src/modules/erp/fake-zoho-books';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { newAddress, newDevice, newPhone, startApp, World } from './support';

/**
 * ERP connectors, Zoho Books first (module M20, BR-59, decision D129): connecting through OAuth
 * against a fake organisation, refusing hosts that aren't Zoho's, the mappings, reading customers,
 * items, a price book, invoices and payments through the import targets, a quiet second run,
 * changes, Zoho's limit, a revoked agreement, the module off, and disconnecting. Tests run no
 * workers, so they run each pull as the worker would.
 */

let app: NestFastifyApplication;
let world: World;
let zoho: FakeZohoBooks;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  zoho = app.get(FakeZohoBooks);
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

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

/** Connects through the fake: start, agree at "Zoho", and come back with its code. */
async function connect(admin: string) {
  const started = await call('POST', '/v1/erp-connections/zoho/start', admin, { region: 'in' });
  expect(started.statusCode, started.body).toBe(200);
  const state = new URL(started.json().authorizeUrl).searchParams.get('state')!;
  const done = await call('POST', '/v1/erp-connections/zoho/complete', admin, {
    code: zoho.issueCode(),
    state,
    accountsServer: 'https://accounts.zoho.in',
  });
  expect(done.statusCode, done.body).toBe(200);
  return done.json() as { id: string; status: string; organization: { name: string } | null };
}

async function pull(tenantId: string, admin: string, connectionId: string) {
  const asked = await call('POST', `/v1/erp-connections/${connectionId}/runs`, admin);
  expect(asked.statusCode, asked.body).toBe(202);
  await app.get(ErpRuns).pull(tenantId, connectionId, asked.json().id);
  return latestRun(admin, connectionId);
}

async function latestRun(admin: string, connectionId: string) {
  const runs = await call('GET', `/v1/erp-connections/${connectionId}/runs`, admin);
  return runs.json().items[0];
}

const db = (tenantId: string) => ({
  read: <T>(work: Parameters<Database['forTenant']>[1]) =>
    app.get(Database).forTenant(tenantId, work) as Promise<T>,
});

describe('connecting Zoho Books (D129)', () => {
  it('sends the browser to Zoho’s region with the scopes and a state, and connects once', async () => {
    const org = await organisation('ERP Connecting');
    const listed = await call('GET', '/v1/erp-connections', org.admin);
    expect(listed.json()).toEqual({
      providers: [
        { provider: 'zoho_books', configured: true, connection: null },
        { provider: 'sap_b1', configured: true, connection: null },
      ],
    });

    const started = await call('POST', '/v1/erp-connections/zoho/start', org.admin, {
      region: 'in',
    });
    const url = new URL(started.json().authorizeUrl);
    expect(url.origin + url.pathname).toBe('https://accounts.zoho.in/oauth/v2/auth');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:5173/settings/erp/zoho');
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('scope')).toContain('ZohoBooks.salesorders.CREATE');
    expect(url.searchParams.get('client_id')).toBe('test-zoho-client');

    // A look-alike accounts server gets nothing: no code, no secret.
    const sent = zoho.requests.length;
    const hostile = await call('POST', '/v1/erp-connections/zoho/complete', org.admin, {
      code: zoho.issueCode(),
      state: url.searchParams.get('state'),
      accountsServer: 'https://accounts.zoho.in.evil.example',
    });
    expect(hostile.statusCode).toBe(400);
    expect(hostile.json().error.details).toEqual([{ path: 'accountsServer', issue: 'not_zoho' }]);
    expect(zoho.requests).toHaveLength(sent);

    // The state was spent; it can't be used again, nor by someone else.
    const replayed = await call('POST', '/v1/erp-connections/zoho/complete', org.admin, {
      code: zoho.issueCode(),
      state: url.searchParams.get('state'),
      accountsServer: 'https://accounts.zoho.in',
    });
    expect(replayed.json().error.details[0].path).toBe('state');

    const connection = await connect(org.admin);
    expect(connection).toMatchObject({
      status: 'connected',
      organization: { id: '60001', name: 'Sunrise Traders Pvt Ltd' },
    });
    const [row] = await db(org.tenantId).read<(typeof erpConnections.$inferSelect)[]>((tx) =>
      tx.select().from(erpConnections).where(eq(erpConnections.tenantId, org.tenantId)),
    );
    expect(row!.refreshTokenSealed).toMatch(/^v2:/);
    expect(row!.refreshTokenSealed).not.toContain('1000.refresh');
  });

  it('refuses a code Zoho doesn’t take, and a stranger’s state', async () => {
    const org = await organisation('ERP Refused');
    const other = await organisation('ERP Stranger');
    const started = await call('POST', '/v1/erp-connections/zoho/start', org.admin, {
      region: 'in',
    });
    const state = new URL(started.json().authorizeUrl).searchParams.get('state');
    const stranger = await call('POST', '/v1/erp-connections/zoho/complete', other.admin, {
      code: zoho.issueCode(),
      state,
      accountsServer: 'https://accounts.zoho.in',
    });
    expect(stranger.json().error.details[0].path).toBe('state');

    const again = await call('POST', '/v1/erp-connections/zoho/start', org.admin, { region: 'in' });
    const refused = await call('POST', '/v1/erp-connections/zoho/complete', org.admin, {
      code: '1000.not-a-code',
      state: new URL(again.json().authorizeUrl).searchParams.get('state'),
      accountsServer: 'https://accounts.zoho.in',
    });
    expect(refused.statusCode).toBe(502);
    expect(refused.json().error.code).toBe('ERP_REFUSED');
  });
});

describe('reading the books (BR-59)', () => {
  it('reads customers, items, a price book, invoices and payments, and an unchanged hour writes nothing', async () => {
    const org = await organisation('ERP Reading');
    const north = `N${newId().slice(-5).toUpperCase()}`;
    const south = `S${newId().slice(-5).toUpperCase()}`;
    await world.territory(org.tenantId, north);
    await world.territory(org.tenantId, south);
    const standard = newId();
    const wholesale = newId();
    for (const [id, name, scope, targets] of [
      [standard, 'Standard', 'default', []],
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
    const connection = await connect(org.admin);

    const wrong = await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      accountType: 'spaceship',
      defaultTerritory: 'NOWHERE',
      priceBooks: [{ pricebookId: 'PB1', priceList: newId() }],
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'accountType', issue: 'Choose one of your account types' },
      { path: 'defaultTerritory', issue: 'Choose one of your active territories' },
      { path: 'priceBooks.0.priceList', issue: 'Choose one of your price lists' },
    ]);
    const saved = await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      accountType: 'customer',
      territoryField: 'Territory',
      defaultTerritory: south,
      priceBooks: [{ pricebookId: 'PB1', priceList: wholesale }],
      invoiceDays: 365,
    });
    expect(saved.statusCode, saved.body).toBe(200);

    const tag = newId().slice(-6).toUpperCase();
    const day = new Date().toISOString().slice(0, 10);
    zoho.contacts = [
      {
        contact_id: `c1-${tag}`,
        contact_name: 'Ravi Kumar',
        company_name: 'Shree Ganesh Agencies',
        contact_number: `C1-${tag}`,
        status: 'active',
        last_modified_time: '2026-10-01T10:00:00+0530',
        billing_address: {
          address: '12 Market Road',
          city: 'Nashik',
          state: 'Maharashtra',
          zip: '422001',
        },
        custom_fields: [{ label: 'Territory', value: north }],
      },
      {
        contact_id: `c2-${tag}`,
        contact_name: 'Meena Stores',
        contact_number: `C2-${tag}`,
        status: 'active',
        last_modified_time: '2026-10-01T10:00:00+0530',
      },
      {
        contact_id: `c3-${tag}`,
        contact_name: 'No Number Traders',
        status: 'active',
        last_modified_time: '2026-10-01T10:00:00+0530',
      },
      {
        contact_id: `c4-${tag}`,
        contact_name: 'Twice Numbered',
        contact_number: `C2-${tag}`,
        status: 'active',
        last_modified_time: '2026-10-01T10:00:00+0530',
      },
      { contact_id: `v1-${tag}`, contact_name: 'A Supplier', contact_type: 'vendor' },
    ];
    zoho.items = [
      {
        item_id: `i1-${tag}`,
        name: 'Tea 250 g',
        sku: `TEA-${tag}`,
        group_name: 'Tea',
        unit: 'Piece',
        rate: 120,
        tax_percentage: 5,
        hsn_or_sac: '0902',
        status: 'active',
      },
      { item_id: `i2-${tag}`, name: 'Unlabelled', unit: 'Piece', rate: 10, status: 'active' },
    ];
    zoho.priceBooks = [
      {
        pricebook_id: 'PB1',
        name: 'Wholesale',
        pricebook_type: 'per_item',
        sales_or_purchase_type: 'sales',
        pricebook_items: [{ item_id: `i1-${tag}`, pricebook_rate: 99 }],
      },
    ];
    zoho.invoices = [
      {
        invoice_id: `inv1-${tag}`,
        invoice_number: `INV-${tag}-1`,
        customer_id: `c1-${tag}`,
        date: day,
        due_date: day,
        total: 23600,
        status: 'sent',
      },
      {
        invoice_id: `inv2-${tag}`,
        invoice_number: `INV-${tag}-2`,
        customer_id: `c1-${tag}`,
        date: day,
        total: 500,
        status: 'draft',
      },
      {
        invoice_id: `inv3-${tag}`,
        invoice_number: `INV-${tag}-3`,
        customer_id: `c3-${tag}`,
        date: day,
        total: 700,
        status: 'sent',
      },
    ];
    zoho.payments = [
      {
        payment_id: `p1-${tag}`,
        payment_number: `R-${tag}`,
        customer_id: `c1-${tag}`,
        date: day,
        amount: 10000,
        invoice_numbers: `INV-${tag}-1`,
      },
    ];
    zoho.pageSize = 2;

    const first = await pull(org.tenantId, org.admin, connection.id);
    expect(first).toMatchObject({
      status: 'partial',
      stoppedBy: null,
      counts: {
        account: { read: 4, created: 2, updated: 0, unchanged: 0, skipped: 2 },
        item: { read: 2, created: 1, updated: 0, unchanged: 0, skipped: 1 },
        // A price alone is no new or changed item to the items import; the list below holds it.
        price: { read: 1, skipped: 0 },
        invoice: { read: 2, created: 1, updated: 0, unchanged: 0, skipped: 1 },
        receipt: { read: 1, created: 1, updated: 0, unchanged: 0, skipped: 0 },
      },
    });
    expect(
      first.problems.map((problem: { label: string; issue: string }) => [
        problem.label,
        problem.issue,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ['No Number Traders', 'no_customer_number'],
        [`C2-${tag}`, 'duplicate_code'],
        ['Unlabelled', 'no_sku'],
        [`INV-${tag}-3`, 'unknown_customer'],
      ]),
    );

    const read = db(org.tenantId).read;
    const found = await read<
      { code: string; name: string; territory: string; address: { city?: string } }[]
    >((tx) =>
      tx
        .select({
          code: accounts.code,
          name: accounts.name,
          territory: territories.code,
          address: accounts.address,
        })
        .from(accounts)
        .innerJoin(
          territories,
          and(
            eq(territories.tenantId, accounts.tenantId),
            eq(territories.id, accounts.territoryId),
          ),
        )
        .where(eq(accounts.tenantId, org.tenantId)),
    );
    expect(found).toEqual(
      expect.arrayContaining([
        {
          code: `C1-${tag}`,
          name: 'Shree Ganesh Agencies',
          territory: north,
          address: expect.objectContaining({ city: 'Nashik' }),
        },
        { code: `C2-${tag}`, name: 'Meena Stores', territory: south, address: {} },
      ]),
    );
    const wholesalePrices = await read<{ code: string; price: string }[]>((tx) =>
      tx
        .select({ code: items.code, price: priceListItems.price })
        .from(priceListItems)
        .innerJoin(
          items,
          and(eq(items.tenantId, priceListItems.tenantId), eq(items.id, priceListItems.itemId)),
        )
        .where(
          and(eq(priceListItems.tenantId, org.tenantId), eq(priceListItems.priceListId, wholesale)),
        ),
    );
    expect(wholesalePrices).toEqual([{ code: `TEA-${tag}`, price: '99.00' }]);
    const [receipt] = await read<{ against: string[] | null; amount: string }[]>((tx) =>
      tx
        .select({ against: accountReceipts.against, amount: accountReceipts.amount })
        .from(accountReceipts)
        .where(eq(accountReceipts.tenantId, org.tenantId)),
    );
    expect(receipt).toEqual({ against: [`INV-${tag}-1`], amount: '10000.00' });
    expect(
      await read<{ number: string }[]>((tx) =>
        tx
          .select({ number: accountInvoices.number })
          .from(accountInvoices)
          .where(eq(accountInvoices.tenantId, org.tenantId)),
      ),
    ).toEqual([{ number: `INV-${tag}-1` }]);

    // The hourly run: nothing changed in the books, so no customer's page is read and nothing
    // is written.
    const before = zoho.apiCalls().length;
    await app.get(ErpRuns).pull(org.tenantId, null, null);
    const quiet = await latestRun(org.admin, connection.id);
    const written = Object.values(
      quiet.counts as Record<string, { created: number; updated: number }>,
    ).reduce((sum, counts) => sum + counts.created + counts.updated, 0);
    expect(written).toBe(0);
    expect(quiet.counts.account).toMatchObject({ read: 4, unchanged: 4 });
    expect(
      zoho
        .apiCalls()
        .slice(before)
        .filter((request) => /\/contacts\/[^?]/.test(request.url)),
    ).toEqual([]);

    // The books change one customer: only it is read and written.
    zoho.contacts[1] = {
      ...zoho.contacts[1]!,
      contact_name: 'Meena General Stores',
      last_modified_time: '2026-11-02T09:00:00+0530',
    };
    await app.get(ErpRuns).pull(org.tenantId, null, null);
    expect((await latestRun(org.admin, connection.id)).counts.account).toMatchObject({
      updated: 1,
      unchanged: 3,
    });

    // Every write was the connection's own, in the audit log.
    const audit = await call('GET', `/v1/audit?actorKind=connector`, org.admin);
    expect(audit.statusCode, audit.body).toBe(200);
    expect(audit.json().items.length).toBeGreaterThan(0);
    expect(
      audit
        .json()
        .items.every((entry: { actor: { kind: string } }) => entry.actor.kind === 'connector'),
    ).toBe(true);
    zoho.pageSize = 200;
  });

  it('stops at Zoho’s limit and carries on next time; a revoked agreement asks to connect again', async () => {
    const org = await organisation('ERP Limits');
    await world.territory(org.tenantId, 'EAST');
    const connection = await connect(org.admin);
    await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      accountType: 'customer',
      defaultTerritory: 'EAST',
    });
    const tag = newId().slice(-6).toUpperCase();
    zoho.contacts = [
      { contact_id: `l1-${tag}`, contact_name: 'Limit Stores', contact_number: `L1-${tag}` },
    ];
    zoho.items = [];
    zoho.invoices = [];
    zoho.payments = [];

    zoho.failNext('/books/v3/contacts', 429);
    const limited = await pull(org.tenantId, org.admin, connection.id);
    expect(limited).toMatchObject({ status: 'partial', stoppedBy: 'rate_limited' });
    const after = await pull(org.tenantId, org.admin, connection.id);
    expect(after).toMatchObject({ status: 'ok', counts: { account: { created: 1 } } });

    zoho.revokeAll();
    const revoked = await pull(org.tenantId, org.admin, connection.id);
    expect(revoked).toMatchObject({ status: 'failed', stoppedBy: 'reconnect' });
    const listed = await call('GET', '/v1/erp-connections', org.admin);
    expect(listed.json().providers[0].connection.status).toBe('needs_reconnect');
    const asked = await call('POST', `/v1/erp-connections/${connection.id}/runs`, org.admin);
    expect(asked.json().error.code).toBe('CONFLICT');

    // Connecting again keeps the organisation and the mappings.
    const again = await connect(org.admin);
    expect(again).toMatchObject({ id: connection.id, status: 'connected' });
    expect(
      (await call('GET', '/v1/erp-connections', org.admin)).json().providers[0].connection,
    ).toMatchObject({ settings: { accountType: 'customer', defaultTerritory: 'EAST' } });
  });

  it('does nothing while the integrations module is off, and disconnecting revokes and keeps links', async () => {
    const org = await organisation('ERP Module');
    await world.territory(org.tenantId, 'WEST');
    const connection = await connect(org.admin);
    await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      accountType: 'customer',
      defaultTerritory: 'WEST',
    });
    const tag = newId().slice(-6).toUpperCase();
    zoho.contacts = [
      { contact_id: `m1-${tag}`, contact_name: 'Module Stores', contact_number: `M1-${tag}` },
    ];
    await pull(org.tenantId, org.admin, connection.id);

    await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, org.tenantId, SYSTEM_ACTOR, { modulesOff: ['integrations'] }),
      );
    const closed = await call('GET', '/v1/erp-connections', org.admin);
    expect(closed.statusCode).toBe(403);
    const calls = zoho.apiCalls().length;
    await app.get(ErpRuns).pull(org.tenantId, null, null);
    expect(zoho.apiCalls()).toHaveLength(calls);
    await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, org.tenantId, SYSTEM_ACTOR, { modulesOff: [] }),
      );

    const revokes = () => zoho.requests.filter((request) => request.url.includes('/revoke')).length;
    const revoked = revokes();
    const disconnected = await call(
      'POST',
      `/v1/erp-connections/${connection.id}/disconnect`,
      org.admin,
    );
    expect(disconnected.json().status).toBe('disconnected');
    expect(revokes()).toBe(revoked + 1);
    const links = await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        tx.select().from(erpLinks).where(eq(erpLinks.tenantId, org.tenantId)),
      );
    expect(links.map((link) => link.localKey)).toContain(`M1-${tag}`);
    const [row] = await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        tx.select().from(erpConnections).where(eq(erpConnections.tenantId, org.tenantId)),
      );
    expect(row!.refreshTokenSealed).toBeNull();
  });
});

describe('orders out (BR-59)', () => {
  /** An agri tenant: a head, an ASM and an SME holding a distributor, and three items. */
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
    const tokens = {
      head: (await world.signIn(phones.head)).accessToken,
      asm: (await world.signIn(phones.asm)).accessToken,
      sme: (await world.signIn(phones.sme, newDevice())).accessToken,
    };
    const marketCode = `M${newId().slice(-6).toUpperCase()}`;
    const market = await world.territory(tenantId, marketCode);
    const distributor = newId();
    const distributorCode = `D-${newId().slice(-6).toUpperCase()}`;
    const sme = (await call('GET', '/v1/me', tokens.sme)).json();
    const made = await call('POST', '/v1/accounts', tokens.head, {
      id: distributor,
      type: 'distributor',
      code: distributorCode,
      name: 'Kisan Traders',
      territoryId: market,
      slots: { asm: asm.id, sme: sme.userId },
    });
    expect(made.statusCode, made.body).toBe(201);
    const itemIds: Record<string, string> = {};
    for (const itemCode of ['NEEM', 'UREA', 'KARANJ']) {
      const id = newId();
      const saved = await call('PUT', `/v1/items/${id}`, tokens.head, {
        code: itemCode,
        name: `${itemCode} item`,
        productName: `${itemCode} product`,
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
      itemIds[itemCode] = id;
    }
    const list = newId();
    await call('PUT', `/v1/price-lists/${list}`, tokens.head, {
      name: 'Standard',
      scope: 'default',
      validFrom: '2026-01-01',
    });
    const { version } = (await call('GET', `/v1/price-lists/${list}`, tokens.head)).json();
    const prices: Record<string, { price: string; discount: string }> = {
      NEEM: { price: '400.00', discount: '10' },
      UREA: { price: '90.23', discount: '0' },
      KARANJ: { price: '50.00', discount: '0' },
    };
    const priced = await call('PUT', `/v1/price-lists/${list}/items`, tokens.head, {
      set: Object.entries(prices).map(([itemCode, entry]) => ({
        itemId: itemIds[itemCode],
        ...entry,
      })),
      version,
    });
    expect(priced.statusCode, priced.body).toBe(200);

    /** Places an order in cases, then the ASM and the head decide each line. */
    const order = async (lines: Record<string, string>, accepted: string[]) => {
      const id = newId();
      const placed = await call('POST', '/v1/orders', tokens.sme, {
        id,
        accountId: distributor,
        lines: Object.entries(lines).map(([itemCode, cases]) => ({
          itemId: itemIds[itemCode],
          unitKey: 'case',
          quantity: cases,
          quoted: { listId: list, ...prices[itemCode]!, taxRate: '18', factor: '12', scheme: null },
        })),
        free: [],
        fix: {
          location: { lat: 28.6315, lng: 77.2167 },
          accuracy: 12,
          mocked: false,
          capturedAt: new Date().toISOString(),
        },
        placedAt: new Date().toISOString(),
      });
      expect(placed.statusCode, placed.body).toBe(201);
      const seen = (await call('GET', `/v1/orders/${id}`, tokens.asm)).json();
      await call('POST', `/v1/orders/${id}/decision`, tokens.asm, {
        decision: 'accept',
        version: seen.approval.version,
      });
      const atHead = (await call('GET', `/v1/orders/${id}`, tokens.head)).json();
      const decided = await call('POST', `/v1/orders/${id}/line-decisions`, tokens.head, {
        lines: atHead.lines.map((line: { id: string; item: { code: string } }) =>
          accepted.includes(line.item.code)
            ? { lineId: line.id, decision: 'accepted' }
            : { lineId: line.id, decision: 'rejected', reason: 'no_stock' },
        ),
        version: atHead.approval.version,
      });
      expect(decided.statusCode, decided.body).toBe(200);
      return decided.json() as { id: string; number: number; status: string };
    };
    return { tenantId, admin: tokens.head, marketCode, distributorCode, order };
  }

  it('sends accepted lines once, even when Zoho’s answer is lost, and holds an order the books can’t take', async () => {
    const t = await agri('ERP Orders Agro');
    const connection = await connect(t.admin);
    const saved = await call('PUT', `/v1/erp-connections/${connection.id}/settings`, t.admin, {
      accountType: 'distributor',
      defaultTerritory: t.marketCode,
      pushOrders: true,
      read: { customers: true, items: true, invoices: false, payments: false },
    });
    expect(saved.statusCode, saved.body).toBe(200);
    const tag = newId().slice(-6);
    zoho.contacts = [
      {
        contact_id: `z-dist-${tag}`,
        contact_name: 'Kisan Traders',
        contact_number: t.distributorCode,
        status: 'active',
      },
    ];
    // KARANJ isn't in the books.
    zoho.items = ['NEEM', 'UREA'].map((sku) => ({
      item_id: `z-${sku}-${tag}`,
      name: `${sku} item`,
      sku,
      group_name: `${sku} product`,
      unit: 'pack',
      tax_percentage: 18,
      hsn_or_sac: '3808',
      status: 'active',
    }));
    zoho.salesOrders = [];

    // 2 cases of neem at 360 a pack: 8,640.00 for 24 packs; urea rejected.
    const partly = await t.order({ NEEM: '2', UREA: '1' }, ['NEEM']);
    expect(partly.status).toBe('partially_accepted');
    // 3 cases of urea: 36 packs at 90.23, 3,248.28.
    const urea = await t.order({ UREA: '3' }, ['UREA']);
    const karanj = await t.order({ KARANJ: '1' }, ['KARANJ']);
    await app.get(ErpRuns).pull(t.tenantId, connection.id, null);

    // The first order's answer is lost after Zoho made it.
    zoho.failNext('/books/v3/salesorders', 0, 'POST');
    await app.get(ErpRuns).push(t.tenantId, connection.id);
    expect(await latestRun(t.admin, connection.id)).toMatchObject({
      kind: 'push',
      status: 'failed',
      stoppedBy: 'error',
    });
    expect(zoho.salesOrders).toHaveLength(1);

    await app.get(ErpRuns).push(t.tenantId, connection.id);
    const pushed = await latestRun(t.admin, connection.id);
    expect(pushed).toMatchObject({
      kind: 'push',
      status: 'partial',
      counts: { order: { read: 3, created: 1, unchanged: 1, skipped: 1 } },
    });
    expect(pushed.problems).toEqual([
      {
        entity: 'order',
        externalId: karanj.id,
        label: `#${karanj.number}`,
        issue: 'not_in_books',
        field: null,
        detail: 'item:KARANJ',
      },
    ]);
    expect(zoho.salesOrders).toEqual([
      {
        salesorder_id: expect.any(String),
        customer_id: `z-dist-${tag}`,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        reference_number: String(partly.number),
        line_items: [{ item_id: `z-NEEM-${tag}`, quantity: 24, rate: 360 }],
      },
      {
        salesorder_id: expect.any(String),
        customer_id: `z-dist-${tag}`,
        date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        reference_number: String(urea.number),
        line_items: [{ item_id: `z-UREA-${tag}`, quantity: 36, rate: 90.23 }],
      },
    ]);

    // Once sent, an order is never sent again.
    await app.get(ErpRuns).push(t.tenantId, connection.id);
    expect(zoho.salesOrders).toHaveLength(2);
    expect((await latestRun(t.admin, connection.id)).counts.order).toMatchObject({
      read: 1,
      skipped: 1,
    });
  });

  it('tells whoever may connect the books when Zoho refuses the agreement, once a day', async () => {
    const org = await organisation('ERP Reconnect');
    const connection = await connect(org.admin);
    await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
      read: { customers: true, items: false, invoices: false, payments: false },
      accountType: 'customer',
    });
    zoho.contacts = [];
    zoho.revokeAll();
    await app.get(ErpRuns).pull(org.tenantId, connection.id, null);
    const inbox = await call('GET', '/v1/notifications', org.admin);
    expect(inbox.statusCode, inbox.body).toBe(200);
    const notices = inbox
      .json()
      .items.filter((item: { event: string }) => item.event === 'erp.reconnect');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatchObject({ link: '/settings/erp' });
  });
});
