import { newId } from '@kshetra/shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { loadConfig } from '../src/config';
import type { StoredResponse } from '../src/db/schema';
import { Database } from '../src/platform/database';
import { idempotent } from '../src/platform/idempotency';

const urls = inject('databaseUrls');
let database: Database;

beforeAll(() => {
  database = new Database(
    loadConfig({ NODE_ENV: 'test', DATABASE_URL: urls.cellApp, DB_POOL_MAX: '4' }),
  );
});

afterAll(() => database.onModuleDestroy());

/** A create handler that counts its runs and can be slowed down. */
function createOrder(delayMs = 0) {
  let runs = 0;
  return {
    runs: () => runs,
    handler: async (): Promise<StoredResponse> => {
      runs += 1;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return { status: 201, body: { orderId: `order-${runs}` } };
    },
  };
}

function send(
  tenantId: string,
  key: string,
  request: unknown,
  handler: () => Promise<StoredResponse>,
) {
  return database.forTenant(tenantId, (tx) => idempotent(tx, tenantId, key, request, handler));
}

describe('idempotent requests (BR-46)', () => {
  it('run once, and replay the stored result for the same key and content', async () => {
    const tenant = newId();
    const order = createOrder();
    const first = await send(tenant, 'key-1', { qty: 2, item: 'KM-21' }, order.handler);
    const again = await send(tenant, 'key-1', { qty: 2, item: 'KM-21' }, order.handler);
    expect(order.runs()).toBe(1);
    expect(first).toEqual({ status: 201, body: { orderId: 'order-1' }, replayed: false });
    expect(again).toEqual({ status: 201, body: { orderId: 'order-1' }, replayed: true });
  });

  it('treat the same content with keys in a different order as the same request', async () => {
    const tenant = newId();
    const order = createOrder();
    await send(tenant, 'key-1', { qty: 2, item: 'KM-21' }, order.handler);
    const again = await send(tenant, 'key-1', { item: 'KM-21', qty: 2 }, order.handler);
    expect(again.replayed).toBe(true);
    expect(order.runs()).toBe(1);
  });

  it('reject the same key with different content', async () => {
    const tenant = newId();
    const order = createOrder();
    await send(tenant, 'key-1', { qty: 2 }, order.handler);
    await expect(send(tenant, 'key-1', { qty: 3 }, order.handler)).rejects.toMatchObject({
      code: 'IDEMPOTENCY_CONFLICT',
      status: 409,
    });
    expect(order.runs()).toBe(1);
  });

  it('keep keys apart per tenant', async () => {
    const order = createOrder();
    const a = await send(newId(), 'key-1', { qty: 2 }, order.handler);
    const b = await send(newId(), 'key-1', { qty: 2 }, order.handler);
    expect([a.replayed, b.replayed]).toEqual([false, false]);
    expect(order.runs()).toBe(2);
  });

  it('run once when two identical requests race', async () => {
    const tenant = newId();
    const order = createOrder(200);
    const results = await Promise.all([
      send(tenant, 'race', { qty: 1 }, order.handler),
      send(tenant, 'race', { qty: 1 }, order.handler),
    ]);
    expect(order.runs()).toBe(1);
    expect(results.map((result) => result.replayed).sort()).toEqual([false, true]);
    expect(results[0]?.body).toEqual(results[1]?.body);
  });

  it('free the key again when the first attempt fails', async () => {
    const tenant = newId();
    const failing = async (): Promise<StoredResponse> => {
      throw new Error('price service down');
    };
    await expect(send(tenant, 'retry-me', { qty: 1 }, failing)).rejects.toThrow(
      'price service down',
    );
    const order = createOrder();
    const retried = await send(tenant, 'retry-me', { qty: 1 }, order.handler);
    expect(retried.replayed).toBe(false);
    expect(order.runs()).toBe(1);
  });

  it('reject malformed keys', async () => {
    const order = createOrder();
    await expect(send(newId(), 'has spaces', {}, order.handler)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    await expect(send(newId(), 'x'.repeat(201), {}, order.handler)).rejects.toMatchObject({
      code: 'VALIDATION',
    });
    expect(order.runs()).toBe(0);
  });
});
