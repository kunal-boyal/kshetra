import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { accounts } from '../src/db/schema/accounts';
import { items, priceListItems } from '../src/db/schema/catalogue';
import { erpLinks } from '../src/db/schema/erp';
import { accountInvoices, accountReceipts } from '../src/db/schema/finance';
import { territories } from '../src/db/schema/territories';
import { ErpRuns } from '../src/modules/erp/erp-runs';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { newAddress, newPhone, startApp, World } from './support';

/**
 * Tally by file exchange (module M20, BR-61, decision D129): connecting with nothing to reach,
 * uploading its masters and Day Book as Tally exports them, in UTF-8 or UTF-16, through the import
 * targets; the same file again, a ledger renamed in Tally, another company's file, files that
 * aren't Tally's or declare entities, one that can't be read, and the module off. Tests run no
 * workers, so they read each upload as the worker would.
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

const MASTERS = readFileSync(join(__dirname, 'fixtures/tally/masters.xml'), 'utf8');
const DAY_BOOK = readFileSync(join(__dirname, 'fixtures/tally/daybook.xml'), 'utf8');

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

function send(token: string, connectionId: string, file: string | Buffer, name = 'Master.xml') {
  return app.inject({
    method: 'POST',
    url: `/v1/erp-connections/${connectionId}/uploads?name=${encodeURIComponent(name)}`,
    remoteAddress: newAddress(),
    headers: {
      authorization: `Bearer ${token}`,
      'idempotency-key': newId(),
      'content-type': 'application/xml',
    },
    payload: typeof file === 'string' ? Buffer.from(file, 'utf8') : file,
  });
}

/** Uploads a file and reads it as the worker would; the run as the portal shows it. */
async function upload(
  tenantId: string,
  token: string,
  connectionId: string,
  file: string | Buffer,
) {
  const sent = await send(token, connectionId, file);
  expect(sent.statusCode, sent.body).toBe(202);
  expect(sent.json()).toMatchObject({ kind: 'upload', status: 'running' });
  await app.get(ErpRuns).pull(tenantId, connectionId, sent.json().id);
  return (await call('GET', `/v1/erp-connections/${connectionId}/runs`, token)).json().items[0];
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

/** A Tally connection mapped to the tenant: Nashik's debtors to one territory, the rest another. */
async function connected(name: string) {
  const org = await organisation(name);
  const north = `N${newId().slice(-5).toUpperCase()}`;
  const south = `S${newId().slice(-5).toUpperCase()}`;
  await world.territory(org.tenantId, north);
  await world.territory(org.tenantId, south);
  const dealers = newId();
  for (const [id, listName, scope, targets] of [
    [newId(), 'Standard', 'default', []],
    [dealers, 'Dealers', 'account_type', ['customer']],
  ] as const) {
    const made = await call('PUT', `/v1/price-lists/${id}`, org.admin, {
      name: listName,
      scope,
      targets,
      validFrom: '2025-01-01',
    });
    expect(made.statusCode, made.body).toBe(201);
  }
  const made = await call('POST', '/v1/erp-connections/tally', org.admin, {});
  expect(made.statusCode, made.body).toBe(200);
  const connection = made.json();
  const saved = await call('PUT', `/v1/erp-connections/${connection.id}/settings`, org.admin, {
    accountType: 'customer',
    defaultTerritory: south,
    groupTerritories: { 'Debtors - Nashik': north },
    priceBooks: [{ pricebookId: 'Dealer', priceList: dealers }],
    defaultTaxRate: '12',
    // Tally's unit, as the catalogue names it.
    units: { Nos: 'piece' },
  });
  expect(saved.statusCode, saved.body).toBe(200);
  return { ...org, connection, north, south, dealers };
}

describe('connecting Tally (D129)', () => {
  it('connects with nothing to reach, and can’t be synced, only sent files', async () => {
    const org = await organisation('Tally Connecting');
    const made = await call('POST', '/v1/erp-connections/tally', org.admin, {});
    expect(made.json()).toMatchObject({
      provider: 'tally',
      status: 'connected',
      organization: null,
    });
    const listed = (await call('GET', '/v1/erp-connections', org.admin)).json();
    expect(listed.providers.map((entry: { provider: string }) => entry.provider)).toEqual([
      'zoho_books',
      'sap_b1',
      'tally',
    ]);
    const synced = await call('POST', `/v1/erp-connections/${made.json().id}/runs`, org.admin);
    expect(synced.statusCode).toBe(409);
  });
});

describe('reading Tally’s files (BR-61)', () => {
  it('reads the masters, then the Day Book, through the import targets', async () => {
    const org = await connected('Tally Reading');
    const masters = await upload(org.tenantId, org.admin, org.connection.id, MASTERS);
    expect(masters).toMatchObject({
      kind: 'upload',
      status: 'partial',
      stoppedBy: null,
      file: 'Master.xml',
      counts: {
        account: { read: 3, created: 2, skipped: 1 },
        item: { read: 3, created: 2, skipped: 1 },
        price: { read: 2, skipped: 0 },
      },
    });
    expect(masters.problems).toEqual([
      expect.objectContaining({
        entity: 'account',
        label: 'Pawar Krishi Bhandar',
        issue: 'no_customer_number',
      }),
      expect.objectContaining({ entity: 'item', label: 'Spray Pump 16 L', issue: 'no_sku' }),
    ]);
    // The first file names the company.
    const shown = (await call('GET', '/v1/erp-connections', org.admin)).json();
    expect(shown.providers[2].connection.organization).toEqual({
      id: 'Sahyadri Agro Inputs',
      name: 'Sahyadri Agro Inputs',
    });

    const read = <T>(work: Parameters<Database['forTenant']>[1]) =>
      app.get(Database).forTenant(org.tenantId, work) as Promise<T>;
    expect(
      await read<{ code: string; name: string; territory: string }[]>((tx) =>
        tx
          .select({ code: accounts.code, name: accounts.name, territory: territories.code })
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
        { code: 'SGA-014', name: 'Shree Ganesh Agencies', territory: org.north },
        { code: 'KSK-002', name: 'Kisan Seva Kendra & Sons', territory: org.south },
      ]),
    );
    expect(
      await read<{ code: string; taxRate: string; price: string }[]>((tx) =>
        tx
          .select({ code: items.code, taxRate: items.taxRate, price: priceListItems.price })
          .from(priceListItems)
          .innerJoin(
            items,
            and(eq(items.tenantId, priceListItems.tenantId), eq(items.id, priceListItems.itemId)),
          )
          .where(
            and(
              eq(priceListItems.tenantId, org.tenantId),
              eq(priceListItems.priceListId, org.dealers),
            ),
          ),
      ),
    ).toEqual(
      expect.arrayContaining([
        { code: 'NG-1L', taxRate: '18.0000', price: '410.00' },
        { code: 'HP-500', taxRate: '12.0000', price: '120.00' },
      ]),
    );

    // The Day Book alone: its renamed sales type is known from the masters before it.
    const day = await upload(org.tenantId, org.admin, org.connection.id, DAY_BOOK);
    expect(day.counts).toMatchObject({
      invoice: { read: 3, created: 2, skipped: 1 },
      receipt: { read: 1, created: 1, skipped: 0 },
    });
    expect(day.problems).toEqual([
      expect.objectContaining({
        entity: 'invoice',
        label: 'SI/25-26/0431',
        issue: 'unknown_customer',
      }),
    ]);
    expect(
      await read<{ number: string; amount: string; dueDate: string | null }[]>((tx) =>
        tx
          .select({
            number: accountInvoices.number,
            amount: accountInvoices.amount,
            dueDate: accountInvoices.dueDate,
          })
          .from(accountInvoices)
          .where(eq(accountInvoices.tenantId, org.tenantId)),
      ),
    ).toEqual(
      expect.arrayContaining([
        { number: 'SI/25-26/0412', amount: '23600.00', dueDate: '2025-11-19' },
        { number: 'SI/25-26/0430', amount: '11800.00', dueDate: '2025-11-09' },
      ]),
    );
    expect(
      await read<{ against: string[] | null; amount: string }[]>((tx) =>
        tx
          .select({ against: accountReceipts.against, amount: accountReceipts.amount })
          .from(accountReceipts)
          .where(eq(accountReceipts.tenantId, org.tenantId)),
      ),
    ).toEqual([{ against: ['SI/25-26/0412', 'SI/25-26/0430'], amount: '30000.00' }]);

    // The same file again writes nothing.
    const again = await upload(org.tenantId, org.admin, org.connection.id, DAY_BOOK);
    expect(again.counts).toMatchObject({
      invoice: { created: 0, updated: 0, unchanged: 2 },
      receipt: { created: 0, updated: 0, unchanged: 1 },
    });
  });

  it('keeps a ledger renamed in Tally as the same account, and reads UTF-16', async () => {
    const org = await connected('Tally Renaming');
    await upload(org.tenantId, org.admin, org.connection.id, MASTERS);
    const renamed = MASTERS.replaceAll('Shree Ganesh Agencies', 'Shree Ganesh Agencies Pvt Ltd');
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(renamed, 'utf16le')]);
    const run = await upload(org.tenantId, org.admin, org.connection.id, utf16);
    expect(run.counts.account).toMatchObject({ created: 0, updated: 1 });
    const read = <T>(work: Parameters<Database['forTenant']>[1]) =>
      app.get(Database).forTenant(org.tenantId, work) as Promise<T>;
    expect(
      await read<{ name: string }[]>((tx) =>
        tx
          .select({ name: accounts.name })
          .from(accounts)
          .where(and(eq(accounts.tenantId, org.tenantId), eq(accounts.code, 'SGA-014'))),
      ),
    ).toEqual([{ name: 'Shree Ganesh Agencies Pvt Ltd' }]);
    expect(
      await read<{ externalName: string | null }[]>((tx) =>
        tx
          .select({ externalName: erpLinks.externalName })
          .from(erpLinks)
          .where(and(eq(erpLinks.tenantId, org.tenantId), eq(erpLinks.localKey, 'SGA-014'))),
      ),
    ).toEqual([{ externalName: 'Shree Ganesh Agencies Pvt Ltd' }]);
    // Vouchers naming the new name find their customer.
    const day = await upload(
      org.tenantId,
      org.admin,
      org.connection.id,
      DAY_BOOK.replaceAll('Shree Ganesh Agencies', 'Shree Ganesh Agencies Pvt Ltd'),
    );
    expect(day.counts.invoice).toMatchObject({ created: 2, skipped: 1 });
  });

  it('refuses another company’s file, files that aren’t Tally’s and any declaration', async () => {
    const org = await connected('Tally Refusing');
    await upload(org.tenantId, org.admin, org.connection.id, MASTERS);
    const refusal = async (file: string) => {
      const answer = await send(org.admin, org.connection.id, file);
      expect(answer.statusCode, answer.body).toBe(502);
      return answer.json().error;
    };
    expect(await refusal(MASTERS.replace('Sahyadri Agro Inputs', 'Another Company'))).toMatchObject(
      {
        code: 'ERP_REFUSED',
        details: [{ path: 'file', issue: 'tally_other_company' }],
      },
    );
    expect((await refusal('Name,Code\nA,1\n')).details).toEqual([
      { path: 'file', issue: 'tally_not_tally' },
    ]);
    expect(
      (
        await refusal(
          `<!DOCTYPE x [<!ENTITY a "aaaa">]>${MASTERS.replace('<LEDGER NAME="Pawar', '<LEDGER NAME="&a;')}`,
        )
      ).details,
    ).toEqual([{ path: 'file', issue: 'tally_declarations' }]);
    const empty = await send(org.admin, org.connection.id, '');
    expect(empty.statusCode).toBe(400);
  });

  it('marks a file that can’t be read, and closes everything while the module is off', async () => {
    const org = await connected('Tally Broken');
    const broken = MASTERS.replace('</LEDGER>', '');
    const run = await upload(org.tenantId, org.admin, org.connection.id, broken);
    expect(run).toMatchObject({ status: 'failed', stoppedBy: 'bad_file' });

    await app
      .get(Database)
      .forTenant(org.tenantId, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, org.tenantId, SYSTEM_ACTOR, { modulesOff: ['integrations'] }),
      );
    const closed = await send(org.admin, org.connection.id, MASTERS);
    expect(closed.statusCode).toBe(403);
    expect(closed.json().error.code).toBe('MODULE_DISABLED');
  });
});
