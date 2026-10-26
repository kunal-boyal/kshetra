import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { BlockList, isIP } from 'node:net';
import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '../../config';
import { CONFIG } from '../../platform/tokens';

/** How long a receiver has to answer. */
const TIMEOUT_MS = 10_000;

/** Addresses a webhook may never reach in production: loopback, private, link-local and the like. */
const PRIVATE = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  PRIVATE.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  PRIVATE.addSubnet(address, prefix, 'ipv6');
}

/** A new signing secret, in the Standard Webhooks form: `whsec_` and 24 random bytes in base64. */
export function newWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString('base64')}`;
}

/**
 * The `webhook-signature` header (Standard Webhooks, decision D94): HMAC-SHA256 with the secret's
 * bytes over `<message ID>.<timestamp>.<body>`, in base64, after `v1,`.
 */
export function webhookSignature(
  secret: string,
  messageId: string,
  timestamp: number,
  body: string,
): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const digest = createHmac('sha256', key)
    .update(`${messageId}.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${digest}`;
}

export interface SendOutcome {
  delivered: boolean;
  responseCode: number | null;
  durationMs: number;
  error: string | null;
}

/**
 * Posts webhook messages (module M20, decision D94), signed, to receivers the tenant named. A
 * receiver must answer 2xx within ten seconds; a redirect counts as a failure. In production it
 * must be HTTPS and never resolve to a private address, so a webhook can't reach into the cell's
 * own network; off production plain HTTP and local receivers are allowed, for development and
 * tests.
 */
@Injectable()
export class WebhookSender {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  private get production(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  /** What is wrong with a receiver's address, or null when a webhook may post to it. */
  async urlIssue(url: string): Promise<string | null> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Write a full address, such as https://erp.example.com/hooks';
    }
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && !this.production)) {
      return 'Use an https:// address';
    }
    if (parsed.username || parsed.password) return 'Leave the user name and password out of it';
    if (!this.production) return null;
    const host = parsed.hostname.replace(/^\[|\]$/g, '');
    let addresses: string[];
    try {
      addresses = isIP(host)
        ? [host]
        : (await lookup(host, { all: true })).map((found) => found.address);
    } catch {
      return 'This address can’t be found';
    }
    if (addresses.length === 0) return 'This address can’t be found';
    const blocked = addresses.some((address) =>
      PRIVATE.check(
        address.replace(/^::ffff:/, ''),
        isIP(address.replace(/^::ffff:/, '')) === 6 ? 'ipv6' : 'ipv4',
      ),
    );
    return blocked ? 'Use a public address; private networks can’t be reached' : null;
  }

  /** One try: the body exactly as stored, signed with the subscription's secret. */
  async send(
    url: string,
    secret: string,
    messageId: string,
    body: Record<string, unknown>,
    now: Date = new Date(),
  ): Promise<SendOutcome> {
    const started = Date.now();
    const issue = await this.urlIssue(url);
    if (issue) return { delivered: false, responseCode: null, durationMs: 0, error: issue };
    const text = JSON.stringify(body);
    const timestamp = Math.floor(now.getTime() / 1000);
    try {
      const response = await fetch(url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: {
          'content-type': 'application/json',
          'user-agent': `${this.config.PRODUCT_NAME} Webhooks`,
          'webhook-id': messageId,
          'webhook-timestamp': String(timestamp),
          'webhook-signature': webhookSignature(secret, messageId, timestamp, text),
        },
        body: text,
      });
      await response.body?.cancel().catch(() => undefined);
      const delivered = response.status >= 200 && response.status < 300;
      return {
        delivered,
        responseCode: response.status,
        durationMs: Date.now() - started,
        error: delivered ? null : `The receiver answered ${response.status}`,
      };
    } catch (error) {
      const timedOut = (error as Error).name === 'TimeoutError';
      return {
        delivered: false,
        responseCode: null,
        durationMs: Date.now() - started,
        error: timedOut
          ? 'The receiver didn’t answer within 10 seconds'
          : 'The receiver couldn’t be reached',
      };
    }
  }
}
