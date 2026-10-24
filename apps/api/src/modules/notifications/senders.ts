import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@thelamp/shared';
import { createTransport, type Transporter } from 'nodemailer';
import type { Config } from '../../config';
import { type Msg91Settings, msg91Settings, sendFlow } from '../../platform/msg91';

/**
 * How notifications leave the cell (M16, decision D58), one sender per channel. Each answers per
 * message: delivered with the provider's reference, or failed, and whether trying again could
 * help. Console senders print locally, with numbers and addresses masked; memory senders keep
 * what was sent for tests. Production refuses both; WhatsApp may be off instead (decision D85).
 */

export interface SendResult {
  ok: boolean;
  providerRef?: string;
  error?: string;
  /** A failure that a retry won't fix, such as a token the provider no longer knows. */
  permanent?: boolean;
  costUnits?: number;
}

export interface PushMessage {
  token: string;
  title: string;
  body: string;
  /** Where tapping it leads in the app. */
  link: string | null;
}

export abstract class PushSender {
  abstract send(message: PushMessage): Promise<SendResult>;
}

export interface SmsMessage {
  phone: string;
  text: string;
  segments: number;
  /** The notification's event, language and values, for senders that send by template. */
  event: string;
  locale: string;
  values: Readonly<Record<string, string>>;
}

export abstract class SmsSender {
  abstract send(message: SmsMessage): Promise<SendResult>;
}

/** A WhatsApp message: always a provider-approved template, filled with the notification's values. */
export interface WhatsAppMessage {
  phone: string;
  /** The approved template's name, by event and language (spec 5.12). */
  template: string;
  locale: string;
  values: Readonly<Record<string, string>>;
  /** The text as the app shows it, for console senders and logs. */
  text: string;
}

export abstract class WhatsAppSender {
  /** Whether this cell sends WhatsApp at all; off, deliveries move on to the next channel. */
  abstract readonly enabled: boolean;
  abstract send(message: WhatsAppMessage): Promise<SendResult>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export abstract class EmailSender {
  abstract send(message: EmailMessage): Promise<SendResult>;
}

/** A push token as logs may show it: its first few characters. */
export function maskToken(token: string): string {
  return `${token.slice(0, 22)}…`;
}

/** An address as logs may show it: its first letter and its domain. */
export function maskEmail(address: string): string {
  const [name = '', domain = ''] = address.split('@');
  return `${name.slice(0, 1)}…@${domain}`;
}

/** Expo's push service (decision D58): Android through the tenant's Firebase project, iPhones through APNs. */
@Injectable()
export class ExpoPushSender extends PushSender {
  constructor(private readonly accessToken: string | undefined) {
    super();
  }

  async send({ token, title, body, link }: PushMessage): Promise<SendResult> {
    let response: Response;
    try {
      response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify({
          to: token,
          title,
          body,
          sound: 'default',
          priority: 'high',
          data: link ? { link } : {},
        }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      return { ok: false, error: `Expo push unreachable: ${(error as Error).message}` };
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `Expo push answered ${response.status}`,
        permanent: response.status < 500,
      };
    }
    const answer = (await response.json()) as {
      data?: {
        status: 'ok' | 'error';
        id?: string;
        message?: string;
        details?: { error?: string };
      };
    };
    const ticket = answer.data;
    if (ticket?.status === 'ok')
      return { ok: true, ...(ticket.id ? { providerRef: ticket.id } : {}) };
    const code = ticket?.details?.error ?? 'Unknown';
    return {
      ok: false,
      error: `${code}: ${ticket?.message ?? 'Expo refused the message'}`,
      // A phone that uninstalled the app, or a token from another project, won't come back.
      permanent: code === 'DeviceNotRegistered' || code === 'InvalidCredentials',
    };
  }
}

@Injectable()
export class ConsolePushSender extends PushSender {
  private readonly logger = new Logger('Push');

  async send({ token, title, body, link }: PushMessage): Promise<SendResult> {
    this.logger.log(`To ${maskToken(token)}: ${title} — ${body}${link ? ` (${link})` : ''}`);
    return { ok: true, providerRef: 'console' };
  }
}

@Injectable()
export class MemoryPushSender extends PushSender {
  readonly sent: PushMessage[] = [];
  /** Tokens a test wants refused, as Expo refuses a phone that uninstalled the app. */
  readonly refused = new Set<string>();

  async send(message: PushMessage): Promise<SendResult> {
    if (this.refused.has(message.token)) {
      return { ok: false, error: 'DeviceNotRegistered', permanent: true };
    }
    this.sent.push(message);
    return { ok: true, providerRef: `memory-${this.sent.length}` };
  }
}

@Injectable()
export class ConsoleSmsSender extends SmsSender {
  private readonly logger = new Logger('SMS');

  async send({ phone, text, segments }: SmsMessage): Promise<SendResult> {
    this.logger.log(
      `To ${maskPhone(phone)} (${segments} part${segments === 1 ? '' : 's'}): ${text}`,
    );
    return { ok: true, providerRef: 'console', costUnits: segments };
  }
}

@Injectable()
export class MemorySmsSender extends SmsSender {
  readonly sent: SmsMessage[] = [];

