import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { isId } from '@thelamp/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startApp, testConfig } from './support';

describe('the HTTP API', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await startApp();
  });

  afterAll(() => app.close());

  it('answers /health and gives every response a request ID', async () => {
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(isId(String(response.headers['x-request-id']))).toBe(true);
  });

  it('sends every answer uncached, unsniffed and unframed (decision D101)', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(response.headers).toMatchObject({
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'cross-origin-resource-policy': 'same-origin',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
      'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    });
    // A route that may be cached says so itself.
    const document = await app.inject({ method: 'GET', url: '/v1/openapi.json' });
    expect(document.headers['cache-control']).toBe('public, max-age=300');
  });

  it('is ready when the databases and Redis answer', async () => {
    const response = await app.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
  });

  it("keeps a caller's well-formed X-Request-Id", async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'phone-42.req:7' },
    });
    expect(response.headers['x-request-id']).toBe('phone-42.req:7');
  });

  it('replaces a malformed X-Request-Id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-request-id': 'not ok; drop table' },
    });
    expect(isId(String(response.headers['x-request-id']))).toBe(true);
  });

  it('answers an unknown route in the error format of spec 11.1', async () => {
    const response = await app.inject({ method: 'GET', url: '/v1/nothing-here' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'This was not found.',
        requestId: response.headers['x-request-id'],
      },
    });
  });
});

describe('the HTTP API with its databases and Redis down', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    // Nothing listens on port 1, so every connection attempt fails at once.
    app = await startApp(
      testConfig({
        DATABASE_URL: 'postgres://cell_app:unused@127.0.0.1:1/kshetra',
        DIRECTORY_DATABASE_URL: 'postgres://directory_app:unused@127.0.0.1:1/kshetra',
        REDIS_URL: 'redis://127.0.0.1:1',
      }),
    );
  });

  afterAll(() => app.close());

  it('stays alive but reports not ready', async () => {
    expect((await app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(503);
    // Which part is down is logged, never told to whoever asks (D101).
    expect(ready.json()).toEqual({ status: 'not_ready' });
  });
});
