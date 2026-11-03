import { createHash } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId, SETTING_DEFAULTS, todayIn } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricFactsDaily } from '../src/db/schema/metrics';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { type MemoryObjectStore, ObjectStore } from '../src/platform/object-store';
import { orderingTenant } from './erp-orders';
import { newAddress, startApp, World } from './support';

/**
 * Collections (M11, BR-63, decision D132): recorded on a phone once by its ID, refused by mode
 * and over the day's cash limit; decided by the office, never by the collector, one refusal in a
 * batch leaving the rest; matched to the books' receipts by the rule as they load, by hand, and
 * undone; counted in the account's figures, the credit check, the collector's metric, the report
 * and the phone's copy; and closed with account finance.
 */

let app: NestFastifyApplication;
let world: World;
let store: MemoryObjectStore;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  store = app.get(ObjectStore) as MemoryObjectStore;
});

afterAll(async () => {
  await world.end();
  await app.close();
});

function call(
  method: 'GET' | 'POST' | 'PUT',
  url: string,
  token: string,
  body?: object,
  key: string = newId(),
) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': key },
    ...(body ? { payload: body } : {}),
  });
}

const FIX = () => ({
  location: { lat: 28.6315, lng: 77.2167 },
  accuracy: 12,
  mocked: false,
  capturedAt: new Date().toISOString(),
});

/** What a phone sends for money taken at the distributor now. */
const collection = (accountId: string, more: object = {}) => ({
  id: newId(),
  accountId,
  amount: '12000',
  mode: 'cash',
  fix: FIX(),
  collectedAt: new Date().toISOString(),
  ...more,
});

