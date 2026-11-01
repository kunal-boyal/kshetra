import { type Client, createClient, memoryStore } from '@thelamp/api-client';
import { nodeSqlite } from '@thelamp/api-client/node-sqlite';
import {
  clearReferenceData,
  FormEntries,
  localRows,
  migrate,
  Outbox,
  type OutboxSender,
  type SqlDatabase,
  submissionBody,
  SyncRunner,
  Tracking,
  Visits,
} from '@thelamp/api-client/sync';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  type DeviceInfo,
  LocationBatchResult,
  MockLocationReportResult,
  ForecastResult,
  newId,
  OrderResult,
  type SyncScheme,
  ShiftResult,
  SellThroughResult,
  SubmissionResult,
  shiftPeriod,
  type SyncEntity,
  todayIn,
  VisitResult,
} from '@thelamp/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devices } from '../src/db/schema/iam';
import { SyncTombstones } from '../src/modules/sync/tombstones';
import { Database } from '../src/platform/database';
import { newAddress, newDevice, newPhone, startApp, testConfig, World } from './support';

/**
 * A simulated phone (spec 14.4): the app's own sync engine, on Node's SQLite, against the real
 * API. Ordering, dependencies, parking, retries, tombstones and a full reset, end to end.
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

const BASE = 'http://api.test';

/** A phone with its own address, its own clock and a switch for its network. */
class SimulatedPhone {
  online = true;
  now = Date.now();
  readonly db: SqlDatabase = nodeSqlite();
  readonly client: Client;
  readonly outbox: Outbox;
  readonly runner: SyncRunner;
  private readonly address = newAddress();

  constructor(
    readonly device: DeviceInfo,
    senders: Record<string, OutboxSender> = {},
    afterPush?: (owner: string) => Promise<void>,
    entities: SyncEntity[] = ['users', 'territories'],
  ) {
    this.client = createClient({
      directoryUrl: BASE,
      platform: 'app',
      store: memoryStore(),
      device: async () => device,
      app: { platform: 'android', version: '0.1.0' },
      cellUrl: () => BASE,
      fetch: (input, init) => this.fetch(String(input), init),
    });
    this.outbox = new Outbox(this.db, senders, () => this.now);
    this.runner = new SyncRunner({
      db: this.db,
      client: this.client,
      outbox: this.outbox,
      entities,
      owner: () => this.client.owner,
      clock: () => this.now,
      ...(afterPush ? { afterPush } : {}),
    });
  }

  async start(): Promise<this> {
    await migrate(this.db);
    return this;
  }

  async signIn(phone: string): Promise<void> {
    await this.client.requestCode(phone);
    const result = await this.client.verifyCode(phone, world.sender.lastCode(phone)!);
    expect(result.status).toBe('signed_in');
  }

  async sync(): Promise<void> {
    await this.runner.sync();
    this.runner.stop();
  }

  private async fetch(url: string, init: RequestInit = {}): Promise<Response> {
    if (!this.online) throw new TypeError('Network request failed');
    const target = new URL(url);
    const reply = await app.inject({
      method: (init.method ?? 'GET') as 'GET',
      url: target.pathname + target.search,
      headers: init.headers as Record<string, string>,
      remoteAddress: this.address,
      ...(typeof init.body === 'string' ? { payload: init.body } : {}),
    });
    const headers = new Headers();
    for (const [name, value] of Object.entries(reply.headers)) {
      if (value !== undefined) headers.set(name, String(value));
    }
    const empty = reply.statusCode === 204 || reply.statusCode === 304;
    return new Response(empty ? null : reply.body, { status: reply.statusCode, headers });
  }
}

const names = async (phone: SimulatedPhone) =>
  (await localRows(phone.db, 'users')).map((user) => user.name).sort();

