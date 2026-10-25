import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CellHealthReporter } from '../src/modules/scheduling/cell-health-reporter';
import { HealthCounters } from '../src/platform/health-counters';
import { Queues } from '../src/platform/queues';
import { newAddress, newDevice, newPhone, staffToken, startApp, World } from './support';

/**
 * Health per cell (module M22, spec 14.6, decision D93): the scheduler measures the minute just
 * gone, from Redis counts, the queues, the outbox and phones' heartbeats, and the directory keeps
 * it for the console, which says what needs looking at.
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

describe('health per cell (M22, D93)', () => {
  it('measures a minute of the cell, and the console reads it with what needs looking at', async () => {
    // A phone with uploads waiting for two hours.
    const tenantId = await world.tenant('Healthy Org');
    const phone = newPhone();
    await world.user(tenantId, { phone });
    const { accessToken } = await world.signIn(phone, newDevice());
    const beat = await app.inject({
      method: 'POST',
      url: '/v1/devices/heartbeat',
      remoteAddress: newAddress(),
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        appVersion: '0.1.0',
        osVersion: '15',
        queue: {
          queued: 4,
          parked: 1,
          oldestQueuedAt: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        },
        lastSyncAt: null,
      },
    });
    expect(beat.statusCode, beat.body).toBe(204);

    // A minute of requests, errors and points, and a job waiting.
    const now = new Date();
    const minute = new Date(Math.floor(now.getTime() / 60_000) * 60_000 - 60_000);
    const counters = app.get(HealthCounters);
    for (let i = 0; i < 60; i += 1) counters.request(i < 5 ? 503 : 200, minute);
    counters.points(10, 3, minute);
    await app.get(Queues).add('exports', 'health.check', {}, { jobId: `health-${newId()}` });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const figures = await app.get(CellHealthReporter).report(now);
    expect(figures.requests).toBeGreaterThanOrEqual(60);
    expect(figures.errors).toBeGreaterThanOrEqual(5);
    expect(figures.points).toBeGreaterThanOrEqual(10);
    expect(figures.latePoints).toBeGreaterThanOrEqual(3);
    expect(figures.queues.exports!.waiting).toBeGreaterThanOrEqual(1);
    expect(figures.phones.waiting).toBeGreaterThanOrEqual(1);
    expect(figures.phones.parked).toBeGreaterThanOrEqual(1);
    expect(figures.phones.oldestQueuedSeconds).toBeGreaterThanOrEqual(7_190);

    const staff = await staffToken(app, 'support');
    const report = await app.inject({
      method: 'GET',
      url: '/platform/v1/health',
      remoteAddress: newAddress(),
      headers: { authorization: `Bearer ${staff}` },
    });
    expect(report.statusCode, report.body).toBe(200);
    const local = report
      .json()
      .items.find((item: { cell: { name: string } }) => item.cell.name === 'local');
    expect(local.latest.at).toBe(minute.toISOString());
    expect(local.issues).toEqual(expect.arrayContaining([{ key: 'sync' }]));
    expect(local.hours[0]).toMatchObject({ minutes: expect.any(Number) });
    expect(local.hours[0].requests).toBeGreaterThanOrEqual(60);

    // The same minute again, from a second scheduler, is kept once.
    await app.get(CellHealthReporter).report(now);
    const again = await app.inject({
      method: 'GET',
      url: '/platform/v1/health',
      remoteAddress: newAddress(),
      headers: { authorization: `Bearer ${staff}` },
    });
    const hour = again
      .json()
      .items.find((item: { cell: { name: string } }) => item.cell.name === 'local').hours[0];
    expect(hour.minutes).toBe(local.hours[0].minutes);
  });
});
