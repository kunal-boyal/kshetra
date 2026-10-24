import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { newDevice, newPhone, startApp, testConfig, World } from './support';

/** Account finance (M11, BR-20, BR-21, decision D79). */

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
    upload: (target: string, body: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/imports?target=${target}&fileName=finance.csv`,
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

/** A generic tenant with its admin, a field user on a phone, and a customer the user looks after. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phones = { admin: newPhone(), field: newPhone() };
  await world.user(tenantId, { phone: phones.admin, designation: 'head', role: 'tenant_admin' });
  const field = await world.user(tenantId, { phone: phones.field, designation: 'executive' });
  const admin = as((await world.signIn(phones.admin)).accessToken);
  const fieldApi = as((await world.signIn(phones.field, newDevice())).accessToken);
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const accountId = newId();
  const code = `C-${newId().slice(-6)}`;
  const made = await admin.post('/v1/accounts', {
    id: accountId,
    type: 'customer',
    code,
    name: 'Sharma Stores',
    territoryId,
    slots: { executive: field.id },
  });
  expect(made.statusCode, made.body).toBe(201);
  const run = async (target: string, csv: string) => {
    const uploaded = await admin.upload(target, csv);
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const id = uploaded.json().id as string;
    const imports = app.get(ImportsService);
    await imports.read(tenantId, id);
    const read = (await admin.get(`/v1/imports/${id}`)).json();
    await admin.put(`/v1/imports/${id}/mapping`, { mapping: read.mapping });
    await imports.check(tenantId, id);
    const checked = (await admin.get(`/v1/imports/${id}`)).json();
    if (checked.status !== 'ready') return checked;
    await admin.post(`/v1/imports/${id}/commit`);
    await imports.write(tenantId, id);
    return (await admin.get(`/v1/imports/${id}`)).json();
  };
  return { tenantId, admin, field: fieldApi, accountId, code, run };
}

describe('account finance (M11)', () => {
  it('keeps every snapshot and shows the latest, refusing a future day and ageing over outstanding', async () => {
    const t = await tenant('Finance Stores');
    const snapshot = (asOf: string, extra: object = {}) => ({
      id: newId(),
      accountId: t.accountId,
      asOf,
      outstanding: '50000',
      creditLimit: '75000',
      ageing: { d0_30: '20000', d31_60: '20000', d61_90: '10000.01' },
      source: 'Tally',
      ...extra,
    });
    const first = snapshot('2026-09-30');
    expect((await t.admin.post('/v1/finance-snapshots', first)).statusCode).toBe(201);
    // The same ID again changes nothing.
    expect((await t.admin.post('/v1/finance-snapshots', first)).json().id).toBe(first.id);
    expect(
      (
        await t.admin.post(
          '/v1/finance-snapshots',
          snapshot('2026-10-15', { outstanding: '42000.50', ageing: {} }),
        )
      ).statusCode,
    ).toBe(201);

    // FX-16
    const over = await t.admin.post(
      '/v1/finance-snapshots',
      snapshot('2026-10-01', { ageing: { d0_30: '20000', d31_60: '20000', d61_90: '10000.02' } }),
    );
    expect(over.json().error.details).toEqual([
      {
        path: 'ageing',
        issue: 'The buckets add up to 50000.02, more than the outstanding 50000.00',
      },
    ]);
    const future = await t.admin.post(
      '/v1/finance-snapshots',
      snapshot('2999-01-01', { ageing: { d9: '1' } }),
    );
    expect(future.json().error.details.map((detail: { path: string }) => detail.path)).toEqual([
      'asOf',
      'ageing.d9',
    ]);

    const finance = (await t.admin.get(`/v1/accounts/${t.accountId}/finance`)).json();
    expect(finance.latest).toMatchObject({
      asOf: '2026-10-15',
      outstanding: '42000.50',
      creditLimit: '75000.00',
    });
    expect(finance.history).toEqual([
      expect.objectContaining({ id: first.id, ageing: first.ageing }),
    ]);
    // The field user who looks after the account sees what it owes, to collect it (D79).
    expect((await t.field.get(`/v1/accounts/${t.accountId}/finance`)).json().latest.asOf).toBe(
      '2026-10-15',
    );
  });

  it('FX-15: opens the year with what came before, and shows a running balance', async () => {
    const t = await tenant('Statement Stores');
    const year = Number(TODAY().slice(0, 4)) - 1;
    const entry = (reference: string, date: string, side: 'debit' | 'credit', amount: string) => ({
      id: newId(),
      accountId: t.accountId,
      date,
      reference,
      [side]: amount,
    });
    const before = entry('OB-1', `${year}-03-31`, 'debit', '1000');
    const sale = entry('INV-1', `${year}-04-10`, 'debit', '10000');
    const receipt = entry('RCPT-1', `${year}-05-02`, 'credit', '3000');
    const added = await t.admin.post('/v1/ledger-entries', { entries: [before, sale, receipt] });
    expect(added.json()).toEqual({ created: 3, unchanged: 0 });
    const statement = (
      await t.admin.get(`/v1/accounts/${t.accountId}/statement?year=${year}`)
    ).json();
    expect(statement).toMatchObject({
      from: `${year}-04-01`,
      to: `${year + 1}-03-31`,
      opening: '1000.00',
      closing: '8000.00',
      truncated: false,
      count: 2,
    });
    expect(statement.entries.map((row: { balance: string }) => row.balance)).toEqual([
      '11000.00',
      '8000.00',
    ]);

    // BR-21: sent again unchanged, nothing changes; changed, it is refused.
    expect(
      (await t.admin.post('/v1/ledger-entries', { entries: [{ ...sale, id: newId() }] })).json(),
    ).toEqual({
      created: 0,
      unchanged: 1,
    });
    const changed = await t.admin.post('/v1/ledger-entries', {
      entries: [{ ...sale, id: newId(), debit: '10001' }],
    });
    expect(changed.json().error.details[0].issue).toContain('post a reversing entry');
    // The account statement report (M18, D86): the month's entries, balances running from
    // everything before them.
    const april = await t.admin.get(`/v1/reports/account_statement?period=${year}-04`);
    expect(april.statusCode, april.body).toBe(200);
    expect(april.json().rows).toEqual([
      expect.objectContaining({
        account_code: t.code,
        date: `${year}-04-10`,
        reference: 'INV-1',
        debit: 10000,
        credit: 0,
        balance: 11000,
      }),
    ]);
    const may = (await t.admin.get(`/v1/reports/account_statement?period=${year}-05`)).json();
    expect(may.rows).toEqual([expect.objectContaining({ reference: 'RCPT-1', balance: 8000 })]);

    const both = await t.admin.post('/v1/ledger-entries', {
      entries: [{ ...entry('X-1', `${year}-06-01`, 'debit', '5'), credit: '5' }],
    });
    expect(both.json().error.details).toEqual([
      { path: 'entries[0].debit', issue: 'Fill in a debit or a credit, not both' },
    ]);
  });

  it('imports snapshots by the tenant’s ageing buckets, and statement entries by reference', async () => {
    const t = await tenant('Import Finance Stores');
    const snapshots = await t.run(
      'finance_snapshots',
      [
        'Account code,As-of date,Outstanding,Credit limit,0-30 days,31-60 days,Source',
        `${t.code},30-09-2026,"₹ 12,500.50",20000,10000,2500.50,Tally`,
        `NOPE,30-09-2026,10,,,,Tally`,
      ].join('\n'),
    );
    expect(snapshots.status).toBe('invalid');
    expect(snapshots.errors).toEqual([expect.objectContaining({ row: 3, field: 'account_code' })]);
    const ok = await t.run(
      'finance_snapshots',
      [
        'Account code,As-of date,Outstanding,Credit limit,0-30 days,31-60 days,Source',
        `${t.code},30-09-2026,"₹ 12,500.50",20000,10000,2500.50,Tally`,
      ].join('\n'),
    );
    expect(ok).toMatchObject({ status: 'committed', created: 1 });
    expect((await t.admin.get(`/v1/accounts/${t.accountId}/finance`)).json().latest).toMatchObject({
      outstanding: '12500.50',
      ageing: { d0_30: '10000', d31_60: '2500.50' },
    });

    const file = [
      'Entry reference,Account code,Date,Narration,Debit,Credit',
      `INV-9,${t.code},2026-04-05,Invoice 9,5000,`,
      `RCPT-9,${t.code},2026-04-20,Receipt,,2000`,
    ].join('\n');
    expect(await t.run('ledger_entries', file)).toMatchObject({ status: 'committed', created: 2 });
    // Loaded again, nothing is added.
    expect(await t.run('ledger_entries', file)).toMatchObject({ status: 'committed', created: 0 });
  });

  it('sends phones the latest balance of each account their person sees', async () => {
    const t = await tenant('Balances Stores');
    const snapshot = (accountId: string, asOf: string, outstanding: string) =>
      t.admin.post('/v1/finance-snapshots', {
        id: newId(),
        accountId,
        asOf,
        outstanding,
        creditLimit: '20000',
        ageing: { d0_30: outstanding },
        source: 'Tally',
      });
    expect((await snapshot(t.accountId, '2026-09-30', '5000')).statusCode).toBe(201);
    expect((await snapshot(t.accountId, '2026-10-15', '7000')).statusCode).toBe(201);
    // An older day added later doesn't take the latest's place.
    expect((await snapshot(t.accountId, '2026-08-31', '1')).statusCode).toBe(201);
    type Pull = {
      entities: {
        balances: {
          pass: string;
          rows: { accountId: string; asOf: string; outstanding: string }[];
        };
      };
      cursor: string;
    };
    const pull = async (cursor?: string) =>
      (
        await t.field.get(
          `/v1/sync/pull?entities=balances${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`,
        )
      ).json() as Pull;
    const first = await pull();
    expect(first.entities.balances.rows).toEqual([
      expect.objectContaining({
        accountId: t.accountId,
        asOf: '2026-10-15',
        outstanding: '7000.00',
      }),
    ]);
    expect((await snapshot(t.accountId, '2026-10-20', '6500')).statusCode).toBe(201);
    const second = await pull(first.cursor);
    // One row an account; a changes pass may send it again, never an older balance.
    expect(second.entities.balances.pass).toBe('changes');
    expect(second.entities.balances.rows).toEqual([
      expect.objectContaining({
        accountId: t.accountId,
        asOf: '2026-10-20',
        outstanding: '6500.00',
      }),
    ]);
  });
});
