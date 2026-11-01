import { newId, todayIn } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ImportsService } from '../src/modules/imports/imports.service';
import { OrderCredit } from '../src/modules/orders/order-credit';
import { Database } from '../src/platform/database';
import { newPhone, startApp, testConfig, World } from './support';

/** Invoice and receipt registers (M11, BR-51, decision D121). */

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
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, payload?: object) =>
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
    upload: (target: string, body: string) =>
      app.inject({
        method: 'POST',
        url: `/v1/imports?target=${target}&fileName=books.csv`,
        headers: {
          authorization: `Bearer ${token}`,
          'idempotency-key': newId(),
          'content-type': 'text/csv',
        },
        payload: body,
      }),
  };
}

const DAY = 86_400_000;
const TODAY = () => todayIn('Asia/Kolkata');
const ago = (days: number) =>
  new Date(Date.parse(`${TODAY()}T00:00:00Z`) - days * DAY).toISOString().slice(0, 10);

/** A generic tenant with its admin on the web and two customers. */
async function tenant(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  const token = (await world.signIn(phone)).accessToken;
  const admin = as(token);
  const territoryId = await world.territory(tenantId, `T-${newId().slice(-6)}`);
  const account = async (label: string) => {
    const id = newId();
    const code = `${label}-${newId().slice(-6)}`;
    const made = await admin.post('/v1/accounts', {
      id,
      type: 'customer',
      code,
      name: `${label} Stores`,
      territoryId,
    });
    expect(made.statusCode, made.body).toBe(201);
    return { id, code };
  };
  const shop = await account('S');
  const other = await account('O');
  const run = async (target: string, lines: string[]) => {
    const uploaded = await admin.upload(target, lines.join('\n'));
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
  return { tenantId, token, admin, shop, other, run };
}

const INVOICE_HEAD = 'Invoice number,Account code,Invoice date,Amount,Due date,Credit days,Status';
const RECEIPT_HEAD = 'Receipt number,Account code,Receipt date,Amount,Kind,Against invoices,Status';

describe('invoice and receipt registers (BR-51, decision D121)', () => {
  it('settles receipts bill-wise then oldest first, and ages what is open', async () => {
    const t = await tenant('Registers Co');
    const invoices = await t.run('invoices', [
      INVOICE_HEAD,
      `INV-1,${t.shop.code},${ago(100)},10000,${ago(70)},,`,
      `INV-2,${t.shop.code},${ago(50)},5000,,10,`,
      // No due date or credit days: the tenant's 30 days.
      `INV-3,${t.shop.code},${ago(10)},8000,,,open`,
    ]);
    expect(invoices.status, JSON.stringify(invoices)).toBe('committed');
    const receipts = await t.run('receipts', [
      RECEIPT_HEAD,
      // 8,000 to INV-3 as named; the 1,000 left to the oldest, INV-1.
      `R-1,${t.shop.code},${ago(5)},9000,receipt,INV-3,`,
      // An unknown number settles oldest first too.
      `CN-1,${t.shop.code},${ago(4)},500,credit note,INV-404,`,
    ]);
    expect(receipts.status, JSON.stringify(receipts)).toBe('committed');

    const finance = (await t.admin.get(`/v1/accounts/${t.shop.id}/finance`)).json();
    expect(finance.receivables).toEqual({
      asOf: TODAY(),
      outstanding: '13500.00',
      notDue: '0.00',
      overdue: '13500.00',
      ageing: {
        d0_30: '0.00',
        d31_60: '5000.00',
        d61_90: '8500.00',
        d91_180: '0.00',
        d181: '0.00',
      },
      oldestDue: ago(70),
      advance: '0.00',
      creditLimit: null,
    });

    const open = (await t.admin.get(`/v1/accounts/${t.shop.id}/invoices`)).json();
    expect(
      open.items.map((item: { number: string; open: string }) => [item.number, item.open]),
    ).toEqual([
      ['INV-2', '5000.00'],
      ['INV-1', '8500.00'],
    ]);
    expect(open.items[1]).toMatchObject({
      daysPastDue: 70,
      settledBy: [
        { receipt: 'R-1', amount: '1000.00' },
        { receipt: 'CN-1', amount: '500.00' },
      ],
    });
    const all = (await t.admin.get(`/v1/accounts/${t.shop.id}/invoices?status=all&limit=2`)).json();
    expect(all.items.map((item: { number: string }) => item.number)).toEqual(['INV-3', 'INV-2']);
    expect(all.nextCursor).toBe('INV-2');
    const rest = (
      await t.admin.get(`/v1/accounts/${t.shop.id}/invoices?status=all&limit=2&cursor=INV-2`)
    ).json();
    expect(rest).toEqual({
      items: [expect.objectContaining({ number: 'INV-1' })],
      nextCursor: null,
    });
    const listed = (await t.admin.get(`/v1/accounts/${t.shop.id}/receipts`)).json();
    expect(listed.items[0]).toMatchObject({
      number: 'CN-1',
      kind: 'credit_note',
      settled: [{ invoice: 'INV-1', amount: '500.00' }],
    });

    // An account with no invoice keeps its snapshot's figures.
    expect((await t.admin.get(`/v1/accounts/${t.other.id}/finance`)).json().receivables).toBeNull();
  });

  it('applies corrections once, audited, cancels, and refuses a move to another account', async () => {
    const t = await tenant('Corrections Co');
    await t.run('invoices', [
      INVOICE_HEAD,
      `INV-1,${t.shop.code},${ago(20)},4000,,,`,
      `INV-2,${t.shop.code},${ago(10)},6000,,,`,
    ]);
    await t.run('receipts', [RECEIPT_HEAD, `R-1,${t.shop.code},${ago(5)},3000,,INV-2,`]);

    // The same file again changes nothing; a changed amount and a cancellation update.
    const again = await t.run('invoices', [
      INVOICE_HEAD,
      `INV-1,${t.shop.code},${ago(20)},4000.00,,,`,
      `INV-2,${t.shop.code},${ago(10)},6000,,,cancelled`,
    ]);
    expect(again).toMatchObject({ status: 'committed' });
    const moved = await t.run('invoices', [
      INVOICE_HEAD,
      `INV-1,${t.other.code},${ago(20)},4000,,,`,
    ]);
    expect(moved.status).toBe('invalid');
    expect(moved.errors).toEqual([
      expect.objectContaining({
        row: 2,
        field: 'account_code',
        issue: 'This invoice belongs to another account',
      }),
    ]);
    const twice = await t.run('invoices', [
      INVOICE_HEAD,
      `INV-9,${t.shop.code},${ago(2)},100,,,`,
      `INV-9,${t.shop.code},${ago(2)},100,,,`,
    ]);
    expect(twice.errors).toEqual([expect.objectContaining({ row: 3, field: 'number' })]);

    // INV-2 cancelled: the receipt that named it settles INV-1 instead.
    const open = (await t.admin.get(`/v1/accounts/${t.shop.id}/invoices?status=all`)).json();
    expect(
      open.items.map((item: { number: string; open: string; cancelled: boolean }) => [
        item.number,
        item.open,
        item.cancelled,
      ]),
    ).toEqual([
      ['INV-2', '0.00', true],
      ['INV-1', '1000.00', false],
    ]);
    const audit = (await t.admin.get(`/v1/audit?period=${TODAY().slice(0, 7)}`)).json();
    const actions = audit.items.map((entry: { action: string }) => entry.action);
    expect(actions.filter((action: string) => action === 'finance.invoice_cancelled')).toHaveLength(
      1,
    );
    expect(actions.filter((action: string) => action === 'finance.invoice_changed')).toHaveLength(
      0,
    );
    expect(actions).toContain('finance.invoices_recorded');

    // The bulk API loads the same rows, and a resend applies once.
    const key = newId();
    const bulk = () =>
      app.inject({
        method: 'POST',
        url: '/v1/bulk/invoices',
        headers: { authorization: `Bearer ${t.token}`, 'idempotency-key': key },
        payload: {
          rows: [{ number: 'INV-5', account_code: t.shop.code, date: ago(1), amount: '250' }],
        },
      });
    const first = await bulk();
    expect(first.statusCode, first.body).toBe(200);
    expect(first.json()).toEqual({ created: 1, updated: 0 });
    expect((await bulk()).json()).toEqual({ created: 1, updated: 0 });
    const numbers = (await t.admin.get(`/v1/accounts/${t.shop.id}/invoices?status=all`))
      .json()
      .items.map((item: { number: string }) => item.number);
    expect(numbers.filter((number: string) => number === 'INV-5')).toHaveLength(1);
  });

  it('judges credit by what invoices leave open, and reports outstanding for the team', async () => {
    const t = await tenant('Credit Co');
    const snapshot = await t.admin.post('/v1/finance-snapshots', {
      id: newId(),
      accountId: t.shop.id,
      asOf: ago(30),
      outstanding: '1000',
      creditLimit: '20000',
      ageing: {},
      source: 'Tally',
    });
    expect(snapshot.statusCode, snapshot.body).toBe(201);
    await t.admin.post('/v1/finance-snapshots', {
      id: newId(),
      accountId: t.other.id,
      asOf: ago(3),
      outstanding: '700',
      creditLimit: null,
      ageing: { d0_30: '700' },
      source: 'Tally',
    });
    const over = (total: string) =>
      app
        .get(Database)
        .forTenant(t.tenantId, (tx) => app.get(OrderCredit).over(tx, t.tenantId, t.shop.id, total));
    // By the snapshot: 1,000 owed, 19,000 to spare.
    expect(await over('15000')).toBe(false);
    await t.run('invoices', [INVOICE_HEAD, `INV-1,${t.shop.code},${ago(40)},12000,,,`]);
    // By the invoices: 12,000 owed, 8,000 to spare.
    expect(await over('15000')).toBe(true);
    expect(await over('8000')).toBe(false);

    const report = await t.admin.get(
      `/v1/reports/outstanding?period=${TODAY().slice(0, 7)}&limit=50`,
    );
    expect(report.statusCode, report.body).toBe(200);
    const rows = report.json().rows as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows).toContainEqual(
      expect.objectContaining({
        account_code: t.shop.code,
        source: 'Invoices',
        credit_limit: 20000,
        outstanding: 12000,
        not_due: 0,
        ageing_d0_30: 12000,
        oldest_due: ago(10),
      }),
    );
    expect(rows).toContainEqual(
      expect.objectContaining({
        account_code: t.other.code,
        source: 'Balance snapshot',
        outstanding: 700,
        ageing_d0_30: 700,
      }),
    );

    // Switched off, the registers close with account finance.
    const off = await t.admin.patch('/v1/settings', { modulesOff: ['account_finance'] });
    expect(off.statusCode, off.body).toBe(200);
    expect((await t.admin.get(`/v1/accounts/${t.shop.id}/invoices`)).statusCode).not.toBe(200);
    expect(
      (await t.admin.get(`/v1/reports/outstanding?period=${TODAY().slice(0, 7)}`)).statusCode,
    ).not.toBe(200);
  });
});
