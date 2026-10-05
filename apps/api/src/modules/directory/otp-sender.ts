import { Injectable, Logger } from '@nestjs/common';
import { maskPhone } from '@kshetra/shared';

export interface OtpMessage {
  phone: string;
  code: string;
}

/**
 * Delivers one-time codes. A real SMS provider with DLT templates joins in phase 1, with WhatsApp
 * as the fallback (M1); a second provider behind this interface covers an outage (spec 14.6).
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
