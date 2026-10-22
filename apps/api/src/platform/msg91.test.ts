import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Msg91OtpSender } from '../modules/directory/otp-sender';
import { Msg91SmsSender } from '../modules/notifications/senders';
import { type Msg91Settings, sendFlow } from './msg91';

interface Received {
  path: string;
  authKey: string | undefined;
  body: Record<string, unknown>;
}

let server: Server;
let settings: Msg91Settings;
let received: Received[] = [];
let answer: { status: number; body: unknown } = { status: 200, body: {} };

const read = (request: IncomingMessage) =>
  new Promise<string>((resolve) => {
    let text = '';
    request.on('data', (chunk: Buffer) => (text += chunk.toString()));
    request.on('end', () => resolve(text));
  });

beforeAll(async () => {
  server = createServer(async (request, response) => {
    received.push({
      path: request.url ?? '',
      authKey: request.headers.authkey as string | undefined,
      body: JSON.parse(await read(request)) as Record<string, unknown>,
    });
    response.writeHead(answer.status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  settings = { authKey: 'test-key', baseUrl: `http://127.0.0.1:${port}`, sender: 'KSHTRA' };
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  received = [];
  answer = { status: 200, body: { type: 'success', message: 'request-1' } };
});

describe('MSG91 (decision D67)', () => {
  it('sends through a DLT template, with its variables by name', async () => {
    const result = await sendFlow(settings, 'tpl-1', '+919000000001', { name: 'Asha' });
    expect(result).toEqual({ ok: true, providerRef: 'request-1' });
    expect(received).toEqual([
      {
        path: '/api/v5/flow',
        authKey: 'test-key',
        body: {
          template_id: 'tpl-1',
          sender: 'KSHTRA',
          short_url: '0',
          recipients: [{ name: 'Asha', mobiles: '919000000001' }],
        },
      },
    ]);
  });

  it('says whether a failure is worth trying again, and keeps numbers out of it', async () => {
    answer = { status: 401, body: { type: 'error', message: 'Invalid authkey for 919000000001' } };
    const refused = await sendFlow(settings, 'tpl-1', '+919000000001', {});
    expect(refused).toEqual({
      ok: false,
      permanent: true,
      error: 'MSG91 answered 401: Invalid authkey for …',
    });
    answer = { status: 503, body: { type: 'error', message: 'Try later' } };
    expect(await sendFlow(settings, 'tpl-1', '+919000000001', {})).toMatchObject({
      ok: false,
      permanent: false,
    });
    answer = { status: 200, body: { type: 'error', message: 'Template not approved' } };
    expect(await sendFlow(settings, 'tpl-1', '+919000000001', {})).toMatchObject({
      ok: false,
      permanent: true,
    });
    const away = await sendFlow(
      { ...settings, baseUrl: 'http://127.0.0.1:9' },
      'tpl-1',
      '+919000000001',
      {},
    );
    expect(away).toMatchObject({ ok: false });
    expect(away.permanent).toBeUndefined();
  });

  it('sends one-time codes in their template, and fails without naming the code', async () => {
    const sender = new Msg91OtpSender(settings, 'otp-tpl', 'otp');
    await sender.send({ phone: '+919000000001', code: '482913' });
    expect(received[0]!.body).toMatchObject({
      template_id: 'otp-tpl',
      recipients: [{ otp: '482913', mobiles: '919000000001' }],
    });
    answer = { status: 400, body: { type: 'error', message: 'Bad request 482913' } };
    await expect(sender.send({ phone: '+919000000001', code: '482913' })).rejects.toThrow(
      'MSG91 answered 400: Bad request …',
    );
  });

  it("sends a notification in its event's template, or hands it to the next channel", async () => {
    const sender = new Msg91SmsSender(settings, { 'visit.missed': { en: 'sms-en', hi: 'sms-hi' } });
    const message = {
      phone: '+919000000001',
      text: 'Missed visit: Sharma Stores',
      segments: 1,
      event: 'visit.missed',
      locale: 'hi',
      values: { account: 'Sharma Stores' },
    };
    expect(await sender.send(message)).toEqual({
      ok: true,
      providerRef: 'request-1',
      costUnits: 1,
    });
    expect(received[0]!.body).toMatchObject({
      template_id: 'sms-hi',
      recipients: [{ account: 'Sharma Stores' }],
    });
    expect(await sender.send({ ...message, event: 'target.locked' })).toEqual({
      ok: false,
      permanent: true,
      error: 'No DLT template for target.locked',
    });
    expect(received).toHaveLength(1);
  });
});
