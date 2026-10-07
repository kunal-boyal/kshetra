import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TenantScheduler } from '../src/modules/scheduling/tenant-scheduler';
import { TenantConfigService } from '../src/modules/tenant-config/tenant-config.service';
import { SYSTEM_ACTOR } from '../src/platform/audit';
import { Database } from '../src/platform/database';
import { type JobData, Queues } from '../src/platform/queues';
import { Schedules } from '../src/platform/schedules';
import { startApp, testConfig, World } from './support';

/** Background jobs and schedules (spec 12.3), on real Redis and PostgreSQL. */

const CELL = 'background-cell';
let app: NestFastifyApplication;
let world: World;
let queues: Queues;
const ran: (JobData & { kind: string })[] = [];
let failuresLeft = 1;

async function until(done: () => boolean, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!done()) {
    if (Date.now() > deadline) throw new Error('Gave up waiting for the worker.');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  // Its own cell, so the scheduler sees only this file's tenants.
  app = await startApp(testConfig({ CELL_ID: CELL }));
  world = await World.create(app);
  queues = app.get(Queues);
  queues.handle(
    'maintenance',
    'test.echo',
    async (data) => void ran.push({ kind: 'echo', ...data }),
  );
  queues.handle('maintenance', 'test.flaky', async (data) => {
    if (failuresLeft-- > 0) throw new Error('The first try fails.');
    ran.push({ kind: 'flaky', ...data });
  });
  queues.handle(
    'maintenance',
    'test.nightly',
    async (data) => void ran.push({ kind: 'nightly', ...data }),
  );
  app.get(Schedules).atTenantTime({
    name: 'test_nightly',
    at: '01:30',
    queue: 'maintenance',
    kind: 'test.nightly',
  });
  queues.startWorkers();
});

afterAll(async () => {
  await world.end();
  await app.close();
});

describe('background jobs (spec 12.3)', () => {
  it('run on the worker through the handler for their kind', async () => {
    await queues.add('maintenance', 'test.echo', { note: 'hello' });
    await until(() => ran.some((job) => job.kind === 'echo'));
    expect(ran.find((job) => job.kind === 'echo')).toMatchObject({ note: 'hello' });
  });

  it('are tried again after a failure', async () => {
    await queues.add(
      'maintenance',
      'test.flaky',
      {},
      {
        attempts: 2,
        backoff: { type: 'fixed', delay: 50 },
      },
    );
    await until(() => ran.some((job) => job.kind === 'flaky'));
    expect(failuresLeft).toBeLessThan(0);
  });

  it('put housekeeping on the maintenance queue every hour', async () => {
    await app.get(TenantScheduler).start();
    const schedulers = await queues.queue('maintenance').getJobSchedulers();
    expect(schedulers).toContainEqual(
      expect.objectContaining({ key: 'housekeeping', every: 3_600_000 }),
    );
  });
});

describe("a moment of the tenant's day", () => {
  it('runs once per open tenant on its local date, once its clock passes the time', async () => {
    const kolkata = await world.directory.tenant('Morning Mills', 'active', CELL);
    const newYork = await world.directory.tenant('Evening Exports', 'active', CELL);
    const closed = await world.directory.tenant('Shut Shop', 'suspended', CELL);
    await app
      .get(Database)
      .forTenant(newYork, (tx) =>
        app
          .get(TenantConfigService)
          .updateSettings(tx, newYork, SYSTEM_ACTOR, { timezone: 'America/New_York' }),
      );
    const scheduler = app.get(TenantScheduler);

    // 01:15 in Kolkata and 15:45 in New York: only New York's 01:30 has passed.
    await scheduler.tick(new Date('2026-10-05T19:45:00Z'));
    // 01:45 in Kolkata: its moment has come too. New York's job is the same one as before.
    await scheduler.tick(new Date('2026-10-05T20:15:00Z'));
    await scheduler.tick(new Date('2026-10-05T20:15:00Z'));

    const queue = queues.queue('maintenance');
    expect(await queue.getJob(`test_nightly.${newYork}.2026-10-05`)).toBeTruthy();
    expect(await queue.getJob(`test_nightly.${kolkata}.2026-10-06`)).toBeTruthy();
    const nightly = () => ran.filter((job) => job.kind === 'nightly');
    await until(() => nightly().length >= 2);
    // A little longer, to see nothing runs twice.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(
      nightly()
        .map((job) => `${job.tenantId} ${job.date}`)
        .sort(),
    ).toEqual([`${kolkata} 2026-10-06`, `${newYork} 2026-10-05`].sort());
    expect(nightly().some((job) => job.tenantId === closed)).toBe(false);
  });
});
