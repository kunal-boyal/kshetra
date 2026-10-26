import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { DelayedError, type Job } from 'bullmq';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { EntitlementsService } from '../src/modules/billing/entitlements.service';
import { ImportsService } from '../src/modules/imports/imports.service';
import { type JobData, Queues } from '../src/platform/queues';
import { TenantSlots } from '../src/platform/tenant-slots';
import { newAddress, newPhone, startApp, testConfig, World } from './support';

/**
 * Noisy neighbours (spec 10.3, decision D98): a tenant's requests a minute by plan, everyone's
 * together; its heavy jobs at once on a queue; and the rows one import may hold.
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

/** A tenant with an admin on the web, and its own limits. */
async function tenant(name: string, limits: Record<string, number>) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  await app
    .get(EntitlementsService)
    .set(null, tenantId, { planId: null, extraModules: [], limits });
  const token = (await world.signIn(phone)).accessToken;
  return { tenantId, token };
}

describe('noisy neighbours (decision D98)', () => {
  it('holds a tenant to its requests a minute, and leaves other tenants alone', async () => {
    const busy = await tenant('Busy Traders', { requestsPerMinute: 60 });
    const quiet = await tenant('Quiet Traders', {});
    const get = (token: string) =>
      app.inject({
        method: 'GET',
        url: '/v1/me',
        remoteAddress: newAddress(),
        headers: { authorization: `Bearer ${token}` },
      });
    // Signing in already spent some of the minute; the rest go now.
    let refused;
    for (let i = 0; i < 61 && !refused; i++) {
      const reply = await get(busy.token);
      if (reply.statusCode === 429) refused = reply;
    }
    expect(refused?.json().error.code).toBe('RATE_LIMITED');
    expect(Number(refused?.headers['retry-after'])).toBeGreaterThan(0);
    expect((await get(quiet.token)).statusCode).toBe(200);
  });

  it('runs a tenant’s heavy jobs within its slots, and gives a slot back when one ends', async () => {
    const slots = app.get(TenantSlots);
    const tenantId = newId();
    expect(await slots.take('exports', tenantId, 'a', 2, 60_000)).toBe(true);
    expect(await slots.take('exports', tenantId, 'b', 2, 60_000)).toBe(true);
    expect(await slots.take('exports', tenantId, 'c', 2, 60_000)).toBe(false);
    // Holding a slot already, a job keeps it; another tenant has slots of its own.
    expect(await slots.take('exports', tenantId, 'a', 2, 60_000)).toBe(true);
    expect(await slots.take('exports', newId(), 'c', 2, 60_000)).toBe(true);
    await slots.release('exports', tenantId, 'b');
    expect(await slots.take('exports', tenantId, 'c', 2, 60_000)).toBe(true);
    // A worker that died holds its slot only until the hold runs out.
    const later = Date.now() + 120_000;
    expect(await slots.take('exports', tenantId, 'd', 2, 60_000, later)).toBe(true);

    // The queue runs a heavy job only within its tenant's plan slots (here 1).
    const { tenantId: limited } = await tenant('Heavy Traders', { queueSlots: 1 });
    const queues = app.get(Queues);
    const ran: string[] = [];
    queues.handle(
      'maintenance',
      'test.heavy',
      async (data) => {
        ran.push(String(data.marker));
      },
      { perTenant: true },
    );
    const job = (id: string) =>
      ({
        id,
        name: 'test.heavy',
        data: { tenantId: limited, marker: id },
        moveToDelayed: vi.fn(async () => undefined),
      }) as unknown as Job<JobData> & { moveToDelayed: ReturnType<typeof vi.fn> };
    await slots.take('maintenance', limited, 'running', 1, 60_000);
    const waiting = job('waiting');
    await expect(queues.run('maintenance', waiting, 'token')).rejects.toBeInstanceOf(DelayedError);
    expect(waiting.moveToDelayed).toHaveBeenCalledOnce();
    expect(ran).toEqual([]);
    await slots.release('maintenance', limited, 'running');
    await queues.run('maintenance', job('next'), 'token');
    expect(ran).toEqual(['next']);
    // Its slot came back when it ended.
    expect(await slots.take('maintenance', limited, 'after', 1, 60_000)).toBe(true);
  });

  it('refuses an import with more rows than the plan allows', async () => {
    const t = await tenant('Small Traders', { importRows: 100 });
    const rows = [['Code', 'Name', 'Mobile', 'Designation']];
    for (let i = 0; i < 101; i++) rows.push([`S${i}`, `Person ${i}`, '', 'executive']);
    const body = rows.map((row) => row.join(',')).join('\n');
    const uploaded = await app.inject({
      method: 'POST',
      url: '/v1/imports?target=users&fileName=people.csv',
      remoteAddress: newAddress(),
      headers: {
        authorization: `Bearer ${t.token}`,
        'idempotency-key': newId(),
        'content-type': 'text/csv',
      },
      payload: body,
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    const id = uploaded.json().id as string;
    await app.get(ImportsService).read(t.tenantId, id);
    const read = await app.inject({
      method: 'GET',
      url: `/v1/imports/${id}`,
      remoteAddress: newAddress(),
      headers: { authorization: `Bearer ${t.token}` },
    });
    expect(read.json()).toMatchObject({ status: 'failed' });
    expect(read.body).toContain('more than 100 rows');
  });
});