/** A photo of a cheque, as the phone registers, uploads and confirms it. */
async function chequePhoto(token: string): Promise<string> {
  const id = newId();
  const bytes = new Uint8Array(
    await sharp({ create: { width: 64, height: 48, channels: 3, background: '#d9c9a0' } })
      .jpeg()
      .toBuffer(),
  );
  const presigned = await call('POST', '/v1/media/presign', token, {
    id,
    kind: 'collection',
    contentType: 'image/jpeg',
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
  expect(presigned.statusCode, presigned.body).toBe(200);
  store.receive(presigned.json().upload.url, bytes);
  const at = new Date().toISOString();
  const confirmed = await call('POST', `/v1/media/${id}/confirm`, token, {
    capturedAt: at,
    source: 'camera',
    fix: { lat: 28.6315, lng: 77.2167, accuracy: 12, capturedAt: at },
  });
  expect(confirmed.statusCode, confirmed.body).toBe(200);
  return id;
}

const fieldOf = (reply: { json: () => unknown }) =>
  (reply.json() as { error: { details: { path: string }[] } }).error.details.map(
    (detail) => detail.path,
  );

describe('collections (BR-63, D132)', () => {
  it('records once by ID, refuses by mode and the cash limit, and the office decides', async () => {
    const t = await orderingTenant(app, world, 'Collect Agro');
    const record = (more: object = {}) =>
      call('POST', '/v1/collections', t.sme, collection(t.distributor, more));

    // Cash, sent twice as a phone may: one collection, numbered for people.
    const body = collection(t.distributor);
    const first = await call('POST', '/v1/collections', t.sme, body);
    expect(first.statusCode, first.body).toBe(201);
    expect(first.json()).toMatchObject({
      number: 'COL-000001',
      amount: '12000.00',
      mode: 'cash',
      status: 'recorded',
      account: { id: t.distributor, name: 'Kisan Traders' },
      // The distributor has no verified location, so where it was taken can't be judged.
      inGeofence: null,
      can: { decide: false, bounce: false, match: false, unmatch: false },
    });
    expect((await call('POST', '/v1/collections', t.sme, body)).json()).toEqual(first.json());

    // UPI names its reference; a cheque its number, bank, date and photo.
    expect(fieldOf(await record({ mode: 'upi' }))).toEqual(['reference']);
    expect(fieldOf(await record({ mode: 'cheque', chequeNumber: '004512' }))).toEqual([
      'chequeBank',
      'chequeDate',
      'photos',
    ]);
    const photo = await chequePhoto(t.sme);
    const cheque = await record({
      mode: 'cheque',
      amount: '5000.50',
      chequeNumber: '004512',
      chequeBank: 'Bank of Maharashtra',
      chequeDate: todayIn(SETTING_DEFAULTS.timezone),
      photos: [photo],
    });
    expect(cheque.statusCode, cheque.body).toBe(201);
    expect(cheque.json()).toMatchObject({ number: 'COL-000002', photos: [photo] });
    // A photo belongs to one record.
    expect(
      fieldOf(
        await record({
          mode: 'cheque',
          chequeNumber: '1',
          chequeBank: 'X',
          chequeDate: '2026-11-01',
          photos: [photo],
        }),
      ),
    ).toEqual(['photos[0]']);

    // Cash from the distributor today reaches ₹2 lakh with this one: refused (section 269ST).
    const over = await record({ amount: '188000' });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.details).toEqual([
      { path: 'amount', issue: 'Cash from one account in a day must stay under ₹200000.00' },
    ]);
    const upi = await record({ mode: 'upi', reference: 'UPI 4471', amount: '3000' });
    expect(upi.statusCode, upi.body).toBe(201);

    // The collector can't decide; the office decides, one refusal leaving the rest decided.
    expect(
      (
        await call('POST', '/v1/collections/decisions', t.sme, {
          items: [{ id: body.id, decision: 'confirm' }],
        })
      ).statusCode,
    ).toBe(403);
    const own = await call(
      'POST',
      '/v1/collections',
      t.admin,
      collection(t.distributor, { amount: '100' }),
    );
    expect(own.statusCode, own.body).toBe(201);
    const decided = await call('POST', '/v1/collections/decisions', t.admin, {
      items: [
        { id: body.id, decision: 'confirm' },
        { id: cheque.json().id, decision: 'confirm' },
        { id: upi.json().id, decision: 'reject', reason: 'Not in the bank' },
        { id: own.json().id, decision: 'confirm' },
      ],
    });
    expect(decided.statusCode, decided.body).toBe(200);
    const results = decided.json().results;
    expect(
      results.map(
        (result: { collection: { status: string } | null }) => result.collection?.status ?? null,
      ),
    ).toEqual(['confirmed', 'confirmed', 'rejected', null]);
    expect(results[3].error.code).toBe('FORBIDDEN');
    // Decided already: decided again, it answers so.
    const again = await call('POST', '/v1/collections/decisions', t.admin, {
      items: [{ id: upi.json().id, decision: 'confirm' }],
    });
    expect(again.json().results[0].error.code).toBe('CONFLICT');

    // A bounce needs a cheque that was confirmed, and says why; the collector hears.
    const cashBounce = await call('POST', `/v1/collections/${body.id}/bounce`, t.admin, {
      reason: 'No such cash',
    });
    expect(cashBounce.statusCode).toBe(400);
    const bounced = await call('POST', `/v1/collections/${cheque.json().id}/bounce`, t.admin, {
      reason: 'Funds insufficient',
    });
    expect(bounced.json()).toMatchObject({ status: 'bounced', reason: 'Funds insufficient' });
    const inbox = (await call('GET', '/v1/notifications', t.sme)).json();
    expect(inbox.items.map((item: { event: string }) => item.event).sort()).toEqual([
      'collection.bounced',
      'collection.rejected',
    ]);
    expect(
      inbox.items.find((item: { event: string }) => item.event === 'collection.rejected').values,
    ).toMatchObject({ number: 'COL-000003', reason: 'Not in the bank', amount_en: '₹3,000.00' });

    // The collector's metric counts what wasn't turned down: 12,000 cash, confirmed.
    const sme = (await call('GET', '/v1/me', t.sme)).json();
    const fact = await app.get(Database).forTenant(t.tenantId, async (tx) => {
      const [row] = await tx
        .select({ value: metricFactsDaily.value })
        .from(metricFactsDaily)
        .where(
          and(
            eq(metricFactsDaily.tenantId, t.tenantId),
            eq(metricFactsDaily.userId, sme.userId),
            eq(metricFactsDaily.metricKey, 'collection'),
          ),
        );
      return row?.value ?? null;
    });
    expect(fact).toBe('12000.000');

    // The list: the collector sees their own; the office every one, with the summary.
    const mine = (await call('GET', '/v1/collections', t.sme)).json();
    expect(mine.items).toHaveLength(3);
    expect(mine.summary).toMatchObject({
      counts: { confirmed: 1, rejected: 1, bounced: 1 },
      amounts: { confirmed: '12000.00' },
    });
    const all = (await call('GET', '/v1/collections?status=recorded', t.admin)).json();
    expect(all.items.map((item: { number: string }) => item.number)).toEqual(['COL-000004']);
  });

  it('matches the books’ receipts as they load, by hand and undone, and counts what waits', async () => {
    const t = await orderingTenant(app, world, 'Match Agro');
    const record = async (amount: string) => {
      const made = await call(
        'POST',
        '/v1/collections',
        t.sme,
        collection(t.distributor, { amount }),
      );
      expect(made.statusCode, made.body).toBe(201);
      return made.json().id as string;
    };
    const confirm = (ids: string[]) =>
      call('POST', '/v1/collections/decisions', t.admin, {
        items: ids.map((id) => ({ id, decision: 'confirm' })),
      });
    const today = todayIn(SETTING_DEFAULTS.timezone);
    const bulk = (path: string, rows: object[]) =>
      call('POST', `/v1/bulk/${path}`, t.admin, { rows });

    // The books say the distributor owes ₹50,000, with a credit limit of ₹60,000.
    expect(
      (
        await bulk('invoices', [
          { number: 'INV-1', account_code: t.distributorCode, date: today, amount: '50000' },
        ])
      ).statusCode,
    ).toBe(200);
    await call('POST', '/v1/finance-snapshots', t.admin, {
      id: newId(),
      accountId: t.distributor,
      asOf: today,
      outstanding: '50000',
      creditLimit: '60000',
      ageing: {},
      source: 'Tally',
    });
    const first = await record('12000');
    const second = await record('12000');
    const third = await record('7000');
    const finance = async () =>
      (await call('GET', `/v1/accounts/${t.distributor}/finance`, t.admin)).json().collected;
    expect(await finance()).toEqual({ notInBooks: '31000.00', leftAfter: '19000.00' });

    // A receipt of the same amount before its collection is confirmed waits.
    const r1 = await bulk('receipts', [
      { number: 'R-1', account_code: t.distributorCode, date: today, amount: '12000' },
    ]);
    expect(r1.statusCode, r1.body).toBe(200);
    const status = async (id: string) =>
      (await call('GET', `/v1/collections/${id}`, t.admin)).json();
    expect((await status(first)).status).toBe('recorded');
    // Confirmed, the oldest of the two takes it at once.
    await confirm([first, second, third]);
    expect(await status(first)).toMatchObject({
      status: 'in_books',
      receipt: { number: 'R-1', byHand: false },
    });
    expect((await status(second)).status).toBe('confirmed');
    // The next receipt of that amount matches the second; one for another amount waits.
    await bulk('receipts', [
      { number: 'R-2', account_code: t.distributorCode, date: today, amount: '12000' },
      { number: 'R-3', account_code: t.distributorCode, date: today, amount: '6500' },
    ]);
    expect((await status(second)).receipt.number).toBe('R-2');
    expect((await status(third)).status).toBe('confirmed');
    // The books now say ₹19,500 is owed; the third collection waits for its receipt.
    expect(await finance()).toEqual({ notInBooks: '7000.00', leftAfter: '12500.00' });

    // The office matches the third by hand to R-3, then undoes it.
    const receipts = (await call('GET', `/v1/accounts/${t.distributor}/receipts`, t.admin)).json()
      .items as { id: string; number: string }[];
    const r3 = receipts.find((receipt) => receipt.number === 'R-3')!.id;
    const taken = receipts.find((receipt) => receipt.number === 'R-1')!.id;
    expect(
      fieldOf(await call('POST', `/v1/collections/${third}/match`, t.admin, { receiptId: taken })),
    ).toEqual(['receiptId']);
    const matched = await call('POST', `/v1/collections/${third}/match`, t.admin, {
      receiptId: r3,
    });
    expect(matched.json()).toMatchObject({
      status: 'in_books',
      receipt: { number: 'R-3', byHand: true },
    });
    const unmatched = await call('POST', `/v1/collections/${third}/unmatch`, t.admin);
    expect(unmatched.json()).toMatchObject({ status: 'confirmed', receipt: null });

    // A matched receipt cancelled in the books undoes its match.
    await bulk('receipts', [
      {
        number: 'R-2',
        account_code: t.distributorCode,
        date: today,
        amount: '12000',
        status: 'cancelled',
      },
    ]);
    expect((await status(second)).status).toBe('confirmed');

    // The phone keeps the collections not yet in the books, with its person's own.
    const pulled = await call('GET', '/v1/sync/pull?entities=collections', t.sme);
    expect(pulled.statusCode, pulled.body).toBe(200);
    const rows = pulled.json().entities.collections.rows as { id: string; status: string }[];
    expect(Object.fromEntries(rows.map((row) => [row.id, row.status]))).toEqual({
      [first]: 'in_books',
      [second]: 'confirmed',
      [third]: 'confirmed',
    });

    // The report holds the month's collections.
    const period = today.slice(0, 7);
    const report = await call('GET', `/v1/reports/collections?period=${period}`, t.admin);
    expect(report.statusCode, report.body).toBe(200);
    expect(
      report
        .json()
        .rows.map((row: { number: string; status: string; receipt: string | null }) => [
          row.number,
          row.status,
          row.receipt,
        ]),
    ).toEqual([
      ['COL-000001', 'In the books', 'R-1'],
      ['COL-000002', 'Confirmed', null],
      ['COL-000003', 'Confirmed', null],
    ]);

    // With account finance off, collections close and the phone drops its copy.
    await app
      .get(Database)
      .forTenant(t.tenantId, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, t.tenantId, SYSTEM_ACTOR, { modulesOff: ['account_finance'] }),
      );
    const closed = await call('POST', '/v1/collections', t.sme, collection(t.distributor));
    expect(closed.json().error.code).toBe('MODULE_DISABLED');
    const off = (await call('GET', '/v1/sync/pull?entities=collections', t.sme)).json();
    expect(off.entities.collections.rows).toEqual([]);
  });
});