describe('a simulated phone', () => {
  it('keeps a copy of what its user may read, through changes, moves, tombstones and a reset', async () => {
    const tenantId = await world.tenant('Simulated Seeds');
    const admin = await world.user(tenantId, {
      name: 'Asha Admin',
      designation: 'head',
      role: 'tenant_admin',
    });
    const manager = await world.user(tenantId, { name: 'Mohan Manager', managerId: admin.id });
    const stays = await world.user(tenantId, {
      name: 'Sita Stays',
      designation: 'executive',
      managerId: manager.id,
    });
    const leaves = await world.user(tenantId, {
      name: 'Lata Leaves',
      designation: 'executive',
      managerId: manager.id,
    });
    const north = await world.territory(tenantId, 'NORTH');

    const phone = await new SimulatedPhone(newDevice()).start();
    await phone.signIn(manager.phone!);
    await phone.sync();
    expect(await names(phone)).toEqual(['Lata Leaves', 'Mohan Manager', 'Sita Stays']);
    expect((await localRows(phone.db, 'territories')).map((row) => row.id)).toEqual([north]);

    // A rename, a newcomer and a move away, all on the server.
    const adminToken = (await world.signIn(admin.phone!)).accessToken;
    const patch = (id: string, payload: object) =>
      app.inject({
        method: 'PATCH',
        url: `/v1/users/${id}`,
        headers: { authorization: `Bearer ${adminToken}` },
        payload,
      });
    expect((await patch(stays.id, { name: 'Sita Renamed' })).statusCode).toBe(200);
    expect((await patch(leaves.id, { managerId: admin.id })).statusCode).toBe(200);
    await world.user(tenantId, {
      name: 'Nina Newcomer',
      designation: 'executive',
      managerId: manager.id,
    });
    await phone.sync();
    expect(await names(phone)).toEqual(['Mohan Manager', 'Nina Newcomer', 'Sita Renamed']);

    // A tombstone takes a row off the phone.
    const ghost = newId();
    await phone.db.run(
      `INSERT INTO ref_territories (id, parent_id, level, code, name, active, sync_gen)
       VALUES (?, NULL, 1, 'GHOST', 'Ghost', 1, 1)`,
      [ghost],
    );
    await app
      .get(Database)
      .forTenant(tenantId, (tx) =>
        app.get(SyncTombstones).record(tx, tenantId, 'territories', [ghost]),
      );
    await phone.sync();
    expect((await localRows(phone.db, 'territories')).map((row) => row.id)).toEqual([north]);

    // A cursor the server can't use: the phone starts over and ends with the same copy.
    await phone.db.run(`UPDATE sync_state SET value = 'garbage' WHERE key = 'cursor'`);
    await phone.sync();
    expect(phone.runner.status.error).toBeNull();
    expect(await names(phone)).toEqual(['Mohan Manager', 'Nina Newcomer', 'Sita Renamed']);
  });

  it('uploads in order, parks what the server refuses, retries after losing signal, and keeps the queue across sign-out', async () => {
    const tenantId = await world.tenant('Simulated Sprouts');
    const person = await world.user(tenantId, { name: 'Uma Uploader', designation: 'executive' });

    // Heartbeats stand in for captures: the server accepts a good one and refuses a bad one.
    const sent: string[] = [];
    const phone: SimulatedPhone = await new SimulatedPhone(newDevice(), {
      beat: {
        async send(payload, item) {
          await phone.client.heartbeat(payload as never);
          sent.push(item.id);
        },
      },
    }).start();
    await phone.signIn(person.phone!);
    const owner = phone.client.owner!;
    const good = {
      appVersion: '0.1.0',
      osVersion: '15',
      queue: { queued: 1, parked: 0, oldestQueuedAt: null },
      lastSyncAt: null,
    };
    const enqueue = (id: string, payload: object, dependsOn: string[] = []) =>
      phone.outbox.enqueue(phone.db, { id, owner, kind: 'beat', payload, dependsOn });

    await enqueue('bad', { ...good, appVersion: '' });
    await enqueue('after-bad', good, ['bad']);
    await enqueue('first', good);
    await enqueue('second', good);
    phone.online = false;
    await phone.sync();
    expect(phone.runner.status).toMatchObject({ offline: true, counts: { queued: 4, parked: 0 } });

    // Signal returns, and the backoff has passed: the bad one parks with the server's answer,
    // the one that depends on it waits, the rest go in order.
    phone.online = true;
    phone.now += 5_000;
    await phone.sync();
    expect(sent).toEqual(['first', 'second']);
    const waiting = await phone.outbox.items(owner);
    expect(waiting).toEqual([
      expect.objectContaining({ id: 'bad', state: 'parked', lastErrorCode: 'VALIDATION' }),
      expect.objectContaining({ id: 'after-bad', state: 'queued' }),
    ]);
    expect(phone.runner.status.counts).toMatchObject({ queued: 1, parked: 1 });

    // Signing out keeps the queue for the same person; discarding the bad one parks its dependant.
    await phone.client.signOut();
    await clearReferenceData(phone.db);
    expect(await phone.outbox.items(owner)).toHaveLength(2);
    await phone.signIn(person.phone!);
    expect(phone.client.owner).toBe(owner);
    await phone.outbox.discard('bad');
    await phone.outbox.retry('after-bad');
    await phone.sync();
    expect(sent).toEqual(['first', 'second', 'after-bad']);
    expect(await phone.outbox.items(owner)).toEqual([]);

    const [device] = await app
      .get(Database)
      .forTenant(tenantId, (tx) => tx.select().from(devices).where(eq(devices.userId, person.id)));
    expect(device!.health).toMatchObject({ queue: { queued: 1 } });
  });

  it('tracks a shift offline and uploads its points once the punch-in has gone (spec 12.1)', async () => {
    const tenantId = await world.tenant('Simulated Strides');
    const person = await world.user(tenantId, { name: 'Tara Tracker', designation: 'executive' });
    const tracking: { store?: Tracking } = {};
    const phone: SimulatedPhone = await new SimulatedPhone(
      newDevice(),
      {
        'shift.start': {
          async send(payload) {
            await phone.client.request('POST', '/v1/shifts', ShiftResult, {
              body: payload as never,
            });
          },
        },
      },
      (owner) =>
        tracking
          .store!.flush(
            owner,
            async (points) =>
              (await phone.client.request('POST', '/v1/locations/batch', LocationBatchResult, {
                body: { points },
              }))!,
            async (shiftId) =>
              !(await phone.outbox.items(owner)).some((item) => item.id === shiftId),
          )
          .then(() => undefined),
    ).start();
    tracking.store = new Tracking(phone.db);
    await phone.signIn(person.phone!);
    const owner = phone.client.owner!;

    // Punched in and walking with no signal: the shift and its points wait on the phone.
    phone.online = false;
    const shiftId = newId();
    const startedAt = Date.now() - 3_600_000;
    await phone.db.transaction(async (tx) => {
      await tracking.store!.open(tx, {
        owner,
        shiftId,
        startedAt,
        endsBy: startedAt + 14 * 3_600_000,
        intervalSeconds: 60,
      });
      await phone.outbox.enqueue(tx, {
        id: shiftId,
        owner,
        kind: 'shift.start',
        payload: {
          id: shiftId,
          startedAt: new Date(startedAt).toISOString(),
          location: { lat: 28.6315, lng: 77.2167 },
          accuracy: 15,
          mocked: false,
          consentVersion: '2026-10',
        },
      });
    });
    const recorded = await tracking.store.record(
      owner,
      [5, 10, 15].map((minutes) => ({
        id: newId(),
        capturedAt: startedAt + minutes * 60_000,
        lat: 28.6315 + minutes * 0.0001,
        lng: 77.2167,
        accuracy: 10,
        speed: null,
        mocked: false,
        battery: 70,
        source: 'background' as const,
      })),
    );
    expect(recorded.kept).toBe(3);
    await phone.sync();
    expect(await tracking.store.waiting(owner)).toBe(3);

    // Signal again, past the retry's wait: the punch-in goes first, then the points.
    phone.online = true;
    phone.now += 60_000;
    await phone.sync();
    expect(await phone.outbox.items(owner)).toEqual([]);
    expect(await tracking.store.waiting(owner)).toBe(0);
    const stored = await app
      .get(Database)
      .forTenant(tenantId, (tx) =>
        tx.execute<{ n: number }>(
          `select count(*)::int as n from cell.location_points where shift_id = '${shiftId}'`,
        ),
      );
    expect(stored.rows).toEqual([{ n: 3 }]);
  });

  it('visits a place offline and sends the form filled there, after its punch-in and check-in (M6)', async () => {
    const tenantId = await world.tenant('Simulated Shops');
    const adminPhone = newPhone();
    await world.user(tenantId, { phone: adminPhone, designation: 'head', role: 'tenant_admin' });
    const person = await world.user(tenantId, { name: 'Vani Visitor', designation: 'executive' });
    const admin = (await world.signIn(adminPhone)).accessToken;
    const asAdmin = (url: string, payload: object) =>
      app.inject({
        method: 'POST',
        url,
        headers: { authorization: `Bearer ${admin}`, 'idempotency-key': newId() },
        payload,
      });
    const HERE = { lat: 28.6315, lng: 77.2167 };
    const accountId = newId();
    const made = await asAdmin('/v1/accounts', {
      id: accountId,
      type: 'customer',
      code: 'C-SIM',
      name: 'Simulated Stores',
      territoryId: await world.territory(tenantId, 'SIM'),
      location: HERE,
      slots: { executive: person.id },
    });
    expect(made.statusCode).toBe(201);
    const published = await asAdmin('/v1/forms', {
      definition: {
        key: 'shelf_note',
        name: { en: { one: 'Shelf note', other: 'Shelf notes' }, hi: { one: 'नोट', other: 'नोट' } },
        icon: 'notebook-pen',
        accountLink: { mode: 'required', accountTypes: ['customer'] },
        visitSession: true,
        fields: [
          { key: 'note', type: 'short_text', label: { en: 'Note', hi: 'नोट' }, required: true },
        ],
      },
    });
    expect(published.statusCode).toBe(201);

    const senders: Record<string, OutboxSender> = {};
    const phone: SimulatedPhone = await new SimulatedPhone(newDevice(), senders).start();
    const send = (path: string, schema: Parameters<Client['request']>[2]): OutboxSender => ({
      async send(payload) {
        await phone.client.request('POST', path, schema, { body: payload as never });
      },
    });
    senders['shift.start'] = send('/v1/shifts', ShiftResult);
    senders['visit.check_in'] = send('/v1/visits', VisitResult);
    senders['submission.create'] = send('/v1/submissions', SubmissionResult);
    senders['mock_location.report'] = send('/v1/locations/mocked', MockLocationReportResult);
    await phone.signIn(person.phone!);
    const owner = phone.client.owner!;
    const fix = (at: number) => ({
      location: HERE,
      accuracy: 12,
      mocked: false,
      capturedAt: new Date(at).toISOString(),
    });

    // No signal all morning: the punch-in, the check-in and the form wait on the phone.
    phone.online = false;
    const shiftId = newId();
    const startedAt = Date.now() - 2 * 3_600_000;
    const visitId = newId();
    const checkedInAt = startedAt + 30 * 60_000;
    const visits = new Visits(phone.db, () => phone.now);
    await phone.db.transaction(async (tx) => {
      await phone.outbox.enqueue(tx, {
        id: shiftId,
        owner,
        kind: 'shift.start',
        payload: {
          id: shiftId,
          startedAt: new Date(startedAt).toISOString(),
          location: HERE,
          accuracy: 15,
          mocked: false,
          consentVersion: '2026-10',
        },
      });
      await visits.open(tx, { owner, visitId, accountId, shiftId, checkedInAt });
      await phone.outbox.enqueue(tx, {
        id: visitId,
        owner,
        kind: 'visit.check_in',
        payload: {
          id: visitId,
          accountId,
          checkedInAt: new Date(checkedInAt).toISOString(),
          fix: fix(checkedInAt),
        },
        dependsOn: [shiftId],
      });
    });
    // A first try at the form was refused on the phone for a mocked fix, and reported (BR-50).
    const reportId = newId();
    await phone.outbox.enqueue(phone.db, {
      id: reportId,
      owner,
      kind: 'mock_location.report',
      payload: {
        id: reportId,
        seenAt: new Date(checkedInAt + 5 * 60_000).toISOString(),
        source: 'form',
        count: 1,
      },
    });
    const entries = new FormEntries(phone.db, () => phone.now);
    const entryId = newId();
    const capturedAt = checkedInAt + 10 * 60_000;
    await entries.start({
      id: entryId,
      owner,
      form: { ...(published.json() as object), version: 1 } as never,
      accountId,
    });
    await entries.submit(
      owner,
      entryId,
      { values: { note: 'Shelf restocked' } },
      { capturedAt, fix: fix(capturedAt), visitId },
      async (tx, entry) => {
        await phone.outbox.enqueue(tx, {
          id: entry.id,
          owner,
          kind: 'submission.create',
          payload: submissionBody(entry),
          dependsOn: [visitId],
        });
        await visits.touch(tx, owner, visitId, capturedAt);
      },
    );
    await phone.sync();
    expect((await phone.outbox.items(owner)).map((item) => item.kind)).toEqual([
      'shift.start',
      'visit.check_in',
      'mock_location.report',
      'submission.create',
    ]);

    // Signal at noon: the punch-in, then the check-in, then the form, each judged when it happened.
    phone.online = true;
    phone.now += 60_000;
    await phone.sync();
    expect(await phone.outbox.items(owner)).toEqual([]);
    const [stored] = await app
      .get(Database)
      .forTenant(tenantId, (tx) =>
        tx.execute<{
          visit_id: string;
          shift_id: string;
          captured_at: Date;
          geofence: string;
          flags: string;
        }>(
          `select visit_id, shift_id, captured_at, geofence, flags::text from cell.submissions where id = '${entryId}'`,
        ),
      )
      .then((result) => result.rows);
    expect(stored).toMatchObject({ visit_id: visitId, shift_id: shiftId, geofence: 'inside' });
    expect(stored!.flags).toContain('mock_history');
    expect(new Date(stored!.captured_at).getTime()).toBe(capturedAt);
  });

  it('saves a stock statement offline, which uploads and comes back synced (D124)', async () => {
    const tenantId = await world.tenant('Simulated Seeds', 'active', 'agri');
    const head = await world.user(tenantId, {
      designation: 'business_head',
      role: 'tenant_admin',
    });
    const asm = await world.user(tenantId, {
      designation: 'asm',
      role: 'manager',
      managerId: head.id,
    });
    const sme = await world.user(tenantId, {
      name: 'Sita SME',
      designation: 'sme',
      managerId: asm.id,
    });
    const admin = (await world.signIn(head.phone!)).accessToken;
    const call = (method: 'POST' | 'PUT', url: string, payload: object) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${admin}`, 'idempotency-key': newId() },
        payload,
      });
    const market = await world.territory(tenantId, `M-${newId().slice(-6)}`);
    const distributor = newId();
    const made = await call('POST', '/v1/accounts', {
      id: distributor,
      type: 'distributor',
      code: `D-${newId().slice(-6)}`,
      name: 'Kisan Traders',
      territoryId: market,
      slots: { sme: sme.id, asm: asm.id },
    });
    expect(made.statusCode, made.body).toBe(201);
    const item = newId();
    const saved = await call('PUT', `/v1/items/${item}`, {
      code: `NEEM${newId().slice(-4)}`,
      name: 'Neem oil',
      productName: 'Neem',
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

    const phone: SimulatedPhone = await new SimulatedPhone(
      newDevice(),
      {
        'sell_through.save': {
          async send(payload) {
            const { accountId, period, body } = payload as {
              accountId: string;
              period: string;
              body: object;
            };
            await phone.client.request(
              'PUT',
              `/v1/accounts/${accountId}/sell-through/${period}`,
              SellThroughResult,
              { body },
            );
          },
        },
      },
      undefined,
      ['sell_through'],
    ).start();
    await phone.signIn(sme.phone!);
    const owner = phone.client.owner!;
    const period = todayIn('Asia/Kolkata').slice(0, 7);
    const id = newId();
    phone.online = false;
    await phone.outbox.enqueue(phone.db, {
      id,
      owner,
      kind: 'sell_through.save',
      payload: {
        accountId: distributor,
        period,
        body: { id, lines: [{ itemId: item, received: '100', returned: '5', closing: '25' }] },
      },
    });
    await phone.sync();
    expect(await phone.outbox.items(owner)).toHaveLength(1);

    phone.online = true;
    phone.now += 5_000;
    await phone.sync();
    expect(await phone.outbox.items(owner)).toEqual([]);
    await phone.sync();
    const [kept] = await localRows(phone.db, 'sell_through');
    expect(kept).toMatchObject({
      id,
      accountId: distributor,
      period,
      version: 1,
      lines: [expect.objectContaining({ itemId: item, sold: '70', flags: ['no_price'] })],
    });
  });
  it('saves a forecast offline, two saves as two versions, which come back synced (D126)', async () => {
    const tenantId = await world.tenant('Simulated Forecasts', 'active', 'agri');
    const head = await world.user(tenantId, {
      designation: 'business_head',
      role: 'tenant_admin',
    });
    const asm = await world.user(tenantId, {
      designation: 'asm',
      role: 'manager',
      managerId: head.id,
    });
    const sme = await world.user(tenantId, { designation: 'sme', managerId: asm.id });
    const admin = (await world.signIn(head.phone!)).accessToken;
    const call = (method: 'POST' | 'PUT', url: string, payload: object) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${admin}`, 'idempotency-key': newId() },
        payload,
      });
    const market = await world.territory(tenantId, `M-${newId().slice(-6)}`);
    const distributor = newId();
    const made = await call('POST', '/v1/accounts', {
      id: distributor,
      type: 'distributor',
      code: `D-${newId().slice(-6)}`,
      name: 'Kisan Traders',
      territoryId: market,
      slots: { sme: sme.id, asm: asm.id },
    });
    expect(made.statusCode, made.body).toBe(201);
    const item = async (code: string) => {
      const id = newId();
      const saved = await call('PUT', `/v1/items/${id}`, {
        code: `${code}${newId().slice(-4)}`,
        name: `${code} item`,
        productName: code,
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
      return id;
    };
    const neem = await item('NEEM');
    const urea = await item('UREA');

    const phone: SimulatedPhone = await new SimulatedPhone(
      newDevice(),
      {
        'forecast.save': {
          async send(payload) {
            const { accountId, period, body } = payload as {
              accountId: string;
              period: string;
              body: object;
            };
            await phone.client.request(
              'PUT',
              `/v1/accounts/${accountId}/forecasts/${period}`,
              ForecastResult,
              { body },
            );
          },
        },
      },
      undefined,
      ['forecasts'],
    ).start();
    await phone.signIn(sme.phone!);
    const owner = phone.client.owner!;
    const period = shiftPeriod(todayIn('Asia/Kolkata').slice(0, 7), 1);
    const save = (lines: object[]) => {
      const id = newId();
      return phone.outbox
        .enqueue(phone.db, {
          id,
          owner,
          kind: 'forecast.save',
          payload: { accountId: distributor, period, body: { id, lines } },
        })
        .then(() => id);
    };
    phone.online = false;
    await save([
      { itemId: neem, quantity: '120' },
      { itemId: urea, quantity: '30' },
    ]);
    const second = await save([{ itemId: urea, quantity: '0' }]);
    await phone.sync();
    expect(await phone.outbox.items(owner)).toHaveLength(2);

    phone.online = true;
    phone.now += 5_000;
    await phone.sync();
    expect(await phone.outbox.items(owner)).toEqual([]);
    await phone.sync();
    // Both saves were kept as versions; the phone holds the latest, with urea taken out.
    const kept = await localRows(phone.db, 'forecasts');
    expect(kept).toEqual([
      expect.objectContaining({
        id: second,
        accountId: distributor,
        period,
        version: 2,
        lines: [{ itemId: neem, quantity: '120' }],
      }),
    ]);
  });
  it('keeps schemes, places an order quoting one, and is refused once it ends (D127)', async () => {
    const tenantId = await world.tenant('Simulated Schemes', 'active', 'agri');
    const head = await world.user(tenantId, {
      designation: 'business_head',
      role: 'tenant_admin',
    });
    const asm = await world.user(tenantId, {
      designation: 'asm',
      role: 'manager',
      managerId: head.id,
    });
    const sme = await world.user(tenantId, { designation: 'sme', managerId: asm.id });
    const admin = (await world.signIn(head.phone!)).accessToken;
    const call = (method: 'POST' | 'PUT', url: string, payload: object) =>
      app.inject({
        method,
        url,
        headers: { authorization: `Bearer ${admin}`, 'idempotency-key': newId() },
        payload,
      });
    const market = await world.territory(tenantId, `M-${newId().slice(-6)}`);
    const distributor = newId();
    const made = await call('POST', '/v1/accounts', {
      id: distributor,
      type: 'distributor',
      code: `D-${newId().slice(-6)}`,
      name: 'Kisan Traders',
      territoryId: market,
      slots: { sme: sme.id, asm: asm.id },
    });
    expect(made.statusCode, made.body).toBe(201);
    const neem = newId();
    const saved = await call('PUT', `/v1/items/${neem}`, {
      code: `NEEM${newId().slice(-4)}`,
      name: 'Neem oil',
      productName: 'Neem',
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
    const list = newId();
    await call('PUT', `/v1/price-lists/${list}`, {
      name: 'Standard',
      scope: 'default',
      validFrom: '2026-01-01',
    });
    await call('PUT', `/v1/price-lists/${list}/items`, {
      set: [{ itemId: neem, price: '400', discount: '10' }],
      version: 1,
    });
    const schemeId = newId();
    const scheme = {
      key: 'twenty_a_pack',
      name: { en: 'Twenty a pack', hi: 'Twenty a pack' },
      kind: 'flat_per_unit',
      rule: { amount: '20' },
      validFrom: '2026-01-01',
    };
    expect((await call('PUT', `/v1/schemes/${schemeId}`, scheme)).statusCode).toBe(201);

    const phone: SimulatedPhone = await new SimulatedPhone(
      newDevice(),
      {
        'order.place': {
          async send(payload) {
            await phone.client.request('POST', '/v1/orders', OrderResult, { body: payload });
          },
        },
      },
      undefined,
      ['schemes'],
    ).start();
    await phone.signIn(sme.phone!);
    const owner = phone.client.owner!;
    await phone.sync();
    const [kept] = await localRows(phone.db, 'schemes');
    expect(kept).toMatchObject({ id: schemeId, key: 'twenty_a_pack', active: true });

    // 2 cases, 24 packs at 360: 480.00 off, as the phone works it out.
    const order = (quoted: object | null) => {
      const id = newId();
      return {
        id,
        accountId: distributor,
        visitId: null,
        lines: [
          {
            itemId: neem,
            unitKey: 'case',
            quantity: '2',
            quoted: {
              listId: list,
              price: '400',
              discount: '10',
              taxRate: '18',
              factor: '12',
              scheme: quoted,
            },
          },
        ],
        free: [],
        note: null,
        photos: [],
        fix: {
          location: { lat: 28.6315, lng: 77.2167 },
          accuracy: 12,
          mocked: false,
          capturedAt: new Date(phone.now).toISOString(),
        },
        placedAt: new Date(phone.now).toISOString(),
      };
    };
    const first = order({ key: 'twenty_a_pack', discount: '480.00' });
    await phone.outbox.enqueue(phone.db, {
      id: first.id,
      owner,
      kind: 'order.place',
      payload: first,
    });
    phone.now += 5_000;
    await phone.sync();
    expect(await phone.outbox.items(owner)).toEqual([]);

    // The scheme is switched off; the phone hears of it, and an order still quoting it is refused.
    const off = await call('PUT', `/v1/schemes/${schemeId}`, {
      ...scheme,
      active: false,
      version: 1,
    });
    expect(off.statusCode, off.body).toBe(200);
    phone.online = false;
    const stale = order({ key: 'twenty_a_pack', discount: '480.00' });
    await phone.outbox.enqueue(phone.db, {
      id: stale.id,
      owner,
      kind: 'order.place',
      payload: stale,
    });
    phone.online = true;
    phone.now += 5_000;
    await phone.sync();
    expect(await phone.outbox.items(owner)).toEqual([
      expect.objectContaining({ id: stale.id, state: 'parked', lastErrorCode: 'PRICE_CHANGED' }),
    ]);
    await phone.sync();
    const [now] = (await localRows(phone.db, 'schemes')) as SyncScheme[];
    expect(now).toMatchObject({ id: schemeId, active: false });
  });
});
