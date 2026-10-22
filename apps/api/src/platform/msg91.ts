/**
 * MSG91 (decision D67), India's SMS route for one-time codes and SMS notifications. Every message
 * goes through a DLT-registered template by MSG91's flow API: the template ID and the values of
 * its variables, never free text, as Indian operators drop unregistered messages.
 */

import type { Config } from '../config';

export interface Msg91Settings {
  authKey: string;
  baseUrl: string;
  /** The sender ID registered on DLT; left out, the template's own sender is used. */
  sender?: string;
  timeoutMs?: number;
}

export interface Msg91Result {
  ok: boolean;
  /** MSG91's request ID, to find the message in its reports. */
  providerRef?: string;
  error?: string;
  /** A failure that sending again won't fix, such as a refused key or template. */
  permanent?: boolean;
}

/** The account settings from the cell's configuration, which checks they are there. */
export function msg91Settings(config: Config): Msg91Settings {
  return {
    authKey: config.MSG91_AUTH_KEY!,
    baseUrl: config.MSG91_BASE_URL,
    ...(config.MSG91_SENDER ? { sender: config.MSG91_SENDER } : {}),
  };
}

/** Numbers as MSG91 takes them: the country code and the number, digits only. */
export function msg91Number(e164: string): string {
  return e164.replace(/^\+/, '');
}

/** A provider's message with any long run of digits taken out, so no number reaches a log. */
function withoutNumbers(text: string): string {
  return text.replace(/\d{6,}/g, '…').slice(0, 300);
}

/** Sends one message through a DLT template, with the template's variables by name. */
export async function sendFlow(
  settings: Msg91Settings,
  templateId: string,
  phone: string,
  variables: Readonly<Record<string, string>>,
): Promise<Msg91Result> {
  let response: Response;
  try {
    response = await fetch(new URL('/api/v5/flow', settings.baseUrl), {
      method: 'POST',
      headers: {
        authkey: settings.authKey,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        template_id: templateId,
        ...(settings.sender ? { sender: settings.sender } : {}),
        short_url: '0',
        recipients: [{ ...variables, mobiles: msg91Number(phone) }],
      }),
      signal: AbortSignal.timeout(settings.timeoutMs ?? 10_000),
    });
  } catch (error) {
    return { ok: false, error: `MSG91 could not be reached: ${(error as Error).name}` };
  }
  let body: { type?: unknown; message?: unknown } = {};
  try {
    body = (await response.json()) as typeof body;
  } catch {
    // Some failures answer without JSON; the status says enough.
  }
  const message = typeof body.message === 'string' ? body.message : '';
  if (response.ok && body.type === 'success') return { ok: true, providerRef: message };
  const error = `MSG91 answered ${response.status}${message ? `: ${withoutNumbers(message)}` : ''}`;
  // A refused key, template or number stays refused; throttling and outages pass.
  const permanent = response.status < 500 && response.status !== 429 && response.status !== 408;
  return { ok: false, error, permanent: response.ok ? true : permanent };
}
