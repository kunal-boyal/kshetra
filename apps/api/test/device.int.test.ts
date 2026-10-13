import { type Client, createClient, memoryStore } from '@kshetra/api-client';
import { nodeSqlite } from '@kshetra/api-client/node-sqlite';
import {
  clearReferenceData,
  localRows,
  migrate,
  Outbox,
  type OutboxSender,
  type SqlDatabase,
  SyncRunner,
  Tracking,
} from '@kshetra/api-client/sync';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { type DeviceInfo, LocationBatchResult, newId, ShiftResult } from '@kshetra/shared';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { devices } from '../src/db/schema/iam';
import { SyncTombstones } from '../src/modules/sync/tombstones';
import { Database } from '../src/platform/database';
import { newAddress, newDevice, startApp, testConfig, World } from './support';

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
      entities: ['users', 'territories'],
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
});
