import { newId } from '@thelamp/shared';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { and, eq } from 'drizzle-orm';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { outboxEvents } from '../src/db/schema';
import { Database } from '../src/platform/database';
import { Outbox, retryDelayMs } from '../src/platform/outbox';
import { OutboxRelay } from '../src/platform/relay';
import { newPhone, startApp, World } from './support';

let app: NestFastifyApplication;
let world: World;
let outbox: Outbox;
let relay: OutboxRelay;
let database: Database;
const urls = inject('databaseUrls');

/** A consumer that fails while `failing` is set, and counts what it takes. */
const flaky = { failing: false, taken: [] as string[], delayMs: 0 };

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  outbox = app.get(Outbox);
  relay = app.get(OutboxRelay);
  database = app.get(Database);
  outbox.consume(['user.updated'], 'test.flaky', async (event) => {
    await new Promise((resolve) => setTimeout(resolve, flaky.delayMs));
    if (flaky.failing) throw new Error('not today');
    flaky.taken.push(event.id);
  });
});

afterAll(async () => {
  await world.end();
  await app.close();
});

async function asAdmin<T extends pg.QueryResultRow>(text: string, values: unknown[] = []) {
  const client = new pg.Client({ connectionString: urls.admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

const events = (aggregateId: string) =>
  asAdmin<{
    id: string;
    type: string;
    attempts: number;
    last_error: string | null;
    next_attempt_at: Date;
    dispatched_at: Date | null;
  }>('select * from cell.outbox_events where aggregate_id = $1 order by created_at, id', [
    aggregateId,
  ]);

describe('the outbox (spec 12.3, 12.4)', () => {
  it('writes an event in the same transaction as the change, and delivers it after commit', async () => {
    const tenantId = await world.tenant('Saanvi Agro');
    const user = await world.user(tenantId, { phone: newPhone() });
    const [created] = await events(user.id);
    expect(created).toMatchObject({ type: 'user.created', attempts: 1, last_error: null });
    expect(created!.dispatched_at).not.toBeNull();
    // Its consumer, the directory, now knows the user.
    expect(await world.directory.membership(tenantId, user.id)).toMatchObject({
      status: 'active',
      authRevision: 0,
    });

    // A change that rolls back takes its event with it.
    const ghost = newId();
    await expect(
      database.forTenant(tenantId, async (tx) => {
        await outbox.publish(tx, tenantId, 'user.updated', ghost, {
          userId: ghost,
          phone: null,
          status: 'active',
          authRevision: 1,
        });
        throw new Error('changed my mind');
      }),
    ).rejects.toThrow('changed my mind');
    expect(await events(ghost)).toEqual([]);
  });

  it('keeps an event that a consumer refused, and the relay delivers it once it is due', async () => {
    const tenantId = await world.tenant('Tanvi Seeds');
    const user = await world.user(tenantId, { phone: newPhone() });
    flaky.failing = true;
    await database.forTenant(tenantId, (tx) =>
      outbox.publish(tx, tenantId, 'user.updated', user.id, {
        userId: user.id,
        phone: user.phone,
        status: 'active',
        authRevision: 0,
      }),
    );
    const [, pending] = await events(user.id);
    expect(pending).toMatchObject({
      type: 'user.updated',
      attempts: 1,
      last_error: 'test.flaky: not today',
      dispatched_at: null,
    });
    const wait = pending!.next_attempt_at.getTime() - Date.now();
    expect(wait).toBeGreaterThan(retryDelayMs(1) - 2_000);

    flaky.failing = false;
    // Not due yet, so the relay leaves it.
    await relay.runOnce();
    expect((await events(user.id))[1]!.dispatched_at).toBeNull();
    await asAdmin('update cell.outbox_events set next_attempt_at = now() where id = $1', [
      pending!.id,
    ]);
    expect(await relay.runOnce()).toBeGreaterThanOrEqual(1);
    const [, delivered] = await events(user.id);
    expect(delivered).toMatchObject({ attempts: 2, last_error: null });
    expect(delivered!.dispatched_at).not.toBeNull();
    expect(flaky.taken).toContain(pending!.id);
  });

  it('hands an event to one delivery at a time, even when two try at once', async () => {
    const tenantId = await world.tenant('Udita Krishi');
    const id = newId();
    const aggregateId = newId();
    await database.forTenant(tenantId, (tx) =>
      tx.insert(outboxEvents).values({
        id,
        tenantId,
        type: 'user.updated',
        aggregateId,
        payload: { userId: aggregateId, phone: null, status: 'active', authRevision: 0 },
      }),
    );
    flaky.delayMs = 200;
    try {
      const results = await Promise.all([
        outbox.deliver(tenantId, id),
        outbox.deliver(tenantId, id),
      ]);
      expect(results.sort()).toEqual([false, true]);
    } finally {
      flaky.delayMs = 0;
    }
    expect(flaky.taken.filter((taken) => taken === id)).toHaveLength(1);
    expect(await outbox.deliver(tenantId, id)).toBe(false);
    const [row] = await database.forTenant(tenantId, (tx) =>
      tx
        .select()
        .from(outboxEvents)
        .where(and(eq(outboxEvents.tenantId, tenantId), eq(outboxEvents.id, id))),
    );
    expect(row!.attempts).toBe(1);
  });

  it('purges delivered events after 3 days and idempotency keys after 7', async () => {
    const tenantId = await world.tenant('Vedika Agro');
    const old = newId();
    const recent = newId();
    const waiting = newId();
    await asAdmin(
      `insert into cell.outbox_events (id, tenant_id, type, aggregate_id, payload, created_at, dispatched_at)
       values ($1, $4, 'user.updated', $1, '{}', now() - interval '5 days', now() - interval '4 days'),
              ($2, $4, 'user.updated', $2, '{}', now() - interval '2 days', now() - interval '2 days'),
              ($3, $4, 'user.updated', $3, '{}', now() - interval '9 days', null)`,
      [old, recent, waiting, tenantId],
    );
    await asAdmin(
      `insert into cell.idempotency_keys (tenant_id, key, request_hash, created_at)
       values ($1, 'stale', 'x', now() - interval '8 days'), ($1, 'fresh', 'x', now())`,
      [tenantId],
    );
    await relay.housekeeping();
    const left = await asAdmin<{ id: string }>(
      'select id from cell.outbox_events where id = any($1)',
      [[old, recent, waiting]],
    );
    expect(left.map((row) => row.id).sort()).toEqual([recent, waiting].sort());
    const keys = await asAdmin<{ key: string }>(
      'select key from cell.idempotency_keys where tenant_id = $1',
      [tenantId],
    );
    expect(keys.map((row) => row.key)).toEqual(['fresh']);
  });

  it('lets the relay see only IDs across tenants, and nobody else see even those', async () => {
    const tenantId = await world.tenant('Yamini Seeds');
    const id = newId();
    await asAdmin(
      `insert into cell.outbox_events (id, tenant_id, type, aggregate_id, payload)
       values ($1, $2, 'user.updated', $1, '{"secret": true}')`,
      [id, tenantId],
    );
    const cellApp = new pg.Client({ connectionString: urls.cellApp });
    await cellApp.connect();
    try {
      const { rows, fields } = await cellApp.query('select * from cell.due_outbox_events(500)');
      expect(fields.map((field) => field.name)).toEqual(['tenant_id', 'id']);
      expect(rows).toContainEqual({ tenant_id: tenantId, id });
    } finally {
      await cellApp.end();
    }
    const directory = new pg.Client({ connectionString: urls.directoryApp });
    await directory.connect();
    try {
      await expect(directory.query('select * from cell.due_outbox_events(10)')).rejects.toThrow(
        /permission denied/,
      );
    } finally {
      await directory.end();
    }
  });
});
