import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, todayIn } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricFactsDaily } from '../src/db/schema/metrics';
import { Database } from '../src/platform/database';
import { newAddress, newPhone, startApp, World } from './support';

/**
 * Bulk upserts (spec 11.2, module M20, decision D94): the rows of a file import as JSON, checked
 * and written all or nothing, once for an idempotency key; and external metric values, which count
 * for a person, or for an account's field person, on a day or the last day of a month.
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

const noun = (one: string) => ({ en: { one, other: `${one}s` }, hi: { one, other: one } });

function call(method: 'GET' | 'POST', url: string, token: string, body?: object, key = newId()) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(body ? { payload: body } : {}),
  });
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

/** An API client's token with these scopes. */
async function clientToken(admin: string, scopes: string[]) {
  const made = (
    await call('POST', '/v1/api-clients', admin, { id: newId(), name: 'ERP', scopes })
  ).json();
  const issued = await app.inject({
    method: 'POST',
    url: '/auth/v1/oauth/token',
    remoteAddress: newAddress(),
    payload: {
      grant_type: 'client_credentials',
      client_id: made.client.clientId,
      client_secret: made.clientSecret,
    },
  });
  return issued.json().access_token as string;
}

const code = () => `B${newId().slice(-7).toUpperCase()}`;

describe('bulk upserts (M20, D94)', () => {
  it('adds and updates people, once for a key, and writes nothing while a row has a problem', async () => {
    const org = await organisation('Bulk People');
    const asha = code();
    const rows = [
      { code: asha, name: 'Asha Rao', phone: newPhone().slice(3), designation: 'executive' },
      { code: code(), name: 'Ravi Shah', phone: newPhone().slice(3), designation: 'manager' },
    ];
    const key = newId();
    const loaded = await call('POST', '/v1/bulk/users', org.admin, { rows }, key);
    expect(loaded.statusCode, loaded.body).toBe(200);
    expect(loaded.json()).toEqual({ created: 2, updated: 0 });
    // A resend with its key applies once.
    expect((await call('POST', '/v1/bulk/users', org.admin, { rows }, key)).json()).toEqual({
      created: 2,
      updated: 0,
    });

    const bad = await call('POST', '/v1/bulk/users', org.admin, {
      rows: [
        { code: asha, name: 'Asha R. Rao', designation: 'executive' },
        { code: code(), name: 'Nobody', designation: 'astronaut' },
      ],
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('IMPORT_ERRORS');
    expect(bad.json().error.details).toContainEqual(
      expect.objectContaining({ path: 'rows.1.designation' }),
    );
    const people = (await call('GET', `/v1/users?q=${asha}`, org.admin)).json().items;
    expect(people[0].name).toBe('Asha Rao');

    const renamed = await call('POST', '/v1/bulk/users', org.admin, {
      rows: [{ code: asha, name: 'Asha R. Rao', designation: 'executive' }],
    });
    expect(renamed.json()).toEqual({ created: 0, updated: 1 });
  });

  it('loads accounts by type, items and statement entries for an API client with the scopes', async () => {
    const org = await organisation('Bulk Masters');
    const territory = await world.territory(org.tenantId, `T${newId().slice(-5)}`);
    await world.user(org.tenantId, { name: 'Field Rep', designation: 'executive' });
    const token = await clientToken(org.admin, [
      'accounts:write',
      'catalogue:write',
      'finance:write',
    ]);

    const fields = (
      await call('GET', '/v1/bulk/fields?target=accounts&accountType=customer', token)
    ).json();
    expect(fields.fields.map((field: { key: string }) => field.key)).toEqual(
      expect.arrayContaining(['code', 'name', 'territory_code', 'slot.executive']),
    );
    const territoryCode = (await call('GET', '/v1/territories', org.admin))
      .json()
      .items.find((item: { id: string }) => item.id === territory).code;
    const shop = code();
    const accounts = await call('POST', '/v1/bulk/accounts', token, {
      accountType: 'customer',
      rows: [
        {
          code: shop,
          name: 'Gupta Store',
          territory_code: territoryCode,
          'slot.executive': 'Field Rep',
        },
      ],
    });
    expect(accounts.statusCode, accounts.body).toBe(200);
    expect(accounts.json()).toEqual({ created: 1, updated: 0 });
    expect(
      (
        await call('POST', '/v1/bulk/accounts', token, {
          accountType: 'spaceship',
          rows: [{ code: 'X' }],
        })
      ).json().error.details,
    ).toEqual([{ path: 'accountType', issue: 'There is no such type of account' }]);

    const items = await call('POST', '/v1/bulk/items', token, {
      rows: [
        {
          item_code: code(),
          item_name: 'Urea 45 kg',
          product_name: 'Urea',
          base_unit: 'Piece',
          tax_rate: 5,
        },
      ],
    });
    expect(items.statusCode, items.body).toBe(200);
    expect(items.json().created).toBe(1);

    const reference = `INV-${newId().slice(-6)}`;
    const ledger = await call('POST', '/v1/bulk/ledger-entries', token, {
      rows: [{ reference, account_code: shop, date: '2026-10-20', debit: '12500.50' }],
    });
    expect(ledger.statusCode, ledger.body).toBe(200);
    expect(ledger.json()).toEqual({ created: 1, updated: 0 });

    // Without the scope, nothing.
    const reader = await clientToken(org.admin, ['people:read']);
    expect(
      (await call('POST', '/v1/bulk/items', reader, { rows: [{ item_code: 'X' }] })).json().error
        .code,
    ).toBe('FORBIDDEN');
  });

  it('counts external values for a person, and an account’s for its field person, on a day or a month', async () => {
    const org = await organisation('Bulk Metrics');
    const territory = await world.territory(org.tenantId, `T${newId().slice(-5)}`);
    const rep = await world.user(org.tenantId, { name: 'Sales Rep', designation: 'executive' });
    const defined = await call('POST', '/v1/metrics', org.admin, {
      definition: {
        key: 'secondary_sales',
        name: noun('Secondary sale'),
        unit: 'currency',
        source: { type: 'external' },
      },
    });
    expect(defined.statusCode, defined.body).toBe(201);
    const territoryCode = (await call('GET', '/v1/territories', org.admin))
      .json()
      .items.find((item: { id: string }) => item.id === territory).code;
    const shop = code();
    await call('POST', '/v1/bulk/accounts', org.admin, {
      accountType: 'customer',
      rows: [
        {
          code: shop,
          name: 'Distributor',
          territory_code: territoryCode,
          'slot.executive': 'Sales Rep',
        },
      ],
    });

    const token = await clientToken(org.admin, ['metrics:write']);
    // The tenant's own day, which slots and facts follow.
    const today = todayIn('Asia/Kolkata');
    // Last month's value lands on its last day, which is never today: on a month's last day this
    // month's would meet the day's own row, which the file may not repeat.
    const [thisYear, thisMonth] = today.split('-').map(Number) as [number, number];
    const month = new Date(Date.UTC(thisYear, thisMonth - 2, 1)).toISOString().slice(0, 7);
    const loaded = await call('POST', '/v1/bulk/external-metrics', token, {
      rows: [
        { metric: 'secondary_sales', employee_code: rep.code, date: today, value: '1000.5' },
        { metric: 'secondary_sales', account_code: shop, date: today, value: 2500 },
        { metric: 'secondary_sales', employee_code: rep.code, period: month, value: '40000' },
      ],
    });
    expect(loaded.statusCode, loaded.body).toBe(200);
    expect(loaded.json()).toEqual({ created: 3, updated: 0 });

    const facts = await app.get(Database).forTenant(org.tenantId, (tx) =>
      tx
        .select({ date: metricFactsDaily.date, value: metricFactsDaily.value })
        .from(metricFactsDaily)
        .where(
          and(
            eq(metricFactsDaily.tenantId, org.tenantId),
            eq(metricFactsDaily.userId, rep.id),
            eq(metricFactsDaily.metricKey, 'secondary_sales'),
          ),
        ),
    );
    const byDate = Object.fromEntries(facts.map((fact) => [fact.date, fact.value]));
    const [year, monthNumber] = month.split('-').map(Number) as [number, number];
    const lastDay = new Date(Date.UTC(year, monthNumber, 0)).toISOString().slice(0, 10);
    // The person's own value and the account's, both today; the month's on its last day.
    expect(byDate[today]).toBe('3500.500');
    expect(byDate[lastDay]).toBe('40000.000');

    // Loading a value again replaces it, and the day is worked out again.
    const again = await call('POST', '/v1/bulk/external-metrics', token, {
      rows: [{ metric: 'secondary_sales', account_code: shop, date: today, value: '500' }],
    });
    expect(again.json()).toEqual({ created: 0, updated: 1 });

    const wrong = await call('POST', '/v1/bulk/external-metrics', token, {
      rows: [
        { metric: 'visits', employee_code: rep.code, date: today, value: '1' },
        {
          metric: 'secondary_sales',
          employee_code: rep.code,
          account_code: shop,
          date: today,
          value: '1',
        },
        {
          metric: 'secondary_sales',
          employee_code: rep.code,
          date: today,
          period: month,
          value: '1',
        },
      ],
    });
    expect(wrong.json().error.details).toEqual([
      { path: 'rows.0.metric', issue: 'No external metric has this key' },
      { path: 'rows.1.employee_code', issue: 'Give either an employee code or an account code' },
      { path: 'rows.2.date', issue: 'Give either a date or a month, not both' },
    ]);
  });
});
