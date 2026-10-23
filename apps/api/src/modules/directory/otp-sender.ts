import { Injectable, Logger } from '@nestjs/common';
import { createTransport, type Transporter } from 'nodemailer';
import { maskPhone } from '@thelamp/shared';
import { type Msg91Settings, sendFlow } from '../../platform/msg91';

export interface OtpMessage {
  phone: string;
  code: string;
}

/**
 * Delivers one-time codes: by MSG91 in production (decision D67), with WhatsApp as the fallback
 * later (M1); a second provider behind this interface covers an outage (spec 14.6).
 */
export abstract class OtpSender {
  abstract send(message: OtpMessage): Promise<void>;
}

/** Local development only: prints the code, with the number masked. Production refuses it. */
@Injectable()
export class ConsoleOtpSender extends OtpSender {
  private readonly logger = new Logger('OTP');

  async send({ phone, code }: OtpMessage): Promise<void> {
    this.logger.log(`Code for ${maskPhone(phone)}: ${code}`);
  }
}

/** Tests only: keeps every code so a test can sign in. */
@Injectable()
export class MemoryOtpSender extends OtpSender {
  readonly sent: OtpMessage[] = [];

  async send(message: OtpMessage): Promise<void> {
    this.sent.push(message);
  }

  /** The newest code sent to `phone`, if any. */
  lastCode(phone: string): string | undefined {
    return this.sent.findLast((message) => message.phone === phone)?.code;
  }
}

/** Sends the code in the DLT template MSG91 holds for one-time codes (decision D67). */
export class Msg91OtpSender extends OtpSender {
  constructor(
    private readonly settings: Msg91Settings,
    private readonly templateId: string,
    private readonly variable: string,
  ) {
    super();
  }

  async send({ phone, code }: OtpMessage): Promise<void> {
    const result = await sendFlow(this.settings, this.templateId, phone, { [this.variable]: code });
    // The caller logs this; it names neither the number nor the code.
    if (!result.ok) throw new Error(result.error ?? 'MSG91 did not send the code');
  }
}

/**
 * Local development and CI only (decision D68): mails each code to the Mailpit inbox, to
 * `<number>@otp.local`, where Maestro's flows and a developer testing on a phone read it.
 * Production refuses it.
 */
export class MailpitOtpSender extends OtpSender {
  private readonly transport: Transporter;

  constructor(smtpUrl: string) {
    super();
    this.transport = createTransport(smtpUrl);
  }

  /** The inbox address of a number's codes. */
  static addressOf(phone: string): string {
    return `${phone.replace(/^\+/, '')}@otp.local`;
  }

  async send({ phone, code }: OtpMessage): Promise<void> {
    await this.transport.sendMail({
      from: 'sign-in@otp.local',
      to: MailpitOtpSender.addressOf(phone),
      subject: `Code ${code}`,
      text: `Your sign-in code is ${code}.`,
    });
  }
}