  async send(message: SmsMessage): Promise<SendResult> {
    this.sent.push(message);
    return { ok: true, providerRef: `memory-${this.sent.length}`, costUnits: message.segments };
  }
}

/** No WhatsApp provider yet (decision D12): nothing goes out, and delivery skips the channel. */
@Injectable()
export class OffWhatsAppSender extends WhatsAppSender {
  readonly enabled = false;

  async send(): Promise<SendResult> {
    return { ok: false, permanent: true, error: 'WhatsApp is off' };
  }
}

@Injectable()
export class ConsoleWhatsAppSender extends WhatsAppSender {
  readonly enabled = true;
  private readonly logger = new Logger('WhatsApp');

  async send({ phone, template, text }: WhatsAppMessage): Promise<SendResult> {
    this.logger.log(`To ${maskPhone(phone)} in ${template}: ${text}`);
    return { ok: true, providerRef: 'console', costUnits: 1 };
  }
}

@Injectable()
export class MemoryWhatsAppSender extends WhatsAppSender {
  readonly enabled = true;
  readonly sent: WhatsAppMessage[] = [];

  async send(message: WhatsAppMessage): Promise<SendResult> {
    this.sent.push(message);
    return { ok: true, providerRef: `memory-${this.sent.length}`, costUnits: 1 };
  }
}

/** Email over SMTP: Mailpit locally, Amazon SES's SMTP endpoint in AWS. */
@Injectable()
export class SmtpEmailSender extends EmailSender {
  private readonly transport: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    super();
    this.transport = createTransport(url);
  }

  async send({ to, subject, text }: EmailMessage): Promise<SendResult> {
    try {
      const info = await this.transport.sendMail({ from: this.from, to, subject, text });
      return { ok: true, providerRef: info.messageId };
    } catch (error) {
      return { ok: false, error: `SMTP: ${(error as Error).message}` };
    }
  }
}

@Injectable()
export class ConsoleEmailSender extends EmailSender {
  private readonly logger = new Logger('Email');

  async send({ to, subject }: EmailMessage): Promise<SendResult> {
    this.logger.log(`To ${maskEmail(to)}: ${subject}`);
    return { ok: true, providerRef: 'console' };
  }
}

@Injectable()
export class MemoryEmailSender extends EmailSender {
  readonly sent: EmailMessage[] = [];

  async send(message: EmailMessage): Promise<SendResult> {
    this.sent.push(message);
    return { ok: true, providerRef: `memory-${this.sent.length}` };
  }
}

/** The push sender the configuration asks for. */
export function pushSender(config: Config): PushSender {
  if (config.PUSH_PROVIDER === 'expo') return new ExpoPushSender(config.EXPO_ACCESS_TOKEN);
  return config.PUSH_PROVIDER === 'memory' ? new MemoryPushSender() : new ConsolePushSender();
}

/**
 * Sends each event in the DLT template registered for it (decision D67), with the notification's
 * values as the template's variables. An event without a template in the reader's language, or
 * in English, fails at once, so delivery moves on to the next channel.
 */
export class Msg91SmsSender extends SmsSender {
  constructor(
    private readonly settings: Msg91Settings,
    private readonly templates: Readonly<Record<string, Readonly<Record<string, string>>>>,
  ) {
    super();
  }

  async send({ phone, event, locale, values, segments }: SmsMessage): Promise<SendResult> {
    const templateId = this.templates[event]?.[locale] ?? this.templates[event]?.en;
    if (!templateId) {
      return { ok: false, permanent: true, error: `No DLT template for ${event}` };
    }
    const result = await sendFlow(this.settings, templateId, phone, values);
    return result.ok ? { ...result, costUnits: segments } : result;
  }
}

export function smsSender(config: Config): SmsSender {
  if (config.SMS_PROVIDER === 'msg91') {
    return new Msg91SmsSender(msg91Settings(config), config.MSG91_SMS_TEMPLATES);
  }
  return config.SMS_PROVIDER === 'memory' ? new MemorySmsSender() : new ConsoleSmsSender();
}

/** The WhatsApp sender the configuration asks for; a real provider joins once its account exists. */
export function whatsappSender(config: Config): WhatsAppSender {
  if (config.WHATSAPP_PROVIDER === 'console') return new ConsoleWhatsAppSender();
  return config.WHATSAPP_PROVIDER === 'memory'
    ? new MemoryWhatsAppSender()
    : new OffWhatsAppSender();
}

export function emailSender(config: Config): EmailSender {
  if (config.EMAIL_PROVIDER === 'smtp') {
    const from =
      config.MAIL_FROM ?? `${config.PRODUCT_SLUG} <no-reply@${config.PRODUCT_SLUG}.local>`;
    return new SmtpEmailSender(config.SMTP_URL, from);
  }
  return config.EMAIL_PROVIDER === 'memory' ? new MemoryEmailSender() : new ConsoleEmailSender();
}
