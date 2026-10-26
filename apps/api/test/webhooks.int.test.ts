import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { newId } from '@thelamp/shared';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { webhookMessages } from '../src/db/schema/webhooks';
import { WebhooksService } from '../src/modules/webhooks/webhooks.service';
import { Database } from '../src/platform/database';
import { newAddress, newDevice, newPhone, startApp, World } from './support';

/**
 * Webhooks (spec 12.4, module M20, decision D94): subscriptions to domain events, messages signed
 * as Standard Webhooks sign them, tried again with backoff for a day, a log of every try, tests,
 * sending again and new secrets. Tests run no workers, so they try messages as the worker would.
 */

interface Received {
  headers: IncomingHttpHeaders;
  body: string;
}

let app: NestFastifyApplication;
let world: World;
let receiver: Server;
let receiverUrl: string;
const received: Received[] = [];
let answer = 200;

beforeAll(async () => {
  app = await startApp();
  world = await World.create(app);
  receiver = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.statusCode = answer;
      response.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  receiverUrl = `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
});

afterAll(async () => {
  await new Promise((resolve) => receiver.close(resolve));
  await world.end();
  await app.close();
});

beforeEach(() => {
  received.length = 0;
  answer = 200;
});

function call(method: 'GET' | 'POST' | 'PATCH', url: string, token: string, body?: object) {
  return app.inject({
    method,
    url,
    remoteAddress: newAddress(),
    headers: { authorization: `Bearer ${token}`, 'idempotency-key': newId() },
    ...(body ? { payload: body } : {}),
  });
}

async function organisation(name: string) {
  const tenantId = await world.tenant(name);
  const phone = newPhone();
  await world.user(tenantId, { phone, designation: 'head', role: 'tenant_admin' });
  return { tenantId, admin: (await world.signIn(phone)).accessToken };
}

async function subscribe(admin: string, events: string[]) {
  const made = await call('POST', '/v1/webhooks', admin, {
    id: newId(),
    url: receiverUrl,
    events,
    description: 'ERP',
  });
  expect(made.statusCode, made.body).toBe(201);
  return made.json() as { webhook: { id: string }; secret: string };
}

function messages(tenantId: string, subscriptionId: string) {
  return app.get(Database).forTenant(tenantId, (tx) =>
    tx
      .select()
      .from(webhookMessages)
      .where(
        and(
          eq(webhookMessages.tenantId, tenantId),
          eq(webhookMessages.subscriptionId, subscriptionId),
        ),
      ),
  );
}

/** Whether a received message carries a valid signature under this secret. */
function signedWith(secret: string, { headers, body }: Received) {
  const signed = `${String(headers['webhook-id'])}.${String(headers['webhook-timestamp'])}.${body}`;
  const expected = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(signed)
    .digest('base64');
  return String(headers['webhook-signature']) === `v1,${expected}`;
}

describe('webhooks (M20, D94)', () => {
  it('subscribes once, shows the secret once and checks the address', async () => {
    const org = await organisation('Hooks Subscribe');
    const { webhook, secret } = await subscribe(org.admin, ['user.created']);
    expect(secret).toMatch(/^whsec_/);
    const listed = (await call('GET', '/v1/webhooks', org.admin)).json();
    expect(listed.items).toEqual([
      expect.objectContaining({ id: webhook.id, url: receiverUrl, status: 'active' }),
    ]);
    expect(JSON.stringify(listed)).not.toContain(secret);

    const again = await call('POST', '/v1/webhooks', org.admin, {
      id: webhook.id,
      url: receiverUrl,
      events: ['user.created'],
    });
    expect(again.json().error.code).toBe('CONFLICT');
    const badAddress = await call('POST', '/v1/webhooks', org.admin, {
      id: newId(),
      url: 'ftp://erp.example.com/hooks',
      events: ['user.created'],
    });
    expect(badAddress.json().error.details).toEqual([
      { path: 'url', issue: 'Use an https:// address' },
    ]);
    const unknownEvent = await call('POST', '/v1/webhooks', org.admin, {
      id: newId(),
      url: receiverUrl,
      events: ['user.teleported'],
    });
    expect(unknownEvent.statusCode).toBe(400);
  });

  it('turns an event into a signed message with IDs only, and logs the try', async () => {
    const org = await organisation('Hooks Deliver');
    const { webhook, secret } = await subscribe(org.admin, ['user.created']);
    const person = await world.user(org.tenantId, { name: 'Asha', designation: 'executive' });

    const [message] = await messages(org.tenantId, webhook.id);
    expect(message).toMatchObject({ event: 'user.created', status: 'pending', attempts: 0 });
    await app.get(WebhooksService).deliver(org.tenantId, message!.id);

    expect(received).toHaveLength(1);
    const got = received[0]!;
    expect(got.headers['webhook-id']).toBe(message!.id);
    expect(signedWith(secret, got)).toBe(true);
    const body = JSON.parse(got.body);
    expect(body).toMatchObject({ type: 'user.created', data: { userId: person.id } });
    expect(got.body).not.toContain('+91');

    const log = (await call('GET', `/v1/webhooks/${webhook.id}/deliveries`, org.admin)).json();
    expect(log.items).toEqual([
      expect.objectContaining({
        messageId: message!.id,
        event: 'user.created',
        attempt: 1,
        status: 'delivered',
        responseCode: 200,
        messageStatus: 'delivered',
      }),
    ]);
    // Delivered once, never again.
    await app.get(WebhooksService).deliver(org.tenantId, message!.id);
    expect(received).toHaveLength(1);
  });

  it('publishes account events when accounts are made and assigned', async () => {
    const org = await organisation('Hooks Accounts');
    const territory = await world.territory(org.tenantId, `T${newId().slice(-5)}`);
    await world.user(org.tenantId, { name: 'Field Rep', designation: 'executive' });
    const { webhook } = await subscribe(org.admin, [
      'account.created',
      'account.assignment_changed',
    ]);
    const territoryCode = (await call('GET', '/v1/territories', org.admin))
      .json()
      .items.find((item: { id: string }) => item.id === territory).code;
    const loaded = await call('POST', '/v1/bulk/accounts', org.admin, {
      accountType: 'customer',
      rows: [
        {
          code: `H${newId().slice(-7)}`,
          name: 'Gupta Store',
          territory_code: territoryCode,
          'slot.executive': 'Field Rep',
        },
      ],
    });
    expect(loaded.statusCode, loaded.body).toBe(200);
    const events = (await messages(org.tenantId, webhook.id)).map((message) => message.event);
    expect(events.sort()).toEqual(['account.assignment_changed', 'account.created']);
  });

  it('tries again with backoff, gives up after a day, and sends again on request', async () => {
    const org = await organisation('Hooks Retry');
    const { webhook } = await subscribe(org.admin, ['user.created']);
    await world.user(org.tenantId, { name: 'Ravi', designation: 'executive' });
    const [message] = await messages(org.tenantId, webhook.id);
    const webhooks = app.get(WebhooksService);

    answer = 500;
    await webhooks.deliver(org.tenantId, message!.id);
    let [after] = await messages(org.tenantId, webhook.id);
    expect(after).toMatchObject({ status: 'pending', attempts: 1 });
    expect(after!.nextAttemptAt!.getTime() - Date.now()).toBeGreaterThan(50_000);

    // A day after the first try, a failure gives up.
    await app.get(Database).forTenant(org.tenantId, (tx) =>
      tx
        .update(webhookMessages)
        .set({ firstAttemptAt: new Date(Date.now() - 25 * 3_600_000) })
        .where(
          and(eq(webhookMessages.tenantId, org.tenantId), eq(webhookMessages.id, message!.id)),
        ),
    );
    await webhooks.deliver(org.tenantId, message!.id);
    [after] = await messages(org.tenantId, webhook.id);
    expect(after).toMatchObject({ status: 'failed', attempts: 2, nextAttemptAt: null });
    expect(received).toHaveLength(2);

    answer = 200;
    const replayed = await call(
      'POST',
      `/v1/webhooks/${webhook.id}/messages/${message!.id}/replay`,
      org.admin,
    );
    expect(replayed.json()).toEqual({ queued: true });
    [after] = await messages(org.tenantId, webhook.id);
    expect(after).toMatchObject({ status: 'pending', attempts: 0 });
    await webhooks.deliver(org.tenantId, message!.id);
    [after] = await messages(org.tenantId, webhook.id);
    expect(after).toMatchObject({ status: 'delivered', attempts: 1 });

    // The log keeps every try, a page at a time.
    const first = (
      await call('GET', `/v1/webhooks/${webhook.id}/deliveries?limit=2`, org.admin)
    ).json();
    expect(first.items.map((item: { status: string }) => item.status)).toEqual([
      'delivered',
      'failed',
    ]);
    const rest = (
      await call(
        'GET',
        `/v1/webhooks/${webhook.id}/deliveries?limit=2&cursor=${first.nextCursor}`,
        org.admin,
      )
    ).json();
    expect(rest).toEqual({
      items: [expect.objectContaining({ attempt: 1, status: 'failed', responseCode: 500 })],
      nextCursor: null,
    });

    const unknown = await call(
      'POST',
      `/v1/webhooks/${webhook.id}/messages/${newId()}/replay`,
      org.admin,
    );
    expect(unknown.json().error.code).toBe('NOT_FOUND');
  });

  it('sends nothing while paused, tests on request and signs with a rotated secret', async () => {
    const org = await organisation('Hooks Pause');
    const { webhook } = await subscribe(org.admin, ['user.created']);
    await world.user(org.tenantId, { name: 'Before', designation: 'executive' });
    const [waiting] = await messages(org.tenantId, webhook.id);

    const paused = await call('PATCH', `/v1/webhooks/${webhook.id}`, org.admin, {
      status: 'paused',
    });
    expect(paused.json().status).toBe('paused');
    await world.user(org.tenantId, { name: 'While paused', designation: 'executive' });
    expect(await messages(org.tenantId, webhook.id)).toHaveLength(1);
    await app.get(WebhooksService).deliver(org.tenantId, waiting!.id);
    expect(received).toHaveLength(0);

    await call('PATCH', `/v1/webhooks/${webhook.id}`, org.admin, { status: 'active' });
    const rotated = await call('POST', `/v1/webhooks/${webhook.id}/rotate`, org.admin);
    expect(rotated.statusCode).toBe(200);
    const { secret } = rotated.json();

    const tested = await call('POST', `/v1/webhooks/${webhook.id}/test`, org.admin);
    expect(tested.json()).toMatchObject({
      event: 'webhook.test',
      status: 'delivered',
      responseCode: 200,
      messageStatus: 'delivered',
    });
    expect(received).toHaveLength(1);
    expect(signedWith(secret, received[0]!)).toBe(true);
    expect(JSON.parse(received[0]!.body)).toMatchObject({
      type: 'webhook.test',
      data: { webhookId: webhook.id },
    });

    answer = 503;
    const failing = await call('POST', `/v1/webhooks/${webhook.id}/test`, org.admin);
    expect(failing.json()).toMatchObject({
      status: 'failed',
      responseCode: 503,
      messageStatus: 'failed',
    });
    const listed = (await call('GET', '/v1/webhooks', org.admin)).json();
    expect(listed.items[0].lastDelivery).toMatchObject({ status: 'failed', responseCode: 503 });
  });

  it('is for holders of webhook.manage, never for API clients or other roles', async () => {
    const org = await organisation('Hooks Access');
    const phone = newPhone();
    await world.user(org.tenantId, { phone, designation: 'executive' });
    const rep = (await world.signIn(phone, newDevice())).accessToken;
    expect((await call('GET', '/v1/webhooks', rep)).json().error.code).toBe('FORBIDDEN');

    const made = (
      await call('POST', '/v1/api-clients', org.admin, {
        id: newId(),
        name: 'ERP',
        scopes: ['people:read'],
      })
    ).json();
    const issued = await app.inject({
      method: 'POST',
      url: '/auth/v1/oauth/token',
      remoteAddress: newAddress(),
      payload: {
        grant_type: 'client_credentials',
        client_id: made.client.clientId,
        client_secret: made.clientSecret,
      },
    });
    const client = issued.json().access_token as string;
    expect((await call('GET', '/v1/webhooks', client)).json().error.code).toBe('FORBIDDEN');
  });
});
