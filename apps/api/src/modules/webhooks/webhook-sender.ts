import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Config } from '../../config';
import { publicFetch, publicUrlIssue } from '../../platform/outbound';
import { CONFIG } from '../../platform/tokens';

/** How long a receiver has to answer. */
const TIMEOUT_MS = 10_000;

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
 * goes through the outbound guard (`publicFetch`): HTTPS on 443 to a public address, so a webhook
 * can't reach into the cell's own network; off production plain HTTP and local receivers are
 * allowed, for development and tests.
 */
@Injectable()
export class WebhookSender {
  constructor(@Inject(CONFIG) private readonly config: Config) {}

  private get production(): boolean {
    return this.config.NODE_ENV === 'production';
  }

  /** What is wrong with a receiver's address, or null when a webhook may post to it. */
  async urlIssue(url: string): Promise<string | null> {
    // In production, the outbound guard's rules: https on 443 to a public address (D101).
    if (this.production) return publicUrlIssue(url);
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return 'Write a full address, such as https://erp.example.com/hooks';
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:')
      return 'Use an https:// address';
    if (parsed.username || parsed.password) return 'Leave the user name and password out of it';
    return null;
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
      // In production the connection goes to the address the guard checked, never another the
      // name resolves to by the time it's made (decision D101).
      const response = await (this.production ? publicFetch : fetch)(url, {
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
