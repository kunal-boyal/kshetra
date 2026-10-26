import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Config } from '../../config';
import { newWebhookSecret, WebhookSender, webhookSignature } from './webhook-sender';

const sender = (NODE_ENV: Config['NODE_ENV']) =>
  new WebhookSender({ NODE_ENV, PRODUCT_NAME: 'The Lamp' } as Config);

describe('webhook addresses and signatures (decision D94)', () => {
  it('takes only public https addresses in production', async () => {
    const production = sender('production');
    expect(await production.urlIssue('http://erp.example.com/hooks')).toBe(
      'Use an https:// address',
    );
    expect(await production.urlIssue('https://127.0.0.1/hooks')).toBe(
      'Use a public address; private networks can’t be reached',
    );
    expect(await production.urlIssue('https://10.20.30.40/hooks')).toMatch(/private networks/);
    expect(await production.urlIssue('https://[::1]/hooks')).toMatch(/private networks/);
    // IPv4 loopback written as IPv6, which the old check let through (decision D101).
    expect(await production.urlIssue('https://[::ffff:7f00:1]/hooks')).toMatch(/private networks/);
    expect(await production.urlIssue('https://93.184.215.14:8443/hooks')).toMatch(/standard HTTPS/);
    expect(await production.urlIssue('https://169.254.169.254/latest')).toMatch(/private networks/);
    expect(await production.urlIssue('https://user:pass@93.184.215.14/hooks')).toBe(
      'Leave the user name and password out of it',
    );
    expect(await production.urlIssue('https://93.184.215.14/hooks')).toBeNull();
    expect(await production.urlIssue('not an address')).toMatch(/full address/);
  });

  it('lets development and tests post to local receivers over http', async () => {
    expect(await sender('test').urlIssue('http://127.0.0.1:4010/hooks')).toBeNull();
  });

  it('signs as Standard Webhooks do: HMAC-SHA256 over id, timestamp and body', () => {
    const secret = newWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9+/=]{32}$/);
    const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update('msg_1.1700000000.{"a":1}')
      .digest('base64');
    expect(webhookSignature(secret, 'msg_1', 1_700_000_000, '{"a":1}')).toBe(`v1,${expected}`);
  });
});
